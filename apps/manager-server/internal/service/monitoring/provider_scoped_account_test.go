package monitoring

import (
	"context"
	"fmt"
	"slices"
	"testing"

	"github.com/seakee/cpa-manager-plus/apps/manager-server/internal/store"
	"github.com/seakee/cpa-manager-plus/apps/manager-server/internal/usage"
)

func TestAnalyticsAccountStatsUseProviderScopedLogicalAccountIdentity(t *testing.T) {
	db := newMonitoringTestStore(t)
	ctx := context.Background()
	fromMS := int64(1_778_025_000_000)
	toMS := fromMS + 60*60*1000
	events := make([]usage.Event, 0, 214)
	for index := range 197 {
		authIndex := "codex-auth-a"
		if index >= 100 {
			authIndex = "codex-auth-b"
		}
		event := monitoringEvent(
			fmt.Sprintf("provider-account-codex-%03d", index),
			fromMS+int64(index+1),
			"model-x",
			authIndex,
			"codex.json",
			false,
			10,
			5,
			0,
			0,
			15,
			nil,
		)
		event.AccountSnapshot = "same@example.com"
		event.AuthLabelSnapshot = "Shared Account"
		event.AuthProviderSnapshot = "codex"
		event.Provider = "codex"
		events = append(events, event)
	}
	for index := range 17 {
		event := monitoringEvent(
			fmt.Sprintf("provider-account-antigravity-%03d", index),
			fromMS+int64(1_000+index),
			"model-x",
			"antigravity-auth",
			"antigravity.json",
			false,
			20,
			10,
			0,
			0,
			30,
			nil,
		)
		event.AccountSnapshot = "same@example.com"
		event.AuthLabelSnapshot = "Shared Account"
		event.AuthProviderSnapshot = ""
		event.Provider = "antigravity"
		events = append(events, event)
	}
	if _, err := db.InsertEvents(ctx, events); err != nil {
		t.Fatalf("insert provider-scoped account events: %v", err)
	}

	run := func(t *testing.T, providers []string, wantProvider string, wantCalls int64) Response {
		t.Helper()
		resp, err := New(db).Analytics(ctx, Request{
			FromMS:  fromMS,
			ToMS:    toMS,
			Filters: Filters{Providers: providers},
			Include: Include{
				Summary:         true,
				AccountStats:    true,
				FilterOptions:   true,
				FilterSelectors: true,
			},
		})
		if err != nil {
			t.Fatalf("analytics providers=%v: %v", providers, err)
		}
		if resp.Summary == nil || resp.Summary.TotalCalls != wantCalls {
			t.Fatalf("summary providers=%v = %#v, want calls=%d", providers, resp.Summary, wantCalls)
		}
		if wantProvider != "" {
			if len(resp.AccountStats) != 1 {
				t.Fatalf("account stats providers=%v = %#v", providers, resp.AccountStats)
			}
			row := resp.AccountStats[0]
			if row.AuthProviderSnapshot != wantProvider || row.Calls != wantCalls || len(row.Models) != 1 || row.Models[0].Calls != wantCalls {
				t.Fatalf("account row providers=%v = %#v", providers, row)
			}
		}
		return resp
	}

	resp := run(t, nil, "", 214)
	if len(resp.AccountStats) != 2 {
		t.Fatalf("provider-scoped account stats = %#v, want two rows", resp.AccountStats)
	}
	byProvider := make(map[string]AccountStatRow, len(resp.AccountStats))
	for _, row := range resp.AccountStats {
		if _, exists := byProvider[row.AuthProviderSnapshot]; exists {
			t.Fatalf("duplicate provider bucket %q: %#v", row.AuthProviderSnapshot, resp.AccountStats)
		}
		byProvider[row.AuthProviderSnapshot] = row
	}
	codex := byProvider["codex"]
	antigravity := byProvider["antigravity"]
	if codex.Calls != 197 || !slices.Equal(codex.AuthIndices, []string{"codex-auth-a", "codex-auth-b"}) || len(codex.Models) != 1 || codex.Models[0].Calls != 197 {
		t.Fatalf("codex account row = %#v", codex)
	}
	if antigravity.Calls != 17 || !slices.Equal(antigravity.AuthIndices, []string{"antigravity-auth"}) || len(antigravity.Models) != 1 || antigravity.Models[0].Calls != 17 {
		t.Fatalf("antigravity account row = %#v", antigravity)
	}
	if codex.ID == antigravity.ID || codex.AccountSnapshot != antigravity.AccountSnapshot {
		t.Fatalf("provider-scoped ids/accounts = codex:%#v antigravity:%#v", codex, antigravity)
	}
	if resp.FilterOptions == nil || len(resp.FilterOptions.AccountStats) != 2 {
		t.Fatalf("provider-scoped account selectors = %#v", resp.FilterOptions)
	}

	run(t, []string{"codex"}, "codex", 197)
	run(t, []string{"antigravity"}, "antigravity", 17)
}

