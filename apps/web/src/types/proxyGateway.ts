export interface ProxyPoolItem {
  name: string;
  enabled: boolean;
  weight?: number;
  proxies: string[];
  proxy_url_source?: string;
}

export interface ProxyGatewayConfig {
  enabled: boolean;
  bind?: string;
  port?: number;
  auth_user?: string;
  auth_pass?: string;
  pools: ProxyPoolItem[];
}

export interface ProxyPoolSummary {
  name: string;
  enabled: boolean;
  weight?: number;
  proxies: string[];
  proxy_url_source?: string;
  proxy_count: number;
}

export interface ProxyGatewayStats {
  enabled: boolean;
  bind: string;
  port: number;
  listen_address: string;
  total_requests: number;
  active_connections: number;
  total_errors: number;
  total_proxies: number;
  pools: ProxyPoolSummary[];
}

export interface ProxyGatewayTestResult {
  proxy_url: string;
  proxies?: string[];
  success: boolean;
  latency_ms: number;
  error?: string;
  stage?: 'source' | 'proxy' | 'gateway';
  source_proxy_count?: number;
  source_latency_ms?: number;
}
