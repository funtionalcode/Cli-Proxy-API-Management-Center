import { afterEach, describe, expect, it, vi } from 'vitest';
import { shouldUseManagerServiceProxyHeader } from '@/services/api/usageService';

describe('usage service proxy header', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('marks manager requests only when the service base matches the current page origin', () => {
    vi.stubGlobal('window', {
      location: {
        origin: 'http://panel.local:8317',
      },
    });

    expect(shouldUseManagerServiceProxyHeader('http://panel.local:8317')).toBe(true);
    expect(shouldUseManagerServiceProxyHeader('http://panel.local:18317')).toBe(false);
  });
});
