package sqlite

import (
	"context"
	"database/sql"
	"net/url"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"
)

func TestWALMaintenanceDefaultsAndDataSource(t *testing.T) {
	_, dbPath := openWALMaintenanceTestDB(t)
	maintenance, err := NewWALMaintenance(dbPath)
	if err != nil {
		t.Fatalf("create WAL maintenance: %v", err)
	}
	t.Cleanup(func() {
		_ = maintenance.Close()
	})

	if maintenance.options.interval != 30*time.Second {
		t.Fatalf("interval = %s, want 30s", maintenance.options.interval)
	}
	if maintenance.options.operationTimeout != 10*time.Minute {
		t.Fatalf("operation timeout = %s, want 10m", maintenance.options.operationTimeout)
	}
	if maintenance.options.truncateAttemptInterval != 5*time.Minute {
		t.Fatalf("truncate attempt interval = %s, want 5m", maintenance.options.truncateAttemptInterval)
	}
	if maintenance.options.truncateThresholdBytes != 256<<20 {
		t.Fatalf("truncate threshold = %d, want %d", maintenance.options.truncateThresholdBytes, 256<<20)
	}

	dsn := walMaintenanceDataSourceName("C:/CPA Manager/data/usage ? #.sqlite")
	parsed, err := url.Parse(dsn)
	if err != nil {
		t.Fatalf("parse WAL maintenance data source: %v", err)
	}
	if parsed.Path != "/C:/CPA Manager/data/usage ? #.sqlite" {
		t.Fatalf("path = %q", parsed.Path)
	}
	if parsed.Query().Get("mode") != "rw" {
		t.Fatalf("mode = %q, want rw", parsed.Query().Get("mode"))
	}
	wantPragmas := []string{"busy_timeout(250)", "synchronous(FULL)"}
	if pragmas := parsed.Query()["_pragma"]; !slices.Equal(pragmas, wantPragmas) {
		t.Fatalf("pragmas = %q, want %q", pragmas, wantPragmas)
	}
}

func TestWALCheckpointCaughtUpRequiresValidNonBusyProgress(t *testing.T) {
	tests := []struct {
		name       string
		checkpoint WALCheckpointSnapshot
		want       bool
	}{
		{
			name:       "empty WAL",
			checkpoint: WALCheckpointSnapshot{LogFrames: 0, CheckpointedFrames: 0},
			want:       true,
		},
		{
			name:       "fully checkpointed",
			checkpoint: WALCheckpointSnapshot{LogFrames: 24, CheckpointedFrames: 24},
			want:       true,
		},
		{
			name:       "reader tail remains",
			checkpoint: WALCheckpointSnapshot{LogFrames: 24, CheckpointedFrames: 20},
		},
		{
			name:       "checkpoint lock busy",
			checkpoint: WALCheckpointSnapshot{Busy: 1, LogFrames: 24, CheckpointedFrames: 24},
		},
		{
			name:       "progress unavailable",
			checkpoint: WALCheckpointSnapshot{LogFrames: -1, CheckpointedFrames: -1},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := walCheckpointCaughtUp(test.checkpoint); got != test.want {
				t.Fatalf("walCheckpointCaughtUp(%#v) = %v, want %v", test.checkpoint, got, test.want)
			}
		})
	}
}

