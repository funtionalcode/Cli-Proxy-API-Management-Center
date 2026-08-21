package usagerollup

import (
	"context"
	"path/filepath"
	"reflect"
	"testing"

	sqliterepo "github.com/seakee/cpa-manager-plus/apps/manager-server/internal/repository/sqlite"
	"github.com/seakee/cpa-manager-plus/apps/manager-server/internal/repository/usageevent"
	"github.com/seakee/cpa-manager-plus/apps/manager-server/internal/usage"
)

func TestCatchUpDashboardHourlyAggregatesByCheckpoint(t *testing.T) {
	db := newRollupTestDB(t)
	ctx := context.Background()
	events := usageevent.New(db)
	repo := New(db)
	baseMS := int64(1_700_000_000_000)
	firstHour := baseMS - baseMS%dashboardHourMS
	latency100 := int64(100)
	latency200 := int64(200)

	first := rollupTestEvent("dashboard-hourly-1", firstHour+1_000, "alias-a", "resolved-a", "alice@example.com", "", "auth-a", false, 100, 50, 10, 40, 10, 5, 165)
	first.LatencyMS = &latency100
	zero := rollupTestEvent("dashboard-hourly-zero", firstHour+2_000, "alias-a", "resolved-a", "alice@example.com", "", "auth-a", false, 0, 0, 0, 0, 0, 0, 0)
	failed := rollupTestEvent("dashboard-hourly-failed", firstHour+3_000, "alias-a", "resolved-a", "alice@example.com", "", "auth-a", true, 1, 2, 0, 0, 0, 0, 3)
	failed.LatencyMS = &latency200
	priority := rollupTestEvent("dashboard-hourly-priority", firstHour+dashboardHourMS+1_000, "alias-a", "resolved-a", "alice@example.com", "", "auth-a", false, 5, 6, 0, 0, 0, 0, 11)
	priority.ServiceTier = "priority"

	if _, err := events.InsertBatch(ctx, []usage.Event{first, zero, failed, priority}); err != nil {
		t.Fatalf("insert events: %v", err)
	}

	result, err := repo.CatchUpDashboardHourly(ctx, 2, baseMS+10_000)
	if err != nil {
		t.Fatalf("first catch-up: %v", err)
	}
	if result.Processed != 2 || !result.Pending {
		t.Fatalf("first catch-up = %#v", result)
	}
	result, err = repo.CatchUpDashboardHourly(ctx, 10, baseMS+11_000)
	if err != nil {
		t.Fatalf("second catch-up: %v", err)
	}
	if result.Processed != 2 || result.Pending || result.LastEventID != 4 {
		t.Fatalf("second catch-up = %#v", result)
	}
	result, err = repo.CatchUpDashboardHourly(ctx, 10, baseMS+12_000)
	if err != nil {
		t.Fatalf("third catch-up: %v", err)
	}
	if result.Processed != 0 || result.Pending {
		t.Fatalf("third catch-up = %#v", result)
	}

	rows, err := repo.DashboardHourlyRows(ctx, firstHour, firstHour+2*dashboardHourMS)
	if err != nil {
		t.Fatalf("query rows: %v", err)
	}
	if len(rows) != 2 {
		t.Fatalf("rows = %#v", rows)
	}
	standard := rows[0]
	if standard.BucketMS != firstHour || standard.Calls != 3 || standard.SuccessCalls != 2 || standard.FailureCalls != 1 {
		t.Fatalf("standard counts = %#v", standard)
	}
	if standard.InputTokens != 101 || standard.OutputTokens != 52 || standard.CachedTokens != 25 || standard.TotalTokens != 168 {
		t.Fatalf("standard tokens = %#v", standard)
	}
	if standard.LatencySumMS != 300 || standard.LatencySamples != 2 || standard.ZeroTokenCalls != 1 {
		t.Fatalf("standard latency/zero = %#v", standard)
	}
	if rows[1].BucketMS != firstHour+dashboardHourMS || rows[1].ServiceTier != "priority" || rows[1].Calls != 1 {
		t.Fatalf("priority row = %#v", rows[1])
	}

	modelRows, err := repo.DashboardHourlyModelRows(ctx, firstHour, firstHour+2*dashboardHourMS)
	if err != nil {
		t.Fatalf("query model projection: %v", err)
	}
	if len(modelRows) != 2 || modelRows[0].BucketMS != firstHour || modelRows[0].Calls != 3 || modelRows[1].Calls != 1 {
		t.Fatalf("model projection = %#v", modelRows)
	}

	dailyRows, err := repo.DashboardDailyRows(ctx, firstHour, firstHour+2*dashboardHourMS)
	if err != nil {
		t.Fatalf("query daily projection: %v", err)
	}
	dayMS := int64(24) * dashboardHourMS
	if len(dailyRows) != 2 || dailyRows[0].BucketMS != firstHour-firstHour%dayMS || dailyRows[0].Calls != 3 || dailyRows[1].Calls != 1 {
		t.Fatalf("daily projection = %#v", dailyRows)
	}

	checkpoint, err := repo.Checkpoint(ctx, DashboardHourlyCheckpointName)
	if err != nil {
		t.Fatalf("checkpoint: %v", err)
	}
	if checkpoint.LastEventID != 4 {
		t.Fatalf("checkpoint = %#v", checkpoint)
	}
}

