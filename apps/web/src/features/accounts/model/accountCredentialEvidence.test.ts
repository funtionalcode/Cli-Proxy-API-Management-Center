import { describe, expect, it } from 'vitest';
import type { AuthFileItem, CodexQuotaState } from '@/types';
import {
  buildInspectionCodexQuotaState,
  getAccountCredentialEvidenceCutoffs,
  getEffectiveAccountInspectionAction,
  hasPendingAccountInspectionAction,
  reconcileCodexQuotaEvidence,
  stripSupersededAccountInspectionStatus,
  type AccountInspectionSummary,
} from './accountCredentialEvidence';

const file: AuthFileItem = {
  name: 'shared.json',
  provider: 'codex',
  authIndex: 'codex-1',
};

const inspection = (
  overrides: Partial<AccountInspectionSummary> = {}
): AccountInspectionSummary => ({
  source: 'server',
  disabled: false,
  action: 'keep',
  actionReason: '',
  actionStatus: 'none',
  executedAction: '',
  statusCode: 200,
  usedPercent: 30,
  isQuota: false,
  planType: 'plus',
  quotaWindows: [
    {
      id: 'weekly',
      labelKey: 'codex_quota.secondary_window',
      usedPercent: 30,
      resetLabel: 'later',
      resetAtMs: 20_000,
      resetAccuracy: 'exact',
      limitWindowSeconds: 604_800,
    },
  ],
  error: '',
  errorKind: '',
  runId: 1,
  resultId: 1,
  createdAtMs: 2_000,
  ...overrides,
});

const providerQuota = (overrides: Partial<CodexQuotaState> = {}): CodexQuotaState => ({
  status: 'success',
  windows: [
    {
      id: 'weekly',
      label: 'Weekly',
      usedPercent: 100,
      resetLabel: 'old',
      observedAtMs: 1_000,
    },
  ],
  quotaInventoryObserved: true,
  fetchedAtMs: 1_000,
  ...overrides,
});

