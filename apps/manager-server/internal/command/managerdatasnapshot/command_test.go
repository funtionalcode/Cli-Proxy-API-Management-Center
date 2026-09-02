package managerdatasnapshot

import (
	"bytes"
	"context"
	"errors"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/seakee/cpa-manager-plus/apps/manager-server/internal/processlock"
)

func TestRunCreateRestoreAndDelete(t *testing.T) {
	dataDir := t.TempDir()
	dbPath := filepath.Join(dataDir, "usage.sqlite")
	dataKeyPath := filepath.Join(dataDir, "data.key")
	snapshotDir := filepath.Join(dataDir, ".cpamp-manager-snapshot-test")
	writeTestFile(t, dbPath, "database-before", 0o640)
	writeTestFile(t, dbPath+"-wal", "wal-before", 0o600)
	writeTestFile(t, dbPath+"-journal", "journal-before", 0o600)
	writeTestFile(t, dataKeyPath, "key-before", 0o600)

	runSnapshotCommand(t, "create", dbPath, dataKeyPath, snapshotDir)
	if info, err := os.Stat(snapshotDir); err != nil || info.Mode().Perm() != 0o700 {
		t.Fatalf("snapshot directory info=%v err=%v", info, err)
	}

	writeTestFile(t, dbPath, "database-after", 0o600)
	writeTestFile(t, dbPath+"-wal", "wal-after", 0o600)
	writeTestFile(t, dbPath+"-shm", "new-shm", 0o600)
	if err := os.Remove(dbPath + "-journal"); err != nil {
		t.Fatalf("remove journal: %v", err)
	}
	writeTestFile(t, dataKeyPath, "key-after", 0o600)

	runSnapshotCommand(t, "restore", dbPath, dataKeyPath, snapshotDir)
	requireTestFile(t, dbPath, "database-before")
	requireTestFile(t, dbPath+"-wal", "wal-before")
	requireTestFile(t, dbPath+"-journal", "journal-before")
	requireTestFile(t, dataKeyPath, "key-before")
	if _, err := os.Stat(dbPath + "-shm"); !os.IsNotExist(err) {
		t.Fatalf("post-snapshot shm still exists: %v", err)
	}
	if info, err := os.Stat(dbPath); err != nil || info.Mode().Perm() != 0o640 {
		t.Fatalf("restored database mode=%v err=%v", info.Mode().Perm(), err)
	}

	runSnapshotCommand(t, "delete", dbPath, dataKeyPath, snapshotDir)
	if _, err := os.Stat(snapshotDir); !os.IsNotExist(err) {
		t.Fatalf("snapshot directory still exists: %v", err)
	}
}

func TestRunRestoreRejectsCorruptSnapshotBeforeChangingData(t *testing.T) {
	dataDir := t.TempDir()
	dbPath := filepath.Join(dataDir, "usage.sqlite")
	dataKeyPath := filepath.Join(dataDir, "data.key")
	snapshotDir := filepath.Join(dataDir, ".cpamp-manager-snapshot-test")
	writeTestFile(t, dbPath, "database-before", 0o600)
	writeTestFile(t, dataKeyPath, "key-before", 0o600)
	runSnapshotCommand(t, "create", dbPath, dataKeyPath, snapshotDir)

	writeTestFile(t, dbPath, "database-after", 0o600)
	writeTestFile(t, dataKeyPath, "key-after", 0o600)
	writeTestFile(t, filepath.Join(snapshotDir, "database"), "corrupt", 0o600)

	var stdout bytes.Buffer
	var stderr bytes.Buffer
	err := Run(context.Background(), snapshotArgs("restore", dbPath, dataKeyPath, snapshotDir), &stdout, &stderr)
	if err == nil || !strings.Contains(err.Error(), "integrity validation") {
		t.Fatalf("err=%v stderr=%s", err, stderr.String())
	}
	requireTestFile(t, dbPath, "database-after")
	requireTestFile(t, dataKeyPath, "key-after")
	if _, err := os.Stat(snapshotDir); err != nil {
		t.Fatalf("snapshot was not retained: %v", err)
	}
}