func TestDashboardRowsRemainCompleteDuringRebuildAndRestart(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "dashboard-rebuild.sqlite")
	db, err := sqliterepo.Open(dbPath)
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	ctx := context.Background()
	events := usageevent.New(db)
	repo := New(db)
	baseMS := int64(1_700_000_000_000)
	firstHour := baseMS - baseMS%dashboardHourMS
	latency100 := int64(100)
	latency200 := int64(200)

	first := rollupTestEvent("dashboard-fallback-1", firstHour+1_000, "model-a", "resolved-a", "alice@example.com", "", "auth-a", false, 272_001, 30, 5, 100, 20, 10, 272_036)
	first.LatencyMS = &latency100
	second := rollupTestEvent("dashboard-fallback-2", firstHour+2_000, "model-a", "resolved-a", "alice@example.com", "", "auth-a", true, 10, 20, 3, 0, 0, 0, 33)
	second.LatencyMS = &latency200
	third := rollupTestEvent("dashboard-fallback-3", firstHour+dashboardHourMS+1_000, "model-a", "resolved-a", "alice@example.com", "", "auth-a", false, 0, 0, 0, 0, 0, 0, 0)
	fourth := rollupTestEvent("dashboard-fallback-4", firstHour+dashboardHourMS+2_000, "model-b", "resolved-b", "alice@example.com", "", "auth-a", false, 7, 8, 1, 0, 0, 0, 16)
	fourth.ServiceTier = "priority"
	if _, err := events.InsertBatch(ctx, []usage.Event{first, second, third, fourth}); err != nil {
		t.Fatalf("insert rebuild fixtures: %v", err)
	}
	if _, err := db.Exec(`delete from usage_dashboard_hourly_rollups`); err != nil {
		t.Fatalf("clear dashboard rollups: %v", err)
	}
	scheduleRollupRebuildForTest(t, db, DashboardHourlyCheckpointName, 4)

	toMS := firstHour + 2*dashboardHourMS
	expectedHourly, err := repo.DashboardHourlyRows(ctx, firstHour, toMS)
	if err != nil {
		t.Fatalf("read raw-backed hourly rows: %v", err)
	}
	expectedModel, err := repo.DashboardHourlyModelRows(ctx, firstHour, toMS)
	if err != nil {
		t.Fatalf("read raw-backed model rows: %v", err)
	}
	expectedDaily, err := repo.DashboardDailyRows(ctx, firstHour, toMS)
	if err != nil {
		t.Fatalf("read raw-backed daily rows: %v", err)
	}
	if len(expectedHourly) != 3 || len(expectedModel) != 2 || len(expectedDaily) != 2 {
		t.Fatalf("raw-backed projection sizes = hourly:%#v model:%#v daily:%#v", expectedHourly, expectedModel, expectedDaily)
	}
	firstHourRow := expectedHourly[0]
	if firstHourRow.Model != "model-a" || firstHourRow.Calls != 2 || firstHourRow.SuccessCalls != 1 || firstHourRow.FailureCalls != 1 ||
		firstHourRow.CachedTokens != 70 || firstHourRow.LongInputTokens != 272_001 || firstHourRow.LongCachedTokens != 70 ||
		firstHourRow.LatencySumMS != 300 || firstHourRow.LatencySamples != 2 || firstHourRow.ZeroTokenCalls != 0 {
		t.Fatalf("raw-backed first-hour row = %#v", firstHourRow)
	}
	modelA := expectedModel[0]
	if modelA.Model != "model-a" || modelA.BucketMS != firstHour || modelA.Calls != 3 || modelA.ZeroTokenCalls != 1 ||
		modelA.LatencySumMS != 300 || modelA.LatencySamples != 2 {
		t.Fatalf("raw-backed model projection = %#v", modelA)
	}

	firstBatch, err := repo.CatchUpDashboardHourly(ctx, 1, baseMS+10_000)
	if err != nil {
		t.Fatalf("first rebuild batch: %v", err)
	}
	if !firstBatch.Rebuilt || !firstBatch.Pending || firstBatch.LastEventID != 1 {
		t.Fatalf("first rebuild batch = %#v", firstBatch)
	}
	assertDashboardProjectionsEquivalent(t, repo, ctx, firstHour, toMS, expectedHourly, expectedModel, expectedDaily)

	if err := db.Close(); err != nil {
		t.Fatalf("close interrupted database: %v", err)
	}
	db, err = sqliterepo.Open(dbPath)
	if err != nil {
		t.Fatalf("reopen interrupted database: %v", err)
	}
	repo = New(db)
	assertDashboardProjectionsEquivalent(t, repo, ctx, firstHour, toMS, expectedHourly, expectedModel, expectedDaily)

	for attempt := 0; attempt < 5; attempt++ {
		result, err := repo.CatchUpDashboardHourly(ctx, 1, baseMS+20_000+int64(attempt))
		if err != nil {
			t.Fatalf("resume rebuild batch %d: %v", attempt, err)
		}
		if !result.Pending {
			break
		}
	}
	assertDashboardProjectionsEquivalent(t, repo, ctx, firstHour, toMS, expectedHourly, expectedModel, expectedDaily)
}

