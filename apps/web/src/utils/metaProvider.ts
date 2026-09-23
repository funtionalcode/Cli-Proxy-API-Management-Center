import type { ProviderKeyConfig } from '@/types';

export const isMetaDcaCredential = (value: unknown): boolean => {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (/^dca:/i.test(trimmed)) return true;

  const bearerMatch = /^bearer\s+(.+)$/i.exec(trimmed);
  if (!bearerMatch) return false;

  return /^dca:/i.test(bearerMatch[1].trim());
};

export const hasMetaDcaAuthorizationHeader = (
  headers?: Record<string, unknown> | Array<{ key?: string; value?: string }> | null
): boolean => {
  if (!headers) return false;

  if (Array.isArray(headers)) {
    return headers.some(
      (entry) =>
        String(entry?.key ?? '').trim().toLowerCase() === 'authorization' &&
        isMetaDcaCredential(entry?.value)
    );
  }

  return Object.entries(headers).some(
    ([key, value]) =>
      key.trim().toLowerCase() === 'authorization' &&
      isMetaDcaCredential(value)
  );
};

export const assertValidMetaApiKey = (apiKey?: string) => {
  const trimmed = apiKey?.trim();
  if (!trimmed) {
    throw new Error('Meta API key is required');
  }
  if (isMetaDcaCredential(trimmed)) {
    throw new Error('DCA tokens cannot be used as Meta API keys');
  }
};

export const assertValidMetaProviderConfig = (config: ProviderKeyConfig) => {
  assertValidMetaApiKey(config.apiKey);
  if (hasMetaDcaAuthorizationHeader(config.headers)) {
    throw new Error('DCA tokens cannot be used as Meta authorization headers');
  }
};
