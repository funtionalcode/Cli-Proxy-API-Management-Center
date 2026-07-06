package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"math"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/seakee/cpa-manager/usage-service/internal/collector"
	"github.com/seakee/cpa-manager/usage-service/internal/config"
	"github.com/seakee/cpa-manager/usage-service/internal/store"
	"github.com/seakee/cpa-manager/usage-service/internal/usage"
)

type observedRequest struct {
	path  string
	query string
	auth  string
}

type testAccountProcessingPolicyResponse struct {
	Source               string                      `json:"source"`
	UpdatedAtMS          int64                       `json:"updatedAtMs"`
	CodexQuotaCooldown   testAccountPolicyCapability `json:"codexQuotaCooldown"`
	AuthIssueQueue       testAccountPolicyCapability `json:"authIssueQueue"`
	AuthIssueAutoDisable testAccountPolicyCapability `json:"authIssueAutoDisable"`
}

type testAccountPolicyCapability struct {
	Enabled       bool   `json:"enabled"`
	Configured    bool   `json:"configured"`
	Source        string `json:"source"`
	Locked        bool   `json:"locked"`
	EnvKey        string `json:"envKey"`
	ConfigFileKey string `json:"configFileKey"`
	DependsOn     string `json:"dependsOn"`
}

func newTestHandler(t *testing.T, upstreamURL string, saveSetup bool) http.Handler {
	t.Helper()

	cfg := config.Config{
		DBPath:      filepath.Join(t.TempDir(), "usage.sqlite"),
		Queue:       "usage",
		PopSide:     "right",
		CORSOrigins: []string{"*"},
	}
	db, err := store.Open(cfg.DBPath)
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() {
		_ = db.Close()
	})

	if saveSetup {
		err := db.SaveSetup(context.Background(), store.Setup{
			CPAUpstreamURL: upstreamURL,
			ManagementKey:  "management-key",
			Queue:          "usage",
			PopSide:        "right",
		})
		if err != nil {
			t.Fatalf("save setup: %v", err)
		}
	}

	manager := collector.NewManager(cfg, db)
	return New(cfg, db, manager).Handler()
}

func newTestHandlerWithConfig(t *testing.T, cfg config.Config) http.Handler {
	t.Helper()

	if cfg.DBPath == "" {
		cfg.DBPath = filepath.Join(t.TempDir(), "usage.sqlite")
	}
	if len(cfg.CORSOrigins) == 0 {
		cfg.CORSOrigins = []string{"*"}
	}
	db, err := store.Open(cfg.DBPath)
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() {
		_ = db.Close()
	})

	manager := collector.NewManager(cfg, db)
	return New(cfg, db, manager).Handler()
}

func TestModelListProxyPreservesAuthorization(t *testing.T) {
	for _, path := range []string{"/v1/models", "/models"} {
		t.Run(path, func(t *testing.T) {
			observed := make(chan observedRequest, 1)
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				observed <- observedRequest{
					path:  r.URL.Path,
					query: r.URL.RawQuery,
					auth:  r.Header.Get("Authorization"),
				}
				w.Header().Set("Content-Type", "application/json")
				_, _ = w.Write([]byte(`{"data":[{"id":"gpt-4o"}]}`))
			}))
			t.Cleanup(upstream.Close)

			handler := newTestHandler(t, upstream.URL, true)
			req := httptest.NewRequest(http.MethodGet, path+"?limit=20", nil)
			req.Header.Set("Authorization", "Bearer upstream-key")
			rr := httptest.NewRecorder()

			handler.ServeHTTP(rr, req)

			if rr.Code != http.StatusOK {
				t.Fatalf("status = %d, body = %s", rr.Code, rr.Body.String())
			}
			if !strings.Contains(rr.Body.String(), "gpt-4o") {
				t.Fatalf("response body = %s", rr.Body.String())
			}

			var got observedRequest
			select {
			case got = <-observed:
			default:
				t.Fatal("upstream was not called")
			}
			if got.path != path {
				t.Fatalf("proxied path = %q, want %q", got.path, path)
			}
			if got.query != "limit=20" {
				t.Fatalf("proxied query = %q, want limit=20", got.query)
			}
			if got.auth != "Bearer upstream-key" {
				t.Fatalf("proxied authorization = %q", got.auth)
			}
		})
	}
}

func TestInfoReportsConfiguredState(t *testing.T) {
	for _, tc := range []struct {
		name       string
		saveSetup  bool
		configured bool
	}{
		{name: "not configured", saveSetup: false, configured: false},
		{name: "configured", saveSetup: true, configured: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			handler := newTestHandler(t, "http://example.test", tc.saveSetup)
			req := httptest.NewRequest(http.MethodGet, "/usage-service/info", nil)
			rr := httptest.NewRecorder()

			handler.ServeHTTP(rr, req)

			if rr.Code != http.StatusOK {
				t.Fatalf("status = %d, body = %s", rr.Code, rr.Body.String())
			}
			var response struct {
				Service    string `json:"service"`
				Configured bool   `json:"configured"`
			}
			if err := json.Unmarshal(rr.Body.Bytes(), &response); err != nil {
				t.Fatalf("decode response: %v", err)
			}
			if response.Service != serviceID {
				t.Fatalf("service = %q, want %q", response.Service, serviceID)
			}
			if response.Configured != tc.configured {
				t.Fatalf("configured = %v, want %v", response.Configured, tc.configured)
			}
		})
	}
}

func TestAccountProcessingPolicyDefaultsAndPersistsPatch(t *testing.T) {
	handler := newTestHandler(t, "http://example.test", true)

	req := httptest.NewRequest(http.MethodGet, "/usage-service/account-processing-policy", nil)
	req.Header.Set("Authorization", "Bearer management-key")
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("initial status = %d, body = %s", rr.Code, rr.Body.String())
	}
	var initial testAccountProcessingPolicyResponse
	if err := json.Unmarshal(rr.Body.Bytes(), &initial); err != nil {
		t.Fatalf("decode initial response: %v", err)
	}
	if !initial.CodexQuotaCooldown.Enabled || !initial.AuthIssueQueue.Enabled || !initial.AuthIssueAutoDisable.Enabled {
		t.Fatalf("initial policy = %#v", initial)
	}
	if initial.CodexQuotaCooldown.EnvKey != "CPA_CODEX_QUOTA_COOLDOWN_ENABLED" {
		t.Fatalf("quota env key = %q", initial.CodexQuotaCooldown.EnvKey)
	}
	if initial.AuthIssueAutoDisable.DependsOn != "authIssueQueue" {
		t.Fatalf("auto-disable dependency = %q", initial.AuthIssueAutoDisable.DependsOn)
	}

	body := bytes.NewBufferString(`{"authIssueQueueEnabled":false,"authIssueAutoDisableEnabled":true}`)
	req = httptest.NewRequest(http.MethodPatch, "/usage-service/account-processing-policy", body)
	req.Header.Set("Authorization", "Bearer management-key")
	rr = httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("patch status = %d, body = %s", rr.Code, rr.Body.String())
	}
	var patched testAccountProcessingPolicyResponse
	if err := json.Unmarshal(rr.Body.Bytes(), &patched); err != nil {
		t.Fatalf("decode patched response: %v", err)
	}
	if patched.AuthIssueQueue.Configured || patched.AuthIssueQueue.Enabled {
		t.Fatalf("auth issue queue after patch = %#v", patched.AuthIssueQueue)
	}
	if !patched.AuthIssueAutoDisable.Configured || patched.AuthIssueAutoDisable.Enabled {
		t.Fatalf("auto-disable should stay configured but blocked: %#v", patched.AuthIssueAutoDisable)
	}

	req = httptest.NewRequest(http.MethodGet, "/usage-service/account-processing-policy", nil)
	req.Header.Set("Authorization", "Bearer management-key")
	rr = httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("reload status = %d, body = %s", rr.Code, rr.Body.String())
	}
	var reloaded testAccountProcessingPolicyResponse
	if err := json.Unmarshal(rr.Body.Bytes(), &reloaded); err != nil {
		t.Fatalf("decode reloaded response: %v", err)
	}
	if reloaded.AuthIssueQueue.Configured || reloaded.AuthIssueQueue.Enabled {
		t.Fatalf("reloaded auth issue queue = %#v", reloaded.AuthIssueQueue)
	}
}

