package usage

import (
	"encoding/json"
	"strings"
	"testing"
	"time"
)

func TestParseResponseHeaderMetadataCodexQuotaAndTrace(t *testing.T) {
	base := time.Unix(1_780_000_000, 0)
	metadata := ParseResponseHeaderMetadata(map[string]any{
		"X-Codex-Plan-Type":                            []any{"plus"},
		"X-Codex-Active-Limit":                         []any{"premium"},
		"X-Codex-Primary-Used-Percent":                 []any{"87"},
		"X-Codex-Secondary-Used-Percent":               []any{"12"},
		"X-Codex-Primary-Reset-After-Seconds":          []any{"60"},
		"X-Codex-Secondary-Reset-At":                   []any{"1780003600"},
		"X-Codex-Rate-Limit-Reached-Type":              []any{"primary"},
		"X-OAI-Request-ID":                             []any{"req_123"},
		"CF-Ray":                                       []any{"ray-abc"},
		"Content-Type":                                 []any{"text/event-stream"},
		"Set-Cookie":                                   []any{"session=secret"},
		"Authorization":                                []any{"Bearer secret"},
		"X-Codex-Primary-Over-Secondary-Limit-Percent": []any{"50"},
	}, base)
	if metadata == nil {
		t.Fatal("metadata is nil")
	}
	if metadata.Quota == nil || metadata.Quota.PlanType != "plus" || metadata.Quota.ActiveLimit != "premium" {
		t.Fatalf("quota metadata = %#v", metadata.Quota)
	}
	if metadata.Quota.Primary == nil || metadata.Quota.Primary.UsedPercent == nil || *metadata.Quota.Primary.UsedPercent != 87 {
		t.Fatalf("primary quota = %#v", metadata.Quota.Primary)
	}
	if metadata.Quota.Primary.ResetAtMS != base.Add(time.Minute).UnixMilli() {
		t.Fatalf("primary reset = %d, want %d", metadata.Quota.Primary.ResetAtMS, base.Add(time.Minute).UnixMilli())
	}
	if metadata.Quota.Secondary == nil || metadata.Quota.Secondary.ResetAtMS != time.Unix(1_780_003_600, 0).UnixMilli() {
		t.Fatalf("secondary quota = %#v", metadata.Quota.Secondary)
	}
	if metadata.Trace == nil || metadata.Trace.PrimaryTraceID != "req_123" || metadata.Trace.CFRay != "ray-abc" {
		t.Fatalf("trace metadata = %#v", metadata.Trace)
	}
	if metadata.Response == nil || metadata.Response.ContentType != "text/event-stream" {
		t.Fatalf("response metadata = %#v", metadata.Response)
	}
	derived := DeriveResponseHeaderMetadata(metadata)
	if derived.MetadataJSON == "" || derived.QuotaPlanType != "plus" || derived.TraceID != "req_123" {
		t.Fatalf("derived metadata = %#v", derived)
	}
}

func TestParseResponseHeaderMetadataKeepsRecoverAtOnSummaryWindow(t *testing.T) {
	base := time.Unix(1_780_000_000, 0)
	metadata := ParseResponseHeaderMetadata(map[string]any{
		"X-Codex-Primary-Used-Percent":        []any{"100"},
		"X-Codex-Primary-Reset-After-Seconds": []any{"18000"},
		"X-Codex-Primary-Window-Minutes":      []any{"300"},
		"X-Codex-Secondary-Used-Percent":      []any{"20"},
		"X-Codex-Secondary-Reset-At":          []any{base.Add(7 * 24 * time.Hour).UnixMilli()},
		"X-Codex-Secondary-Window-Minutes":    []any{"10080"},
	}, base)
	if metadata == nil || metadata.Quota == nil {
		t.Fatalf("quota metadata missing: %#v", metadata)
	}
	if metadata.Quota.UsedPercent == nil || *metadata.Quota.UsedPercent != 100 {
		t.Fatalf("used percent = %#v", metadata.Quota.UsedPercent)
	}
	if got, want := metadata.Quota.RecoverAtMS, base.Add(5*time.Hour).UnixMilli(); got != want {
		t.Fatalf("recover at = %d, want %d", got, want)
	}
	if metadata.Quota.SummaryWindowKind != "five_hour" || metadata.Quota.SummaryWindowSource != "primary" {
		t.Fatalf("summary window = %s/%s", metadata.Quota.SummaryWindowKind, metadata.Quota.SummaryWindowSource)
	}
	if metadata.Quota.ReachedWindowKind != "five_hour" || metadata.Quota.ReachedWindowSource != "primary" {
		t.Fatalf("reached window = %s/%s", metadata.Quota.ReachedWindowKind, metadata.Quota.ReachedWindowSource)
	}
}