func TestWALMaintenanceCollectsPassiveCheckpointAndFileSizesOnIndependentConnection(t *testing.T) {
	db, dbPath := openWALMaintenanceTestDB(t)
	businessConn, err := db.Conn(context.Background())
	if err != nil {
		t.Fatalf("hold business connection: %v", err)
	}
	defer businessConn.Close()

	maintenance, err := NewWALMaintenance(dbPath)
	if err != nil {
		t.Fatalf("create WAL maintenance: %v", err)
	}
	t.Cleanup(func() {
		_ = maintenance.Close()
	})

	maintenance.runOnce(context.Background())
	snapshot := maintenance.Snapshot()
	if snapshot.Checkpoint.Error != "" {
		t.Fatalf("checkpoint error = %q", snapshot.Checkpoint.Error)
	}
	if snapshot.Checkpoint.Mode != WALCheckpointModePassive {
		t.Fatalf("checkpoint mode = %q, want passive", snapshot.Checkpoint.Mode)
	}
	if snapshot.Checkpoint.ExecutedAtMS <= 0 {
		t.Fatalf("checkpoint execution time = %d", snapshot.Checkpoint.ExecutedAtMS)
	}
	if snapshot.Checkpoint.LogFrames <= 0 || snapshot.Checkpoint.CheckpointedFrames != snapshot.Checkpoint.LogFrames {
		t.Fatalf(
			"checkpoint frames = %d/%d, want positive and caught up",
			snapshot.Checkpoint.CheckpointedFrames,
			snapshot.Checkpoint.LogFrames,
		)
	}
	if snapshot.DatabaseBytes <= 0 || snapshot.WALBytes <= 0 || snapshot.SHMBytes <= 0 {
		t.Fatalf("database file sizes = %#v", snapshot)
	}
	if snapshot.TotalBytes != snapshot.DatabaseBytes+snapshot.WALBytes+snapshot.SHMBytes {
		t.Fatalf("total bytes = %d, want file sum", snapshot.TotalBytes)
	}
	if snapshot.JournalSizeLimitBytes != WALJournalSizeLimitBytes {
		t.Fatalf("journal size limit = %d", snapshot.JournalSizeLimitBytes)
	}
	if stats := maintenance.db.Stats(); stats.MaxOpenConnections != 1 {
		t.Fatalf("maintenance MaxOpenConnections = %d, want 1", stats.MaxOpenConnections)
	}
	var appliedLimit int64
	if err := maintenance.db.QueryRow(`pragma journal_size_limit`).Scan(&appliedLimit); err != nil {
		t.Fatalf("read journal size limit: %v", err)
	}
	if appliedLimit != WALJournalSizeLimitBytes {
		t.Fatalf("applied journal size limit = %d, want %d", appliedLimit, WALJournalSizeLimitBytes)
	}
}

func TestWALMaintenanceTruncatesWithIdleCheckedOutConnectionAndThrottlesAttempts(t *testing.T) {
	db, dbPath := openWALMaintenanceTestDB(t)
	now := time.Date(2026, time.August, 6, 12, 0, 0, 0, time.UTC)
	maintenance, err := newWALMaintenance(dbPath, walMaintenanceOptions{
		truncateThresholdBytes: 1,
		now:                    func() time.Time { return now },
	})
	if err != nil {
		t.Fatalf("create WAL maintenance: %v", err)
	}
	t.Cleanup(func() {
		_ = maintenance.Close()
	})

	businessConn, err := db.Conn(context.Background())
	if err != nil {
		t.Fatalf("hold business connection: %v", err)
	}
	defer businessConn.Close()

	firstAttempt := now
	maintenance.runOnce(context.Background())
	truncated := maintenance.Snapshot()
	if truncated.Checkpoint.Error != "" {
		t.Fatalf("truncate checkpoint error = %q", truncated.Checkpoint.Error)
	}
	if truncated.Checkpoint.Mode != WALCheckpointModeTruncate {
		t.Fatalf("checkpoint mode = %q, want truncate", truncated.Checkpoint.Mode)
	}
	if truncated.Checkpoint.LastTruncateAttemptAtMS != firstAttempt.UnixMilli() {
		t.Fatalf("truncate attempt time = %d, want %d", truncated.Checkpoint.LastTruncateAttemptAtMS, firstAttempt.UnixMilli())
	}
	if truncated.WALBytes != 0 {
		t.Fatalf("WAL bytes after truncate = %d, want 0", truncated.WALBytes)
	}

	appendWALMaintenanceRows(t, businessConn, 16)
	now = firstAttempt.Add(time.Minute)
	maintenance.runOnce(context.Background())
	throttled := maintenance.Snapshot()
	if throttled.Checkpoint.Error != "" {
		t.Fatalf("throttled checkpoint error = %q", throttled.Checkpoint.Error)
	}
	if throttled.Checkpoint.Mode != WALCheckpointModePassive {
		t.Fatalf("throttled checkpoint mode = %q, want passive", throttled.Checkpoint.Mode)
	}
	if throttled.Checkpoint.LastTruncateAttemptAtMS != firstAttempt.UnixMilli() {
		t.Fatalf("throttled attempt time = %d, want unchanged %d", throttled.Checkpoint.LastTruncateAttemptAtMS, firstAttempt.UnixMilli())
	}
	if throttled.WALBytes <= 1 {
		t.Fatalf("throttled WAL bytes = %d, want above threshold", throttled.WALBytes)
	}

	now = firstAttempt.Add(5 * time.Minute)
	maintenance.runOnce(context.Background())
	retried := maintenance.Snapshot()
	if retried.Checkpoint.Error != "" {
		t.Fatalf("retried checkpoint error = %q", retried.Checkpoint.Error)
	}
	if retried.Checkpoint.Mode != WALCheckpointModeTruncate {
		t.Fatalf("retried checkpoint mode = %q, want truncate", retried.Checkpoint.Mode)
	}
	if retried.Checkpoint.LastTruncateAttemptAtMS != now.UnixMilli() {
		t.Fatalf("retried attempt time = %d, want %d", retried.Checkpoint.LastTruncateAttemptAtMS, now.UnixMilli())
	}
}

