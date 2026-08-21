import { describe, expect, it } from 'vitest';
import {
  coolingPolicyFromOverride,
  coolingPolicyToOverride,
  getCoolingOverrideCompatibility,
  parseCredentialCoolingBoolean,
  readCoolingOverride,
  readCredentialCoolingOverride,
} from './coolingPolicy';

describe('cooling policy conversions', () => {
  it.each([
    [true, 'disabled'],
    [false, 'enabled'],
    [null, 'inherit'],
    [undefined, 'inherit'],
  ] as const)('normalizes %j as %s', (value, expected) => {
    expect(coolingPolicyFromOverride(value)).toBe(expected);
  });

  it.each([
    ['inherit', null],
    ['enabled', false],
    ['disabled', true],
  ] as const)('serializes %s as %j', (policy, expected) => {
    expect(coolingPolicyToOverride(policy)).toBe(expected);
  });

  it('preserves an explicit canonical null over a legacy alias', () => {
    expect(readCoolingOverride({ 'disable-cooling': null, disable_cooling: true })).toBeNull();
  });

  it.each([
    [{ 'disable-cooling': true }, true],
    [{ disableCooling: false }, false],
    [{ disable_cooling: null }, null],
    [{}, undefined],
  ] as const)('reads transport value %j as %j', (record, expected) => {
    expect(readCoolingOverride(record)).toBe(expected);
  });

  it.each([
    [{ disable_cooling: null, 'disable-cooling': true }, true],
    [{ disable_cooling: 'invalid', 'disable-cooling': false }, false],
    [{ disable_cooling: 't' }, true],
    [{ disable_cooling: 'f' }, false],
    [{ disable_cooling: 'yes' }, undefined],
    [{ disableCooling: true }, undefined],
  ] as const)('matches CPA credential metadata parsing for %j', (record, expected) => {
    expect(readCredentialCoolingOverride(record)).toBe(expected);
  });

  it.each([
    ['true', true],
    ['TRUE', true],
    ['t', true],
    ['1', true],
    ['false', false],
    ['FALSE', false],
    ['f', false],
    ['0', false],
    ['yes', undefined],
    ['on', undefined],
    ['TrUe', undefined],
    [null, undefined],
  ] as const)('parses credential boolean %j as %j', (value, expected) => {
    expect(parseCredentialCoolingBoolean(value)).toBe(expected);
  });

  it.each([
    ['v7.2.92', null, 'legacy'],
    ['7.2.91', null, 'legacy'],
    ['v7.2.92-rc.1', null, 'legacy'],
    ['v7.2.92-367-gb8fbe70b', null, 'legacy'],
    ['v7.2.92-368-g5bffd151', null, 'supported'],
    ['v7.2.92-375-g6039d2c1', null, 'supported'],
    ['v7.2.93', null, 'supported'],
    ['v7.2.93-rc.1', null, 'supported'],
    ['dev', '5bffd1514fba2ca7cbfd13bb6530a6f7d9d72d43', 'supported'],
    ['dev', 'none', 'unverified'],
    [null, null, 'unverified'],
  ] as const)('classifies CPA version %j at commit %j as %s', (version, commit, expected) => {
    expect(getCoolingOverrideCompatibility(version, commit)).toBe(expected);
  });
});
