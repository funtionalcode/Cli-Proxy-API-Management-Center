package dashboard

import (
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/seakee/cpa-manager-plus/apps/manager-server/internal/app"
	"github.com/seakee/cpa-manager-plus/apps/manager-server/internal/http/middleware"
	"github.com/seakee/cpa-manager-plus/apps/manager-server/internal/http/response"
	dashboardsvc "github.com/seakee/cpa-manager-plus/apps/manager-server/internal/service/dashboard"
)

type Handler struct {
	App *app.Context
}

func (h *Handler) Handle(w http.ResponseWriter, r *http.Request) {
	if !middleware.AuthorizePanel(w, r, h.App.AdminAuthService) {
		return
	}

	path := strings.TrimRight(r.URL.Path, "/")
	if path != "/v0/management/dashboard/summary" {
		response.MethodNotAllowed(w)
		return
	}
	if r.Method != http.MethodGet {
		response.MethodNotAllowed(w)
		return
	}

	params, err := parseSummaryParams(r)
	if err != nil {
		response.Error(w, http.StatusBadRequest, err)
		return
	}
	summary, err := h.App.DashboardService.Summary(r.Context(), params)
	if err != nil {
		response.Error(w, http.StatusInternalServerError, err)
		return
	}
	response.JSON(w, http.StatusOK, summary)
}

func parseSummaryParams(r *http.Request) (dashboardsvc.SummaryParams, error) {
	query := r.URL.Query()
	todayStartRaw := strings.TrimSpace(query.Get("today_start_ms"))
	if todayStartRaw == "" {
		return dashboardsvc.SummaryParams{}, errors.New("today_start_ms is required")
	}
	todayStartMS, err := strconv.ParseInt(todayStartRaw, 10, 64)
	if err != nil || todayStartMS <= 0 {
		return dashboardsvc.SummaryParams{}, errors.New("today_start_ms must be a positive integer")
	}

	nowMS, err := readOptionalInt64(query.Get("now_ms"), "now_ms")
	if err != nil {
		return dashboardsvc.SummaryParams{}, err
	}
	topModels, err := readOptionalInt(query.Get("top_models"), "top_models")
	if err != nil {
		return dashboardsvc.SummaryParams{}, err
	}
	recentFailures, err := readOptionalInt(query.Get("recent_failures"), "recent_failures")
	if err != nil {
		return dashboardsvc.SummaryParams{}, err
	}

	return dashboardsvc.SummaryParams{
		TodayStartMS:   todayStartMS,
		NowMS:          nowMS,
		TopModels:      topModels,
		RecentFailures: recentFailures,
	}, nil
}

func readOptionalInt64(value string, name string) (int64, error) {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return 0, nil
	}
	parsed, err := strconv.ParseInt(trimmed, 10, 64)
	if err != nil {
		return 0, errors.New(name + " must be an integer")
	}
	return parsed, nil
}

func readOptionalInt(value string, name string) (int, error) {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return 0, nil
	}
	parsed, err := strconv.Atoi(trimmed)
	if err != nil {
		return 0, errors.New(name + " must be an integer")
	}
	return parsed, nil
}