func TestWALMaintenanceWaitsForExternalLongReadBeforeTruncate(t *testing.T) {
	db, dbPath := openWALMaintenanceTestDB(t)
	now := time.Date(2026, time.August, 6, 13, 0, 0, 0, time.UTC)
	maintenance, err := newWALMaintenance(dbPath, walMaintenanceOptions{
		truncateThresholdBytes: 1,
		now:                    func() time.Time { return now },
	})
	if err != nil {
		t.Fatalf("create WAL maintenance: %v", err)
	}
	t.Cleanup(func() {
		_ = maintenance.Close()
	})

	readerDB, err := sql.Open("sqlite", walMaintenanceDataSourceName(dbPath))
	if err != nil {
		t.Fatalf("open external reader: %v", err)
	}
	readerDB.SetMaxOpenConns(1)
	readerDB.SetMaxIdleConns(1)
	t.Cleanup(func() {
		_ = readerDB.Close()
	})
	readerTx, err := readerDB.BeginTx(context.Background(), &sql.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("begin external read transaction: %v", err)
	}
	t.Cleanup(func() {
		_ = readerTx.Rollback()
	})
	var initialCount int
	if err := readerTx.QueryRow(`select count(*) from wal_maintenance_test`).Scan(&initialCount); err != nil {
		t.Fatalf("establish external read snapshot: %v", err)
	}

	appendWALMaintenanceRows(t, db, 16)
	if stats := db.Stats(); stats.InUse != 0 {
		t.Fatalf("business pool in use = %d, want external reader only", stats.InUse)
	}
	maintenance.runOnce(context.Background())
	blocked := maintenance.Snapshot()
	if blocked.Checkpoint.Error != "" {
		t.Fatalf("checkpoint with long reader error = %q", blocked.Checkpoint.Error)
	}
	if blocked.Checkpoint.Mode != WALCheckpointModePassive {
		t.Fatalf("checkpoint mode = %q, want passive while reader is active", blocked.Checkpoint.Mode)
	}
	if blocked.Checkpoint.LogFrames <= 0 || blocked.Checkpoint.CheckpointedFrames >= blocked.Checkpoint.LogFrames {
		t.Fatalf(
			"checkpoint frames = %d/%d, want long reader to leave an uncheckpointed tail",
			blocked.Checkpoint.CheckpointedFrames,
			blocked.Checkpoint.LogFrames,
		)
	}
	if blocked.Checkpoint.LastTruncateAttemptAtMS != 0 {
		t.Fatalf("truncate attempted while long reader was active at %d", blocked.Checkpoint.LastTruncateAttemptAtMS)
	}
	if blocked.WALBytes <= 1 {
		t.Fatalf("WAL bytes with long reader = %d, want above threshold", blocked.WALBytes)
	}

	if err := readerTx.Rollback(); err != nil {
		t.Fatalf("release external read transaction: %v", err)
	}
	now = now.Add(time.Second)
	maintenance.runOnce(context.Background())
	recovered := maintenance.Snapshot()
	if recovered.Checkpoint.Error != "" {
		t.Fatalf("checkpoint after reader release error = %q", recovered.Checkpoint.Error)
	}
	if recovered.Checkpoint.Mode != WALCheckpointModeTruncate {
		t.Fatalf("checkpoint mode after reader release = %q, want truncate", recovered.Checkpoint.Mode)
	}
	if recovered.Checkpoint.LastTruncateAttemptAtMS != now.UnixMilli() {
		t.Fatalf("truncate attempt time = %d, want %d", recovered.Checkpoint.LastTruncateAttemptAtMS, now.UnixMilli())
	}
	if recovered.WALBytes != 0 {
		t.Fatalf("WAL bytes after reader release = %d, want 0", recovered.WALBytes)
	}
}

