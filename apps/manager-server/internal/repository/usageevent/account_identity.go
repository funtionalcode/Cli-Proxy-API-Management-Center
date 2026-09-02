package usageevent

import (
	"context"
	"database/sql"
	"strings"

	"github.com/seakee/cpa-manager-plus/apps/manager-server/internal/usageidentity"
)

// SQLQueryer is the read-only subset shared by *sql.DB and *sql.Tx. Keeping
// the identity check on this narrow interface lets account-history and
// account-window readers evaluate the same evidence inside their own snapshot
// transaction.
type SQLQueryer interface {
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
}

type legacyAccountIdentityPredicate struct {
	sql  string
	args []any
}

// ResolveCodexLegacyAccountKey returns the file/index account key only when
// every matching usage event remains attributable to the requested Codex
// account. A false result is intentionally non-error: callers must fail
// closed and continue with the stable key only.
func ResolveCodexLegacyAccountKey(
	ctx context.Context,
	queryer SQLQueryer,
	fields usageidentity.Fields,
) (string, bool, error) {
	legacyKey, targetAccountID, authFile, authIndex, valid := codexLegacyTarget(fields)
	if !valid {
		return "", false, nil
	}

	for _, predicate := range legacyAccountIdentityPredicates(authFile, authIndex) {
		rows, err := queryer.QueryContext(ctx, `select
			coalesce(e.provider, ''),
			coalesce(e.auth_provider_snapshot, ''),
			coalesce(e.auth_account_id_snapshot, ''),
			coalesce(e.auth_project_id_snapshot, '')
		from usage_events e
		where `+predicate.sql, predicate.args...)
		if err != nil {
			return "", false, err
		}
		allowed, err := scanLegacyAccountIdentity(rows, targetAccountID)
		if err != nil {
			return "", false, err
		}
		if !allowed {
			return "", false, nil
		}
	}
	return legacyKey, true, nil
}

// ResolveCodexLegacyAccountKey evaluates the same check through a short
// read-only transaction for service-layer account-history requests.
func (r *repository) ResolveCodexLegacyAccountKey(
	ctx context.Context,
	fields usageidentity.Fields,
) (string, bool, error) {
	tx, err := r.db.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return "", false, err
	}
	defer func() { _ = tx.Rollback() }()
	key, allowed, err := ResolveCodexLegacyAccountKey(ctx, tx, fields)
	if err != nil {
		return "", false, err
	}
	if err := tx.Commit(); err != nil {
		return "", false, err
	}
	return key, allowed, nil
}

func codexLegacyTarget(fields usageidentity.Fields) (string, string, string, string, bool) {
	provider := normalizeIdentityProvider(fields.AuthProviderSnapshot)
	targetAccountID := strings.TrimSpace(fields.AuthAccountIDSnapshot)
	if provider != "codex" || targetAccountID == "" {
		return "", "", "", "", false
	}

	authFile := strings.TrimSpace(fields.AuthFileSnapshot)
	if authFile == "" {
		source := strings.TrimSpace(fields.Source)
		account := strings.TrimSpace(fields.AccountSnapshot)
		label := strings.TrimSpace(fields.AuthLabelSnapshot)
		if source != "" && !strings.EqualFold(source, account) && !strings.EqualFold(source, label) {
			authFile = source
		}
	}
	authIndex := strings.TrimSpace(fields.AuthIndex)
	if authFile == "" || authIndex == "" {
		return "", "", "", "", false
	}
	legacyKey, valid := usageidentity.LegacyAccountKey(fields)
	if !valid {
		return "", "", "", "", false
	}
	return legacyKey, targetAccountID, authFile, authIndex, true
}

func legacyAccountIdentityPredicates(authFile, authIndex string) []legacyAccountIdentityPredicate {
	predicates := make([]legacyAccountIdentityPredicate, 0, 6)
	appendIndexPredicates := func(base string, baseArgs []any) {
		if authIndex != "" {
			predicates = append(predicates, legacyAccountIdentityPredicate{
				sql:  base + ` and e.auth_index collate nocase = ?`,
				args: append(append([]any{}, baseArgs...), authIndex),
			})
			return
		}
		predicates = append(predicates,
			legacyAccountIdentityPredicate{
				sql:  base + ` and e.auth_index is null`,
				args: append([]any{}, baseArgs...),
			},
			legacyAccountIdentityPredicate{
				sql:  base + ` and e.auth_index collate nocase = ''`,
				args: append([]any{}, baseArgs...),
			},
		)
	}

	appendIndexPredicates(`e.auth_file_snapshot collate nocase = ?`, []any{authFile})
	legacySourceBase := `e.auth_file_snapshot is null and e.source collate nocase = ?` + legacySourceIdentityGuards()
	appendIndexPredicates(legacySourceBase, []any{authFile})
	legacyEmptySourceBase := `e.auth_file_snapshot = '' and e.source collate nocase = ?` + legacySourceIdentityGuards()
	appendIndexPredicates(legacyEmptySourceBase, []any{authFile})
	return predicates
}

func legacySourceIdentityGuards() string {
	// source is used as a physical file only when it is not merely the display
	// account or label. Keep the indexed source/auth_index predicates intact and
	// apply these guards as residual filters.
	return `
		and (e.account_snapshot is null or lower(trim(e.source)) <> lower(trim(e.account_snapshot)))
		and (e.auth_label_snapshot is null or lower(trim(e.source)) <> lower(trim(e.auth_label_snapshot)))`
}

func scanLegacyAccountIdentity(rows *sql.Rows, targetAccountID string) (bool, error) {
	defer rows.Close()
	seenIDs := map[string]struct{}{}
	for rows.Next() {
		var provider, authProvider, accountID, projectID string
		if err := rows.Scan(&provider, &authProvider, &accountID, &projectID); err != nil {
			return false, err
		}
		hasProvider := false
		for _, value := range []string{provider, authProvider} {
			normalized := normalizeIdentityProvider(value)
			if normalized == "" {
				continue
			}
			hasProvider = true
			if normalized != "codex" {
				return false, nil
			}
		}
		if !hasProvider {
			return false, nil
		}

		for _, value := range []string{
			strings.TrimSpace(accountID),
			usageidentity.CodexAccountIDFromSnapshot(projectID),
		} {
			if value == "" {
				continue
			}
			if value != targetAccountID {
				return false, nil
			}
			seenIDs[value] = struct{}{}
			if len(seenIDs) > 1 {
				return false, nil
			}
		}
	}
	return rows.Err() == nil, rows.Err()
}

func normalizeIdentityProvider(value string) string {
	normalized := strings.ToLower(strings.ReplaceAll(strings.TrimSpace(value), "_", "-"))
	switch normalized {
	case "x-ai", "grok":
		return "xai"
	default:
		return normalized
	}
}