func TestAccountProcessingPolicyEnvLockRejectsPatch(t *testing.T) {
	clearHTTPAPIConfigEnv(t)
	dir := t.TempDir()
	t.Setenv("CPA_MANAGER_CONFIG", filepath.Join(dir, "config.json"))
	t.Setenv("CPA_CODEX_QUOTA_COOLDOWN_ENABLED", "false")
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("load config: %v", err)
	}
	handler := newTestHandlerWithConfig(t, cfg)

	req := httptest.NewRequest(http.MethodGet, "/usage-service/account-processing-policy", nil)
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("get status = %d, body = %s", rr.Code, rr.Body.String())
	}
	var response testAccountProcessingPolicyResponse
	if err := json.Unmarshal(rr.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if response.CodexQuotaCooldown.Configured || response.CodexQuotaCooldown.Enabled || !response.CodexQuotaCooldown.Locked {
		t.Fatalf("env-locked quota policy = %#v", response.CodexQuotaCooldown)
	}
	if response.CodexQuotaCooldown.Source != "env" {
		t.Fatalf("quota source = %q, want env", response.CodexQuotaCooldown.Source)
	}

	req = httptest.NewRequest(
		http.MethodPatch,
		"/usage-service/account-processing-policy",
		bytes.NewBufferString(`{"codexQuotaCooldownEnabled":true}`),
	)
	rr = httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusConflict {
		t.Fatalf("patch status = %d, body = %s", rr.Code, rr.Body.String())
	}
	if !strings.Contains(rr.Body.String(), `"code":"account_processing_policy_env_locked"`) {
		t.Fatalf("patch body = %s", rr.Body.String())
	}
}

func TestQuotaCooldownsEndpointReturnsEmptyItems(t *testing.T) {
	handler := newTestHandler(t, "http://example.test", true)
	req := httptest.NewRequest(http.MethodGet, "/usage-service/quota-cooldowns", nil)
	req.Header.Set("Authorization", "Bearer management-key")
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rr.Code, rr.Body.String())
	}
	if strings.TrimSpace(rr.Body.String()) != `{"items":[]}` {
		t.Fatalf("response body = %s", rr.Body.String())
	}
}

func TestHeaderSnapshotsEndpointReturnsRecentMetadata(t *testing.T) {
	cfg := config.Config{
		DBPath:      filepath.Join(t.TempDir(), "usage.sqlite"),
		Queue:       "usage",
		PopSide:     "right",
		CORSOrigins: []string{"*"},
	}
	db, err := store.Open(cfg.DBPath)
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() {
		_ = db.Close()
	})
	if err := db.SaveSetup(context.Background(), store.Setup{
		CPAUpstreamURL: "http://example.test",
		ManagementKey:  "management-key",
		Queue:          "usage",
		PopSide:        "right",
	}); err != nil {
		t.Fatalf("save setup: %v", err)
	}
	_, err = db.InsertEvents(context.Background(), []usage.Event{
		{
			EventHash:            "header-snapshot-event",
			TimestampMS:          time.Now().Add(-time.Hour).UnixMilli(),
			Timestamp:            time.Now().Add(-time.Hour).UTC().Format(time.RFC3339Nano),
			Provider:             "codex",
			Model:                "gpt-test",
			Endpoint:             "POST /v1/chat/completions",
			AuthIndex:            "auth-1",
			AccountSnapshot:      "alice@example.com",
			AuthFileSnapshot:     "alice.json",
			AuthProviderSnapshot: "codex",
			RawJSON: `{
				"response_metadata": {
					"quota": {"used_percent": 100, "plan_type": "free", "recover_at_ms": 1778000100000},
					"errors": {"kind": "usage_limit_reached", "code": "usage_limit_reached"},
					"trace": {"primary_trace_id": "trace-1"}
				}
			}`,
		},
	})
	if err != nil {
		t.Fatalf("insert events: %v", err)
	}

	handler := New(cfg, db, collector.NewManager(cfg, db)).Handler()
	req := httptest.NewRequest(http.MethodGet, "/v0/management/monitoring/header-snapshots?days=3&limit=100", nil)
	req.Header.Set("Authorization", "Bearer management-key")
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rr.Code, rr.Body.String())
	}
	var response struct {
		Items []struct {
			EventHash          string         `json:"event_hash"`
			AuthIndex          string         `json:"auth_index"`
			ResponseMetadata   map[string]any `json:"response_metadata"`
			HeaderErrorKind    string         `json:"header_error_kind"`
			HeaderErrorCode    string         `json:"header_error_code"`
			HeaderTraceID      string         `json:"header_trace_id"`
			HeaderQuotaPlan    string         `json:"header_quota_plan_type"`
			HeaderQuotaPercent *float64       `json:"header_quota_used_percent"`
		} `json:"items"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(response.Items) != 1 {
		t.Fatalf("items len = %d, body = %s", len(response.Items), rr.Body.String())
	}
	item := response.Items[0]
	if item.EventHash != "header-snapshot-event" || item.AuthIndex != "auth-1" || item.HeaderErrorKind != "usage_limit_reached" {
		t.Fatalf("snapshot item = %#v", item)
	}
	if item.HeaderQuotaPercent == nil || *item.HeaderQuotaPercent != 100 || item.HeaderQuotaPlan != "free" {
		t.Fatalf("quota fields = %#v", item)
	}
}

func TestAccountActionCandidatesEndpointReturnsPendingItems(t *testing.T) {
	cfg := config.Config{
		DBPath:      filepath.Join(t.TempDir(), "usage.sqlite"),
		Queue:       "usage",
		PopSide:     "right",
		CORSOrigins: []string{"*"},
	}
	db, err := store.Open(cfg.DBPath)
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() {
		_ = db.Close()
	})
	if err := db.SaveSetup(context.Background(), store.Setup{
		CPAUpstreamURL: "http://example.test",
		ManagementKey:  "management-key",
		Queue:          "usage",
		PopSide:        "right",
	}); err != nil {
		t.Fatalf("save setup: %v", err)
	}
	_, err = db.InsertEvents(context.Background(), []usage.Event{
		{
			EventHash:            "account-action-event",
			TimestampMS:          time.Now().UnixMilli(),
			Timestamp:            time.Now().UTC().Format(time.RFC3339Nano),
			Provider:             "codex",
			Model:                "gpt-test",
			Endpoint:             "POST /v1/chat/completions",
			AuthIndex:            "auth-1",
			AccountSnapshot:      "alice@example.com",
			AuthFileSnapshot:     "alice.json",
			AuthProviderSnapshot: "codex",
			Failed:               true,
			RawJSON: `{
				"response_metadata": {
					"errors": {"kind": "usage_limit_reached", "code": "usage_limit_reached"},
					"trace": {"primary_trace_id": "trace-1"}
				}
			}`,
		},
	})
	if err != nil {
		t.Fatalf("insert events: %v", err)
	}

	handler := New(cfg, db, collector.NewManager(cfg, db)).Handler()
	req := httptest.NewRequest(http.MethodGet, "/v0/management/account-action-candidates?status=pending&limit=20", nil)
	req.Header.Set("Authorization", "Bearer management-key")
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rr.Code, rr.Body.String())
	}
	var response struct {
		PendingCount int `json:"pendingCount"`
		Items        []struct {
			ID           int64          `json:"id"`
			ActionType   string         `json:"actionType"`
			Status       string         `json:"status"`
			AuthFileName string         `json:"authFileName"`
			AuthIndex    string         `json:"authIndex"`
			Evidence     map[string]any `json:"evidence"`
		} `json:"items"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if response.PendingCount != 1 || len(response.Items) != 1 {
		t.Fatalf("response = %#v body=%s", response, rr.Body.String())
	}
	item := response.Items[0]
	if item.ID == 0 || item.ActionType != "review" || item.Status != "pending" || item.AuthFileName != "alice.json" || item.AuthIndex != "auth-1" {
		t.Fatalf("candidate = %#v", item)
	}
	if item.Evidence["headerErrorKind"] != "usage_limit_reached" {
		t.Fatalf("candidate evidence = %#v", item.Evidence)
	}
}

