export type AccountQuotaRequestVersions = Map<string, number>;

export const beginAccountQuotaRequest = (
  versions: AccountQuotaRequestVersions,
  key: string
): (() => boolean) => {
  const version = (versions.get(key) ?? 0) + 1;
  versions.set(key, version);
  return () => versions.get(key) === version;
};
