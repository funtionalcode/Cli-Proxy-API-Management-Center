package usageevent

import (
	"context"
	"path/filepath"
	"strings"
	"testing"
	"time"

	sqliterepo "github.com/seakee/cpa-manager-plus/apps/manager-server/internal/repository/sqlite"
	"github.com/seakee/cpa-manager-plus/apps/manager-server/internal/usage"
)

func TestRecentAccountRequestsUseSnapshotIdentityLimitAndConservativeLegacyFallback(t *testing.T) {
	db, err := sqliterepo.Open(filepath.Join(t.TempDir(), "usage.sqlite"))
	if err != nil {
		t.Fatalf("open database: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	repo := New(db)
	ctx := context.Background()
	baseMS := int64(1_700_000_000_000)

	oldest := latestAccountRequestEvent("oldest", baseMS+500, "credential-a.json", "auth-a", "source-a")
	current := latestAccountRequestEvent("current", baseMS+1_000, "credential-a.json", "auth-a", "source-a")
	latest := latestAccountRequestEvent("latest", baseMS+2_000, "Credential-A.JSON", "AUTH-A", "source-a")
	latest.Failed = true
	latest.FailStatusCode = 429
	latest.FailBody = "Authorization: Bearer hidden-request-token"
	latest.HeaderErrorKind = "rate_limit"
	latest.HeaderErrorCode = "quota_exceeded"
	latest.HeaderTraceID = "trace-latest-a"
	wrongFile := latestAccountRequestEvent("wrong-file", baseMS+9_000, "credential-b.json", "auth-a", "source-b")
	wrongIndex := latestAccountRequestEvent("wrong-index", baseMS+10_000, "credential-a.json", "auth-b", "source-a")
	emailCollision := latestAccountRequestEvent("email-collision", baseMS+11_000, "", "auth-a", "alice@example.com")
	emailCollision.AccountSnapshot = "alice@example.com"
	legacy := latestAccountRequestEvent("legacy", baseMS+3_000, "", "legacy.json", "legacy.json")
	legacy.Failed = true
	legacy.FailStatusCode = 503
	legacy.FailSummary = "upstream unavailable"
	legacyWithSnapshot := latestAccountRequestEvent("legacy-with-snapshot", baseMS+12_000, "other.json", "legacy.json", "legacy.json")

	if _, err := repo.InsertBatch(ctx, []usage.Event{
		oldest,
		current,
		latest,
		wrongFile,
		wrongIndex,
		emailCollision,
		legacy,
		legacyWithSnapshot,
	}); err != nil {
		t.Fatalf("insert events: %v", err)
	}

	requests, err := repo.RecentAccountRequests(ctx, []LatestAccountRequestQuery{
		{RequestIndex: 0, AuthFileSnapshot: "credential-a.json", AuthIndex: "auth-a"},
		{RequestIndex: 1, AuthFileSnapshot: "legacy.json", AuthIndex: "legacy.json"},
		{RequestIndex: 2, AuthFileSnapshot: "missing.json", AuthIndex: "auth-missing"},
	}, 2)
	if err != nil {
		t.Fatalf("recent account requests: %v", err)
	}
	if len(requests) != 3 {
		t.Fatalf("requests = %#v", requests)
	}

	byIndex := make(map[int][]LatestAccountRequest, len(requests))
	for _, request := range requests {
		byIndex[request.RequestIndex] = append(byIndex[request.RequestIndex], request)
	}

	primaryRequests := byIndex[0]
	if len(primaryRequests) != 2 {
		t.Fatalf("primary requests = %#v", primaryRequests)
	}
	primary := primaryRequests[0]
	if primary.TimestampMS != latest.TimestampMS || !primary.Failed || !primary.FailStatusCode.Valid || primary.FailStatusCode.Int64 != 429 {
		t.Fatalf("primary latest request = %#v", primary)
	}
	if primary.HeaderErrorKind != "rate_limit" || primary.HeaderErrorCode != "quota_exceeded" || primary.HeaderTraceID != "trace-latest-a" {
		t.Fatalf("primary diagnostics = %#v", primary)
	}
	if strings.Contains(primary.FailSummary, "hidden-request-token") || !strings.Contains(primary.FailSummary, "[redacted]") {
		t.Fatalf("primary failure summary was not safely reduced: %q", primary.FailSummary)
	}
	if primaryRequests[1].TimestampMS != current.TimestampMS {
		t.Fatalf("primary request order = %#v", primaryRequests)
	}
	for _, request := range primaryRequests {
		if request.TimestampMS == oldest.TimestampMS {
			t.Fatalf("per-credential limit was not applied: %#v", primaryRequests)
		}
	}

	legacyRequests := byIndex[1]
	if len(legacyRequests) != 1 {
		t.Fatalf("legacy requests = %#v", legacyRequests)
	}
	legacyResult := legacyRequests[0]
	if legacyResult.TimestampMS != legacy.TimestampMS || !legacyResult.Failed || !legacyResult.FailStatusCode.Valid || legacyResult.FailStatusCode.Int64 != 503 {
		t.Fatalf("legacy fallback = %#v", legacyResult)
	}
	if _, ok := byIndex[2]; ok {
		t.Fatalf("missing credential unexpectedly matched: %#v", byIndex[2])
	}
}

func latestAccountRequestEvent(
	hash string,
	timestampMS int64,
	authFileSnapshot string,
	authIndex string,
	source string,
) usage.Event {
	return usage.Event{
		EventHash:        hash,
		TimestampMS:      timestampMS,
		Timestamp:        time.UnixMilli(timestampMS).UTC().Format(time.RFC3339Nano),
		Model:            "gpt-test",
		Endpoint:         "POST /v1/responses",
		Method:           "POST",
		Path:             "/v1/responses",
		AuthIndex:        authIndex,
		Source:           source,
		AuthFileSnapshot: authFileSnapshot,
		InputTokens:      1,
		OutputTokens:     2,
		TotalTokens:      3,
		CreatedAtMS:      timestampMS,
	}
}