func clearHTTPAPIConfigEnv(t *testing.T) {
	t.Helper()
	for _, key := range []string{
		"CPA_MANAGER_CONFIG",
		"HTTP_ADDR",
		"USAGE_DATA_DIR",
		"USAGE_DB_PATH",
		"CPA_UPSTREAM_URL",
		"CPA_MANAGEMENT_KEY",
		"CPA_MANAGEMENT_KEY_FILE",
		"USAGE_COLLECTOR_MODE",
		"USAGE_RESP_QUEUE",
		"USAGE_RESP_POP_SIDE",
		"USAGE_BATCH_SIZE",
		"USAGE_POLL_INTERVAL_MS",
		"USAGE_QUERY_LIMIT",
		"USAGE_CORS_ORIGINS",
		"USAGE_RESP_TLS_SKIP_VERIFY",
		"PANEL_PATH",
		"CPA_CODEX_QUOTA_COOLDOWN_ENABLED",
		"CPA_AUTH_ISSUE_QUEUE_ENABLED",
		"CPA_AUTH_ISSUE_AUTO_DISABLE_ENABLED",
	} {
		t.Setenv(key, "")
	}
}

func TestUsageImportAcceptsLegacyExportAndSkipsDuplicates(t *testing.T) {
	handler := newTestHandler(t, "http://example.test", true)
	payload := `{
	  "version": 1,
	  "exported_at": "2026-01-02T03:04:05Z",
	  "usage": {
	    "apis": {
	      "POST /v1/chat/completions": {
	        "models": {
	          "gpt-4o": {
	            "details": [
	              {
	                "timestamp": "2026-01-02T03:04:05Z",
	                "source": "alice@example.com",
	                "auth_index": "auth-1",
	                "tokens": {
	                  "input_tokens": 10,
	                  "output_tokens": 20,
	                  "total_tokens": 30
	                },
	                "failed": false
	              }
	            ]
	          }
	        }
	      }
	    }
	  }
	}`

	first := postUsageImport(t, handler, payload)
	if first.Format != "legacy_usage_export" || first.Added != 1 || first.Skipped != 0 || first.Total != 1 {
		t.Fatalf("first import = %#v", first)
	}
	if len(first.Warnings) == 0 {
		t.Fatalf("expected legacy warnings: %#v", first)
	}

	second := postUsageImport(t, handler, payload)
	if second.Format != "legacy_usage_export" || second.Added != 0 || second.Skipped != 1 || second.Total != 1 {
		t.Fatalf("second import = %#v", second)
	}
}

func TestUsageSummaryReturnsAggregatesWithoutDetails(t *testing.T) {
	handler := newTestHandler(t, "http://example.test", true)
	payload := `{
	  "version": 1,
	  "exported_at": "2026-01-02T03:04:05Z",
	  "usage": {
	    "apis": {
	      "POST /v1/chat/completions": {
	        "models": {
	          "gpt-4o": {
	            "details": [
	              {
	                "timestamp": "2026-01-02T03:04:05Z",
	                "source": "alice@example.com",
	                "tokens": {"input_tokens": 10, "output_tokens": 20, "total_tokens": 30},
	                "failed": false
	              }
	            ]
	          }
	        }
	      }
	    }
	  }
	}`
	postUsageImport(t, handler, payload)

	req := httptest.NewRequest(http.MethodGet, "/v0/management/usage/summary", nil)
	req.Header.Set("Authorization", "Bearer management-key")
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("summary status = %d, body = %s", rr.Code, rr.Body.String())
	}

	var response struct {
		TotalRequests int64          `json:"total_requests"`
		SuccessCount  int64          `json:"success_count"`
		FailureCount  int64          `json:"failure_count"`
		TotalTokens   int64          `json:"total_tokens"`
		LatencySumMS  int64          `json:"latency_sum_ms"`
		LatencyCount  int64          `json:"latency_count"`
		APIs          map[string]any `json:"apis"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode summary: %v", err)
	}
	if response.TotalRequests != 1 || response.SuccessCount != 1 || response.FailureCount != 0 || response.TotalTokens != 30 {
		t.Fatalf("summary = %#v", response)
	}
	if response.LatencySumMS != 0 || response.LatencyCount != 0 {
		t.Fatalf("summary latency = sum:%d count:%d", response.LatencySumMS, response.LatencyCount)
	}
	if len(response.APIs) != 0 {
		t.Fatalf("summary APIs len = %d, want no detail aggregates", len(response.APIs))
	}
}

func TestMonitoringAnalyticsReturnsUsageAggregates(t *testing.T) {
	handler := newTestHandler(t, "http://example.test", true)
	payload := `[
	  {
	    "request_id":"req-1",
	    "event_hash":"event-1",
	    "timestamp_ms":1782270000000,
	    "timestamp":"2026-06-24T00:20:00Z",
	    "provider":"codex",
	    "model":"gpt-4o",
	    "endpoint":"POST /v1/chat/completions",
	    "method":"POST",
	    "path":"/v1/chat/completions",
	    "auth_index":"auth-1",
	    "source":"alice@example.com",
	    "api_key_hash":"hash-test-key",
	    "account_snapshot":"alice@example.com",
	    "auth_label_snapshot":"Alice",
	    "auth_file_snapshot":"alice.json",
	    "auth_provider_snapshot":"codex",
	    "input_tokens":10,
	    "output_tokens":20,
	    "cached_tokens":3,
	    "total_tokens":30,
	    "latency_ms":120,
	    "failed":false
	  },
	  {
	    "request_id":"req-2",
	    "event_hash":"event-2",
	    "timestamp_ms":1782273600000,
	    "timestamp":"2026-06-24T01:20:00Z",
	    "provider":"codex",
	    "model":"gpt-4o",
	    "endpoint":"POST /v1/chat/completions",
	    "method":"POST",
	    "path":"/v1/chat/completions",
	    "auth_index":"auth-1",
	    "source":"alice@example.com",
	    "api_key_hash":"hash-test-key",
	    "account_snapshot":"alice@example.com",
	    "auth_label_snapshot":"Alice",
	    "auth_file_snapshot":"alice.json",
	    "auth_provider_snapshot":"codex",
	    "input_tokens":5,
	    "output_tokens":7,
	    "total_tokens":12,
	    "latency_ms":300,
	    "failed":true
	  }
	]`
	postUsageImport(t, handler, payload)

	req := httptest.NewRequest(
		http.MethodPost,
		"/v0/management/monitoring/analytics",
		strings.NewReader(`{
		  "from_ms":1782266400000,
		  "to_ms":1782280000000,
		  "include":{
		    "summary":true,
		    "timeline":true,
		    "model_stats":true,
		    "channel_share":true,
		    "account_stats":true,
		    "api_key_stats":true,
		    "filter_options":true,
		    "events_page":{"limit":10}
		  }
		}`),
	)
	req.Header.Set("Authorization", "Bearer management-key")
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("analytics status = %d, body = %s", rr.Code, rr.Body.String())
	}
	var response struct {
		GeneratedAtMS int64  `json:"generated_at_ms"`
		Granularity   string `json:"granularity"`
		Summary       struct {
			TotalCalls     int64   `json:"total_calls"`
			SuccessCalls   int64   `json:"success_calls"`
			FailureCalls   int64   `json:"failure_calls"`
			SuccessRate    float64 `json:"success_rate"`
			InputTokens    int64   `json:"input_tokens"`
			OutputTokens   int64   `json:"output_tokens"`
			CachedTokens   int64   `json:"cached_tokens"`
			TotalTokens    int64   `json:"total_tokens"`
			AverageLatency *int64  `json:"average_latency_ms"`
		} `json:"summary"`
		Timeline []struct {
			Calls  int64 `json:"calls"`
			Tokens int64 `json:"tokens"`
		} `json:"timeline"`
		ModelStats []struct {
			Model       string `json:"model"`
			Calls       int64  `json:"calls"`
			TotalTokens int64  `json:"total_tokens"`
		} `json:"model_stats"`
		ChannelShare []struct {
			AuthIndex string `json:"auth_index"`
			Calls     int64  `json:"calls"`
		} `json:"channel_share"`
		Events struct {
			Items []struct {
				RequestID string `json:"request_id"`
			} `json:"items"`
			TotalCount int64 `json:"total_count"`
		} `json:"events"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode analytics response: %v", err)
	}
	if response.GeneratedAtMS <= 0 || response.Granularity != "hour" {
		t.Fatalf("response metadata = %#v", response)
	}
	if response.Summary.TotalCalls != 2 || response.Summary.SuccessCalls != 1 || response.Summary.FailureCalls != 1 {
		t.Fatalf("summary counts = %#v", response.Summary)
	}
	if response.Summary.InputTokens != 15 || response.Summary.OutputTokens != 27 || response.Summary.CachedTokens != 3 || response.Summary.TotalTokens != 42 {
		t.Fatalf("summary tokens = %#v", response.Summary)
	}
	if response.Summary.AverageLatency == nil || *response.Summary.AverageLatency != 210 {
		t.Fatalf("average latency = %#v", response.Summary.AverageLatency)
	}
	if len(response.Timeline) == 0 || response.Timeline[0].Calls == 0 {
		t.Fatalf("timeline = %#v", response.Timeline)
	}
	if len(response.ModelStats) != 1 || response.ModelStats[0].Model != "gpt-4o" || response.ModelStats[0].Calls != 2 {
		t.Fatalf("model stats = %#v", response.ModelStats)
	}
	if len(response.ChannelShare) != 1 || response.ChannelShare[0].AuthIndex != "auth-1" || response.ChannelShare[0].Calls != 2 {
		t.Fatalf("channel share = %#v", response.ChannelShare)
	}
	if response.Events.TotalCount != 2 || len(response.Events.Items) != 2 || response.Events.Items[0].RequestID != "req-2" {
		t.Fatalf("events = %#v", response.Events)
	}
}

