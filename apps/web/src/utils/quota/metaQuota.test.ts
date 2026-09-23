import { describe, expect, it } from 'vitest';
import type { ApiCallRequest, ApiCallResult } from '@/services/api/apiCall';
import type { AuthFileItem } from '@/types';
import {
  createMetaQuotaFetcher,
  META_MUSE_QUOTA_URL,
  MetaQuotaError,
  parseMetaQuotaPayload,
} from './metaQuota';

const makeFile = (authIndex?: string | number, extra: Partial<AuthFileItem> = {}): AuthFileItem => ({
  name: 'meta.json',
  provider: 'meta',
  authIndex,
  ...extra,
});

const makeResult = (statusCode: number, body: unknown): ApiCallResult => ({
  statusCode,
  hasStatusCode: true,
  header: {},
  bodyText: typeof body === 'string' ? body : JSON.stringify(body),
  body,
});

const defaults = {
  downloadText: async () =>
    JSON.stringify({ dca_token: 'dca:fixture-only', api_key: 'LLM|unused' }),
  captureCurrent: () => () => true,
  request: async () => makeResult(200, { subs_usage: { weekly: { used_percent: 1 } } }),
};

const expectMetaError = async (promise: Promise<unknown>, code: string, status?: number) => {
  try {
    await promise;
    throw new Error('expected request to reject');
  } catch (error) {
    expect(error).toBeInstanceOf(MetaQuotaError);
    expect((error as MetaQuotaError).code).toBe(code);
    expect((error as MetaQuotaError).status).toBe(status);
    return error as MetaQuotaError;
  }
};

