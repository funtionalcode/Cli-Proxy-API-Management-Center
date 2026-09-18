import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn(), post: vi.fn() }));
vi.mock('./client', () => ({ apiClient: mocks }));
import { proxyGatewayApi } from './proxyGateway';

beforeEach(() => {
  vi.resetAllMocks();
});

describe('代理网关 API', () => {
  it('读取后端动态源字段，并兼容旧字段和空列表', async () => {
    mocks.get.mockResolvedValue({
      pools: [{ name: '动态池', 'proxy-url-source': 'https://example.test/list', proxies: null }],
    });
    expect((await proxyGatewayApi.getStats()).pools[0]).toMatchObject({
      proxy_url_source: 'https://example.test/list',
      proxies: [],
    });
    mocks.get.mockResolvedValue({ pools: [{ proxy_url_source: 'https://example.test/legacy' }] });
    expect((await proxyGatewayApi.getStats()).pools[0].proxy_url_source).toBe(
      'https://example.test/legacy'
    );
    mocks.get.mockResolvedValue({ pools: null });
    expect((await proxyGatewayApi.getStats()).pools).toEqual([]);
  });

  it('保存使用后端配置字段，不丢失动态源和认证设置', async () => {
    await proxyGatewayApi.updateConfig({
      enabled: true,
      auth_user: 'user',
      auth_pass: 'password',
      pools: [
        { name: '池', enabled: true, proxies: [], proxy_url_source: ' https://example.test/list ' },
      ],
    });
    expect(mocks.put).toHaveBeenCalledWith(
      '/proxy-gateway',
      expect.objectContaining({
        'auth-user': 'user',
        'auth-pass': 'password',
        pools: [
          expect.objectContaining({ 'proxy-url-source': 'https://example.test/list', proxies: [] }),
        ],
      })
    );
  });

  it('静态、动态源和网关测试使用独立目标', async () => {
    await proxyGatewayApi.testProxy('http://proxy.test:8080');
    await proxyGatewayApi.testSource('https://example.test/list');
    await proxyGatewayApi.testGateway();
    expect(mocks.post.mock.calls).toEqual([
      ['/proxy-gateway/test', { proxy_url: 'http://proxy.test:8080' }],
      ['/proxy-gateway/test', { proxy_url_source: 'https://example.test/list' }],
      ['/proxy-gateway/test', { gateway: true }],
    ]);
  });
});
