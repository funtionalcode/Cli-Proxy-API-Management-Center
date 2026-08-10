import { describe, expect, it } from 'vitest';
import { beginAccountQuotaRequest } from './accountQuotaRequestGate';

describe('beginAccountQuotaRequest', () => {
  it('invalidates older requests for the same quota target only', () => {
    const versions = new Map<string, number>();
    const firstCodex = beginAccountQuotaRequest(versions, 'codex:shared');
    const xai = beginAccountQuotaRequest(versions, 'xai:shared');
    const secondCodex = beginAccountQuotaRequest(versions, 'codex:shared');

    expect(firstCodex()).toBe(false);
    expect(secondCodex()).toBe(true);
    expect(xai()).toBe(true);
  });
});
