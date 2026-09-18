import { apiClient } from './client';

export interface ProbeConfig {
  auth_source: 'account' | 'external';
  auth_id: string;
  base_url: string;
  has_api_key: boolean;
  model: string;
  accounts: Array<{ id: string; label: string; available: boolean; reason?: string }>;
}

export interface ProbeEvent {
  time: string;
  kind: 'probe' | 'injection';
  outcome: 'success' | 'failed' | 'skipped';
  source?: string;
  auth_id?: string;
  model?: string;
  length?: number;
  latency_ms?: number;
  gateway_pool?: string;
  gateway_proxy?: string;
  message: string;
}

export interface ProbeStats {
  enabled: boolean;
  inject_business?: boolean;
  prober_active: boolean;
  pool_size: number;
  current_state_length: number;
  total_probed: number;
  total_success: number;
  total_failed: number;
  total_injected: number;
  total_skipped: number;
  recent_events: ProbeEvent[];
}

export interface ExternalProbeAccountStatus {
  authenticated: boolean;
  total_accounts: number;
  active_accounts: number;
}

export interface ExternalDeviceLogin {
  user_code: string;
  verification_uri: string;
  verification_uri_complete?: string;
  device_code: string;
  expires_in: number;
  interval: number;
}

export type ProbeConfigUpdate = Pick<
  ProbeConfig,
  'auth_source' | 'auth_id' | 'base_url' | 'model'
> & {
  api_key?: string;
};

export const codexProbeApi = {
  getConfig: () => apiClient.get<ProbeConfig>('/codex/turn-state/probe-config'),
  getStats: () => apiClient.get<ProbeStats>('/codex/turn-state'),
  saveConfig: (config: ProbeConfigUpdate) =>
    apiClient.put('/codex/turn-state/probe-config', config),
  getExternalAccount: () =>
    apiClient.get<ExternalProbeAccountStatus>('/codex/turn-state/external-account'),
  startExternalLogin: () =>
    apiClient.post<{ auth_url: string }>('/codex/turn-state/external-login/start', {}),
  completeExternalLogin: (callbackUrl: string) =>
    apiClient.post<{ status: string }>('/codex/turn-state/external-login/complete', {
      callback_url: callbackUrl,
    }),
  startExternalDeviceLogin: () =>
    apiClient.post<ExternalDeviceLogin>('/codex/turn-state/external-device-login/start', {}),
  pollExternalDeviceLogin: (deviceCode: string) =>
    apiClient.post<{ success: boolean; pending: boolean; code?: string }>(
      '/codex/turn-state/external-device-login/poll',
      { device_code: deviceCode }
    ),
  test: () =>
    apiClient.post<{
      status: string;
      ticket: { length: number; gateway_pool?: string; gateway_proxy?: string };
    }>('/codex/turn-state/probe', {}, { timeout: 45000 }),
};
