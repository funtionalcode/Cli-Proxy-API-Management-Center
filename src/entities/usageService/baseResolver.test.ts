import { describe, expect, it, vi } from 'vitest';
import {
  buildUsageServiceBaseCandidates,
  hasConfiguredUsageServiceBase,
  resolveUsageServiceBase,
} from './baseResolver';

describe('usageService base resolver', () => {
  it('builds normalized unique candidates with configured service first', () => {
    expect(
      buildUsageServiceBaseCandidates({
        apiBase: 'http://panel.local:9090/',
        usageServiceEnabled: true,
        usageServiceBase: 'http://usage.local:18317/',
        detectedBase: 'http://panel.local:9090',
      })
    ).toEqual(['http://usage.local:18317', 'http://panel.local:9090']);
  });

  it('detects whether a configured service base is available', () => {
    expect(
      hasConfiguredUsageServiceBase({
        usageServiceEnabled: true,
        usageServiceBase: 'http://usage.local:18317/',
      })
    ).toBe(true);
    expect(
      hasConfiguredUsageServiceBase({
        usageServiceEnabled: false,
        usageServiceBase: 'http://usage.local:18317/',
      })
    ).toBe(false);
  });

  it('returns configured service base without probing', async () => {
    const getInfo = vi.fn();

    await expect(
      resolveUsageServiceBase(
        {
          usageServiceEnabled: true,
          usageServiceBase: 'http://usage.local:18317/',
          detectedBase: '',
        },
        { getInfo }
      )
    ).resolves.toBe('http://usage.local:18317');

    expect(getInfo).not.toHaveBeenCalled();
  });

  it('probes candidates and returns the first Usage Service', async () => {
    const getInfo = vi
      .fn()
      .mockRejectedValueOnce(new Error('regular cpa panel'))
      .mockResolvedValueOnce({ service: 'cpa-manager-plus' });

    await expect(
      resolveUsageServiceBase(
        {
          apiBase: 'http://panel.local:9090',
          detectedBase: 'http://usage.local:18317',
        },
        { getInfo }
      )
    ).resolves.toBe('http://usage.local:18317');

    expect(getInfo).toHaveBeenCalledWith('http://panel.local:9090');
    expect(getInfo).toHaveBeenCalledWith('http://usage.local:18317');
  });

  it('returns empty string when no candidate is a Usage Service', async () => {
    const getInfo = vi.fn().mockResolvedValue({ service: 'cli-proxy-api' });

    await expect(
      resolveUsageServiceBase(
        {
          apiBase: 'http://panel.local:9090',
          detectedBase: 'http://other.local:18317',
        },
        { getInfo }
      )
    ).resolves.toBe('');
  });
});