func TestParseResponseHeaderMetadataSummarizesHighestUsedNonReachedWindow(t *testing.T) {
	base := time.Unix(1_780_000_000, 0)
	metadata := ParseResponseHeaderMetadata(map[string]any{
		"X-Codex-Primary-Used-Percent":        []any{"80"},
		"X-Codex-Primary-Reset-After-Seconds": []any{"18000"},
		"X-Codex-Primary-Window-Minutes":      []any{"300"},
		"X-Codex-Secondary-Used-Percent":      []any{"95"},
		"X-Codex-Secondary-Reset-At":          []any{base.Add(7 * 24 * time.Hour).UnixMilli()},
		"X-Codex-Secondary-Window-Minutes":    []any{"10080"},
	}, base)
	if metadata == nil || metadata.Quota == nil {
		t.Fatalf("quota metadata missing: %#v", metadata)
	}
	if metadata.Quota.UsedPercent == nil || *metadata.Quota.UsedPercent != 95 {
		t.Fatalf("used percent = %#v", metadata.Quota.UsedPercent)
	}
	if got, want := metadata.Quota.RecoverAtMS, base.Add(7*24*time.Hour).UnixMilli(); got != want {
		t.Fatalf("recover at = %d, want %d", got, want)
	}
	if metadata.Quota.SummaryWindowKind != "weekly" || metadata.Quota.SummaryWindowSource != "secondary" {
		t.Fatalf("summary window = %s/%s", metadata.Quota.SummaryWindowKind, metadata.Quota.SummaryWindowSource)
	}
	if metadata.Quota.ReachedWindowKind != "" || metadata.Quota.ReachedWindowSource != "" {
		t.Fatalf("reached window = %s/%s", metadata.Quota.ReachedWindowKind, metadata.Quota.ReachedWindowSource)
	}
}

func TestParseResponseHeaderMetadataErrors(t *testing.T) {
	base := time.Unix(1_780_000_000, 0)
	metadata := ParseResponseHeaderMetadata(map[string]any{
		"Retry-After":                  []any{"120"},
		"X-OpenAI-IDE-Error-Code":      []any{"token_invalidated"},
		"X-OpenAI-Authorization-Error": []any{"identity_edge_internal_error"},
		"X-OpenAI-IDE-Root-Error-Code": []any{"token_revoked"},
		"X-RateLimit-Bypass":           []any{"ModelRequestRateLimit"},
		"X-Should-Retry":               []any{"false"},
		"X-CloudAICompanion-Trace-ID":  []any{"ag-trace"},
		"Server-Timing":                []any{"dur=42"},
		"X-MiFE-Upstream-Status":       []any{"200"},
		"X-OneAPI-Request-ID":          []any{"oneapi-1"},
		"X-Zeabur-Request-ID":          []any{"z-1"},
	}, base)
	if metadata == nil || metadata.Errors == nil {
		t.Fatalf("errors metadata missing: %#v", metadata)
	}
	if metadata.Errors.Kind != "auth" || metadata.Errors.Code != "token_revoked" {
		t.Fatalf("errors = %#v", metadata.Errors)
	}
	if metadata.Errors.RetryAfterRecoverAtMS != base.Add(120*time.Second).UnixMilli() {
		t.Fatalf("retry-after recover = %d", metadata.Errors.RetryAfterRecoverAtMS)
	}
	if metadata.Errors.ShouldRetry == nil || *metadata.Errors.ShouldRetry {
		t.Fatalf("should retry = %#v, want false", metadata.Errors.ShouldRetry)
	}
	if metadata.Providers == nil ||
		metadata.Providers.AntigravityTraceID != "ag-trace" ||
		metadata.Providers.MiFEUpstreamStatus != "200" ||
		metadata.Providers.OneAPIRequestID != "oneapi-1" {
		t.Fatalf("provider metadata = %#v", metadata.Providers)
	}
}

