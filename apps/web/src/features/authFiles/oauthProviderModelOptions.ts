import type { OAuthModelAliasEntry } from '@/types';
import type { AuthFileModelItem } from '@/features/authFiles/constants';
import {
  normalizeOAuthExcludedRule,
  serializeOAuthExcludedRules,
} from '@/features/authFiles/oauthExcludedRules';

const normalizeAliasSourceName = (value: string): string => value.trim();

const mergeModelOptions = (
  catalog: readonly AuthFileModelItem[],
  configuredIds: Iterable<string>,
  normalizeId: (value: string) => string
): AuthFileModelItem[] => {
  const seen = new Set<string>();
  const options: AuthFileModelItem[] = [];

  catalog.forEach((model) => {
    const id = normalizeId(model.id);
    if (!id || seen.has(id)) return;
    seen.add(id);
    options.push({ ...model, id });
  });

  for (const configuredId of configuredIds) {
    const id = normalizeId(configuredId);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    options.push({ id });
  }

  return options;
};

export const buildOAuthExcludedModelOptions = (
  catalog: readonly AuthFileModelItem[],
  existingRules: Iterable<string>
): AuthFileModelItem[] =>
  mergeModelOptions(
    catalog,
    serializeOAuthExcludedRules(existingRules).filter((rule) => !rule.includes('*')),
    normalizeOAuthExcludedRule
  );

export const buildOAuthAliasModelOptions = (
  catalog: readonly AuthFileModelItem[],
  existingMappings: readonly OAuthModelAliasEntry[]
): AuthFileModelItem[] =>
  mergeModelOptions(
    catalog,
    existingMappings.map((mapping) => mapping.name),
    normalizeAliasSourceName
  );
