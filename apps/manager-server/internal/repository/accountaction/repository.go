package accountaction

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/seakee/cpa-manager-plus/apps/manager-server/internal/model"
)

type Repository interface {
	Upsert(ctx context.Context, input model.AccountActionCandidateUpsert) (model.AccountActionCandidate, error)
	List(ctx context.Context, status string, limit int) ([]model.AccountActionCandidate, error)
	Count(ctx context.Context, status string) (int64, error)
	Get(ctx context.Context, id int64) (model.AccountActionCandidate, bool, error)
	UpdateStatus(ctx context.Context, id int64, status string) (model.AccountActionCandidate, error)
	UpdatePendingStatus(ctx context.Context, id int64, status string) (model.AccountActionCandidate, error)
	RecordFailure(ctx context.Context, id int64, reason string) error
	MarkAutoDisabled(ctx context.Context, id int64, disabledAtMS int64) error
}

type repository struct {
	db *sql.DB
}

func New(db *sql.DB) Repository {
	return &repository{db: db}
}

func (r *repository) Upsert(ctx context.Context, input model.AccountActionCandidateUpsert) (model.AccountActionCandidate, error) {
	input.AuthFileName = strings.TrimSpace(input.AuthFileName)
	if input.AuthFileName == "" {
		return model.AccountActionCandidate{}, errors.New("auth file name is required")
	}
	input.ActionType = normalizeActionType(input.ActionType)
	input.Provider = strings.TrimSpace(input.Provider)
	input.AuthIndex = strings.TrimSpace(input.AuthIndex)
	input.AccountSnapshot = strings.TrimSpace(input.AccountSnapshot)
	input.AccountIDSnapshot = strings.TrimSpace(input.AccountIDSnapshot)
	input.AuthLabel = strings.TrimSpace(input.AuthLabel)
	input.ReasonCode = strings.TrimSpace(input.ReasonCode)
	input.Reason = strings.TrimSpace(input.Reason)
	input.EvidenceJSON = strings.TrimSpace(input.EvidenceJSON)

	now := time.Now().UnixMilli()
	seenAt := input.SeenAtMS
	if seenAt <= 0 {
		seenAt = now
	}

	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return model.AccountActionCandidate{}, err
	}
	defer tx.Rollback()

	var id int64
	err = tx.QueryRowContext(ctx, `select id from account_action_candidates
		where status = ? and auth_file_name = ? and action_type = ?
		and coalesce(auth_index, '') = ? and coalesce(account_id_snapshot, '') = ?
		and coalesce(reason_code, '') = ?
		limit 1`, model.AccountActionStatusPending, input.AuthFileName, input.ActionType, input.AuthIndex, input.AccountIDSnapshot, input.ReasonCode).Scan(&id)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return model.AccountActionCandidate{}, err
	}
	if errors.Is(err, sql.ErrNoRows) {
		res, execErr := tx.ExecContext(ctx, `insert into account_action_candidates (
			action_type, status, provider, auth_file_name, auth_index, account_snapshot, account_id_snapshot, auth_label,
			reason_code, reason, auto_disable_eligible, evidence_json, first_seen_at_ms, last_seen_at_ms, hit_count, created_at_ms, updated_at_ms
		) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
			input.ActionType,
			model.AccountActionStatusPending,
			nullString(input.Provider),
			input.AuthFileName,
			nullString(input.AuthIndex),
			nullString(input.AccountSnapshot),
			nullString(input.AccountIDSnapshot),
			nullString(input.AuthLabel),
			nullString(input.ReasonCode),
			nullString(input.Reason),
			boolInt(input.AutoDisableEligible),
			nullString(input.EvidenceJSON),
			seenAt,
			seenAt,
			now,
			now,
		)
		if execErr != nil {
			return model.AccountActionCandidate{}, execErr
		}
		id, err = res.LastInsertId()
		if err != nil {
			return model.AccountActionCandidate{}, err
		}
	} else {
		_, err = tx.ExecContext(ctx, `update account_action_candidates set
			provider = coalesce(nullif(?, ''), provider),
			account_snapshot = coalesce(nullif(?, ''), account_snapshot),
			auth_label = coalesce(nullif(?, ''), auth_label),
			reason_code = coalesce(nullif(?, ''), reason_code),
			reason = coalesce(nullif(?, ''), reason),
			auto_disable_eligible = max(auto_disable_eligible, ?),
			evidence_json = coalesce(nullif(?, ''), evidence_json),
			last_error = null,
			last_seen_at_ms = ?,
			hit_count = hit_count + 1,
			updated_at_ms = ?
			where id = ?`, input.Provider, input.AccountSnapshot, input.AuthLabel, input.ReasonCode, input.Reason, boolInt(input.AutoDisableEligible), input.EvidenceJSON, seenAt, now, id)
		if err != nil {
			return model.AccountActionCandidate{}, err
		}
	}
	item, err := getByID(ctx, tx, id)
	if err != nil {
		return model.AccountActionCandidate{}, err
	}
	if err := tx.Commit(); err != nil {
		return model.AccountActionCandidate{}, err
	}
	return item, nil
}

func (r *repository) List(ctx context.Context, status string, limit int) ([]model.AccountActionCandidate, error) {
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	status = strings.TrimSpace(status)
	query := selectCandidates
	args := []any{}
	if status != "" {
		query += ` where status = ?`
		args = append(args, status)
	}
	query += ` order by case status when 'pending' then 0 else 1 end, last_seen_at_ms desc, id desc limit ?`
	args = append(args, limit)
	rows, err := r.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]model.AccountActionCandidate, 0)
	for rows.Next() {
		item, err := scanCandidate(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (r *repository) Count(ctx context.Context, status string) (int64, error) {
	var count int64
	status = strings.TrimSpace(status)
	if status == "" {
		if err := r.db.QueryRowContext(ctx, `select count(*) from account_action_candidates`).Scan(&count); err != nil {
			return 0, err
		}
		return count, nil
	}
	if err := r.db.QueryRowContext(ctx, `select count(*) from account_action_candidates where status = ?`, status).Scan(&count); err != nil {
		return 0, err
	}
	return count, nil
}

func (r *repository) Get(ctx context.Context, id int64) (model.AccountActionCandidate, bool, error) {
	if id <= 0 {
		return model.AccountActionCandidate{}, false, nil
	}
	item, err := getByID(ctx, r.db, id)
	if errors.Is(err, sql.ErrNoRows) {
		return model.AccountActionCandidate{}, false, nil
	}
	if err != nil {
		return model.AccountActionCandidate{}, false, err
	}
	return item, true, nil
}

func (r *repository) UpdateStatus(ctx context.Context, id int64, status string) (model.AccountActionCandidate, error) {
	return r.updateStatus(ctx, id, status, false)
}

func (r *repository) UpdatePendingStatus(ctx context.Context, id int64, status string) (model.AccountActionCandidate, error) {
	return r.updateStatus(ctx, id, status, true)
}

func (r *repository) updateStatus(ctx context.Context, id int64, status string, pendingOnly bool) (model.AccountActionCandidate, error) {
	status = normalizeStatus(status)
	if id <= 0 {
		return model.AccountActionCandidate{}, errors.New("candidate id is required")
	}
	now := time.Now().UnixMilli()
	query := `update account_action_candidates set status = ?, last_error = null, updated_at_ms = ? where id = ?`
	args := []any{status, now, id}
	if pendingOnly {
		query += ` and status = ?`
		args = append(args, model.AccountActionStatusPending)
	}
	res, err := r.db.ExecContext(ctx, query, args...)
	if err != nil {
		return model.AccountActionCandidate{}, err
	}
	affected, _ := res.RowsAffected()
	if affected == 0 {
		return model.AccountActionCandidate{}, sql.ErrNoRows
	}
	return r.mustGet(ctx, id)
}

func (r *repository) RecordFailure(ctx context.Context, id int64, reason string) error {
	if id <= 0 {
		return errors.New("candidate id is required")
	}
	_, err := r.db.ExecContext(ctx, `update account_action_candidates set last_error = ?, updated_at_ms = ? where id = ?`, nullString(reason), time.Now().UnixMilli(), id)
	return err
}

func (r *repository) MarkAutoDisabled(ctx context.Context, id int64, disabledAtMS int64) error {
	if id <= 0 {
		return errors.New("candidate id is required")
	}
	if disabledAtMS <= 0 {
		disabledAtMS = time.Now().UnixMilli()
	}
	res, err := r.db.ExecContext(ctx, `update account_action_candidates set auto_disabled_at_ms = ?, last_error = null, updated_at_ms = ? where id = ?`, disabledAtMS, disabledAtMS, id)
	if err != nil {
		return err
	}
	affected, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if affected == 0 {
		return sql.ErrNoRows
	}
	return nil
}

func (r *repository) mustGet(ctx context.Context, id int64) (model.AccountActionCandidate, error) {
	item, ok, err := r.Get(ctx, id)
	if err != nil {
		return model.AccountActionCandidate{}, err
	}
	if !ok {
		return model.AccountActionCandidate{}, sql.ErrNoRows
	}
	return item, nil
}

type queryer interface {
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
}

const selectCandidates = `select id, action_type, status, provider, auth_file_name, auth_index, account_snapshot, account_id_snapshot, auth_label,
	reason_code, reason, auto_disable_eligible, auto_disabled_at_ms, evidence_json, last_error, first_seen_at_ms, last_seen_at_ms, hit_count, created_at_ms, updated_at_ms
	from account_action_candidates`

func getByID(ctx context.Context, q queryer, id int64) (model.AccountActionCandidate, error) {
	return scanCandidate(q.QueryRowContext(ctx, selectCandidates+` where id = ?`, id))
}

type rowScanner interface {
	Scan(dest ...any) error
}

func scanCandidate(row rowScanner) (model.AccountActionCandidate, error) {
	var item model.AccountActionCandidate
	var provider, authIndex, accountSnapshot, accountIDSnapshot, authLabel, reasonCode, reason, evidenceJSON, lastError sql.NullString
	var autoDisableEligible int
	var autoDisabledAtMS sql.NullInt64
	if err := row.Scan(
		&item.ID,
		&item.ActionType,
		&item.Status,
		&provider,
		&item.AuthFileName,
		&authIndex,
		&accountSnapshot,
		&accountIDSnapshot,
		&authLabel,
		&reasonCode,
		&reason,
		&autoDisableEligible,
		&autoDisabledAtMS,
		&evidenceJSON,
		&lastError,
		&item.FirstSeenAtMS,
		&item.LastSeenAtMS,
		&item.HitCount,
		&item.CreatedAtMS,
		&item.UpdatedAtMS,
	); err != nil {
		return model.AccountActionCandidate{}, err
	}
	item.Provider = provider.String
	item.AuthIndex = authIndex.String
	item.AccountSnapshot = accountSnapshot.String
	item.AccountIDSnapshot = accountIDSnapshot.String
	item.AuthLabel = authLabel.String
	item.ReasonCode = reasonCode.String
	item.Reason = reason.String
	item.AutoDisableEligible = autoDisableEligible != 0
	if autoDisabledAtMS.Valid {
		item.AutoDisabledAtMS = autoDisabledAtMS.Int64
	}
	item.EvidenceJSON = evidenceJSON.String
	item.LastError = lastError.String
	if item.EvidenceJSON != "" {
		var evidence any
		if err := json.Unmarshal([]byte(item.EvidenceJSON), &evidence); err == nil {
			item.Evidence = evidence
		}
	}
	return item, nil
}

func normalizeActionType(value string) string {
	switch strings.TrimSpace(value) {
	case model.AccountActionTypeReauth:
		return model.AccountActionTypeReauth
	case model.AccountActionTypeReview:
		return model.AccountActionTypeReview
	default:
		return model.AccountActionTypeDelete
	}
}

func normalizeStatus(value string) string {
	switch strings.TrimSpace(value) {
	case model.AccountActionStatusIgnored:
		return model.AccountActionStatusIgnored
	case model.AccountActionStatusResolved:
		return model.AccountActionStatusResolved
	case model.AccountActionStatusDeleted:
		return model.AccountActionStatusDeleted
	default:
		return model.AccountActionStatusPending
	}
}

func nullString(value string) any {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	return strings.TrimSpace(value)
}

func boolInt(value bool) int {
	if value {
		return 1
	}
	return 0
}
