package usageevent

import (
	"context"
	"database/sql"
	"fmt"
	"path/filepath"
	"strings"
	"testing"

	sqliterepo "github.com/seakee/cpa-manager-plus/apps/manager-server/internal/repository/sqlite"
	"github.com/seakee/cpa-manager-plus/apps/manager-server/internal/usage"
	"github.com/seakee/cpa-manager-plus/apps/manager-server/internal/usageidentity"
)

func TestStoredCodexLegacyEvidencePreservesAuthorityAcrossBatches(t *testing.T) {
	for _, test := range []struct {
		name    string
		mutate  func([]usage.Event) []usage.Event
		prepare string
		allowed bool
	}{
		{name: "leading weak prefix", allowed: true},
		{name: "case variants", allowed: true, mutate: func(events []usage.Event) []usage.Event {
			events[0].AuthFileSnapshot = "CODEX-A.JSON"
			events[0].AuthIndex = "AUTH-A"
			events[1].AccountSnapshot = " SAME@EXAMPLE.COM "
			return events
		}},
		{name: "null file source prefix", allowed: true, mutate: func(events []usage.Event) []usage.Event {
			events[0].AuthFileSnapshot = ""
			return events
		}},
		{name: "empty file source prefix", allowed: true, prepare: "update usage_events set auth_file_snapshot = '' where id = 1"},
		{name: "source is only display text", allowed: true, mutate: func(events []usage.Event) []usage.Event {
			events[0].AuthFileSnapshot = ""
			events[0].AuthLabelSnapshot = "codex-a.json"
			events[0].Provider = "openai"
			return events
		}},
		{name: "unrelated source beside explicit file", allowed: true, mutate: func(events []usage.Event) []usage.Event {
			extra := identityChronologyEvent("unrelated", 4000, "other.json", "auth-a", "openai", "other", "")
			extra.Source = "codex-a.json"
			return append(events, extra)
		}},
		{name: "foreign provider", mutate: func(events []usage.Event) []usage.Event {
			events[0].Provider = "openai"
			return events
		}},
		{name: "missing provider", mutate: func(events []usage.Event) []usage.Event {
			events[0].Provider, events[0].AuthProviderSnapshot = "", ""
			return events
		}},
		{name: "different member", mutate: func(events []usage.Event) []usage.Event {
			events[0].AccountSnapshot = "other@example.com"
			return events
		}},
		{name: "missing member", mutate: func(events []usage.Event) []usage.Event {
			events[0].AccountSnapshot = ""
			return events
		}},
		{name: "different workspace", mutate: func(events []usage.Event) []usage.Event {
			events[0].AuthAccountIDSnapshot = "other-workspace"
			return events
		}},
		{name: "invalid marker", mutate: func(events []usage.Event) []usage.Event {
			events[0].AuthProjectIDSnapshot = "codex-account-id:v1:"
			return events
		}},
		{name: "conflicting marker", mutate: func(events []usage.Event) []usage.Event {
			events[1].AuthProjectIDSnapshot = usageidentity.CodexAccountIDSnapshot("other-workspace")
			return events
		}},
		{name: "valid marker", allowed: true, mutate: func(events []usage.Event) []usage.Event {
			events[0].AuthProjectIDSnapshot = usageidentity.CodexAccountIDSnapshot("account-a")
			return events
		}},
		{name: "late weak evidence", mutate: func(events []usage.Event) []usage.Event {
			events[0].CreatedAtMS = 4000
			return events
		}},
		{name: "weak maximum survives repeated groups", mutate: func(events []usage.Event) []usage.Event {
			return append(events, identityChronologyEvent("late-weak", 4000, "codex-a.json", "auth-a", "codex", "", ""))
		}},
		{name: "trusted minimum survives repeated groups", mutate: func(events []usage.Event) []usage.Event {
			return append(events, identityChronologyEvent("early-trusted", 500, "codex-a.json", "auth-a", "codex", "account-a", ""))
		}},
		{name: "unknown duplicate weak chronology", prepare: "update usage_events set auth_snapshot_at_ms = null, created_at_ms = 0 where id = 3", mutate: func(events []usage.Event) []usage.Event {
			return append(events, identityChronologyEvent("unknown-weak", 2000, "codex-a.json", "auth-a", "codex", "", ""))
		}},
		{name: "unknown duplicate trusted chronology", prepare: "update usage_events set auth_snapshot_at_ms = null, created_at_ms = 0 where id = 3", mutate: func(events []usage.Event) []usage.Event {
			return append(events, identityChronologyEvent("unknown-trusted", 4000, "codex-a.json", "auth-a", "codex", "account-a", ""))
		}},
		{name: "repeated trusted group", allowed: true, mutate: func(events []usage.Event) []usage.Event {
			return append(events, identityChronologyEvent("later-trusted", 4000, "codex-a.json", "auth-a", "codex", "account-a", ""))
		}},
		{name: "equal chronology", mutate: func(events []usage.Event) []usage.Event {
			events[0].CreatedAtMS = events[1].CreatedAtMS
			return events
		}},
		{name: "unknown weak chronology", prepare: "update usage_events set auth_snapshot_at_ms = null, created_at_ms = 0 where id = 1"},
		{name: "unknown trusted chronology", prepare: "update usage_events set auth_snapshot_at_ms = null, created_at_ms = 0 where id = 2"},
		{name: "snapshot time overrides insertion time", allowed: true, mutate: func(events []usage.Event) []usage.Event {
			events[0].CreatedAtMS = 9000
			events[0].AuthSnapshotAtMS = 1000
			return events
		}},
		{name: "old weak evidence imported after anchor", allowed: true, mutate: func(events []usage.Event) []usage.Event {
			return []usage.Event{events[1], events[0]}
		}},
	} {
		t.Run(test.name, func(t *testing.T) {
			db := openIdentityEvidenceTestDB(t)
			events := []usage.Event{
				identityChronologyEvent("weak", 1000, "codex-a.json", "auth-a", "codex", "", ""),
				identityChronologyEvent("trusted", 3000, "codex-a.json", "auth-a", "codex", "account-a", ""),
			}
			if test.mutate != nil {
				events = test.mutate(events)
			}
			if _, err := New(db).InsertBatch(context.Background(), events); err != nil {
				t.Fatal(err)
			}
			if test.prepare != "" {
				if _, err := db.Exec(test.prepare); err != nil {
					t.Fatal(err)
				}
			}
			assertIdentityEvidenceAllowed(t, db, test.allowed)
			// Every split is tested: evidence on either side of the checkpoint
			// must be combined before authorizing a historical alias.
			for through := int64(1); through <= int64(len(events)); through++ {
				commitIdentityEvidenceTestBatch(t, db, through-1, through)
				assertIdentityEvidenceAllowed(t, db, test.allowed)
			}
		})
	}
}

