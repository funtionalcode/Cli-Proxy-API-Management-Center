import { authFilesApi } from '@/services/api/authFiles';
import type { TFunction } from 'i18next';
import {
  type CodexInspectionExecutionOutcome,
  type CodexInspectionExecutionResult,
  type CodexInspectionLogHandler,
  type CodexInspectionResultItem,
  type CodexInspectionSettings,
} from '@/features/monitoring/codexInspection';
import type { AuthFileItem } from '@/types';
import { normalizeAuthIndex } from '@/utils/authIndex';
import { resolveAuthProvider, resolveCodexChatgptAccountId } from '@/utils/quota';
import { clampPositiveInteger } from './codexInspectionSettings';
import {
  clearCodexInspectionDisableOwnership,
  recordCodexInspectionDisableOwnership,
} from './codexInspectionOwnership';

const identityT = ((key: string) => key) as TFunction;

const formatExecutionAction = (action: string, t: TFunction) => {
  switch (action) {
    case 'delete':
      return t('monitoring.codex_inspection_action_delete');
    case 'disable':
      return t('monitoring.codex_inspection_action_disable');
    case 'enable':
      return t('monitoring.codex_inspection_action_enable');
    default:
      return action;
  }
};

const buildExecutionOutcomeLogDetail = (outcome: CodexInspectionExecutionOutcome) => ({
  fileName: outcome.fileName,
  displayAccount: outcome.displayAccount,
  action: outcome.action,
  status: outcome.status,
  success: outcome.success,
  ...(outcome.error ? { error: outcome.error } : {}),
});

type ExecuteCodexInspectionActionsOptions = {
  settings: CodexInspectionSettings;
  items: CodexInspectionResultItem[];
  referenceItems?: CodexInspectionResultItem[];
  previousFiles: AuthFileItem[];
  connectionFingerprint: string;
  source: 'auto' | 'manual';
  preflightOutcomes?: CodexInspectionExecutionOutcome[];
  onLog?: CodexInspectionLogHandler;
  t?: TFunction;
};

const runConcurrently = async <T, R>(
  items: T[],
  limit: number,
  task: (item: T, index: number) => Promise<R>
): Promise<R[]> => {
  if (items.length === 0) return [];

  const size = clampPositiveInteger(limit, 1);
  const results = new Array<R>(items.length);
  let cursor = 0;

  const worker = async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) {
        return;
      }
      results[index] = await task(items[index], index);
    }
  };

  await Promise.all(Array.from({ length: Math.min(size, items.length) }, () => worker()));
  return results;
};

const buildPreflightOutcome = (
  item: CodexInspectionResultItem,
  status: CodexInspectionExecutionOutcome['status'],
  success: boolean,
  error: string
): CodexInspectionExecutionOutcome => ({
  accountKey: item.key,
  action: item.action as CodexInspectionExecutionOutcome['action'],
  fileName: item.fileName,
  displayAccount: item.displayAccount,
  status,
  success,
  error,
});

const isFileExecutionAction = (item: CodexInspectionResultItem) =>
  item.action === 'delete' || item.action === 'disable' || item.action === 'enable';

const mergeExecutionReferenceItems = (
  items: CodexInspectionResultItem[],
  referenceItems: CodexInspectionResultItem[]
) => {
  const selectedByKey = new Map(items.map((item) => [item.key, item] as const));
  const mergedItems = referenceItems.map((referenceItem) => {
    const selectedItem = selectedByKey.get(referenceItem.key);
    if (!selectedItem) return referenceItem;
    selectedByKey.delete(referenceItem.key);

    // Automatic disable mode maps a delete suggestion to a disable operation only at
    // execution time. Keep the original executable action for file-level conflict
    // detection, while explicit reauth deletion must replace the non-executable source.
    return isFileExecutionAction(referenceItem)
      ? { ...selectedItem, action: referenceItem.action }
      : selectedItem;
  });
  mergedItems.push(...selectedByKey.values());
  return mergedItems;
};

