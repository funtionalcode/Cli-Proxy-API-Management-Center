package worker

import (
	"context"
	"path/filepath"
	"strings"
	"testing"

	sqliterepo "github.com/seakee/cpa-manager-plus/apps/manager-server/internal/repository/sqlite"
	"github.com/seakee/cpa-manager-plus/apps/manager-server/internal/store"
	"github.com/seakee/cpa-manager-plus/apps/manager-server/internal/usage"
)

func TestAccountHistoryRollupWorkerLogsOnlyMigrationRebuilds(t *testing.T) {
	sqlDB, err := sqliterepo.Open(filepath.Join(t.TempDir(), "usage.sqlite"))
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() { _ = sqlDB.Close() })
	db := store.New(sqlDB)
	ctx := context.Background()
	event := func(hash string, timestampMS int64) usage.Event {
		value := usageHourlyAggregateWorkerEvent(hash, timestampMS, 1)
		value.AccountSnapshot = "team-a"
		value.AuthFileSnapshot = "team-a.json"
		value.AuthProviderSnapshot = "openai"
		value.AuthIndex = "auth-team-a"
		return value
	}
	if _, err := db.InsertEvents(ctx, []usage.Event{event("account-history-prime", 1_800_000_001_000)}); err != nil {
		t.Fatalf("insert prime event: %v", err)
	}
	if _, err := db.CatchUpAccountHistoryRollups(ctx, 10, 10_000); err != nil {
		t.Fatalf("prime account history: %v", err)
	}

	logs := captureWorkerLogs(t)
	if _, err := db.InsertEvents(ctx, []usage.Event{
		event("account-history-incremental-1", 1_800_000_002_000),
		event("account-history-incremental-2", 1_800_000_003_000),
	}); err != nil {
		t.Fatalf("insert incremental events: %v", err)
	}
	worker := NewAccountHistoryRollupWorker(db)
	worker.batchLimit = 1
	worker.maxBatches = 2
	worker.catchUp(ctx)
	if output := logs.String(); strings.Contains(output, "account history rebuild") {
		t.Fatalf("incremental catch-up emitted rebuild logs:\n%s", output)
	}

	for _, statement := range []string{
		`delete from usage_account_model_rollups`,
		`delete from usage_rollup_checkpoints where name = 'account_history'`,
		`insert into usage_rollup_rebuild_state (name, target_event_id, updated_at_ms)
			values ('account_history', (select coalesce(max(id), 0) from usage_events), 0)
			on conflict(name) do update set target_event_id = excluded.target_event_id, updated_at_ms = 0`,
	} {
		if _, err := sqlDB.Exec(statement); err != nil {
			t.Fatalf("prepare rebuild fixture: %v", err)
		}
	}
	logs.Reset()
	rebuildWorker := NewAccountHistoryRollupWorker(db)
	rebuildWorker.batchLimit = 1
	rebuildWorker.maxBatches = 10
	rebuildWorker.catchUp(ctx)
	output := logs.String()
	for _, fragment := range []string{
		"account history rebuild started",
		"account history rebuild progress",
		"account history rebuild completed",
	} {
		if !strings.Contains(output, fragment) {
			t.Fatalf("rebuild logs missing %q:\n%s", fragment, output)
		}
	}
}
