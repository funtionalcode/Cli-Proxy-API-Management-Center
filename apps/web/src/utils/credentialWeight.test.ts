import { describe, expect, it } from 'vitest';
import {
  MAX_CREDENTIAL_WEIGHT,
  getCredentialWeightComparisonValue,
  getCredentialWeightError,
  normalizeCredentialWeight,
  toCredentialWeightInputValue,
} from './credentialWeight';

describe('credentialWeight', () => {
  it('keeps absent and explicit zero weights distinct', () => {
    expect(normalizeCredentialWeight(undefined)).toBeUndefined();
    expect(normalizeCredentialWeight('')).toBeUndefined();
    expect(normalizeCredentialWeight(0)).toBe(0);
    expect(normalizeCredentialWeight('0')).toBe(0);
  });

  it('accepts positive and non-positive safe integers', () => {
    expect(normalizeCredentialWeight(5)).toBe(5);
    expect(normalizeCredentialWeight('-2')).toBe(-2);
    expect(normalizeCredentialWeight('+3')).toBe(3);
  });

  it('preserves signed and invalid form text until save-time validation', () => {
    expect(toCredentialWeightInputValue('-')).toBe('-');
    expect(toCredentialWeightInputValue('-2')).toBe('-2');
    expect(toCredentialWeightInputValue('1.5')).toBe('1.5');
    expect(toCredentialWeightInputValue('   ')).toBeUndefined();
  });

  it('rejects fractions and unsafe integers', () => {
    expect(getCredentialWeightError(1.5)).toBe('integer');
    expect(getCredentialWeightError('1.5')).toBe('integer');
    expect(getCredentialWeightError(Number.MAX_SAFE_INTEGER + 1)).toBe('integer');
    expect(normalizeCredentialWeight(1.5)).toBeUndefined();
  });

  it('rejects positive weights above the CPA maximum', () => {
    expect(normalizeCredentialWeight(MAX_CREDENTIAL_WEIGHT)).toBe(MAX_CREDENTIAL_WEIGHT);
    expect(getCredentialWeightError(MAX_CREDENTIAL_WEIGHT + 1)).toBe('maximum');
    expect(normalizeCredentialWeight(MAX_CREDENTIAL_WEIGHT + 1)).toBeUndefined();
  });

  it('keeps invalid input distinct from an unset value for dirty-state comparisons', () => {
    expect(getCredentialWeightComparisonValue(undefined)).toBeNull();
    expect(getCredentialWeightComparisonValue(0)).toBe(0);
    expect(getCredentialWeightComparisonValue(1.5)).toBe('invalid');
    expect(getCredentialWeightComparisonValue(MAX_CREDENTIAL_WEIGHT + 1)).toBe('invalid');
  });
});
