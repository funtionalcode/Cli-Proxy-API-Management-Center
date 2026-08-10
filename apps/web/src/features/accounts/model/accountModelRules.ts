import type { AuthFileModelItem } from '@/features/authFiles/constants';
import {
  getProviderRecordValues,
  normalizeExcludedModels,
  parseExcludedModelsText,
} from '@/features/authFiles/constants';

export type AccountModelRuleScope =
  | 'available'
  | 'unknown'
  | 'credential'
  | 'shared'
  | 'global'
  | 'both'
  | 'shared-global';

export type AccountModelRuleRow = AuthFileModelItem & {
  runtimeAvailable: boolean;
  scope: AccountModelRuleScope;
  credentialPatterns: string[];
  globalPatterns: string[];
  hasCredentialExactRule: boolean;
  hasCredentialWildcardRule: boolean;
};

export type AccountModelRuleProjection = {
  rows: AccountModelRuleRow[];
  credentialRules: string[];
  globalRules: string[];
  advancedCredentialRules: string[];
  advancedGlobalRules: string[];
};

export type AccountModelRuleDiff = {
  added: string[];
  removed: string[];
  unchanged: string[];
};

type BuildAccountModelRuleProjectionOptions = {
  provider: string;
  runtimeModels: AuthFileModelItem[];
  modelDefinitions: AuthFileModelItem[];
  credentialRules: string[];
  globalRules: Record<string, string[]>;
  globalRulesKnown?: boolean;
  credentialRulesShared?: boolean;
};

const normalizeModelId = (value: string): string => value.trim().toLowerCase();

const buildPatternMatcher = (pattern: string): RegExp => {
  const regexSafePattern = pattern
    .split('*')
    .map((segment) => segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${regexSafePattern}$`, 'i');
};

export const matchesAccountModelRule = (modelId: string, pattern: string): boolean => {
  const normalizedModelId = normalizeModelId(modelId);
  const normalizedPattern = normalizeModelId(pattern);
  if (!normalizedModelId || !normalizedPattern) return false;
  if (!normalizedPattern.includes('*')) return normalizedModelId === normalizedPattern;
  return buildPatternMatcher(normalizedPattern).test(normalizedModelId);
};

const findMatchingRules = (modelId: string, rules: string[]): string[] =>
  rules.filter((rule) => matchesAccountModelRule(modelId, rule));

const mergeModelItem = (
  existing: AuthFileModelItem | undefined,
  incoming: AuthFileModelItem
): AuthFileModelItem => ({
  ...incoming,
  ...existing,
  id: existing?.id || incoming.id,
  display_name: existing?.display_name || incoming.display_name,
  type: existing?.type || incoming.type,
  owned_by: existing?.owned_by || incoming.owned_by,
});

const getGlobalRulesForProvider = (
  provider: string,
  globalRules: Record<string, string[]>
): string[] => normalizeExcludedModels(getProviderRecordValues(globalRules, provider).flat());

export const buildAccountModelRuleProjection = ({
  provider,
  runtimeModels,
  modelDefinitions,
  credentialRules,
  globalRules,
  globalRulesKnown = true,
  credentialRulesShared = false,
}: BuildAccountModelRuleProjectionOptions): AccountModelRuleProjection => {
  const normalizedCredentialRules = normalizeExcludedModels(credentialRules);
  const normalizedGlobalRules = globalRulesKnown
    ? getGlobalRulesForProvider(provider, globalRules)
    : [];
  const runtimeIds = new Set(
    runtimeModels.map((model) => normalizeModelId(model.id)).filter(Boolean)
  );
  const modelById = new Map<string, AuthFileModelItem>();
  const orderedIds: string[] = [];

  const addModel = (model: AuthFileModelItem, requireRuleMatch: boolean) => {
    const modelId = model.id.trim();
    const idKey = normalizeModelId(modelId);
    if (!idKey) return;
    if (
      requireRuleMatch &&
      findMatchingRules(modelId, normalizedCredentialRules).length === 0 &&
      findMatchingRules(modelId, normalizedGlobalRules).length === 0
    ) {
      return;
    }
    if (!modelById.has(idKey)) orderedIds.push(idKey);
    modelById.set(idKey, mergeModelItem(modelById.get(idKey), { ...model, id: modelId }));
  };

  runtimeModels.forEach((model) => addModel(model, false));
  modelDefinitions.forEach((model) => addModel(model, true));

  const rows = orderedIds.map((idKey): AccountModelRuleRow => {
    const model = modelById.get(idKey) ?? { id: idKey };
    const credentialPatterns = findMatchingRules(model.id, normalizedCredentialRules);
    const globalPatterns = findMatchingRules(model.id, normalizedGlobalRules);
    const credentialExcluded = credentialPatterns.length > 0;
    const globalExcluded = globalPatterns.length > 0;
    const scope: AccountModelRuleScope = credentialExcluded
      ? credentialRulesShared
        ? globalExcluded
          ? 'shared-global'
          : 'shared'
        : globalExcluded
          ? 'both'
          : 'credential'
      : !globalRulesKnown
        ? 'unknown'
        : globalExcluded
          ? 'global'
          : 'available';

    return {
      ...model,
      runtimeAvailable: runtimeIds.has(idKey),
      scope,
      credentialPatterns,
      globalPatterns,
      hasCredentialExactRule: credentialPatterns.some(
        (pattern) => !pattern.includes('*') && normalizeModelId(pattern) === idKey
      ),
      hasCredentialWildcardRule: credentialPatterns.some((pattern) => pattern.includes('*')),
    };
  });

  const knownModelIds = new Set(rows.map((row) => normalizeModelId(row.id)));
  const isAdvancedRule = (rule: string) =>
    rule.includes('*') || !knownModelIds.has(normalizeModelId(rule));

  return {
    rows,
    credentialRules: normalizedCredentialRules,
    globalRules: normalizedGlobalRules,
    advancedCredentialRules: normalizedCredentialRules.filter(isAdvancedRule),
    advancedGlobalRules: normalizedGlobalRules.filter(isAdvancedRule),
  };
};

export const setAccountModelExactRule = (
  rules: string[],
  modelId: string,
  excluded: boolean
): string[] => {
  const normalizedRules = normalizeExcludedModels(rules);
  const normalizedModelId = normalizeModelId(modelId);
  if (!normalizedModelId) return normalizedRules;
  const next = new Set(normalizedRules);
  if (excluded) next.add(normalizedModelId);
  else next.delete(normalizedModelId);
  return Array.from(next).sort((left, right) => left.localeCompare(right));
};

export const buildAccountModelRuleDiff = (
  originalRulesText: string,
  nextRulesText: string
): AccountModelRuleDiff => {
  const originalRules = parseExcludedModelsText(originalRulesText);
  const nextRules = parseExcludedModelsText(nextRulesText);
  const original = new Set(originalRules);
  const next = new Set(nextRules);
  return {
    added: nextRules.filter((rule) => !original.has(rule)),
    removed: originalRules.filter((rule) => !next.has(rule)),
    unchanged: nextRules.filter((rule) => original.has(rule)),
  };
};
