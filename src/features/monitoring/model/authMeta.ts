import type { AuthFileItem } from '@/types/authFile';
import { normalizeAuthIndex } from '@/utils/usage';
import { buildLegacyAuthIndexAliases } from '../legacyAuthIndexAliases';
import { extractHost, isRecord, parseBoolean, readString } from './base';
import type { MonitoringAuthMeta, MonitoringChannelMeta } from './types';

export const normalizeOpenAIChannel = (
  value: unknown,
  index: number
): MonitoringChannelMeta | null => {
  if (!isRecord(value)) return null;

  const name = readString(value.name || value.id) || `openai-${index + 1}`;
  const baseUrl = readString(value['base-url'] ?? value.baseUrl);
  if (!baseUrl) return null;

  const authIndices = new Set<string>();
  const providerAuthIndex = normalizeAuthIndex(
    value['auth-index'] ?? value.authIndex ?? value['auth_index']
  );
  if (providerAuthIndex) {
    authIndices.add(providerAuthIndex);
  }

  const apiKeyEntries = Array.isArray(value['api-key-entries']) ? value['api-key-entries'] : [];
  apiKeyEntries.forEach((entry) => {
    if (!isRecord(entry)) return;
    const authIndex = normalizeAuthIndex(
      entry['auth-index'] ?? entry.authIndex ?? entry['auth_index']
    );
    if (authIndex) {
      authIndices.add(authIndex);
    }
  });

  const modelNames = Array.isArray(value.models)
    ? value.models
        .map((item) => {
          if (typeof item === 'string') return readString(item);
          if (!isRecord(item)) return '';
          return readString(item.name ?? item.alias ?? item.id ?? item.model);
        })
        .filter(Boolean)
    : [];

  return {
    key: `${name}:${index}`,
    name,
    baseUrl,
    host: extractHost(baseUrl),
    disabled: parseBoolean(value.disabled),
    authIndices: Array.from(authIndices),
    modelNames: Array.from(new Set(modelNames)),
  };
};

const readAuthTimestamp = (entry: AuthFileItem) =>
  readString(entry['updated_at'] ?? entry.updatedAt ?? entry['modtime'] ?? entry.modified);

const normalizeAuthMeta = (entry: AuthFileItem): MonitoringAuthMeta | null => {
  const authIndex = normalizeAuthIndex(entry['auth_index'] ?? entry.authIndex);
  if (!authIndex) return null;

  const label =
    readString(entry.label) ||
    readString(entry.name) ||
    readString(entry.email) ||
    readString(entry.account) ||
    authIndex;

  const planType = readString(
    isRecord(entry.id_token) ? entry.id_token.plan_type : entry['plan_type']
  );

  return {
    authIndex,
    label,
    account: readString(entry.account) || readString(entry.email) || label,
    provider: readString(entry.provider) || readString(entry.type) || '-',
    status: readString(entry.status) || 'unknown',
    disabled: parseBoolean(entry.disabled),
    unavailable: parseBoolean(entry.unavailable),
    runtimeOnly: parseBoolean(entry.runtime_only ?? entry.runtimeOnly),
    planType: planType || '-',
    updatedAt: readAuthTimestamp(entry),
  };
};

export const buildMonitoringAuthMetaMap = (
  authFiles: AuthFileItem[]
): Map<string, MonitoringAuthMeta> => {
  const map = new Map<string, MonitoringAuthMeta>();
  authFiles.forEach((entry) => {
    const normalized = normalizeAuthMeta(entry);
    if (!normalized) return;

    map.set(normalized.authIndex, normalized);
    buildLegacyAuthIndexAliases(entry).forEach((alias) => {
      if (!map.has(alias)) {
        map.set(alias, normalized);
      }
    });
  });
  return map;
};
