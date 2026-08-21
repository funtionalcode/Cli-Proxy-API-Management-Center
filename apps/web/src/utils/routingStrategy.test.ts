import { describe, expect, it } from 'vitest';
import { normalizeRoutingStrategy } from './routingStrategy';

describe('normalizeRoutingStrategy', () => {
  it('normalizes CPA routing aliases to canonical values', () => {
    expect(normalizeRoutingStrategy('roundrobin')).toBe('round-robin');
    expect(normalizeRoutingStrategy('wrr')).toBe('weighted-round-robin');
    expect(normalizeRoutingStrategy('weightedroundrobin')).toBe('weighted-round-robin');
    expect(normalizeRoutingStrategy('ff')).toBe('fill-first');
  });

  it('leaves unknown strategies unclassified', () => {
    expect(normalizeRoutingStrategy('custom')).toBeUndefined();
    expect(normalizeRoutingStrategy('')).toBeUndefined();
  });
});
