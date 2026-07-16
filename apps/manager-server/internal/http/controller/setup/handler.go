package setup

import (
	"encoding/json"
	"net/http"

	"github.com/seakee/cpa-manager-plus/apps/manager-server/internal/app"
	"github.com/seakee/cpa-manager-plus/apps/manager-server/internal/http/middleware"
	"github.com/seakee/cpa-manager-plus/apps/manager-server/internal/http/response"
	setupsvc "github.com/seakee/cpa-manager-plus/apps/manager-server/internal/service/setup"
)

type Handler struct {
	App *app.Context
}

func (h *Handler) Setup(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		response.MethodNotAllowed(w)
		return
	}
	if !middleware.AuthorizeAdmin(w, r, h.App.AdminAuthService) {
		return
	}
	var req setupsvc.Request
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.Error(w, http.StatusBadRequest, err)
		return
	}
	result, err := h.App.SetupService.Setup(r.Context(), req, r.Header.Get("Authorization"))
	if err != nil {
		response.Error(w, response.SetupErrorStatus(err), err)
		return
	}
	response.JSON(w, http.StatusOK, result)
}
