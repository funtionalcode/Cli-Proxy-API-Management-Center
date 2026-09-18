import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { codexProbeApi, type ProbeConfig, type ProbeStats } from '@/services/api/codexProbe';
import type { ExternalDeviceLogin, ExternalProbeAccountStatus } from '@/services/api/codexProbe';
import styles from './ProxyGatewayPage.module.scss';
import probeStyles from './CodexProbeCard.module.scss';

const formatProbeError = (err: unknown): string => {
  if (!(err instanceof Error)) return String(err);
  const details = (err as Error & { details?: unknown }).details;
  const nested =
    details && typeof details === 'object'
      ? (details as { error?: unknown; message?: unknown }).error ??
        (details as { message?: unknown }).message
      : undefined;
  if (typeof nested === 'string' && nested.trim() && !err.message.includes(nested.trim())) {
    return `${err.message}：${nested.trim()}`;
  }
  if (nested && typeof nested === 'object') {
    const record = nested as { message?: unknown; code?: unknown; type?: unknown };
    const parts = [record.type, record.code, record.message]
      .filter((value): value is string => typeof value === 'string' && value.trim() !== '')
      .map((value) => value.trim());
    if (parts.length > 0 && !parts.some((part) => err.message.includes(part))) {
      return `${err.message}：${parts.join(' / ')}`;
    }
    try {
      const serialized = JSON.stringify(nested);
      if (serialized && serialized !== '{}' && !err.message.includes(serialized)) {
        return `${err.message}：${serialized}`;
      }
    } catch {
      /* keep the original message */
    }
  }
  return err.message;
};

