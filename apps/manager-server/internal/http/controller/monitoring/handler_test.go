package monitoring

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/seakee/cpa-manager-plus/apps/manager-server/internal/app"
	"github.com/seakee/cpa-manager-plus/apps/manager-server/internal/config"
	"github.com/seakee/cpa-manager-plus/apps/manager-server/internal/security"
	adminauthsvc "github.com/seakee/cpa-manager-plus/apps/manager-server/internal/service/adminauth"
	monitoringsvc "github.com/seakee/cpa-manager-plus/apps/manager-server/internal/service/monitoring"
	"github.com/seakee/cpa-manager-plus/apps/manager-server/internal/store"
)

func TestHandleAccountHistoryRejectsUnknownTargetFields(t *testing.T) {
	st := newHandlerTestStore(t)
	const adminKey = "cpamp_test_key"
	credential, err := security.NewAdminCredential(adminKey, "test")
	if err != nil {
		t.Fatalf("create admin credential: %v", err)
	}
	if err := st.SaveAdminCredential(context.Background(), credential); err != nil {
		t.Fatalf("save admin credential: %v", err)
	}
	handler := &Handler{App: &app.Context{
		AdminAuthService:  adminauthsvc.New(config.Config{}, st),
		MonitoringService: monitoringsvc.New(st),
	}}
	req := httptest.NewRequest(
		http.MethodPost,
		"/v0/management/monitoring/account-history",
		bytes.NewBufferString(`{"accounts":[{"source_hash":"source-only"}]}`),
	)
	req.Header.Set("Authorization", "Bearer "+adminKey)
	recorder := httptest.NewRecorder()

	handler.Handle(recorder, req)

	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("status = %d body = %s", recorder.Code, recorder.Body.String())
	}
	if !strings.Contains(recorder.Body.String(), "source_hash") {
		t.Fatalf("body = %s", recorder.Body.String())
	}
}

func TestHandleAccountWindowUsageRejectsUnknownTargetFields(t *testing.T) {
	st := newHandlerTestStore(t)
	const adminKey = "cpamp_test_key"
	credential, err := security.NewAdminCredential(adminKey, "test")
	if err != nil {
		t.Fatalf("create admin credential: %v", err)
	}
	if err := st.SaveAdminCredential(context.Background(), credential); err != nil {
		t.Fatalf("save admin credential: %v", err)
	}
	handler := &Handler{App: &app.Context{
		AdminAuthService:  adminauthsvc.New(config.Config{}, st),
		MonitoringService: monitoringsvc.New(st),
	}}
	req := httptest.NewRequest(
		http.MethodPost,
		"/v0/management/monitoring/account-window-usage",
		bytes.NewBufferString(`{"windows":[{"row_key":"row-1","window_key":"5h","from_ms":1,"to_ms":2,"source_hash":"source-only"}]}`),
	)
	req.Header.Set("Authorization", "Bearer "+adminKey)
	recorder := httptest.NewRecorder()

	handler.Handle(recorder, req)

	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("status = %d body = %s", recorder.Code, recorder.Body.String())
	}
	if !strings.Contains(recorder.Body.String(), "source_hash") {
		t.Fatalf("body = %s", recorder.Body.String())
	}
}

func TestValidateAccountWindowUsageRequiresCredentialIdentity(t *testing.T) {
	base := monitoringsvc.AccountWindowUsageTarget{
		RowKey:           "row-1",
		ProviderWindowID: "weekly",
		FromMS:           1,
		ToMS:             2,
	}
	weak := base
	weak.AccountSnapshot = "legacy@example.com"
	weak.AuthIndex = "auth-legacy"
	if err := validateAccountWindowUsageRequest(monitoringsvc.AccountWindowUsageRequest{Windows: []monitoringsvc.AccountWindowUsageTarget{weak}}); err == nil || !strings.Contains(err.Error(), "credential identity") {
		t.Fatalf("weak identity error = %v", err)
	}

	for name, mutate := range map[string]func(*monitoringsvc.AccountWindowUsageTarget){
		"auth file": func(target *monitoringsvc.AccountWindowUsageTarget) {
			target.AuthFileSnapshot = "credential.json"
			target.AuthProviderSnapshot = "codex"
		},
		"legacy file source": func(target *monitoringsvc.AccountWindowUsageTarget) {
			target.Source = "credential.json"
			target.AuthProviderSnapshot = "codex"
		},
		"provider auth index": func(target *monitoringsvc.AccountWindowUsageTarget) {
			target.AuthProviderSnapshot = "codex"
			target.AuthIndex = "auth-1"
		},
	} {
		t.Run(name, func(t *testing.T) {
			target := base
			mutate(&target)
			if err := validateAccountWindowUsageRequest(monitoringsvc.AccountWindowUsageRequest{Windows: []monitoringsvc.AccountWindowUsageTarget{target}}); err != nil {
				t.Fatalf("valid credential identity rejected: %v", err)
			}
		})
	}

	for name, mutate := range map[string]func(*monitoringsvc.AccountWindowUsageTarget){
		"auth file without provider": func(target *monitoringsvc.AccountWindowUsageTarget) {
			target.AuthFileSnapshot = "credential.json"
		},
		"legacy file source without provider": func(target *monitoringsvc.AccountWindowUsageTarget) {
			target.Source = "credential.json"
		},
	} {
		t.Run(name, func(t *testing.T) {
			target := base
			mutate(&target)
			if err := validateAccountWindowUsageRequest(monitoringsvc.AccountWindowUsageRequest{Windows: []monitoringsvc.AccountWindowUsageTarget{target}}); err == nil || !strings.Contains(err.Error(), "auth_provider_snapshot") {
				t.Fatalf("providerless file identity error = %v", err)
			}
		})
	}
}