func TestRunCreateRejectsActiveManager(t *testing.T) {
	dataDir := t.TempDir()
	dbPath := filepath.Join(dataDir, "usage.sqlite")
	dataKeyPath := filepath.Join(dataDir, "data.key")
	snapshotDir := filepath.Join(dataDir, ".cpamp-manager-snapshot-test")
	writeTestFile(t, dbPath, "database", 0o600)
	writeTestFile(t, dataKeyPath, "key", 0o600)
	lock, err := processlock.Acquire(dbPath)
	if err != nil {
		t.Fatalf("acquire process lock: %v", err)
	}
	t.Cleanup(func() { _ = lock.Close() })

	var stdout bytes.Buffer
	var stderr bytes.Buffer
	err = Run(context.Background(), snapshotArgs("create", dbPath, dataKeyPath, snapshotDir), &stdout, &stderr)
	if !errors.Is(err, processlock.ErrLocked) || !strings.Contains(err.Error(), "stop Manager Server") {
		t.Fatalf("err=%v", err)
	}
	if _, err := os.Stat(snapshotDir); !os.IsNotExist(err) {
		t.Fatalf("snapshot was created while lock held: %v", err)
	}
}

func TestRunCreateCleansIncompleteSnapshot(t *testing.T) {
	dataDir := t.TempDir()
	dbPath := filepath.Join(dataDir, "usage.sqlite")
	dataKeyPath := filepath.Join(dataDir, "data.key")
	snapshotDir := filepath.Join(dataDir, ".cpamp-manager-snapshot-test")
	writeTestFile(t, dbPath, "database", 0o600)
	writeTestFile(t, dataKeyPath, "key", 0o600)
	if err := os.Symlink(dataKeyPath, dbPath+"-wal"); err != nil {
		t.Fatalf("create companion symlink: %v", err)
	}

	var stdout bytes.Buffer
	var stderr bytes.Buffer
	err := Run(context.Background(), snapshotArgs("create", dbPath, dataKeyPath, snapshotDir), &stdout, &stderr)
	if err == nil || !strings.Contains(err.Error(), "not a regular file") {
		t.Fatalf("err=%v", err)
	}
	if _, err := os.Stat(snapshotDir); !os.IsNotExist(err) {
		t.Fatalf("incomplete snapshot was published: %v", err)
	}
	matches, err := filepath.Glob(filepath.Join(dataDir, ".cpamp-manager-snapshot-tmp-*"))
	if err != nil || len(matches) != 0 {
		t.Fatalf("temporary snapshots=%v err=%v", matches, err)
	}
}

func TestRunRestoreMidCommitFailureRollsBackWholeFileSet(t *testing.T) {
	dataDir := t.TempDir()
	dbPath := filepath.Join(dataDir, "usage.sqlite")
	dataKeyPath := filepath.Join(dataDir, "data.key")
	snapshotDir := filepath.Join(dataDir, ".cpamp-manager-snapshot-test")
	writeTestFile(t, dbPath, "database-before", 0o600)
	writeTestFile(t, dbPath+"-wal", "wal-before", 0o600)
	writeTestFile(t, dbPath+"-shm", "shm-before", 0o600)
	writeTestFile(t, dbPath+"-journal", "journal-before", 0o600)
	writeTestFile(t, dataKeyPath, "key-before", 0o600)
	runSnapshotCommand(t, "create", dbPath, dataKeyPath, snapshotDir)

	writeTestFile(t, dbPath, "database-after", 0o600)
	writeTestFile(t, dbPath+"-wal", "wal-after", 0o600)
	writeTestFile(t, dbPath+"-shm", "shm-after", 0o600)
	writeTestFile(t, dbPath+"-journal", "journal-after", 0o600)
	writeTestFile(t, dataKeyPath, "key-after", 0o600)

	injectRestoreSwitchFailure(t, dataKeyPath)
	var stdout bytes.Buffer
	var stderr bytes.Buffer
	err := Run(context.Background(), snapshotArgs("restore", dbPath, dataKeyPath, snapshotDir), &stdout, &stderr)
	if err == nil || !strings.Contains(err.Error(), "injected data-key switch failure") {
		t.Fatalf("err=%v", err)
	}
	if !strings.Contains(err.Error(), "pre-restore state") {
		t.Fatalf("error does not report rollback: %v", err)
	}
	// The database was already switched to the snapshot copy when the data-key
	// switch failed; the rollback must bring the whole live set back.
	requireTestFile(t, dbPath, "database-after")
	requireTestFile(t, dbPath+"-wal", "wal-after")
	requireTestFile(t, dbPath+"-shm", "shm-after")
	requireTestFile(t, dbPath+"-journal", "journal-after")
	requireTestFile(t, dataKeyPath, "key-after")
	requireNoRestoreTempFiles(t, dataDir)
}

