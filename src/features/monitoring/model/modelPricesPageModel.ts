import { collectUsageDetailsWithEndpoint, type ModelPrice } from '@/utils/usage';
import type {
  ModelPriceSyncCandidate,
  ModelPriceSyncCandidateSet,
} from '@/services/api/usageService';
import type { UsagePayload } from '@/features/monitoring/hooks/useUsageData';

export type ModelPriceFilter = 'all' | 'missing' | 'saved' | 'candidates';

export type PriceDraft = {
  model: string;
  prompt: string;
  completion: string;
  cache: string;
};

export type ModelPriceRow = {
  model: string;
  calls: number;
  requestedCalls: number;
  resolvedCalls: number;
  hasPrice: boolean;
  price?: ModelPrice;
  candidateCount: number;
};

export type ModelPriceSummary = {
  total: number;
  saved: number;
  missing: number;
  candidates: number;
};

export const createEmptyPriceDraft = (): PriceDraft => ({
  model: '',
  prompt: '',
  completion: '',
  cache: '',
});

export const createPriceDraft = (model: string, price?: ModelPrice): PriceDraft => ({
  model,
  prompt: price ? String(price.prompt) : '',
  completion: price ? String(price.completion) : '',
  cache: price ? String(price.cache) : '',
});

export const parsePriceValue = (value: string) => {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
};

export const buildPriceFromDraft = (draft: PriceDraft): ModelPrice | null => {
  const model = draft.model.trim();
  if (!model) return null;
  const prompt = parsePriceValue(draft.prompt);
  const completion = parsePriceValue(draft.completion);
  const cache = draft.cache.trim() === '' ? prompt : parsePriceValue(draft.cache);
  return { prompt, completion, cache, source: 'manual' };
};

export const applyCandidatePrice = (
  prices: Record<string, ModelPrice>,
  model: string,
  candidate: ModelPriceSyncCandidate
): Record<string, ModelPrice> => ({
  ...prices,
  [model]: {
    ...candidate.price,
    source: candidate.price.source || 'sync',
    sourceModelId: candidate.sourceModelId,
  },
});

export const buildSyncPriceModelsFromUsage = (
  usage: UsagePayload | null,
  prices: Record<string, ModelPrice>
) => {
  const models = new Set<string>(Object.keys(prices));
  collectUsageDetailsWithEndpoint(usage).forEach((detail) => {
    if (detail.__modelName) models.add(detail.__modelName);
    if (detail.__resolvedModel) models.add(detail.__resolvedModel);
  });
  return Array.from(models)
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right));
};

export const buildCandidateMap = (candidateSets: ModelPriceSyncCandidateSet[] = []) => {
  const map = new Map<string, ModelPriceSyncCandidate[]>();
  candidateSets.forEach((set) => {
    if (!set.model || !Array.isArray(set.candidates) || set.candidates.length === 0) return;
    map.set(set.model, set.candidates);
  });
  return map;
};

export const buildModelPriceRows = (
  usage: UsagePayload | null,
  prices: Record<string, ModelPrice>,
  candidateSets: ModelPriceSyncCandidateSet[] = []
): ModelPriceRow[] => {
  const rowMap = new Map<string, ModelPriceRow>();
  const candidateMap = buildCandidateMap(candidateSets);

  const ensureRow = (model: string): ModelPriceRow => {
    const existing = rowMap.get(model);
    if (existing) return existing;
    const price = prices[model];
    const row: ModelPriceRow = {
      model,
      calls: 0,
      requestedCalls: 0,
      resolvedCalls: 0,
      hasPrice: Boolean(price),
      price,
      candidateCount: candidateMap.get(model)?.length ?? 0,
    };
    rowMap.set(model, row);
    return row;
  };

  Object.keys(prices).forEach(ensureRow);
  candidateMap.forEach((_candidates, model) => ensureRow(model));

  collectUsageDetailsWithEndpoint(usage).forEach((detail) => {
    if (detail.__modelName) {
      const row = ensureRow(detail.__modelName);
      row.calls += 1;
      row.requestedCalls += 1;
    }
    if (detail.__resolvedModel && detail.__resolvedModel !== detail.__modelName) {
      const row = ensureRow(detail.__resolvedModel);
      row.calls += 1;
      row.resolvedCalls += 1;
    }
  });

  return Array.from(rowMap.values()).sort(
    (left, right) =>
      Number(left.hasPrice) - Number(right.hasPrice) ||
      right.candidateCount - left.candidateCount ||
      right.calls - left.calls ||
      left.model.localeCompare(right.model)
  );
};

export const buildModelPriceSummary = (rows: ModelPriceRow[]): ModelPriceSummary => {
  const saved = rows.filter((row) => row.hasPrice).length;
  const candidates = rows.filter((row) => !row.hasPrice && row.candidateCount > 0).length;
  return {
    total: rows.length,
    saved,
    missing: rows.length - saved,
    candidates,
  };
};

export const filterModelPriceRows = (
  rows: ModelPriceRow[],
  filter: ModelPriceFilter,
  search: string
) => {
  const query = search.trim().toLowerCase();
  return rows.filter((row) => {
    if (filter === 'missing' && row.hasPrice) return false;
    if (filter === 'saved' && !row.hasPrice) return false;
    if (filter === 'candidates' && (row.hasPrice || row.candidateCount === 0)) return false;
    if (!query) return true;
    return (
      row.model.toLowerCase().includes(query) ||
      row.price?.sourceModelId?.toLowerCase().includes(query) ||
      row.price?.source?.toLowerCase().includes(query)
    );
  });
};

export const formatPriceUnit = (value: number | undefined) => {
  const num = Number(value);
  return Number.isFinite(num) ? `$${num.toFixed(4)}/1M` : '--';
};
