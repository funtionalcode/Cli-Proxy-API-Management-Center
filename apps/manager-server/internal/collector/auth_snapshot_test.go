package collector

import (
	"testing"

	"github.com/seakee/cpa-manager-plus/apps/manager-server/internal/usageidentity"
)

func TestAuthSnapshotResolverCacheRequiresEveryRequestedAuthIndex(t *testing.T) {
	resolver := newAuthSnapshotResolver()
	resolver.snapshots = map[string]authSnapshot{
		"auth-1": {Account: "a@example.com", Provider: "codex"},
	}

	if !resolver.hasAllLocked(map[string]struct{}{"auth-1": {}}) {
		t.Fatal("expected cache hit for known auth index")
	}
	if resolver.hasAllLocked(map[string]struct{}{"auth-1": {}, "auth-2": {}}) {
		t.Fatal("cache with missing auth index must force a refresh")
	}
}

func TestCodexAuthSnapshotUsesExplicitAccountIDProvenance(t *testing.T) {
	marked := usageidentity.CodexAccountIDSnapshot("account-a")
	if got := usageidentity.CodexAccountIDFromSnapshot(marked); got != "account-a" {
		t.Fatalf("marked account id = %q", got)
	}
	if got := usageidentity.CodexAccountIDFromSnapshot("generic-project"); got != "" {
		t.Fatalf("generic project unexpectedly trusted as Codex account id: %q", got)
	}
}
