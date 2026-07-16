package bootstrap

import (
	"context"
	"time"

	"github.com/seakee/cpa-manager-plus/apps/manager-server/internal/config"
	"github.com/seakee/cpa-manager-plus/apps/manager-server/internal/security"
	"github.com/seakee/cpa-manager-plus/apps/manager-server/internal/service/cpa"
	"github.com/seakee/cpa-manager-plus/apps/manager-server/internal/service/managerconfig"
	"github.com/seakee/cpa-manager-plus/apps/manager-server/internal/store"
)

type Result struct {
	GeneratedAdminKey string
	AdminCreated      bool
	DataKeyCreated    bool
	MigratedLegacy    bool
	HasHistoricalData bool
	State             store.BootstrapState
}

func Run(ctx context.Context, cfg config.Config, st *store.Store, dataKeyCreated bool) (Result, error) {
	result := Result{DataKeyCreated: dataKeyCreated}
	adminCreated, generatedAdminKey, err := ensureAdminCredential(ctx, cfg, st)
	if err != nil {
		return Result{}, err
	}
	result.AdminCreated = adminCreated
	result.GeneratedAdminKey = generatedAdminKey

	historical, err := st.HasHistoricalData(ctx)
	if err != nil {
		return Result{}, err
	}
	result.HasHistoricalData = historical

	previousState, stateFound, err := st.LoadBootstrapState(ctx)
	if err != nil {
		return Result{}, err
	}
	if !stateFound || !previousState.MigratedLegacy {
		migrated, err := migrateLegacyConfig(ctx, cfg, st)
		if err != nil {
			return Result{}, err
		}
		result.MigratedLegacy = migrated
	} else {
		result.MigratedLegacy = previousState.MigratedLegacy
	}

	projectInitialized, err := projectInitialized(ctx, cfg, st)
	if err != nil {
		return Result{}, err
	}
	state := store.BootstrapState{
		Version:            1,
		Status:             bootstrapStatus(projectInitialized, historical),
		AdminReady:         true,
		ProjectInitialized: projectInitialized,
		DataKeyReady:       true,
		MigratedLegacy:     result.MigratedLegacy,
		HasHistoricalData:  historical,
	}
	if err := st.SaveBootstrapState(ctx, state); err != nil {
		return Result{}, err
	}
	state, _, _ = st.LoadBootstrapState(ctx)
	result.State = state
	return result, nil
}

func ensureAdminCredential(ctx context.Context, cfg config.Config, st *store.Store) (bool, string, error) {
	if _, ok, err := st.LoadAdminCredential(ctx); err != nil || ok {
		return false, "", err
	}
	adminKey := cfg.AdminKey
	source := "env"
	if adminKey == "" {
		generated, err := security.GenerateAdminKey()
		if err != nil {
			return false, "", err
		}
		adminKey = generated
		source = "generated"
	}
	credential, err := security.NewAdminCredential(adminKey, source)
	if err != nil {
		return false, "", err
	}
	if err := st.SaveAdminCredential(ctx, credential); err != nil {
		return false, "", err
	}
	if source == "generated" {
		return true, adminKey, nil
	}
	return true, "", nil
}

func migrateLegacyConfig(ctx context.Context, cfg config.Config, st *store.Store) (bool, error) {
	migrated := false
	managerCfg, managerOK, err := st.LoadManagerConfig(ctx)
	if err != nil {
		return false, err
	}
	setup, setupOK, err := st.LoadSetup(ctx)
	if err != nil {
		return false, err
	}
	if !managerOK && setupOK && setup.CPAUpstreamURL != "" && setup.ManagementKey != "" {
		managerCfg = managerConfigFromSetup(cfg, setup)
		if err := st.SaveManagerConfig(ctx, managerCfg); err != nil {
			return false, err
		}
		migrated = true
	} else if managerOK {
		if err := st.SaveManagerConfig(ctx, managerCfg); err != nil {
			return false, err
		}
		migrated = true
	}
	if setupOK && setup.CPAUpstreamURL != "" && setup.ManagementKey != "" {
		if err := st.SaveSetup(ctx, setup); err != nil {
			return false, err
		}
		migrated = true
	}
	return migrated, nil
}

func managerConfigFromSetup(cfg config.Config, setup store.Setup) store.ManagerConfig {
	pollIntervalMS := int(cfg.PollInterval / time.Millisecond)
	return store.ManagerConfig{
		CPAConnection: store.ManagerCPAConnectionConfig{
			CPABaseURL:    cpa.NormalizeBaseURL(setup.CPAUpstreamURL),
			ManagementKey: setup.ManagementKey,
		},
		Collector: store.ManagerCollectorConfig{
			Enabled:        managerconfig.BoolPtr(true),
			CollectorMode:  managerconfig.CollectorMode(cfg.CollectorMode),
			Queue:          managerconfig.ValueOr(setup.Queue, cfg.Queue),
			PopSide:        managerconfig.NormalizePopSide(setup.PopSide, cfg.PopSide),
			BatchSize:      managerconfig.PositiveOrDefault(cfg.BatchSize, 100, 100),
			PollIntervalMS: managerconfig.PositiveOrDefault(pollIntervalMS, 500, 500),
			QueryLimit:     managerconfig.PositiveOrDefault(cfg.QueryLimit, 50000, 50000),
			TLSSkipVerify:  cfg.TLSSkipVerify,
		},
	}
}

func projectInitialized(ctx context.Context, cfg config.Config, st *store.Store) (bool, error) {
	if cfg.CPAUpstreamURL != "" && cfg.ManagementKey != "" {
		return true, nil
	}
	if managerCfg, ok, err := st.LoadManagerConfig(ctx); err != nil {
		return false, err
	} else if ok && managerCfg.CPAConnection.CPABaseURL != "" && managerCfg.CPAConnection.ManagementKey != "" {
		return true, nil
	}
	if setup, ok, err := st.LoadSetup(ctx); err != nil {
		return false, err
	} else if ok && setup.CPAUpstreamURL != "" && setup.ManagementKey != "" {
		return true, nil
	}
	return false, nil
}

func bootstrapStatus(projectInitialized bool, historical bool) string {
	if projectInitialized {
		if historical {
			return "migrated"
		}
		return "ready"
	}
	if historical {
		return "needs_setup"
	}
	return "fresh"
}
