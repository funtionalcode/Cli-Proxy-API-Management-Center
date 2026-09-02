export const normalizePlanProvider = (value: unknown): string => {
  if (typeof value !== 'string') return '';
  return value.trim().toLowerCase().replace(/_/g, '-');
};

/** Returns a trimmed source value without changing its display casing. */
export const readRawPlanType = (value: unknown): string | null => {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed || null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
};

/** Returns the case-insensitive lookup key for a source plan value. */
export const normalizeRawPlanType = (value: unknown): string | null => {
  const raw = readRawPlanType(value);
  return raw?.toLowerCase() ?? null;
};
