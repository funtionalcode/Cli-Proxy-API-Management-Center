package usageidentity

import (
	"database/sql"
	"testing"

	_ "modernc.org/sqlite"
)

func TestAccountKeySeparatesSharedAccountSnapshotsByCredential(t *testing.T) {
	first, ok := AccountKey(Fields{AuthFileSnapshot: "shared.json", AuthIndex: "auth-a", AuthProviderSnapshot: "codex", AccountSnapshot: "same@example.com"})
	if !ok {
		t.Fatal("first key is invalid")
	}
	second, ok := AccountKey(Fields{AuthFileSnapshot: "shared.json", AuthIndex: "auth-b", AuthProviderSnapshot: "codex", AccountSnapshot: "same@example.com"})
	if !ok {
		t.Fatal("second key is invalid")
	}
	if first == second {
		t.Fatalf("shared account snapshot merged distinct credentials: %q", first)
	}
}

func TestAccountKeyRejectsMissingIdentity(t *testing.T) {
	if key, ok := AccountKey(Fields{}); ok || key != "" {
		t.Fatalf("AccountKey() = %q, %v; want empty, false", key, ok)
	}
}

func TestAccountKeyKeepsCodexAccountAcrossMutableCredentialIdentity(t *testing.T) {
	accountID := "account-a"
	oldKey, ok := AccountKey(Fields{AuthFileSnapshot: "codex-a-free.json", AuthIndex: "auth-1", AuthProviderSnapshot: "codex", AuthAccountIDSnapshot: accountID})
	if !ok {
		t.Fatal("old key is invalid")
	}
	newKey, ok := AccountKey(Fields{AuthFileSnapshot: "codex-a-pro.json", AuthIndex: "auth-2", AuthProviderSnapshot: "codex", AuthAccountIDSnapshot: accountID})
	if !ok {
		t.Fatal("new key is invalid")
	}
	if oldKey != newKey {
		t.Fatalf("same Codex account split across reauth: old=%q new=%q", oldKey, newKey)
	}
	legacyKey, ok := LegacyAccountKey(Fields{AuthFileSnapshot: "codex-a-pro.json", AuthIndex: "auth-2", AuthProviderSnapshot: "codex", AuthAccountIDSnapshot: accountID})
	if !ok || legacyKey == newKey {
		t.Fatalf("legacy exact credential key = %q, stable key = %q", legacyKey, newKey)
	}
	differentKey, ok := AccountKey(Fields{AuthFileSnapshot: "codex-b.json", AuthIndex: "auth-3", AuthProviderSnapshot: "codex", AuthAccountIDSnapshot: "account-b", AccountSnapshot: "same@example.com"})
	if !ok || differentKey == oldKey {
		t.Fatalf("different Codex account merged: old=%q different=%q", oldKey, differentKey)
	}
}

func TestAccountKeyDoesNotPromoteHistoricalCodexProjectSnapshot(t *testing.T) {
	fields := Fields{AuthFileSnapshot: "legacy-codex.json", AuthIndex: "auth-old", AuthProviderSnapshot: "codex", AuthProjectIDSnapshot: "generic-project"}
	got, ok := AccountKey(fields)
	want, legacyOK := LegacyAccountKey(fields)
	if !ok || !legacyOK || got != want {
		t.Fatalf("historical Codex project snapshot promoted: got=%q want legacy=%q", got, want)
	}
}

func TestAccountKeyDoesNotReadLegacyCodexAccountMarkerFromProjectSnapshot(t *testing.T) {
	fields := Fields{AuthFileSnapshot: "legacy-codex.json", AuthIndex: "auth-old", AuthProviderSnapshot: "codex", AuthProjectIDSnapshot: CodexAccountIDSnapshot("account-a")}
	got, ok := AccountKey(fields)
	want, legacyOK := LegacyAccountKey(fields)
	if !ok || !legacyOK || got != want {
		t.Fatalf("legacy project marker promoted to stable account: got=%q want=%q", got, want)
	}
}