func TestRunRestoreMidCommitFailureRestoresMissingSidecarState(t *testing.T) {
	dataDir := t.TempDir()
	dbPath := filepath.Join(dataDir, "usage.sqlite")
	dataKeyPath := filepath.Join(dataDir, "data.key")
	snapshotDir := filepath.Join(dataDir, ".cpamp-manager-snapshot-test")
	// The snapshot records an existing -shm and a missing -journal.
	writeTestFile(t, dbPath, "database-before", 0o600)
	writeTestFile(t, dbPath+"-wal", "wal-before", 0o600)
	writeTestFile(t, dbPath+"-shm", "shm-before", 0o600)
	writeTestFile(t, dataKeyPath, "key-before", 0o600)
	runSnapshotCommand(t, "create", dbPath, dataKeyPath, snapshotDir)

	// Live state diverges: -shm removed, -journal created after the snapshot.
	if err := os.Remove(dbPath + "-shm"); err != nil {
		t.Fatalf("remove shm: %v", err)
	}
	writeTestFile(t, dbPath, "database-after", 0o600)
	writeTestFile(t, dbPath+"-wal", "wal-after", 0o600)
	writeTestFile(t, dbPath+"-journal", "journal-after", 0o600)
	writeTestFile(t, dataKeyPath, "key-after", 0o600)

	injectRestoreSwitchFailure(t, dataKeyPath)
	var stdout bytes.Buffer
	var stderr bytes.Buffer
	err := Run(context.Background(), snapshotArgs("restore", dbPath, dataKeyPath, snapshotDir), &stdout, &stderr)
	if err == nil {
		t.Fatal("restore unexpectedly succeeded")
	}
	// Rollback must also restore the missing/existing sidecar states: -shm was
	// switched in before the failure and must be removed again, while the
	// post-snapshot -journal must survive with its live content.
	if _, err := os.Stat(dbPath + "-shm"); !os.IsNotExist(err) {
		t.Fatalf("shm was not rolled back to missing: %v", err)
	}
	requireTestFile(t, dbPath+"-journal", "journal-after")
	requireTestFile(t, dbPath, "database-after")
	requireTestFile(t, dbPath+"-wal", "wal-after")
	requireTestFile(t, dataKeyPath, "key-after")
	requireNoRestoreTempFiles(t, dataDir)
}