func TestCatchUpDashboardHourlyPreservesDimensionStrings(t *testing.T) {
	db := newRollupTestDB(t)
	ctx := context.Background()
	events := usageevent.New(db)
	repo := New(db)
	baseMS := int64(1_700_000_000_000)
	hourMS := baseMS - baseMS%dashboardHourMS

	empty := rollupTestEvent("dashboard-empty-model", hourMS+1_000, "", "", "", "", "auth-empty", false, 1, 2, 0, 0, 0, 0, 3)
	dash := rollupTestEvent("dashboard-dash-model", hourMS+2_000, "-", "", "", "", "auth-dash", false, 2, 3, 0, 0, 0, 0, 5)
	padded := rollupTestEvent("dashboard-padded-model", hourMS+3_000, " model ", " resolved ", "", "", "auth-padded", false, 3, 4, 0, 0, 0, 0, 7)
	padded.ServiceTier = " priority "
	if _, err := events.InsertBatch(ctx, []usage.Event{empty, dash, padded}); err != nil {
		t.Fatalf("insert events: %v", err)
	}
	if _, err := repo.CatchUpDashboardHourly(ctx, 10, baseMS+10_000); err != nil {
		t.Fatalf("catch up dashboard hourly: %v", err)
	}

	rows, err := repo.DashboardHourlyRows(ctx, hourMS, hourMS+dashboardHourMS)
	if err != nil {
		t.Fatalf("query dashboard hourly rows: %v", err)
	}
	if len(rows) != 3 {
		t.Fatalf("rows = %#v, want 3 dimension-preserving rows", rows)
	}
	byModel := make(map[string]DashboardHourlyRow, len(rows))
	for _, row := range rows {
		byModel[row.Model] = row
	}
	if row, ok := byModel[""]; !ok || row.BillingModel != "" || row.ServiceTier != "" || row.Calls != 1 {
		t.Fatalf("empty model row = %#v, present=%v", row, ok)
	}
	if row, ok := byModel["-"]; !ok || row.BillingModel != "-" || row.ServiceTier != "" || row.Calls != 1 {
		t.Fatalf("literal dash row = %#v, present=%v", row, ok)
	}
	if row, ok := byModel[" model "]; !ok || row.BillingModel != " resolved " || row.ServiceTier != " priority " || row.Calls != 1 {
		t.Fatalf("padded model row = %#v, present=%v", row, ok)
	}
}

