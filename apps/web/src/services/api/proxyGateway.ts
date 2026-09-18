import { apiClient } from './client';
import type {
  ProxyGatewayConfig,
  ProxyGatewayStats,
  ProxyGatewayTestResult,
  ProxyPoolSummary,
} from '@/types';

type WireStats = Omit<ProxyGatewayStats, 'pools'> & {
  pools?: (ProxyPoolSummary & { 'proxy-url-source'?: string })[];
};

export const proxyGatewayApi = {
  getStats: async (): Promise<ProxyGatewayStats> => {
    const data = await apiClient.get<WireStats>('/proxy-gateway');
    return {
      ...data,
      pools: (data.pools ?? []).map((pool) => ({
        ...pool,
        proxies: pool.proxies ?? [],
        proxy_url_source: pool['proxy-url-source'] ?? pool.proxy_url_source ?? '',
      })),
    };
  },
  updateConfig: (payload: ProxyGatewayConfig) =>
    apiClient.put<void>('/proxy-gateway', {
      enabled: payload.enabled,
      bind: payload.bind,
      port: payload.port,
      'auth-user': payload.auth_user,
      'auth-pass': payload.auth_pass,
      pools: payload.pools.map((pool) => ({
        name: pool.name,
        enabled: pool.enabled,
        weight: pool.weight,
        proxies: pool.proxies,
        'proxy-url-source': pool.proxy_url_source?.trim() ?? '',
      })),
    }),
  testProxy: (proxyUrl: string) =>
    apiClient.post<ProxyGatewayTestResult>('/proxy-gateway/test', { proxy_url: proxyUrl }),
  testSource: (sourceUrl: string) =>
    apiClient.post<ProxyGatewayTestResult>('/proxy-gateway/test', { proxy_url_source: sourceUrl }),
  testGateway: () =>
    apiClient.post<ProxyGatewayTestResult>('/proxy-gateway/test', { gateway: true }),
};