func TestWALMaintenanceErrorDoesNotBreakBusinessDatabase(t *testing.T) {
	db, dbPath := openWALMaintenanceTestDB(t)
	maintenance, err := NewWALMaintenance(dbPath)
	if err != nil {
		t.Fatalf("create WAL maintenance: %v", err)
	}
	t.Cleanup(func() {
		_ = maintenance.Close()
	})

	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	maintenance.runOnce(ctx)
	if got := maintenance.Snapshot().Checkpoint.Error; !strings.Contains(got, context.Canceled.Error()) {
		t.Fatalf("checkpoint error = %q, want context canceled", got)
	}

	if _, err := db.Exec(`insert into wal_maintenance_test(payload) values ('business-still-works')`); err != nil {
		t.Fatalf("business insert after maintenance error: %v", err)
	}
	var count int
	if err := db.QueryRow(`select count(*) from wal_maintenance_test`).Scan(&count); err != nil {
		t.Fatalf("business query after maintenance error: %v", err)
	}
	if count <= 0 {
		t.Fatalf("business row count = %d", count)
	}
}

func openWALMaintenanceTestDB(t *testing.T) (*sql.DB, string) {
	t.Helper()
	dbPath := filepath.Join(t.TempDir(), "usage.sqlite")
	db, err := OpenWithOptions(Options{Path: dbPath, MaxOpenConns: 1, MaxIdleConns: 1})
	if err != nil {
		t.Fatalf("open SQLite fixture: %v", err)
	}
	t.Cleanup(func() {
		_ = db.Close()
	})
	if _, err := db.Exec(`pragma wal_autocheckpoint = 0`); err != nil {
		t.Fatalf("disable WAL autocheckpoint: %v", err)
	}
	if _, err := db.Exec(`create table wal_maintenance_test (
		id integer primary key autoincrement,
		payload blob not null
	)`); err != nil {
		t.Fatalf("create WAL maintenance fixture: %v", err)
	}
	appendWALMaintenanceRows(t, db, 16)
	if info, err := os.Stat(dbPath + "-wal"); err != nil || info.Size() <= 0 {
		t.Fatalf("WAL fixture size: info=%v err=%v", info, err)
	}
	return db, dbPath
}

type walMaintenanceTransactionBeginner interface {
	BeginTx(context.Context, *sql.TxOptions) (*sql.Tx, error)
}

func appendWALMaintenanceRows(t *testing.T, db walMaintenanceTransactionBeginner, count int) {
	t.Helper()
	tx, err := db.BeginTx(context.Background(), nil)
	if err != nil {
		t.Fatalf("begin WAL fixture transaction: %v", err)
	}
	for i := 0; i < count; i++ {
		if _, err := tx.Exec(`insert into wal_maintenance_test(payload) values (zeroblob(4096))`); err != nil {
			_ = tx.Rollback()
			t.Fatalf("insert WAL fixture row %d: %v", i, err)
		}
	}
	if err := tx.Commit(); err != nil {
		t.Fatalf("commit WAL fixture transaction: %v", err)
	}
}