func TestStoredCodexLegacyEvidenceReadsNewConflictBeforeWorkerCatchUp(t *testing.T) {
	db := openIdentityEvidenceTestDB(t)
	repo := New(db)
	ctx := context.Background()
	if _, err := repo.InsertBatch(ctx, []usage.Event{identityTestEvent("trusted", 1, "codex-a.json", "auth-a", "codex", "account-a")}); err != nil {
		t.Fatal(err)
	}
	commitIdentityEvidenceTestBatch(t, db, 0, 1)
	assertIdentityEvidenceAllowed(t, db, true)
	if _, err := repo.InsertBatch(ctx, []usage.Event{identityTestEvent("new-conflict", 2, "codex-a.json", "auth-a", "codex", "other")}); err != nil {
		t.Fatal(err)
	}
	assertIdentityEvidenceAllowed(t, db, false)
	commitIdentityEvidenceTestBatch(t, db, 1, 2)
	assertIdentityEvidenceAllowed(t, db, false)
}

func TestStoredCodexLegacyEvidenceBoundsRawTailAndUsesRowID(t *testing.T) {
	for _, count := range []int{1, codexLegacyIdentityTailLimit, codexLegacyIdentityTailLimit + 1} {
		t.Run(fmt.Sprint(count), func(t *testing.T) {
			db := openIdentityEvidenceTestDB(t)
			ctx := context.Background()
			events := []usage.Event{identityTestEvent("anchor", 1, "codex-a.json", "auth-a", "codex", "account-a")}
			if _, err := New(db).InsertBatch(ctx, events); err != nil {
				t.Fatal(err)
			}
			commitIdentityEvidenceTestBatch(t, db, 0, 1)
			events = events[:0]
			for i := 0; i < count; i++ {
				events = append(events, identityTestEvent(fmt.Sprint("tail-", i), int64(i+2), "codex-a.json", "auth-a", "codex", "account-a"))
			}
			// A conflict at the end must never be hidden by a LIMIT.
			events[len(events)-1].AuthAccountIDSnapshot = "other"
			if _, err := New(db).InsertBatch(ctx, events); err != nil {
				t.Fatal(err)
			}
			if count == 1 {
				if _, err := db.Exec("update usage_events set id = 1000000 where id = 2"); err != nil {
					t.Fatal(err)
				}
			}
			tx, err := db.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
			if err != nil {
				t.Fatal(err)
			}
			defer tx.Rollback()
			spy := &identityEvidenceQuerySpy{SQLQueryer: tx}
			_, allowed, err := ResolveCodexLegacyAccountKey(ctx, spy, identityEvidenceTestTarget())
			if err != nil || allowed {
				t.Fatalf("conflicting tail allowed=%v err=%v", allowed, err)
			}
			if spy.fullHistoryReads != 0 && count <= codexLegacyIdentityTailLimit {
				t.Fatal("bounded tail unexpectedly rescanned historical credential rows")
			}
			if spy.fullHistoryReads == 0 && count > codexLegacyIdentityTailLimit {
				t.Fatal("oversized tail did not fall back to complete evidence")
			}
			for _, statement := range spy.tailQueries {
				rows, err := tx.QueryContext(ctx, "explain query plan "+statement.query, statement.args...)
				if err != nil {
					t.Fatal(err)
				}
				var details []string
				for rows.Next() {
					var id, parent, unused int
					var detail string
					if err := rows.Scan(&id, &parent, &unused, &detail); err != nil {
						t.Fatal(err)
					}
					details = append(details, detail)
				}
				if err := rows.Close(); err != nil {
					t.Fatal(err)
				}
				if !strings.Contains(strings.Join(details, "\n"), "SEARCH e USING INTEGER PRIMARY KEY") {
					t.Fatalf("tail is not bounded by rowid: %v", details)
				}
			}
		})
	}
}

