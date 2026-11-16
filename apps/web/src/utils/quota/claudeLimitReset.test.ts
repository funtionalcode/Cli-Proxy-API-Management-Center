import { describe, expect, it } from 'vitest';
import {
  getClaudeResetUnavailableReason,
  normalizeClaudeOrganizationId,
  parseClaudeLimitResets,
} from './claudeLimitReset';

const nowMs = Date.parse('2026-11-16T12:00:00Z');
const rawGrant = {
  id: 'fable',
  label: 'Fable reset',
  resets_left: 2,
  usable_now: true,
  ends_at: '2026-11-17T12:00:00Z',
  clears: ['five_hour', 'weekly_scoped'],
};

describe('Claude reset inventory', () => {
  it('规范化组织 ID 的空白并拒绝能改变请求路径的内容', () => {
    expect(normalizeClaudeOrganizationId(' org-1 ')).toBe('org-1');
    for (const value of [
      undefined,
      null,
      '',
      ' ',
      'org/other',
      '../org',
      'org?x=1',
      'a'.repeat(65),
    ]) {
      expect(normalizeClaudeOrganizationId(value)).toBeNull();
    }
  });

  it.each([
    undefined,
    null,
    {},
    { grants: null },
    { grants: [{}] },
    { grants: [{ ...rawGrant, resets_left: -1 }] },
    { grants: [{ ...rawGrant, ends_at: 'invalid' }] },
    { grants: [{ ...rawGrant, starts_at: 'invalid' }] },
    { grants: [rawGrant], cooldown_until: 'invalid' },
    { eligible: false, ineligible_reason: 'surface', grants: [] },
  ])('keeps absent or malformed inventory unknown: %j', (raw) => {
    expect(parseClaudeLimitResets(raw)).toBeNull();
  });

  it('distinguishes an explicit empty inventory from unknown inventory', () => {
    expect(parseClaudeLimitResets({ grants: [] })?.grants).toEqual([]);
  });

  it('retains scope, count and expiry without treating them as full-week resets', () => {
    const status = parseClaudeLimitResets({ grants: [rawGrant] })!;
    expect(status.grants[0]).toMatchObject({
      id: 'fable',
      label: 'Fable reset',
      resetsLeft: 2,
      endsAtMs: Date.parse(rawGrant.ends_at),
      clears: ['five_hour', 'weekly_scoped'],
    });
    expect(getClaudeResetUnavailableReason(status, status.grants[0], nowMs)).toBeNull();
  });

  it('distinguishes Full and Fable grants even when both have raw type full', () => {
    const status = parseClaudeLimitResets({
      eligible: true,
      grants: [
        {
          ...rawGrant,
          id: 'full_launch',
          type: 'full',
          gives_back_weekly: false,
          resets_left: 1,
          clears: ['five_hour', 'seven_day'],
        },
        {
          ...rawGrant,
          type: 'full',
          gives_back_weekly: true,
          clears: ['five_hour', 'seven_day_overage_included'],
        },
      ],
    })!;
    expect(
      status.grants.map(({ id, kind, resetsLeft, clears }) => ({
        id,
        kind,
        resetsLeft,
        clears,
      }))
    ).toEqual([
      { id: 'full_launch', kind: 'full', resetsLeft: 1, clears: ['five_hour', 'seven_day'] },
      {
        id: 'fable',
        kind: 'fable',
        resetsLeft: 2,
        clears: ['five_hour', 'seven_day_overage_included'],
      },
    ]);
  });

  it.each([
    [{ type: 'full' }, 'full'],
    [{ type: 'fable' }, 'fable'],
    [{ clears: ['five_hour', 'seven_day'] }, 'full'],
    [{ clears: ['five_hour', 'weekly_scoped'] }, 'unknown'],
  ])('classifies only a declared or observed reset kind: %j', (fields, kind) => {
    const status = parseClaudeLimitResets({ grants: [{ ...rawGrant, ...fields }] })!;
    expect(status.grants[0].kind).toBe(kind);
  });

  it.each([
    [{ id: '../fable' }, {}, 'invalid'],
    [{ resets_left: 0 }, {}, 'exhausted'],
    [{ ends_at: '2026-11-16T12:00:00Z' }, {}, 'expired'],
    [{ starts_at: '2026-11-16T13:00:00Z' }, {}, 'not_started'],
    [{ paused: true }, {}, 'paused'],
    [{ usable_now: false }, {}, 'unavailable'],
    [{ use_requires_limit: true }, { at_limit: false }, 'limit_required'],
    [{}, { ineligible_reason: 'account_not_eligible' }, 'ineligible'],
    [{}, { cooldown_until: '2026-11-16T13:00:00Z' }, 'cooldown'],
  ])('disables an unusable grant: %j / %j', (grantOverrides, statusOverrides, reason) => {
    const status = parseClaudeLimitResets({
      grants: [{ ...rawGrant, ...grantOverrides }],
      ...statusOverrides,
    })!;
    expect(getClaudeResetUnavailableReason(status, status.grants[0], nowMs)).toBe(reason);
  });

  it('allows a limit-required grant only when the server also marks it usable', () => {
    const status = parseClaudeLimitResets({
      at_limit: true,
      grants: [{ ...rawGrant, use_requires_limit: true }],
    })!;
    expect(getClaudeResetUnavailableReason(status, status.grants[0], nowMs)).toBeNull();
  });
});
