import type {
  MonitoringAccountHistoryItem,
  MonitoringAccountHistoryTarget,
} from '@/services/api/usageService';
import { resolveCredentialIdentity } from '@/utils/authFileCredentialIdentity';
import type { AccountRow } from './accountRows';

export interface AccountHistoryTargetEntry {
  rowKey: string;
  target: MonitoringAccountHistoryTarget;
}

const readString = (value: unknown): string => {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
};

const readRowKey = (value: unknown): string => (typeof value === 'string' ? value : '');

const hasRequiredFileProvider = (target: MonitoringAccountHistoryTarget): boolean => {
  const authFile = target.auth_file_snapshot?.trim() ?? '';
  const account = target.account_snapshot?.trim() ?? '';
  const label = target.auth_label_snapshot?.trim() ?? '';
  const source = target.source?.trim() ?? '';
  const effectiveFile =
    authFile || (source && source !== account && source !== label ? source : '');
  return !effectiveFile || Boolean(target.auth_provider_snapshot?.trim());
};

export const buildAccountHistoryTargetEntries = (rows: AccountRow[]): AccountHistoryTargetEntry[] =>
  rows
    .map((row) => {
      const identity = resolveCredentialIdentity(row.raw);
      const accountSnapshot = identity.accountSnapshot;
      const authLabelSnapshot = identity.authLabelSnapshot;
      const authFileSnapshot = identity.physicalName || readString(row.fileName);
      const rowProvider = readString(row.provider);
      const authProviderSnapshot =
        identity.provider || (rowProvider === 'unknown' ? '' : rowProvider);
      const authProjectIdSnapshot = identity.accountId || readString(row.projectId);
      const authIndex = identity.authIndex || readString(row.authIndex);

      return {
        rowKey: row.selectionKey,
        target: {
          row_key: row.selectionKey,
          account_snapshot: accountSnapshot || undefined,
          auth_label_snapshot: authLabelSnapshot || undefined,
          auth_file_snapshot: authFileSnapshot || undefined,
          auth_provider_snapshot: authProviderSnapshot || undefined,
          auth_project_id_snapshot: authProjectIdSnapshot || undefined,
          auth_index: authIndex || undefined,
          source: authFileSnapshot || undefined,
        },
      };
    })
    .filter(
      (entry) =>
        hasRequiredFileProvider(entry.target) &&
        Boolean(
          entry.target.auth_file_snapshot ||
          entry.target.auth_index ||
          entry.target.auth_project_id_snapshot ||
          entry.target.account_snapshot ||
          entry.target.auth_label_snapshot ||
          entry.target.source
        )
    );

export const buildAccountHistoryByRowKey = (
  entries: AccountHistoryTargetEntry[],
  items: MonitoringAccountHistoryItem[],
  generatedAtMs?: number
): Map<string, MonitoringAccountHistoryItem> => {
  const result = new Map<string, MonitoringAccountHistoryItem>();
  const requestedRowKeys = new Set(entries.map((entry) => entry.rowKey));
  items.forEach((item) => {
    const rowKey = readRowKey(item.row_key);
    if (rowKey && requestedRowKeys.has(rowKey)) {
      result.set(
        rowKey,
        generatedAtMs && generatedAtMs > 0 ? { ...item, generated_at_ms: generatedAtMs } : item
      );
    }
  });
  return result;
};
