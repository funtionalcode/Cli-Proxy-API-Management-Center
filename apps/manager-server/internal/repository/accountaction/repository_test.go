package accountaction_test

import (
	"context"
	"database/sql"
	"errors"
	"testing"

	"github.com/seakee/cpa-manager-plus/apps/manager-server/internal/model"
	"github.com/seakee/cpa-manager-plus/apps/manager-server/internal/testutil"
)

func TestUpsertMergesPendingCandidateByAuthFileAndAction(t *testing.T) {
	ctx := context.Background()
	cfg := testutil.NewConfig(t)
	st := testutil.NewStore(t, cfg)
	repo := st.AccountActions

	first, err := repo.Upsert(ctx, model.AccountActionCandidateUpsert{
		ActionType:          model.AccountActionTypeDelete,
		Provider:            "codex",
		AuthFileName:        "codex-auth.json",
		AuthIndex:           "3",
		AccountSnapshot:     "user@example.com",
		AuthLabel:           "User",
		ReasonCode:          "token_revoked",
		Reason:              "token revoked",
		AutoDisableEligible: true,
		EvidenceJSON:        `{"code":"token_revoked"}`,
		SeenAtMS:            1000,
	})
	if err != nil {
		t.Fatalf("upsert first: %v", err)
	}
	if first.ID == 0 || first.HitCount != 1 || first.Status != model.AccountActionStatusPending || first.ReasonCode != "token_revoked" || !first.AutoDisableEligible {
		t.Fatalf("first candidate = %#v", first)
	}

	second, err := repo.Upsert(ctx, model.AccountActionCandidateUpsert{
		ActionType:      model.AccountActionTypeDelete,
		Provider:        "codex",
		AuthFileName:    "codex-auth.json",
		AuthIndex:       "3",
		AccountSnapshot: "user@example.com",
		ReasonCode:      "token_revoked",
		Reason:          "token revoked again",
		EvidenceJSON:    `{"code":"token_revoked","hit":2}`,
		SeenAtMS:        2000,
	})
	if err != nil {
		t.Fatalf("upsert second: %v", err)
	}
	if second.ID != first.ID {
		t.Fatalf("second ID = %d, want %d", second.ID, first.ID)
	}
	if second.HitCount != 2 || second.LastSeenAtMS != 2000 || second.Reason != "token revoked again" {
		t.Fatalf("second candidate = %#v", second)
	}

	pending, err := repo.List(ctx, model.AccountActionStatusPending, 10)
	if err != nil {
		t.Fatalf("list pending: %v", err)
	}
	if len(pending) != 1 {
		t.Fatalf("pending count = %d", len(pending))
	}
	count, err := repo.Count(ctx, model.AccountActionStatusPending)
	if err != nil {
		t.Fatalf("count pending: %v", err)
	}
	if count != 1 {
		t.Fatalf("count = %d", count)
	}
	if err := repo.MarkAutoDisabled(ctx, first.ID, 2500); err != nil {
		t.Fatalf("mark auto disabled: %v", err)
	}
	marked, ok, err := repo.Get(ctx, first.ID)
	if err != nil || !ok || marked.AutoDisabledAtMS != 2500 {
		t.Fatalf("marked candidate = %#v ok=%v err=%v", marked, ok, err)
	}
	if err := repo.MarkAutoDisabled(ctx, first.ID+999, 2600); !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("mark missing candidate error = %v", err)
	}

	ignored, err := repo.UpdateStatus(ctx, first.ID, model.AccountActionStatusIgnored)
	if err != nil {
		t.Fatalf("ignore: %v", err)
	}
	if ignored.Status != model.AccountActionStatusIgnored {
		t.Fatalf("ignored status = %q", ignored.Status)
	}

	third, err := repo.Upsert(ctx, model.AccountActionCandidateUpsert{
		ActionType:   model.AccountActionTypeDelete,
		AuthFileName: "codex-auth.json",
		Reason:       "new pending after ignored",
		SeenAtMS:     3000,
	})
	if err != nil {
		t.Fatalf("upsert third: %v", err)
	}
	if third.ID == first.ID || third.HitCount != 1 || third.Status != model.AccountActionStatusPending {
		t.Fatalf("third candidate = %#v", third)
	}
}

func TestUpsertKeepsDifferentReasonCodesSeparate(t *testing.T) {
	ctx := context.Background()
	cfg := testutil.NewConfig(t)
	st := testutil.NewStore(t, cfg)
	repo := st.AccountActions

	credentialPermission, err := repo.Upsert(ctx, model.AccountActionCandidateUpsert{
		ActionType:          model.AccountActionTypeReview,
		Provider:            "xai",
		AuthFileName:        "xai-auth.json",
		AuthIndex:           "1",
		ReasonCode:          "credential_permission_denied",
		Reason:              "credential permission denied",
		AutoDisableEligible: true,
		SeenAtMS:            1000,
	})
	if err != nil {
		t.Fatalf("upsert credential permission: %v", err)
	}
	regional, err := repo.Upsert(ctx, model.AccountActionCandidateUpsert{
		ActionType:          model.AccountActionTypeReview,
		Provider:            "xai",
		AuthFileName:        "xai-auth.json",
		AuthIndex:           "1",
		ReasonCode:          "authentication_review",
		Reason:              "regional permission denied",
		AutoDisableEligible: false,
		SeenAtMS:            2000,
	})
	if err != nil {
		t.Fatalf("upsert regional review: %v", err)
	}
	if regional.ID == credentialPermission.ID {
		t.Fatalf("different reason codes merged into candidate %d", regional.ID)
	}
	items, err := repo.List(ctx, model.AccountActionStatusPending, 10)
	if err != nil {
		t.Fatalf("list pending: %v", err)
	}
	if len(items) != 2 {
		t.Fatalf("items = %#v", items)
	}
	if !credentialPermission.AutoDisableEligible || regional.AutoDisableEligible {
		t.Fatalf("eligibility credential=%t regional=%t", credentialPermission.AutoDisableEligible, regional.AutoDisableEligible)
	}
}
