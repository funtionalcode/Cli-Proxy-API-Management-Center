import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { IconPencil, IconRefreshCw, IconSearch } from '@/components/ui/icons';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { Select } from '@/components/ui/Select';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { authFilesApi, configApi, providersApi } from '@/services/api';
import { useAuthStore, useConfigStore, useNotificationStore } from '@/stores';
import type {
  ApiKeyEntry,
  AuthFileItem,
  GeminiKeyConfig,
  OpenAIProviderConfig,
  ProviderKeyConfig,
} from '@/types';
import {
  buildProxyConfigRows,
  filterProxyConfigRows,
  maskProxyURL,
  parseProxyURL,
  type ParsedProxyURL,
  type ProviderProxyKind,
  type ProxyConfigRow,
  type ProxyConfigScope,
} from './proxyConfigModel';
import styles from './ProxyConfigsPage.module.scss';

type ProviderLists = {
  gemini: GeminiKeyConfig[];
  codex: ProviderKeyConfig[];
  claude: ProviderKeyConfig[];
  vertex: ProviderKeyConfig[];
  openai: OpenAIProviderConfig[];
};

const cloneProviderKeyWithProxy = <T extends GeminiKeyConfig | ProviderKeyConfig>(
  item: T,
  proxyUrl: string
): T => {
  const next = { ...item, proxyUrl: proxyUrl || undefined };
  if (!proxyUrl) {
    delete next.proxyUrl;
  }
  return next;
};

const cloneApiKeyEntryWithProxy = (entry: ApiKeyEntry, proxyUrl: string): ApiKeyEntry => {
  const next: ApiKeyEntry = { ...entry, proxyUrl: proxyUrl || undefined };
  if (!proxyUrl) {
    delete next.proxyUrl;
  }
  return next;
};

const hasAuthIndex = (value: unknown): value is string | number => {
  if (value === undefined || value === null) return false;
  return String(value).trim().length > 0;
};

const readErrorMessage = (err: unknown): string =>
  err instanceof Error ? err.message : typeof err === 'string' ? err : '';

function ProxyParsedPreview({ parsed }: { parsed: ParsedProxyURL }) {
  const { t } = useTranslation();

  const previewItems = [
    { label: t('proxy_configs.protocol'), value: parsed.scheme || '-' },
    { label: t('proxy_configs.host'), value: parsed.host || '-' },
    { label: t('proxy_configs.port'), value: parsed.port || '-' },
    { label: t('proxy_configs.proxy_user'), value: parsed.username || '-' },
    { label: t('proxy_configs.proxy_password'), value: parsed.passwordMasked || '-' },
  ];

  return (
    <div className={styles.previewGrid}>
      {previewItems.map((item) => (
        <div key={item.label} className={styles.previewItem}>
          <span className={styles.previewLabel}>{item.label}</span>
          <span className={styles.previewValue}>{item.value}</span>
        </div>
      ))}
    </div>
  );
}

