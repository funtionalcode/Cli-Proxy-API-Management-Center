import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AuthFileItem } from '@/types';
import i18n from '@/i18n';
import en from '@/i18n/locales/en.json';
import ru from '@/i18n/locales/ru.json';
import zhCN from '@/i18n/locales/zh-CN.json';
import zhTW from '@/i18n/locales/zh-TW.json';
import { authFilesApi } from '@/services/api/authFiles';
import { formatQuotaResetTime } from '@/utils/quota/formatters';
import localInspectionPageSource from './CodexInspectionPage.tsx?raw';
import serverInspectionPageSource from './ServerCodexInspectionPage.tsx?raw';
import {
  CODEX_INSPECTION_LAST_RUN_STORAGE_KEY,
  CODEX_INSPECTION_SETTINGS_STORAGE_KEY,
  applyCodexInspectionExecutionResult,
  createCodexInspectionSession,
  createCodexInspectionConnectionFingerprint,
  executeCodexInspectionActions,
  hydrateCodexInspectionLastRun,
  inspectCodexAccounts,
  isReauthAction,
  loadCodexInspectionConfigurableSettings,
  loadCodexInspectionLastRun,
  resolveCodexInspectionAutoActionPlan,
  resolveCodexInspectionAutoActionItems,
  saveCodexInspectionLastRun,
  toReauthDeleteExecutionItem,
  type CodexInspectionAction,
  type CodexInspectionResultItem,
  type CodexInspectionRunResult,
} from './codexInspection';
import {
  ACTION_FILTERS,
  buildCodexInspectionPaginationState,
  buildConfigOverviewItems,
  countHandlingStates,
  countActions,
  filterInspectionResults,
  filterByAction,
  formatInspectionQuotaResetLabel,
  formatInspectionLogsForClipboard,
  formatPercent,
  formatServerCodexInspectionLogDetail,
  formatServerCodexInspectionLogMessage,
  formatServerCodexInspectionLogSummary,
  getInspectionProbePresentation,
  getInspectionUserAgentVisibility,
  getVisibleActionFilters,
  getCanonicalServerCodexInspectionActionIds,
  normalizeActionFilter,
  getMixedServerCodexInspectionActionIds,
  isActionableServerCodexInspectionResult,
  isHandledServerCodexInspectionResult,
  isPendingServerReauthResult,
  normalizeServerCodexInspectionActionStatus,
  shouldShowInspectionConclusionReason,
  summarizeInspectionError,
  toLocalInspectionLogViewEntry,
  toServerInspectionLogViewEntry,
  getXaiInferenceState,
  validateInspectionConfigDraft,
} from './model/codexInspectionPresentation';
import {
  getCodexInspectionOwnedDisableFileNames,
  recordCodexInspectionDisableOwnership,
} from './model/codexInspectionOwnership';

const createStorage = () => {
  const values = new Map<string, string>();
  return {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      values.delete(key);
    }),
    clear: vi.fn(() => {
      values.clear();
    }),
  } as unknown as Storage;
};

const translateEn = ((key: string, values?: Record<string, unknown>) => {
  const template = key.split('.').reduce<unknown>((current, segment) => {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return undefined;
    return (current as Record<string, unknown>)[segment];
  }, en);
  return String(template ?? key).replace(/{{\s*([^}\s]+)\s*}}/g, (_, name: string) =>
    String(values?.[name] ?? `{{${name}}}`)
  );
}) as never;

const createResultItem = (
  action: CodexInspectionAction,
  overrides: Partial<CodexInspectionResultItem> = {}
): CodexInspectionResultItem => ({
  key: overrides.key ?? `${action}.json::1`,
  fileName: overrides.fileName ?? `${action}.json`,
  displayAccount: overrides.displayAccount ?? `${action}@example.com`,
  authIndex: overrides.authIndex ?? '1',
  accountId: overrides.accountId ?? 'account-1',
  provider: overrides.provider ?? 'codex',
  disabled: overrides.disabled ?? false,
  autoRecoverOwned: overrides.autoRecoverOwned ?? false,
  status: overrides.status ?? '',
  state: overrides.state ?? '',
  raw:
    overrides.raw ??
    ({
      name: `${action}.json`,
      type: 'codex',
      access_token: 'raw-secret-token',
    } as AuthFileItem),
  action,
  actionReason: overrides.actionReason ?? 'reason',
  statusCode: overrides.statusCode ?? (action === 'delete' ? 401 : 200),
  usedPercent: overrides.usedPercent ?? null,
  isQuota: overrides.isQuota ?? false,
  autoRecoverEligible: overrides.autoRecoverEligible ?? false,
  error: overrides.error ?? '',
  planType: overrides.planType ?? null,
  quotaWindows: overrides.quotaWindows ?? [],
  errorKind: overrides.errorKind ?? '',
  errorDetail: overrides.errorDetail ?? '',
  actionHandled: overrides.actionHandled ?? false,
});

const createCurrentAuthFile = (
  item: CodexInspectionResultItem,
  overrides: Partial<AuthFileItem> = {}
): AuthFileItem =>
  ({
    name: item.fileName,
    type: item.provider,
    auth_index: item.authIndex,
    ...(item.accountId ? { id_token: { account_id: item.accountId } } : {}),
    disabled: item.disabled,
    ...overrides,
  }) as AuthFileItem;

