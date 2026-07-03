import { describe, expect, it } from 'vitest';
import { appendIdleKeyTestStatus, removeKeyTestStatusAtIndex } from './keyTestStatuses';

describe('OpenAI API key test statuses', () => {
  it('keeps statuses attached to remaining keys after deletion', () => {
    const statuses = [
      { status: 'success', message: '' },
      { status: 'error', message: 'invalid key' },
      { status: 'success', message: 'still valid' },
    ];

    expect(removeKeyTestStatusAtIndex(statuses, 1, 3)).toEqual([
      { status: 'success', message: '' },
      { status: 'success', message: 'still valid' },
    ]);
  });

  it('adds only an idle status for a new key', () => {
    const statuses = [{ status: 'success', message: '' }];

    expect(appendIdleKeyTestStatus(statuses, 1)).toEqual([
      { status: 'success', message: '' },
      { status: 'idle', message: '' },
    ]);
  });

  it('fills missing statuses before aligning the list', () => {
    expect(removeKeyTestStatusAtIndex([{ status: 'error', message: 'failed' }], 0, 3)).toEqual([
      { status: 'idle', message: '' },
      { status: 'idle', message: '' },
    ]);
  });
});
