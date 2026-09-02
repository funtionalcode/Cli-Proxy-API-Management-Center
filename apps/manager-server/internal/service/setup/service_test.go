package setup

import (
	"context"
	"database/sql"
	"encoding/json"
	"strings"
	"testing"

	collectorpkg "github.com/seakee/cpa-manager-plus/apps/manager-server/internal/collector"
	"github.com/seakee/cpa-manager-plus/apps/manager-server/internal/config"
	collectorservice "github.com/seakee/cpa-manager-plus/apps/manager-server/internal/service/collector"
	"github.com/seakee/cpa-manager-plus/apps/manager-server/internal/service/managerconfig"
	"github.com/seakee/cpa-manager-plus/apps/manager-server/internal/store"
	"github.com/seakee/cpa-manager-plus/apps/manager-server/internal/testutil"
	_ "modernc.org/sqlite"
)

func TestSetupRecoversAuthoritylessPartialHistoricalConnections(t *testing.T) {
	tests := []struct {
		name          string
		managerConfig *store.ManagerConfig
		setup         *store.Setup
	}{
		{
			name:  "setup key only",
			setup: &store.Setup{ManagementKey: "stale-key"},
		},
		{
			name:  "setup URL only",
			setup: &store.Setup{CPAUpstreamURL: "http://stale-cpa.local:8317"},
		},
		{
			name: "partial manager config without complete setup",
			managerConfig: &store.ManagerConfig{CPAConnection: store.ManagerCPAConnectionConfig{
				CPABaseURL: "http://stale-cpa.local:8317",
			}},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			cpa := testutil.NewCPAMock(t)
			cpa.ManagementKey = "new-management-key"
			service, st, _ := newSetupService(t, tt.managerConfig, tt.setup)

			result, err := service.Setup(context.Background(), Request{
				CPAUpstreamURL:               cpa.URL(),
				ManagementKey:                cpa.ManagementKey,
				RequestMonitoringEnabled:     boolPtr(false),
				EnsureUsageStatisticsEnabled: boolPtr(false),
			}, "")
			if err != nil {
				t.Fatalf("setup recovery: %v", err)
			}
			if !result.OK || result.Upstream != cpa.URL() {
				t.Fatalf("setup result = %#v", result)
			}

			managerCfg, ok, err := st.LoadManagerConfig(context.Background())
			if err != nil || !ok {
				t.Fatalf("load recovered manager config ok=%v err=%v", ok, err)
			}
			if managerCfg.CPAConnection.CPABaseURL != cpa.URL() ||
				managerCfg.CPAConnection.ManagementKey != cpa.ManagementKey {
				t.Fatalf("recovered manager connection = %#v", managerCfg.CPAConnection)
			}
			setup, ok, err := st.LoadSetup(context.Background())
			if err != nil || !ok {
				t.Fatalf("load recovered setup ok=%v err=%v", ok, err)
			}
			if setup.CPAUpstreamURL != cpa.URL() || setup.ManagementKey != cpa.ManagementKey {
				t.Fatalf("recovered setup = %#v", setup)
			}
		})
	}
}

func TestSetupRejectsResolverConflictDespiteNeedsSetupState(t *testing.T) {
	cpa := testutil.NewCPAMock(t)
	service, _, _ := newSetupService(t,
		&store.ManagerConfig{CPAConnection: store.ManagerCPAConnectionConfig{
			CPABaseURL: "http://manager-cpa.local:8317",
		}},
		&store.Setup{
			CPAUpstreamURL: "http://setup-cpa.local:8317",
			ManagementKey:  "setup-key",
		})

	_, err := service.Setup(context.Background(), Request{
		CPAUpstreamURL:               cpa.URL(),
		ManagementKey:                cpa.ManagementKey,
		RequestMonitoringEnabled:     boolPtr(false),
		EnsureUsageStatisticsEnabled: boolPtr(false),
	}, "")
	if err == nil || !strings.Contains(err.Error(), "conflicts") {
		t.Fatalf("resolver conflict error = %v", err)
	}
}

func TestSetupResolutionPreservesLegacyCollectorSettingsForPartialManager(t *testing.T) {
	cpa := testutil.NewCPAMock(t)
	service, _, _ := newSetupService(t,
		&store.ManagerConfig{CPAConnection: store.ManagerCPAConnectionConfig{
			CPABaseURL: cpa.URL(),
		}},
		&store.Setup{
			CPAUpstreamURL: cpa.URL(),
			ManagementKey:  cpa.ManagementKey,
			Queue:          "legacy-usage",
			PopSide:        "left",
		})

	resolved, source, ok, err := service.managerConfigService.ResolveManagerConfigWithSource(context.Background())
	if err != nil {
		t.Fatalf("resolve partial manager config: %v", err)
	}
	if !ok || source != managerconfig.SourceDB {
		t.Fatalf("resolved source/ok = %q/%v", source, ok)
	}
	if resolved.CPAConnection.CPABaseURL != cpa.URL() || resolved.CPAConnection.ManagementKey != cpa.ManagementKey {
		t.Fatalf("resolved connection = %#v", resolved.CPAConnection)
	}
	if resolved.Collector.Queue != "legacy-usage" || resolved.Collector.PopSide != "left" {
		t.Fatalf("resolved collector = %#v", resolved.Collector)
	}
}