describe('parseMetaQuotaPayload', () => {
  it('parses valid payload with window and weekly usage and computes exact properties', () => {
    const raw = {
      subs_tier_name: 'Pro Tier',
      is_subs_active: true,
      subs_usage: {
        tier: 'Pro Tier Usage',
        window: {
          used_percent: 42.5,
          resets_at: 1774000000,
          window_duration_mins: 300,
        },
        weekly: {
          used_percent: '15.0',
          resets_at: 1774500000,
        },
      },
      api_key: 'LLM|secret-key',
      user_email: 'user@example.com',
    };

    const fixedNow = 1773000000000;
    const result = parseMetaQuotaPayload(raw, { observedAtMs: fixedNow });
    expect(result).not.toBeNull();
    expect(result?.plan).toBe('Pro Tier');
    expect(result?.isSubscriptionActive).toBe(true);
    expect(result?.quotaInventoryObserved).toBe(true);
    expect(result?.observedAtMs).toBe(fixedNow);

    const [window, weekly] = result!.windows;

    expect(window.id).toBe('window');
    expect(window.usedPercent).toBe(42.5);
    expect(window.resetAtMs).toBe(1774000000000);
    expect(window.resetAccuracy).toBe('exact');
    expect(window.limitWindowSeconds).toBe(18000); // 300 * 60
    expect(window.quotaProgressObservedAtMs).toBe(fixedNow);

    expect(weekly.id).toBe('weekly');
    expect(weekly.usedPercent).toBe(15.0);
    expect(weekly.resetAtMs).toBe(1774500000000);
    expect(weekly.resetAccuracy).toBe('exact');
    expect(weekly.limitWindowSeconds).toBeNull(); // Weekly never assumes 7 days!
    expect(weekly.quotaProgressObservedAtMs).toBe(fixedNow);

    // Ensure secrets are NOT leaked in output
    const json = JSON.stringify(result);
    expect(json).not.toContain('LLM|secret-key');
    expect(json).not.toContain('user@example.com');
  });

  it('falls back to subs_usage.tier if subs_tier_name is absent or empty', () => {
    const result1 = parseMetaQuotaPayload({
      subs_tier_name: '  ',
      subs_usage: { tier: 'Fallback Tier' },
    });
    expect(result1?.plan).toBe('Fallback Tier');

    const result2 = parseMetaQuotaPayload({
      subs_usage: { tier: ' ' },
    });
    expect(result2?.plan).toBeNull();
  });

  it('handles boolean is_subs_active correctly and rejects non-boolean', () => {
    expect(parseMetaQuotaPayload({ is_subs_active: true })?.isSubscriptionActive).toBe(true);
    expect(parseMetaQuotaPayload({ is_subs_active: false })?.isSubscriptionActive).toBe(false);
    expect(parseMetaQuotaPayload({ is_subs_active: 'true' })?.isSubscriptionActive).toBeNull();
    expect(parseMetaQuotaPayload({ is_subs_active: null })?.isSubscriptionActive).toBeNull();
  });

  it('clamps used_percent to [0, 100]', () => {
    const raw = {
      subs_usage: {
        window: { used_percent: -5 },
        weekly: { used_percent: 150 },
      },
    };
    const result = parseMetaQuotaPayload(raw);
    expect(result?.windows[0].usedPercent).toBe(0);
    expect(result?.windows[1].usedPercent).toBe(100);
  });

  it('treats invalid used_percent as null and quotaProgressObservedAtMs as null', () => {
    for (const invalid of [null, undefined, '', 'abc', NaN, Infinity, false, [], {}]) {
      const result = parseMetaQuotaPayload({
        subs_usage: {
          window: { used_percent: invalid },
        },
      });
      expect(result?.windows[0].usedPercent).toBeNull();
      expect(result?.windows[0].quotaProgressObservedAtMs).toBeNull();
    }
  });

  it('converts resets_at from unix seconds to milliseconds and sets accuracy', () => {
    const result = parseMetaQuotaPayload({
      subs_usage: {
        window: { resets_at: 1770000000 },
        weekly: { resets_at: -10 },
      },
    });
    expect(result?.windows[0].resetAtMs).toBe(1770000000000);
    expect(result?.windows[0].resetAccuracy).toBe('exact');
    expect(result?.windows[1].resetAtMs).toBeNull();
    expect(result?.windows[1].resetAccuracy).toBe('unknown');
  });

  it('handles successful responses with missing subs_usage as success unknown', () => {
    for (const body of [{}, { api_key: 'key-only' }, { subs_usage: null }]) {
      const result = parseMetaQuotaPayload(body);
      expect(result).not.toBeNull();
      expect(result?.quotaInventoryObserved).toBe(false);
      expect(result?.windows[0].usedPercent).toBeNull();
      expect(result?.windows[0].quotaProgressObservedAtMs).toBeNull();
      expect(result?.windows[1].usedPercent).toBeNull();
      expect(result?.windows[1].quotaProgressObservedAtMs).toBeNull();
    }
  });

  it('marks quotaInventoryObserved true when subs_usage is an empty object', () => {
    const result = parseMetaQuotaPayload({ subs_usage: {} });
    expect(result).not.toBeNull();
    expect(result?.quotaInventoryObserved).toBe(true);
  });

  it('returns null for malformed or non-object payloads', () => {
    for (const invalid of [null, undefined, [], 42, '<html>not json</html>', '{broken json']) {
      expect(parseMetaQuotaPayload(invalid)).toBeNull();
    }
  });

  it('parses JSON string payload correctly', () => {
    const str = JSON.stringify({
      subs_tier_name: 'JSON Tier',
      subs_usage: { window: { used_percent: 20 } },
    });
    const result = parseMetaQuotaPayload(str);
    expect(result?.plan).toBe('JSON Tier');
    expect(result?.windows[0].usedPercent).toBe(20);
  });
});