func TestHandleAccountHistoryValidatesRowKeysAndTargets(t *testing.T) {
	testCases := []struct {
		name        string
		body        string
		wantMessage string
	}{
		{
			name:        "missing row key",
			body:        `{"accounts":[{"auth_file_snapshot":"credential.json","auth_index":"auth-1"}]}`,
			wantMessage: "row_key is required",
		},
		{
			name:        "duplicate row key",
			body:        `{"accounts":[{"row_key":"row-1","auth_index":"auth-1"},{"row_key":"row-1","auth_index":"auth-2"}]}`,
			wantMessage: "row_key must be unique",
		},
		{
			name:        "missing target",
			body:        `{"accounts":[{"row_key":"row-1"}]}`,
			wantMessage: "at least one account target field is required",
		},
		{
			name:        "file target missing provider",
			body:        `{"accounts":[{"row_key":"row-1","auth_file_snapshot":"credential.json","auth_index":"auth-1"}]}`,
			wantMessage: "auth_provider_snapshot is required for file account targets",
		},
		{
			name:        "legacy file source missing provider",
			body:        `{"accounts":[{"row_key":"row-1","source":"credential.json","auth_index":"auth-1"}]}`,
			wantMessage: "auth_provider_snapshot is required for file account targets",
		},
	}

	for _, testCase := range testCases {
		t.Run(testCase.name, func(t *testing.T) {
			recorder := executeAuthorizedMonitoringRequest(
				t,
				"/v0/management/monitoring/account-history",
				testCase.body,
			)
			if recorder.Code != http.StatusBadRequest {
				t.Fatalf("status = %d body = %s", recorder.Code, recorder.Body.String())
			}
			if !strings.Contains(recorder.Body.String(), testCase.wantMessage) {
				t.Fatalf("body = %s, want %q", recorder.Body.String(), testCase.wantMessage)
			}
		})
	}
}

func TestValidateAccountHistoryRequestTreatsRowKeysAsOpaque(t *testing.T) {
	err := validateAccountHistoryRequest(monitoringsvc.AccountHistoryRequest{
		Accounts: []monitoringsvc.AccountHistoryTarget{
			{RowKey: " row", AuthIndex: "auth-1"},
			{RowKey: "row", AuthIndex: "auth-2"},
		},
	})
	if err != nil {
		t.Fatalf("validate opaque row keys: %v", err)
	}
}

func executeAuthorizedMonitoringRequest(t *testing.T, path, body string) *httptest.ResponseRecorder {
	t.Helper()
	st := newHandlerTestStore(t)
	const adminKey = "cpamp_test_key"
	credential, err := security.NewAdminCredential(adminKey, "test")
	if err != nil {
		t.Fatalf("create admin credential: %v", err)
	}
	if err := st.SaveAdminCredential(context.Background(), credential); err != nil {
		t.Fatalf("save admin credential: %v", err)
	}
	handler := &Handler{App: &app.Context{
		AdminAuthService:  adminauthsvc.New(config.Config{}, st),
		MonitoringService: monitoringsvc.New(st),
	}}
	req := httptest.NewRequest(http.MethodPost, path, bytes.NewBufferString(body))
	req.Header.Set("Authorization", "Bearer "+adminKey)
	recorder := httptest.NewRecorder()
	handler.Handle(recorder, req)
	return recorder
}

func newHandlerTestStore(t testing.TB) *store.Store {
	t.Helper()
	st, err := store.Open(filepath.Join(t.TempDir(), "usage.sqlite"))
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() {
		_ = st.Close()
	})
	return st
}
