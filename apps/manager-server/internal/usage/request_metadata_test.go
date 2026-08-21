package usage

import (
	"encoding/json"
	"strings"
	"testing"
	"unicode"
)

func TestNormalizeRawSanitizesRequestMetadata(t *testing.T) {
	payload, err := json.Marshal(map[string]any{
		"timestamp":       "2026-07-30T00:00:00Z",
		"model":           "gpt-5.4",
		"client_ip":       " 192.0.2.10\r\n\u202espoofed ",
		"clientIp":        " 198.51.100.2\u200b hidden ",
		"x_forwarded_for": strings.Repeat("203.0.113.5, ", 220),
		"xForwardedFor":   strings.Repeat("198.51.100.8, ", 220),
		"user_agent":      "test-client/1.0\tfeature\u0000\u200bflag",
		"userAgent":       strings.Repeat("browser-extension/1.0 ", 80),
	})
	if err != nil {
		t.Fatalf("marshal payload: %v", err)
	}

	event, err := NormalizeRaw(payload)
	if err != nil {
		t.Fatalf("normalize raw: %v", err)
	}
	if event.ClientIP != "192.0.2.10 spoofed" {
		t.Fatalf("client ip = %q", event.ClientIP)
	}
	if event.UserAgent != "test-client/1.0 feature flag" {
		t.Fatalf("user agent = %q", event.UserAgent)
	}
	if len(event.XForwardedFor) > maxXForwardedForBytes || !strings.HasSuffix(event.XForwardedFor, "...") {
		t.Fatalf("x-forwarded-for length = %d, value suffix = %q", len(event.XForwardedFor), event.XForwardedFor[max(0, len(event.XForwardedFor)-8):])
	}
	for name, value := range map[string]string{
		"client_ip":       event.ClientIP,
		"x_forwarded_for": event.XForwardedFor,
		"user_agent":      event.UserAgent,
	} {
		if strings.IndexFunc(value, func(r rune) bool { return !unicode.IsGraphic(r) }) >= 0 {
			t.Fatalf("%s contains non-graphic characters: %q", name, value)
		}
	}

	var rawRecord map[string]any
	if err := json.Unmarshal([]byte(event.RawJSON), &rawRecord); err != nil {
		t.Fatalf("decode raw json: %v", err)
	}
	for key, maxBytes := range map[string]int{
		"client_ip":       maxClientIPBytes,
		"clientIp":        maxClientIPBytes,
		"x_forwarded_for": maxXForwardedForBytes,
		"xForwardedFor":   maxXForwardedForBytes,
		"user_agent":      maxUserAgentBytes,
		"userAgent":       maxUserAgentBytes,
	} {
		value, ok := rawRecord[key].(string)
		if !ok {
			t.Fatalf("raw %s = %#v", key, rawRecord[key])
		}
		if len(value) > maxBytes {
			t.Fatalf("raw %s length = %d", key, len(value))
		}
		if strings.IndexFunc(value, func(r rune) bool { return !unicode.IsGraphic(r) }) >= 0 {
			t.Fatalf("raw %s contains non-graphic characters: %q", key, value)
		}
	}
	if rawRecord["client_ip"] != event.ClientIP || rawRecord["x_forwarded_for"] != event.XForwardedFor || rawRecord["user_agent"] != event.UserAgent {
		t.Fatalf("raw canonical request metadata does not match normalized event: %#v", rawRecord)
	}
}

func TestNormalizeRawRequestMetadataIsAbsentSafe(t *testing.T) {
	event, err := NormalizeRaw([]byte(`{"timestamp":"2026-07-30T00:00:00Z","model":"gpt-5.4"}`))
	if err != nil {
		t.Fatalf("normalize raw: %v", err)
	}
	if event.ClientIP != "" || event.XForwardedFor != "" || event.UserAgent != "" {
		t.Fatalf("request metadata = client:%q forwarded:%q agent:%q", event.ClientIP, event.XForwardedFor, event.UserAgent)
	}
}

func TestRequestMetadataIsExcludedFromEventJSON(t *testing.T) {
	encoded, err := json.Marshal(Event{
		EventHash:     "event-hash",
		TimestampMS:   1,
		Timestamp:     "2026-07-30T00:00:00Z",
		Model:         "gpt-5.4",
		ClientIP:      "192.0.2.10",
		XForwardedFor: "203.0.113.5",
		UserAgent:     "test-client/1.0",
	})
	if err != nil {
		t.Fatalf("marshal event: %v", err)
	}
	for _, key := range []string{"client_ip", "x_forwarded_for", "user_agent"} {
		if strings.Contains(string(encoded), key) {
			t.Fatalf("event JSON leaked %s: %s", key, encoded)
		}
	}
}
