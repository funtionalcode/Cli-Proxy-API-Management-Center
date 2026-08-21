package usageidentity

import (
	"context"
	"database/sql"
	"testing"

	_ "modernc.org/sqlite"
)

func TestAnalyticsModelOnlyRemovesRecognizedReasoningSuffixes(t *testing.T) {
	tests := map[string]string{
		"deepseek-v4-flash(max)":             "deepseek-v4-flash",
		"deepseek-v4-flash(HIGH)":            "deepseek-v4-flash",
		"claude-sonnet-4-5(16384)":           "claude-sonnet-4-5",
		"gemini-2.5-pro(0)":                  "gemini-2.5-pro",
		"gemini-2.5-pro(+08192)":             "gemini-2.5-pro",
		"gemini-2.5-pro(-000)":               "gemini-2.5-pro",
		"gpt-5.4(-1)":                        "gpt-5.4",
		"custom-model(auto-tuned)":           "custom-model(auto-tuned)",
		"tenant/model(region-us)":            "tenant/model(region-us)",
		"custom(model)(high)":                "custom(model)",
		"custom-model":                       "custom-model",
		" custom-model(max) ":                " custom-model(max) ",
		" custom-model(max)":                 " custom-model",
		"custom-model( high)":                "custom-model( high)",
		"custom-model(high )":                "custom-model(high )",
		"":                                   "",
		"(high)":                             "(high)",
		"custom-model(9223372036854775807)":  "custom-model",
		"custom-model(09223372036854775807)": "custom-model",
		"custom-model(9223372036854775808)":  "custom-model(9223372036854775808)",
		"custom-model(18446744073709551616)": "custom-model(18446744073709551616)",
		"custom-model(-01)":                  "custom-model(-01)",
		"custom-model(+)":                    "custom-model(+)",
	}
	for input, want := range tests {
		if got := AnalyticsModel(input); got != want {
			t.Errorf("AnalyticsModel(%q) = %q, want %q", input, got, want)
		}
	}
}

func TestAnalyticsModelForRequestPrefersExplicitRequestedModel(t *testing.T) {
	tests := []struct {
		model          string
		requestedModel string
		want           string
	}{
		{model: "stored-display-model", requestedModel: "deepseek-v4-flash(max)", want: "deepseek-v4-flash"},
		{model: "deepseek-v4-flash(low)", want: "deepseek-v4-flash"},
		{model: "stored-display-model", requestedModel: "custom-model(region-us)", want: "custom-model(region-us)"},
	}
	for _, test := range tests {
		if got := AnalyticsModelForRequest(test.model, test.requestedModel); got != test.want {
			t.Errorf("AnalyticsModelForRequest(%q, %q) = %q, want %q", test.model, test.requestedModel, got, test.want)
		}
	}
}

func TestSQLAnalyticsModelExpressionMatchesGoForSupportedShapes(t *testing.T) {
	db, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	inputs := []string{
		"deepseek-v4-flash(max)",
		"deepseek-v4-flash(HIGH)",
		"claude-sonnet-4-5(16384)",
		"gemini-2.5-pro(0)",
		"gemini-2.5-pro(+08192)",
		"gemini-2.5-pro(-000)",
		"gpt-5.4(-1)",
		"custom-model(auto-tuned)",
		"custom(model)(high)",
		`custom"quoted\\model(high)`,
		"自定义（模型）(high)",
		"custom-model( high)",
		"custom-model(high )",
		" custom-model(max) ",
		"custom-model(0000000000000000000000000000000000000000000000000000000000001)",
		"custom-model(9223372036854775807)",
		"custom-model(9223372036854775808)",
		"custom-model(-01)",
		"custom-model",
	}
	if _, err := db.Exec(`create table events (model text not null)`); err != nil {
		t.Fatalf("create events: %v", err)
	}
	for _, input := range inputs {
		if _, err := db.Exec(`delete from events`); err != nil {
			t.Fatalf("clear events: %v", err)
		}
		if _, err := db.Exec(`insert into events (model) values (?)`, input); err != nil {
			t.Fatalf("insert %q: %v", input, err)
		}
		var got string
		query := "select " + SQLAnalyticsModelExpression("model") + " from events"
		if err := db.QueryRowContext(context.Background(), query).Scan(&got); err != nil {
			t.Fatalf("query %q: %v", input, err)
		}
		if want := AnalyticsModel(input); got != want {
			t.Errorf("SQLAnalyticsModelExpression(%q) = %q, want %q", input, got, want)
		}
	}
}

func TestSQLRequestAnalyticsModelExpressionMatchesGo(t *testing.T) {
	db, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	if _, err := db.Exec(`create table events (model text, requested_model text)`); err != nil {
		t.Fatalf("create events: %v", err)
	}
	tests := []struct {
		model          string
		requestedModel string
	}{
		{model: "stored-display-model", requestedModel: "deepseek-v4-flash(max)"},
		{model: "deepseek-v4-flash(low)"},
		{model: "stored-display-model", requestedModel: "custom-model(region-us)"},
	}
	for _, test := range tests {
		if _, err := db.Exec(`delete from events`); err != nil {
			t.Fatalf("clear events: %v", err)
		}
		if _, err := db.Exec(`insert into events (model, requested_model) values (?, ?)`, test.model, test.requestedModel); err != nil {
			t.Fatalf("insert event: %v", err)
		}
		var got string
		query := "select " + SQLRequestAnalyticsModelExpression("model", "requested_model") + " from events"
		if err := db.QueryRowContext(context.Background(), query).Scan(&got); err != nil {
			t.Fatalf("query event: %v", err)
		}
		if want := AnalyticsModelForRequest(test.model, test.requestedModel); got != want {
			t.Errorf("SQLRequestAnalyticsModelExpression(%q, %q) = %q, want %q", test.model, test.requestedModel, got, want)
		}
	}
}