func TestDashboardSummaryServesLocalUsageAggregates(t *testing.T) {
	upstreamCalled := false
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		upstreamCalled = true
		http.NotFound(w, r)
	}))
	t.Cleanup(upstream.Close)

	handler := newTestHandler(t, upstream.URL, true)
	payload := `[
	  {
	    "request_id":"req-1",
	    "event_hash":"event-1",
	    "timestamp_ms":1782270000000,
	    "timestamp":"2026-06-24T00:20:00Z",
	    "provider":"codex",
	    "model":"gpt-4o",
	    "endpoint":"POST /v1/chat/completions",
	    "method":"POST",
	    "path":"/v1/chat/completions",
	    "auth_index":"auth-1",
	    "source":"alice@example.com",
	    "api_key_hash":"hash-test-key",
	    "account_snapshot":"alice@example.com",
	    "auth_label_snapshot":"Alice",
	    "auth_provider_snapshot":"codex",
	    "input_tokens":10,
	    "output_tokens":20,
	    "cached_tokens":3,
	    "total_tokens":30,
	    "latency_ms":120,
	    "failed":false
	  },
	  {
	    "request_id":"req-2",
	    "event_hash":"event-2",
	    "timestamp_ms":1782273600000,
	    "timestamp":"2026-06-24T01:20:00Z",
	    "provider":"codex",
	    "model":"gpt-4o",
	    "endpoint":"POST /v1/chat/completions",
	    "method":"POST",
	    "path":"/v1/chat/completions",
	    "auth_index":"auth-1",
	    "source":"alice@example.com",
	    "api_key_hash":"hash-test-key",
	    "account_snapshot":"alice@example.com",
	    "auth_label_snapshot":"Alice",
	    "auth_provider_snapshot":"codex",
	    "input_tokens":5,
	    "output_tokens":7,
	    "total_tokens":12,
	    "latency_ms":300,
	    "failed":true,
	    "raw_json":"{\"fail_status_code\":429}"
	  }
	]`
	postUsageImport(t, handler, payload)

	req := httptest.NewRequest(
		http.MethodGet,
		"/v0/management/dashboard/summary?today_start_ms=1782266400000&now_ms=1782274200000&top_models=5&recent_failures=5",
		nil,
	)
	req.Header.Set("Authorization", "Bearer management-key")
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if upstreamCalled {
		t.Fatal("dashboard summary should be served locally, but upstream was called")
	}
	if rr.Code != http.StatusOK {
		t.Fatalf("dashboard summary status = %d, body = %s", rr.Code, rr.Body.String())
	}
	var response struct {
		Today struct {
			TotalCalls    int64 `json:"total_calls"`
			SuccessCalls  int64 `json:"success_calls"`
			FailureCalls  int64 `json:"failure_calls"`
			InputTokens   int64 `json:"input_tokens"`
			OutputTokens  int64 `json:"output_tokens"`
			CachedTokens  int64 `json:"cached_tokens"`
			TotalTokens   int64 `json:"total_tokens"`
			ZeroTokenCall int64 `json:"zero_token_calls"`
		} `json:"today"`
		Rolling30M struct {
			TotalCalls  int64 `json:"total_calls"`
			TotalTokens int64 `json:"total_tokens"`
		} `json:"rolling_30m"`
		TopModelsToday []struct {
			Model string `json:"model"`
			Calls int64  `json:"calls"`
		} `json:"top_models_today"`
		RecentFailures []struct {
			Model          string `json:"model"`
			AuthIndex      string `json:"auth_index"`
			FailStatusCode *int64 `json:"fail_status_code"`
		} `json:"recent_failures"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode dashboard summary response: %v", err)
	}
	if response.Today.TotalCalls != 2 || response.Today.SuccessCalls != 1 || response.Today.FailureCalls != 1 {
		t.Fatalf("today counts = %#v", response.Today)
	}
	if response.Today.InputTokens != 15 || response.Today.OutputTokens != 27 || response.Today.CachedTokens != 3 || response.Today.TotalTokens != 42 {
		t.Fatalf("today tokens = %#v", response.Today)
	}
	if response.Rolling30M.TotalCalls != 1 || response.Rolling30M.TotalTokens != 12 {
		t.Fatalf("rolling_30m = %#v", response.Rolling30M)
	}
	if len(response.TopModelsToday) != 1 || response.TopModelsToday[0].Model != "gpt-4o" || response.TopModelsToday[0].Calls != 2 {
		t.Fatalf("top models = %#v", response.TopModelsToday)
	}
	if len(response.RecentFailures) != 1 || response.RecentFailures[0].Model != "gpt-4o" || response.RecentFailures[0].AuthIndex != "auth-1" {
		t.Fatalf("recent failures = %#v", response.RecentFailures)
	}
	if response.RecentFailures[0].FailStatusCode == nil || *response.RecentFailures[0].FailStatusCode != 429 {
		t.Fatalf("recent failure status = %#v", response.RecentFailures[0].FailStatusCode)
	}
}

func TestLatestVersionServesLocalFallback(t *testing.T) {
	upstreamCalled := false
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		upstreamCalled = true
		http.NotFound(w, r)
	}))
	t.Cleanup(upstream.Close)

	handler := newTestHandler(t, upstream.URL, true)
	req := httptest.NewRequest(http.MethodGet, "/v0/management/latest-version", nil)
	req.Header.Set("Authorization", "Bearer management-key")
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if upstreamCalled {
		t.Fatal("latest-version should be served locally, but upstream was called")
	}
	if rr.Code != http.StatusOK {
		t.Fatalf("latest-version status = %d, body = %s", rr.Code, rr.Body.String())
	}
	var response map[string]any
	if err := json.Unmarshal(rr.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode latest-version response: %v", err)
	}
	if response["latest_version"] == nil || response["latest-version"] == nil {
		t.Fatalf("latest-version response = %#v", response)
	}
}

func TestUsageBreakdownPageEndpointsReturnPagination(t *testing.T) {
	handler := newTestHandler(t, "http://example.test", true)
	payload := `{
	  "version": 1,
	  "exported_at": "2026-01-02T03:04:05Z",
	  "usage": {
	    "apis": {
	      "POST /v1/chat/completions": {
	        "models": {
	          "gpt-4o": {
	            "details": [
	              {
	                "timestamp": "2026-01-02T03:04:05Z",
	                "source": "alice@example.com",
	                "auth_index": "auth-1",
	                "api_key_hash": "key-a",
	                "account_snapshot": "alice@example.com",
	                "tokens": {"input_tokens": 10, "output_tokens": 20, "total_tokens": 30},
	                "failed": false
	              },
	              {
	                "timestamp": "2026-01-02T03:04:06Z",
	                "source": "bob@example.com",
	                "auth_index": "auth-2",
	                "api_key_hash": "key-b",
	                "account_snapshot": "bob@example.com",
	                "tokens": {"input_tokens": 15, "output_tokens": 25, "total_tokens": 40},
	                "failed": false
	              }
	            ]
	          }
	        }
	      }
	    }
	  }
	}`
	postUsageImport(t, handler, payload)

	for _, path := range []string{
		"/v0/management/usage/accounts?page=1&page_size=1",
		"/v0/management/usage/api-keys?page=1&page_size=1",
		"/v0/management/usage/realtime?page=1&page_size=1",
		"/v0/management/usage/models?page=1&page_size=1",
	} {
		t.Run(path, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, path, nil)
			req.Header.Set("Authorization", "Bearer management-key")
			rr := httptest.NewRecorder()
			handler.ServeHTTP(rr, req)
			if rr.Code != http.StatusOK {
				t.Fatalf("status = %d, body = %s", rr.Code, rr.Body.String())
			}

			var response struct {
				Page       int             `json:"page"`
				PageSize   int             `json:"page_size"`
				TotalItems int64           `json:"total_items"`
				Usage      json.RawMessage `json:"usage"`
				Items      json.RawMessage `json:"items"`
			}
			if err := json.Unmarshal(rr.Body.Bytes(), &response); err != nil {
				t.Fatalf("decode response: %v", err)
			}
			wantTotalItems := int64(2)
			if strings.Contains(path, "/models") {
				wantTotalItems = 1
			}
			if response.Page != 1 || response.PageSize != 1 || response.TotalItems != wantTotalItems {
				t.Fatalf("pagination response = %#v", response)
			}
			if len(response.Usage) == 0 || string(response.Usage) == "null" {
				t.Fatalf("missing usage payload: %#v", response)
			}
			if !strings.Contains(path, "/models") && (len(response.Items) == 0 || string(response.Items) == "null") {
				t.Fatalf("missing direct page items: %#v", response)
			}
			if !strings.Contains(path, "/models") && strings.Contains(string(response.Usage), `"apis":{"`) {
				t.Fatalf("non-model page should not return endpoint detail aggregates: %s", response.Usage)
			}
		})
	}
}