func TestSetupKeepsCompleteConnectionRotationRules(t *testing.T) {
	cpa := testutil.NewCPAMock(t)
	cpa.ManagementKey = "old-management-key"
	service, st, _ := newSetupService(t, nil, nil)
	if err := st.SaveManagerConfigAndSetup(context.Background(), store.ManagerConfig{
		CPAConnection: store.ManagerCPAConnectionConfig{
			CPABaseURL:    cpa.URL(),
			ManagementKey: cpa.ManagementKey,
		},
	}, store.Setup{
		CPAUpstreamURL: cpa.URL(),
		ManagementKey:  cpa.ManagementKey,
	}); err != nil {
		t.Fatalf("save complete connection: %v", err)
	}

	cpa.ManagementKey = "rotated-management-key"
	if _, err := service.Setup(context.Background(), Request{
		CPAUpstreamURL:               cpa.URL(),
		ManagementKey:                cpa.ManagementKey,
		RequestMonitoringEnabled:     boolPtr(false),
		EnsureUsageStatisticsEnabled: boolPtr(false),
	}, ""); err != nil {
		t.Fatalf("valid same-URL key rotation rejected: %v", err)
	}

	if _, err := service.Setup(context.Background(), Request{
		CPAUpstreamURL:               "http://different-cpa.local:8317",
		ManagementKey:                "different-management-key",
		RequestMonitoringEnabled:     boolPtr(false),
		EnsureUsageStatisticsEnabled: boolPtr(false),
	}, ""); err == nil || !strings.Contains(err.Error(), "invalid management key for existing setup") {
		t.Fatalf("different URL/key rotation error = %v", err)
	}

	if _, err := service.Setup(context.Background(), Request{
		CPAUpstreamURL:               "",
		ManagementKey:                "partial-key",
		RequestMonitoringEnabled:     boolPtr(false),
		EnsureUsageStatisticsEnabled: boolPtr(false),
	}, ""); err == nil || !strings.Contains(err.Error(), "cpaBaseUrl and managementKey are required") {
		t.Fatalf("partial request error = %v", err)
	}
}

func newSetupService(t *testing.T, managerCfg *store.ManagerConfig, setup *store.Setup) (*Service, *store.Store, config.Config) {
	t.Helper()
	cfg := testutil.NewConfig(t)
	schemaStore, err := store.Open(cfg.DBPath)
	if err != nil {
		t.Fatalf("initialize setup fixture database: %v", err)
	}
	if err := schemaStore.Close(); err != nil {
		t.Fatalf("close setup fixture database: %v", err)
	}
	writePartialConnectionRows(t, cfg.DBPath, managerCfg, setup)
	st := testutil.NewStore(t, cfg)
	collector := collectorservice.New(collectorpkg.NewManager(cfg, st))
	managerConfigService := managerconfig.New(cfg, st, collector)
	return New(cfg, st, collector, managerConfigService, 1, "test"), st, cfg
}

func writePartialConnectionRows(t *testing.T, dbPath string, managerCfg *store.ManagerConfig, setup *store.Setup) {
	t.Helper()
	// Seed the raw historical rows before opening the service store. Keeping two
	// SQLite pools open while replacing settings makes the fixture depend on
	// connection scheduling and can hide the behavior under test.
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		t.Fatalf("open raw sqlite: %v", err)
	}
	defer db.Close()
	if managerCfg != nil {
		data, err := json.Marshal(managerCfg)
		if err != nil {
			t.Fatalf("marshal manager config: %v", err)
		}
		if _, err := db.Exec(`insert into settings(key, value, updated_at_ms) values('manager_config_v1', ?, 1)
			on conflict(key) do update set value = excluded.value`, string(data)); err != nil {
			t.Fatalf("write manager config fixture: %v", err)
		}
	}
	if setup != nil {
		data, err := json.Marshal(setup)
		if err != nil {
			t.Fatalf("marshal setup: %v", err)
		}
		if _, err := db.Exec(`insert into settings(key, value, updated_at_ms) values('setup', ?, 1)
			on conflict(key) do update set value = excluded.value`, string(data)); err != nil {
			t.Fatalf("write setup fixture: %v", err)
		}
	}
}

func boolPtr(value bool) *bool {
	return &value
}
