import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { IconCopy, IconPlus, IconTrash2, IconRefreshCw } from '@/components/ui/icons';
import { proxyGatewayApi } from '@/services/api';
import { useNotificationStore } from '@/stores';
import type {
  ProxyGatewayConfig,
  ProxyGatewayStats,
  ProxyPoolItem,
  ProxyGatewayTestResult,
} from '@/types';
import styles from './ProxyGatewayPage.module.scss';
import { CodexProbeCard } from './CodexProbeCard';

export function ProxyGatewayPage() {
  const { t } = useTranslation();
  const showNotification = useNotificationStore((state) => state.showNotification);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [stats, setStats] = useState<ProxyGatewayStats | null>(null);

  const [enabled, setEnabled] = useState(false);
  const [bind, setBind] = useState('0.0.0.0');
  const [port, setPort] = useState(8899);
  const [authUser, setAuthUser] = useState('');
  const [authPass, setAuthPass] = useState('');
  const [pools, setPools] = useState<ProxyPoolItem[]>([]);

  const [testingKey, setTestingKey] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, ProxyGatewayTestResult>>({});
  const [sourceSelections, setSourceSelections] = useState<Record<string, string[]>>({});
  const [gatewayResult, setGatewayResult] = useState<ProxyGatewayTestResult | null>(null);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const data = await proxyGatewayApi.getStats();
      setStats(data);
      setEnabled(data.enabled);
      setBind(data.bind || '0.0.0.0');
      setPort(data.port || 8899);
      if (data.pools) {
        setPools(
          data.pools.map((p) => ({
            name: p.name,
            enabled: p.enabled,
            weight: p.weight,
            proxies: p.proxies || [],
            proxy_url_source: p.proxy_url_source || '',
          }))
        );
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      showNotification(
        t('proxy_gateway.load_failed', { defaultValue: '加载代理网关配置失败: ' }) + msg,
        'error'
      );
    } finally {
      setLoading(false);
    }
  }, [showNotification, t]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleSave = async () => {
    try {
      setSaving(true);
      const payload: ProxyGatewayConfig = {
        enabled,
        bind,
        port: Number(port) || 8899,
        auth_user: authUser || undefined,
        auth_pass: authPass || undefined,
        pools: pools.map((p) => ({
          ...p,
          proxies: p.proxies.map((s) => s.trim()).filter(Boolean),
        })),
      };
      await proxyGatewayApi.updateConfig(payload);
      showNotification(
        t('proxy_gateway.save_success', { defaultValue: '代理网关配置已保存并热重载生效' }),
        'success'
      );
      await loadData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      showNotification(
        t('proxy_gateway.save_failed', { defaultValue: '保存失败: ' }) + msg,
        'error'
      );
    } finally {
      setSaving(false);
    }
  };

  const handleAddPool = () => {
    setPools((prev) => [
      ...prev,
      {
        name: `${t('proxy_gateway.pool_title', { defaultValue: '代理池' })}-${prev.length + 1}`,
        enabled: true,
        proxies: [],
        proxy_url_source: '',
      },
    ]);
  };

  const handleRemovePool = (idx: number) => {
    setPools((prev) => prev.filter((_, i) => i !== idx));
  };

  const handlePoolChange = (idx: number, patch: Partial<ProxyPoolItem>) => {
    setPools((prev) => prev.map((item, i) => (i === idx ? { ...item, ...patch } : item)));
  };

  const handleTestPool = async (idx: number, source = false) => {
    const pool = pools[idx];
    const url = source
      ? pool?.proxy_url_source?.trim()
      : pool?.proxies.find((proxy) => proxy.trim())?.trim();
    if (!url) {
      showNotification(
        t('proxy_gateway.no_proxies_to_test', { defaultValue: '当前池中没有可测试的代理' }),
        'warning'
      );
      return;
    }
    const key = `${source ? 'source' : 'proxy'}:${url}`;
    setTestingKey(key);
    setTestResults((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    try {
      const res = source
        ? await proxyGatewayApi.testSource(url)
        : await proxyGatewayApi.testProxy(url);
      setTestResults((prev) => ({ ...prev, [key]: res }));
      if (source) {
        setSourceSelections((prev) => ({ ...prev, [key]: res.proxies ?? [] }));
      }
      if (res.success) {
        showNotification(
          source
            ? t('proxy_gateway.source_test_success', {
                count: res.source_proxy_count ?? 0,
                latency: res.latency_ms,
              })
            : t('proxy_gateway.test_success', { defaultValue: '代理连通测试成功，延时: ' }) +
                `${res.latency_ms}ms`,
          'success'
        );
      } else {
        showNotification(
          t('proxy_gateway.test_failed', { defaultValue: '代理连通失败: ' }) + (res.error || ''),
          'error'
        );
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      showNotification(
        t('proxy_gateway.test_failed', { defaultValue: '测试失败: ' }) + msg,
        'error'
      );
      setTestResults((prev) => ({
        ...prev,
        [key]: { proxy_url: '', success: false, latency_ms: 0, error: msg },
      }));
    } finally {
      setTestingKey(null);
    }
  };

  const addSourceProxies = (poolIndex: number, candidates: string[]) => {
    const normalizedCandidates = candidates.map((proxy) => proxy.trim()).filter(Boolean);
    if (normalizedCandidates.length === 0) return;
    const proxies = (pools[poolIndex]?.proxies ?? []).map((proxy) => proxy.trim()).filter(Boolean);
    const existing = new Set(proxies);
    let added = 0;
    for (const proxy of normalizedCandidates) {
      if (existing.has(proxy)) continue;
      existing.add(proxy);
      proxies.push(proxy);
      added += 1;
    }
    handlePoolChange(poolIndex, { proxies });
    showNotification(
      added > 0
        ? `已去重加入 ${added} 个代理，请点击“保存并生效”。`
        : '所选代理已全部存在，无需重复添加。',
      added > 0 ? 'success' : 'warning'
    );
  };

  const hostAddress =
    typeof window !== 'undefined' ? window.location.hostname || '127.0.0.1' : '127.0.0.1';
  const displayProxyUrl = `http://${hostAddress}:${port}`;

  const handleTestGateway = async () => {
    setTestingKey('gateway');
    setGatewayResult(null);
    try {
      const result = await proxyGatewayApi.testGateway();
      setGatewayResult(result);
      showNotification(
        result.success
          ? t('proxy_gateway.gateway_test_success', { latency: result.latency_ms })
          : t('proxy_gateway.gateway_test_failed') + (result.error || ''),
        result.success ? 'success' : 'error'
      );
      await proxyGatewayApi
        .getStats()
        .then(setStats)
        .catch(() => undefined);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setGatewayResult({ proxy_url: '', success: false, latency_ms: 0, error: message });
      showNotification(t('proxy_gateway.gateway_test_failed') + message, 'error');
    } finally {
      setTestingKey(null);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text).then(
      () => showNotification(t('common.copied', { defaultValue: '已复制到剪贴板' }), 'success'),
      () => showNotification(t('common.copy_failed', { defaultValue: '复制失败' }), 'error')
    );
  };

  if (loading) {
    return <LoadingSpinner />;
  }

  return (
    <div className={styles.container}>
      <CodexProbeCard />
      <div className={styles.bannerCard}>
        <div className={styles.bannerHeader}>
          <div className={styles.bannerTitle}>
            <span>{t('proxy_gateway.title', { defaultValue: '代理池轮询网关' })}</span>
            <span
              className={`${styles.statusBadge} ${stats?.enabled ? styles.running : styles.stopped}`}
            >
              <span className={styles.statusDot} />
              {stats?.enabled
                ? t('proxy_gateway.status_running', { defaultValue: '运行中' })
                : t('proxy_gateway.status_stopped', { defaultValue: '未启动' })}
            </span>
          </div>
          <Button variant="secondary" size="sm" onClick={loadData}>
            <IconRefreshCw size={14} />
            {t('common.refresh', { defaultValue: '刷新' })}
          </Button>
        </div>

        <div>
          <div className={styles.description}>
            {t('proxy_gateway.unified_entry_desc', {
              defaultValue:
                '对外提供的唯一定点代理地址（支持 HTTP 与 HTTPS CONNECT 隧道，自动轮询后端代理池）：',
            })}
          </div>
          <div className={styles.proxyAddressBox}>
            <span>{displayProxyUrl}</span>
            <Button
              className={styles.copyButton}
              variant="ghost"
              size="sm"
              onClick={() => copyToClipboard(displayProxyUrl)}
            >
              <IconCopy size={14} />
              {t('common.copy', { defaultValue: '复制' })}
            </Button>
          </div>
        </div>

        <div className={styles.poolActions}>
          <Button
            variant="secondary"
            size="sm"
            onClick={handleTestGateway}
            disabled={testingKey !== null || !stats?.enabled}
          >
            {testingKey === 'gateway'
              ? t('proxy_gateway.testing')
              : t('proxy_gateway.gateway_test_btn')}
          </Button>
          <span>
            {t(
              stats?.enabled
                ? 'proxy_gateway.gateway_test_hint'
                : 'proxy_gateway.gateway_test_disabled'
            )}
          </span>
        </div>
        {gatewayResult && (
          <div
            role="status"
            className={`${styles.testResultBadge} ${gatewayResult.success ? styles.success : styles.error}`}
          >
            {gatewayResult.success
              ? t('proxy_gateway.gateway_test_success', { latency: gatewayResult.latency_ms })
              : t('proxy_gateway.gateway_test_failed') + (gatewayResult.error || '')}
          </div>
        )}

        <div className={styles.statsGrid}>
          <div className={styles.statCard}>
            <span className={styles.statLabel}>
              {t('proxy_gateway.total_requests', { defaultValue: '累计转发请求' })}
            </span>
            <span className={styles.statValue}>{stats?.total_requests || 0}</span>
          </div>
          <div className={styles.statCard}>
            <span className={styles.statLabel}>
              {t('proxy_gateway.active_connections', { defaultValue: '并发连接数' })}
            </span>
            <span className={styles.statValue}>{stats?.active_connections || 0}</span>
          </div>
          <div className={styles.statCard}>
            <span className={styles.statLabel}>
              {t('proxy_gateway.total_proxies', { defaultValue: '活跃轮询代理数' })}
            </span>
            <span className={styles.statValue}>{stats?.total_proxies || 0}</span>
          </div>
          <div className={styles.statCard}>
            <span className={styles.statLabel}>
              {t('proxy_gateway.configured_pools', { defaultValue: '代理池总数' })}
            </span>
            <span className={styles.statValue}>{pools.length}</span>
          </div>
        </div>
      </div>

      <div className={styles.sectionCard}>
        <div className={styles.sectionTitle}>
          {t('proxy_gateway.basic_settings', { defaultValue: '网关基础配置' })}
        </div>
        <div className={styles.formRow}>
          <div
            style={{ display: 'flex', alignItems: 'center', height: '100%', paddingTop: '10px' }}
          >
            <ToggleSwitch
              checked={enabled}
              onChange={setEnabled}
              label={t('proxy_gateway.enable_switch', { defaultValue: '启用前向代理网关服务' })}
            />
          </div>
          <Input
            label={t('proxy_gateway.bind_address', { defaultValue: '绑定地址 (Bind IP)' })}
            value={bind}
            onChange={(e) => setBind(e.target.value)}
            placeholder="0.0.0.0"
          />
          <Input
            label={t('proxy_gateway.listen_port', { defaultValue: '监听端口 (Port)' })}
            type="number"
            value={port}
            onChange={(e) => setPort(Number(e.target.value))}
            placeholder="8899"
          />
        </div>
        <div className={styles.formRow}>
          <Input
            label={t('proxy_gateway.auth_user', { defaultValue: '客户端认证用户名（可选）' })}
            value={authUser}
            onChange={(e) => setAuthUser(e.target.value)}
            placeholder="admin"
          />
          <Input
            label={t('proxy_gateway.auth_pass', { defaultValue: '客户端认证密码（可选）' })}
            type="password"
            value={authPass}
            onChange={(e) => setAuthPass(e.target.value)}
            placeholder="secret"
          />
        </div>
      </div>

      <div className={styles.sectionCard}>
        <div className={styles.bannerHeader}>
          <div className={styles.sectionTitle}>
            {t('proxy_gateway.pools_config', { defaultValue: '多代理池轮询配置' })}
          </div>
          <Button variant="secondary" size="sm" onClick={handleAddPool}>
            <IconPlus size={14} />
            {t('proxy_gateway.add_pool', { defaultValue: '添加新代理池' })}
          </Button>
        </div>

        {pools.length === 0 ? (
          <div className={styles.emptyState}>
            {t('proxy_gateway.no_pools', {
              defaultValue: '暂无配置代理池，点击上方“添加新代理池”按钮创建',
            })}
          </div>
        ) : (
          pools.map((pool, idx) => {
            const staticProxies = pool.proxies.map((proxy) => proxy.trim()).filter(Boolean);
            const parsedCount = staticProxies.length;
            const proxyKey = `proxy:${staticProxies[0] ?? ''}`;
            const sourceKey = `source:${pool.proxy_url_source?.trim() ?? ''}`;
            const isTesting = testingKey === proxyKey;
            const isTestingSource = testingKey === sourceKey;
            const testResult = testResults[proxyKey];
            const sourceResult = testResults[sourceKey];
            const sourceProxies = sourceResult?.proxies ?? [];
            const selectedSourceProxies = sourceSelections[sourceKey] ?? sourceProxies;
            const allSourceProxiesSelected =
              sourceProxies.length > 0 && selectedSourceProxies.length === sourceProxies.length;

            return (
              <div key={idx} className={styles.poolCard}>
                <div className={styles.poolHeader}>
                  <div className={styles.poolTitleGroup}>
                    <Input
                      value={pool.name}
                      onChange={(e) => handlePoolChange(idx, { name: e.target.value })}
                      placeholder={t('proxy_gateway.pool_name_placeholder', {
                        defaultValue: '代理池名称',
                      })}
                    />
                    <ToggleSwitch
                      checked={pool.enabled}
                      onChange={(val) => handlePoolChange(idx, { enabled: val })}
                      label={
                        pool.enabled
                          ? t('common.enabled', '已启用')
                          : t('common.disabled', '已禁用')
                      }
                    />
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => handleRemovePool(idx)}>
                    <IconTrash2 size={16} />
                  </Button>
                </div>

                <div>
                  <label className={styles.description} htmlFor={`gateway-proxies-${idx}`}>
                    {t('proxy_gateway.proxies_input_label', {
                      defaultValue:
                        '静态代理列表（每行一个，支持 IPv4、IPv6、HTTP、HTTPS、SOCKS5 格式）：',
                    })}
                  </label>
                  <textarea
                    id={`gateway-proxies-${idx}`}
                    className={styles.textarea}
                    value={pool.proxies.join('\n')}
                    onChange={(e) =>
                      handlePoolChange(idx, {
                        proxies: e.target.value.split('\n'),
                      })
                    }
                    placeholder="http://user:pass@[2001:db8::1]:8080\nsocks5://user:pass@127.0.0.1:1080\nhttp://proxy.example.com:8080"
                  />
                </div>

                <div className={styles.sourceRow}>
                  <Input
                    label={t('proxy_gateway.source_url_label', {
                      defaultValue: '动态代理源 API URL',
                    })}
                    hint={t('proxy_gateway.source_url_hint')}
                    value={pool.proxy_url_source || ''}
                    onChange={(e) => handlePoolChange(idx, { proxy_url_source: e.target.value })}
                    placeholder="https://provider.example.com/proxies"
                  />
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => handleTestPool(idx, true)}
                    disabled={testingKey !== null || !pool.proxy_url_source?.trim()}
                  >
                    {isTestingSource
                      ? t('proxy_gateway.testing')
                      : t('proxy_gateway.source_test_btn')}
                  </Button>
                </div>

                {sourceResult && (
                  <div
                    role="status"
                    className={`${styles.testResultBadge} ${sourceResult.success ? styles.success : styles.error}`}
                  >
                    {sourceResult.success
                      ? t('proxy_gateway.source_test_success', {
                          count: sourceResult.source_proxy_count ?? 0,
                          latency: sourceResult.latency_ms,
                        })
                      : `${t(sourceResult.stage === 'proxy' ? 'proxy_gateway.source_proxy_failed' : 'proxy_gateway.source_fetch_failed', { count: sourceResult.source_proxy_count ?? 0 })}${sourceResult.error || ''}`}
                  </div>
                )}

                {sourceProxies.length > 0 && (
                  <div className={styles.sourceResults}>
                    <div className={styles.sourceResultHeader}>
                      <label>
                        <input
                          type="checkbox"
                          checked={allSourceProxiesSelected}
                          onChange={(event) =>
                            setSourceSelections((prev) => ({
                              ...prev,
                              [sourceKey]: event.target.checked ? [...sourceProxies] : [],
                            }))
                          }
                        />
                        全选已获取代理（{sourceProxies.length}）
                      </label>
                      <div className={styles.poolActions}>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => addSourceProxies(idx, sourceProxies)}
                        >
                          全部去重加入
                        </Button>
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={selectedSourceProxies.length === 0}
                          onClick={() => addSourceProxies(idx, selectedSourceProxies)}
                        >
                          添加已选（{selectedSourceProxies.length}）
                        </Button>
                      </div>
                    </div>
                    <div className={styles.proxyChoiceList}>
                      {sourceProxies.map((proxy) => (
                        <label key={proxy} className={styles.proxyChoice}>
                          <input
                            type="checkbox"
                            checked={selectedSourceProxies.includes(proxy)}
                            onChange={(event) =>
                              setSourceSelections((prev) => ({
                                ...prev,
                                [sourceKey]: event.target.checked
                                  ? Array.from(new Set([...selectedSourceProxies, proxy]))
                                  : selectedSourceProxies.filter((item) => item !== proxy),
                              }))
                            }
                          />
                          <span className={styles.proxyChoiceText}>{proxy}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}

                <div className={styles.poolActions}>
                  <span>
                    {t('proxy_gateway.pool_proxies_count', { defaultValue: '池内代理数: ' })}
                    <strong>{parsedCount}</strong>
                  </span>

                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => handleTestPool(idx)}
                    disabled={testingKey !== null || parsedCount === 0}
                  >
                    {isTesting
                      ? t('proxy_gateway.testing', { defaultValue: '测试中...' })
                      : t('proxy_gateway.test_btn', { defaultValue: '测试池内连通性' })}
                  </Button>

                  {testResult && (
                    <span
                      className={`${styles.testResultBadge} ${
                        testResult.success ? styles.success : styles.error
                      }`}
                    >
                      {testResult.success
                        ? `✓ 正常 (${testResult.latency_ms}ms)`
                        : `✗ 失败: ${testResult.error || '超时'}`}
                    </span>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className={styles.actionBar}>
        <Button variant="secondary" onClick={loadData}>
          {t('common.cancel', { defaultValue: '取消' })}
        </Button>
        <Button variant="primary" onClick={handleSave} disabled={saving}>
          {saving
            ? t('common.saving', { defaultValue: '保存中...' })
            : t('common.save', { defaultValue: '保存并生效' })}
        </Button>
      </div>
    </div>
  );
}
