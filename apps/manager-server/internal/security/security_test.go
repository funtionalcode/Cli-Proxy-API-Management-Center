package security

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestAdminCredentialVerifiesOnlyAdminKey(t *testing.T) {
	const adminKey = "cpamp_test_key_0123456789abcdef"

	credential, err := NewAdminCredential(adminKey, "test")
	if err != nil {
		t.Fatalf("create credential: %v", err)
	}
	if !VerifyAdminKey(credential, adminKey) {
		t.Fatal("admin key did not verify")
	}
	if VerifyAdminKey(credential, "management-key") {
		t.Fatal("cpa management key should not verify as admin key")
	}
	if strings.Contains(credential.KeyHash, adminKey) || strings.Contains(credential.Salt, adminKey) {
		t.Fatalf("credential contains admin key material: %#v", credential)
	}
}

func TestAdminCredentialStillAcceptsLegacyAdminKeyPrefix(t *testing.T) {
	const adminKey = "cmp_admin_test_key_0123456789abcdef"

	credential, err := NewAdminCredential(adminKey, "test")
	if err != nil {
		t.Fatalf("create credential: %v", err)
	}
	if !VerifyAdminKey(credential, adminKey) {
		t.Fatal("legacy admin key did not verify")
	}
}

func TestGenerateAdminKeyUsesExpectedPrefixAndEntropyLength(t *testing.T) {
	adminKey, err := GenerateAdminKey()
	if err != nil {
		t.Fatalf("generate admin key: %v", err)
	}
	if !strings.HasPrefix(adminKey, "cpamp_") {
		t.Fatalf("admin key = %q", adminKey)
	}
	secret := strings.TrimPrefix(adminKey, "cpamp_")
	if got, want := len(secret), 32; got != want {
		t.Fatalf("random length = %d, want %d", got, want)
	}
	if !isAlnum(secret) {
		t.Fatalf("admin key contains non-alphanumeric characters: %q", adminKey)
	}
}

func TestRandomAlnumRejectsInvalidLength(t *testing.T) {
	if value, err := randomAlnum(0); err == nil || value != "" {
		t.Fatalf("randomAlnum(0) = %q, %v; want empty value and error", value, err)
	}
}

func TestProtectorEncryptsAndDecryptsString(t *testing.T) {
	protector, err := NewProtector([]byte("0123456789abcdef0123456789abcdef"))
	if err != nil {
		t.Fatalf("create protector: %v", err)
	}

	encrypted, err := protector.ProtectString("management-key")
	if err != nil {
		t.Fatalf("protect string: %v", err)
	}
	if encrypted == "management-key" || !IsProtected(encrypted) {
		t.Fatalf("encrypted value = %q", encrypted)
	}

	plaintext, err := protector.UnprotectString(encrypted)
	if err != nil {
		t.Fatalf("unprotect string: %v", err)
	}
	if plaintext != "management-key" {
		t.Fatalf("plaintext = %q", plaintext)
	}

	otherProtector, err := NewProtector([]byte("abcdef0123456789abcdef0123456789"))
	if err != nil {
		t.Fatalf("create other protector: %v", err)
	}
	if _, err := otherProtector.UnprotectString(encrypted); err == nil {
		t.Fatal("decrypt with wrong data key succeeded")
	}
}

func TestLoadOrCreateDataKeyCreatesStableRestrictedFile(t *testing.T) {
	keyPath := filepath.Join(t.TempDir(), "data.key")

	first, created, err := LoadOrCreateDataKey("", keyPath)
	if err != nil {
		t.Fatalf("create data key: %v", err)
	}
	if !created || len(first) != 32 {
		t.Fatalf("created=%v len=%d", created, len(first))
	}

	info, err := os.Stat(keyPath)
	if err != nil {
		t.Fatalf("stat data key: %v", err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("data key permissions = %o, want 600", info.Mode().Perm())
	}

	second, created, err := LoadOrCreateDataKey("", keyPath)
	if err != nil {
		t.Fatalf("load data key: %v", err)
	}
	if created || string(second) != string(first) {
		t.Fatalf("second created=%v key stable=%v", created, string(second) == string(first))
	}
}

func isAlnum(value string) bool {
	for _, r := range value {
		if r >= '0' && r <= '9' {
			continue
		}
		if r >= 'A' && r <= 'Z' {
			continue
		}
		if r >= 'a' && r <= 'z' {
			continue
		}
		return false
	}
	return value != ""
}