func TestUsageBreakdownPageRejectsUnsafePageFilters(t *testing.T) {
	handler := newTestHandler(t, "http://example.test", true)
	for _, path := range []string{
		"/v0/management/usage/accounts?page=1&page_size=501",
		"/v0/management/usage/accounts?page=1&page_size=1&sort_key=timestamp_ms%20desc",
	} {
		t.Run(path, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, path, nil)
			req.Header.Set("Authorization", "Bearer management-key")
			rr := httptest.NewRecorder()
			handler.ServeHTTP(rr, req)
			if rr.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, body = %s", rr.Code, rr.Body.String())
			}
		})
	}
}

func postUsageImport(t *testing.T, handler http.Handler, payload string) struct {
	Format      string   `json:"format"`
	Added       int      `json:"added"`
	Skipped     int      `json:"skipped"`
	Total       int      `json:"total"`
	Failed      int      `json:"failed"`
	Unsupported int      `json:"unsupported"`
	Warnings    []string `json:"warnings"`
} {
	t.Helper()

	req := httptest.NewRequest(http.MethodPost, "/v0/management/usage/import", strings.NewReader(payload))
	req.Header.Set("Authorization", "Bearer management-key")
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("import status = %d, body = %s", rr.Code, rr.Body.String())
	}
	var response struct {
		Format      string   `json:"format"`
		Added       int      `json:"added"`
		Skipped     int      `json:"skipped"`
		Total       int      `json:"total"`
		Failed      int      `json:"failed"`
		Unsupported int      `json:"unsupported"`
		Warnings    []string `json:"warnings"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	return response
}

func TestModelListProxyRequiresSetup(t *testing.T) {
	handler := newTestHandler(t, "", false)
	req := httptest.NewRequest(http.MethodGet, "/v1/models", nil)
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusPreconditionRequired {
		t.Fatalf("status = %d, body = %s", rr.Code, rr.Body.String())
	}
	if !strings.Contains(rr.Body.String(), "usage service is not configured") {
		t.Fatalf("response body = %s", rr.Body.String())
	}
}

func TestSetupRejectsDifferentUpstreamWithoutExistingAuthorization(t *testing.T) {
	currentUpstream := httptest.NewServer(http.NotFoundHandler())
	t.Cleanup(currentUpstream.Close)

	nextValidationCalled := make(chan struct{}, 1)
	nextUpstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		select {
		case nextValidationCalled <- struct{}{}:
		default:
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{}`))
	}))
	t.Cleanup(nextUpstream.Close)

	handler := newTestHandler(t, currentUpstream.URL, true)
	req := httptest.NewRequest(
		http.MethodPost,
		"/setup",
		bytes.NewBufferString(`{"cpaBaseUrl":"`+nextUpstream.URL+`","managementKey":"rotated-key"}`),
	)
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("setup status = %d, body = %s", rr.Code, rr.Body.String())
	}
	select {
	case <-nextValidationCalled:
		t.Fatal("new upstream should not be validated without existing setup authorization")
	default:
	}
}

func TestSetupAllowsKeyRotationForSameUpstreamWithValidNewKey(t *testing.T) {
	observed := make(chan observedRequest, 10)
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/v0/management/config" {
			observed <- observedRequest{
				path: r.URL.Path,
				auth: r.Header.Get("Authorization"),
			}
		}
		if r.URL.Path == "/v0/management/config" && r.Header.Get("Authorization") == "Bearer rotated-key" {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{}`))
			return
		}
		if r.URL.Path == "/v0/management/usage-statistics-enabled" &&
			r.Method == http.MethodPut &&
			r.Header.Get("Authorization") == "Bearer rotated-key" {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"ok":true}`))
			return
		}
		http.Error(w, "forbidden", http.StatusForbidden)
	}))
	t.Cleanup(upstream.Close)

	handler := newTestHandler(t, upstream.URL, true)
	req := httptest.NewRequest(
		http.MethodPost,
		"/setup",
		bytes.NewBufferString(`{"cpaBaseUrl":"`+upstream.URL+`","managementKey":"rotated-key"}`),
	)
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("setup status = %d, body = %s", rr.Code, rr.Body.String())
	}
	got := <-observed
	if got.path != "/v0/management/config" {
		t.Fatalf("validation path = %q", got.path)
	}
	if got.auth != "Bearer rotated-key" {
		t.Fatalf("validation authorization = %q", got.auth)
	}

	req = httptest.NewRequest(http.MethodGet, "/status", nil)
	req.Header.Set("Authorization", "Bearer rotated-key")
	rr = httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status after rotation = %d, body = %s", rr.Code, rr.Body.String())
	}
}

