package quotasnapshot

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/seakee/cpa-manager-plus/apps/manager-server/internal/app"
	"github.com/seakee/cpa-manager-plus/apps/manager-server/internal/config"
	"github.com/seakee/cpa-manager-plus/apps/manager-server/internal/security"
	adminauthsvc "github.com/seakee/cpa-manager-plus/apps/manager-server/internal/service/adminauth"
	quotasnapshotsvc "github.com/seakee/cpa-manager-plus/apps/manager-server/internal/service/quotasnapshot"
	"github.com/seakee/cpa-manager-plus/apps/manager-server/internal/store"
)

const quotaSnapshotHandlerAdminKey = "cpamp_quota_snapshot_test_key"

func TestHandleWriteAndQueryQuotaSnapshots(t *testing.T) {
	handler := newQuotaSnapshotHandler(t)
	write := executeQuotaSnapshotRequest(t, handler, "/v0/management/quota-snapshots", `{
		"entries":[{
			"row_key":"row-1",
			"provider":"codex",
			"account":{"auth_file_snapshot":"codex.json","auth_index":"auth-1"},
			"windows":[{
				"provider_window_id":"five-hour",
				"window_kind":"five_hour",
				"window_mode":"fixed",
				"model_scope_kind":"all",
				"source":"api_query",
				"observed_at_ms":1000,
				"boundary_accuracy":"exact",
				"cycle_start_ms":1000,
				"cycle_end_ms":19000000,
				"duration_seconds":18999,
				"used_percent":20
			}]
		}]
	}`)
	if write.Code != http.StatusOK {
		t.Fatalf("write status = %d body = %s", write.Code, write.Body.String())
	}

	query := executeQuotaSnapshotRequest(t, handler, "/v0/management/quota-snapshots/query", `{
		"accounts":[{
			"row_key":"row-1",
			"provider":"codex",
			"account":{"auth_file_snapshot":"codex.json","auth_index":"auth-1"}
		}]
	}`)
	if query.Code != http.StatusOK {
		t.Fatalf("query status = %d body = %s", query.Code, query.Body.String())
	}
	var response quotasnapshotsvc.QueryResponse
	if err := json.Unmarshal(query.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode query response: %v", err)
	}
	if len(response.Items) != 1 || len(response.Items[0].Windows) != 1 || response.Items[0].Windows[0].ProviderWindowID != "five-hour" {
		t.Fatalf("query response = %#v", response)
	}
}

func TestHandleQuotaSnapshotsRejectsUnknownFields(t *testing.T) {
	handler := newQuotaSnapshotHandler(t)
	response := executeQuotaSnapshotRequest(
		t,
		handler,
		"/v0/management/quota-snapshots/query",
		`{"accounts":[],"raw_provider_payload":{"secret":"must-not-be-accepted"}}`,
	)
	if response.Code != http.StatusBadRequest {
		t.Fatalf("status = %d body = %s", response.Code, response.Body.String())
	}
	if !strings.Contains(response.Body.String(), "raw_provider_payload") {
		t.Fatalf("body = %s", response.Body.String())
	}
}

func newQuotaSnapshotHandler(t *testing.T) *Handler {
	t.Helper()
	st, err := store.Open(filepath.Join(t.TempDir(), "usage.sqlite"))
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() { _ = st.Close() })
	credential, err := security.NewAdminCredential(quotaSnapshotHandlerAdminKey, "test")
	if err != nil {
		t.Fatalf("create admin credential: %v", err)
	}
	if err := st.SaveAdminCredential(context.Background(), credential); err != nil {
		t.Fatalf("save admin credential: %v", err)
	}
	return &Handler{App: &app.Context{
		AdminAuthService:     adminauthsvc.New(config.Config{}, st),
		QuotaSnapshotService: quotasnapshotsvc.New(st),
	}}
}

func executeQuotaSnapshotRequest(t *testing.T, handler *Handler, path, body string) *httptest.ResponseRecorder {
	t.Helper()
	request := httptest.NewRequest(http.MethodPost, path, bytes.NewBufferString(body))
	request.Header.Set("Authorization", "Bearer "+quotaSnapshotHandlerAdminKey)
	recorder := httptest.NewRecorder()
	handler.Handle(recorder, request)
	return recorder
}
