import {
  getAuthFileCodexInspectionKey,
  getAuthFileCodexInspectionKeyForFile,
  getAuthFileCodexInspectionKeyForIdentity,
} from '@/features/authFiles/model/authFilesPageModel';
import type { AccountRow } from './accountRows';

export interface AccountOperationalItem {
  authFileName: string;
  runtimeId?: unknown;
  provider?: unknown;
  authIndex?: unknown;
  accountId?: unknown;
  accountIdSnapshot?: unknown;
  accountSnapshot?: unknown;
}

const getAccountOperationalItemIdentityKey = (item: AccountOperationalItem): string =>
  getAuthFileCodexInspectionKeyForIdentity({
    fileName: item.authFileName,
    runtimeId: typeof item.runtimeId === 'string' ? item.runtimeId : null,
    provider: typeof item.provider === 'string' ? item.provider : null,
    authIndex:
      typeof item.authIndex === 'string' || typeof item.authIndex === 'number'
        ? item.authIndex
        : null,
    accountId:
      typeof item.accountId === 'string'
        ? item.accountId
        : typeof item.accountIdSnapshot === 'string'
          ? item.accountIdSnapshot
          : null,
    accountSnapshot: typeof item.accountSnapshot === 'string' ? item.accountSnapshot : null,
  });

export const accountOperationalItemMatchesRow = (
  row: AccountRow,
  item: AccountOperationalItem
): boolean =>
  getAuthFileCodexInspectionKeyForFile(row.raw) === getAccountOperationalItemIdentityKey(item);

export const buildAccountOperationalScopeKeys = (rows: AccountRow[]): Map<string, string[]> => {
  const eligibleRows = rows.filter((row) => !row.runtimeOnly);
  const fallbackCounts = new Map<string, number>();
  eligibleRows.forEach((row) => {
    const fallbackKey = getAuthFileCodexInspectionKey(row.fileName, null);
    fallbackCounts.set(fallbackKey, (fallbackCounts.get(fallbackKey) ?? 0) + 1);
  });

  return new Map(
    eligibleRows.map((row) => {
      const exactKey = getAuthFileCodexInspectionKeyForFile(row.raw);
      const fallbackKey = getAuthFileCodexInspectionKey(row.fileName, null);
      const keys = [exactKey];
      if (fallbackKey !== exactKey && fallbackCounts.get(fallbackKey) === 1) {
        keys.push(fallbackKey);
      }
      return [row.selectionKey, keys];
    })
  );
};

export const buildAccountOperationalItemsByRowKey = <T extends AccountOperationalItem>(
  rows: AccountRow[],
  items: T[]
): Map<string, T[]> => {
  const itemsByScopeKey = new Map<string, T[]>();
  items.forEach((item) => {
    if (!item.authFileName) return;
    const key = getAccountOperationalItemIdentityKey(item);
    itemsByScopeKey.set(key, [...(itemsByScopeKey.get(key) ?? []), item]);
  });

  const scopeKeysByRowKey = buildAccountOperationalScopeKeys(rows);
  return new Map(
    Array.from(scopeKeysByRowKey, ([rowKey, scopeKeys]) => [
      rowKey,
      scopeKeys.flatMap((key) => itemsByScopeKey.get(key) ?? []),
    ])
  );
};
