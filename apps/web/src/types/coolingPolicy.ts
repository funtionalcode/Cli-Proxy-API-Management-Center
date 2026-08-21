export type CoolingPolicy = 'inherit' | 'enabled' | 'disabled';

export type CoolingOverrideValue = boolean | null | undefined;

export type CoolingOverrideCompatibility = 'legacy' | 'supported' | 'unverified';

export const COOLING_POLICY_VALUES: readonly CoolingPolicy[] = ['inherit', 'enabled', 'disabled'];

export const COOLING_OVERRIDE_REFACTOR_COMMIT = '5bffd151';

const LAST_KNOWN_LEGACY_CPA_VERSION = [7, 2, 92] as const;
const COOLING_OVERRIDE_REFACTOR_DISTANCE = 368;
const CPA_RELEASE_VERSION_PATTERN = /^v?(\d+)\.(\d+)\.(\d+)(?:-(?:alpha|beta|rc)(?:[.-]?\d+)?)?$/i;
const CPA_GIT_DESCRIBE_VERSION_PATTERN = /^v?(\d+)\.(\d+)\.(\d+)-(\d+)-g([0-9a-f]+)(?:-dirty)?$/i;

const compareVersion = (current: readonly number[], baseline: readonly number[]) => {
  for (let index = 0; index < baseline.length; index += 1) {
    const difference = current[index] - baseline[index];
    if (difference !== 0) return difference;
  }
  return 0;
};

const isCoolingRefactorCommit = (serverCommit?: string | null) => {
  const normalized = serverCommit?.trim().toLowerCase().replace(/^g/, '') ?? '';
  if (normalized.length < 7) return false;
  return (
    normalized.startsWith(COOLING_OVERRIDE_REFACTOR_COMMIT) ||
    COOLING_OVERRIDE_REFACTOR_COMMIT.startsWith(normalized)
  );
};

/**
 * CPA exposes both a semantic/git-describe version and the build commit. The
 * refactor landed 368 commits after v7.2.92, so official descendants can be
 * recognized without enabling explicit false for unknown custom builds.
 */
export const getCoolingOverrideCompatibility = (
  serverVersion?: string | null,
  serverCommit?: string | null
): CoolingOverrideCompatibility => {
  if (isCoolingRefactorCommit(serverCommit)) return 'supported';

  const normalizedVersion = serverVersion?.trim() ?? '';
  const describeMatch = normalizedVersion.match(CPA_GIT_DESCRIBE_VERSION_PATTERN);
  if (describeMatch) {
    const baseVersion = describeMatch.slice(1, 4).map((segment) => Number.parseInt(segment, 10));
    const baseComparison = compareVersion(baseVersion, LAST_KNOWN_LEGACY_CPA_VERSION);
    if (baseComparison < 0) return 'legacy';
    if (baseComparison > 0) return 'supported';
    const distance = Number.parseInt(describeMatch[4], 10);
    return distance >= COOLING_OVERRIDE_REFACTOR_DISTANCE ? 'supported' : 'legacy';
  }

  const match = normalizedVersion.match(CPA_RELEASE_VERSION_PATTERN);
  if (!match) return 'unverified';
  const current = match.slice(1, 4).map((segment) => Number.parseInt(segment, 10));
  return compareVersion(current, LAST_KNOWN_LEGACY_CPA_VERSION) <= 0 ? 'legacy' : 'supported';
};

/**
 * Converts a transport-level optional boolean into the domain policy used by
 * forms and UI. `false` is deliberately preserved as an explicit override.
 */
export const coolingPolicyFromOverride = (value: CoolingOverrideValue): CoolingPolicy => {
  if (value === true) return 'disabled';
  if (value === false) return 'enabled';
  return 'inherit';
};

/** Converts a domain policy into the CPA transport representation. */
export const coolingPolicyToOverride = (policy: CoolingPolicy): boolean | null => {
  if (policy === 'disabled') return true;
  if (policy === 'enabled') return false;
  return null;
};

/**
 * Parses the supported legacy boolean encodings without collapsing null or
 * missing values into false.
 */
export const normalizeOptionalBoolean = (value: unknown): boolean | null | undefined => {
  if (value === null) return null;
  if (value === undefined) return undefined;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value !== 0;
  if (typeof value !== 'string') return undefined;

  const normalized = value.trim().toLowerCase();
  if (['true', '1', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['false', '0', 'no', 'n', 'off'].includes(normalized)) return false;
  return undefined;
};

const CPA_TRUE_STRINGS = new Set(['1', 't', 'T', 'TRUE', 'true', 'True']);
const CPA_FALSE_STRINGS = new Set(['0', 'f', 'F', 'FALSE', 'false', 'False']);

/** Mirrors CPA's parseBoolAny for credential metadata. */
export const parseCredentialCoolingBoolean = (value: unknown): boolean | undefined => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value !== 0;
  if (typeof value !== 'string') return undefined;

  const trimmed = value.trim();
  if (CPA_TRUE_STRINGS.has(trimmed)) return true;
  if (CPA_FALSE_STRINGS.has(trimmed)) return false;
  return undefined;
};

/**
 * Mirrors CPA Auth.DisableCoolingOverride(): canonical snake_case first, then
 * the hyphenated legacy key when the canonical value is absent or invalid.
 */
export const readCredentialCoolingOverride = (
  record: Record<string, unknown> | null | undefined
): boolean | undefined => {
  if (!record) return undefined;
  for (const field of ['disable_cooling', 'disable-cooling'] as const) {
    if (!Object.prototype.hasOwnProperty.call(record, field)) continue;
    const parsed = parseCredentialCoolingBoolean(record[field]);
    if (parsed !== undefined) return parsed;
  }
  return undefined;
};

/**
 * Reads the first present cooling alias. Presence is checked explicitly so a
 * canonical null is not mistaken for an omitted field and replaced by a
 * legacy alias.
 */
export const readCoolingOverride = (
  record: Record<string, unknown> | null | undefined,
  fields: readonly string[] = ['disable-cooling', 'disableCooling', 'disable_cooling']
): CoolingOverrideValue => {
  if (!record) return undefined;
  for (const field of fields) {
    if (!Object.prototype.hasOwnProperty.call(record, field)) continue;
    const parsed = normalizeOptionalBoolean(record[field]);
    if (parsed !== undefined || record[field] === null) return parsed;
  }
  return undefined;
};
