package usagemonitoring

import (
	"context"
	"path/filepath"
	"testing"

	sqliterepo "github.com/seakee/cpa-manager-plus/apps/manager-server/internal/repository/sqlite"
	monitoringrepo "github.com/seakee/cpa-manager-plus/apps/manager-server/internal/repository/usagemonitoring"
	"github.com/seakee/cpa-manager-plus/apps/manager-server/internal/store"
)

func TestSupportsStatsFilterKeepsHighCardinalityFallbacksExplicit(t *testing.T) {
	base := store.AnalyticsFilter{
		FromMS:           1,
		ToMS:             2,
		Models:           []string{"gpt-a"},
		Providers:        []string{"codex"},
		Accounts:         []string{"alice@example.com"},
		CredentialIDs:    []string{"alice.json"},
		AuthFiles:        []string{"alice.json"},
		AuthIndices:      []string{"auth-a"},
		APIKeyHashes:     []string{"key-a"},
		SourceHashes:     []string{"source-a"},
		RequestTypes:     []string{"codex"},
		IncludeFailed:    true,
		SearchAPIKeyHash: "key-a",
	}
	if !SupportsStatsFilter(base) {
		t.Fatal("persisted monitoring dimensions unexpectedly rejected")
	}

	tests := []struct {
		name   string
		mutate func(*store.AnalyticsFilter)
	}{
		{name: "free text", mutate: func(filter *store.AnalyticsFilter) { filter.SearchQuery = "trace" }},
		{name: "project", mutate: func(filter *store.AnalyticsFilter) { filter.ProjectIDs = []string{"project-a"} }},
		{name: "header kind", mutate: func(filter *store.AnalyticsFilter) { filter.HeaderErrorKinds = []string{"quota"} }},
		{name: "header code", mutate: func(filter *store.AnalyticsFilter) { filter.HeaderErrorCodes = []string{"429"} }},
		{name: "quota plan", mutate: func(filter *store.AnalyticsFilter) { filter.HeaderQuotaPlans = []string{"pro"} }},
		{name: "trace", mutate: func(filter *store.AnalyticsFilter) { filter.HeaderTraceIDs = []string{"trace-a"} }},
		{name: "latency", mutate: func(filter *store.AnalyticsFilter) { filter.MinLatencyMS = 100 }},
		{name: "cache status", mutate: func(filter *store.AnalyticsFilter) { filter.CacheStatus = "hit" }},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			filter := base
			test.mutate(&filter)
			if SupportsStatsFilter(filter) {
				t.Fatalf("unsupported filter accepted: %#v", filter)
			}
		})
	}
}

func TestSupportsSelectorFilterRequiresUnscopedSelectorRequest(t *testing.T) {
	base := store.AnalyticsFilter{FromMS: 1, ToMS: 2, IncludeFailed: true}
	if !SupportsSelectorFilter(base) {
		t.Fatal("default selector request unexpectedly rejected")
	}
	base.SearchQuery = "alice"
	if SupportsSelectorFilter(base) {
		t.Fatal("searched selector request unexpectedly accepted")
	}
}

func TestEventProjectionPreferenceKeepsTimeOnlyPagesOnTimestampIndex(t *testing.T) {
	base := store.AnalyticsFilter{FromMS: 1, ToMS: 2, IncludeFailed: true}
	if monitoringrepo.PrefersEventProjection(base) {
		t.Fatal("time-only event request unexpectedly preferred the projection")
	}
	base.Models = []string{"gpt-a"}
	if !monitoringrepo.PrefersEventProjection(base) {
		t.Fatal("dimension-filtered event request did not prefer the projection")
	}
}

func TestAccountWindowStatsReturnsUnavailableForProjectionSchemaMismatch(t *testing.T) {
	ctx := context.Background()
	sqlDB, err := sqliterepo.Open(filepath.Join(t.TempDir(), "usage.sqlite"))
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	t.Cleanup(func() { _ = sqlDB.Close() })
	db := store.New(sqlDB)
	if _, err := sqlDB.ExecContext(ctx, `update usage_monitoring_rollup_state set schema_version = 0 where rollup_name = ?`, monitoringrepo.ProjectionRollupName); err != nil {
		t.Fatalf("invalidate projection state: %v", err)
	}

	rows, available := New(db).AccountWindowStats(ctx, []store.AccountWindowUsageQuery{{
		RequestIndex:     0,
		FromMS:           1,
		ToMS:             2,
		AuthFileSnapshot: "first.json",
		AuthIndex:        "auth-1",
	}})
	if available || rows != nil {
		t.Fatalf("account window projection rows = %#v available=%v", rows, available)
	}
}
