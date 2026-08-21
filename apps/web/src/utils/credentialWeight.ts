export const MAX_CREDENTIAL_WEIGHT = 1_000_000;

export type CredentialWeightErrorCode = 'integer' | 'maximum';
export type CredentialWeightComparisonValue = number | null | 'invalid';
export type CredentialWeightInputValue = number | string | undefined;

const INTEGER_PATTERN = /^[+-]?\d+$/;

export const toCredentialWeightInputValue = (raw: string): CredentialWeightInputValue =>
  raw.trim() === '' ? undefined : raw;

export const getCredentialWeightError = (value: unknown): CredentialWeightErrorCode | undefined => {
  if (value === undefined || value === null || value === '') return undefined;

  const parsed = (() => {
    if (typeof value === 'number') return value;
    if (typeof value !== 'string') return Number.NaN;
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    if (!INTEGER_PATTERN.test(trimmed)) return Number.NaN;
    return Number(trimmed);
  })();

  if (parsed === undefined) return undefined;
  if (!Number.isSafeInteger(parsed)) return 'integer';
  if (parsed > MAX_CREDENTIAL_WEIGHT) return 'maximum';
  return undefined;
};

export const normalizeCredentialWeight = (value: unknown): number | undefined => {
  if (getCredentialWeightError(value)) return undefined;
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'string' && !value.trim()) return undefined;

  const parsed = typeof value === 'number' ? value : Number(String(value).trim());
  return Number.isSafeInteger(parsed) ? parsed : undefined;
};

export const getCredentialWeightComparisonValue = (
  value: unknown
): CredentialWeightComparisonValue =>
  getCredentialWeightError(value) ? 'invalid' : (normalizeCredentialWeight(value) ?? null);
