import type { ManagerLatestRelease } from '@/services/api/version';

type VersionPayload = Record<string, unknown> | undefined | null;

export const readManagerLatestTag = (data: ManagerLatestRelease | VersionPayload): string => {
  if (!data) return '';
  const raw = data.tag_name ?? data.name ?? data.latest_version ?? data.latest;
  return typeof raw === 'string' ? raw : raw == null ? '' : String(raw);
};

export const readApiLatestVersion = (data: VersionPayload): string => {
  if (!data) return '';
  const raw = data['latest-version'] ?? data.latest_version ?? data.latest;
  return typeof raw === 'string' ? raw : raw == null ? '' : String(raw);
};