func TestCatchUpDashboardHourlyUsesAnalyticsModel(t *testing.T) {
	db := newRollupTestDB(t)
	ctx := context.Background()
	events := usageevent.New(db)
	repo := New(db)
	baseMS := int64(1_700_000_000_000)
	hourMS := baseMS - baseMS%dashboardHourMS
	low := rollupTestEvent("dashboard-canonical-low", hourMS+1_000, "deepseek-v4-flash(low)", "resolved-model", "", "", "auth-a", false, 1, 2, 0, 0, 0, 0, 3)
	max := rollupTestEvent("dashboard-canonical-max", hourMS+2_000, "deepseek-v4-flash(max)", "resolved-model", "", "", "auth-a", false, 4, 5, 0, 0, 0, 0, 9)
	unknown := rollupTestEvent("dashboard-canonical-unknown", hourMS+3_000, "deepseek-v4-flash(region-us)", "resolved-model", "", "", "auth-a", false, 6, 7, 0, 0, 0, 0, 13)
	if _, err := events.InsertBatch(ctx, []usage.Event{low, max, unknown}); err != nil {
		t.Fatalf("insert events: %v", err)
	}
	if _, err := repo.CatchUpDashboardHourly(ctx, 10, baseMS+10_000); err != nil {
		t.Fatalf("catch up: %v", err)
	}
	rows, err := repo.DashboardHourlyRows(ctx, hourMS, hourMS+dashboardHourMS)
	if err != nil {
		t.Fatalf("query rows: %v", err)
	}
	if len(rows) != 2 {
		t.Fatalf("rows = %#v, want canonical and unknown rows", rows)
	}
	byModel := make(map[string]DashboardHourlyRow, len(rows))
	for _, row := range rows {
		byModel[row.Model] = row
	}
	if byModel["deepseek-v4-flash"].Calls != 2 || byModel["deepseek-v4-flash"].TotalTokens != 12 {
		t.Fatalf("canonical row = %#v", byModel["deepseek-v4-flash"])
	}
	if byModel["deepseek-v4-flash(region-us)"].Calls != 1 {
		t.Fatalf("unknown row = %#v", byModel["deepseek-v4-flash(region-us)"])
	}
}

func TestCatchUpDashboardHourlyFailureDoesNotAdvanceCheckpoint(t *testing.T) {
	db := newRollupTestDB(t)
	ctx := context.Background()
	events := usageevent.New(db)
	repo := New(db)

	if _, err := events.InsertBatch(ctx, []usage.Event{
		rollupTestEvent("dashboard-hourly-failure", 1_700_000_001_000, "gpt-a", "", "alice@example.com", "", "auth-a", false, 1, 1, 0, 0, 0, 0, 2),
	}); err != nil {
		t.Fatalf("insert events: %v", err)
	}
	if _, err := db.Exec(`drop table usage_dashboard_hourly_rollups`); err != nil {
		t.Fatalf("drop table: %v", err)
	}
	if _, err := repo.CatchUpDashboardHourly(ctx, 10, 1_700_000_010_000); err == nil {
		t.Fatalf("expected catch-up to fail")
	}
	checkpoint, err := repo.Checkpoint(ctx, DashboardHourlyCheckpointName)
	if err != nil {
		t.Fatalf("checkpoint: %v", err)
	}
	if checkpoint.LastEventID != 0 {
		t.Fatalf("checkpoint advanced after failure: %#v", checkpoint)
	}
}

func assertDashboardProjectionsEquivalent(
	t *testing.T,
	repo Repository,
	ctx context.Context,
	fromMS int64,
	toMS int64,
	wantHourly []DashboardHourlyRow,
	wantModel []DashboardHourlyRow,
	wantDaily []DashboardHourlyRow,
) {
	t.Helper()
	hourly, err := repo.DashboardHourlyRows(ctx, fromMS, toMS)
	if err != nil {
		t.Fatalf("read hourly projection: %v", err)
	}
	modelRows, err := repo.DashboardHourlyModelRows(ctx, fromMS, toMS)
	if err != nil {
		t.Fatalf("read model projection: %v", err)
	}
	daily, err := repo.DashboardDailyRows(ctx, fromMS, toMS)
	if err != nil {
		t.Fatalf("read daily projection: %v", err)
	}
	assertEquivalentDashboardRows(t, hourly, wantHourly)
	assertEquivalentDashboardRows(t, modelRows, wantModel)
	assertEquivalentDashboardRows(t, daily, wantDaily)
}

func assertEquivalentDashboardRows(t *testing.T, got, want []DashboardHourlyRow) {
	t.Helper()
	got = append([]DashboardHourlyRow(nil), got...)
	want = append([]DashboardHourlyRow(nil), want...)
	for index := range got {
		got[index].UpdatedAtMS = 0
	}
	for index := range want {
		want[index].UpdatedAtMS = 0
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("dashboard rows = %#v, want %#v", got, want)
	}
}