describe('createMetaQuotaFetcher', () => {
  it('downloads named auth file and sends its DCA through api-call, not $TOKEN$', async () => {
    const requests: ApiCallRequest[] = [];
    const names: string[] = [];

    const fetchQuota = createMetaQuotaFetcher({
      ...defaults,
      downloadText: async (name) => {
        names.push(name);
        return JSON.stringify({ dca_token: ' dca:fixture-only ', api_key: 'LLM|unused' });
      },
      request: async (request) => {
        requests.push(request);
        return makeResult(200, {
          subs_usage: {
            window: { used_percent: 0, window_duration_mins: 300 },
            weekly: { used_percent: 1 },
          },
          api_key: 'must-not-propagate',
          user_email: 'fixture@example.invalid',
        });
      },
    });

    const quota = await fetchQuota(makeFile(' 007 '));
    expect(names).toEqual(['meta.json']);
    expect(requests).toEqual([
      {
        authIndex: '007',
        method: 'POST',
        url: META_MUSE_QUOTA_URL,
        header: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: 'Bearer dca:fixture-only',
          'x-api-version': '1.0.0',
        },
        data: '{}',
      },
    ]);

    for (const secret of ['dca:', 'LLM|', 'must-not-propagate', 'fixture@example.invalid']) {
      expect(JSON.stringify(quota)).not.toContain(secret);
    }
  });

  it('rejects missing identity and runtime-only files before downloading', async () => {
    let calls = 0;
    const fetchQuota = createMetaQuotaFetcher({
      ...defaults,
      downloadText: async () => {
        calls++;
        return '{}';
      },
    });

    await expectMetaError(fetchQuota(makeFile(undefined)), 'missing_auth_index');
    await expectMetaError(fetchQuota(makeFile('1', { name: '' })), 'missing_file');
    await expectMetaError(fetchQuota(makeFile('1', { runtimeOnly: true })), 'missing_file');
    await expectMetaError(fetchQuota(makeFile('1', { runtime_only: 'true' })), 'missing_file');
    expect(calls).toBe(0);
  });

  it('rejects malformed files and missing DCA without falling back to another token', async () => {
    let calls = 0;
    for (const [text, code] of [
      ['{secret', 'invalid_auth_file'],
      ['null', 'invalid_auth_file'],
      ['[]', 'invalid_auth_file'],
      ['{"api_key":"LLM|fixture","access_token":"dca:unused"}', 'missing_dca_token'],
      ['{"dca_token":"LLM|wrong"}', 'missing_dca_token'],
      ['{"dca_token":"dca:"}', 'missing_dca_token'],
      ['{"dca_token":"dca:bad\\r\\nheader"}', 'missing_dca_token'],
    ]) {
      const fetchQuota = createMetaQuotaFetcher({
        ...defaults,
        downloadText: async () => text,
        request: async () => {
          calls++;
          return makeResult(200, {});
        },
      });
      const error = await expectMetaError(fetchQuota(makeFile('1')), code);
      expect(JSON.stringify(error)).not.toContain(text);
    }
    expect(calls).toBe(0);
  });

  it('redacts download failures', async () => {
    const fetchQuota = createMetaQuotaFetcher({
      ...defaults,
      downloadText: async () => {
        throw new Error('dca:secret');
      },
    });
    const error = await expectMetaError(fetchQuota(makeFile('1')), 'download_failed');
    expect(JSON.stringify(error)).not.toContain('dca:secret');
  });

  it('blocks sending the DCA after a connection or credential change during download', async () => {
    let current = true;
    let calls = 0;
    const fetchQuota = createMetaQuotaFetcher({
      ...defaults,
      captureCurrent: () => () => current,
      downloadText: async () => {
        current = false;
        return defaults.downloadText();
      },
      request: async () => {
        calls++;
        return makeResult(200, {});
      },
    });
    await expectMetaError(fetchQuota(makeFile('1')), 'stale_request');
    expect(calls).toBe(0);
  });

  it('discards a quota response after a connection or credential change', async () => {
    let current = true;
    const fetchQuota = createMetaQuotaFetcher({
      ...defaults,
      captureCurrent: () => () => current,
      request: async () => {
        current = false;
        return defaults.request();
      },
    });
    await expectMetaError(fetchQuota(makeFile('1')), 'stale_request');
  });

  it('supports QuotaFetchContext.isCurrent stale request fencing', async () => {
    let isCurrent = true;
    let requestSent = false;
    const fetchQuota = createMetaQuotaFetcher({
      ...defaults,
      downloadText: async () => {
        isCurrent = false;
        return defaults.downloadText();
      },
      request: async () => {
        requestSent = true;
        return defaults.request();
      },
    });

    await expectMetaError(
      fetchQuota(makeFile('1'), undefined, undefined, { isCurrent: () => isCurrent }),
      'stale_request'
    );
    expect(requestSent).toBe(false);
  });

  it('does not reuse DCA across refreshes', async () => {
    let downloads = 0;
    const headers: string[] = [];
    const fetchQuota = createMetaQuotaFetcher({
      ...defaults,
      downloadText: async () => JSON.stringify({ dca_token: `dca:fixture-${++downloads}` }),
      request: async (payload) => {
        headers.push(payload.header!.Authorization);
        return defaults.request();
      },
    });
    await fetchQuota(makeFile('1'));
    await fetchQuota(makeFile('1'));
    expect(headers).toEqual(['Bearer dca:fixture-1', 'Bearer dca:fixture-2']);
  });

  it('redacts upstream errors and management exceptions including request headers', async () => {
    for (const throws of [false, true]) {
      const fetchQuota = createMetaQuotaFetcher({
        ...defaults,
        request: async () => {
          if (throws) {
            throw Object.assign(new Error('dca:secret'), {
              status: 429,
              config: { Authorization: 'dca:secret' },
            });
          }
          return makeResult(429, { error: 'dca:secret', api_key: 'LLM|secret' });
        },
      });
      const error = await expectMetaError(fetchQuota(makeFile('1')), 'request_failed', 429);
      expect(error.message).toBe('request_failed');
      expect(JSON.stringify(error)).not.toContain('secret');
    }
  });

  it('returns unknown windows for successful responses without quota fields', async () => {
    for (const body of [{}, { api_key: 'fixture-only' }, { subs_usage: null }]) {
      const fetchQuota = createMetaQuotaFetcher({
        ...defaults,
        request: async () => makeResult(200, body),
      });
      const res = await fetchQuota(makeFile('1'));
      expect(res.windows[0].usedPercent).toBeNull();
      expect(res.windows[1].usedPercent).toBeNull();
      expect(res.quotaInventoryObserved).toBe(false);
    }
  });

  it('keeps malformed responses distinct from unknown quota without exposing the body', async () => {
    for (const body of ['<html>fixture-secret</html>', '{bad-json', null, [], 42]) {
      const fetchQuota = createMetaQuotaFetcher({
        ...defaults,
        request: async () => makeResult(200, body),
      });
      const error = await expectMetaError(fetchQuota(makeFile('1')), 'invalid_response');
      expect(JSON.stringify(error)).not.toContain('fixture-secret');
    }
  });

  it('does not treat unsuccessful or invalid status codes as unknown quota', async () => {
    for (const status of [0, NaN, 401, 403, 429, 500]) {
      const fetchQuota = createMetaQuotaFetcher({
        ...defaults,
        request: async () => makeResult(status, {}),
      });
      await expectMetaError(fetchQuota(makeFile('1')), 'request_failed', status);
    }
  });

  it('parses bodyText when the parsed body is absent', async () => {
    const fetchQuota = createMetaQuotaFetcher({
      ...defaults,
      request: async () => ({
        statusCode: 200,
        hasStatusCode: true,
        header: {},
        body: null,
        bodyText: '{"subs_usage":{"weekly":{"used_percent":12}}}',
      }),
    });
    expect((await fetchQuota(makeFile('1'))).windows[1].usedPercent).toBe(12);
  });
});
