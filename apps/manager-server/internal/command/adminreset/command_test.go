package adminreset

import (
	"bytes"
	"context"
	"database/sql"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/seakee/cpa-manager-plus/apps/manager-server/internal/security"
	"github.com/seakee/cpa-manager-plus/apps/manager-server/internal/store"
)

func TestRunGeneratesAdminKey(t *testing.T) {
	dbPath := newCommandTestDB(t)
	var stdout bytes.Buffer
	var stderr bytes.Buffer

	if err := Run(context.Background(), []string{"--db-path", dbPath}, &stdout, &stderr); err != nil {
		t.Fatalf("run reset command: %v stderr=%s", err, stderr.String())
	}

	output := stdout.String()
	const marker = "New admin key: "
	index := strings.Index(output, marker)
	if index < 0 {
		t.Fatalf("output does not contain generated key: %s", output)
	}
	adminKey := strings.TrimSpace(strings.Split(output[index+len(marker):], "\n")[0])
	if !strings.HasPrefix(adminKey, "cpamp_") {
		t.Fatalf("generated key = %q", adminKey)
	}
	requireAdminKeyVerifies(t, dbPath, adminKey)
}

func TestRunUsesProvidedAdminKeyWithoutEchoingIt(t *testing.T) {
	dbPath := newCommandTestDB(t)
	const adminKey = "cpamp_from_cli"
	var stdout bytes.Buffer
	var stderr bytes.Buffer

	if err := Run(context.Background(), []string{"--db-path", dbPath, "--admin-key", adminKey}, &stdout, &stderr); err != nil {
		t.Fatalf("run reset command: %v stderr=%s", err, stderr.String())
	}

	if strings.Contains(stdout.String(), adminKey) {
		t.Fatalf("stdout leaked provided admin key: %s", stdout.String())
	}
	requireAdminKeyVerifies(t, dbPath, adminKey)
}

func TestRunRejectsMissingDB(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "missing.sqlite")
	var stdout bytes.Buffer
	var stderr bytes.Buffer

	err := Run(context.Background(), []string{"--db-path", dbPath}, &stdout, &stderr)
	if err == nil || !strings.Contains(err.Error(), "SQLite database not found") {
		t.Fatalf("err = %v", err)
	}
}

func TestRunRejectsEmptyDBFile(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "usage.sqlite")
	if err := os.WriteFile(dbPath, nil, 0o600); err != nil {
		t.Fatalf("write empty db file: %v", err)
	}
	var stdout bytes.Buffer
	var stderr bytes.Buffer

	err := Run(context.Background(), []string{"--db-path", dbPath}, &stdout, &stderr)
	if err == nil || !strings.Contains(err.Error(), "is empty") {
		t.Fatalf("err = %v", err)
	}
}

func TestRunRejectsUnrelatedSQLiteDBWithoutMigratingIt(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "usage.sqlite")
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		t.Fatalf("open unrelated sqlite: %v", err)
	}
	if _, err := db.Exec(`create table unrelated(id integer primary key)`); err != nil {
		t.Fatalf("create unrelated table: %v", err)
	}
	if err := db.Close(); err != nil {
		t.Fatalf("close unrelated sqlite: %v", err)
	}
	var stdout bytes.Buffer
	var stderr bytes.Buffer

	err = Run(context.Background(), []string{"--db-path", dbPath}, &stdout, &stderr)
	if err == nil || !strings.Contains(err.Error(), "does not look like a CPA Manager Plus") {
		t.Fatalf("err = %v", err)
	}
	requireNoManagerTables(t, dbPath)
}

func TestRunRejectsConflictingAdminKeyInputs(t *testing.T) {
	var stdout bytes.Buffer
	var stderr bytes.Buffer

	err := Run(context.Background(), []string{"--admin-key", "one", "--admin-key-file", "two"}, &stdout, &stderr)
	if err == nil || !strings.Contains(err.Error(), "cannot be used together") {
		t.Fatalf("err = %v", err)
	}
}

func newCommandTestDB(t testing.TB) string {
	t.Helper()
	dbPath := filepath.Join(t.TempDir(), "usage.sqlite")
	st, err := store.Open(dbPath)
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	credential, err := security.NewAdminCredential("cpamp_old", "test")
	if err != nil {
		t.Fatalf("create credential: %v", err)
	}
	if err := st.SaveAdminCredential(context.Background(), credential); err != nil {
		t.Fatalf("save credential: %v", err)
	}
	if err := st.Close(); err != nil {
		t.Fatalf("close store: %v", err)
	}
	return dbPath
}

func requireNoManagerTables(t testing.TB, dbPath string) {
	t.Helper()
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	defer db.Close()

	var count int
	if err := db.QueryRow(`select count(*) from sqlite_schema where type = 'table' and name in ('settings', 'usage_events')`).Scan(&count); err != nil {
		t.Fatalf("count manager tables: %v", err)
	}
	if count != 0 {
		t.Fatalf("manager table count = %d, want 0", count)
	}
}

func requireAdminKeyVerifies(t testing.TB, dbPath string, adminKey string) {
	t.Helper()
	st, err := store.Open(dbPath)
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	defer st.Close()

	credential, ok, err := st.LoadAdminCredential(context.Background())
	if err != nil || !ok {
		t.Fatalf("load credential ok=%v err=%v", ok, err)
	}
	if !security.VerifyAdminKey(credential, adminKey) {
		t.Fatalf("admin key %q does not verify", adminKey)
	}
}
