package model

// AutomationSettings stores UI-managed account-processing-policy overrides.
// Nil fields mean "not configured in DB" and fall back to startup config unless
// the corresponding environment variable explicitly locks the value.
//
// JSON field names use the business-facing account-processing-policy vocabulary
// (codex quota cooldown / auth issue queue / auth issue auto-disable) to match
// the HTTP route and UI. The underlying config.json keys and environment
// variables keep their original names, which are surfaced separately.
type AutomationSettings struct {
	QuotaCooldownEnabled      *bool `json:"codexQuotaCooldownEnabled,omitempty"`
	AccountActionsEnabled     *bool `json:"authIssueQueueEnabled,omitempty"`
	AccountActionsAutoDisable *bool `json:"authIssueAutoDisableEnabled,omitempty"`
	UpdatedAtMS               int64 `json:"updatedAtMs,omitempty"`
}