func TestCodexAccountIDSnapshotRequiresExplicitMarker(t *testing.T) {
	if got := CodexAccountIDFromSnapshot("account-a"); got != "" {
		t.Fatalf("unmarked snapshot returned account id %q", got)
	}
	if got := CodexAccountIDFromSnapshot(CodexAccountIDSnapshot(" account-a ")); got != "account-a" {
		t.Fatalf("marked snapshot returned %q", got)
	}
}

func TestSQLAccountKeyExpressionMatchesGo(t *testing.T) {
	db, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	defer db.Close()
	if _, err := db.Exec(`create table usage_events (
		auth_file_snapshot text, auth_index text, auth_provider_snapshot text,
		auth_account_id_snapshot text, auth_project_id_snapshot text, account_snapshot text,
		auth_label_snapshot text, source text, provider text
	)`); err != nil {
		t.Fatalf("create table: %v", err)
	}

	testCases := []struct {
		name     string
		fields   Fields
		provider string
	}{
		{name: "file and auth index", fields: Fields{AuthFileSnapshot: "shared.json", AuthIndex: "auth-a", AuthProviderSnapshot: "x_ai", AuthProjectIDSnapshot: "project-a", AccountSnapshot: "same@example.com", AuthLabelSnapshot: "Same Account", Source: "legacy-source"}, provider: "xai"},
		{name: "codex stable account", fields: Fields{AuthFileSnapshot: "codex-new.json", AuthIndex: "auth-new", AuthProviderSnapshot: "codex", AuthAccountIDSnapshot: "account-a", AccountSnapshot: "same@example.com"}, provider: "codex"},
		{name: "historical codex project", fields: Fields{AuthFileSnapshot: "codex-old.json", AuthIndex: "auth-old", AuthProviderSnapshot: "codex", AuthProjectIDSnapshot: "generic-project"}, provider: "codex"},
		{name: "legacy source file and project", fields: Fields{Source: "legacy.json", AuthProviderSnapshot: "vertex", AuthProjectIDSnapshot: "project-a"}, provider: "vertex"},
		{name: "auth index without file", fields: Fields{AuthIndex: "auth-only", AuthProviderSnapshot: "grok"}, provider: "x-ai"},
		{name: "account fallback ignores matching source", fields: Fields{AccountSnapshot: "legacy@example.com", AuthProviderSnapshot: "open_ai", Source: "legacy@example.com"}, provider: "open-ai"},
		{name: "label fallback", fields: Fields{AuthLabelSnapshot: "Legacy Label", AuthProviderSnapshot: "claude"}, provider: "claude"},
		{name: "missing identity", fields: Fields{}, provider: ""},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := db.Exec(`delete from usage_events`); err != nil {
				t.Fatalf("clear rows: %v", err)
			}
			f := tc.fields
			if _, err := db.Exec(`insert into usage_events values (?, ?, ?, ?, ?, ?, ?, ?, ?)`, f.AuthFileSnapshot, f.AuthIndex, f.AuthProviderSnapshot, f.AuthAccountIDSnapshot, f.AuthProjectIDSnapshot, f.AccountSnapshot, f.AuthLabelSnapshot, f.Source, tc.provider); err != nil {
				t.Fatalf("insert row: %v", err)
			}
			want, valid := AccountKey(f)
			var got string
			if err := db.QueryRow(`select ` + SQLAccountKeyExpression("e") + ` from usage_events e`).Scan(&got); err != nil {
				t.Fatalf("query SQL key: %v", err)
			}
			if got != want {
				t.Fatalf("SQL key = %q, want %q", got, want)
			}
			if valid != (got != "") {
				t.Fatalf("valid = %v for SQL key %q", valid, got)
			}
		})
	}
}

func TestPricingStructureRevisionIncludesIdentityFormat(t *testing.T) {
	if got := PricingStructureRevision("price-revision"); got != "model-1:identity-3:price-revision" {
		t.Fatalf("revision = %q", got)
	}
}