const createRunResult = (): CodexInspectionRunResult => {
  const results = [createResultItem('delete')];
  return {
    settings: {
      baseUrl: 'https://secret.example.test',
      token: 'management-secret-token',
      targetTypes: ['codex'],
      targetType: 'codex',
      workers: 2,
      deleteWorkers: 1,
      timeout: 1000,
      retries: 0,
      userAgent: 'test-agent',
      xaiInferenceUserAgent: 'xai-test-agent',
      xaiInferenceEnabled: false,
      xaiInferenceModel: 'grok-test',
      xaiInferencePrompt: 'Reply OK.',
      usedPercentThreshold: 90,
      sampleSize: 0,
    },
    files: [
      {
        name: 'delete.json',
        type: 'codex',
        access_token: 'file-secret-token',
      } as AuthFileItem,
    ],
    results,
    summary: {
      totalFiles: 1,
      probeSetCount: 1,
      sampledCount: 1,
      disabledCount: 0,
      enabledCount: 1,
      deleteCount: 1,
      disableCount: 0,
      enableCount: 0,
      reauthCount: 0,
      keepCount: 0,
      usedPercentThreshold: 90,
      sampled: false,
      plannedActionPreview: ['delete@example.com -> delete'],
    },
    startedAt: 1000,
    finishedAt: 2000,
  };
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('credential inspection state labels', () => {
  it('describes the state without repeating the file context', () => {
    expect([
      en.monitoring.codex_inspection_state_enabled,
      en.monitoring.codex_inspection_state_disabled,
    ]).toEqual(['Enabled', 'Disabled']);
    expect([
      zhCN.monitoring.codex_inspection_state_enabled,
      zhCN.monitoring.codex_inspection_state_disabled,
    ]).toEqual(['已启用', '已禁用']);
    expect([
      zhTW.monitoring.codex_inspection_state_enabled,
      zhTW.monitoring.codex_inspection_state_disabled,
    ]).toEqual(['已啟用', '已禁用']);
    expect([
      ru.monitoring.codex_inspection_state_enabled,
      ru.monitoring.codex_inspection_state_disabled,
    ]).toEqual(['Включено', 'Отключено']);
  });

  it('keeps server execution state separate from conclusion reasons', () => {
    expect(serverInspectionPageSource).not.toContain("reasonParts.join(' · ')");
    expect(serverInspectionPageSource).not.toContain('formatServerResultStateDetail');
    expect(serverInspectionPageSource).toContain('formatServerTerminalActionStatusLabel');
    expect(serverInspectionPageSource).toContain("errorDetail: item.errorDetail || ''");
    expect(serverInspectionPageSource).not.toContain('item.actionError || item.errorDetail');
    expect(serverInspectionPageSource).toContain('const actionError = source.actionError?.trim()');
  });

  it('keeps local automatic no-op logs aligned with the server lifecycle', () => {
    expect(localInspectionPageSource).toContain('actionCount: 0');
    expect(localInspectionPageSource).toContain('remainingCount: requestedCount');
    expect(localInspectionPageSource).toContain('deferCompletionLog: true');
    expect(localInspectionPageSource).not.toContain("appendLog('warning', skippedMessage)");
  });

  it('keeps demo conclusion reason translations available in every locale', () => {
    const keys = [
      'codex_inspection_reason_healthy',
      'codex_inspection_reason_reauth',
      'codex_inspection_reason_quota_threshold',
      'codex_inspection_reason_recovered',
    ] as const;

    for (const locale of [en, zhCN, zhTW, ru]) {
      for (const key of keys) {
        expect(locale.monitoring[key]).toBeTypeOf('string');
      }
    }
  });

  it('uses a neutral details label for inspection logs in every locale', () => {
    expect(en.monitoring.codex_inspection_log_detail).toBe('Details');
    expect(zhCN.monitoring.codex_inspection_log_detail).toBe('详情');
    expect(zhTW.monitoring.codex_inspection_log_detail).toBe('詳情');
    expect(ru.monitoring.codex_inspection_log_detail).toBe('Детали');
  });
});

describe('xAI inference presentation', () => {
  it('classifies provider inference states', () => {
    expect(getXaiInferenceState({ provider: 'codex', errorKind: 'inference_healthy' })).toBe(
      'not-applicable'
    );
    expect(getXaiInferenceState({ provider: 'xai', errorKind: 'inference_healthy' })).toBe(
      'success'
    );
    expect(getXaiInferenceState({ provider: 'xai', errorKind: 'missing_auth_index' })).toBe(
      'skipped'
    );
    expect(getXaiInferenceState({ provider: 'xai', errorKind: 'billing_healthy' })).toBe('skipped');
    expect(getXaiInferenceState({ provider: 'xai', errorKind: 'billing_partial' })).toBe('skipped');
    expect(getXaiInferenceState({ provider: 'xai', errorKind: 'identity_healthy' })).toBe(
      'skipped'
    );
    expect(getXaiInferenceState({ provider: 'xai', errorKind: 'model_unavailable' })).toBe(
      'failed'
    );
    expect(getXaiInferenceState({ provider: 'xai', errorKind: 'future_failure' })).toBe('failed');
  });

  it('presents the active probe source without treating billing health as inference health', () => {
    expect(
      getInspectionProbePresentation(
        { provider: 'xai', errorKind: 'billing_healthy', statusCode: null },
        { xaiInferenceEnabled: false }
      )
    ).toEqual({ source: 'xai_billing', state: 'success', statusCode: null });
    expect(
      getInspectionProbePresentation(
        { provider: 'xai', errorKind: 'billing_partial', statusCode: null },
        { xaiInferenceEnabled: false }
      )
    ).toEqual({ source: 'xai_billing', state: 'success', statusCode: null });
    expect(
      getInspectionProbePresentation(
        { provider: 'xai', errorKind: 'inference_healthy', statusCode: 200 },
        { xaiInferenceEnabled: true }
      )
    ).toEqual({ source: 'xai_inference', state: 'success', statusCode: 200 });
    expect(
      getInspectionProbePresentation(
        { provider: 'xai', errorKind: 'model_unavailable', statusCode: 404 },
        { xaiInferenceEnabled: true }
      )
    ).toEqual({ source: 'xai_inference', state: 'failed', statusCode: 404 });
  });
});

describe('inspection quota reset presentation', () => {
  it('formats server ISO reset values while preserving existing display labels', () => {
    const isoReset = '2026-07-29T00:00:00+00:00';
    expect(formatInspectionQuotaResetLabel(isoReset)).toBe(formatQuotaResetTime(isoReset));
    expect(formatInspectionQuotaResetLabel('2h 18m')).toBe('2h 18m');
    expect(formatInspectionQuotaResetLabel('-')).toBe('');
  });

  it('formats percentages that are already expressed on a 0-100 scale', () => {
    expect(formatPercent(97)).toBe('97.0%');
    expect(formatPercent(null)).toBe('--');
  });
});

describe('Codex inspection settings', () => {
  it('shows provider User-Agent fields only when their request path is active', () => {
    expect(getInspectionUserAgentVisibility('codex', false)).toEqual({
      codex: true,
      xaiInference: false,
    });
    expect(getInspectionUserAgentVisibility('xai', false)).toEqual({
      codex: false,
      xaiInference: false,
    });
    expect(getInspectionUserAgentVisibility('xai', true)).toEqual({
      codex: false,
      xaiInference: true,
    });
    expect(getInspectionUserAgentVisibility('codex+xai', true)).toEqual({
      codex: true,
      xaiInference: true,
    });
  });

  it('migrates legacy auto execute settings to auto disable', () => {
    const storage = createStorage();
    vi.stubGlobal('localStorage', storage);
    storage.setItem(
      CODEX_INSPECTION_SETTINGS_STORAGE_KEY,
      JSON.stringify({ autoExecuteActions: true })
    );

    expect(loadCodexInspectionConfigurableSettings(null).autoActionMode).toBe('disable');
  });

  it('validates shared config drafts before saving', () => {
    const t = ((key: string, values?: Record<string, unknown>) => {
      if (key === 'monitoring.codex_inspection_settings_invalid_integer') {
        return `${values?.field} >= ${values?.min}`;
      }
      if (key === 'monitoring.codex_inspection_settings_invalid_threshold') {
        return `${values?.field} 0-100`;
      }
      return key;
    }) as never;

    const invalid = validateInspectionConfigDraft(
      {
        targetTypes: ' ',
        workers: '0',
        deleteWorkers: '2',
        timeout: '15000',
        retries: '-1',
        userAgent: 'agent',
        xaiInferenceUserAgent: 'xai-agent',
        xaiInferenceEnabled: false,
        xaiInferenceModel: '',
        xaiInferencePrompt: '',
        usedPercentThreshold: '120',
        sampleSize: 'all',
        autoActionMode: 'delete',
        autoRecoverEnabled: false,
      },
      t
    );

    expect(invalid.ok).toBe(false);
    expect(invalid.errors.targetTypes).toBe(
      'monitoring.codex_inspection_settings_target_type_required'
    );
    expect(invalid.errors.workers).toContain('>= 1');
    expect(invalid.errors.retries).toContain('>= 0');
    expect(invalid.errors.usedPercentThreshold).toContain('0-100');
    expect(invalid.errors.sampleSize).toContain('>= 0');

    const inferenceDisabled = validateInspectionConfigDraft(
      {
        targetTypes: 'xai',
        workers: '3',
        deleteWorkers: '2',
        timeout: '15000',
        retries: '0',
        userAgent: 'agent',
        xaiInferenceUserAgent: 'xai-agent',
        xaiInferenceEnabled: false,
        xaiInferenceModel: '',
        xaiInferencePrompt: '',
        usedPercentThreshold: '100',
        sampleSize: '0',
        autoActionMode: 'none',
        autoRecoverEnabled: false,
      },
      t
    );
    expect(inferenceDisabled.ok).toBe(true);

    const valid = validateInspectionConfigDraft(
      {
        targetTypes: ' Codex + xAI ',
        workers: '3',
        deleteWorkers: '2',
        timeout: '15000',
        retries: '0',
        userAgent: ' agent ',
        xaiInferenceUserAgent: ' xai-agent ',
        xaiInferenceEnabled: true,
        xaiInferenceModel: ' grok-custom ',
        xaiInferencePrompt: ' Reply briefly. ',
        usedPercentThreshold: '99.5',
        sampleSize: '0',
        autoActionMode: 'unexpected',
        autoRecoverEnabled: true,
      },
      t
    );

    expect(valid.ok).toBe(true);
    expect(valid.values).toEqual({
      targetTypes: ['codex', 'xai'],
      workers: 3,
      deleteWorkers: 2,
      timeout: 15000,
      retries: 0,
      userAgent: 'agent',
      xaiInferenceUserAgent: 'xai-agent',
      xaiInferenceEnabled: true,
      xaiInferenceModel: 'grok-custom',
      xaiInferencePrompt: 'Reply briefly.',
      usedPercentThreshold: 99.5,
      sampleSize: 0,
      autoActionMode: 'none',
      autoRecoverEnabled: true,
    });
  });

  it('builds local and server config overview items from the shared model', () => {
    const labels: Record<string, string> = {
      'monitoring.codex_inspection_threshold': 'Threshold',
      'monitoring.codex_inspection_sample_size': 'Sample',
      'monitoring.codex_inspection_settings_auto_action_mode_label': 'Auto',
      'monitoring.codex_inspection_settings_auto_action_mode_delete': 'Auto delete',
      'monitoring.codex_inspection_settings_auto_recover_label': 'Recovery',
      'monitoring.codex_inspection_workers': 'Workers',
      'monitoring.codex_inspection_settings_timeout_label': 'Timeout',
      'monitoring.codex_inspection_target_type': 'Target',
      'monitoring.codex_inspection_target_codex': 'Codex',
      'monitoring.codex_inspection_target_xai': 'xAI',
      'monitoring.codex_inspection_target_codex_xai': 'Codex + xAI',
      'monitoring.server_codex_inspection_sample_all': 'All',
      'monitoring.server_codex_inspection_config_summary_schedule': 'Schedule',
      'monitoring.server_codex_inspection_config_summary_trigger': 'Trigger',
      'monitoring.server_codex_inspection_config_summary_threshold': 'Threshold',
      'monitoring.server_codex_inspection_config_summary_sample': 'Sample',
      'monitoring.server_codex_inspection_config_summary_auto': 'Auto',
      'monitoring.server_codex_inspection_schedule_enabled': 'Enabled',
      'monitoring.server_codex_inspection_schedule_disabled': 'Disabled',
      'common.enabled': 'Enabled',
      'common.disabled': 'Disabled',
    };
    const t = ((key: string) => labels[key] ?? key) as never;
    const settings = {
      targetTypes: ['codex'],
      targetType: 'codex',
      workers: 4,
      timeout: 15000,
      usedPercentThreshold: 100,
      sampleSize: 0,
      autoActionMode: 'delete' as const,
      autoRecoverEnabled: false,
      xaiInferenceEnabled: false,
      xaiInferenceModel: 'grok-4.5',
      xaiInferencePrompt: 'Reply with exactly OK.',
    };

    expect(buildConfigOverviewItems(settings, { mode: 'local', t })).toMatchObject([
      { key: 'threshold', value: '100%', field: 'usedPercentThreshold' },
      { key: 'sample', value: 'All', field: 'sampleSize' },
      { key: 'auto', value: 'Auto delete', tone: 'bad', field: 'autoActionMode' },
      { key: 'recover', value: 'Disabled', tone: 'idle', field: 'autoActionMode' },
      { key: 'concurrency', value: '4', hint: 'Timeout: 15000', field: 'workers' },
      { key: 'target', value: 'Codex', field: 'targetTypes' },
    ]);

    expect(
      buildConfigOverviewItems(settings, {
        mode: 'server',
        t,
        scheduleEnabled: true,
        scheduleLabel: 'Every 60 minutes',
      })
    ).toMatchObject([
      { key: 'schedule', value: 'Enabled', tone: 'good', field: 'schedule' },
      { key: 'trigger', value: 'Every 60 minutes', field: 'schedule' },
      { key: 'threshold', value: '100%', field: 'usedPercentThreshold' },
      { key: 'sample', value: 'All', field: 'sampleSize' },
      { key: 'auto', value: 'Auto delete', tone: 'bad', field: 'autoActionMode' },
      { key: 'recover', value: 'Disabled', tone: 'idle', field: 'autoActionMode' },
      { key: 'target', value: 'Codex', field: 'targetTypes' },
    ]);

    const xaiSettings = {
      ...settings,
      targetTypes: ['codex', 'xai'],
      xaiInferenceEnabled: true,
      xaiInferenceModel: 'grok-custom',
      xaiInferencePrompt: 'Return a short health response.',
    };
    const xaiOverviewItems = buildConfigOverviewItems(xaiSettings, { mode: 'local', t });
    expect(xaiOverviewItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'target', field: 'targetTypes' }),
        expect.objectContaining({
          key: 'xai-inference',
          value: 'Enabled',
          field: 'xaiInferenceEnabled',
        }),
      ])
    );
    expect(xaiOverviewItems.map((item) => item.key)).not.toContain('xai-model');
    expect(xaiOverviewItems.map((item) => item.key)).not.toContain('xai-prompt');
  });
});

describe('Codex inspection error summaries', () => {
  const t = ((key: string) => {
    const messages: Record<string, string> = {
      'xai_quota.diagnostic_protocol_changed':
        'The billing endpoint returned data that cannot currently be recognized',
      'xai_quota.diagnostic_inference_protocol_changed':
        'The inference endpoint returned a response that could not be recognized as completed',
      'monitoring.codex_inspection_error_summary_http_status':
        'The service did not complete the request',
    };
    return messages[key] ?? key;
  }) as never;

  it.each(['billing_healthy', 'billing_partial', 'identity_healthy', 'official_api_healthy'])(
    'does not present a healthy xAI classification %s as an error',
    (errorKind) => {
      expect(
        summarizeInspectionError(
          createResultItem('keep', {
            provider: 'xai',
            errorKind,
            statusCode: 200,
          }),
          t
        )
      ).toBe('');
    }
  );

  it('translates xAI diagnostic classifications into user-facing explanations', () => {
    const summary = summarizeInspectionError(
      createResultItem('keep', {
        provider: 'xai',
        errorKind: 'protocol_changed',
        statusCode: 200,
      }),
      t
    );

    expect(summary).toBe('The billing endpoint returned data that cannot currently be recognized');
    expect(summary).not.toContain('protocol_changed');
    expect(summary).not.toContain('HTTP 200');
  });

  it('uses inference-specific diagnostics when real inference is enabled', () => {
    const summary = summarizeInspectionError(
      createResultItem('keep', {
        provider: 'xai',
        errorKind: 'protocol_changed',
        statusCode: 200,
      }),
      t,
      { xaiInferenceEnabled: true }
    );

    expect(summary).toBe(
      'The inference endpoint returned a response that could not be recognized as completed'
    );
    expect(summary).not.toContain('billing');
  });

  it('uses a user-facing explanation for generic HTTP failures', () => {
    expect(
      summarizeInspectionError(
        createResultItem('keep', {
          provider: 'codex',
          errorKind: 'http_status',
          statusCode: 403,
        }),
        t
      )
    ).toBe('The service did not complete the request');
  });
});

describe('local inspection lifecycle log details', () => {
  it('emits server-shaped details for loading, collection, and completion', async () => {
    vi.spyOn(authFilesApi, 'list').mockResolvedValue({ files: [] });
    const logs: Array<{
      level: string;
      message: string;
      detail?: Record<string, unknown>;
    }> = [];

    await inspectCodexAccounts({
      config: null,
      apiBase: 'https://cpa.example.test',
      managementKey: 'management-key',
      settings: { targetTypes: ['codex', 'xai'], sampleSize: 0 },
      onLog: (level, message, detail) => logs.push({ level, message, detail }),
      t: translateEn,
    });

    expect(logs).toHaveLength(3);
    expect(logs[0].detail).toEqual({
      triggerType: 'manual',
      triggerKey: 'manual',
      targetTypes: ['codex', 'xai'],
    });
    expect(logs[1].detail).toEqual({
      totalFiles: 0,
      probeSetCount: 0,
      sampledCount: 0,
      targetTypes: ['codex', 'xai'],
    });
    expect(logs[2].detail).toEqual({
      deleteCount: 0,
      disableCount: 0,
      enableCount: 0,
      reauthCount: 0,
      keepCount: 0,
      actionSuccessCount: 0,
      actionFailedCount: 0,
      actionSkippedCount: 0,
      actionNeedsReviewCount: 0,
      actionErrors: [],
      resultWriteFailedCount: 0,
    });
  });

  it('can defer the final completion log until automatic actions finish', async () => {
    vi.spyOn(authFilesApi, 'list').mockResolvedValue({ files: [] });
    const logs: Array<{ message: string }> = [];
    const session = createCodexInspectionSession({
      config: null,
      apiBase: 'https://cpa.example.test',
      managementKey: 'management-key',
      settings: { targetTypes: ['codex', 'xai'], sampleSize: 0 },
      deferCompletionLog: true,
      onLog: (_level, message) => logs.push({ message }),
      t: translateEn,
    });

    await session.start();

    expect(logs).toHaveLength(2);
    expect(logs.some((entry) => entry.message.startsWith('Inspection complete:'))).toBe(false);
  });

  it('emits one structured error when loading auth files fails', async () => {
    vi.spyOn(authFilesApi, 'list').mockRejectedValue(new Error('auth files unavailable'));
    const logs: Array<{
      level: string;
      message: string;
      detail?: Record<string, unknown>;
    }> = [];

    await expect(
      inspectCodexAccounts({
        config: null,
        apiBase: 'https://cpa.example.test',
        managementKey: 'management-key',
        settings: { targetTypes: ['codex'], sampleSize: 0 },
        onLog: (level, message, detail) => logs.push({ level, message, detail }),
        t: translateEn,
      })
    ).rejects.toThrow('auth files unavailable');

    expect(logs).toHaveLength(2);
    expect(logs[1]).toMatchObject({
      level: 'error',
      detail: { error: 'auth files unavailable' },
    });
    expect(logs[1].message).toContain('auth files unavailable');
  });
});

