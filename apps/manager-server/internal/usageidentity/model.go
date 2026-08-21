package usageidentity

import (
	"database/sql/driver"
	"fmt"
	"strconv"
	"strings"

	modernsqlite "modernc.org/sqlite"
)

// ModelFormatVersion changes whenever the analytics model identity algorithm
// changes. Derived usage tables include this version in their structure state so
// they can be rebuilt from immutable usage_events.
const ModelFormatVersion = "1"

const sqliteAnalyticsModelFunction = "cpamp_analytics_model"

func init() {
	modernsqlite.MustRegisterDeterministicScalarFunction(
		sqliteAnalyticsModelFunction,
		1,
		func(_ *modernsqlite.FunctionContext, args []driver.Value) (driver.Value, error) {
			if len(args) == 0 || args[0] == nil {
				return "", nil
			}
			switch value := args[0].(type) {
			case string:
				return AnalyticsModel(value), nil
			case []byte:
				return AnalyticsModel(string(value)), nil
			default:
				return AnalyticsModel(fmt.Sprint(value)), nil
			}
		},
	)
}

// EffectiveRequestedModel returns the authoritative request-side model. CPA
// events normally store the same value in model and requested_model, while
// imported full-fidelity records may preserve a separate display model.
func EffectiveRequestedModel(model, requestedModel string) string {
	if requestedModel != "" {
		return requestedModel
	}
	return model
}

// AnalyticsModelForRequest returns the aggregation identity derived from the
// authoritative request-side model.
func AnalyticsModelForRequest(model, requestedModel string) string {
	return AnalyticsModel(EffectiveRequestedModel(model, requestedModel))
}

// AnalyticsModel returns the model identity used for usage aggregation and
// model-price discovery. It removes only suffixes that CPA recognizes as
// thinking configuration; unknown parenthesized aliases stay untouched.
func AnalyticsModel(model string) string {
	if model == "" {
		return ""
	}
	open := strings.LastIndex(model, "(")
	if open <= 0 || !strings.HasSuffix(model, ")") {
		return model
	}
	suffix := model[open+1 : len(model)-1]
	if !isReasoningSuffix(suffix) {
		return model
	}
	base := model[:open]
	if base == "" {
		return model
	}
	return base
}

func isReasoningSuffix(value string) bool {
	switch strings.ToLower(value) {
	case "none", "auto", "-1", "minimal", "low", "medium", "high", "xhigh", "max":
		return true
	}
	budget, err := strconv.Atoi(value)
	return err == nil && budget >= 0
}

// SQLAnalyticsModelExpression returns the SQLite expression equivalent of
// AnalyticsModel for a trusted internal table column expression.
func SQLAnalyticsModelExpression(modelExpression string) string {
	return sqliteAnalyticsModelFunction + "(coalesce(" + modelExpression + ", ''))"
}

// SQLEffectiveRequestedModelExpression returns the SQLite expression
// equivalent of EffectiveRequestedModel for trusted internal column
// expressions.
func SQLEffectiveRequestedModelExpression(modelExpression, requestedModelExpression string) string {
	return "coalesce(nullif(" + requestedModelExpression + ", ''), " + modelExpression + ", '')"
}

// SQLRequestAnalyticsModelExpression returns the SQLite expression equivalent
// of AnalyticsModelForRequest for trusted internal column expressions.
func SQLRequestAnalyticsModelExpression(modelExpression, requestedModelExpression string) string {
	return SQLAnalyticsModelExpression(SQLEffectiveRequestedModelExpression(modelExpression, requestedModelExpression))
}
