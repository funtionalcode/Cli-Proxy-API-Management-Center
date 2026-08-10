package quotasnapshot

import (
	"testing"

	"github.com/seakee/cpa-manager-plus/apps/manager-server/internal/model"
)

func TestApplyLegacyCodexRelationshipsPairsDistinctQuotaFamilies(t *testing.T) {
	const scope = "shared-scope"
	snapshots := []model.AccountQuotaSnapshot{
		{Provider: "codex", ProviderWindowID: "five-hour", WindowKind: "five_hour", ScopeFingerprint: scope},
		{Provider: "codex", ProviderWindowID: "weekly", WindowKind: "weekly", ScopeFingerprint: scope},
		{Provider: "codex", ProviderWindowID: "code-review-five-hour", WindowKind: "five_hour", ScopeFingerprint: scope},
		{Provider: "codex", ProviderWindowID: "code-review-weekly", WindowKind: "weekly", ScopeFingerprint: scope},
		{Provider: "codex", ProviderWindowID: "credits-five-hour-0", WindowKind: "five_hour", ScopeFingerprint: scope},
		{Provider: "codex", ProviderWindowID: "credits-weekly-0", WindowKind: "weekly", ScopeFingerprint: scope},
	}

	applyLegacyCodexRelationships(snapshots)

	want := map[string]string{
		"five-hour":             "weekly",
		"code-review-five-hour": "code-review-weekly",
		"credits-five-hour-0":   "credits-weekly-0",
	}
	for _, snapshot := range snapshots {
		containerID, ok := want[snapshot.ProviderWindowID]
		if !ok {
			continue
		}
		if snapshot.RelationshipKind != "concurrent_subwindow" || snapshot.ContainerWindowID != containerID {
			t.Fatalf("legacy relationship %s = %q/%q, want concurrent_subwindow/%q", snapshot.ProviderWindowID, snapshot.RelationshipKind, snapshot.ContainerWindowID, containerID)
		}
	}
}