describe('Server Codex inspection log details', () => {
  const t = ((key: string) => {
    const messages: Record<string, string> = {
      'monitoring.codex_inspection_action_keep': '保留',
      'monitoring.server_codex_inspection_log_mode_inference': '真实推理检查',
      'monitoring.xai_inspection_evidence_inference_healthy': '真实推理健康',
      'monitoring.server_codex_inspection_log_message_run_started':
        'Credential health inspection started',
      'monitoring.server_codex_inspection_log_message_interrupted':
        'Credential health inspection interrupted',
      'monitoring.server_codex_inspection_log_message_lifecycle_finalized':
        'Credential health inspection lifecycle finalized',
      'monitoring.server_codex_inspection_log_message_recovered_interrupted':
        'Credential health inspection interrupted after restart or lease expiry',
      'monitoring.server_codex_inspection_log_message_shutdown_before_start':
        'Credential health inspection could not start because the service is shutting down',
      'monitoring.server_codex_inspection_log_message_local_conflict_before_start':
        'Credential health inspection could not start because of a local lifecycle conflict',
      'monitoring.server_codex_inspection_log_message_ownership_cleanup_failed':
        'Failed to clean up inspection disable ownership',
      'monitoring.server_codex_inspection_log_message_auto_started':
        'Automatic account processing started',
      'monitoring.server_codex_inspection_log_message_auto_validation_failed':
        'Automatic account action validation failed',
      'monitoring.xai_inspection_log_server_complete': 'xAI account check completed',
      'common.yes': '是',
      'common.no': '否',
    };
    return messages[key] ?? key;
  }) as never;

  const summaryT = i18n.getFixedT('zh-CN');

  it('formats server lifecycle logs as the same concise summaries used locally', () => {
    expect(
      formatServerCodexInspectionLogSummary(
        {
          message: '凭证健康巡检开始',
          detail: { targetTypes: ['codex', 'xai'] },
        },
        null,
        summaryT
      )
    ).toBe('正在加载认证文件，目标类型：Codex + xAI');
    expect(
      formatServerCodexInspectionLogSummary(
        {
          message: '凭证健康巡检集合已准备',
          detail: { probeSetCount: 8, sampledCount: 8 },
        },
        null,
        summaryT
      )
    ).toBe('巡检集合 8 个账号，本次探测 8 个账号');
    expect(
      formatServerCodexInspectionLogSummary(
        {
          message: '凭证健康巡检完成',
          detail: {
            deleteCount: 1,
            disableCount: 2,
            enableCount: 1,
            reauthCount: 1,
            keepCount: 3,
          },
        },
        null,
        summaryT
      )
    ).toBe('巡检完成：删除 1、禁用 2、启用 1、重新登录 1、保留 3');
  });

  it('formats Codex and xAI account logs with provider-accurate probe semantics', () => {
    expect(
      formatServerCodexInspectionLogSummary(
        {
          message: '账号探测完成',
          detail: {
            fileName: 'codex-team.json',
            action: 'keep',
            statusCode: 200,
            usedPercent: 42,
          },
        },
        null,
        summaryT
      )
    ).toBe('codex-team.json -> 保留（HTTP 200 · 已用 42.0%）');
    expect(
      formatServerCodexInspectionLogSummary(
        {
          message: 'monitoring.xai_inspection_log_server_complete',
          detail: {
            displayAccount: 'xai@example.com',
            action: 'disable',
            inspectionMode: 'inference',
            healthEvidence: 'spending_limit',
          },
        },
        null,
        summaryT
      )
    ).toBe('xai@example.com -> 禁用（真实推理检查：消费额度或积分已用尽）');
  });

  it('keeps account context in server Codex failure summaries', () => {
    expect(
      formatServerCodexInspectionLogSummary(
        {
          message: '账号缺少 auth_index，跳过探测',
          detail: { displayAccount: 'missing@example.com' },
        },
        null,
        summaryT
      )
    ).toBe('missing@example.com 缺少 auth_index，已跳过探测');
    expect(
      formatServerCodexInspectionLogSummary(
        {
          message: '账号探测异常，保留账号',
          detail: { displayAccount: 'failed@example.com', error: 'network timeout' },
        },
        null,
        summaryT
      )
    ).toBe('failed@example.com 探测异常，已保留账号：network timeout');
    expect(
      formatServerCodexInspectionLogSummary(
        {
          message: '账号探测未返回 status_code，保留账号',
          detail: { displayAccount: 'unknown@example.com' },
        },
        null,
        summaryT
      )
    ).toBe('unknown@example.com 探测未返回 status_code，已保留账号');
  });

  it('formats lifecycle and manual-action failure paths without losing structured reasons', () => {
    const cases = [
      {
        messages: [
          '加载认证文件列表失败',
          'monitoring.server_codex_inspection_log_message_auth_files_failed',
        ],
        detail: { reason: 'upstream unavailable' },
        expected: summaryT('monitoring.codex_inspection_log_auth_files_failed', {
          message: 'upstream unavailable',
        }),
      },
      {
        messages: [
          '凭证健康巡检已取消',
          'monitoring.server_codex_inspection_log_message_cancelled',
        ],
        detail: { error: 'context canceled' },
        expected: summaryT('monitoring.codex_inspection_log_cancelled', {
          message: 'context canceled',
        }),
      },
      {
        messages: [
          '自动处理账号开始',
          'monitoring.server_codex_inspection_log_message_auto_started',
        ],
        detail: { requestedCount: 4, actionCount: 3 },
        expected: summaryT('monitoring.codex_inspection_log_auto_started', {
          requested: 4,
          actions: 3,
        }),
      },
      {
        messages: [
          '自动处理账号完成',
          'monitoring.server_codex_inspection_log_message_auto_completed',
        ],
        detail: {
          successCount: 1,
          skippedCount: 1,
          needsReviewCount: 1,
          failedCount: 1,
          remainingCount: 2,
        },
        expected: summaryT('monitoring.codex_inspection_log_auto_completed', {
          success: 1,
          skipped: 1,
          review: 1,
          failed: 1,
          remaining: 2,
        }),
      },
      {
        messages: [
          '手动处理账号开始',
          'monitoring.server_codex_inspection_log_message_manual_started',
        ],
        detail: { requestedCount: 3, actionCount: 2 },
        expected: summaryT('monitoring.codex_inspection_log_manual_started', {
          requested: 3,
          actions: 2,
        }),
      },
      {
        messages: [
          '手动处理账号完成',
          'monitoring.server_codex_inspection_log_message_manual_completed',
        ],
        detail: { successCount: 1, skippedCount: 1, needsReviewCount: 1, failedCount: 0 },
        expected: summaryT('monitoring.codex_inspection_log_manual_completed', {
          success: 1,
          skipped: 1,
          review: 1,
          failed: 0,
        }),
      },
    ];

    cases.forEach(({ detail, expected, messages }) => {
      messages.forEach((message) => {
        expect(formatServerCodexInspectionLogSummary({ message, detail }, null, summaryT)).toBe(
          expected
        );
      });
    });
  });

  it('formats skipped, persistence, ownership, validation, and action failures', () => {
    const cases = [
      {
        message: 'monitoring.server_codex_inspection_log_message_auto_action_skipped',
        detail: { displayAccount: 'auto@example.com', action: 'disable', reason: 'duplicate' },
        expected: summaryT('monitoring.codex_inspection_log_action_skipped', {
          account: 'auto@example.com',
          action: summaryT('monitoring.codex_inspection_action_disable'),
          message: 'duplicate',
        }),
      },
      {
        message: '手动处理账号跳过',
        detail: { fileName: 'manual.json', action: 'enable', reason: 'already enabled' },
        expected: summaryT('monitoring.codex_inspection_log_action_skipped', {
          account: 'manual.json',
          action: summaryT('monitoring.codex_inspection_action_enable'),
          message: 'already enabled',
        }),
      },
      {
        message: '自动处理账号跳过',
        detail: {
          fileName: 'mixed.json',
          action: 'delete',
          status: 'needs_review',
          reason: 'mixed actions',
        },
        expected: summaryT('monitoring.codex_inspection_log_action_needs_review', {
          account: 'mixed.json',
          action: summaryT('monitoring.codex_inspection_action_delete'),
          message: 'mixed actions',
        }),
      },
      {
        message: '写入巡检账号结果失败',
        detail: { fileName: 'write.json', error: 'database locked' },
        expected: summaryT('monitoring.codex_inspection_log_result_write_failed', {
          account: 'write.json',
          message: 'database locked',
        }),
      },
      {
        message: '写入巡检账号结果失败',
        detail: {
          displayAccount: 'live@example.com',
          error: 'database locked',
          retryScheduled: true,
        },
        expected: summaryT('monitoring.codex_inspection_log_result_write_retry', {
          account: 'live@example.com',
          message: 'database locked',
        }),
      },
      {
        message: '加载巡检禁用所有权失败，自动恢复将保持关闭',
        detail: { error: 'storage unavailable' },
        expected: summaryT('monitoring.codex_inspection_log_ownership_failed', {
          message: 'storage unavailable',
        }),
      },
      {
        message: '手动处理账号校验失败',
        detail: {
          displayAccount: 'changed@example.com',
          action: 'delete',
          error: 'identity changed',
        },
        expected: summaryT('monitoring.codex_inspection_log_manual_validation_failed', {
          account: 'changed@example.com',
          action: summaryT('monitoring.codex_inspection_action_delete'),
          message: 'identity changed',
        }),
      },
      {
        message: '自动处理账号校验失败',
        detail: {
          displayAccount: 'automatic@example.com',
          action: 'disable',
          error: 'identity changed',
        },
        expected: summaryT('monitoring.codex_inspection_log_manual_validation_failed', {
          account: 'automatic@example.com',
          action: summaryT('monitoring.codex_inspection_action_disable'),
          message: 'identity changed',
        }),
      },
      {
        message: 'monitoring.server_codex_inspection_log_message_manual_action_failed',
        detail: {
          displayAccount: 'failed@example.com',
          action: 'disable',
          reason: 'preflight failed',
        },
        expected: summaryT('monitoring.codex_inspection_log_action_failed', {
          account: 'failed@example.com',
          action: summaryT('monitoring.codex_inspection_action_disable'),
          message: 'preflight failed',
        }),
      },
    ];

    cases.forEach(({ detail, expected, message }) => {
      expect(formatServerCodexInspectionLogSummary({ message, detail }, null, summaryT)).toBe(
        expected
      );
    });
  });

  it('keeps historical xAI log summaries on the correct inspection surface', () => {
    expect(
      formatServerCodexInspectionLogSummary(
        {
          message: 'monitoring.xai_inspection_log_server_complete',
          detail: {
            fileName: 'xai-inference.json',
            action: 'keep',
            billingPartial: true,
            inferenceEnabled: true,
            inferenceHealthy: true,
          },
        },
        null,
        summaryT
      )
    ).toBe('xai-inference.json -> 保留（真实推理健康 · 已用 --）');
    expect(
      formatServerCodexInspectionLogSummary(
        {
          message: 'monitoring.xai_inspection_log_server_complete',
          detail: {
            fileName: 'xai-billing.json',
            action: 'keep',
            billingPartial: true,
            inferenceEnabled: false,
            inferenceHealthy: false,
          },
        },
        null,
        summaryT
      )
    ).toBe('xai-billing.json -> 保留（账单部分可用 · 已用 --）');
    expect(
      formatServerCodexInspectionLogSummary(
        {
          message: 'monitoring.xai_inspection_log_server_complete',
          detail: {
            fileName: 'xai-basic-healthy.json',
            action: 'keep',
            billingPartial: false,
            inferenceEnabled: false,
            inferenceHealthy: false,
          },
        },
        null,
        summaryT
      )
    ).toBe('xai-basic-healthy.json -> 保留（账单或官方 API 身份健康 · 已用 --）');
  });

  it('includes the account in server xAI missing-auth summaries', () => {
    expect(
      formatServerCodexInspectionLogSummary(
        {
          message: 'monitoring.xai_inspection_log_server_missing_auth_index',
          detail: {
            displayAccount: 'xai-missing@example.com',
            inspectionMode: 'skipped',
            healthEvidence: 'missing_auth_index',
          },
        },
        null,
        summaryT
      )
    ).toBe('xai-missing@example.com 缺少检查所需的账号标识，已跳过巡检');
  });

  it('keeps structured server details in copied audit logs', () => {
    const viewEntry = toServerInspectionLogViewEntry(
      {
        id: 10,
        runId: 3,
        level: 'warning',
        message: 'monitoring.xai_inspection_log_server_complete',
        detail: {
          provider: 'xai',
          displayAccount: 'xai@example.com',
          inspectionMode: 'inference',
          healthEvidence: 'spending_limit',
          action: 'disable',
        },
        createdAtMs: Date.UTC(2026, 6, 23, 12, 0, 0),
      },
      null,
      summaryT
    );
    const copied = formatInspectionLogsForClipboard([viewEntry]);

    expect(copied).toContain('xai@example.com -> 禁用（真实推理检查：消费额度或积分已用尽）');
    expect(copied).toContain('"provider":"xai"');
    expect(copied).toContain('"inspectionMode":"真实推理检查"');
    expect(copied).toContain('"healthEvidence":"消费额度或积分已用尽"');
  });

  it('formats local structured details with the same presentation as server logs', () => {
    const viewEntry = toLocalInspectionLogViewEntry(
      {
        id: 'local-xai',
        level: 'warning',
        message: 'xai@example.com -> 禁用（真实推理检查：消费额度或积分已用尽）',
        timestamp: Date.UTC(2026, 6, 23, 12, 0, 0),
        detail: {
          provider: 'xai',
          displayAccount: 'xai@example.com',
          inspectionMode: 'inference',
          healthEvidence: 'spending_limit',
          inferenceEnabled: true,
          inferenceHealthy: false,
          action: 'disable',
        },
      },
      summaryT
    );

    expect(viewEntry.message).toContain('xai@example.com -> 禁用');
    expect(JSON.parse(viewEntry.detail ?? '{}')).toMatchObject({
      provider: 'xai',
      displayAccount: 'xai@example.com',
      inspectionMode: '真实推理检查',
      healthEvidence: '消费额度或积分已用尽',
      inferenceEnabled: '是',
      inferenceHealthy: '否',
      action: '禁用',
    });
  });

  it('localizes structured action values without mutating the source detail', () => {
    const detail = { fileName: 'xai.json', partial: false, action: 'keep' };

    const formatted = formatServerCodexInspectionLogDetail(detail, t);

    expect(JSON.parse(formatted)).toEqual({
      fileName: 'xai.json',
      partial: false,
      action: '保留',
    });
    expect(formatted).not.toContain('"action":"keep"');
    expect(detail.action).toBe('keep');
  });

  it('localizes actions nested in completion error details', () => {
    const detail = {
      actionErrors: [
        { fileName: 'disable.json', action: 'disable', error: 'status update failed' },
        { fileName: 'custom.json', action: 'custom', error: 'custom failure' },
      ],
    };

    expect(JSON.parse(formatServerCodexInspectionLogDetail(detail, summaryT))).toEqual({
      actionErrors: [
        { fileName: 'disable.json', action: '禁用', error: 'status update failed' },
        { fileName: 'custom.json', action: 'custom', error: 'custom failure' },
      ],
    });
    expect(detail.actionErrors[0].action).toBe('disable');
  });

  it('localizes structured xAI inspection mode, evidence, and booleans', () => {
    const detail = {
      provider: 'xai',
      inspectionMode: 'inference',
      healthEvidence: 'inference_healthy',
      billingAvailable: true,
      billingPartial: false,
      inferenceEnabled: true,
      inferenceHealthy: true,
      action: 'keep',
    };

    expect(JSON.parse(formatServerCodexInspectionLogDetail(detail, t))).toEqual({
      provider: 'xai',
      inspectionMode: '真实推理检查',
      healthEvidence: '真实推理健康',
      billingAvailable: '是',
      billingPartial: '否',
      inferenceEnabled: '是',
      inferenceHealthy: '是',
      action: '保留',
    });
    expect(detail.inspectionMode).toBe('inference');
  });

  it('enriches historical xAI details without confusing billing logs with inference logs', () => {
    expect(
      JSON.parse(
        formatServerCodexInspectionLogDetail(
          {
            fileName: 'xai-inference.json',
            action: 'keep',
            billingPartial: true,
            inferenceEnabled: true,
            inferenceHealthy: true,
          },
          summaryT
        )
      )
    ).toMatchObject({
      provider: 'xai',
      inspectionMode: '真实推理检查',
      healthEvidence: '真实推理健康',
      billingPartial: '是',
      inferenceEnabled: '是',
      inferenceHealthy: '是',
    });
    expect(
      JSON.parse(
        formatServerCodexInspectionLogDetail(
          {
            fileName: 'xai-billing.json',
            action: 'keep',
            billingPartial: true,
            inferenceEnabled: false,
            inferenceHealthy: false,
          },
          summaryT
        )
      )
    ).toMatchObject({
      provider: 'xai',
      inspectionMode: '账单检查',
      healthEvidence: '账单部分可用',
      inferenceEnabled: '否',
      inferenceHealthy: '否',
    });
    expect(
      JSON.parse(
        formatServerCodexInspectionLogDetail(
          {
            fileName: 'xai-basic-healthy.json',
            action: 'keep',
            billingPartial: false,
            inferenceEnabled: false,
            inferenceHealthy: false,
          },
          summaryT
        )
      )
    ).toMatchObject({
      provider: 'xai',
      inspectionMode: '账单检查',
      healthEvidence: '账单或官方 API 身份健康',
      inferenceEnabled: '否',
      inferenceHealthy: '否',
    });
  });

  it('localizes known historical server messages while preserving unknown text', () => {
    expect(formatServerCodexInspectionLogMessage('凭证健康巡检开始', t)).toBe(
      'Credential health inspection started'
    );
    expect(formatServerCodexInspectionLogMessage('自动处理账号开始', t)).toBe(
      'Automatic account processing started'
    );
    expect(formatServerCodexInspectionLogMessage('自动处理账号校验失败', t)).toBe(
      'Automatic account action validation failed'
    );
    expect(formatServerCodexInspectionLogMessage('凭证健康巡检已中断', t)).toBe(
      'Credential health inspection interrupted'
    );
    expect(formatServerCodexInspectionLogMessage('凭证健康巡检生命周期已收尾', t)).toBe(
      'Credential health inspection lifecycle finalized'
    );
    expect(formatServerCodexInspectionLogMessage('服务重启或任务租约过期，巡检已中断', t)).toBe(
      'Credential health inspection interrupted after restart or lease expiry'
    );
    expect(formatServerCodexInspectionLogMessage('服务关闭导致巡检未能启动', t)).toBe(
      'Credential health inspection could not start because the service is shutting down'
    );
    expect(formatServerCodexInspectionLogMessage('本地巡检状态冲突，任务未能启动', t)).toBe(
      'Credential health inspection could not start because of a local lifecycle conflict'
    );
    expect(formatServerCodexInspectionLogMessage('清理巡检禁用所有权失败', t)).toBe(
      'Failed to clean up inspection disable ownership'
    );
    expect(
      formatServerCodexInspectionLogMessage('monitoring.xai_inspection_log_server_complete', t)
    ).toBe('xAI account check completed');
    expect(formatServerCodexInspectionLogMessage('custom server message', t)).toBe(
      'custom server message'
    );
  });

  it('keeps string log details unchanged', () => {
    expect(formatServerCodexInspectionLogDetail('network timeout', t)).toBe('network timeout');
  });
});

