package quotasnapshot

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/seakee/cpa-manager-plus/apps/manager-server/internal/app"
	"github.com/seakee/cpa-manager-plus/apps/manager-server/internal/http/middleware"
	"github.com/seakee/cpa-manager-plus/apps/manager-server/internal/http/response"
	quotasnapshotsvc "github.com/seakee/cpa-manager-plus/apps/manager-server/internal/service/quotasnapshot"
)

type Handler struct {
	App *app.Context
}

func (h *Handler) Handle(w http.ResponseWriter, r *http.Request) {
	if !middleware.AuthorizePanel(w, r, h.App.AdminAuthService) {
		return
	}
	path := strings.TrimRight(r.URL.Path, "/")
	switch path {
	case "/v0/management/quota-snapshots":
		h.handleWrite(w, r)
	case "/v0/management/quota-snapshots/query":
		h.handleQuery(w, r)
	default:
		response.MethodNotAllowed(w)
	}
}

func (h *Handler) handleWrite(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		response.MethodNotAllowed(w)
		return
	}
	var req quotasnapshotsvc.WriteRequest
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&req); err != nil {
		response.Error(w, http.StatusBadRequest, err)
		return
	}
	result, err := h.App.QuotaSnapshotService.Write(r.Context(), req)
	if err != nil {
		response.Error(w, http.StatusBadRequest, err)
		return
	}
	response.JSON(w, http.StatusOK, result)
}

func (h *Handler) handleQuery(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		response.MethodNotAllowed(w)
		return
	}
	var req quotasnapshotsvc.QueryRequest
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&req); err != nil {
		response.Error(w, http.StatusBadRequest, err)
		return
	}
	result, err := h.App.QuotaSnapshotService.Query(r.Context(), req)
	if err != nil {
		response.Error(w, http.StatusBadRequest, err)
		return
	}
	response.JSON(w, http.StatusOK, result)
}
