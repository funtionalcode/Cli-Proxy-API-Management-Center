import type { ApiKeyEntry, OpenAIProviderConfig } from '@/types';
import type { ModelEntry, OpenAIFormState } from '@/components/providers/types';
import { entriesToModels } from '@/components/ui/modelInputListUtils';
import { buildHeaderObject, normalizeHeaderEntries } from '@/utils/headers';
import { normalizeAuthIndex } from '@/utils/authIndex';
import { areKeyValueEntriesEqual } from '@/utils/compare';
import { parseProviderWeightInput } from '@/components/providers/utils';

export type NormalizedOpenAIApiKeyEntry = {
  apiKey: string;
  proxyUrl: string;
  authIndex: string;
  weight: number | null;
  headers: Array<{ key: string; value: string }>;
};

export type OpenAIFormBaseline = {
  name: string;
  weight: number | null;
  priority: number | null;
  prefix: string;
  baseUrl: string;
  disableCooling: boolean;
  headers: ReturnType<typeof normalizeHeaderEntries>;
  apiKeyEntries: NormalizedOpenAIApiKeyEntry[];
  models: Array<{ name: string; alias: string }>;
  testModel: string;
};

export const parseOpenAIWeightInput = parseProviderWeightInput;

export const normalizeOpenAIModelEntries = (entries: ModelEntry[]) =>
  (entries ?? []).reduce<Array<{ name: string; alias: string }>>((acc, entry) => {
    const name = String(entry?.name ?? '').trim();
    let alias = String(entry?.alias ?? '').trim();
    if (name && (alias === '' || alias === name)) {
      alias = '';
    }
    if (!name && !alias) return acc;
    acc.push({ name, alias });
    return acc;
  }, []);

export const normalizeOpenAIKeyHeaders = (headers: ApiKeyEntry['headers']) => {
  if (!headers || typeof headers !== 'object') return [];
  return Object.entries(headers)
    .map(([key, value]) => ({ key: String(key ?? '').trim(), value: String(value ?? '').trim() }))
    .filter((entry) => entry.key || entry.value)
    .sort((a, b) => {
      const byKey = a.key.toLowerCase().localeCompare(b.key.toLowerCase());
      if (byKey !== 0) return byKey;
      return a.value.localeCompare(b.value);
    });
};

export const normalizeOpenAIApiKeyEntries = (entries: ApiKeyEntry[]) =>
  (entries ?? []).reduce<NormalizedOpenAIApiKeyEntry[]>((acc, entry) => {
    const apiKey = String(entry?.apiKey ?? '').trim();
    const proxyUrl = String(entry?.proxyUrl ?? '').trim();
    const authIndex = normalizeAuthIndex(entry?.authIndex) ?? '';
    const weight = parseOpenAIWeightInput(entry?.weight) ?? null;
    const headers = normalizeOpenAIKeyHeaders(entry?.headers);
    if (!apiKey && !proxyUrl && !authIndex && weight === null && headers.length === 0) return acc;
    acc.push({ apiKey, proxyUrl, authIndex, weight, headers });
    return acc;
  }, []);

export const buildOpenAIBaseline = (form: OpenAIFormState, testModel = ''): OpenAIFormBaseline => ({
  name: String(form.name ?? '').trim(),
  weight: parseOpenAIWeightInput(form.weight) ?? null,
  priority:
    form.priority !== undefined && Number.isFinite(form.priority)
      ? Math.trunc(form.priority)
      : null,
  prefix: String(form.prefix ?? '').trim(),
  baseUrl: String(form.baseUrl ?? '').trim(),
  disableCooling: Boolean(form.disableCooling),
  headers: normalizeHeaderEntries(form.headers),
  apiKeyEntries: normalizeOpenAIApiKeyEntries(form.apiKeyEntries),
  models: normalizeOpenAIModelEntries(form.modelEntries),
  testModel: String(testModel ?? '').trim(),
});

export const areNormalizedOpenAIApiKeyEntriesEqual = (
  a: NormalizedOpenAIApiKeyEntry[],
  b: NormalizedOpenAIApiKeyEntry[]
) => {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    const left = a[i];
    const right = b[i];
    if (!left || !right) return false;
    if (
      left.apiKey !== right.apiKey ||
      left.proxyUrl !== right.proxyUrl ||
      left.authIndex !== right.authIndex ||
      left.weight !== right.weight
    ) {
      return false;
    }
    if (!areKeyValueEntriesEqual(left.headers, right.headers)) return false;
  }
  return true;
};

export const buildOpenAIProviderPayload = (
  form: OpenAIFormState,
  options: { disabled?: boolean; testModel?: string } = {}
): OpenAIProviderConfig => {
  const payload: OpenAIProviderConfig = {
    name: String(form.name ?? '').trim(),
    prefix: form.prefix?.trim() || undefined,
    baseUrl: String(form.baseUrl ?? '').trim(),
    headers: buildHeaderObject(form.headers),
    apiKeyEntries: form.apiKeyEntries.map((entry: ApiKeyEntry) => {
      const keyPayload: ApiKeyEntry = {
        apiKey: String(entry.apiKey ?? '').trim(),
        proxyUrl: entry.proxyUrl?.trim() || undefined,
        authIndex: normalizeAuthIndex(entry.authIndex) ?? undefined,
        headers: entry.headers,
      };
      const weight = parseOpenAIWeightInput(entry.weight);
      if (weight !== undefined) {
        keyPayload.weight = weight;
      }
      return keyPayload;
    }),
  };

  const weight = parseOpenAIWeightInput(form.weight);
  if (weight !== undefined) {
    payload.weight = weight;
  }
  if (form.priority !== undefined && Number.isFinite(form.priority)) {
    payload.priority = Math.trunc(form.priority);
  }
  if (form.disableCooling !== undefined) {
    payload.disableCooling = form.disableCooling;
  }
  if (options.disabled !== undefined) {
    payload.disabled = options.disabled;
  }
  const resolvedTestModel = String(options.testModel ?? '').trim();
  if (resolvedTestModel) {
    payload.testModel = resolvedTestModel;
  }
  const models = entriesToModels(form.modelEntries);
  if (models.length) {
    payload.models = models;
  }
  return payload;
};
