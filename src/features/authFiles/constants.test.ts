import { describe, expect, it } from 'vitest';
import { parseWeightValue } from './constants';

describe('parseWeightValue', () => {
  it('accepts positive integer weights', () => {
    expect(parseWeightValue(1)).toBe(1);
    expect(parseWeightValue('10')).toBe(10);
  });

  it('rejects empty, zero, negative, and non-integer weights', () => {
    expect(parseWeightValue('')).toBeUndefined();
    expect(parseWeightValue(0)).toBeUndefined();
    expect(parseWeightValue('-1')).toBeUndefined();
    expect(parseWeightValue('1.5')).toBeUndefined();
  });
});
