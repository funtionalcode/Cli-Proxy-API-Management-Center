package modelprice

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/seakee/cpa-manager-plus/apps/manager-server/internal/app"
	"github.com/seakee/cpa-manager-plus/apps/manager-server/internal/model"
	adminauthsvc "github.com/seakee/cpa-manager-plus/apps/manager-server/internal/service/adminauth"
	modelpricesvc "github.com/seakee/cpa-manager-plus/apps/manager-server/internal/service/modelprice"
	"github.com/seakee/cpa-manager-plus/apps/manager-server/internal/store"
	"github.com/seakee/cpa-manager-plus/apps/manager-server/internal/testutil"
	"github.com/seakee/cpa-manager-plus/apps/manager-server/internal/usage"
)

func TestHandleUsageSummaryUsesQueryLimitAndPanelAuthorization(t *testing.T) {
	cfg := testutil.NewConfig(t)
	cfg.QueryLimit = 1
	st := testutil.NewStore(t, cfg)
	if _, err := st.UsageEvents.InsertBatch(context.Background(), []usage.Event{
		{EventHash: "0000000000000000000000000000000000000000000000000000000000000001", TimestampMS: 100, Timestamp: "2026-01-01T00:00:00Z", Model: "gpt-old", CreatedAtMS: 100},
		{EventHash: "0000000000000000000000000000000000000000000000000000000000000002", TimestampMS: 200, Timestamp: "2026-01-01T00:00:01Z", Model: "gpt-new", CreatedAtMS: 200},
	}); err != nil {
		t.Fatalf("insert events: %v", err)
	}

	handler := &Handler{App: &app.Context{
		Config:            cfg,
		AdminAuthService:  adminauthsvc.New(cfg, st),
		ModelPriceService: modelpricesvc.New(st, nil),
	}}

	unauthorized := httptest.NewRecorder()
	handler.Handle(unauthorized, httptest.NewRequest(http.MethodGet, "/v0/management/model-prices/usage-summary", nil))
	if unauthorized.Code != http.StatusUnauthorized {
		t.Fatalf("unauthorized status = %d body = %s", unauthorized.Code, unauthorized.Body.String())
	}

	req := httptest.NewRequest(http.MethodGet, "/v0/management/model-prices/usage-summary", nil)
	req.Header.Set("Authorization", "Bearer "+testutil.AdminKey)
	recorder := httptest.NewRecorder()
	handler.Handle(recorder, req)
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d body = %s", recorder.Code, recorder.Body.String())
	}

	var summary model.ModelUsageSummary
	if err := json.NewDecoder(recorder.Body).Decode(&summary); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if summary.SampledEvents != 1 || summary.TotalEvents != 2 || !summary.Truncated {
		t.Fatalf("summary metadata = %#v", summary)
	}
	if len(summary.Models) != 1 || summary.Models[0].Model != "gpt-new" || summary.Models[0].Calls != 1 || summary.Models[0].RequestedCalls != 1 {
		t.Fatalf("models = %#v", summary.Models)
	}
}

type staticSetupResolver struct {
	setup store.Setup
}

func (r staticSetupResolver) ResolveSetup(ctx context.Context) (store.Setup, bool, error) {
	return r.setup, true, nil
}

func TestHandleRuntimeModels_AuthorizationAndResponse(t *testing.T) {
	cpaServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v0/management/api-keys":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"api-keys": []string{"test-key"},
			})
		case "/v1/models":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"data": []map[string]any{
					{"id": "m1"},
					{"id": "m2"},
				},
			})
		default:
			http.NotFound(w, r)
		}
	}))
	defer cpaServer.Close()

	cfg := testutil.NewConfig(t)
	st := testutil.NewStore(t, cfg)
	resolver := staticSetupResolver{
		setup: store.Setup{
			CPAUpstreamURL: cpaServer.URL,
			ManagementKey:  "mgmt-key",
		},
	}

	handler := &Handler{App: &app.Context{
		Config:            cfg,
		AdminAuthService:  adminauthsvc.New(cfg, st),
		ModelPriceService: modelpricesvc.New(st, nil, resolver),
	}}

	unauth := httptest.NewRecorder()
	handler.Handle(unauth, httptest.NewRequest(http.MethodGet, "/v0/management/model-prices/runtime-models", nil))
	if unauth.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", unauth.Code)
	}

	req := httptest.NewRequest(http.MethodGet, "/v0/management/model-prices/runtime-models", nil)
	req.Header.Set("Authorization", "Bearer "+testutil.AdminKey)
	recorder := httptest.NewRecorder()
	handler.Handle(recorder, req)
	if recorder.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d, body: %s", recorder.Code, recorder.Body.String())
	}

	var status modelpricesvc.RuntimeModelPricingStatus
	if err := json.NewDecoder(recorder.Body).Decode(&status); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if status.Count != 2 || status.UnpricedCount != 2 {
		t.Fatalf("expected count=2 and unpricedCount=2, got %d, %d", status.Count, status.UnpricedCount)
	}
}
