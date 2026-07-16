package store

import (
	"context"
	"strings"
	"testing"

	"github.com/seakee/cpa-manager-plus/apps/manager-server/internal/security"
)

func TestStoreEncryptsSetupAndManagerConfigSecrets(t *testing.T) {
	protector := newTestProtector(t)
	db, err := Open(t.TempDir()+"/usage.sqlite", protector)
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() {
		_ = db.Close()
	})

	setup := Setup{
		CPAUpstreamURL: "http://cpa.local:8317",
		ManagementKey:  "management-key",
		Queue:          "usage",
		PopSide:        "right",
	}
	if err := db.SaveSetup(context.Background(), setup); err != nil {
		t.Fatalf("save setup: %v", err)
	}
	rawSetup := rawSettingValue(t, db, "setup")
	if strings.Contains(rawSetup, "management-key") || !strings.Contains(rawSetup, "enc:v1:") {
		t.Fatalf("setup was not encrypted at rest: %s", rawSetup)
	}
	loadedSetup, ok, err := db.LoadSetup(context.Background())
	if err != nil || !ok {
		t.Fatalf("load setup ok=%v err=%v", ok, err)
	}
	if loadedSetup.ManagementKey != "management-key" {
		t.Fatalf("loaded setup management key = %q", loadedSetup.ManagementKey)
	}

	managerCfg := ManagerConfig{
		CPAConnection: ManagerCPAConnectionConfig{
			CPABaseURL:    "http://cpa.local:8317",
			ManagementKey: "management-key",
		},
		Collector: ManagerCollectorConfig{
			Queue:          "usage",
			PopSide:        "right",
			BatchSize:      100,
			PollIntervalMS: 500,
			QueryLimit:     50000,
		},
	}
	if err := db.SaveManagerConfig(context.Background(), managerCfg); err != nil {
		t.Fatalf("save manager config: %v", err)
	}
	rawManagerConfig := rawSettingValue(t, db, "manager_config_v1")
	if strings.Contains(rawManagerConfig, "management-key") || !strings.Contains(rawManagerConfig, "enc:v1:") {
		t.Fatalf("manager config was not encrypted at rest: %s", rawManagerConfig)
	}
	loadedManagerCfg, ok, err := db.LoadManagerConfig(context.Background())
	if err != nil || !ok {
		t.Fatalf("load manager config ok=%v err=%v", ok, err)
	}
	if loadedManagerCfg.CPAConnection.ManagementKey != "management-key" {
		t.Fatalf("loaded manager config management key = %q", loadedManagerCfg.CPAConnection.ManagementKey)
	}
}

func TestStoreReadsLegacyPlaintextSecretsAndRewritesEncrypted(t *testing.T) {
	protector := newTestProtector(t)
	db, err := Open(t.TempDir()+"/usage.sqlite", protector)
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() {
		_ = db.Close()
	})

	if _, err := db.db.Exec(
		`insert into settings(key, value, updated_at_ms) values('setup', ?, 1)`,
		`{"cpaBaseUrl":"http://cpa.local:8317","managementKey":"management-key","queue":"usage","popSide":"right"}`,
	); err != nil {
		t.Fatalf("insert legacy setup: %v", err)
	}
	setup, ok, err := db.LoadSetup(context.Background())
	if err != nil || !ok {
		t.Fatalf("load legacy setup ok=%v err=%v", ok, err)
	}
	if setup.ManagementKey != "management-key" {
		t.Fatalf("legacy setup management key = %q", setup.ManagementKey)
	}
	if err := db.SaveSetup(context.Background(), setup); err != nil {
		t.Fatalf("rewrite setup: %v", err)
	}
	rawSetup := rawSettingValue(t, db, "setup")
	if strings.Contains(rawSetup, "management-key") || !strings.Contains(rawSetup, "enc:v1:") {
		t.Fatalf("legacy setup was not rewritten encrypted: %s", rawSetup)
	}
}

func newTestProtector(t testing.TB) *security.Protector {
	t.Helper()
	protector, err := security.NewProtector([]byte("0123456789abcdef0123456789abcdef"))
	if err != nil {
		t.Fatalf("create protector: %v", err)
	}
	return protector
}

func rawSettingValue(t testing.TB, db *Store, key string) string {
	t.Helper()
	var raw string
	if err := db.db.QueryRow(`select value from settings where key = ?`, key).Scan(&raw); err != nil {
		t.Fatalf("load raw setting %s: %v", key, err)
	}
	return raw
}
