package usageidentity

import (
	"database/sql"
	"testing"

	_ "modernc.org/sqlite"
)

func TestAccountKeySeparatesSharedAccountSnapshotsByCredential(t *testing.T) {
	first, ok := AccountKey(Fields{
		AuthFileSnapshot:     "shared.json",
		AuthIndex:            "auth-a",
		AuthProviderSnapshot: "codex",
		AccountSnapshot:      "same@example.com",
	})
	if !ok {
		t.Fatal("first key is invalid")
	}
	second, ok := AccountKey(Fields{
		AuthFileSnapshot:     "shared.json",
		AuthIndex:            "auth-b",
		AuthProviderSnapshot: "codex",
		AccountSnapshot:      "same@example.com",
	})
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

func TestSQLAccountKeyExpressionMatchesGo(t *testing.T) {
	db, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	defer db.Close()
	if _, err := db.Exec(`create table usage_events (
		auth_file_snapshot text, auth_index text, auth_provider_snapshot text,
		auth_project_id_snapshot text, account_snapshot text,
		auth_label_snapshot text, source text, provider text
	)`); err != nil {
		t.Fatalf("create table: %v", err)
	}

	testCases := []struct {
		name     string
		fields   Fields
		provider string
	}{
		{
			name: "file and auth index",
			fields: Fields{
				AuthFileSnapshot:      "shared.json",
				AuthIndex:             "auth-a",
				AuthProviderSnapshot:  "x_ai",
				AuthProjectIDSnapshot: "project-a",
				AccountSnapshot:       "same@example.com",
				AuthLabelSnapshot:     "Same Account",
				Source:                "legacy-source",
			},
			provider: "xai",
		},
		{
			name: "legacy source file and project",
			fields: Fields{
				Source:                "legacy.json",
				AuthProviderSnapshot:  "vertex",
				AuthProjectIDSnapshot: "project-a",
			},
			provider: "vertex",
		},
		{
			name: "auth index without file",
			fields: Fields{
				AuthIndex:            "auth-only",
				AuthProviderSnapshot: "grok",
			},
			provider: "x-ai",
		},
		{
			name: "account fallback ignores matching source",
			fields: Fields{
				AccountSnapshot:      "legacy@example.com",
				AuthProviderSnapshot: "open_ai",
				Source:               "legacy@example.com",
			},
			provider: "open-ai",
		},
		{
			name: "label fallback",
			fields: Fields{
				AuthLabelSnapshot:    "Legacy Label",
				AuthProviderSnapshot: "claude",
			},
			provider: "claude",
		},
		{
			name:     "missing identity",
			fields:   Fields{},
			provider: "",
		},
	}

	for _, testCase := range testCases {
		t.Run(testCase.name, func(t *testing.T) {
			if _, err := db.Exec(`delete from usage_events`); err != nil {
				t.Fatalf("clear rows: %v", err)
			}
			fields := testCase.fields
			if _, err := db.Exec(`insert into usage_events values (?, ?, ?, ?, ?, ?, ?, ?)`,
				fields.AuthFileSnapshot,
				fields.AuthIndex,
				fields.AuthProviderSnapshot,
				fields.AuthProjectIDSnapshot,
				fields.AccountSnapshot,
				fields.AuthLabelSnapshot,
				fields.Source,
				testCase.provider,
			); err != nil {
				t.Fatalf("insert row: %v", err)
			}

			want, valid := AccountKey(fields)
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
	if got := PricingStructureRevision("price-revision"); got != "identity-2:price-revision" {
		t.Fatalf("revision = %q", got)
	}
}
