import { describe, expect, it } from 'vitest';
import { getQuotaCredentialStoreKey } from '@/utils/quota/credentialScope';
import { getDemoAuthFiles, getDemoQuotaStoreState } from './demoFixtures';

describe('demo quota credential identity', () => {
  it('uses the same credential-scoped keys as the real quota stores', () => {
    const filesByKey = new Map(
      getDemoAuthFiles().files.map((file) => [getQuotaCredentialStoreKey(file), file])
    );
    const stores = getDemoQuotaStoreState();
    const records = [
      stores.antigravityQuota,
      stores.claudeQuota,
      stores.codexQuota,
      stores.kimiQuota,
      stores.xaiQuota,
    ];

    records.forEach((record) => {
      expect(Object.keys(record).length).toBeGreaterThan(0);
      Object.entries(record).forEach(([storeKey, state]) => {
        expect(filesByKey.has(storeKey)).toBe(true);
        expect(state.authFileKey).toBe(storeKey);
        expect(state.authFileIdentityVerified).toBe(true);
      });
    });
  });
});
