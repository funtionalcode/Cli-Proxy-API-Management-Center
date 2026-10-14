import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Button } from '@/components/ui/Button';
import { codexProbeApi } from '@/services/api/codexProbe';
import { CodexProbeCard } from './CodexProbeCard';

vi.mock('@/services/api/codexProbe', () => ({
  codexProbeApi: {
    getConfig: vi.fn(),
    getStats: vi.fn(),
    saveConfig: vi.fn(),
    test: vi.fn(),
    getExternalAccount: vi.fn(),
    startExternalLogin: vi.fn(),
    completeExternalLogin: vi.fn(),
    startExternalDeviceLogin: vi.fn(),
    pollExternalDeviceLogin: vi.fn(),
  },
}));

let renderer: ReactTestRenderer;
afterEach(async () => {
  if (renderer) await act(async () => renderer.unmount());
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('探针来源与记录', () => {
  it('更换账户必须保存后才能测试，并显示中文记录', async () => {
    const config = {
      auth_source: 'account' as const,
      auth_id: 'a',
      base_url: '',
      has_api_key: false,
      model: 'test',
      accounts: [
        { id: 'a', label: '账户 A', available: true },
        { id: 'b', label: '账户 B', available: true },
      ],
    };
    vi.mocked(codexProbeApi.getConfig).mockResolvedValue(config);
    vi.mocked(codexProbeApi.getStats).mockResolvedValue({
      enabled: false,
      prober_active: false,
      pool_size: 0,
      current_state_length: 292,
      total_probed: 1,
      total_success: 0,
      total_failed: 1,
      total_injected: 0,
      total_skipped: 1,
      recent_events: [
        {
          time: '2026-09-18T08:00:00Z',
          kind: 'probe',
          outcome: 'failed',
          auth_id: 'a',
          gateway_pool: 'Webshare',
          gateway_proxy: 'http://192.0.2.10:8080',
          message: '账户已过期',
        },
      ],
    });
    vi.mocked(codexProbeApi.saveConfig).mockResolvedValue({});
    await act(async () => {
      renderer = create(<CodexProbeCard />);
    });
    const buttons = () => renderer.root.findAllByType(Button);
    const testButton = () => buttons().find((b) => b.props.children === '测试已保存来源')!;
    expect(testButton().props.disabled).toBe(false);
    await act(async () =>
      renderer.root
        .findByProps({ 'aria-label': '用于探针的已登录账户' })
        .props.onChange({ target: { value: 'b' } })
    );
    expect(testButton().props.disabled).toBe(true);
    vi.mocked(codexProbeApi.getConfig).mockResolvedValue({ ...config, auth_id: 'b' });
    await act(async () =>
      buttons()
        .find((b) => b.props.children === '保存探针来源')!
        .props.onClick()
    );
    expect(codexProbeApi.saveConfig).toHaveBeenCalledWith({
      auth_source: 'account',
      auth_id: 'b',
      base_url: '',
      model: 'test',
    });
    expect(testButton().props.disabled).toBe(false);
    expect(JSON.stringify(renderer.toJSON())).toContain('账户已过期');
    expect(JSON.stringify(renderer.toJSON())).toContain('当前状态头长度');
    expect(JSON.stringify(renderer.toJSON())).toContain('292');
    expect(JSON.stringify(renderer.toJSON())).toContain('Webshare / http://192.0.2.10:8080');
    expect(JSON.stringify(renderer.toJSON())).toContain('后台探测已关闭');
  });

  it('独立接口显示登录状态并完成免费账号授权回调', async () => {
    const config = {
      auth_source: 'external' as const,
      auth_id: '',
      base_url: 'http://127.0.0.1:18318/v1',
      has_api_key: true,
      model: 'test',
      accounts: [],
    };
    vi.mocked(codexProbeApi.getConfig).mockResolvedValue(config);
    vi.mocked(codexProbeApi.getStats).mockResolvedValue({
      enabled: false,
      prober_active: false,
      pool_size: 0,
      current_state_length: 0,
      total_probed: 0,
      total_success: 0,
      total_failed: 0,
      total_injected: 0,
      total_skipped: 0,
      recent_events: [],
    });
    vi.mocked(codexProbeApi.getExternalAccount)
      .mockResolvedValueOnce({ authenticated: false, total_accounts: 0, active_accounts: 0 })
      .mockResolvedValue({ authenticated: true, total_accounts: 1, active_accounts: 1 });
    vi.mocked(codexProbeApi.startExternalLogin).mockResolvedValue({
      auth_url: 'https://auth.openai.com/oauth/authorize?state=test-state-1234567890',
      state: 'test-state-1234567890',
    });
    vi.mocked(codexProbeApi.completeExternalLogin).mockResolvedValue({ status: 'success' });
    const open = vi.fn();
    vi.stubGlobal('window', { open, location: { hash: '' } });

    await act(async () => {
      renderer = create(<CodexProbeCard />);
    });
    expect(JSON.stringify(renderer.toJSON())).toContain('尚未登录免费账号');
    const buttons = () => renderer.root.findAllByType(Button);
    await act(async () =>
      buttons()
        .find((button) => button.props.children === '开始登录免费账号')!
        .props.onClick()
    );
    expect(open).toHaveBeenCalledWith(
      'https://auth.openai.com/oauth/authorize?state=test-state-1234567890',
      '_blank',
      'noopener,noreferrer'
    );
    await act(async () =>
      renderer.root.findByProps({ 'aria-label': 'OAuth 回调地址' }).props.onChange({
        target: { value: 'http://localhost:1455/auth/callback?code=test-code&scope=openid' },
      })
    );
    await act(async () =>
      buttons()
        .find((button) => button.props.children === '完成登录')!
        .props.onClick()
    );
    expect(codexProbeApi.completeExternalLogin).toHaveBeenCalledWith(
      'http://localhost:1455/auth/callback?code=test-code&scope=openid',
      'test-state-1234567890'
    );
    expect(JSON.stringify(renderer.toJSON())).toContain('已登录 1 个账号，1 个可用');
  });

  it('开启的已登录账户都可以选择，并展示具体错误信息', async () => {
    const config = {
      auth_source: 'account' as const,
      auth_id: 'cooling',
      base_url: '',
      has_api_key: false,
      model: 'test',
      accounts: [
        { id: 'cooling', label: 'Plus', available: true, reason: '冷却中' },
        { id: 'disabled', label: 'Plus', available: false, reason: '已禁用' },
      ],
    };
    vi.mocked(codexProbeApi.getConfig).mockResolvedValue(config);
    vi.mocked(codexProbeApi.getStats).mockResolvedValue({
      enabled: false,
      prober_active: false,
      pool_size: 0,
      current_state_length: 0,
      total_probed: 0,
      total_success: 0,
      total_failed: 0,
      total_injected: 0,
      total_skipped: 0,
      recent_events: [],
    });
    vi.mocked(codexProbeApi.test).mockRejectedValue(
      Object.assign(new Error('探测接口返回 HTTP 400'), {
        details: {
          error: {
            type: 'usage_limit_reached',
            code: 'rate_limit_exceeded',
            message: 'Rate limit reached for gpt-5.4-mini',
          },
        },
      })
    );

    await act(async () => {
      renderer = create(<CodexProbeCard />);
    });
    const select = renderer.root.findByProps({ 'aria-label': '用于探针的已登录账户' });
    const options = select.findAllByType('option');
    const cooling = options.find((option) => option.props.value === 'cooling');
    const disabled = options.find((option) => option.props.value === 'disabled');
    expect(cooling?.props.disabled).toBe(false);
    expect(disabled?.props.disabled).toBe(true);
    expect(JSON.stringify(renderer.toJSON())).toContain('冷却中');
    await act(async () =>
      renderer.root
        .findAllByType(Button)
        .find((button) => button.props.children === '测试已保存来源')!
        .props.onClick()
    );
    expect(JSON.stringify(renderer.toJSON())).toContain('rate_limit_exceeded');
    expect(JSON.stringify(renderer.toJSON())).toContain('Rate limit reached for gpt-5.4-mini');
  });
});