describe('resolveCodexInspectionAutoActionItems', () => {
  const deleteItem = createResultItem('delete');
  const disableItem = createResultItem('disable');
  const enableItem = createResultItem('enable', { autoRecoverEligible: true });
  const reauthItem = createResultItem('reauth', { statusCode: 401 });

  it('does nothing when automatic mode is none', () => {
    expect(
      resolveCodexInspectionAutoActionItems('none', false, [
        deleteItem,
        disableItem,
        enableItem,
        reauthItem,
      ])
    ).toEqual([]);
  });

  it('only enables recovered accounts in auto enable mode', () => {
    const items = resolveCodexInspectionAutoActionItems('enable', true, [
      deleteItem,
      disableItem,
      enableItem,
      reauthItem,
    ]);

    expect(items.map((item) => [item.fileName, item.action])).toEqual([['enable.json', 'enable']]);
  });

  it('runs automatic recovery independently from the problem-account mode', () => {
    const items = resolveCodexInspectionAutoActionItems('none', true, [
      deleteItem,
      disableItem,
      enableItem,
    ]);

    expect(items.map((item) => [item.fileName, item.action])).toEqual([['enable.json', 'enable']]);
  });

  it('never auto-enables an account without inspection ownership', () => {
    const unownedEnable = createResultItem('enable', { autoRecoverEligible: false });

    expect(resolveCodexInspectionAutoActionItems('delete', true, [unownedEnable])).toEqual([]);
  });

  it('blocks mixed actions for the same file before automatic execution', () => {
    const mixed = [
      createResultItem('enable', {
        fileName: 'mixed.json',
        autoRecoverEligible: true,
      }),
      createResultItem('delete', { fileName: 'mixed.json' }),
    ];

    expect(resolveCodexInspectionAutoActionItems('delete', true, mixed)).toEqual([]);
    expect(resolveCodexInspectionAutoActionPlan('delete', true, mixed).preflightOutcomes).toEqual([
      expect.objectContaining({ status: 'needs_review', action: 'enable', success: true }),
      expect.objectContaining({ status: 'needs_review', action: 'delete', success: true }),
    ]);
  });

  it('turns delete suggestions into disable actions in auto disable mode', () => {
    const items = resolveCodexInspectionAutoActionItems('disable', false, [
      deleteItem,
      disableItem,
      enableItem,
      reauthItem,
    ]);

    expect(items.map((item) => [item.fileName, item.action])).toEqual([
      ['delete.json', 'disable'],
      ['disable.json', 'disable'],
    ]);
  });

  it('keeps delete, disable, and enable suggestions in auto delete mode', () => {
    const items = resolveCodexInspectionAutoActionItems('delete', true, [
      deleteItem,
      disableItem,
      enableItem,
      reauthItem,
    ]);

    expect(items.map((item) => [item.fileName, item.action])).toEqual([
      ['delete.json', 'delete'],
      ['disable.json', 'disable'],
      ['enable.json', 'enable'],
    ]);
  });
});

