import type { OAuthModelAliasEntry } from '@/types';

export interface OAuthRulePreviewCatalogModel {
  id: string;
  displayName: string;
}

export interface OAuthRulePreviewRow {
  provider: string;
  inputModel: string;
  upstreamModel: string;
  matchedAlias: string;
  matchedExclude: string;
  catalogModels: OAuthRulePreviewCatalogModel[];
  responseModel: string;
  forceMapping: boolean;
  effectiveStatus: 'available' | 'excluded' | 'aliased';
  explanationKey: string;
}

export interface OAuthRulePreviewPartition {
  affectedRows: OAuthRulePreviewRow[];
  directRows: OAuthRulePreviewRow[];
}

const normalize = (value: unknown) => (typeof value === 'string' ? value.trim().toLowerCase() : '');

const parseModelSuffix = (model: string) => {
  const trimmed = model.trim();
  const lastOpen = trimmed.lastIndexOf('(');
  if (lastOpen < 0 || !trimmed.endsWith(')')) {
    return { modelName: trimmed, suffix: '' };
  }
  return {
    modelName: trimmed.slice(0, lastOpen),
    suffix: trimmed.slice(lastOpen),
  };
};

const preserveRequestSuffix = (model: string, suffix: string) => {
  const trimmed = model.trim();
  if (!trimmed || !suffix || parseModelSuffix(trimmed).suffix) return trimmed;
  return `${trimmed}${suffix}`;
};

const findProviderValue = <T>(record: Record<string, T>, provider: string): T | undefined => {
  const providerKey = normalize(provider);
  const entry = Object.entries(record).find(([key]) => normalize(key) === providerKey);
  return entry?.[1];
};

export const getOAuthRulePreviewProviders = ({
  providers,
  excluded,
  aliases,
}: {
  providers: string[];
  excluded: Record<string, string[]>;
  aliases: Record<string, OAuthModelAliasEntry[]>;
}): string[] =>
  Array.from(
    new Set([
      ...providers.map(normalize),
      ...Object.keys(excluded).map(normalize),
      ...Object.keys(aliases).map(normalize),
    ])
  )
    .filter(Boolean)
    .sort();

export const partitionOAuthRulePreviewRows = (
  rows: OAuthRulePreviewRow[],
  providerFilter = ''
): OAuthRulePreviewPartition => {
  const providerKey = normalize(providerFilter);
  const filteredRows = providerKey
    ? rows.filter((row) => normalize(row.provider) === providerKey)
    : rows;

  return {
    affectedRows: filteredRows.filter((row) => row.effectiveStatus !== 'available'),
    directRows: filteredRows.filter((row) => row.effectiveStatus === 'available'),
  };
};

/** Match CPA's case-insensitive excluded-model wildcard semantics: only `*` is special. */
export const matchesOAuthExcludedPattern = (pattern: string, model: string): boolean => {
  const patternKey = normalize(pattern);
  const modelKey = normalize(model);
  if (!patternKey || !modelKey) return false;
  if (!patternKey.includes('*')) return patternKey === modelKey;

  const escaped = patternKey.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${escaped.replace(/\*/g, '.*')}$`).test(modelKey);
};

const buildCatalogModels = (
  upstreamModel: string,
  aliases: OAuthModelAliasEntry[],
  excluded: boolean
): OAuthRulePreviewCatalogModel[] => {
  if (!upstreamModel || excluded) return [];

  const sourceKey = normalize(upstreamModel);
  const sourceAliases = aliases.filter((entry) => normalize(entry.name) === sourceKey);
  if (sourceAliases.length === 0) {
    return [{ id: upstreamModel, displayName: '' }];
  }

  const result: OAuthRulePreviewCatalogModel[] = [];
  const seen = new Set<string>();
  const add = (id: string, displayName = '') => {
    const trimmed = id.trim();
    const key = normalize(trimmed);
    if (!key || seen.has(key)) return;
    seen.add(key);
    result.push({ id: trimmed, displayName: displayName.trim() });
  };

  if (sourceAliases.some((entry) => entry.fork === true)) {
    add(upstreamModel);
  }
  sourceAliases.forEach((entry) => add(entry.alias, entry.displayName));
  return result;
};

export const buildOAuthRulePreviewRows = ({
  providers,
  excluded,
  aliases,
  inputModel,
}: {
  providers: string[];
  excluded: Record<string, string[]>;
  aliases: Record<string, OAuthModelAliasEntry[]>;
  inputModel: string;
}): OAuthRulePreviewRow[] => {
  const requestedModel = inputModel.trim();
  if (!requestedModel) return [];
  const requestParts = parseModelSuffix(requestedModel);
  const requestedCandidates = [requestParts.modelName, requestedModel]
    .map(normalize)
    .filter((candidate, index, candidates) => candidate && candidates.indexOf(candidate) === index);
  const providerList = getOAuthRulePreviewProviders({ providers, excluded, aliases });

  return providerList.map((provider) => {
    const providerAliases = findProviderValue(aliases, provider) ?? [];
    const aliasEntry = providerAliases.find((entry) =>
      requestedCandidates.includes(normalize(entry.alias))
    );
    const upstreamModel = aliasEntry
      ? preserveRequestSuffix(aliasEntry.name, requestParts.suffix)
      : requestedModel;
    const upstreamCatalogModel = parseModelSuffix(upstreamModel).modelName;
    const excludedModels = findProviderValue(excluded, provider) ?? [];
    const matchedExclude =
      excludedModels.find((pattern) =>
        matchesOAuthExcludedPattern(pattern, upstreamCatalogModel)
      ) ?? '';
    const isExcluded = Boolean(matchedExclude);
    const matchedAlias = aliasEntry?.alias.trim() ?? '';
    const forceMapping = aliasEntry?.forceMapping === true;

    return {
      provider,
      inputModel: requestedModel,
      upstreamModel,
      matchedAlias,
      matchedExclude,
      catalogModels: buildCatalogModels(upstreamCatalogModel, providerAliases, isExcluded),
      responseModel: forceMapping ? matchedAlias : upstreamModel,
      forceMapping,
      effectiveStatus: isExcluded ? 'excluded' : aliasEntry ? 'aliased' : 'available',
      explanationKey: isExcluded
        ? 'accounts.oauth_preview_excluded'
        : aliasEntry
          ? 'accounts.oauth_preview_aliased'
          : 'accounts.oauth_preview_available',
    };
  });
};