export function ProxyConfigsPage() {
  const { t } = useTranslation();
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const config = useConfigStore((state) => state.config);
  const fetchConfig = useConfigStore((state) => state.fetchConfig);
  const updateConfigValue = useConfigStore((state) => state.updateConfigValue);
  const showNotification = useNotificationStore((state) => state.showNotification);

  const [providers, setProviders] = useState<ProviderLists>(() => ({
    gemini: config?.geminiApiKeys ?? [],
    codex: config?.codexApiKeys ?? [],
    claude: config?.claudeApiKeys ?? [],
    vertex: config?.vertexApiKeys ?? [],
    openai: config?.openaiCompatibility ?? [],
  }));
  const [authFiles, setAuthFiles] = useState<AuthFileItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [scopeFilter, setScopeFilter] = useState<ProxyConfigScope | 'all'>('all');
  const [editingRow, setEditingRow] = useState<ProxyConfigRow | null>(null);
  const [draftProxyUrl, setDraftProxyUrl] = useState('');
  const hasMounted = useRef(false);

  const disableControls = connectionStatus !== 'connected' || saving;

  const loadData = useCallback(async () => {
    setLoading(true);
    setError('');

    try {
      const configData = await fetchConfig(undefined, true);
      const [
        geminiResult,
        codexResult,
        claudeResult,
        vertexResult,
        openaiResult,
        authFilesResult,
      ] = await Promise.allSettled([
        providersApi.getGeminiKeys(),
        providersApi.getCodexConfigs(),
        providersApi.getClaudeConfigs(),
        providersApi.getVertexConfigs(),
        providersApi.getOpenAIProviders(),
        authFilesApi.list(),
      ]);

      const nextProviders = {
        gemini:
          geminiResult.status === 'fulfilled'
            ? geminiResult.value
            : configData.geminiApiKeys ?? [],
        codex:
          codexResult.status === 'fulfilled' ? codexResult.value : configData.codexApiKeys ?? [],
        claude:
          claudeResult.status === 'fulfilled'
            ? claudeResult.value
            : configData.claudeApiKeys ?? [],
        vertex:
          vertexResult.status === 'fulfilled'
            ? vertexResult.value
            : configData.vertexApiKeys ?? [],
        openai:
          openaiResult.status === 'fulfilled'
            ? openaiResult.value
            : configData.openaiCompatibility ?? [],
      };

      setProviders(nextProviders);
      setAuthFiles(authFilesResult.status === 'fulfilled' ? authFilesResult.value.files ?? [] : []);

      updateConfigValue('gemini-api-key', nextProviders.gemini);
      updateConfigValue('codex-api-key', nextProviders.codex);
      updateConfigValue('claude-api-key', nextProviders.claude);
      updateConfigValue('vertex-api-key', nextProviders.vertex);
      updateConfigValue('openai-compatibility', nextProviders.openai);

      if (authFilesResult.status === 'rejected') {
        const message = readErrorMessage(authFilesResult.reason) || t('notification.refresh_failed');
        showNotification(`${t('notification.refresh_failed')}: ${message}`, 'warning');
      }
    } catch (err: unknown) {
      setError(readErrorMessage(err) || t('notification.refresh_failed'));
    } finally {
      setLoading(false);
    }
  }, [fetchConfig, showNotification, t, updateConfigValue]);

  useEffect(() => {
    if (hasMounted.current) return;
    hasMounted.current = true;
    void loadData();
  }, [loadData]);

  useHeaderRefresh(loadData);

  const rows = useMemo(
    () =>
      buildProxyConfigRows({
        config,
        providers,
        authFiles,
      }),
    [authFiles, config, providers]
  );

  const visibleRows = useMemo(
    () => filterProxyConfigRows(rows, scopeFilter, search),
    [rows, scopeFilter, search]
  );

  const summary = useMemo(
    () => ({
      total: rows.length,
      overrides: rows.filter((row) => row.status === 'override').length,
      inherited: rows.filter((row) => row.status === 'inherit').length,
      direct: rows.filter((row) => row.status === 'direct').length,
    }),
    [rows]
  );

  const scopeOptions = useMemo(
    () => [
      { value: 'all', label: t('proxy_configs.scope_all') },
      { value: 'global', label: t('proxy_configs.scope_global') },
      { value: 'provider', label: t('proxy_configs.scope_provider') },
      { value: 'auth-file', label: t('proxy_configs.scope_auth_file') },
    ],
    [t]
  );

  const openEditor = (row: ProxyConfigRow) => {
    setEditingRow(row);
    setDraftProxyUrl(row.proxyUrl);
  };

  const closeEditor = () => {
    if (saving) return;
    setEditingRow(null);
    setDraftProxyUrl('');
  };

  const saveGlobalProxy = async (nextProxyUrl: string) => {
    if (nextProxyUrl) {
      await configApi.updateProxyUrl(nextProxyUrl);
    } else {
      await configApi.clearProxyUrl();
    }
    updateConfigValue('proxy-url', nextProxyUrl || undefined);
  };

  const saveProviderProxy = async (
    provider: Exclude<ProviderProxyKind, 'openai'>,
    index: number,
    nextProxyUrl: string
  ) => {
    switch (provider) {
      case 'gemini': {
        const nextList = providers.gemini.map((item, itemIndex) =>
          itemIndex === index ? cloneProviderKeyWithProxy(item, nextProxyUrl) : item
        );
        await providersApi.saveGeminiKeys(nextList);
        setProviders((current) => ({ ...current, gemini: nextList }));
        updateConfigValue('gemini-api-key', nextList);
        return;
      }
      case 'codex': {
        const nextList = providers.codex.map((item, itemIndex) =>
          itemIndex === index ? cloneProviderKeyWithProxy(item, nextProxyUrl) : item
        );
        await providersApi.saveCodexConfigs(nextList);
        setProviders((current) => ({ ...current, codex: nextList }));
        updateConfigValue('codex-api-key', nextList);
        return;
      }
      case 'claude': {
        const nextList = providers.claude.map((item, itemIndex) =>
          itemIndex === index ? cloneProviderKeyWithProxy(item, nextProxyUrl) : item
        );
        await providersApi.saveClaudeConfigs(nextList);
        setProviders((current) => ({ ...current, claude: nextList }));
        updateConfigValue('claude-api-key', nextList);
        return;
      }
      case 'vertex': {
        const nextList = providers.vertex.map((item, itemIndex) =>
          itemIndex === index ? cloneProviderKeyWithProxy(item, nextProxyUrl) : item
        );
        await providersApi.saveVertexConfigs(nextList);
        setProviders((current) => ({ ...current, vertex: nextList }));
        updateConfigValue('vertex-api-key', nextList);
        return;
      }
      default:
        return;
    }
  };

  const saveOpenAIEntryProxy = async (
    providerIndex: number,
    entryIndex: number,
    nextProxyUrl: string
  ) => {
    const nextProviders = providers.openai.map((provider, currentProviderIndex) => {
      if (currentProviderIndex !== providerIndex) return provider;
      const entries = Array.isArray(provider.apiKeyEntries) ? provider.apiKeyEntries : [];
      return {
        ...provider,
        apiKeyEntries: entries.map((entry, currentEntryIndex) =>
          currentEntryIndex === entryIndex ? cloneApiKeyEntryWithProxy(entry, nextProxyUrl) : entry
        ),
      };
    });

    await providersApi.saveOpenAIProviders(nextProviders);
    setProviders((current) => ({ ...current, openai: nextProviders }));
    updateConfigValue('openai-compatibility', nextProviders);
  };

  const saveAuthFileProxy = async (
    name: string,
    authIndex: string | number | null | undefined,
    nextProxyUrl: string
  ) => {
    if (hasAuthIndex(authIndex)) {
      await authFilesApi.patchFieldsForAuthIndexes(name, [authIndex], { proxy_url: nextProxyUrl });
    } else {
      await authFilesApi.patchFields(name, { proxy_url: nextProxyUrl });
    }
    const data = await authFilesApi.list();
    setAuthFiles(data.files ?? []);
  };

  const handleSave = async () => {
    if (!editingRow) return;
    const nextProxyUrl = draftProxyUrl.trim();

    setSaving(true);
    try {
      const target = editingRow.target;
      if (target.type === 'global') {
        await saveGlobalProxy(nextProxyUrl);
      } else if (target.type === 'provider') {
        await saveProviderProxy(target.provider, target.index, nextProxyUrl);
      } else if (target.type === 'openai-entry') {
        await saveOpenAIEntryProxy(target.providerIndex, target.entryIndex, nextProxyUrl);
      } else {
        await saveAuthFileProxy(target.name, target.authIndex, nextProxyUrl);
      }
      showNotification(t('proxy_configs.save_success'), 'success');
      setEditingRow(null);
      setDraftProxyUrl('');
    } catch (err: unknown) {
      const message = readErrorMessage(err);
      showNotification(
        `${t('notification.update_failed')}${message ? `: ${message}` : ''}`,
        'error'
      );
    } finally {
      setSaving(false);
    }
  };

  const draftParsed = useMemo(() => parseProxyURL(draftProxyUrl), [draftProxyUrl]);
  const draftMasked = useMemo(() => maskProxyURL(draftProxyUrl), [draftProxyUrl]);
  const draftChanged = editingRow ? draftProxyUrl.trim() !== editingRow.proxyUrl.trim() : false;

  return (
    <div className={styles.container}>
      {error && <div className={styles.errorBox}>{error}</div>}

      <section className={styles.summaryGrid} aria-label={t('proxy_configs.summary_aria')}>
        <div className={styles.summaryItem}>
          <span className={styles.summaryLabel}>{t('proxy_configs.summary_total')}</span>
          <span className={styles.summaryValue}>{summary.total}</span>
        </div>
        <div className={styles.summaryItem}>
          <span className={styles.summaryLabel}>{t('proxy_configs.summary_overrides')}</span>
          <span className={styles.summaryValue}>{summary.overrides}</span>
        </div>
        <div className={styles.summaryItem}>
          <span className={styles.summaryLabel}>{t('proxy_configs.summary_inherited')}</span>
          <span className={styles.summaryValue}>{summary.inherited}</span>
        </div>
        <div className={styles.summaryItem}>
          <span className={styles.summaryLabel}>{t('proxy_configs.summary_direct')}</span>
          <span className={styles.summaryValue}>{summary.direct}</span>
        </div>
      </section>

      <section className={styles.toolbar}>
        <div className={styles.searchField}>
          <Input
            label={t('proxy_configs.search_label')}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t('proxy_configs.search_placeholder')}
            rightElement={<IconSearch size={16} />}
          />
        </div>
        <div className={styles.scopeField}>
          <label htmlFor="proxy-config-scope">{t('proxy_configs.scope_filter')}</label>
          <Select
            id="proxy-config-scope"
            value={scopeFilter}
            options={scopeOptions}
            onChange={(value) => setScopeFilter(value as ProxyConfigScope | 'all')}
            ariaLabel={t('proxy_configs.scope_filter')}
          />
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => void loadData()}
          disabled={loading || saving}
        >
          <IconRefreshCw size={15} />
          {t('common.refresh')}
        </Button>
      </section>

      <section className={styles.tablePanel}>
        {loading && visibleRows.length === 0 ? (
          <div className="hint">{t('common.loading')}</div>
        ) : visibleRows.length === 0 ? (
          <EmptyState
            title={t('proxy_configs.empty_title')}
            description={t('proxy_configs.empty_message')}
          />
        ) : (
          <div className={styles.table} role="table" aria-label={t('proxy_configs.table_aria')}>
            <div className={styles.headerRow} role="row">
              <span role="columnheader">{t('proxy_configs.col_scope')}</span>
              <span role="columnheader">{t('proxy_configs.col_provider')}</span>
              <span role="columnheader">{t('proxy_configs.col_name')}</span>
              <span role="columnheader">{t('proxy_configs.col_status')}</span>
              <span role="columnheader">{t('proxy_configs.col_protocol')}</span>
              <span role="columnheader">{t('proxy_configs.col_host')}</span>
              <span role="columnheader">{t('proxy_configs.col_port')}</span>
              <span role="columnheader">{t('proxy_configs.col_user')}</span>
              <span role="columnheader">{t('proxy_configs.col_password')}</span>
              <span role="columnheader" className={styles.actionsHeader}>
                {t('common.action')}
              </span>
            </div>

            {visibleRows.map((row) => {
              const maskedURL = maskProxyURL(row.proxyUrl);
              return (
                <div key={row.id} className={styles.row} role="row">
                  <div className={styles.scopeCell} role="cell">
                    <span className={`${styles.scopeBadge} ${styles[`scope_${row.scope}`]}`}>
                      {t(`proxy_configs.scope_${row.scope.replace('-', '_')}`)}
                    </span>
                  </div>
                  <div className={styles.providerCell} role="cell" title={row.provider}>
                    {row.provider}
                  </div>
                  <div className={styles.nameCell} role="cell">
                    <span className={styles.nameText} title={row.name}>
                      {row.name}
                    </span>
                    {row.detail && <span className={styles.detailText}>{row.detail}</span>}
                    {maskedURL && <span className={styles.maskedUrl}>{maskedURL}</span>}
                  </div>
                  <div className={styles.statusCell} role="cell">
                    <span className={`${styles.statusBadge} ${styles[`status_${row.status}`]}`}>
                      {t(`proxy_configs.status_${row.status}`)}
                    </span>
                  </div>
                  <div className={styles.monoCell} role="cell">
                    <span className={styles.mobileCaption}>{t('proxy_configs.col_protocol')}</span>
                    {row.parsed.scheme || '-'}
                  </div>
                  <div className={styles.hostCell} role="cell" title={row.parsed.host || undefined}>
                    <span className={styles.mobileCaption}>{t('proxy_configs.col_host')}</span>
                    {row.parsed.host || '-'}
                  </div>
                  <div className={styles.monoCell} role="cell">
                    <span className={styles.mobileCaption}>{t('proxy_configs.col_port')}</span>
                    {row.parsed.port || '-'}
                  </div>
                  <div
                    className={styles.userCell}
                    role="cell"
                    title={row.parsed.username || undefined}
                  >
                    <span className={styles.mobileCaption}>{t('proxy_configs.col_user')}</span>
                    {row.parsed.username || '-'}
                  </div>
                  <div className={styles.monoCell} role="cell">
                    <span className={styles.mobileCaption}>{t('proxy_configs.col_password')}</span>
                    {row.parsed.passwordMasked || '-'}
                  </div>
                  <div className={styles.actionsCell} role="cell">
                    <Button
                      variant="secondary"
                      size="xs"
                      iconOnly
                      disabled={disableControls}
                      onClick={() => openEditor(row)}
                      aria-label={t('proxy_configs.edit_proxy')}
                      title={t('proxy_configs.edit_proxy')}
                    >
                      <IconPencil size={14} />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <Modal
        open={Boolean(editingRow)}
        title={t('proxy_configs.edit_title')}
        onClose={closeEditor}
        closeDisabled={saving}
        width={720}
        footer={
          <>
            <Button variant="secondary" onClick={closeEditor} disabled={saving}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="secondary"
              onClick={() => setDraftProxyUrl('')}
              disabled={saving || !draftProxyUrl.trim()}
            >
              {t('proxy_configs.clear_proxy')}
            </Button>
            <Button
              onClick={() => void handleSave()}
              loading={saving}
              disabled={!draftChanged || !draftParsed.valid}
            >
              {t('common.save')}
            </Button>
          </>
        }
      >
        {editingRow && (
          <div className={styles.editor}>
            <div className={styles.editorTarget}>
              <span className={styles.editorProvider}>{editingRow.provider}</span>
              <span className={styles.editorName}>{editingRow.name}</span>
              {editingRow.detail && (
                <span className={styles.editorDetail}>{editingRow.detail}</span>
              )}
            </div>

            <Input
              label={t('proxy_configs.proxy_url_label')}
              value={draftProxyUrl}
              onChange={(event) => setDraftProxyUrl(event.target.value)}
              placeholder={t('proxy_configs.proxy_url_placeholder')}
              error={!draftParsed.valid ? t('proxy_configs.invalid_proxy_url') : undefined}
              autoComplete="off"
            />

            <ProxyParsedPreview parsed={draftParsed} />

            {draftMasked && draftParsed.valid && !draftParsed.direct && (
              <div className={styles.maskPreview}>
                <span>{t('proxy_configs.masked_url')}</span>
                <code>{draftMasked}</code>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