describe('reauth delete execution mapping', () => {
  it('keeps reauth as a non-auto-executable action until the user chooses delete', () => {
    const reauthItem = createResultItem('reauth', {
      fileName: 'reauth.json',
      statusCode: 401,
      actionReason: '接口返回 401，认证令牌已失效，建议重新登录账号',
    });

    expect(isReauthAction(reauthItem)).toBe(true);

    const deleteItem = toReauthDeleteExecutionItem(reauthItem);
    expect(deleteItem).toMatchObject({
      fileName: 'reauth.json',
      action: 'delete',
    });
    expect(deleteItem.actionReason).toContain('用户选择删除需重新登录账号');
  });

  it('allows an xAI reauth result to become an explicit manual delete action', () => {
    const reauthItem = createResultItem('reauth', {
      fileName: 'xai-reauth.json',
      provider: 'xai',
      raw: { name: 'xai-reauth.json', type: 'xai', auth_index: 'xai-1' },
    });

    expect(toReauthDeleteExecutionItem(reauthItem)).toMatchObject({
      fileName: 'xai-reauth.json',
      provider: 'xai',
      action: 'delete',
    });
  });
});

describe('Codex inspection action presentation', () => {
  it('keeps every suggested action filter visible', () => {
    expect(getVisibleActionFilters()).toEqual([
      'all',
      'reauth',
      'delete',
      'disable',
      'enable',
      'keep',
    ]);
  });

  it('hides repetitive reasons only for enabled healthy keep results', () => {
    expect(
      shouldShowInspectionConclusionReason(
        createResultItem('keep', { errorKind: 'inference_healthy', statusCode: 200 })
      )
    ).toBe(false);
    expect(
      shouldShowInspectionConclusionReason(
        createResultItem('keep', {
          disabled: true,
          errorKind: 'inference_healthy',
          statusCode: 200,
        })
      )
    ).toBe(true);
    expect(
      shouldShowInspectionConclusionReason(
        createResultItem('keep', { errorKind: 'protocol_changed', statusCode: 200 })
      )
    ).toBe(true);
    expect(
      shouldShowInspectionConclusionReason(
        createResultItem('keep', { errorKind: 'billing_partial', statusCode: null })
      )
    ).toBe(true);
  });

  it('counts reauth suggestions and separates handling status from action filters', () => {
    const items = [
      createResultItem('delete', { statusCode: 500 }),
      createResultItem('reauth', { statusCode: 401 }),
      createResultItem('keep', { statusCode: 401 }),
    ];

    expect(countActions(items)).toEqual({
      delete: 1,
      disable: 0,
      enable: 0,
      reauth: 1,
      http401: 2,
      keep: 1,
    });
    expect(ACTION_FILTERS).not.toContain('http_401');
    expect(normalizeActionFilter('http_401')).toBe('reauth');
    expect(countHandlingStates(items)).toEqual({
      all: 3,
      pending: 3,
      no_action: 0,
    });
    expect(filterByAction(items, 'reauth').map((item) => item.action)).toEqual(['reauth']);
    expect(filterInspectionResults(items, 'pending', 'reauth').map((item) => item.action)).toEqual([
      'reauth',
    ]);
    expect(filterByAction(items, 'keep').map((item) => item.action)).toEqual(['keep']);
  });

  it('paginates inspection results and clamps out-of-range pages', () => {
    const items = Array.from({ length: 45 }, (_, index) =>
      createResultItem('disable', {
        key: `item-${index + 1}`,
        fileName: `item-${index + 1}.json`,
      })
    );

    const secondPage = buildCodexInspectionPaginationState(items, 2, 20);
    expect(secondPage.currentPage).toBe(2);
    expect(secondPage.totalPages).toBe(3);
    expect(secondPage.startItem).toBe(21);
    expect(secondPage.endItem).toBe(40);
    expect(secondPage.pageItems).toHaveLength(20);
    expect(secondPage.pageItems[0].fileName).toBe('item-21.json');

    const clamped = buildCodexInspectionPaginationState(items, 99, 20);
    expect(clamped.currentPage).toBe(3);
    expect(clamped.startItem).toBe(41);
    expect(clamped.endItem).toBe(45);
    expect(clamped.pageItems).toHaveLength(5);
  });
});

describe('Server Codex inspection action presentation', () => {
  it('normalizes pending action status for server results', () => {
    expect(normalizeServerCodexInspectionActionStatus({ action: 'delete' })).toBe('pending');
    expect(normalizeServerCodexInspectionActionStatus({ action: 'keep' })).toBe('none');
    expect(
      normalizeServerCodexInspectionActionStatus({
        action: 'delete',
        actionStatus: 'needs_review',
      })
    ).toBe('needs_review');
    expect(isActionableServerCodexInspectionResult({ id: 1, action: 'disable' })).toBe(true);
    expect(
      isActionableServerCodexInspectionResult({
        id: 2,
        action: 'disable',
        actionStatus: 'success',
      })
    ).toBe(false);
    expect(
      isActionableServerCodexInspectionResult({
        id: 3,
        action: 'delete',
        actionStatus: 'needs_review',
      })
    ).toBe(false);
  });

  it('exposes only the first file-level server action as executable', () => {
    const canonicalIds = getCanonicalServerCodexInspectionActionIds([
      { id: 1, fileName: 'auth-a.json', action: 'delete', actionStatus: 'success' },
      { id: 2, fileName: 'auth-a.json', action: 'delete', actionStatus: 'pending' },
      { id: 3, fileName: 'auth-b.json', action: 'disable', actionStatus: 'failed' },
      { id: 4, fileName: 'auth-c.json', action: 'reauth' },
    ]);

    expect(Array.from(canonicalIds)).toEqual([3]);
  });

  it('suppresses file-level server actions when same-file suggestions conflict', () => {
    const results = [
      { id: 1, fileName: 'auth-a.json', action: 'enable', actionStatus: 'pending' },
      { id: 2, fileName: 'auth-a.json', action: 'delete', actionStatus: 'pending' },
    ];
    const canonicalIds = getCanonicalServerCodexInspectionActionIds(results);
    const mixedIds = getMixedServerCodexInspectionActionIds(results);

    expect(Array.from(canonicalIds)).toEqual([]);
    expect(Array.from(mixedIds)).toEqual([1, 2]);
  });

  it('keeps one canonical action per same-action file group', () => {
    const canonicalIds = getCanonicalServerCodexInspectionActionIds([
      { id: 1, fileName: 'auth-a.json', action: 'delete', actionStatus: 'pending' },
      { id: 2, fileName: 'auth-a.json', action: 'delete', actionStatus: 'pending' },
    ]);

    expect(Array.from(canonicalIds)).toEqual([1]);
  });

  it('keeps canonical actions for different files independently', () => {
    const canonicalIds = getCanonicalServerCodexInspectionActionIds([
      { id: 1, fileName: 'auth-a.json', action: 'delete', actionStatus: 'pending' },
      { id: 2, fileName: 'auth-b.json', action: 'enable', actionStatus: 'failed' },
      { id: 3, fileName: 'auth-c.json', action: 'disable', actionStatus: 'needs_review' },
    ]);

    expect(Array.from(canonicalIds)).toEqual([1, 2]);
  });

  it('hides completed server reauth deletion from pending actions', () => {
    expect(isPendingServerReauthResult({ action: 'reauth' })).toBe(true);
    expect(
      isPendingServerReauthResult({
        action: 'reauth',
        actionStatus: 'failed',
      })
    ).toBe(true);
    expect(
      isPendingServerReauthResult({
        action: 'reauth',
        actionStatus: 'success',
        executedAction: 'delete',
      })
    ).toBe(false);
    expect(
      isPendingServerReauthResult({
        action: 'reauth',
        actionStatus: 'skipped',
      })
    ).toBe(false);
  });

  it('marks only terminal server actions as handled while keeping review work pending', () => {
    expect(isHandledServerCodexInspectionResult({ action: 'disable' })).toBe(false);
    expect(
      isHandledServerCodexInspectionResult({ action: 'disable', actionStatus: 'failed' })
    ).toBe(false);
    expect(
      isHandledServerCodexInspectionResult({ action: 'disable', actionStatus: 'success' })
    ).toBe(true);
    expect(
      isHandledServerCodexInspectionResult({ action: 'delete', actionStatus: 'skipped' })
    ).toBe(true);
    expect(
      isHandledServerCodexInspectionResult({ action: 'enable', actionStatus: 'needs_review' })
    ).toBe(false);
    expect(
      isHandledServerCodexInspectionResult({ action: 'reauth', executedAction: 'delete' })
    ).toBe(true);

    const resultItems = [
      createResultItem('disable', {
        key: 'pending',
        actionHandled: isHandledServerCodexInspectionResult({ action: 'disable' }),
      }),
      createResultItem('disable', {
        key: 'success',
        actionHandled: isHandledServerCodexInspectionResult({
          action: 'disable',
          actionStatus: 'success',
        }),
      }),
      createResultItem('delete', {
        key: 'review',
        actionHandled: isHandledServerCodexInspectionResult({
          action: 'delete',
          actionStatus: 'needs_review',
        }),
      }),
    ];
    expect(countHandlingStates(resultItems)).toEqual({ all: 3, pending: 2, no_action: 1 });
    expect(filterInspectionResults(resultItems, 'pending', 'all').map((item) => item.key)).toEqual([
      'pending',
      'review',
    ]);
  });
});