describe('account credential evidence', () => {
  it('removes superseded inspection status while retaining valid quota evidence', () => {
    const stale = inspection({
      disabled: true,
      action: 'disable',
      actionReason: 'quota exhausted',
      actionStatus: 'pending',
      statusCode: 429,
      isQuota: true,
    });

    const retained = stripSupersededAccountInspectionStatus(stale, stale.createdAtMs + 1);

    expect(retained).toMatchObject({
      disabled: undefined,
      action: 'keep',
      actionReason: '',
      actionStatus: 'resolved',
      executedAction: '',
      statusCode: 429,
      quotaWindows: stale.quotaWindows,
    });
    expect(hasPendingAccountInspectionAction(retained)).toBe(false);
    expect(buildInspectionCodexQuotaState(file, retained)).toMatchObject({
      status: 'success',
      windows: [expect.objectContaining({ id: 'weekly', usedPercent: 30 })],
    });
  });

  it('lets a newer healthy inspection replace an older cached 401 and quota limit', () => {
    const old401 = providerQuota({
      status: 'error',
      error: 'HTTP 401',
      errorStatus: 401,
      failedAtMs: 1_000,
      observedFromUsageHeaders: true,
      observedErrorKind: 'auth_invalid',
      observedErrorCode: 'token_expired',
      rateLimitReachedType: 'secondary',
    });
    const inspectionQuota = buildInspectionCodexQuotaState(file, inspection());

    const result = reconcileCodexQuotaEvidence({
      providerQuota: old401,
      inspectionQuota,
    });

    expect(result?.status).toBe('success');
    expect(result?.errorStatus).toBeUndefined();
    expect(result?.observedFromUsageHeaders).toBeUndefined();
    expect(result?.observedErrorKind).toBeUndefined();
    expect(result?.observedErrorCode).toBeUndefined();
    expect(result?.rateLimitReachedType).toBeUndefined();
    expect(result?.windows[0]).toMatchObject({
      id: 'weekly',
      usedPercent: 30,
      resetAtMs: 20_000,
      observationSource: 'inspection',
    });
  });

  it('keeps a newer provider 401 ahead of an older healthy inspection', () => {
    const result = reconcileCodexQuotaEvidence({
      providerQuota: providerQuota({
        status: 'error',
        error: 'HTTP 401',
        errorStatus: 401,
        failedAtMs: 3_000,
      }),
      inspectionQuota: buildInspectionCodexQuotaState(file, inspection()),
    });

    expect(result?.status).toBe('error');
    expect(result?.errorStatus).toBe(401);
  });

  it.each([402, 429])('synchronizes quota evidence returned with HTTP %s', (statusCode) => {
    const result = buildInspectionCodexQuotaState(file, inspection({ statusCode, isQuota: true }));

    expect(result).toMatchObject({
      status: 'success',
      quotaInventoryObserved: true,
      observedAtMs: 2_000,
      rateLimitReachedType: 'inspection',
    });
    expect(result?.windows[0]).toMatchObject({
      id: 'weekly',
      usedPercent: 30,
      observationSource: 'inspection',
    });
  });

  it('keeps non-quota HTTP failures from becoming healthy through an empty observed inventory', () => {
    const failedInspection = inspection({
      actionReason: 'quota response unavailable',
      statusCode: 429,
      usedPercent: null,
      isQuota: false,
      quotaWindows: [],
      quotaInventoryObserved: true,
    });
    const inspectionQuota = buildInspectionCodexQuotaState(file, failedInspection);

    expect(inspectionQuota).toMatchObject({
      status: 'error',
      windows: [],
      error: 'quota response unavailable',
      errorStatus: 429,
      failedAtMs: 2_000,
      quotaInventoryObserved: true,
    });
    expect(
      reconcileCodexQuotaEvidence({
        providerQuota: providerQuota(),
        inspectionQuota,
      })
    ).toMatchObject({
      status: 'error',
      errorStatus: 429,
      windows: [expect.objectContaining({ id: 'weekly', usedPercent: 100 })],
    });
    expect(getAccountCredentialEvidenceCutoffs({ inspection: failedInspection })).toEqual({
      authenticationAtMs: 2_000,
      healthyQuotaAtMs: 0,
    });
  });

  it('does not use quota-limited inspection evidence as a healthy quota cutoff', () => {
    const quotaLimitedInspection = inspection({ statusCode: 429, isQuota: true });

    expect(getAccountCredentialEvidenceCutoffs({ inspection: quotaLimitedInspection })).toEqual({
      authenticationAtMs: 2_000,
      healthyQuotaAtMs: 0,
    });
  });

  it('normalizes derived inspection reset accuracy to estimated display evidence', () => {
    const result = buildInspectionCodexQuotaState(
      file,
      inspection({
        quotaWindows: [
          {
            id: 'five-hour',
            labelKey: 'codex_quota.primary_window',
            usedPercent: 30,
            resetLabel: 'later',
            resetAtMs: 20_000,
            resetAccuracy: 'derived',
            limitWindowSeconds: 18_000,
          },
        ],
      })
    );

    expect(result?.windows[0]?.resetAccuracy).toBe('estimated');
  });

  it('replaces unmatched stale Provider windows with a newer inspection inventory', () => {
    const inspectionQuota = buildInspectionCodexQuotaState(
      file,
      inspection({
        usedPercent: 20,
        quotaWindows: [
          {
            id: 'five-hour',
            labelKey: 'codex_quota.primary_window',
            usedPercent: 20,
            resetLabel: 'soon',
            resetAtMs: 10_000,
            resetAccuracy: 'exact',
            limitWindowSeconds: 18_000,
          },
        ],
      })
    );

    const result = reconcileCodexQuotaEvidence({
      providerQuota: providerQuota(),
      inspectionQuota,
    });

    expect(result?.windows).toEqual([
      expect.objectContaining({ id: 'five-hour', usedPercent: 20 }),
    ]);
  });

  it('lets a newer explicitly empty inspection inventory clear stale exhausted windows', () => {
    const inspectionQuota = buildInspectionCodexQuotaState(
      file,
      inspection({
        usedPercent: null,
        quotaWindows: [],
        quotaInventoryObserved: true,
      })
    );

    const result = reconcileCodexQuotaEvidence({
      providerQuota: providerQuota(),
      inspectionQuota,
    });

    expect(inspectionQuota).toMatchObject({
      status: 'success',
      windows: [],
      quotaInventoryObserved: true,
    });
    expect(result).toMatchObject({
      status: 'success',
      windows: [],
      quotaInventoryObserved: true,
    });
  });

  it('uses a credential boundary to discard all older quota evidence', () => {
    const result = reconcileCodexQuotaEvidence({
      providerQuota: providerQuota(),
      inspectionQuota: buildInspectionCodexQuotaState(file, inspection()),
      boundaryAtMs: 3_000,
    });

    expect(result).toBeUndefined();
  });

  it.each([1_000, undefined])(
    'discards a persisted Provider 401 at or without timestamp after credential refresh: %s',
    (failedAtMs) => {
      const result = reconcileCodexQuotaEvidence({
        providerQuota: providerQuota({
          status: 'error',
          windows: [],
          error: 'HTTP 401',
          errorStatus: 401,
          failedAtMs,
        }),
        credentialRefreshAtMs: 1_000,
      });

      expect(result).toBeUndefined();
    }
  );

  it('does not use credential refresh alone to discard quota-limit evidence', () => {
    const result = reconcileCodexQuotaEvidence({
      providerQuota: providerQuota({ fetchedAtMs: 1_000 }),
      credentialRefreshAtMs: 2_000,
    });

    expect(result?.status).toBe('success');
    expect(result?.windows[0]?.usedPercent).toBe(100);
  });

  it('lets a same-timestamp Provider success supersede Header limit metadata', () => {
    const result = reconcileCodexQuotaEvidence({
      headerQuota: providerQuota({
        fetchedAtMs: undefined,
        observedAtMs: 2_000,
        observedFromUsageHeaders: true,
        observedErrorKind: 'rate_limit',
        observedErrorCode: 'usage_limit_reached',
        rateLimitReachedType: 'secondary',
      }),
      providerQuota: providerQuota({
        fetchedAtMs: 2_000,
        windows: [
          {
            id: 'weekly',
            label: 'Weekly',
            usedPercent: 30,
            resetLabel: 'new',
            observedAtMs: 2_000,
          },
        ],
      }),
    });

    expect(result?.windows[0]?.usedPercent).toBe(30);
    expect(result?.observedFromUsageHeaders).toBeUndefined();
    expect(result?.observedErrorKind).toBeUndefined();
    expect(result?.observedErrorCode).toBeUndefined();
    expect(result?.rateLimitReachedType).toBeUndefined();
  });

  it('treats successfully executed inspection actions as handled', () => {
    const handled = inspection({ action: 'enable', actionStatus: 'success' });

    expect(hasPendingAccountInspectionAction(handled)).toBe(false);
    expect(getEffectiveAccountInspectionAction(handled)).toBe('keep');
  });

  it('does not turn a handled inspection 401 back into a reauth quota error', () => {
    const handled = inspection({
      action: 'reauth',
      actionStatus: 'success',
      statusCode: 401,
      usedPercent: null,
      quotaWindows: [],
    });

    expect(hasPendingAccountInspectionAction(handled)).toBe(false);
    expect(buildInspectionCodexQuotaState(file, handled)).toBeUndefined();
  });

  it('does not treat a null-status request failure as authentication recovery', () => {
    const failedInspection = inspection({
      action: 'keep',
      actionStatus: 'success',
      statusCode: null,
      usedPercent: null,
      isQuota: false,
      quotaWindows: [],
      error: 'request failed',
      errorKind: 'network_error',
      createdAtMs: 4_000,
    });

    expect(buildInspectionCodexQuotaState(file, failedInspection)).toBeUndefined();
    expect(getAccountCredentialEvidenceCutoffs({ inspection: failedInspection })).toEqual({
      authenticationAtMs: 0,
      healthyQuotaAtMs: 0,
    });
  });

  it('does not let a transient provider failure prove authentication recovery', () => {
    const cutoffs = getAccountCredentialEvidenceCutoffs({
      providerQuota: providerQuota({
        status: 'error',
        error: 'temporary failure',
        errorStatus: 503,
        failedAtMs: 4_000,
      }),
      inspection: inspection({
        action: 'reauth',
        actionStatus: 'pending',
        statusCode: 401,
        createdAtMs: 2_000,
      }),
    });

    expect(cutoffs).toEqual({ authenticationAtMs: 0, healthyQuotaAtMs: 0 });
  });

  it('uses credential refresh only as an authentication cutoff', () => {
    const cutoffs = getAccountCredentialEvidenceCutoffs({ credentialRefreshAtMs: 4_000 });

    expect(cutoffs).toEqual({ authenticationAtMs: 4_000, healthyQuotaAtMs: 0 });
  });

  it('uses healthy Header quota as authentication and quota recovery evidence', () => {
    const cutoffs = getAccountCredentialEvidenceCutoffs({
      headerQuota: providerQuota({
        windows: [
          {
            id: 'weekly',
            label: 'Weekly',
            usedPercent: 30,
            resetLabel: 'later',
            observedAtMs: 4_000,
          },
        ],
        quotaInventoryObserved: false,
        fetchedAtMs: undefined,
        observedAtMs: 4_000,
        observedFromUsageHeaders: true,
      }),
    });

    expect(cutoffs).toEqual({ authenticationAtMs: 4_000, healthyQuotaAtMs: 4_000 });
  });

  it('uses explicit Header quota-limit evidence only as authentication recovery', () => {
    const cutoffs = getAccountCredentialEvidenceCutoffs({
      headerQuota: providerQuota({
        fetchedAtMs: undefined,
        observedAtMs: 4_000,
        observedFromUsageHeaders: true,
        observedErrorKind: 'rate_limit',
        observedErrorCode: 'usage_limit_reached',
      }),
    });

    expect(cutoffs).toEqual({ authenticationAtMs: 4_000, healthyQuotaAtMs: 0 });
  });

  it('does not let a plan-only Header snapshot clear reauth evidence', () => {
    const cutoffs = getAccountCredentialEvidenceCutoffs({
      headerQuota: providerQuota({
        windows: [],
        quotaInventoryObserved: false,
        planType: 'plus',
        fetchedAtMs: undefined,
        observedAtMs: 4_000,
        observedFromUsageHeaders: true,
      }),
    });

    expect(cutoffs).toEqual({ authenticationAtMs: 0, healthyQuotaAtMs: 0 });
  });

  it.each([
    { planType: 'plus' },
    { observedErrorKind: 'rate_limit', observedErrorCode: 'retry_after' },
    { observedErrorKind: 'upstream_error', observedErrorCode: 'bad_gateway' },
  ])('keeps an older 401 ahead of weak Header evidence: %o', (headerMetadata) => {
    const result = reconcileCodexQuotaEvidence({
      inspectionQuota: buildInspectionCodexQuotaState(
        file,
        inspection({
          action: 'reauth',
          actionStatus: 'pending',
          statusCode: 401,
          usedPercent: null,
          quotaWindows: [],
          createdAtMs: 2_000,
        })
      ),
      headerQuota: providerQuota({
        windows: [],
        quotaInventoryObserved: false,
        fetchedAtMs: undefined,
        observedAtMs: 4_000,
        observedFromUsageHeaders: true,
        ...headerMetadata,
      }),
    });

    expect(result).toMatchObject({ status: 'error', errorStatus: 401, failedAtMs: 2_000 });
  });

  it('does not let generic Header errors clear reauth when quota metadata is also present', () => {
    const result = reconcileCodexQuotaEvidence({
      inspectionQuota: buildInspectionCodexQuotaState(
        file,
        inspection({
          action: 'reauth',
          actionStatus: 'pending',
          statusCode: 401,
          usedPercent: null,
          quotaWindows: [],
          createdAtMs: 2_000,
        })
      ),
      headerQuota: providerQuota({
        windows: [
          {
            id: 'weekly',
            label: 'Weekly',
            usedPercent: 30,
            resetLabel: 'later',
            observedAtMs: 4_000,
          },
        ],
        fetchedAtMs: undefined,
        observedAtMs: 4_000,
        observedFromUsageHeaders: true,
        observedErrorKind: 'upstream_error',
        observedErrorCode: 'bad_gateway',
      }),
    });

    expect(result).toMatchObject({ status: 'error', errorStatus: 401, failedAtMs: 2_000 });
  });

  it.each([
    { observedErrorKind: 'auth_invalid', observedErrorCode: 'token_expired' },
    { observedErrorKind: 'upstream_error', observedErrorCode: 'bad_gateway' },
  ])('does not let Header error metadata clear reauth evidence: $observedErrorKind', (error) => {
    const cutoffs = getAccountCredentialEvidenceCutoffs({
      headerQuota: providerQuota({
        windows: [],
        quotaInventoryObserved: false,
        planType: 'plus',
        fetchedAtMs: undefined,
        observedAtMs: 4_000,
        observedFromUsageHeaders: true,
        ...error,
      }),
    });

    expect(cutoffs).toEqual({ authenticationAtMs: 0, healthyQuotaAtMs: 0 });
  });
});