export function CodexProbeCard() {
  const [config, setConfig] = useState<ProbeConfig | null>(null);
  const [saved, setSaved] = useState<ProbeConfig | null>(null);
  const [stats, setStats] = useState<ProbeStats | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [externalAccount, setExternalAccount] = useState<ExternalProbeAccountStatus | null>(null);
  const [deviceLogin, setDeviceLogin] = useState<ExternalDeviceLogin | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    try {
      const [nextConfig, nextStats] = await Promise.all([
        codexProbeApi.getConfig(),
        codexProbeApi.getStats(),
      ]);
      setConfig(nextConfig);
      setSaved(nextConfig);
      setStats(nextStats);
      setApiKey('');
      if (nextConfig.auth_source === 'external' && nextConfig.has_api_key) {
        const account = await codexProbeApi.getExternalAccount();
        setExternalAccount(account);
      } else {
        setExternalAccount(null);
      }
      setError('');
    } catch (err) {
      setError(formatProbeError(err));
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => {
      void codexProbeApi
        .getStats()
        .then(setStats)
        .catch(() => undefined);
    }, 15000);
    return () => clearInterval(timer);
  }, [refresh]);

  const changed = Boolean(
    config &&
    saved &&
    (config.auth_source !== saved.auth_source ||
      config.auth_id !== saved.auth_id ||
      config.base_url !== saved.base_url ||
      config.model !== saved.model ||
      apiKey)
  );
  const selected = config?.accounts.find((account) => account.id === config.auth_id);
  const sourceConfigReady = Boolean(
    config?.model.trim() &&
    (config.auth_source === 'account'
      ? selected?.available
      : config.base_url.trim() && (apiKey.trim() || config.has_api_key))
  );
  const testReady = Boolean(
    sourceConfigReady &&
    (config?.auth_source === 'account'
      ? selected?.available
      : externalAccount?.authenticated && externalAccount.active_accounts > 0)
  );

  const save = async () => {
    if (!config) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await codexProbeApi.saveConfig({
        auth_source: config.auth_source,
        auth_id: config.auth_id,
        base_url: config.base_url,
        model: config.model,
        ...(config.auth_source === 'external' && apiKey.trim() ? { api_key: apiKey.trim() } : {}),
      });
      await refresh();
      setMessage('探针来源已保存。后台探测及业务注入开关保持原设置。');
    } catch (err) {
      setError(formatProbeError(err));
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const result = await codexProbeApi.test();
      const selectedProxy = result.ticket.gateway_proxy
        ? `，网关后端 ${result.ticket.gateway_pool || '默认池'} / ${result.ticket.gateway_proxy}`
        : '';
      setMessage(
        `探测成功：状态头长度 ${result.ticket.length}${selectedProxy}。这不代表算力提升。`
      );
    } catch (err) {
      setError(formatProbeError(err));
    } finally {
      await codexProbeApi
        .getStats()
        .then(setStats)
        .catch(() => undefined);
      setBusy(false);
    }
  };

  const startExternalLogin = async () => {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const result = await codexProbeApi.startExternalDeviceLogin();
      setDeviceLogin(result);
      window.open(
        result.verification_uri_complete || result.verification_uri,
        '_blank',
        'noopener,noreferrer'
      );
      setMessage(`设备登录页已打开，请确认授权码 ${result.user_code}。`);
    } catch (err) {
      setError(formatProbeError(err));
    } finally {
      setBusy(false);
    }
  };

  const checkExternalLogin = async () => {
    if (!deviceLogin) return;
    setBusy(true);
    setError('');
    try {
      const result = await codexProbeApi.pollExternalDeviceLogin(deviceLogin.device_code);
      if (!result.success) {
        setMessage('OpenAI 授权尚未完成，请完成授权后再次检查。');
        return;
      }
      const account = await codexProbeApi.getExternalAccount();
      setExternalAccount(account);
      setDeviceLogin(null);
      setMessage('免费账号登录成功，现在可以测试已保存来源。');
    } catch (err) {
      setError(formatProbeError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={styles.sectionCard} aria-label="Codex 后台探针">
      <div className={styles.bannerHeader}>
        <h2 className={styles.sectionTitle}>Codex 后台探针</h2>
        <Button variant="secondary" size="sm" disabled={busy} onClick={refresh}>
          刷新账户与记录
        </Button>
      </div>
      <p className={styles.description}>
        {stats?.enabled && stats.prober_active ? '后台探测运行中' : '后台探测已关闭'}。
        {stats?.inject_business ? '业务注入已开启' : '业务注入已关闭'}。 两种来源之间不自动回退，CPA
        模式仅使用指定账户。手动测试会消耗账户额度。
      </p>
      {config && (
        <>
          <div className={styles.formRow}>
            <label className={probeStyles.field}>
              探针来源
              <select
                aria-label="探针来源"
                disabled={busy}
                value={config.auth_source}
                onChange={(e) =>
                  setConfig({
                    ...config,
                    auth_source: e.target.value as ProbeConfig['auth_source'],
                  })
                }
              >
                <option value="account">CPA 已登录账户</option>
                <option value="external">独立 codex-proxy 接口</option>
              </select>
            </label>
            <Input
              label="探测模型"
              value={config.model}
              disabled={busy}
              onChange={(e) => setConfig({ ...config, model: e.target.value })}
            />
          </div>
          {config.auth_source === 'account' ? (
            <>
              <label className={probeStyles.field}>
                用于探针的已登录账户
                <select
                  aria-label="用于探针的已登录账户"
                  value={config.auth_id}
                  disabled={busy}
                  onChange={(e) => setConfig({ ...config, auth_id: e.target.value })}
                >
                  <option value="">请选择账户</option>
                  {config.auth_id && !selected && (
                    <option value={config.auth_id} disabled>
                      原账户已不存在
                    </option>
                  )}
                  {config.accounts.map((account) => (
                    <option key={account.id} value={account.id} disabled={!account.available}>
                      {account.label}
                      {account.reason ? `（${account.reason}）` : ''}
                    </option>
                  ))}
                </select>
              </label>
              <p className={styles.description}>
                账户来自 CPA 的 OAuth 登录。添加账号后返回本页并点击“刷新账户与记录”。
              </p>
              <div className={styles.poolActions}>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    window.location.hash = '#/oauth';
                  }}
                >
                  前往 CPA OAuth 登录
                </Button>
              </div>
            </>
          ) : (
            <>
              <div className={probeStyles.accountCard}>
                <div>
                  <strong>独立免费账号</strong>
                  <p className={styles.description}>
                    {externalAccount?.authenticated
                      ? `已登录 ${externalAccount.total_accounts} 个账号，${externalAccount.active_accounts} 个可用`
                      : '尚未登录免费账号'}
                  </p>
                </div>
                <Button variant="secondary" size="sm" disabled={busy} onClick={startExternalLogin}>
                  {externalAccount?.authenticated ? '添加另一个免费账号' : '开始登录免费账号'}
                </Button>
              </div>
              {(deviceLogin || !externalAccount?.authenticated) && (
                <div className={probeStyles.loginSteps}>
                  <p>1. 点击“开始登录免费账号”，在新页面登录 OpenAI。</p>
                  <p>2. 核对页面显示的设备授权码，然后确认授权。</p>
                  <p>3. 授权完成后返回此页，点击“检查登录状态”。</p>
                  {deviceLogin && (
                    <a
                      href={deviceLogin.verification_uri_complete || deviceLogin.verification_uri}
                      target="_blank"
                      rel="noreferrer"
                      className={probeStyles.loginLink}
                    >
                      登录页未打开？点此重新打开（授权码 {deviceLogin.user_code}）
                    </a>
                  )}
                  {deviceLogin && (
                    <Button variant="secondary" disabled={busy} onClick={checkExternalLogin}>
                      检查登录状态
                    </Button>
                  )}
                </div>
              )}
              <div className={styles.formRow}>
                <Input
                  label="独立接口基础地址"
                  value={config.base_url}
                  placeholder="http://127.0.0.1:18318/v1"
                  disabled={busy}
                  onChange={(e) => setConfig({ ...config, base_url: e.target.value })}
                />
                <Input
                  label="独立接口密钥"
                  type="password"
                  value={apiKey}
                  disabled={busy}
                  placeholder={
                    config.has_api_key ? '已配置，留空保留原密钥' : '请输入 codex-proxy 接口密钥'
                  }
                  onChange={(e) => setApiKey(e.target.value)}
                />
              </div>
            </>
          )}
          <div className={styles.poolActions}>
            <Button onClick={save} disabled={busy || !sourceConfigReady || !changed}>
              保存探针来源
            </Button>
            <Button variant="secondary" onClick={test} disabled={busy || !testReady || changed}>
              {busy ? '处理中…' : '测试已保存来源'}
            </Button>
            {changed && <span className={styles.description}>请先保存，再测试。</span>}
          </div>
        </>
      )}
      {message && (
        <p role="status" className={styles.description}>
          {message}
        </p>
      )}
      {error && (
        <p role="alert" className={probeStyles.error}>
          {error}
        </p>
      )}
      {stats && (
        <>
          <div className={styles.statsGrid}>
            {[
              ['累计探测', stats.total_probed],
              ['探测成功', stats.total_success],
              ['探测失败', stats.total_failed],
              ['当前库存', stats.pool_size],
              ['当前状态头长度', stats.current_state_length || '—'],
              ['实际注入', stats.total_injected],
              ['跳过注入', stats.total_skipped ?? 0],
            ].map(([label, value]) => (
              <div key={label} className={styles.statCard}>
                <span className={styles.statLabel}>{label}</span>
                <span className={styles.statValue}>{value}</span>
              </div>
            ))}
          </div>
          <div className={probeStyles.tableWrap}>
            <table className={probeStyles.table}>
              <caption>
                近期探测与注入记录（最近 100 条，15 秒刷新；重启前的记录请在日志查看页查询）
              </caption>
              <thead>
                <tr>
                  <th>时间</th>
                  <th>类型 / 结果</th>
                  <th>来源 / 账户</th>
                  <th>模型</th>
                  <th>耗时 / 长度</th>
                  <th>网关后端代理</th>
                  <th>详情</th>
                </tr>
              </thead>
              <tbody>
                {(stats.recent_events ?? []).map((event, index) => (
                  <tr key={`${event.time}-${index}`}>
                    <td>{new Date(event.time).toLocaleString('zh-CN', { hour12: false })}</td>
                    <td>
                      {event.kind === 'probe' ? '探测' : '注入'} /{' '}
                      {event.outcome === 'success'
                        ? '成功'
                        : event.outcome === 'failed'
                          ? '失败'
                          : '跳过'}
                    </td>
                    <td>
                      {event.source === 'external'
                        ? '独立接口'
                        : event.auth_id || '客户端 / 状态池'}
                    </td>
                    <td>{event.model || '—'}</td>
                    <td>
                      {event.kind === 'probe' ? `${event.latency_ms ?? 0} 毫秒 / ` : ''}
                      {event.length ?? '—'}
                    </td>
                    <td>
                      {event.gateway_proxy
                        ? `${event.gateway_pool || '默认池'} / ${event.gateway_proxy}`
                        : '—'}
                    </td>
                    <td>{event.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!stats.recent_events?.length && (
              <p className={styles.description}>暂无记录。保存来源后可以执行一次手动测试。</p>
            )}
          </div>
        </>
      )}
    </section>
  );
}