describe('executeCodexInspectionActions', () => {
  it('deletes reauth accounts only after explicit delete mapping', async () => {
    const logs: Array<{
      level: string;
      message: string;
      detail?: Record<string, unknown>;
    }> = [];
    const deleteSpy = vi.spyOn(authFilesApi, 'deleteFileByName').mockResolvedValue({
      status: 'ok',
      deleted: 1,
      files: ['reauth.json'],
      failed: [],
    });
    vi.spyOn(authFilesApi, 'list')
      .mockResolvedValueOnce({
        files: [
          {
            name: 'reauth.json',
            type: 'xai',
            auth_index: '1',
          } as AuthFileItem,
        ],
      })
      .mockResolvedValueOnce({ files: [] });

    const execution = await executeCodexInspectionActions({
      settings: createRunResult().settings,
      items: [
        toReauthDeleteExecutionItem(
          createResultItem('reauth', {
            fileName: 'reauth.json',
            statusCode: 401,
            provider: 'xai',
            accountId: '',
          })
        ),
      ],
      previousFiles: [],
      connectionFingerprint: 'scope-test',
      source: 'manual',
      onLog: (level, message, detail) => logs.push({ level, message, detail }),
      t: translateEn,
    });

    expect(deleteSpy).toHaveBeenCalledWith('reauth.json');
    expect(execution.outcomes).toEqual([
      {
        accountKey: 'reauth.json::1',
        action: 'delete',
        fileName: 'reauth.json',
        displayAccount: 'reauth@example.com',
        status: 'success',
        success: true,
        error: '',
      },
    ]);
    expect(logs.some((entry) => entry.message.includes('Delete'))).toBe(true);
    expect(logs.every((entry) => !entry.message.includes(' delete '))).toBe(true);
    expect(logs[0]).toMatchObject({
      level: 'info',
      detail: { requestedCount: 1, actionCount: 1 },
    });
    expect(logs).toContainEqual(
      expect.objectContaining({
        level: 'success',
        detail: expect.objectContaining({
          fileName: 'reauth.json',
          displayAccount: 'reauth@example.com',
          action: 'delete',
          status: 'success',
          success: true,
        }),
      })
    );
    expect(logs[logs.length - 1]).toMatchObject({
      level: 'success',
      detail: {
        successCount: 1,
        failedCount: 0,
        skippedCount: 0,
        needsReviewCount: 0,
      },
    });
    expect(logs.some((entry) => typeof entry.detail?.count === 'number')).toBe(false);
  });

  it('rejects deletion when the current auth file belongs to another provider', async () => {
    const deleteSpy = vi.spyOn(authFilesApi, 'deleteFileByName').mockResolvedValue({
      status: 'ok',
      deleted: 1,
      files: ['reauth.json'],
      failed: [],
    });
    vi.spyOn(authFilesApi, 'list')
      .mockResolvedValueOnce({
        files: [
          {
            name: 'reauth.json',
            type: 'codex',
            auth_index: '1',
          } as AuthFileItem,
        ],
      })
      .mockResolvedValueOnce({ files: [] });

    const execution = await executeCodexInspectionActions({
      settings: createRunResult().settings,
      items: [
        toReauthDeleteExecutionItem(
          createResultItem('reauth', {
            fileName: 'reauth.json',
            provider: 'xai',
            authIndex: '1',
            accountId: null,
          })
        ),
      ],
      previousFiles: [],
      connectionFingerprint: 'scope-test',
      source: 'manual',
    });

    expect(deleteSpy).not.toHaveBeenCalled();
    expect(execution.outcomes).toEqual([
      expect.objectContaining({
        action: 'delete',
        fileName: 'reauth.json',
        success: false,
      }),
    ]);
  });

  it('treats an unconfirmed delete response as a failed action', async () => {
    const deleteSpy = vi.spyOn(authFilesApi, 'deleteFileByName').mockResolvedValue({
      status: 'ok',
      deleted: 0,
      files: [],
      failed: [],
    });
    vi.spyOn(authFilesApi, 'list')
      .mockResolvedValueOnce({
        files: [{ name: 'reauth.json', type: 'xai', auth_index: '1' } as AuthFileItem],
      })
      .mockResolvedValueOnce({ files: [] });

    const execution = await executeCodexInspectionActions({
      settings: createRunResult().settings,
      items: [
        toReauthDeleteExecutionItem(
          createResultItem('reauth', { fileName: 'reauth.json', provider: 'xai', accountId: '' })
        ),
      ],
      previousFiles: [],
      connectionFingerprint: 'scope-test',
      source: 'manual',
    });

    expect(deleteSpy).toHaveBeenCalledWith('reauth.json');
    expect(execution.outcomes).toEqual([
      expect.objectContaining({ success: false, error: '删除接口未确认认证文件已删除' }),
    ]);
  });

  it('rejects deletion when current auth files cannot be refreshed', async () => {
    const logs: Array<{
      level: string;
      message: string;
      detail?: Record<string, unknown>;
    }> = [];
    const deleteSpy = vi.spyOn(authFilesApi, 'deleteFileByName').mockResolvedValue({
      status: 'ok',
      deleted: 1,
      files: ['reauth.json'],
      failed: [],
    });
    vi.spyOn(authFilesApi, 'list')
      .mockRejectedValueOnce(new Error('refresh failed'))
      .mockResolvedValueOnce({ files: [] });

    const execution = await executeCodexInspectionActions({
      settings: createRunResult().settings,
      items: [
        toReauthDeleteExecutionItem(
          createResultItem('reauth', {
            fileName: 'reauth.json',
            provider: 'xai',
            accountId: '',
          })
        ),
      ],
      previousFiles: [],
      connectionFingerprint: 'scope-test',
      source: 'manual',
      onLog: (level, message, detail) => logs.push({ level, message, detail }),
      t: translateEn,
    });

    expect(deleteSpy).not.toHaveBeenCalled();
    expect(execution.outcomes[0]).toMatchObject({
      action: 'delete',
      success: false,
      error: expect.stringContaining('刷新认证文件失败，已拒绝执行'),
    });
    expect(logs[logs.length - 1]).toMatchObject({
      level: 'warning',
      detail: {
        successCount: 0,
        failedCount: 1,
        skippedCount: 0,
        needsReviewCount: 0,
      },
    });
  });

  it('rejects deletion when the current auth identity changed', async () => {
    const deleteSpy = vi.spyOn(authFilesApi, 'deleteFileByName').mockResolvedValue({
      status: 'ok',
      deleted: 1,
      files: ['reauth.json'],
      failed: [],
    });
    vi.spyOn(authFilesApi, 'list')
      .mockResolvedValueOnce({
        files: [
          {
            name: 'reauth.json',
            type: 'xai',
            auth_index: 'replacement',
          } as AuthFileItem,
        ],
      })
      .mockResolvedValueOnce({ files: [] });

    const execution = await executeCodexInspectionActions({
      settings: createRunResult().settings,
      items: [
        toReauthDeleteExecutionItem(
          createResultItem('reauth', {
            fileName: 'reauth.json',
            provider: 'xai',
            authIndex: 'original',
            accountId: null,
          })
        ),
      ],
      previousFiles: [],
      connectionFingerprint: 'scope-test',
      source: 'manual',
    });

    expect(deleteSpy).not.toHaveBeenCalled();
    expect(execution.outcomes[0]).toMatchObject({ success: false, action: 'delete' });
  });

  it('rejects disable and enable when the current auth identities changed', async () => {
    const statusSpy = vi
      .spyOn(authFilesApi, 'setStatusWithFallback')
      .mockResolvedValue({} as Awaited<ReturnType<typeof authFilesApi.setStatusWithFallback>>);
    const disableItem = createResultItem('disable', {
      fileName: 'disable.json',
      authIndex: 'disable-original',
      accountId: 'disable-account',
    });
    const enableItem = createResultItem('enable', {
      fileName: 'enable.json',
      authIndex: 'enable-original',
      accountId: 'enable-account',
      disabled: true,
    });
    const listSpy = vi.spyOn(authFilesApi, 'list').mockResolvedValueOnce({
      files: [
        createCurrentAuthFile(disableItem, { auth_index: 'disable-replacement' }),
        createCurrentAuthFile(enableItem, { auth_index: 'enable-replacement' }),
      ],
    });

    const execution = await executeCodexInspectionActions({
      settings: createRunResult().settings,
      items: [disableItem, enableItem],
      previousFiles: [],
      connectionFingerprint: 'scope-test',
      source: 'manual',
    });

    expect(statusSpy).not.toHaveBeenCalled();
    expect(listSpy).toHaveBeenCalledTimes(1);
    expect(execution.outcomes).toEqual([
      expect.objectContaining({ action: 'disable', status: 'failed', success: false }),
      expect.objectContaining({ action: 'enable', status: 'failed', success: false }),
    ]);
  });

  it('rejects every file action when the validation refresh fails', async () => {
    const statusSpy = vi
      .spyOn(authFilesApi, 'setStatusWithFallback')
      .mockResolvedValue({} as Awaited<ReturnType<typeof authFilesApi.setStatusWithFallback>>);
    const deleteSpy = vi.spyOn(authFilesApi, 'deleteFileByName').mockResolvedValue({
      status: 'ok',
      deleted: 1,
      files: ['delete.json'],
      failed: [],
    });
    const listSpy = vi
      .spyOn(authFilesApi, 'list')
      .mockRejectedValueOnce(new Error('validation unavailable'));

    const execution = await executeCodexInspectionActions({
      settings: createRunResult().settings,
      items: [
        createResultItem('delete', { fileName: 'delete.json' }),
        createResultItem('disable', { fileName: 'disable.json' }),
        createResultItem('enable', { fileName: 'enable.json', disabled: true }),
      ],
      previousFiles: [],
      connectionFingerprint: 'scope-test',
      source: 'manual',
    });

    expect(deleteSpy).not.toHaveBeenCalled();
    expect(statusSpy).not.toHaveBeenCalled();
    expect(listSpy).toHaveBeenCalledTimes(1);
    expect(execution.outcomes).toHaveLength(3);
    expect(execution.outcomes.every((outcome) => outcome.status === 'failed')).toBe(true);
  });

  it('skips status actions that already match the requested state', async () => {
    const logs: Array<{
      level: string;
      message: string;
      detail?: Record<string, unknown>;
    }> = [];
    const statusSpy = vi
      .spyOn(authFilesApi, 'setStatusWithFallback')
      .mockResolvedValue({} as Awaited<ReturnType<typeof authFilesApi.setStatusWithFallback>>);
    const disableItem = createResultItem('disable', { fileName: 'disabled.json' });
    const enableItem = createResultItem('enable', {
      fileName: 'enabled.json',
      disabled: true,
    });
    const listSpy = vi.spyOn(authFilesApi, 'list').mockResolvedValueOnce({
      files: [
        createCurrentAuthFile(disableItem, { disabled: true }),
        createCurrentAuthFile(enableItem, { disabled: false }),
      ],
    });

    const execution = await executeCodexInspectionActions({
      settings: createRunResult().settings,
      items: [disableItem, enableItem],
      previousFiles: [],
      connectionFingerprint: 'scope-test',
      source: 'manual',
      onLog: (level, message, detail) => logs.push({ level, message, detail }),
      t: translateEn,
    });

    expect(statusSpy).not.toHaveBeenCalled();
    expect(listSpy).toHaveBeenCalledTimes(1);
    expect(execution.outcomes).toEqual([
      expect.objectContaining({ action: 'disable', status: 'skipped', success: true }),
      expect.objectContaining({ action: 'enable', status: 'skipped', success: true }),
    ]);
    expect(logs[logs.length - 1]).toMatchObject({
      level: 'success',
      detail: {
        successCount: 0,
        failedCount: 0,
        skippedCount: 2,
        needsReviewCount: 0,
        refreshFailed: false,
      },
    });
  });

  it('uses action concurrency for disable and enable operations', async () => {
    let activeStatusUpdates = 0;
    let maxStatusUpdates = 0;

    vi.spyOn(authFilesApi, 'setStatusWithFallback').mockImplementation(async () => {
      activeStatusUpdates += 1;
      maxStatusUpdates = Math.max(maxStatusUpdates, activeStatusUpdates);
      await new Promise((resolve) => {
        setTimeout(resolve, 5);
      });
      activeStatusUpdates -= 1;
      return {} as Awaited<ReturnType<typeof authFilesApi.setStatusWithFallback>>;
    });
    const items = [
      createResultItem('disable', { fileName: 'disable-a.json' }),
      createResultItem('disable', { fileName: 'disable-b.json' }),
      createResultItem('enable', { fileName: 'enable-a.json', disabled: true }),
    ];
    const listSpy = vi
      .spyOn(authFilesApi, 'list')
      .mockResolvedValueOnce({ files: items.map((item) => createCurrentAuthFile(item)) })
      .mockResolvedValueOnce({ files: [] });

    const execution = await executeCodexInspectionActions({
      settings: {
        ...createRunResult().settings,
        workers: 10,
        deleteWorkers: 1,
      },
      items,
      previousFiles: [],
      connectionFingerprint: 'scope-test',
      source: 'manual',
    });

    expect(execution.outcomes).toHaveLength(3);
    expect(maxStatusUpdates).toBe(1);
    expect(listSpy).toHaveBeenCalledTimes(2);
  });

  it('blocks mixed same-file manual actions and records them as needing review', async () => {
    const logs: Array<{
      level: string;
      message: string;
      detail?: Record<string, unknown>;
    }> = [];
    const statusSpy = vi
      .spyOn(authFilesApi, 'setStatusWithFallback')
      .mockResolvedValue({} as Awaited<ReturnType<typeof authFilesApi.setStatusWithFallback>>);
    const deleteSpy = vi.spyOn(authFilesApi, 'deleteFileByName').mockResolvedValue({
      status: 'ok',
      deleted: 1,
      files: ['mixed.json'],
      failed: [],
    });
    const items = [
      createResultItem('disable', {
        fileName: 'mixed.json',
        displayAccount: 'first@example.com',
      }),
      createResultItem('delete', {
        fileName: 'mixed.json',
        displayAccount: 'second@example.com',
      }),
    ];
    vi.spyOn(authFilesApi, 'list')
      .mockResolvedValueOnce({ files: [createCurrentAuthFile(items[0])] })
      .mockResolvedValueOnce({ files: [] });
    const execution = await executeCodexInspectionActions({
      settings: createRunResult().settings,
      items,
      previousFiles: [],
      connectionFingerprint: 'scope-test',
      source: 'manual',
      onLog: (level, message, detail) => logs.push({ level, message, detail }),
      t: translateEn,
    });

    expect(statusSpy).not.toHaveBeenCalled();
    expect(deleteSpy).not.toHaveBeenCalled();
    expect(execution.outcomes).toEqual([
      expect.objectContaining({ status: 'needs_review', action: 'disable', success: true }),
      expect.objectContaining({ status: 'needs_review', action: 'delete', success: true }),
    ]);
    expect(logs.filter((entry) => entry.detail?.status === 'needs_review')).toHaveLength(2);
    expect(logs[logs.length - 1]).toMatchObject({
      level: 'warning',
      detail: expect.objectContaining({ needsReviewCount: 2, successCount: 0 }),
    });
    const previousResult = createRunResult();
    const applied = applyCodexInspectionExecutionResult(
      {
        ...previousResult,
        results: items,
      },
      execution
    );
    expect(applied.results.every((item) => item.actionHandled === true)).toBe(true);
    expect(countHandlingStates(applied.results).pending).toBe(0);
  });

  it('blocks a selected reauth deletion when the full result set has a conflicting file action', async () => {
    const statusSpy = vi
      .spyOn(authFilesApi, 'setStatusWithFallback')
      .mockResolvedValue({} as Awaited<ReturnType<typeof authFilesApi.setStatusWithFallback>>);
    const deleteSpy = vi.spyOn(authFilesApi, 'deleteFileByName').mockResolvedValue({
      status: 'ok',
      deleted: 1,
      files: ['mixed.json'],
      failed: [],
    });
    vi.spyOn(authFilesApi, 'list').mockResolvedValue({ files: [] });

    const reauthItem = createResultItem('reauth', {
      key: 'mixed.json::reauth',
      fileName: 'mixed.json',
      displayAccount: 'reauth@example.com',
    });
    const conflictingItem = createResultItem('disable', {
      key: 'mixed.json::disable',
      fileName: 'mixed.json',
      displayAccount: 'disable@example.com',
    });
    const execution = await executeCodexInspectionActions({
      settings: createRunResult().settings,
      items: [toReauthDeleteExecutionItem(reauthItem)],
      referenceItems: [reauthItem, conflictingItem],
      previousFiles: [],
      connectionFingerprint: 'scope-test',
      source: 'manual',
    });

    expect(statusSpy).not.toHaveBeenCalled();
    expect(deleteSpy).not.toHaveBeenCalled();
    expect(execution.outcomes).toEqual([
      expect.objectContaining({
        accountKey: 'mixed.json::reauth',
        action: 'delete',
        status: 'needs_review',
        success: true,
      }),
    ]);

    const applied = applyCodexInspectionExecutionResult(
      {
        ...createRunResult(),
        results: [reauthItem],
      },
      execution
    );
    expect(applied.results[0]).toMatchObject({
      key: 'mixed.json::reauth',
      actionHandled: true,
    });
    expect(countHandlingStates(applied.results).pending).toBe(0);
  });

  it('executes one canonical same-file action and logs duplicate results as skipped', async () => {
    const statusSpy = vi
      .spyOn(authFilesApi, 'setStatusWithFallback')
      .mockResolvedValue({} as Awaited<ReturnType<typeof authFilesApi.setStatusWithFallback>>);
    const items = [
      createResultItem('disable', {
        key: 'shared.json::first',
        fileName: 'shared.json',
        displayAccount: 'first@example.com',
      }),
      createResultItem('disable', {
        key: 'shared.json::second',
        fileName: 'shared.json',
        displayAccount: 'second@example.com',
      }),
    ];
    vi.spyOn(authFilesApi, 'list')
      .mockResolvedValueOnce({ files: [createCurrentAuthFile(items[0])] })
      .mockResolvedValueOnce({ files: [] });
    const execution = await executeCodexInspectionActions({
      settings: createRunResult().settings,
      items,
      previousFiles: [],
      connectionFingerprint: 'scope-test',
      source: 'manual',
      t: translateEn,
    });

    expect(statusSpy).toHaveBeenCalledTimes(1);
    expect(execution.outcomes.map((outcome) => outcome.status).sort()).toEqual([
      'skipped',
      'success',
    ]);
    expect(execution.outcomes.map((outcome) => outcome.accountKey).sort()).toEqual([
      'shared.json::first',
      'shared.json::second',
    ]);
    const previousResult = createRunResult();
    const applied = applyCodexInspectionExecutionResult(
      {
        ...previousResult,
        results: items,
      },
      execution
    );
    expect(applied.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'shared.json::first', action: 'keep' }),
        expect.objectContaining({
          key: 'shared.json::second',
          action: 'disable',
          actionHandled: true,
        }),
      ])
    );
    expect(countHandlingStates(applied.results).pending).toBe(0);
  });

  it('skips a non-canonical same-file item when it is selected alone', async () => {
    const statusSpy = vi
      .spyOn(authFilesApi, 'setStatusWithFallback')
      .mockResolvedValue({} as Awaited<ReturnType<typeof authFilesApi.setStatusWithFallback>>);
    const deleteSpy = vi.spyOn(authFilesApi, 'deleteFileByName').mockResolvedValue({
      status: 'ok',
      deleted: 1,
      files: ['shared.json'],
      failed: [],
    });
    vi.spyOn(authFilesApi, 'list').mockResolvedValue({ files: [] });

    const canonicalItem = createResultItem('disable', {
      key: 'shared.json::first',
      fileName: 'shared.json',
      displayAccount: 'first@example.com',
    });
    const duplicateItem = createResultItem('disable', {
      key: 'shared.json::second',
      fileName: 'shared.json',
      displayAccount: 'second@example.com',
    });
    const execution = await executeCodexInspectionActions({
      settings: createRunResult().settings,
      items: [duplicateItem],
      referenceItems: [canonicalItem, duplicateItem],
      previousFiles: [],
      connectionFingerprint: 'scope-test',
      source: 'manual',
    });

    expect(statusSpy).not.toHaveBeenCalled();
    expect(deleteSpy).not.toHaveBeenCalled();
    expect(execution.outcomes).toEqual([
      expect.objectContaining({
        accountKey: 'shared.json::second',
        action: 'disable',
        status: 'skipped',
        success: true,
      }),
    ]);

    const applied = applyCodexInspectionExecutionResult(
      {
        ...createRunResult(),
        results: [canonicalItem, duplicateItem],
      },
      execution
    );
    expect(applied.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'shared.json::first', actionHandled: false }),
        expect.objectContaining({ key: 'shared.json::second', actionHandled: true }),
      ])
    );
    expect(countHandlingStates(applied.results).pending).toBe(1);
  });

  it('preserves same-action grouping when automatic disable maps delete to disable', async () => {
    const statusSpy = vi
      .spyOn(authFilesApi, 'setStatusWithFallback')
      .mockResolvedValue({} as Awaited<ReturnType<typeof authFilesApi.setStatusWithFallback>>);
    const deleteSpy = vi.spyOn(authFilesApi, 'deleteFileByName').mockResolvedValue({
      status: 'ok',
      deleted: 1,
      files: ['shared.json'],
      failed: [],
    });
    const referenceItems = [
      createResultItem('delete', {
        key: 'shared.json::first',
        fileName: 'shared.json',
      }),
      createResultItem('delete', {
        key: 'shared.json::second',
        fileName: 'shared.json',
      }),
    ];
    vi.spyOn(authFilesApi, 'list')
      .mockResolvedValueOnce({ files: [createCurrentAuthFile(referenceItems[0])] })
      .mockResolvedValueOnce({ files: [] });
    const autoPlan = resolveCodexInspectionAutoActionPlan('disable', false, referenceItems);
    const execution = await executeCodexInspectionActions({
      settings: createRunResult().settings,
      items: autoPlan.items,
      referenceItems,
      previousFiles: [],
      connectionFingerprint: 'scope-test',
      source: 'auto',
      preflightOutcomes: autoPlan.preflightOutcomes,
    });

    expect(statusSpy).toHaveBeenCalledTimes(1);
    expect(statusSpy).toHaveBeenCalledWith('shared.json', true);
    expect(deleteSpy).not.toHaveBeenCalled();
    expect(execution.outcomes.map((outcome) => outcome.status).sort()).toEqual([
      'skipped',
      'success',
    ]);
  });

  it('completes manual actions with a warning when the post-action refresh fails', async () => {
    const logs: Array<{
      level: string;
      message: string;
      detail?: Record<string, unknown>;
    }> = [];
    vi.spyOn(authFilesApi, 'setStatusWithFallback').mockResolvedValue(
      {} as Awaited<ReturnType<typeof authFilesApi.setStatusWithFallback>>
    );
    const item = createResultItem('disable', { fileName: 'disable.json' });
    vi.spyOn(authFilesApi, 'list')
      .mockResolvedValueOnce({ files: [createCurrentAuthFile(item)] })
      .mockRejectedValueOnce(new Error('refresh unavailable'));

    const execution = await executeCodexInspectionActions({
      settings: createRunResult().settings,
      items: [item],
      previousFiles: [],
      connectionFingerprint: 'scope-test',
      source: 'manual',
      onLog: (level, message, detail) => logs.push({ level, message, detail }),
      t: translateEn,
    });

    expect(execution.outcomes).toEqual([
      expect.objectContaining({ action: 'disable', success: true }),
    ]);
    expect(execution.refreshError).toBe('refresh unavailable');
    expect(logs[logs.length - 1]).toMatchObject({
      level: 'warning',
      detail: {
        successCount: 1,
        failedCount: 0,
        skippedCount: 0,
        needsReviewCount: 0,
        refreshFailed: true,
        refreshError: 'refresh unavailable',
      },
    });
  });

  it('records ownership for automatic disables and clears it after manual recovery', async () => {
    const storage = createStorage();
    vi.stubGlobal('localStorage', storage);
    vi.spyOn(authFilesApi, 'setStatusWithFallback').mockResolvedValue(
      {} as Awaited<ReturnType<typeof authFilesApi.setStatusWithFallback>>
    );
    const scope = 'scope-auto-recovery';
    const enableItem = {
      ...createResultItem('enable', {
        fileName: 'owned.json',
        authIndex: 'auth-1',
        disabled: true,
        autoRecoverEligible: true,
      }),
      accountId: null,
    };
    const disabledFile = {
      name: 'owned.json',
      type: 'codex',
      auth_index: 'auth-1',
      disabled: true,
    } as AuthFileItem;
    vi.spyOn(authFilesApi, 'list')
      .mockResolvedValueOnce({
        files: [
          createCurrentAuthFile(
            {
              ...createResultItem('disable', {
                fileName: 'owned.json',
                authIndex: 'auth-1',
              }),
              accountId: null,
            },
            { disabled: false }
          ),
        ],
      })
      .mockResolvedValueOnce({ files: [disabledFile] })
      .mockResolvedValueOnce({ files: [createCurrentAuthFile(enableItem, { disabled: true })] })
      .mockResolvedValueOnce({
        files: [createCurrentAuthFile(enableItem, { disabled: false })],
      });

    await executeCodexInspectionActions({
      settings: createRunResult().settings,
      items: [
        {
          ...createResultItem('disable', {
            fileName: 'owned.json',
            authIndex: 'auth-1',
          }),
          accountId: null,
        },
      ],
      previousFiles: [],
      connectionFingerprint: scope,
      source: 'auto',
    });
    expect(Array.from(getCodexInspectionOwnedDisableFileNames(scope, [disabledFile]))).toEqual([
      'owned.json',
    ]);

    await executeCodexInspectionActions({
      settings: createRunResult().settings,
      items: [enableItem],
      previousFiles: [],
      connectionFingerprint: scope,
      source: 'manual',
    });
    expect(getCodexInspectionOwnedDisableFileNames(scope, [disabledFile]).size).toBe(0);
  });
});