func TestAnalyticsAccountStatsProviderScopeFallbackIdentity(t *testing.T) {
	db := newMonitoringTestStore(t)
	ctx := context.Background()
	fromMS := int64(1_778_045_000_000)
	toMS := fromMS + 60*60*1000
	events := []usage.Event{
		monitoringEvent("provider-label-codex", fromMS+1_000, "model-x", "codex-auth", "codex.json", false, 1, 1, 0, 0, 2, nil),
		monitoringEvent("provider-label-antigravity", fromMS+2_000, "model-x", "antigravity-auth", "antigravity.json", false, 1, 1, 0, 0, 2, nil),
	}
	for index := range events {
		events[index].AccountSnapshot = ""
		events[index].AuthLabelSnapshot = "Shared Label"
	}
	events[0].AuthProviderSnapshot = "codex"
	events[0].Provider = "codex"
	events[1].AuthProviderSnapshot = ""
	events[1].Provider = "antigravity"
	if _, err := db.InsertEvents(ctx, events); err != nil {
		t.Fatalf("insert provider label events: %v", err)
	}

	resp, err := New(db).Analytics(ctx, Request{
		FromMS:  fromMS,
		ToMS:    toMS,
		Include: Include{AccountStats: true, FilterOptions: true, FilterSelectors: true},
	})
	if err != nil {
		t.Fatalf("analytics: %v", err)
	}
	if len(resp.AccountStats) != 2 || resp.AccountStats[0].ID == resp.AccountStats[1].ID {
		t.Fatalf("provider-scoped label account stats = %#v", resp.AccountStats)
	}
	if resp.FilterOptions == nil || len(resp.FilterOptions.AccountStats) != 2 {
		t.Fatalf("provider-scoped label selectors = %#v", resp.FilterOptions)
	}
}

func TestBuildAccountStatsDoesNotMergeProviderAliasesAcrossMonitoringIdentity(t *testing.T) {
	stats := []store.AccountModelStat{
		{
			AccountSnapshot:      "same@example.com",
			AuthProviderSnapshot: "x-ai",
			AuthIndex:            "xai-auth-a",
			Model:                "grok-model",
			Calls:                1,
			SuccessCalls:         1,
			TotalTokens:          10,
		},
		{
			AccountSnapshot:      "same@example.com",
			AuthProviderSnapshot: "grok",
			AuthIndex:            "xai-auth-b",
			Model:                "grok-model",
			Calls:                1,
			SuccessCalls:         1,
			TotalTokens:          20,
		},
	}

	rows := buildAccountStats(stats, nil)
	if len(rows) != 2 {
		t.Fatalf("expected 2 distinct monitoring account rows, got %d: %#v", len(rows), rows)
	}
	if rows[0].ID == rows[1].ID {
		t.Fatalf("expected distinct monitoring account ids, got duplicate %q", rows[0].ID)
	}
	providers := map[string]bool{}
	for _, row := range rows {
		providers[row.AuthProviderSnapshot] = true
	}
	if !providers["x-ai"] || !providers["grok"] {
		t.Fatalf("expected x-ai and grok to remain distinct, got %#v", providers)
	}
}
