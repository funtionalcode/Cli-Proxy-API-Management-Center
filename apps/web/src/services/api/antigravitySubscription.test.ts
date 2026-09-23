import { describe, expect, it, vi } from 'vitest';
import {
  antigravitySubscriptionApi,
  parseAntigravitySubscriptionSummary,
} from './antigravitySubscription';
import { apiCallApi } from './apiCall';

describe('parseAntigravitySubscriptionSummary', () => {
  it('parses g1-pro-tier as a Pro plan', () => {
    const summary = parseAntigravitySubscriptionSummary({
      currentTier: {
        id: 'free-tier',
        name: 'Antigravity',
      },
      paidTier: {
        id: 'g1-pro-tier',
        name: 'Antigravity Pro',
      },
    });

    expect(summary).toMatchObject({
      plan: 'pro',
      tierId: 'g1-pro-tier',
      tierName: 'Antigravity Pro',
      source: 'paid',
    });
  });

  it('parses free-tier subscription data from a proxied body string', () => {
    const summary = parseAntigravitySubscriptionSummary({
      body: JSON.stringify({
        currentTier: {
          id: 'free-tier',
          name: 'Antigravity',
        },
        paidTier: {
          id: 'free-tier',
          name: 'Antigravity Starter Quota',
        },
      }),
    });

    expect(summary).toMatchObject({
      plan: 'free',
      tierId: 'free-tier',
      tierName: 'Antigravity Starter Quota',
      source: 'paid',
      currentTier: {
        id: 'free-tier',
        name: 'Antigravity',
      },
      paidTier: {
        id: 'free-tier',
        name: 'Antigravity Starter Quota',
      },
    });
  });
});

describe('antigravitySubscriptionApi.get', () => {
  it('fails fast on 429 and does not attempt fallback URLs', async () => {
    const apiRequestSpy = vi.spyOn(apiCallApi, 'request').mockResolvedValueOnce({
      statusCode: 429,
      hasStatusCode: true,
      header: {},
      bodyText: 'Too Many Requests',
      body: null,
    });

    await expect(antigravitySubscriptionApi.get('ag-test-auth')).rejects.toMatchObject({
      status: 429,
    });

    expect(apiRequestSpy).toHaveBeenCalledTimes(1);
    apiRequestSpy.mockRestore();
  });
});