describe('Codex inspection disable ownership', () => {
  it('isolates records by connection fingerprint and invalidates identity changes', () => {
    const storage = createStorage();
    vi.stubGlobal('localStorage', storage);
    const file = {
      name: 'owned.json',
      type: 'codex',
      auth_index: 'auth-1',
      disabled: true,
    } as AuthFileItem;

    recordCodexInspectionDisableOwnership('scope-a', {
      fileName: 'owned.json',
      provider: 'codex',
      authIndex: 'auth-1',
      accountId: null,
    });

    expect(Array.from(getCodexInspectionOwnedDisableFileNames('scope-a', [file]))).toEqual([
      'owned.json',
    ]);
    expect(getCodexInspectionOwnedDisableFileNames('scope-b', [file]).size).toBe(0);
    expect(
      getCodexInspectionOwnedDisableFileNames('scope-a', [
        { ...file, auth_index: 'auth-2' } as AuthFileItem,
      ]).size
    ).toBe(0);
    expect(getCodexInspectionOwnedDisableFileNames('scope-a', [file]).size).toBe(0);
  });

  it('does not transfer local disable ownership across providers', () => {
    const storage = createStorage();
    vi.stubGlobal('localStorage', storage);
    recordCodexInspectionDisableOwnership('scope-provider', {
      fileName: 'shared.json',
      provider: 'codex',
      authIndex: 'shared-auth',
      accountId: null,
    });

    const xaiFile = {
      name: 'shared.json',
      type: 'xai',
      auth_index: 'shared-auth',
      disabled: true,
    } as AuthFileItem;
    expect(getCodexInspectionOwnedDisableFileNames('scope-provider', [xaiFile]).size).toBe(0);
  });

  it('treats legacy ownership records without provider as Codex', () => {
    const storage = createStorage();
    storage.setItem(
      'cli-proxy-codex-inspection-disable-ownership-v1',
      JSON.stringify({
        'scope-legacy': {
          'legacy.json': {
            fileName: 'legacy.json',
            authIndex: 'legacy-auth',
            accountId: null,
            disabledAtMs: 1,
          },
        },
      })
    );
    vi.stubGlobal('localStorage', storage);

    const codexFile = {
      name: 'legacy.json',
      type: 'codex',
      auth_index: 'legacy-auth',
      disabled: true,
    } as AuthFileItem;
    expect(
      Array.from(getCodexInspectionOwnedDisableFileNames('scope-legacy', [codexFile]))
    ).toEqual(['legacy.json']);
  });
});

