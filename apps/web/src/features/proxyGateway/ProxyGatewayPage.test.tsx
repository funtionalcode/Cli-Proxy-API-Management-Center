import { act } from 'react';
import { create, type ReactTestRenderer, type ReactTestInstance } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';

const mocks = vi.hoisted(() => ({
  getStats: vi.fn(),
  updateConfig: vi.fn(),
  testProxy: vi.fn(),
  testSource: vi.fn(),
  testGateway: vi.fn(),
  showNotification: vi.fn(),
  t: (key: string) => key,
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: mocks.t }) }));
vi.mock('@/services/api', () => ({ proxyGatewayApi: mocks }));
vi.mock('@/stores', () => ({
  useNotificationStore: (select: (state: typeof mocks) => unknown) => select(mocks),
}));
import { ProxyGatewayPage } from './ProxyGatewayPage';

const text = (node: ReactTestInstance): string =>
  node.children.map((child) => (typeof child === 'object' ? text(child) : String(child))).join('');
let renderer: ReactTestRenderer;
const button = (key: string) =>
  renderer.root.findAllByType(Button).find((item) => text(item) === key)!;
const render = async () => {
  await act(async () => {
    renderer = create(<ProxyGatewayPage />);
  });
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getStats.mockResolvedValue({
    enabled: true,
    bind: '0.0.0.0',
    port: 8899,
    pools: [
      {
        name: '动态池',
        enabled: true,
        proxies: ['  '],
        proxy_url_source: 'https://example.test/list',
      },
    ],
  });
  mocks.testSource.mockResolvedValue({
    success: true,
    source_proxy_count: 2,
    latency_ms: 15,
    proxies: ['http://proxy-a.test:8080', 'http://proxy-b.test:8080'],
  });
  mocks.testGateway.mockResolvedValue({ success: true, latency_ms: 20 });
});
afterEach(() => {
  act(() => renderer?.unmount());
});

describe('代理网关测试入口', () => {
  it('仅配置动态 URL 时也能测试，无需先保存', async () => {
    await render();
    expect(button('proxy_gateway.test_btn').props.disabled).toBe(true);
    expect(button('proxy_gateway.source_test_btn').props.disabled).toBe(false);
    await act(async () => {
      await button('proxy_gateway.source_test_btn').props.onClick();
    });
    expect(mocks.testSource).toHaveBeenCalledWith('https://example.test/list');
    expect(mocks.updateConfig).not.toHaveBeenCalled();
    expect(text(renderer.root)).toContain('proxy_gateway.source_test_success');
  });

  it('区分源拉取与代理连通失败，修改地址后隐藏旧结果', async () => {
    mocks.testSource.mockResolvedValue({
      success: false,
      stage: 'proxy',
      source_proxy_count: 2,
      error: 'connection refused',
    });
    await render();
    await act(async () => {
      await button('proxy_gateway.source_test_btn').props.onClick();
    });
    expect(text(renderer.root)).toContain('proxy_gateway.source_proxy_failedconnection refused');
    const source = renderer.root
      .findAllByType(Input)
      .find((item) => item.props.label === 'proxy_gateway.source_url_label')!;
    act(() => source.props.onChange({ target: { value: 'https://example.test/new' } }));
    expect(text(renderer.root)).not.toContain('connection refused');
  });

  it('网关测试走独立 API，并刷新请求统计', async () => {
    await render();
    await act(async () => {
      await button('proxy_gateway.gateway_test_btn').props.onClick();
    });
    expect(mocks.testGateway).toHaveBeenCalledOnce();
    expect(mocks.testProxy).not.toHaveBeenCalled();
    expect(mocks.getStats).toHaveBeenCalledTimes(2);
    expect(text(renderer.root)).toContain('proxy_gateway.gateway_test_success');
  });

  it('未保存的启用开关不能冒充网关已启动', async () => {
    mocks.getStats.mockResolvedValue({ enabled: false, port: 8899, pools: [] });
    await render();
    const toggle = renderer.root.findAllByType(ToggleSwitch)[0];
    act(() => toggle.props.onChange(true));
    expect(button('proxy_gateway.gateway_test_btn').props.disabled).toBe(true);
    expect(text(renderer.root)).toContain('proxy_gateway.status_stopped');
  });

  it('支持将动态源代理全部去重加入或只加入勾选项', async () => {
    mocks.getStats.mockResolvedValue({
      enabled: true,
      port: 8899,
      pools: [
        {
          name: '动态池',
          enabled: true,
          proxies: ['http://proxy-a.test:8080'],
          proxy_url_source: 'https://example.test/list',
        },
      ],
    });
    await render();
    await act(async () => {
      await button('proxy_gateway.source_test_btn').props.onClick();
    });
    await act(async () => {
      renderer.root
        .findAllByType(Button)
        .find((item) => text(item) === '全部去重加入')!
        .props.onClick();
    });
    const textarea = renderer.root.findByType('textarea');
    expect(textarea.props.value).toBe('http://proxy-a.test:8080\nhttp://proxy-b.test:8080');
    expect(mocks.showNotification).toHaveBeenCalledWith(
      '已去重加入 1 个代理，请点击“保存并生效”。',
      'success'
    );
  });
});