func TestRunRestoreCleanupFailureKeepsCommittedFileSetAndRetainsArtifact(t *testing.T) {
	dataDir := t.TempDir()
	dbPath := filepath.Join(dataDir, "usage.sqlite")
	dataKeyPath := filepath.Join(dataDir, "data.key")
	snapshotDir := filepath.Join(dataDir, ".cpamp-manager-snapshot-test")
	writeTestFile(t, dbPath, "database-before", 0o600)
	writeTestFile(t, dbPath+"-wal", "wal-before", 0o600)
	writeTestFile(t, dbPath+"-shm", "shm-before", 0o600)
	writeTestFile(t, dbPath+"-journal", "journal-before", 0o600)
	writeTestFile(t, dataKeyPath, "key-before", 0o600)
	runSnapshotCommand(t, "create", dbPath, dataKeyPath, snapshotDir)

	writeTestFile(t, dbPath, "database-after", 0o600)
	writeTestFile(t, dbPath+"-wal", "wal-after", 0o600)
	writeTestFile(t, dbPath+"-shm", "shm-after", 0o600)
	writeTestFile(t, dbPath+"-journal", "journal-after", 0o600)
	writeTestFile(t, dataKeyPath, "key-after", 0o600)
	previous := removeFn
	removeFn = func(string) error {
		return errors.New("injected rollback-slot cleanup failure")
	}
	t.Cleanup(func() { removeFn = previous })

	var stdout bytes.Buffer
	var stderr bytes.Buffer
	err := Run(context.Background(), snapshotArgs("restore", dbPath, dataKeyPath, snapshotDir), &stdout, &stderr)
	if err != nil {
		t.Fatalf("restore returned business error after cleanup failure: %v", err)
	}
	if !strings.Contains(stderr.String(), "rollback slot") || !strings.Contains(stderr.String(), "retained") {
		t.Fatalf("cleanup warning = %q", stderr.String())
	}
	requireTestFile(t, dbPath, "database-before")
	requireTestFile(t, dbPath+"-wal", "wal-before")
	requireTestFile(t, dbPath+"-shm", "shm-before")
	requireTestFile(t, dbPath+"-journal", "journal-before")
	requireTestFile(t, dataKeyPath, "key-before")
	matches, err := filepath.Glob(filepath.Join(dataDir, ".cpamp-restore-rollback-*"))
	if err != nil || len(matches) == 0 {
		t.Fatalf("rollback cleanup artifacts were not retained: matches=%v err=%v", matches, err)
	}
}

func TestRunRestoreRejectsSymlinkedTargetBeforeStaging(t *testing.T) {
	dataDir := t.TempDir()
	dbPath := filepath.Join(dataDir, "usage.sqlite")
	dataKeyPath := filepath.Join(dataDir, "data.key")
	snapshotDir := filepath.Join(dataDir, ".cpamp-manager-snapshot-test")
	outsideTarget := filepath.Join(dataDir, "outside-secret")
	writeTestFile(t, dbPath, "database-before", 0o600)
	writeTestFile(t, dataKeyPath, "key-before", 0o600)
	runSnapshotCommand(t, "create", dbPath, dataKeyPath, snapshotDir)

	writeTestFile(t, dbPath, "database-after", 0o600)
	writeTestFile(t, dataKeyPath, "key-after", 0o600)
	writeTestFile(t, outsideTarget, "outside-content", 0o600)
	if err := os.Remove(dataKeyPath); err != nil {
		t.Fatalf("remove data key: %v", err)
	}
	if err := os.Symlink(outsideTarget, dataKeyPath); err != nil {
		t.Fatalf("create data key symlink: %v", err)
	}

	var stdout bytes.Buffer
	var stderr bytes.Buffer
	err := Run(context.Background(), snapshotArgs("restore", dbPath, dataKeyPath, snapshotDir), &stdout, &stderr)
	if err == nil || !strings.Contains(err.Error(), "not a regular file") {
		t.Fatalf("err=%v", err)
	}
	info, err := os.Lstat(dataKeyPath)
	if err != nil || info.Mode()&os.ModeSymlink == 0 {
		t.Fatalf("data key symlink was replaced: info=%v err=%v", info, err)
	}
	requireTestFile(t, outsideTarget, "outside-content")
	requireTestFile(t, dbPath, "database-after")
	requireNoRestoreTempFiles(t, dataDir)
}