describe('Codex inspection last-run cache', () => {
  it('creates stable connection fingerprints without storing raw inputs', () => {
    const fingerprint = createCodexInspectionConnectionFingerprint(
      'https://cpa.example.test/',
      'management-secret-token'
    );

    expect(fingerprint).toBe(
      createCodexInspectionConnectionFingerprint(
        'https://cpa.example.test',
        'management-secret-token'
      )
    );
    expect(fingerprint).not.toContain('management-secret-token');
    expect(fingerprint).not.toContain('cpa.example.test');
    expect(fingerprint).not.toBe(
      createCodexInspectionConnectionFingerprint('https://cpa.example.test', 'other-token')
    );
  });

  it('sanitizes raw auth data before saving browser cache', () => {
    const storage = createStorage();
    vi.stubGlobal('localStorage', storage);

    const restored = saveCodexInspectionLastRun({
      result: createRunResult(),
      logs: [{ id: 'log-1', level: 'info', message: 'done', timestamp: 2000 }],
      logsCollapsed: true,
      actionFilter: 'delete',
    });

    const raw = storage.getItem(CODEX_INSPECTION_LAST_RUN_STORAGE_KEY);
    expect(raw).toBeTypeOf('string');
    expect(raw).not.toContain('management-secret-token');
    expect(raw).not.toContain('file-secret-token');
    expect(raw).not.toContain('raw-secret-token');
    expect(raw).not.toContain('https://secret.example.test');
    expect(restored?.result.files).toEqual([]);
    expect(restored?.result.results[0].raw).toEqual({
      name: 'delete.json',
      type: 'codex',
      authIndex: '1',
      disabled: false,
    });
  });

  it('redacts secret-shaped fields in structured and stringified cached details', () => {
    const storage = createStorage();
    vi.stubGlobal('localStorage', storage);

    const restored = saveCodexInspectionLastRun({
      result: {
        ...createRunResult(),
        results: [
          createResultItem('keep', {
            errorDetail: '{"refresh_token":"raw-refresh-token","error":"missing status"}',
          }),
        ],
      },
      logs: [
        {
          id: 'log-detail',
          level: 'warning',
          message: 'detail test',
          timestamp: 2000,
          detail: {
            fileName: 'xai.json',
            action: 'disable',
            triggerKey: 'interval:45m',
            accessToken: 'raw-access-token',
            nested: { apiKey: 'raw-api-key', statusCode: 402 },
            body: '{"access_token":"raw-body-token","message":"missing status"}',
          },
        },
      ],
    });

    const raw = storage.getItem(CODEX_INSPECTION_LAST_RUN_STORAGE_KEY);
    expect(raw).not.toContain('raw-access-token');
    expect(raw).not.toContain('raw-api-key');
    expect(raw).not.toContain('raw-body-token');
    expect(raw).not.toContain('raw-refresh-token');
    expect(restored?.logs[0].detail).toEqual({
      fileName: 'xai.json',
      action: 'disable',
      triggerKey: 'interval:45m',
      accessToken: '[redacted]',
      nested: { apiKey: '[redacted]', statusCode: 402 },
      body: '{"access_token":"[redacted]","message":"missing status"}',
    });
    expect(restored?.result.results[0].errorDetail).toBe(
      '{"refresh_token":"[redacted]","error":"missing status"}'
    );
  });

  it('scrubs stringified JSON secrets from legacy cached records on load', () => {
    const storage = createStorage();
    vi.stubGlobal('localStorage', storage);
    saveCodexInspectionLastRun({
      result: createRunResult(),
      logs: [{ id: 'legacy-log', level: 'warning', message: 'detail test', timestamp: 2000 }],
    });
    const payload = JSON.parse(storage.getItem(CODEX_INSPECTION_LAST_RUN_STORAGE_KEY) ?? '{}');
    payload.result.results[0].errorDetail =
      '{"access_token":"legacy-result-token","error":"missing status"}';
    payload.logs[0].detail = {
      body: '{"api_key":"legacy-log-key","message":"missing status"}',
    };
    storage.setItem(CODEX_INSPECTION_LAST_RUN_STORAGE_KEY, JSON.stringify(payload));

    const restored = loadCodexInspectionLastRun();
    const raw = storage.getItem(CODEX_INSPECTION_LAST_RUN_STORAGE_KEY);

    expect(raw).not.toContain('legacy-result-token');
    expect(raw).not.toContain('legacy-log-key');
    expect(restored?.result.results[0].errorDetail).toBe(
      '{"access_token":"[redacted]","error":"missing status"}'
    );
    expect(restored?.logs[0].detail).toEqual({
      body: '{"api_key":"[redacted]","message":"missing status"}',
    });
  });

  it('ignores incompatible cached payloads', () => {
    expect(hydrateCodexInspectionLastRun({ version: 999 })).toBeNull();
  });

  it('ignores cached payloads that do not match the active connection', () => {
    const storage = createStorage();
    vi.stubGlobal('localStorage', storage);
    const expectedFingerprint = createCodexInspectionConnectionFingerprint(
      'https://cpa-a.example.test',
      'token-a'
    );
    const otherFingerprint = createCodexInspectionConnectionFingerprint(
      'https://cpa-b.example.test',
      'token-b'
    );

    saveCodexInspectionLastRun({
      result: createRunResult(),
      connectionFingerprint: expectedFingerprint,
    });

    expect(loadCodexInspectionLastRun(expectedFingerprint)?.result.results).toHaveLength(1);
    expect(loadCodexInspectionLastRun(otherFingerprint)).toBeNull();
  });

  it('does not restore legacy cached payloads when an active connection is provided', () => {
    const restored = hydrateCodexInspectionLastRun(
      {
        version: 1,
        savedAt: 2000,
        result: {
          settings: createRunResult().settings,
          results: [createResultItem('delete')],
          summary: createRunResult().summary,
          startedAt: 1000,
          finishedAt: 2000,
        },
        logs: [],
      },
      { expectedConnectionFingerprint: 'v1:active-connection' }
    );

    expect(restored).toBeNull();
  });

  it('restores completed runs that have no result rows', () => {
    const restored = hydrateCodexInspectionLastRun({
      version: 1,
      savedAt: 2000,
      result: {
        settings: {
          targetType: 'codex',
          workers: 2,
          deleteWorkers: 1,
          timeout: 1000,
          retries: 0,
          userAgent: 'test-agent',
          usedPercentThreshold: 90,
          sampleSize: 0,
        },
        results: [],
        summary: {
          totalFiles: 0,
          probeSetCount: 0,
          sampledCount: 0,
          sampled: false,
          usedPercentThreshold: 90,
        },
        startedAt: 1000,
        finishedAt: 2000,
      },
      logs: [],
    });

    expect(restored?.result.results).toEqual([]);
    expect(restored?.result.summary.sampledCount).toBe(0);
  });

  it('stores and restores quota windows and error details', () => {
    const storage = createStorage();
    vi.stubGlobal('localStorage', storage);
    const baseResult = createRunResult();
    const resultWithQuota: CodexInspectionRunResult = {
      ...baseResult,
      results: [
        createResultItem('disable', {
          statusCode: 402,
          usedPercent: 87,
          isQuota: true,
          planType: 'team',
          quotaWindows: [
            {
              id: 'monthly',
              labelKey: 'codex_quota.monthly_window',
              usedPercent: 87,
              resetLabel: '06/18 12:00',
              limitWindowSeconds: 2_592_000,
            },
          ],
          error: 'HTTP 402',
          errorKind: 'http_status',
          errorDetail: '{"message":"limit reached"}',
        }),
      ],
    };

    saveCodexInspectionLastRun({ result: resultWithQuota });

    const loaded = loadCodexInspectionLastRun();
    expect(loaded?.result.results[0].planType).toBe('team');
    expect(loaded?.result.results[0].quotaWindows).toEqual([
      {
        id: 'monthly',
        labelKey: 'codex_quota.monthly_window',
        labelParams: undefined,
        usedPercent: 87,
        resetLabel: '06/18 12:00',
        limitWindowSeconds: 2_592_000,
      },
    ]);
    expect(loaded?.result.results[0].errorKind).toBe('http_status');
    expect(loaded?.result.results[0].errorDetail).toContain('limit reached');
  });

  it('stores and restores terminal local action handling state', () => {
    const storage = createStorage();
    vi.stubGlobal('localStorage', storage);
    const baseResult = createRunResult();

    saveCodexInspectionLastRun({
      result: {
        ...baseResult,
        results: [createResultItem('disable', { actionHandled: true })],
      },
    });

    const loaded = loadCodexInspectionLastRun();
    expect(loaded?.result.results[0].actionHandled).toBe(true);
    expect(countHandlingStates(loaded?.result.results ?? []).pending).toBe(0);
  });

  it('loads sanitized last-run records from storage', () => {
    const storage = createStorage();
    vi.stubGlobal('localStorage', storage);
    saveCodexInspectionLastRun({
      result: createRunResult(),
      logs: [{ id: 'log-1', level: 'success', message: 'done', timestamp: 2000 }],
      actionFilter: 'delete',
    });

    const loaded = loadCodexInspectionLastRun();

    expect(loaded?.actionFilter).toBe('delete');
    expect(loaded?.logs).toHaveLength(1);
    expect(loaded?.result.summary.deleteCount).toBe(1);
  });

  it('restores legacy 401 filters as reauth filters', () => {
    const storage = createStorage();
    vi.stubGlobal('localStorage', storage);
    const baseResult = createRunResult();
    const reauthResult: CodexInspectionRunResult = {
      ...baseResult,
      results: [createResultItem('reauth', { statusCode: 401 })],
      summary: {
        ...baseResult.summary,
        deleteCount: 0,
        reauthCount: 1,
        plannedActionPreview: ['reauth@example.com -> reauth'],
      },
    };

    saveCodexInspectionLastRun({
      result: reauthResult,
      actionFilter: 'http_401' as never,
    });

    const loaded = loadCodexInspectionLastRun();

    expect(loaded?.actionFilter).toBe('reauth');
    expect(loaded?.result.results[0].action).toBe('reauth');
    expect(loaded?.result.summary.reauthCount).toBe(1);
  });
});