func TestSetupRejectsKeyRotationWhenSetupIsEnvironmentManaged(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/v0/management/config" && r.Header.Get("Authorization") == "Bearer rotated-key" {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{}`))
			return
		}
		http.Error(w, "forbidden", http.StatusForbidden)
	}))
	t.Cleanup(upstream.Close)

	handler := newTestHandlerWithConfig(t, config.Config{
		CPAUpstreamURL: upstream.URL,
		ManagementKey:  "env-key",
		Queue:          "usage",
		PopSide:        "right",
	})
	req := httptest.NewRequest(
		http.MethodPost,
		"/setup",
		bytes.NewBufferString(`{"cpaBaseUrl":"`+upstream.URL+`","managementKey":"rotated-key"}`),
	)
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusConflict {
		t.Fatalf("setup status = %d, body = %s", rr.Code, rr.Body.String())
	}
	if !strings.Contains(rr.Body.String(), "environment") {
		t.Fatalf("response body = %s", rr.Body.String())
	}
}

func TestManagerConfigRejectsPollIntervalAboveRetention(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/v0/management/config" && r.Header.Get("Authorization") == "Bearer management-key" {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"usage-statistics-enabled":true,"redis-usage-queue-retention-seconds":1}`))
			return
		}
		http.Error(w, "forbidden", http.StatusForbidden)
	}))
	t.Cleanup(upstream.Close)

	handler := newTestHandler(t, upstream.URL, true)
	body := bytes.NewBufferString(`{"config":{"cpaConnection":{"cpaBaseUrl":"` + upstream.URL + `","managementKey":"management-key"},"collector":{"collectorMode":"auto","queue":"usage","popSide":"right","batchSize":100,"pollIntervalMs":2000,"queryLimit":50000},"externalUsageService":{"enabled":true,"serviceBase":"http://usage.test"}}}`)
	req := httptest.NewRequest(http.MethodPut, "/usage-service/config", body)
	req.Header.Set("Authorization", "Bearer management-key")
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("save status = %d, body = %s", rr.Code, rr.Body.String())
	}
	if !strings.Contains(rr.Body.String(), "pollIntervalMs") {
		t.Fatalf("response body = %s", rr.Body.String())
	}
	if !strings.Contains(rr.Body.String(), `"code":"poll_interval_exceeds_retention"`) {
		t.Fatalf("response body = %s", rr.Body.String())
	}
}

func TestManagerConfigPreservesSubscribeCollectorMode(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/v0/management/config" && r.Header.Get("Authorization") == "Bearer management-key" {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"usage-statistics-enabled":true}`))
			return
		}
		http.Error(w, "forbidden", http.StatusForbidden)
	}))
	t.Cleanup(upstream.Close)

	handler := newTestHandler(t, upstream.URL, true)
	body := bytes.NewBufferString(`{"config":{"cpaConnection":{"cpaBaseUrl":"` + upstream.URL + `","managementKey":"management-key"},"collector":{"enabled":false,"collectorMode":"subscribe","queue":"usage","popSide":"right","batchSize":100,"pollIntervalMs":500,"queryLimit":50000},"externalUsageService":{"enabled":false}}}`)
	req := httptest.NewRequest(http.MethodPut, "/usage-service/config", body)
	req.Header.Set("Authorization", "Bearer management-key")
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("save status = %d, body = %s", rr.Code, rr.Body.String())
	}
	var response managerConfigResponse
	if err := json.Unmarshal(rr.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if response.Config.Collector.CollectorMode != "subscribe" {
		t.Fatalf("collectorMode = %q, want subscribe", response.Config.Collector.CollectorMode)
	}
}

func TestManagerConfigReadsLegacySetup(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/v0/management/config" && r.Header.Get("Authorization") == "Bearer management-key" {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"usage-statistics-enabled":true}`))
			return
		}
		http.Error(w, "forbidden", http.StatusForbidden)
	}))
	t.Cleanup(upstream.Close)

	handler := newTestHandler(t, upstream.URL, true)
	req := httptest.NewRequest(http.MethodGet, "/usage-service/config", nil)
	req.Header.Set("Authorization", "Bearer management-key")
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("config status = %d, body = %s", rr.Code, rr.Body.String())
	}
	if !strings.Contains(rr.Body.String(), `"source":"db"`) {
		t.Fatalf("response body = %s", rr.Body.String())
	}
	if !strings.Contains(rr.Body.String(), upstream.URL) {
		t.Fatalf("response body = %s", rr.Body.String())
	}
	if !strings.Contains(rr.Body.String(), `"enabled":true`) {
		t.Fatalf("response body = %s", rr.Body.String())
	}
}

func TestSetupCanDisableRequestMonitoring(t *testing.T) {
	configCalls := 0
	enableCalls := 0
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/v0/management/config" && r.Header.Get("Authorization") == "Bearer management-key" {
			configCalls++
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"usage-statistics-enabled":false,"redis-usage-queue-retention-seconds":1}`))
			return
		}
		if r.URL.Path == "/v0/management/usage-statistics-enabled" {
			enableCalls++
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"ok":true}`))
			return
		}
		http.Error(w, "forbidden", http.StatusForbidden)
	}))
	t.Cleanup(upstream.Close)

	handler := newTestHandler(t, upstream.URL, false)
	body := bytes.NewBufferString(`{"cpaBaseUrl":"` + upstream.URL + `","managementKey":"management-key","requestMonitoringEnabled":false,"ensureUsageStatisticsEnabled":false}`)
	req := httptest.NewRequest(http.MethodPost, "/setup", body)
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("setup status = %d, body = %s", rr.Code, rr.Body.String())
	}
	if configCalls != 1 {
		t.Fatalf("config calls = %d, want 1", configCalls)
	}
	if enableCalls != 0 {
		t.Fatalf("enable calls = %d, want 0", enableCalls)
	}

	statusReq := httptest.NewRequest(http.MethodGet, "/status", nil)
	statusReq.Header.Set("Authorization", "Bearer management-key")
	statusRR := httptest.NewRecorder()
	handler.ServeHTTP(statusRR, statusReq)

	if statusRR.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", statusRR.Code, statusRR.Body.String())
	}
	if !strings.Contains(statusRR.Body.String(), `"collector":"stopped"`) {
		t.Fatalf("status body = %s", statusRR.Body.String())
	}

	configReq := httptest.NewRequest(http.MethodGet, "/usage-service/config", nil)
	configReq.Header.Set("Authorization", "Bearer management-key")
	configRR := httptest.NewRecorder()
	handler.ServeHTTP(configRR, configReq)

	if configRR.Code != http.StatusOK {
		t.Fatalf("config status = %d, body = %s", configRR.Code, configRR.Body.String())
	}
	if !strings.Contains(configRR.Body.String(), `"enabled":false`) {
		t.Fatalf("config body = %s", configRR.Body.String())
	}
}