func TestResponseHeaderMetadataFromRecordFallsBackToRawJSON(t *testing.T) {
	base := time.Unix(1_780_000_000, 0)
	metadata := ResponseHeaderMetadataFromRecord(map[string]any{
		"raw_json": `{"response_headers":{"X-Request-ID":["req-fallback"],"Content-Length":["42"]}}`,
	}, base)
	if metadata == nil || metadata.Trace == nil || metadata.Trace.PrimaryTraceID != "req-fallback" {
		t.Fatalf("metadata = %#v", metadata)
	}
	if metadata.Response == nil || metadata.Response.ContentLength == nil || *metadata.Response.ContentLength != 42 {
		t.Fatalf("response metadata = %#v", metadata.Response)
	}
}

func TestParseResponseHeaderMetadataIgnoresNonScalarHeaderValues(t *testing.T) {
	metadata := ParseResponseHeaderMetadata(map[string]any{
		"X-OAI-Request-ID": []any{
			map[string]any{"secret": "sk-sensitive"},
			"req-safe",
		},
		"X-Request-ID": map[string]any{"token": "sk-leak"},
		"Set-Cookie":   []any{"session=secret"},
	}, time.Unix(1_780_000_000, 0))
	if metadata == nil || metadata.Trace == nil {
		t.Fatalf("trace metadata missing: %#v", metadata)
	}
	if metadata.Trace.PrimaryTraceID != "req-safe" {
		t.Fatalf("primary trace id = %q", metadata.Trace.PrimaryTraceID)
	}
	data, err := json.Marshal(metadata)
	if err != nil {
		t.Fatalf("marshal metadata: %v", err)
	}
	if strings.Contains(string(data), "sk-sensitive") || strings.Contains(string(data), "sk-leak") || strings.Contains(string(data), "session=secret") {
		t.Fatalf("metadata leaked unsafe header value: %s", data)
	}
}

func TestParseResponseHeaderMetadataIgnoresFutureHeaderCandidates(t *testing.T) {
	metadata := ParseResponseHeaderMetadata(map[string]any{
		"X-Error-JSON":               []any{"eyJlcnJvciI6eyJjb2RlIjoidG9rZW5fcmV2b2tlZCJ9fQ=="},
		"X-Codex-Promo-Message":      []any{"Start a free trial of Plus today"},
		"X-Codex-Promo-Campaign-ID":  []any{"plus-1-month-free"},
		"X-OpenAI-Internal-Caller":   []any{"unknown_through_ide"},
		"X-Zeabur-IP-Country":        []any{"US"},
		"Date":                       []any{"Tue, 23 Jun 2026 10:48:17 GMT"},
		"Cache-Control":              []any{"no-cache"},
		"Strict-Transport-Security":  []any{"max-age=31536000"},
		"Content-Security-Policy":    []any{"default-src 'none'"},
		"X-Content-Type-Options":     []any{"nosniff"},
		"Cross-Origin-Opener-Policy": []any{"same-origin-allow-popups"},
		"Timing-Allow-Origin":        []any{"*"},
		"Alt-Svc":                    []any{`h3=":443"; ma=86400`},
		"Nel":                        []any{`{"max_age":604800}`},
		"Report-To":                  []any{`{"group":"cf-nel"}`},
		"X-Frame-Options":            []any{"DENY"},
	}, time.Unix(1_780_000_000, 0))
	if metadata != nil {
		t.Fatalf("future header candidates should not be structured yet: %#v", metadata)
	}
}

func TestResponseHeaderMetadataFromRecordSanitizesImportedMetadata(t *testing.T) {
	metadata := ResponseHeaderMetadataFromRecord(map[string]any{
		"response_metadata": map[string]any{
			"errors": map[string]any{
				"authorization_error": "sk-sensitive-token",
				"code":                "token_revoked",
				"kind":                "auth",
			},
			"trace": map[string]any{
				"primary_trace_id": "Bearer secretvalue",
			},
			"response": map[string]any{
				"content_disposition": `attachment; filename="alice@example.com"`,
			},
		},
	}, time.Unix(1_780_000_000, 0))
	if metadata == nil || metadata.Errors == nil || metadata.Trace == nil || metadata.Response == nil {
		t.Fatalf("metadata missing: %#v", metadata)
	}
	data, err := json.Marshal(metadata)
	if err != nil {
		t.Fatalf("marshal metadata: %v", err)
	}
	text := string(data)
	for _, secret := range []string{"sk-sensitive-token", "Bearer secretvalue", "alice@example.com"} {
		if strings.Contains(text, secret) {
			t.Fatalf("metadata leaked %q: %s", secret, text)
		}
	}
	if metadata.Errors.Code != "token_revoked" || metadata.Errors.Kind != "auth" {
		t.Fatalf("metadata error classification = %#v", metadata.Errors)
	}
}