const planExecutionItems = (
  items: CodexInspectionResultItem[],
  referenceItems: CodexInspectionResultItem[]
) => {
  const groups = new Map<string, CodexInspectionResultItem[]>();
  const preflightOutcomes: CodexInspectionExecutionOutcome[] = [];
  mergeExecutionReferenceItems(items, referenceItems).forEach((item) => {
    if (!isFileExecutionAction(item)) return;
    const fileName = item.fileName.trim();
    if (!fileName) return;
    const group = groups.get(fileName) ?? [];
    group.push(item);
    groups.set(fileName, group);
  });

  const executableItems: CodexInspectionResultItem[] = [];
  const seenFileNames = new Set<string>();
  items.forEach((item) => {
    if (!isFileExecutionAction(item)) return;
    const fileName = item.fileName.trim();
    if (!fileName) {
      preflightOutcomes.push(
        buildPreflightOutcome(item, 'failed', false, '认证文件名为空，无法执行')
      );
      return;
    }
    const group = groups.get(fileName) ?? [item];
    if (new Set(group.map((item) => item.action)).size > 1) {
      preflightOutcomes.push(
        buildPreflightOutcome(
          item,
          'needs_review',
          true,
          '同一认证文件下存在多个不同建议动作，文件级处理已阻止，请到认证文件管理中手动处理'
        )
      );
      return;
    }
    if (group[0]?.key !== item.key) {
      preflightOutcomes.push(
        buildPreflightOutcome(
          item,
          'skipped',
          true,
          'CPA 认证文件动作按文件执行，该文件已有另一条结果作为可执行项'
        )
      );
      return;
    }
    if (seenFileNames.has(fileName)) {
      preflightOutcomes.push(
        buildPreflightOutcome(
          item,
          'skipped',
          true,
          'CPA 认证文件动作按文件执行，同名文件已由另一条结果处理'
        )
      );
      return;
    }
    seenFileNames.add(fileName);
    executableItems.push(item);
  });

  return {
    items: executableItems.sort((left, right) => left.fileName.localeCompare(right.fileName)),
    preflightOutcomes,
  };
};

const summarizeExecutionOutcomes = (outcomes: CodexInspectionExecutionOutcome[]) =>
  outcomes.reduce(
    (summary, outcome) => {
      summary[outcome.status] += 1;
      return summary;
    },
    { success: 0, failed: 0, skipped: 0, needs_review: 0 }
  );

const normalizeProvider = (value: unknown): string => {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/_/g, '-');
  if (normalized === 'x-ai' || normalized === 'grok') return 'xai';
  return normalized || 'codex';
};

const readCurrentFileName = (file: AuthFileItem): string =>
  String(file.name ?? file.id ?? '').trim();

const matchesCurrentActionIdentity = (
  file: AuthFileItem,
  item: CodexInspectionResultItem
): boolean => {
  if (readCurrentFileName(file) !== item.fileName) return false;
  if (normalizeProvider(resolveAuthProvider(file)) !== normalizeProvider(item.provider))
    return false;
  const authIndex = normalizeAuthIndex(file['auth_index'] ?? file.authIndex ?? file['auth-index']);
  if (item.authIndex && authIndex !== normalizeAuthIndex(item.authIndex)) return false;
  const accountId = resolveCodexChatgptAccountId(file);
  if (item.accountId && accountId !== item.accountId.trim()) return false;
  return true;
};

const buildActionValidationOutcome = (
  item: CodexInspectionResultItem,
  status: 'failed' | 'skipped',
  error: string
): CodexInspectionExecutionOutcome => ({
  accountKey: item.key,
  action: item.action as CodexInspectionExecutionOutcome['action'],
  fileName: item.fileName,
  displayAccount: item.displayAccount,
  status,
  success: status === 'skipped',
  error,
});

const executeDelete = async (
  item: CodexInspectionResultItem
): Promise<CodexInspectionExecutionOutcome> => {
  try {
    const result = await authFilesApi.deleteFileByName(item.fileName);
    const failed = result.failed[0];
    if (failed) {
      return {
        accountKey: item.key,
        action: 'delete',
        fileName: item.fileName,
        displayAccount: item.displayAccount,
        status: 'failed',
        success: false,
        error: failed.error || '删除失败',
      };
    }
    if (result.deleted <= 0) {
      return {
        accountKey: item.key,
        action: 'delete',
        fileName: item.fileName,
        displayAccount: item.displayAccount,
        status: 'failed',
        success: false,
        error: '删除接口未确认认证文件已删除',
      };
    }
    return {
      accountKey: item.key,
      action: 'delete',
      fileName: item.fileName,
      displayAccount: item.displayAccount,
      status: 'success',
      success: true,
      error: '',
    };
  } catch (error) {
    return {
      accountKey: item.key,
      action: 'delete',
      fileName: item.fileName,
      displayAccount: item.displayAccount,
      status: 'failed',
      success: false,
      error: error instanceof Error ? error.message : String(error || '删除失败'),
    };
  }
};

