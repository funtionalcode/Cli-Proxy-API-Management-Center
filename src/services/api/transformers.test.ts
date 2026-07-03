import { describe, expect, it } from 'vitest';
import { normalizeConfigResponse } from './transformers';

describe('normalizeConfigResponse', () => {
  it('normalizes success request log settings', () => {
    expect(
      normalizeConfigResponse({
        'request-log': true,
        'success-request-log': 'true',
        'success-logs-max-files': '12',
      })
    ).toMatchObject({
      requestLog: true,
      successRequestLog: true,
      successLogsMaxFiles: 12,
    });
  });
});