func TestRunRestoreCompletesCommitAfterCancellationDuringSwitch(t *testing.T) {
	dataDir := t.TempDir()
	dbPath := filepath.Join(dataDir, "usage.sqlite")
	dataKeyPath := filepath.Join(dataDir, "data.key")
	snapshotDir := filepath.Join(dataDir, ".cpamp-manager-snapshot-test")
	writeTestFile(t, dbPath, "database-before", 0o600)
	writeTestFile(t, dataKeyPath, "key-before", 0o600)
	runSnapshotCommand(t, "create", dbPath, dataKeyPath, snapshotDir)
	writeTestFile(t, dbPath, "database-after", 0o600)
	writeTestFile(t, dataKeyPath, "key-after", 0o600)

	ctx, cancel := context.WithCancel(context.Background())
	previous := renameFn
	canceled := false
	renameFn = func(from string, to string) error {
		err := os.Rename(from, to)
		if err == nil && !canceled {
			canceled = true
			cancel()
		}
		return err
	}
	t.Cleanup(func() {
		renameFn = previous
		cancel()
	})

	var stdout bytes.Buffer
	var stderr bytes.Buffer
	if err := Run(ctx, snapshotArgs("restore", dbPath, dataKeyPath, snapshotDir), &stdout, &stderr); err != nil {
		t.Fatalf("restore after commit-boundary cancellation: %v stderr=%s", err, stderr.String())
	}
	if !canceled || !errors.Is(ctx.Err(), context.Canceled) {
		t.Fatalf("commit cancellation was not injected: canceled=%v err=%v", canceled, ctx.Err())
	}
	requireTestFile(t, dbPath, "database-before")
	requireTestFile(t, dataKeyPath, "key-before")
	requireNoRestoreTempFiles(t, dataDir)
}

func TestManagerDataSnapshotSignalHelperProcess(t *testing.T) {
	mode := os.Getenv("CPA_MANAGER_SNAPSHOT_SIGNAL_HELPER")
	if mode == "" {
		t.Skip("helper process only")
	}
	dbPath := os.Getenv("CPA_MANAGER_SNAPSHOT_SIGNAL_DB")
	dataKeyPath := os.Getenv("CPA_MANAGER_SNAPSHOT_SIGNAL_DATA_KEY")
	snapshotDir := os.Getenv("CPA_MANAGER_SNAPSHOT_SIGNAL_DIR")
	markerPath := os.Getenv("CPA_MANAGER_SNAPSHOT_SIGNAL_MARKER")
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()
	waitForSignal := func() {
		if err := os.WriteFile(markerPath, []byte("ready\n"), 0o600); err != nil {
			t.Fatalf("write signal marker: %v", err)
		}
		<-ctx.Done()
	}
	switch mode {
	case "create":
		beforeSnapshotPublishFn = waitForSignal
	case "restore":
		beforeRestoreCommitFn = waitForSignal
	default:
		t.Fatalf("unsupported helper mode %q", mode)
	}
	var stdout bytes.Buffer
	var stderr bytes.Buffer
	err := Run(ctx, snapshotArgs(mode, dbPath, dataKeyPath, snapshotDir), &stdout, &stderr)
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("signal cancellation error=%v stdout=%s stderr=%s", err, stdout.String(), stderr.String())
	}
}

