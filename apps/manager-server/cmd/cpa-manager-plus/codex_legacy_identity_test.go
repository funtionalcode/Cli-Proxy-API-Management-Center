package main

import (
	"database/sql"
	"path/filepath"
	"testing"
	"time"

	sqliterepo "github.com/seakee/cpa-manager-plus/apps/manager-server/internal/repository/sqlite"
)

func TestCodexLegacyIdentityBackfillServesHTTPBeforeCompletionAndResumes(t *testing.T) {
	if raceDetectorEnabled {
		t.Skip("100k external-process migration timing is verified by the normal suite")
	}
	const rowCount int64 = 100_001
	tempDir := t.TempDir()
	dbPath := filepath.Join(tempDir, "usage.sqlite")
	db, err := sqliterepo.Open(dbPath)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`with recursive ids(id) as (
		select 1 union all select id + 1 from ids where id < ?
	) insert into usage_events (
		id, event_hash, timestamp_ms, timestamp, model, created_at_ms,
		provider, auth_provider_snapshot, auth_file_snapshot, source,
		auth_index, auth_account_id_snapshot, account_snapshot, raw_json
	) select id, 'identity-' || id, id, cast(id as text), 'gpt-test', id,
		'codex', 'codex', 'codex-a.json', 'codex-a.json', 'auth-a',
		case when id <= ? then '' else 'account-a' end,
		'same@example.com', null from ids`, rowCount, rowCount/2); err != nil {
		_ = db.Close()
		t.Fatal(err)
	}
	// Reproduce an upgrade from a database that has no evidence derivation.
	if _, err := db.Exec("drop table usage_codex_legacy_identity_evidence_v1"); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec("delete from usage_monitoring_rollup_state where rollup_name = 'codex_legacy_identity_v1'"); err != nil {
		t.Fatal(err)
	}
	before := readUsageEventsSummaryFromDB(t, db)
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}

	first := startManagerServerProcess(t, tempDir, dbPath)
	firstStopped := false
	t.Cleanup(func() {
		if !firstStopped {
			first.stop(t)
		}
	})
	assertManagerEndpoint(t, first.addr, "/management.html")
	assertManagerEndpoint(t, first.addr, "/usage-service/info")
	assertManagerEndpoint(t, first.addr, "/health")
	observer := openMigrationObserver(t, dbPath)
	t.Cleanup(func() { _ = observer.Close() })
	initial := readCodexIdentityCoverage(t, observer)
	if initial >= rowCount {
		t.Fatalf("identity evidence completed before initial HTTP acceptance: %d", initial)
	}
	waitForCodexIdentityCoverage(t, observer, initial)
	first.stop(t)
	firstStopped = true
	checkpoint := readCodexIdentityCoverage(t, observer)
	if checkpoint <= 0 || checkpoint >= rowCount {
		t.Fatalf("interrupted identity coverage = %d", checkpoint)
	}
	if after := readUsageEventsSummaryFromDB(t, observer); after != before {
		t.Fatalf("identity backfill changed raw events: before=%+v after=%+v", before, after)
	}

	second := startManagerServerProcess(t, tempDir, dbPath)
	secondStopped := false
	t.Cleanup(func() {
		if !secondStopped {
			second.stop(t)
		}
	})
	assertManagerEndpoint(t, second.addr, "/management.html")
	assertManagerEndpoint(t, second.addr, "/usage-service/info")
	assertManagerEndpoint(t, second.addr, "/health")
	waitForCodexIdentityCoverage(t, observer, checkpoint)
	second.stop(t)
	secondStopped = true
	if after := readUsageEventsSummaryFromDB(t, observer); after != before {
		t.Fatalf("resumed identity backfill changed raw events: before=%+v after=%+v", before, after)
	}
}

func readCodexIdentityCoverage(t testing.TB, db *sql.DB) int64 {
	t.Helper()
	var coverage int64
	if err := db.QueryRow(`select coverage_event_id from usage_monitoring_rollup_state
		where rollup_name = 'codex_legacy_identity_v1'`).Scan(&coverage); err != nil {
		t.Fatal(err)
	}
	return coverage
}

func waitForCodexIdentityCoverage(t testing.TB, db *sql.DB, previous int64) {
	t.Helper()
	deadline := time.Now().Add(20 * time.Second)
	for time.Now().Before(deadline) {
		if readCodexIdentityCoverage(t, db) > previous {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatalf("identity evidence did not advance past %d", previous)
}