const executeStatusChange = async (
  item: CodexInspectionResultItem,
  disabled: boolean
): Promise<CodexInspectionExecutionOutcome> => {
  try {
    await authFilesApi.setStatusWithFallback(item.fileName, disabled);
    return {
      accountKey: item.key,
      action: disabled ? 'disable' : 'enable',
      fileName: item.fileName,
      displayAccount: item.displayAccount,
      status: 'success',
      success: true,
      error: '',
    };
  } catch (error) {
    return {
      accountKey: item.key,
      action: disabled ? 'disable' : 'enable',
      fileName: item.fileName,
      displayAccount: item.displayAccount,
      status: 'failed',
      success: false,
      error: error instanceof Error ? error.message : String(error || '状态更新失败'),
    };
  }
};

export const executeCodexInspectionActions = async ({
  settings,
  items,
  referenceItems,
  previousFiles,
  connectionFingerprint,
  source,
  preflightOutcomes: suppliedPreflightOutcomes = [],
  onLog,
  t = identityT,
}: ExecuteCodexInspectionActionsOptions): Promise<CodexInspectionExecutionResult> => {
  const plan = planExecutionItems(items, referenceItems ?? items);
  const dedupedItems = plan.items;
  const outcomes: CodexInspectionExecutionOutcome[] = [
    ...suppliedPreflightOutcomes,
    ...plan.preflightOutcomes,
  ];
  let executableItems = dedupedItems;
  let preflightFiles: AuthFileItem[] | null = null;

  if (source === 'manual' || source === 'auto') {
    onLog?.(
      'info',
      t(
        source === 'manual'
          ? 'monitoring.codex_inspection_log_manual_started'
          : 'monitoring.codex_inspection_log_auto_started',
        {
          requested: items.length + suppliedPreflightOutcomes.length,
          actions: dedupedItems.length,
        }
      ),
      {
        requestedCount: items.length + suppliedPreflightOutcomes.length,
        actionCount: dedupedItems.length,
      }
    );
  }

  [...suppliedPreflightOutcomes, ...plan.preflightOutcomes].forEach((outcome) => {
    const level =
      outcome.status === 'failed'
        ? 'error'
        : outcome.status === 'needs_review'
          ? 'warning'
          : 'info';
    const messageKey =
      outcome.status === 'needs_review'
        ? 'monitoring.codex_inspection_log_action_needs_review'
        : outcome.status === 'skipped'
          ? 'monitoring.codex_inspection_log_action_skipped'
          : 'monitoring.codex_inspection_log_action_failed';
    onLog?.(
      level,
      t(messageKey, {
        account: outcome.displayAccount,
        action: formatExecutionAction(outcome.action, t),
        message: outcome.error,
      }),
      buildExecutionOutcomeLogDetail(outcome)
    );
  });

  if (dedupedItems.length > 0) {
    try {
      const response = await authFilesApi.list();
      const currentFiles = Array.isArray(response.files) ? response.files : [];
      preflightFiles = currentFiles;
      executableItems = dedupedItems.filter((item) => {
        const currentFile = currentFiles.find((file) =>
          matchesCurrentActionIdentity(file, item)
        );
        let outcome: CodexInspectionExecutionOutcome | null = null;
        if (!currentFile) {
          outcome = buildActionValidationOutcome(
            item,
            'failed',
            '认证文件不存在、Provider 不匹配或账号标识已变化，已拒绝执行'
          );
        } else if (item.action === 'disable' && currentFile.disabled === true) {
          outcome = buildActionValidationOutcome(
            item,
            'skipped',
            '账号已是禁用状态，未重复执行'
          );
        } else if (item.action === 'enable' && currentFile.disabled !== true) {
          outcome = buildActionValidationOutcome(
            item,
            'skipped',
            '账号已是启用状态，未重复执行'
          );
        }
        if (!outcome) return true;
        outcomes.push(outcome);
        onLog?.(
          outcome.status === 'failed' ? 'error' : 'info',
          t(
            outcome.status === 'failed'
              ? 'monitoring.codex_inspection_log_action_failed'
              : 'monitoring.codex_inspection_log_action_skipped',
            {
              account: outcome.displayAccount,
              action: formatExecutionAction(outcome.action, t),
              message: outcome.error,
            }
          ),
          buildExecutionOutcomeLogDetail(outcome)
        );
        return false;
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error || '未知错误');
      dedupedItems.forEach((item) => {
        const outcome = buildActionValidationOutcome(
          item,
          'failed',
          `刷新认证文件失败，已拒绝执行：${message}`
        );
        outcomes.push(outcome);
        onLog?.(
          'error',
          t('monitoring.codex_inspection_log_action_failed', {
            account: outcome.displayAccount,
            action: formatExecutionAction(outcome.action, t),
            message: outcome.error,
          }),
          buildExecutionOutcomeLogDetail(outcome)
        );
      });
      executableItems = [];
    }
  }

  const deleteItems = executableItems.filter((item) => item.action === 'delete');
  const disableItems = executableItems.filter((item) => item.action === 'disable');
  const enableItems = executableItems.filter((item) => item.action === 'enable');

  if (deleteItems.length > 0) {
    const deleteOutcomes = await runConcurrently(
      deleteItems,
      settings.deleteWorkers,
      executeDelete
    );
    deleteOutcomes.forEach((outcome) => {
      onLog?.(
        outcome.success ? 'success' : 'error',
        outcome.success
          ? t('monitoring.codex_inspection_log_action_success', {
              account: outcome.displayAccount,
              action: formatExecutionAction(outcome.action, t),
            })
          : t('monitoring.codex_inspection_log_action_failed', {
              account: outcome.displayAccount,
              action: formatExecutionAction(outcome.action, t),
              message: outcome.error,
            }),
        buildExecutionOutcomeLogDetail(outcome)
      );
    });
    outcomes.push(...deleteOutcomes);
  }

  if (disableItems.length > 0) {
    const disableOutcomes = await runConcurrently(disableItems, settings.deleteWorkers, (item) =>
      executeStatusChange(item, true)
    );
    disableOutcomes.forEach((outcome) => {
      onLog?.(
        outcome.success ? 'success' : 'error',
        outcome.success
          ? t('monitoring.codex_inspection_log_action_success', {
              account: outcome.displayAccount,
              action: formatExecutionAction(outcome.action, t),
            })
          : t('monitoring.codex_inspection_log_action_failed', {
              account: outcome.displayAccount,
              action: formatExecutionAction(outcome.action, t),
              message: outcome.error,
            }),
        buildExecutionOutcomeLogDetail(outcome)
      );
    });
    outcomes.push(...disableOutcomes);
  }

  if (enableItems.length > 0) {
    const enableOutcomes = await runConcurrently(enableItems, settings.deleteWorkers, (item) =>
      executeStatusChange(item, false)
    );
    enableOutcomes.forEach((outcome) => {
      onLog?.(
        outcome.success ? 'success' : 'error',
        outcome.success
          ? t('monitoring.codex_inspection_log_action_success', {
              account: outcome.displayAccount,
              action: formatExecutionAction(outcome.action, t),
            })
          : t('monitoring.codex_inspection_log_action_failed', {
              account: outcome.displayAccount,
              action: formatExecutionAction(outcome.action, t),
              message: outcome.error,
            }),
        buildExecutionOutcomeLogDetail(outcome)
      );
    });
    outcomes.push(...enableOutcomes);
  }

  const itemByFileName = new Map(dedupedItems.map((item) => [item.fileName, item] as const));
  outcomes.forEach((outcome) => {
    if (!outcome.success || outcome.status !== 'success') return;
    const item = itemByFileName.get(outcome.fileName);
    if (!item) return;
    if (outcome.action === 'disable' && source === 'auto') {
      recordCodexInspectionDisableOwnership(connectionFingerprint, {
        fileName: item.fileName,
        provider: item.provider,
        authIndex: item.authIndex,
        accountId: item.accountId,
      });
      return;
    }
    clearCodexInspectionDisableOwnership(connectionFingerprint, item.fileName);
  });

  let refreshedFiles = preflightFiles ?? previousFiles;
  let refreshError = '';
  if (deleteItems.length + disableItems.length + enableItems.length > 0) {
    try {
      const response = await authFilesApi.list();
      refreshedFiles = Array.isArray(response.files) ? response.files : previousFiles;
    } catch (error) {
      refreshError = error instanceof Error ? error.message : String(error || '刷新账号列表失败');
      onLog?.(
        'warning',
        t('monitoring.codex_inspection_log_refresh_failed', { message: refreshError }),
        { error: refreshError }
      );
    }
  }

  if (source === 'manual') {
    const summary = summarizeExecutionOutcomes(outcomes);
    onLog?.(
      summary.failed > 0 || summary.needs_review > 0 || refreshError ? 'warning' : 'success',
      t('monitoring.codex_inspection_log_manual_completed', {
        success: summary.success,
        skipped: summary.skipped,
        review: summary.needs_review,
        failed: summary.failed,
      }),
      {
        successCount: summary.success,
        failedCount: summary.failed,
        skippedCount: summary.skipped,
        needsReviewCount: summary.needs_review,
        refreshFailed: Boolean(refreshError),
        ...(refreshError ? { refreshError } : {}),
      }
    );
  }

  return {
    outcomes,
    refreshedFiles,
    refreshError,
  };
};
