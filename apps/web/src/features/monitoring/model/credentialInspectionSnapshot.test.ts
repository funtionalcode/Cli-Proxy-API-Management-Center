import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CODEX_INSPECTION_SETTINGS,
  type CodexInspectionRunResult,
} from '@/features/monitoring/codexInspection';
import type { CodexInspectionRunDetail } from '@/services/api';
import {
  createLocalCredentialInspectionSnapshot,
  createServerCredentialInspectionSnapshot,
  isCompletedCredentialInspectionRun,
  selectLatestCredentialInspectionSnapshot,
} from './credentialInspectionSnapshot';

const localResult = {
  settings: {
    ...DEFAULT_CODEX_INSPECTION_SETTINGS,
    baseUrl: 'http://cpa.local:8317',
    token: 'test-token',
  },
  files: [],
  startedAt: 100,
  finishedAt: 200,
  summary: {
    totalFiles: 1,
    probeSetCount: 1,
    sampledCount: 1,
    disabledCount: 0,
    enabledCount: 0,
    deleteCount: 0,
    disableCount: 0,
    enableCount: 0,
    reauthCount: 1,
    keepCount: 0,
    usedPercentThreshold: 100,
    sampled: false,
    plannedActionPreview: [],
  },
  results: [
    {
      key: 'local.json::auth-1',
      runtimeId: 'runtime-local-1',
      fileName: 'local.json',
      displayAccount: 'local@example.com',
      accountSnapshot: 'local@example.com',
      authIndex: 'auth-1',
      accountId: null,
      provider: 'codex',
      disabled: false,
      autoRecoverOwned: false,
      status: 'error',
      state: 'error',
      raw: { id: 'runtime-local-1', name: 'local.json', account: 'local@example.com' },
      action: 'reauth',
      actionReason: 'expired',
      statusCode: 401,
      usedPercent: null,
      isQuota: false,
      autoRecoverEligible: false,
      error: 'expired',
    },
  ],
} as CodexInspectionRunResult;

const serverDetail = {
  run: {
    id: 7,
    triggerType: 'manual',
    status: 'completed',
    startedAtMs: 250,
    finishedAtMs: 300,
    totalFiles: 1,
    probeSetCount: 1,
    sampledCount: 1,
    disabledCount: 0,
    enabledCount: 0,
    deleteCount: 0,
    disableCount: 1,
    enableCount: 0,
    reauthCount: 0,
    keepCount: 0,
    createdAtMs: 250,
    updatedAtMs: 300,
  },
  results: [
    {
      id: 9,
      runId: 7,
      accountKey: 'server.json::auth-2',
      fileName: 'server.json',
      displayAccount: 'server@example.com',
      authIndex: 'auth-2',
      provider: 'codex',
      disabled: false,
      action: 'disable',
      actionReason: 'quota exhausted',
      isQuota: true,
      createdAtMs: 300,
    },
  ],
  logs: [],
} as CodexInspectionRunDetail;

describe('credentialInspectionSnapshot', () => {
  it('normalizes local and server results with their source', () => {
    const local = createLocalCredentialInspectionSnapshot(localResult, 210);
    const server = createServerCredentialInspectionSnapshot(serverDetail, [serverDetail.run]);

    expect(local.results[0]).toMatchObject({
      fileName: 'local.json',
      runtimeId: 'runtime-local-1',
      accountSnapshot: 'local@example.com',
      inspectionSource: 'local',
      actionStatus: 'pending',
    });
    expect(server.results[0]).toMatchObject({
      fileName: 'server.json',
      inspectionSource: 'server',
    });
  });

  it('selects the most recently completed inspection snapshot', () => {
    const local = createLocalCredentialInspectionSnapshot(localResult, 210);
    const server = createServerCredentialInspectionSnapshot(serverDetail, [serverDetail.run]);

    expect(selectLatestCredentialInspectionSnapshot([server, local])?.source).toBe('server');
    expect(selectLatestCredentialInspectionSnapshot([server, { ...local, completedAtMs: 400 }]))
      .toMatchObject({ source: 'local', completedAtMs: 400 });
  });

  it('accepts only finished server runs as snapshot candidates', () => {
    expect(isCompletedCredentialInspectionRun(serverDetail.run)).toBe(true);
    expect(
      isCompletedCredentialInspectionRun({
        ...serverDetail.run,
        status: 'running',
        finishedAtMs: undefined,
      })
    ).toBe(false);
  });
});
