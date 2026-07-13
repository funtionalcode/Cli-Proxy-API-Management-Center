import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchXaiQuota } from '@/utils/quota';
import type { XaiBillingSummary } from '@/types';
import { DEFAULT_GROK_INSPECTION_SETTINGS } from '@/features/monitoring/grokInspection';
import { inspectSingleGrokAccount, toGrokInspectionAccount } from './grokInspectionProbe';

vi.mock('@/utils/quota', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/quota')>();
  return {
    ...actual,
    fetchXaiQuota: vi.fn(),
  };
});

const mockFetchXaiQuota = vi.mocked(fetchXaiQuota);

const settings = {
  baseUrl: '',
  token: '',
  ...DEFAULT_GROK_INSPECTION_SETTINGS,
  usedPercentThreshold: 90,
};

const createBilling = (overrides: Partial<XaiBillingSummary> = {}): XaiBillingSummary => ({
  periodType: 'weekly',
  usagePercent: 25,
  periodStart: '2026-07-01T00:00:00Z',
  periodEnd: '2026-07-08T00:00:00Z',
  productUsage: [{ product: 'Grok 4', usagePercent: 30 }],
  monthlyLimitCents: 10000,
  usedCents: 2500,
  includedUsedCents: 2500,
  onDemandCapCents: 5000,
  onDemandUsedCents: 0,
  onDemandUsedPercent: 0,
  billingPeriodStart: '2026-07-01T00:00:00Z',
  billingPeriodEnd: '2026-08-01T00:00:00Z',
  usedPercent: 25,
  ...overrides,
});

const baseAccount = toGrokInspectionAccount({
  name: 'xai-auth.json',
  type: 'xai',
  auth_index: 'xai-1',
  account: 'grok@example.test',
});

const createStatusError = (status: number, message: string) =>
  Object.assign(new Error(message), { status });

describe('inspectSingleGrokAccount', () => {
  beforeEach(() => {
    mockFetchXaiQuota.mockReset();
  });

  it('keeps an enabled Grok account when billing quota is available', async () => {
    mockFetchXaiQuota.mockResolvedValue(createBilling());

    const result = await inspectSingleGrokAccount(baseAccount, settings);

    expect(result.action).toBe('keep');
    expect(result.actionReason).toBe('Grok 额度仍可用，无需处理');
    expect(result.statusCode).toBe(200);
    expect(result.usedPercent).toBe(30);
    expect(result.quotaWindows).toEqual([
      expect.objectContaining({ id: 'weekly', usedPercent: 25 }),
      expect.objectContaining({ id: 'product-0', usedPercent: 30 }),
      expect.objectContaining({ id: 'monthly', usedPercent: 25 }),
      expect.objectContaining({ id: 'pay-as-you-go', usedPercent: 0 }),
    ]);
  });

  it('disables an enabled Grok account when any usage dimension reaches threshold', async () => {
    mockFetchXaiQuota.mockResolvedValue(
      createBilling({
        usagePercent: 40,
        productUsage: [{ product: 'Grok 4', usagePercent: 92 }],
        usedPercent: 70,
      })
    );

    const result = await inspectSingleGrokAccount(baseAccount, settings);

    expect(result.action).toBe('disable');
    expect(result.actionReason).toBe('Grok 额度达到阈值，建议禁用认证文件');
    expect(result.usedPercent).toBe(92);
    expect(result.isQuota).toBe(true);
  });

  it('keeps an over-threshold Grok account when it is already disabled', async () => {
    mockFetchXaiQuota.mockResolvedValue(createBilling({ usedPercent: 100 }));

    const result = await inspectSingleGrokAccount(
      toGrokInspectionAccount({
        name: 'xai-disabled.json',
        type: 'xai',
        authIndex: 'xai-disabled',
        disabled: true,
      }),
      settings
    );

    expect(result.action).toBe('keep');
    expect(result.actionReason).toBe('Grok 额度达到阈值，但认证文件已禁用');
    expect(result.usedPercent).toBe(100);
  });

  it('marks 401 and 403 responses as reauth suggestions', async () => {
    mockFetchXaiQuota.mockRejectedValue(createStatusError(401, '401 unauthorized'));

    const result = await inspectSingleGrokAccount(baseAccount, settings);

    expect(result.action).toBe('reauth');
    expect(result.statusCode).toBe(401);
    expect(result.errorKind).toBe('auth_failed');
    expect(result.actionReason).toContain('建议重新登录或删除认证文件');
  });

  it('marks unavailable Grok auth files as delete suggestions', async () => {
    mockFetchXaiQuota.mockRejectedValue(createStatusError(404, '404 not found'));

    const result = await inspectSingleGrokAccount(baseAccount, settings);

    expect(result.action).toBe('delete');
    expect(result.statusCode).toBe(404);
    expect(result.errorKind).toBe('auth_unavailable');
  });

  it('keeps Grok files without auth_index', async () => {
    const result = await inspectSingleGrokAccount(
      toGrokInspectionAccount({
        name: 'xai-missing.json',
        type: 'xai',
      }),
      settings
    );

    expect(result.action).toBe('keep');
    expect(result.errorKind).toBe('missing_auth_index');
    expect(mockFetchXaiQuota).not.toHaveBeenCalled();
  });
});
