package codexinspection

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/seakee/cpa-manager-plus/apps/manager-server/internal/model"
)

func TestRunKeepsCodexAccountsWithUsableCredits(t *testing.T) {
	for _, tt := range []struct {
		name       string
		credits    string
		allowed    bool
		statusCode int
		wantAction string
	}{
		{"positive balance", `{"has_credits":true,"balance":"59897.4803850000"}`, true, 200, "keep"},
		{"fractional balance", `{"has_credits":true,"balance":"0.4"}`, true, 200, "keep"},
		{"unlimited", `{"has_credits":true,"unlimited":true}`, true, 200, "keep"},
		{"no credits", `{"has_credits":false,"balance":"50"}`, true, 200, "disable"},
		{"zero balance", `{"has_credits":true,"balance":"0"}`, true, 200, "disable"},
		{"invalid balance", `{"has_credits":true,"balance":"NaN"}`, true, 200, "disable"},
		{"infinite balance", `{"has_credits":true,"balance":"Infinity"}`, true, 200, "disable"},
		{"weekly limit reached with credit balance", `{"has_credits":true,"balance":"50","overage_limit_reached":false}`, false, 200, "keep"},
		{"overage rejected", `{"has_credits":true,"balance":"50","overage_limit_reached":true}`, false, 200, "disable"},
		{"upstream rejection", `{"has_credits":true,"balance":"50"}`, false, 429, "disable"},
	} {
		t.Run(tt.name, func(t *testing.T) {
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				switch r.URL.Path {
				case "/v0/management/auth-files":
					_, _ = w.Write([]byte(`{"files":[{"name":"codex.json","auth_index":"auth-1","provider":"codex","account":"user@example.test","status":"ok"}]}`))
				case "/v0/management/api-call":
					_, _ = fmt.Fprintf(w, `{"status_code":%d,"body":{"plan_type":"pro","credits":%s,"rate_limit":{"allowed":%t,"limit_reached":true,"primary_window":{"used_percent":100,"limit_window_seconds":604800}},"spend_control":{"reached":false},"rate_limit_reached_type":null}}`, tt.statusCode, tt.credits, tt.allowed)
				default:
					http.NotFound(w, r)
				}
			}))
			t.Cleanup(upstream.Close)
			db := newCodexInspectionTestStore(t)
			cfg := newCodexInspectionManagerConfig(upstream.URL)
			cfg.CodexInspection.AutoActionMode = model.CodexInspectionAutoActionNone
			if err := db.SaveManagerConfig(context.Background(), cfg); err != nil {
				t.Fatal(err)
			}
			detail, err := newCodexInspectionTestService(t, db).Run(context.Background(), RunRequest{TriggerType: "manual"})
			if err != nil {
				t.Fatal(err)
			}
			if len(detail.Results) != 1 {
				t.Fatalf("results = %#v", detail.Results)
			}
			result := detail.Results[0]
			if result.Action != tt.wantAction || result.IsQuota != (tt.wantAction == "disable") || result.UsedPercent == nil || *result.UsedPercent != 100 {
				t.Fatalf("result = %#v, want action=%s and unchanged usedPercent=100", result, tt.wantAction)
			}
		})
	}
}

func TestCodexCreditsKeepExplicitLimitSignals(t *testing.T) {
	for _, raw := range []string{
		`{"credits":{"has_credits":true,"balance":"50"},"rate_limit":{"allowed":false}}`,
		`{"credits":{"has_credits":true,"balance":"50"},"spend_control":{"reached":true}}`,
		`{"credits":{"has_credits":true,"balance":"50"},"rate_limit_reached_type":"workspace_member_credits_depleted"}`,
	} {
		var payload map[string]any
		if err := json.Unmarshal([]byte(raw), &payload); err != nil {
			t.Fatal(err)
		}
		rateLimit := parseRateLimit(readMap(payload, "rate_limit"))
		if resolveCodexInspectionCredits(payload, rateLimit, ptrFloat(100)) != codexCreditsUnavailable {
			t.Fatalf("explicit rejection must remain effective: %s", raw)
		}
	}
}