func TestModelPricesSaveAndLoad(t *testing.T) {
	handler := newTestHandler(t, "http://example.test", true)
	body := bytes.NewBufferString(`{"prices":{"gpt-test":{"prompt":1.25,"completion":2.5,"cache":0.1}}}`)
	req := httptest.NewRequest(http.MethodPut, "/v0/management/model-prices", body)
	req.Header.Set("Authorization", "Bearer management-key")
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("save status = %d, body = %s", rr.Code, rr.Body.String())
	}

	req = httptest.NewRequest(http.MethodGet, "/v0/management/model-prices", nil)
	req.Header.Set("Authorization", "Bearer management-key")
	rr = httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("load status = %d, body = %s", rr.Code, rr.Body.String())
	}
	var response struct {
		Prices map[string]struct {
			Prompt     float64 `json:"prompt"`
			Completion float64 `json:"completion"`
			Cache      float64 `json:"cache"`
		} `json:"prices"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	price, ok := response.Prices["gpt-test"]
	if !ok {
		t.Fatalf("missing saved price: %#v", response.Prices)
	}
	if price.Prompt != 1.25 || price.Completion != 2.5 || price.Cache != 0.1 {
		t.Fatalf("price = %#v", price)
	}
}

func TestAPIKeyAliasesSaveLoadAndDelete(t *testing.T) {
	handler := newTestHandler(t, "http://example.test", true)
	const hash = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
	body := bytes.NewBufferString(`{"items":[{"apiKeyHash":"` + hash + `","alias":"Team A"}]}`)
	req := httptest.NewRequest(http.MethodPut, "/v0/management/api-key-aliases", body)
	req.Header.Set("Authorization", "Bearer management-key")
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("save status = %d, body = %s", rr.Code, rr.Body.String())
	}

	req = httptest.NewRequest(http.MethodGet, "/v0/management/api-key-aliases", nil)
	req.Header.Set("Authorization", "Bearer management-key")
	rr = httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("load status = %d, body = %s", rr.Code, rr.Body.String())
	}
	var response struct {
		Items []struct {
			APIKeyHash  string `json:"apiKeyHash"`
			Alias       string `json:"alias"`
			UpdatedAtMS int64  `json:"updatedAtMs"`
		} `json:"items"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(response.Items) != 1 {
		t.Fatalf("items = %#v", response.Items)
	}
	if response.Items[0].APIKeyHash != hash || response.Items[0].Alias != "Team A" || response.Items[0].UpdatedAtMS <= 0 {
		t.Fatalf("alias = %#v", response.Items[0])
	}

	const otherHash = "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789"
	req = httptest.NewRequest(
		http.MethodPut,
		"/v0/management/api-key-aliases",
		bytes.NewBufferString(`{"items":[{"apiKeyHash":"`+otherHash+`","alias":" team a "}]}`),
	)
	req.Header.Set("Authorization", "Bearer management-key")
	rr = httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("duplicate status = %d, body = %s", rr.Code, rr.Body.String())
	}
	if !strings.Contains(rr.Body.String(), `"code":"api_key_alias_duplicate"`) {
		t.Fatalf("duplicate body = %s", rr.Body.String())
	}

	req = httptest.NewRequest(http.MethodDelete, "/v0/management/api-key-aliases/"+hash, nil)
	req.Header.Set("Authorization", "Bearer management-key")
	rr = httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("delete status = %d, body = %s", rr.Code, rr.Body.String())
	}
}

func TestAPIKeyAliasesActiveHashesMigration(t *testing.T) {
	handler := newTestHandler(t, "http://example.test", true)
	const orphanHash = "1111111111111111111111111111111111111111111111111111111111111111"
	const newHash = "2222222222222222222222222222222222222222222222222222222222222222"
	const activeHash = "3333333333333333333333333333333333333333333333333333333333333333"

	// 预置：orphanHash 关联 team-a（模拟编辑/删除密钥后留下的孤儿映射）。
	seed := bytes.NewBufferString(`{"items":[{"apiKeyHash":"` + orphanHash + `","alias":"team-a"},{"apiKeyHash":"` + activeHash + `","alias":"team-b"}]}`)
	req := httptest.NewRequest(http.MethodPut, "/v0/management/api-key-aliases", seed)
	req.Header.Set("Authorization", "Bearer management-key")
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("seed status = %d, body = %s", rr.Code, rr.Body.String())
	}

	// 编辑/重建场景：新 hash 想复用 team-a，orphanHash 不在活跃集合，应放行并清理孤儿。
	migrate := bytes.NewBufferString(`{"items":[{"apiKeyHash":"` + newHash + `","alias":"team-a"}],"activeApiKeyHashes":["` + newHash + `","` + activeHash + `"]}`)
	req = httptest.NewRequest(http.MethodPut, "/v0/management/api-key-aliases", migrate)
	req.Header.Set("Authorization", "Bearer management-key")
	rr = httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("migrate status = %d, body = %s", rr.Code, rr.Body.String())
	}

	var response struct {
		Items []struct {
			APIKeyHash string `json:"apiKeyHash"`
			Alias      string `json:"alias"`
		} `json:"items"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	hashByAlias := map[string]string{}
	for _, item := range response.Items {
		hashByAlias[item.Alias] = item.APIKeyHash
	}
	if hashByAlias["team-a"] != newHash {
		t.Fatalf("team-a should belong to newHash, got %#v", response.Items)
	}
	if hashByAlias["team-b"] != activeHash {
		t.Fatalf("team-b should remain on activeHash, got %#v", response.Items)
	}
	if len(response.Items) != 2 {
		t.Fatalf("orphan should be removed, got %#v", response.Items)
	}

	// 真冲突：被占用方仍在活跃集合，应返回 api_key_alias_duplicate。
	conflict := bytes.NewBufferString(`{"items":[{"apiKeyHash":"` + newHash + `","alias":"team-b"}],"activeApiKeyHashes":["` + newHash + `","` + activeHash + `"]}`)
	req = httptest.NewRequest(http.MethodPut, "/v0/management/api-key-aliases", conflict)
	req.Header.Set("Authorization", "Bearer management-key")
	rr = httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("active conflict status = %d, body = %s", rr.Code, rr.Body.String())
	}
	if !strings.Contains(rr.Body.String(), `"code":"api_key_alias_duplicate"`) {
		t.Fatalf("active conflict body = %s", rr.Body.String())
	}
}

func TestModelPricesSyncFromLiteLLMFormat(t *testing.T) {
	source := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{
			"sample_spec": {},
			"gpt-test": {
				"input_cost_per_token": 0.00000125,
				"output_cost_per_token": 0.0000025,
				"cache_read_input_token_cost": 0.0000001,
				"mode": "chat"
			},
			"image-only": {
				"output_cost_per_image": 0.04,
				"mode": "image_generation"
			}
		}`))
	}))
	t.Cleanup(source.Close)
	oldURL := modelPriceSyncURL
	modelPriceSyncURL = source.URL
	t.Cleanup(func() {
		modelPriceSyncURL = oldURL
	})

	handler := newTestHandler(t, "http://example.test", true)
	req := httptest.NewRequest(
		http.MethodPost,
		"/v0/management/model-prices/sync",
		bytes.NewBufferString(`{"models":["gpt-test"]}`),
	)
	req.Header.Set("Authorization", "Bearer management-key")
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("sync status = %d, body = %s", rr.Code, rr.Body.String())
	}
	var response struct {
		Source   string `json:"source"`
		Imported int    `json:"imported"`
		Skipped  int    `json:"skipped"`
		Prices   map[string]struct {
			Prompt        float64 `json:"prompt"`
			Completion    float64 `json:"completion"`
			Cache         float64 `json:"cache"`
			Source        string  `json:"source"`
			SourceModelID string  `json:"sourceModelId"`
		} `json:"prices"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if response.Source != "litellm" || response.Imported != 1 || response.Skipped != 2 {
		t.Fatalf("sync summary = %#v", response)
	}
	price, ok := response.Prices["gpt-test"]
	if !ok {
		t.Fatalf("missing synced price: %#v", response.Prices)
	}
	if !closeFloat(price.Prompt, 1.25) || !closeFloat(price.Completion, 2.5) || !closeFloat(price.Cache, 0.1) {
		t.Fatalf("price = %#v", price)
	}
	if price.Source != "litellm" || price.SourceModelID != "gpt-test" {
		t.Fatalf("source metadata = %#v", price)
	}
}

func closeFloat(left float64, right float64) bool {
	return math.Abs(left-right) < 0.0000001
}

func TestSelectModelPricesMatchesByPriorityAndReportsUnmatched(t *testing.T) {
	prices := map[string]store.ModelPrice{
		"gpt-4o-2024-08-06":                      {Prompt: 2.5, Completion: 10},
		"anthropic/claude-3.5-sonnet":            {Prompt: 3, Completion: 15},
		"openrouter/anthropic/claude-3.5-sonnet": {Prompt: 3.1, Completion: 15.1},
		"gemini/gemini-2.5-flash":                {Prompt: 0.075, Completion: 0.3},
		"claude-sonnet-4-5-20250929":             {Prompt: 3.2, Completion: 16},
	}

	models := []string{
		"gpt-4o-2024-08-06",       // 精确
		"GEMINI/Gemini-2.5-Flash", // 大小写不敏感
		"claude-3.5-sonnet",       // basename：应选最短 anthropic/* 而非 openrouter/*
		"claude-sonnet-4-5",       // 剥离日期后缀
		"unknown-model-xyz",       // unmatched
	}

	selected, unmatched := selectModelPrices(prices, models)

	if got := selected["gpt-4o-2024-08-06"].Prompt; got != 2.5 {
		t.Fatalf("exact match prompt = %v", got)
	}
	if got := selected["GEMINI/Gemini-2.5-Flash"].Prompt; got != 0.075 {
		t.Fatalf("case-insensitive match prompt = %v", got)
	}
	if got := selected["claude-3.5-sonnet"].Prompt; got != 3 {
		t.Fatalf("basename match should prefer shortest key, got prompt = %v", got)
	}
	if got := selected["claude-sonnet-4-5"].Prompt; got != 3.2 {
		t.Fatalf("date-stripped match prompt = %v", got)
	}
	if _, ok := selected["unknown-model-xyz"]; ok {
		t.Fatalf("unknown model should not be selected")
	}
	if len(unmatched) != 1 || unmatched[0] != "unknown-model-xyz" {
		t.Fatalf("unmatched = %#v", unmatched)
	}
}

func TestSelectModelPricesEmptyModelsReturnsAll(t *testing.T) {
	prices := map[string]store.ModelPrice{
		"a": {Prompt: 1},
		"b": {Prompt: 2},
	}
	selected, unmatched := selectModelPrices(prices, nil)
	if len(selected) != 2 {
		t.Fatalf("expected all prices, got %d", len(selected))
	}
	if len(unmatched) != 0 {
		t.Fatalf("expected no unmatched, got %#v", unmatched)
	}
	// mutating returned map must not affect input
	selected["a"] = store.ModelPrice{Prompt: 999}
	if prices["a"].Prompt != 1 {
		t.Fatalf("returned map should be a copy")
	}
}

func TestExtractProxyURLFromBodyAcceptsMultipleShapes(t *testing.T) {
	cases := map[string]string{
		`"http://proxy:8080"`:          "http://proxy:8080",
		`{"proxy-url":"http://a:1"}`:   "http://a:1",
		`{"proxyUrl":"http://b:2"}`:    "http://b:2",
		`{"proxy_url":"http://c:3"}`:   "http://c:3",
		`{"value":"http://d:4"}`:       "http://d:4",
		`{"unrelated":"x"}`:            "",
		`{"proxy-url":" http://e:5 "}`: "http://e:5",
		``:                             "",
	}
	for body, want := range cases {
		if got := extractProxyURLFromBody([]byte(body)); got != want {
			t.Fatalf("extractProxyURLFromBody(%q) = %q, want %q", body, got, want)
		}
	}
}

func TestFetchCPAProxyURLUsesCacheAcrossCalls(t *testing.T) {
	var calls int
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if r.URL.Path != "/v0/management/proxy-url" {
			t.Errorf("unexpected proxy fetch path: %s", r.URL.Path)
		}
		if r.Header.Get("Authorization") != "Bearer mkey" {
			t.Errorf("missing auth header: %s", r.Header.Get("Authorization"))
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"proxy-url":"http://cached-proxy:1080"}`))
	}))
	t.Cleanup(upstream.Close)

	resetCPAProxyCache()
	t.Cleanup(resetCPAProxyCache)

	got, err := fetchCPAProxyURL(context.Background(), upstream.URL, "mkey")
	if err != nil {
		t.Fatalf("first fetch: %v", err)
	}
	if got != "http://cached-proxy:1080" {
		t.Fatalf("first fetch value = %q", got)
	}
	cached, err := fetchCPAProxyURL(context.Background(), upstream.URL, "mkey")
	if err != nil {
		t.Fatalf("second fetch: %v", err)
	}
	if cached != got {
		t.Fatalf("cached value mismatch: %q vs %q", cached, got)
	}
	if calls != 1 {
		t.Fatalf("expected single upstream call, got %d", calls)
	}
}

