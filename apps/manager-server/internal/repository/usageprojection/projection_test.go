package usageprojection

import "testing"

func TestSearchIndexLikePatternKeepsExactFallbackBoundary(t *testing.T) {
	tests := []struct {
		name        string
		query       string
		wantPattern string
		wantOK      bool
	}{
		{name: "ordinary substring", query: " Trace-ABC ", wantPattern: "%trace-abc%", wantOK: true},
		{name: "three unicode characters", query: "中文测", wantPattern: "%中文测%", wantOK: true},
		{name: "one character", query: "a", wantOK: false},
		{name: "two characters", query: "ab", wantOK: false},
		{name: "two unicode characters", query: "中文", wantOK: false},
		{name: "percent wildcard", query: "trace%", wantOK: false},
		{name: "underscore wildcard", query: "trace_", wantOK: false},
		{name: "projection separator", query: "a\x1fb", wantOK: false},
		{name: "control character", query: "a\nb", wantOK: false},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			pattern, ok := SearchIndexLikePattern(test.query)
			if ok != test.wantOK || pattern != test.wantPattern {
				t.Fatalf("SearchIndexLikePattern(%q) = %q, %v; want %q, %v", test.query, pattern, ok, test.wantPattern, test.wantOK)
			}
		})
	}
}
