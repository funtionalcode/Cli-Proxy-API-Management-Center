package usage

import (
	"errors"
	"io"
	"log"
	"net/http"
	"strings"

	"github.com/seakee/cpa-manager-plus/apps/manager-server/internal/app"
	"github.com/seakee/cpa-manager-plus/apps/manager-server/internal/http/middleware"
	"github.com/seakee/cpa-manager-plus/apps/manager-server/internal/http/response"
	usagesvc "github.com/seakee/cpa-manager-plus/apps/manager-server/internal/service/usage"
)

const maxUsageImportBytes int64 = 64 * 1024 * 1024

type Handler struct {
	App *app.Context
}

func (h *Handler) Handle(w http.ResponseWriter, r *http.Request) {
	if !middleware.AuthorizePanel(w, r, h.App.AdminAuthService) {
		return
	}
	switch r.Method {
	case http.MethodGet:
		if strings.HasSuffix(r.URL.Path, "/export") {
			h.Export(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		writer := &countingWriter{writer: w}
		err := h.App.UsageService.WriteCompatibleUsage(r.Context(), writer, h.App.Config.QueryLimit)
		if err != nil {
			if writer.written == 0 {
				response.Error(w, http.StatusInternalServerError, err)
			} else {
				log.Printf("usage compatible stream failed after %d bytes: %v", writer.written, err)
			}
			return
		}
	case http.MethodPost:
		if strings.HasSuffix(r.URL.Path, "/import") {
			h.Import(w, r)
			return
		}
		response.MethodNotAllowed(w)
	default:
		response.MethodNotAllowed(w)
	}
}

func (h *Handler) Export(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/x-ndjson")
	w.Header().Set("Content-Disposition", `attachment; filename="usage-events.jsonl"`)
	writer := &countingWriter{writer: w}
	if err := h.App.UsageService.WriteExport(r.Context(), writer, h.App.Config.QueryLimit); err != nil {
		if writer.written == 0 {
			w.Header().Del("Content-Disposition")
			response.Error(w, http.StatusInternalServerError, err)
		} else {
			log.Printf("usage export stream failed after %d bytes: %v", writer.written, err)
		}
	}
}

type countingWriter struct {
	writer  io.Writer
	written int64
}

func (w *countingWriter) Write(data []byte) (int, error) {
	written, err := w.writer.Write(data)
	w.written += int64(written)
	return written, err
}

func (h *Handler) Import(w http.ResponseWriter, r *http.Request) {
	if r.ContentLength > maxUsageImportBytes {
		response.Error(w, http.StatusRequestEntityTooLarge, errors.New("http: request body too large"))
		return
	}
	body := http.MaxBytesReader(w, r.Body, maxUsageImportBytes)
	result, parsed, err := h.App.UsageService.Import(r.Context(), body)
	if err != nil {
		var maxBytesErr *http.MaxBytesError
		if errors.As(err, &maxBytesErr) {
			response.Error(w, http.StatusRequestEntityTooLarge, err)
			return
		}
		var persistenceErr *usagesvc.ImportPersistenceError
		if errors.As(err, &persistenceErr) || result.Added+result.Skipped > 0 {
			response.Error(w, http.StatusInternalServerError, err)
			return
		}
		if parsed == nil {
			response.Error(w, http.StatusBadRequest, err)
			return
		}
		response.JSON(w, http.StatusBadRequest, map[string]any{
			"error":       err.Error(),
			"format":      parsed.Format,
			"failed":      parsed.Failed,
			"unsupported": parsed.Unsupported,
			"warnings":    parsed.Warnings,
		})
		return
	}
	response.JSON(w, http.StatusOK, result)
}
