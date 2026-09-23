import { normalizeApiBase } from '@/utils/connection';
import type { ModelPriceAttentionStorageData } from './modelPriceAttentionTypes';

export const MODEL_PRICE_ATTENTION_STORAGE_KEY = 'cpamp-model-price-attention-v1';

export const normalizeModelPriceAttentionScope = (base: string): string => {
  return normalizeApiBase(base).trim().toLowerCase();
};

const sanitizeModelList = (models: unknown): string[] => {
  if (!Array.isArray(models)) return [];
  const seen = new Set<string>();
  const list: string[] = [];
  models.forEach((item) => {
    if (typeof item === 'string') {
      const trimmed = item.trim();
      if (trimmed && !seen.has(trimmed)) {
        seen.add(trimmed);
        list.push(trimmed);
      }
    }
  });
  return list;
};

export const readModelPriceAttentionStorage = (
  storage?: Storage
): ModelPriceAttentionStorageData => {
  const targetStorage = storage ?? (typeof window !== 'undefined' ? window.localStorage : undefined);
  if (!targetStorage) {
    return { version: 1, scopes: {} };
  }

  try {
    const raw = targetStorage.getItem(MODEL_PRICE_ATTENTION_STORAGE_KEY);
    if (!raw) {
      return { version: 1, scopes: {} };
    }
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || parsed.version !== 1 || !parsed.scopes || typeof parsed.scopes !== 'object') {
      return { version: 1, scopes: {} };
    }

    const sanitizedScopes: Record<string, { acknowledgedModels: string[] }> = {};
    for (const [scopeKey, scopeValue] of Object.entries(parsed.scopes)) {
      if (scopeValue && typeof scopeValue === 'object') {
        const models = sanitizeModelList((scopeValue as { acknowledgedModels?: unknown }).acknowledgedModels);
        sanitizedScopes[scopeKey] = { acknowledgedModels: models };
      }
    }

    return { version: 1, scopes: sanitizedScopes };
  } catch {
    return { version: 1, scopes: {} };
  }
};

export const writeModelPriceAttentionStorage = (
  data: ModelPriceAttentionStorageData,
  storage?: Storage
): void => {
  const targetStorage = storage ?? (typeof window !== 'undefined' ? window.localStorage : undefined);
  if (!targetStorage) return;

  try {
    targetStorage.setItem(MODEL_PRICE_ATTENTION_STORAGE_KEY, JSON.stringify(data));
  } catch {
    // Gracefully ignore write failures (e.g. quota exceeded or restricted)
  }
};

export const loadAcknowledgedModels = (base: string, storage?: Storage): string[] => {
  const scope = normalizeModelPriceAttentionScope(base);
  if (!scope) return [];
  const data = readModelPriceAttentionStorage(storage);
  return data.scopes[scope]?.acknowledgedModels ?? [];
};

export const saveAcknowledgedModels = (
  base: string,
  acknowledgedModels: string[],
  storage?: Storage
): void => {
  const scope = normalizeModelPriceAttentionScope(base);
  if (!scope) return;
  const data = readModelPriceAttentionStorage(storage);
  const sanitized = sanitizeModelList(acknowledgedModels);
  data.scopes[scope] = { acknowledgedModels: sanitized };
  writeModelPriceAttentionStorage(data, storage);
};