func TestNewHTTPClientWithProxyInjectsTransport(t *testing.T) {
	noProxy := newHTTPClientWithProxy("", time.Second)
	if noProxy.Transport != nil {
		t.Fatalf("empty proxy should leave default transport")
	}
	invalid := newHTTPClientWithProxy("not a url", time.Second)
	if invalid.Transport != nil {
		t.Fatalf("invalid proxy should leave default transport")
	}
	valid := newHTTPClientWithProxy("http://proxy.local:1080", time.Second)
	transport, ok := valid.Transport.(*http.Transport)
	if !ok {
		t.Fatalf("valid proxy should set *http.Transport, got %T", valid.Transport)
	}
	if transport.Proxy == nil {
		t.Fatalf("Proxy function should be set")
	}
	req := httptest.NewRequest(http.MethodGet, "http://example.com", nil)
	resolved, err := transport.Proxy(req)
	if err != nil {
		t.Fatalf("Proxy func error: %v", err)
	}
	if resolved == nil || resolved.Host != "proxy.local:1080" {
		t.Fatalf("resolved proxy = %#v", resolved)
	}
}

func TestModelPricesSyncReportsUnmatchedAndCaseInsensitiveMatch(t *testing.T) {
	source := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{
			"anthropic/claude-3.5-sonnet": {
				"input_cost_per_token": 0.000003,
				"output_cost_per_token": 0.000015
			},
			"gemini/gemini-2.5-flash": {
				"input_cost_per_token": 0.000000075,
				"output_cost_per_token": 0.0000003
			}
		}`))
	}))
	t.Cleanup(source.Close)
	oldURL := modelPriceSyncURL
	modelPriceSyncURL = source.URL
	t.Cleanup(func() { modelPriceSyncURL = oldURL })
	resetCPAProxyCache()
	t.Cleanup(resetCPAProxyCache)

	handler := newTestHandler(t, "http://example.test", true)
	req := httptest.NewRequest(
		http.MethodPost,
		"/v0/management/model-prices/sync",
		bytes.NewBufferString(`{"models":["claude-3.5-sonnet","GEMINI/Gemini-2.5-Flash","mystery-model"]}`),
	)
	req.Header.Set("Authorization", "Bearer management-key")
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("sync status = %d, body = %s", rr.Code, rr.Body.String())
	}
	var response struct {
		Imported  int      `json:"imported"`
		Unmatched []string `json:"unmatched"`
		Prices    map[string]struct {
			Prompt float64 `json:"prompt"`
		} `json:"prices"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if response.Imported != 2 {
		t.Fatalf("imported = %d (body=%s)", response.Imported, rr.Body.String())
	}
	if len(response.Unmatched) != 1 || response.Unmatched[0] != "mystery-model" {
		t.Fatalf("unmatched = %#v", response.Unmatched)
	}
	if _, ok := response.Prices["claude-3.5-sonnet"]; !ok {
		t.Fatalf("basename-matched price not persisted: %#v", response.Prices)
	}
	if _, ok := response.Prices["GEMINI/Gemini-2.5-Flash"]; !ok {
		t.Fatalf("case-insensitive match not persisted: %#v", response.Prices)
	}
}

func resetCPAProxyCache() {
	cpaProxyCacheMu.Lock()
	cpaProxyCache = map[string]proxyCacheEntry{}
	cpaProxyCacheMu.Unlock()
}