func TestStoredCodexLegacyEvidenceFallsBackWhenUnavailable(t *testing.T) {
	for name, statement := range map[string]string{
		"missing state":     "delete from usage_monitoring_rollup_state where rollup_name = 'codex_legacy_identity_v1'",
		"missing table":     "drop table usage_codex_legacy_identity_evidence_v1",
		"old revision":      "update usage_monitoring_rollup_state set structure_revision = 'old' where rollup_name = 'codex_legacy_identity_v1'",
		"old schema":        "update usage_monitoring_rollup_state set schema_version = 0 where rollup_name = 'codex_legacy_identity_v1'",
		"pending":           "update usage_monitoring_rollup_state set status = 'pending' where rollup_name = 'codex_legacy_identity_v1'",
		"clearing":          "update usage_monitoring_rollup_state set status = 'clearing' where rollup_name = 'codex_legacy_identity_v1'",
		"failed":            "update usage_monitoring_rollup_state set status = 'failed' where rollup_name = 'codex_legacy_identity_v1'",
		"invalid coverage":  "update usage_monitoring_rollup_state set coverage_event_id = 100 where rollup_name = 'codex_legacy_identity_v1'",
		"negative coverage": "update usage_monitoring_rollup_state set coverage_event_id = -1 where rollup_name = 'codex_legacy_identity_v1'",
	} {
		t.Run(name, func(t *testing.T) {
			db := openIdentityEvidenceTestDB(t)
			if _, err := New(db).InsertBatch(context.Background(), []usage.Event{identityTestEvent("trusted", 1, "codex-a.json", "auth-a", "codex", "account-a")}); err != nil {
				t.Fatal(err)
			}
			commitIdentityEvidenceTestBatch(t, db, 0, 1)
			if _, err := db.Exec("update usage_codex_legacy_identity_evidence_v1 set auth_account_id_snapshot = 'stale-conflict'"); err != nil {
				t.Fatal(err)
			}
			if _, err := db.Exec(statement); err != nil {
				t.Fatal(err)
			}
			assertIdentityEvidenceAllowed(t, db, true)
		})
	}
}

type identityEvidenceQuerySpy struct {
	SQLQueryer
	fullHistoryReads int
	tailQueries      []struct {
		query string
		args  []any
	}
}

func (s *identityEvidenceQuerySpy) QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error) {
	if strings.Contains(query, legacyAccountIdentityEvidenceSelect) {
		s.fullHistoryReads++
	}
	if strings.Contains(query, "from usage_events e not indexed") {
		s.tailQueries = append(s.tailQueries, struct {
			query string
			args  []any
		}{query, append([]any(nil), args...)})
	}
	return s.SQLQueryer.QueryContext(ctx, query, args...)
}

func openIdentityEvidenceTestDB(t testing.TB) *sql.DB {
	t.Helper()
	db, err := sqliterepo.Open(filepath.Join(t.TempDir(), "usage.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	return db
}

func identityEvidenceTestTarget() usageidentity.Fields {
	return usageidentity.Fields{
		AuthFileSnapshot: "codex-a.json", AuthIndex: "auth-a", AuthProviderSnapshot: "codex",
		AuthAccountIDSnapshot: "account-a", AccountSnapshot: "same@example.com", Source: "codex-a.json",
	}
}

func assertIdentityEvidenceAllowed(t testing.TB, db *sql.DB, want bool) {
	t.Helper()
	key, allowed, err := New(db).ResolveCodexLegacyAccountKey(context.Background(), identityEvidenceTestTarget())
	if err != nil || allowed != want || (key != "") != want {
		t.Fatalf("legacy identity = key:%q allowed:%v err:%v, want allowed:%v", key, allowed, err, want)
	}
}

func commitIdentityEvidenceTestBatch(t testing.TB, db *sql.DB, afterID, throughID int64) {
	t.Helper()
	ctx := context.Background()
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	if err := UpsertCodexLegacyIdentityEvidenceRange(ctx, tx, CodexLegacyIdentityEvidenceRevision, afterID, throughID); err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(`update usage_monitoring_rollup_state set
		structure_revision = ?, status = 'rebuilding', coverage_event_id = ?,
		target_event_id = (select max(id) from usage_events)
		where rollup_name = ?`, CodexLegacyIdentityEvidenceRevision, throughID, CodexLegacyIdentityRollupName); err != nil {
		t.Fatal(err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
}
