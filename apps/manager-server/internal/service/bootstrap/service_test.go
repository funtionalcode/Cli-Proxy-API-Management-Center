package bootstrap

import (
	"context"
	"database/sql"
	"path/filepath"
	"strings"
	"testing"

	"github.com/seakee/cpa-manager-plus/apps/manager-server/internal/config"
	"github.com/seakee/cpa-manager-plus/apps/manager-server/internal/security"
	"github.com/seakee/cpa-manager-plus/apps/manager-server/internal/store"

	_ "modernc.org/sqlite"
)

func TestRunMigratesLegacySetupAndEncryptsSecrets(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "usage.sqlite")
	legacyStore, err := store.Open(dbPath)
	if err != nil {
		t.Fatalf("open legacy store: %v", err)
	}
	if err := legacyStore.SaveSetup(context.Background(), store.Setup{
		CPAUpstreamURL: "http://cpa.local:8317",
		ManagementKey:  "management-key",
		Queue:          "usage",
		PopSide:        "right",
	}); err != nil {
		t.Fatalf("save legacy setup: %v", err)
	}
	if err := legacyStore.Close(); err != nil {
		t.Fatalf("close legacy store: %v", err)
	}

	protector, err := security.NewProtector([]byte("0123456789abcdef0123456789abcdef"))
	if err != nil {
		t.Fatalf("create protector: %v", err)
	}
	st, err := store.Open(dbPath, protector)
	if err != nil {
		t.Fatalf("open protected store: %v", err)
	}
	t.Cleanup(func() {
		_ = st.Close()
	})

	result, err := Run(context.Background(), config.Config{
		DBPath:        dbPath,
		Queue:         "usage",
		PopSide:       "right",
		BatchSize:     100,
		QueryLimit:    50000,
		CollectorMode: "auto",
	}, st, true)
	if err != nil {
		t.Fatalf("bootstrap: %v", err)
	}
	if !result.AdminCreated || result.GeneratedAdminKey == "" {
		t.Fatalf("admin credential result = %#v", result)
	}
	if !result.MigratedLegacy || !result.HasHistoricalData || !result.State.ProjectInitialized {
		t.Fatalf("bootstrap result = %#v", result)
	}

	credential, ok, err := st.LoadAdminCredential(context.Background())
	if err != nil || !ok {
		t.Fatalf("load admin credential ok=%v err=%v", ok, err)
	}
	if !security.VerifyAdminKey(credential, result.GeneratedAdminKey) {
		t.Fatal("generated admin key does not verify")
	}
	if security.VerifyAdminKey(credential, "management-key") {
		t.Fatal("cpa management key should not verify as admin key")
	}

	managerCfg, ok, err := st.LoadManagerConfig(context.Background())
	if err != nil || !ok {
		t.Fatalf("load migrated manager config ok=%v err=%v", ok, err)
	}
	if managerCfg.CPAConnection.CPABaseURL != "http://cpa.local:8317" ||
		managerCfg.CPAConnection.ManagementKey != "management-key" {
		t.Fatalf("migrated manager config = %#v", managerCfg)
	}

	for _, key := range []string{"setup", "manager_config_v1"} {
		raw := rawBootstrapSettingValue(t, dbPath, key)
		if strings.Contains(raw, "management-key") || !strings.Contains(raw, "enc:v1:") {
			t.Fatalf("%s setting was not encrypted: %s", key, raw)
		}
	}
}

func rawBootstrapSettingValue(t testing.TB, dbPath string, key string) string {
	t.Helper()
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		t.Fatalf("open raw sqlite: %v", err)
	}
	defer db.Close()

	var raw string
	if err := db.QueryRow(`select value from settings where key = ?`, key).Scan(&raw); err != nil {
		t.Fatalf("load raw setting %s: %v", key, err)
	}
	return raw
}
