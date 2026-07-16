package adminauth

import (
	"context"
	"path/filepath"
	"strings"
	"testing"

	"github.com/seakee/cpa-manager-plus/apps/manager-server/internal/security"
	"github.com/seakee/cpa-manager-plus/apps/manager-server/internal/store"
)

func TestResetAdminKeyGeneratesNewKey(t *testing.T) {
	st := newResetTestStore(t)
	oldCredential, err := security.NewAdminCredential("cpamp_old", "test")
	if err != nil {
		t.Fatalf("create old credential: %v", err)
	}
	if err := st.SaveAdminCredential(context.Background(), oldCredential); err != nil {
		t.Fatalf("save old credential: %v", err)
	}

	result, err := ResetAdminKey(context.Background(), st, "")
	if err != nil {
		t.Fatalf("reset admin key: %v", err)
	}
	if !result.Generated || !strings.HasPrefix(result.AdminKey, "cpamp_") {
		t.Fatalf("result = %#v", result)
	}

	credential, ok, err := st.LoadAdminCredential(context.Background())
	if err != nil || !ok {
		t.Fatalf("load credential ok=%v err=%v", ok, err)
	}
	if !security.VerifyAdminKey(credential, result.AdminKey) {
		t.Fatal("generated key does not verify")
	}
	if security.VerifyAdminKey(credential, "cpamp_old") {
		t.Fatal("old key still verifies")
	}
	if credential.Source != "cli-generated" || credential.RotatedAtMS <= 0 {
		t.Fatalf("credential metadata = %#v", credential)
	}
	if credential.CreatedAtMS != oldCredential.CreatedAtMS {
		t.Fatalf("CreatedAtMS = %d, want %d", credential.CreatedAtMS, oldCredential.CreatedAtMS)
	}
}

func TestResetAdminKeyUsesProvidedKey(t *testing.T) {
	st := newResetTestStore(t)
	const newKey = "cpamp_new_key"

	result, err := ResetAdminKey(context.Background(), st, newKey)
	if err != nil {
		t.Fatalf("reset admin key: %v", err)
	}
	if result.Generated || result.AdminKey != newKey {
		t.Fatalf("result = %#v", result)
	}

	credential, ok, err := st.LoadAdminCredential(context.Background())
	if err != nil || !ok {
		t.Fatalf("load credential ok=%v err=%v", ok, err)
	}
	if !security.VerifyAdminKey(credential, newKey) {
		t.Fatal("provided key does not verify")
	}
	if credential.Source != "cli" || credential.RotatedAtMS <= 0 {
		t.Fatalf("credential metadata = %#v", credential)
	}
}

func newResetTestStore(t testing.TB) *store.Store {
	t.Helper()
	st, err := store.Open(filepath.Join(t.TempDir(), "usage.sqlite"))
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() {
		_ = st.Close()
	})
	return st
}