func TestManagerDataSnapshotSignalsCancelBeforeCommit(t *testing.T) {
	if os.PathSeparator == '\\' {
		t.Skip("POSIX process signals are required")
	}
	for _, mode := range []string{"create", "restore"} {
		t.Run(mode, func(t *testing.T) {
			dataDir := t.TempDir()
			dbPath := filepath.Join(dataDir, "usage.sqlite")
			dataKeyPath := filepath.Join(dataDir, "data.key")
			snapshotDir := filepath.Join(dataDir, ".cpamp-manager-snapshot-test")
			markerPath := filepath.Join(dataDir, "signal-ready")
			writeTestFile(t, dbPath, "database-before", 0o600)
			writeTestFile(t, dataKeyPath, "key-before", 0o600)
			if mode == "restore" {
				runSnapshotCommand(t, "create", dbPath, dataKeyPath, snapshotDir)
				writeTestFile(t, dbPath, "database-after", 0o600)
				writeTestFile(t, dataKeyPath, "key-after", 0o600)
			}

			cmd := exec.Command(os.Args[0], "-test.run=^TestManagerDataSnapshotSignalHelperProcess$")
			cmd.Env = append(os.Environ(),
				"CPA_MANAGER_SNAPSHOT_SIGNAL_HELPER="+mode,
				"CPA_MANAGER_SNAPSHOT_SIGNAL_DB="+dbPath,
				"CPA_MANAGER_SNAPSHOT_SIGNAL_DATA_KEY="+dataKeyPath,
				"CPA_MANAGER_SNAPSHOT_SIGNAL_DIR="+snapshotDir,
				"CPA_MANAGER_SNAPSHOT_SIGNAL_MARKER="+markerPath,
			)
			var output bytes.Buffer
			cmd.Stdout = &output
			cmd.Stderr = &output
			if err := cmd.Start(); err != nil {
				t.Fatalf("start signal helper: %v", err)
			}
			deadline := time.Now().Add(5 * time.Second)
			for {
				if _, err := os.Stat(markerPath); err == nil {
					break
				}
				if time.Now().After(deadline) {
					_ = cmd.Process.Kill()
					_ = cmd.Wait()
					t.Fatalf("signal helper did not reach boundary: %s", output.String())
				}
				time.Sleep(10 * time.Millisecond)
			}
			if err := cmd.Process.Signal(os.Interrupt); err != nil {
				_ = cmd.Process.Kill()
				_ = cmd.Wait()
				t.Fatalf("signal helper: %v", err)
			}
			if err := cmd.Wait(); err != nil {
				t.Fatalf("signal helper exit: %v\n%s", err, output.String())
			}

			if mode == "create" {
				if _, err := os.Stat(snapshotDir); !os.IsNotExist(err) {
					t.Fatalf("canceled create published a snapshot: %v", err)
				}
				requireTestFile(t, dbPath, "database-before")
				requireTestFile(t, dataKeyPath, "key-before")
			} else {
				requireTestFile(t, dbPath, "database-after")
				requireTestFile(t, dataKeyPath, "key-after")
				requireNoRestoreTempFiles(t, dataDir)
			}
		})
	}
}

func injectRestoreSwitchFailure(t testing.TB, failTarget string) {
	t.Helper()
	previous := renameFn
	renameFn = func(from string, to string) error {
		if to == failTarget {
			return errors.New("injected data-key switch failure")
		}
		return os.Rename(from, to)
	}
	t.Cleanup(func() { renameFn = previous })
}

func requireNoRestoreTempFiles(t testing.TB, dir string) {
	t.Helper()
	for _, pattern := range []string{".cpamp-restore-*", ".cpamp-restore-rollback-*"} {
		matches, err := filepath.Glob(filepath.Join(dir, pattern))
		if err != nil || len(matches) != 0 {
			t.Fatalf("leftover %s files=%v err=%v", pattern, matches, err)
		}
	}
}

func runSnapshotCommand(t testing.TB, action string, dbPath string, dataKeyPath string, snapshotDir string) {
	t.Helper()
	var stdout bytes.Buffer
	var stderr bytes.Buffer
	if err := Run(context.Background(), snapshotArgs(action, dbPath, dataKeyPath, snapshotDir), &stdout, &stderr); err != nil {
		t.Fatalf("run %s: %v stderr=%s", action, err, stderr.String())
	}
}

func snapshotArgs(action string, dbPath string, dataKeyPath string, snapshotDir string) []string {
	args := []string{action, "--snapshot-dir", snapshotDir}
	if action != "delete" {
		args = append(args, "--db-path", dbPath, "--data-key-path", dataKeyPath)
	}
	return args
}

func writeTestFile(t testing.TB, path string, value string, mode os.FileMode) {
	t.Helper()
	if err := os.WriteFile(path, []byte(value), mode); err != nil {
		t.Fatalf("write %s: %v", path, err)
	}
	if err := os.Chmod(path, mode); err != nil {
		t.Fatalf("chmod %s: %v", path, err)
	}
}

func requireTestFile(t testing.TB, path string, expected string) {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	if string(data) != expected {
		t.Fatalf("%s=%q want %q", path, data, expected)
	}
}
