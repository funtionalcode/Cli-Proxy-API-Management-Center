package accountaction

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/seakee/cpa-manager-plus/apps/manager-server/internal/config"
	"github.com/seakee/cpa-manager-plus/apps/manager-server/internal/model"
	collectorsvc "github.com/seakee/cpa-manager-plus/apps/manager-server/internal/service/collector"
	managerconfigsvc "github.com/seakee/cpa-manager-plus/apps/manager-server/internal/service/managerconfig"
	"github.com/seakee/cpa-manager-plus/apps/manager-server/internal/store"
)

func TestEnableValidatesCurrentAuthFileBeforePatch(t *testing.T) {
	ctx := context.Background()
	st, err := store.Open(t.TempDir() + "/usage.sqlite")
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	defer st.Close()

	var patched bool
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method + " " + r.URL.Path {
		case "GET /v0/management/auth-files":
			_ = json.NewEncoder(w).Encode([]map[string]any{{
				"name":       "codex-auth.json",
				"auth_index": "7",
				"provider":   "codex",
				"account":    "user@example.com",
				"account_id": "acct-123",
				"disabled":   true,
			}})
		case "PATCH /v0/management/auth-files/status":
			patched = true
			_ = json.NewEncoder(w).Encode(map[string]any{"ok": true})
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	if err := st.SaveSetup(ctx, store.Setup{CPAUpstreamURL: server.URL, ManagementKey: "mgmt"}); err != nil {
		t.Fatalf("save setup: %v", err)
	}
	item, err := st.UpsertAccountActionCandidate(ctx, model.AccountActionCandidateUpsert{
		ActionType:        model.AccountActionTypeDelete,
		Provider:          "codex",
		AuthFileName:      "codex-auth.json",
		AuthIndex:         "7",
		AccountSnapshot:   "user@example.com",
		AccountIDSnapshot: "acct-123",
		Reason:            "token revoked",
	})
	if err != nil {
		t.Fatalf("upsert: %v", err)
	}

	svc := New(st, managerconfigsvc.New(config.Config{}, st, collectorsvc.New(nil)), server.Client())
	updated, err := svc.Enable(ctx, item.ID)
	if err != nil {
		t.Fatalf("enable: %v", err)
	}
	if !patched {
		t.Fatal("expected PATCH /v0/management/auth-files/status")
	}
	if updated.Status != model.AccountActionStatusResolved {
		t.Fatalf("status = %q", updated.Status)
	}
}

func TestDeleteRejectsMismatchedCurrentAuthFile(t *testing.T) {
	ctx := context.Background()
	st, err := store.Open(t.TempDir() + "/usage.sqlite")
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	defer st.Close()

	var deleted bool
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method + " " + r.URL.Path {
		case "GET /v0/management/auth-files":
			_ = json.NewEncoder(w).Encode([]map[string]any{{
				"name":       "codex-auth.json",
				"auth_index": "7",
				"provider":   "codex",
				"account":    "different@example.com",
				"account_id": "acct-456",
			}})
		case "DELETE /v0/management/auth-files":
			deleted = true
			_ = json.NewEncoder(w).Encode(map[string]any{"ok": true})
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	if err := st.SaveSetup(ctx, store.Setup{CPAUpstreamURL: server.URL, ManagementKey: "mgmt"}); err != nil {
		t.Fatalf("save setup: %v", err)
	}
	item, err := st.UpsertAccountActionCandidate(ctx, model.AccountActionCandidateUpsert{
		ActionType:        model.AccountActionTypeDelete,
		Provider:          "codex",
		AuthFileName:      "codex-auth.json",
		AuthIndex:         "7",
		AccountSnapshot:   "user@example.com",
		AccountIDSnapshot: "acct-123",
		Reason:            "token revoked",
	})
	if err != nil {
		t.Fatalf("upsert: %v", err)
	}

	svc := New(st, managerconfigsvc.New(config.Config{}, st, collectorsvc.New(nil)), server.Client())
	_, err = svc.DeleteAuthFile(ctx, item.ID)
	if !errors.Is(err, ErrCandidateConflict) {
		t.Fatalf("delete error = %v, want conflict", err)
	}
	if deleted {
		t.Fatal("DELETE should not be called on mismatched auth file")
	}
	current, ok, err := st.GetAccountActionCandidate(ctx, item.ID)
	if err != nil || !ok {
		t.Fatalf("get current: %v ok=%t", err, ok)
	}
	if current.Status != model.AccountActionStatusPending {
		t.Fatalf("status = %q", current.Status)
	}
}

func TestDeleteAcceptsCurrentAuthFileProjectID(t *testing.T) {
	ctx := context.Background()
	st, err := store.Open(t.TempDir() + "/usage.sqlite")
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	defer st.Close()

	var deleted bool
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method + " " + r.URL.Path {
		case "GET /v0/management/auth-files":
			_ = json.NewEncoder(w).Encode([]map[string]any{{
				"name":       "antigravity-auth.json",
				"auth_index": "antigravity-1",
				"provider":   "antigravity",
				"account":    "vertex@example.com",
				"project_id": "vertex-project-42",
			}})
		case "DELETE /v0/management/auth-files":
			deleted = true
			_ = json.NewEncoder(w).Encode(map[string]any{"ok": true})
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	if err := st.SaveSetup(ctx, store.Setup{CPAUpstreamURL: server.URL, ManagementKey: "mgmt"}); err != nil {
		t.Fatalf("save setup: %v", err)
	}
	item, err := st.UpsertAccountActionCandidate(ctx, model.AccountActionCandidateUpsert{
		ActionType:        model.AccountActionTypeDelete,
		Provider:          "antigravity",
		AuthFileName:      "antigravity-auth.json",
		AuthIndex:         "antigravity-1",
		AccountSnapshot:   "vertex@example.com",
		AccountIDSnapshot: "vertex-project-42",
		Reason:            "workspace deactivated",
	})
	if err != nil {
		t.Fatalf("upsert: %v", err)
	}

	svc := New(st, managerconfigsvc.New(config.Config{}, st, collectorsvc.New(nil)), server.Client())
	updated, err := svc.DeleteAuthFile(ctx, item.ID)
	if err != nil {
		t.Fatalf("delete: %v", err)
	}
	if !deleted {
		t.Fatal("expected DELETE /v0/management/auth-files")
	}
	if updated.Status != model.AccountActionStatusDeleted {
		t.Fatalf("status = %q", updated.Status)
	}
}
