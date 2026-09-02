package managerconfig

import (
	"testing"

	"github.com/seakee/cpa-manager-plus/apps/manager-server/internal/store"
)

func TestResolveLegacyConnectionAuthorityMatrix(t *testing.T) {
	const (
		urlA = "http://cpa-a.local:8317"
		urlB = "http://cpa-b.local:8317"
		key  = "key-a"
	)
	tests := []struct {
		name          string
		managerOK     bool
		managerURL    string
		managerKey    string
		setupOK       bool
		setupURL      string
		setupKey      string
		wantAuthority LegacyConnectionAuthority
		wantURL       string
		wantKey       string
		wantErr       bool
	}{
		{
			name:          "complete manager wins over conflicting setup",
			managerOK:     true,
			managerURL:    urlA,
			managerKey:    key,
			setupOK:       true,
			setupURL:      urlB,
			setupKey:      "key-b",
			wantAuthority: LegacyConnectionAuthorityManager,
			wantURL:       urlA,
			wantKey:       key,
		},
		{
			name:          "matching setup repairs manager URL partial",
			managerOK:     true,
			managerURL:    urlA,
			setupOK:       true,
			setupURL:      urlA,
			setupKey:      key,
			wantAuthority: LegacyConnectionAuthoritySetup,
			wantURL:       urlA,
			wantKey:       key,
		},
		{
			name:       "setup URL conflicts with manager URL partial",
			managerOK:  true,
			managerURL: urlA,
			setupOK:    true,
			setupURL:   urlB,
			setupKey:   key,
			wantErr:    true,
		},
		{
			name:          "matching setup repairs manager key partial",
			managerOK:     true,
			managerKey:    key,
			setupOK:       true,
			setupURL:      urlA,
			setupKey:      key,
			wantAuthority: LegacyConnectionAuthoritySetup,
			wantURL:       urlA,
			wantKey:       key,
		},
		{
			name:       "setup key conflicts with manager key partial",
			managerOK:  true,
			managerKey: "key-manager",
			setupOK:    true,
			setupURL:   urlA,
			setupKey:   "key-setup",
			wantErr:    true,
		},
		{
			name:          "setup is authority when manager is missing",
			setupOK:       true,
			setupURL:      urlA,
			setupKey:      key,
			wantAuthority: LegacyConnectionAuthoritySetup,
			wantURL:       urlA,
			wantKey:       key,
		},
		{
			name:          "partial rows are not combined from manager URL and setup key",
			managerOK:     true,
			managerURL:    urlA,
			setupOK:       true,
			setupKey:      key,
			wantAuthority: LegacyConnectionAuthorityNone,
		},
		{
			name:          "partial rows are not combined from manager key and setup URL",
			managerOK:     true,
			managerKey:    key,
			setupOK:       true,
			setupURL:      urlA,
			wantAuthority: LegacyConnectionAuthorityNone,
		},
		{
			name:       "overlapping partial URLs conflict",
			managerOK:  true,
			managerURL: urlA,
			setupOK:    true,
			setupURL:   urlB,
			wantErr:    true,
		},
		{
			name:       "overlapping partial keys conflict",
			managerOK:  true,
			managerKey: "key-manager",
			setupOK:    true,
			setupKey:   "key-setup",
			wantErr:    true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			resolution, err := ResolveLegacyConnectionAuthority(
				store.ManagerConfig{CPAConnection: store.ManagerCPAConnectionConfig{
					CPABaseURL:    tt.managerURL,
					ManagementKey: tt.managerKey,
				}},
				tt.managerOK,
				store.Setup{CPAUpstreamURL: tt.setupURL, ManagementKey: tt.setupKey},
				tt.setupOK,
			)
			if (err != nil) != tt.wantErr {
				t.Fatalf("error = %v, wantErr=%v", err, tt.wantErr)
			}
			if tt.wantErr {
				return
			}
			if resolution.Authority != tt.wantAuthority {
				t.Fatalf("authority = %q, want %q", resolution.Authority, tt.wantAuthority)
			}
			if resolution.Connection.BaseURL != tt.wantURL || resolution.Connection.ManagementKey != tt.wantKey {
				t.Fatalf("connection = %#v, want URL=%q key=%q", resolution.Connection, tt.wantURL, tt.wantKey)
			}
		})
	}
}

func TestLegacyConnectionResolutionValidatesRequestedInput(t *testing.T) {
	resolution, err := ResolveLegacyConnectionAuthority(
		store.ManagerConfig{CPAConnection: store.ManagerCPAConnectionConfig{CPABaseURL: "http://cpa-a.local:8317"}},
		true,
		store.Setup{ManagementKey: "key-a"},
		true,
	)
	if err != nil {
		t.Fatalf("resolve partial rows: %v", err)
	}
	if err := resolution.ValidateRequestedLegacyConnection(LegacyConnection{
		BaseURL:       "http://cpa-a.local:8317/",
		ManagementKey: "key-a",
	}); err != nil {
		t.Fatalf("matching explicit input rejected: %v", err)
	}
	if err := resolution.ValidateRequestedLegacyConnection(LegacyConnection{
		BaseURL:       "http://cpa-a.local:8317",
		ManagementKey: "key-b",
	}); err == nil {
		t.Fatal("conflicting partial key was accepted")
	}
}
