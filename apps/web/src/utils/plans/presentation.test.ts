import { describe, expect, it } from 'vitest';
import type { TFunction } from 'i18next';
import enResource from '@/i18n/locales/en.json';
import {
  getCanonicalPlanFilterLabel,
  getCanonicalPlanType,
  getPlanLabel,
  getPlanPresentation,
} from './presentation';
import {
  ANTIGRAVITY_PLAN_DESCRIPTORS,
  CLAUDE_PLAN_DESCRIPTORS,
  CODEX_PLAN_DESCRIPTORS,
} from './providers';
import { resolveAntigravityPlanType } from './providers/antigravity';
import { resolveAuthFilePlanType } from './source';

const t = ((key: string, options?: { defaultValue?: string }) =>
  options?.defaultValue ?? key) as TFunction;

/**
 * Strict translator backed by the real English locale resource: it resolves a
 * dotted key path only when it points at a string leaf, and otherwise throws so
 * malformed descriptor label keys (e.g. pointing at a nested object) surface as
 * test failures instead of silently falling back to the default value.
 */
const resolveResourceKey = (key: string): string => {
  const segments = key.split('.');
  let node: unknown = enResource;
  for (const segment of segments) {
    if (typeof node !== 'object' || node === null || Array.isArray(node)) {
      throw new Error(`i18n key "${key}" is not a string leaf in the locale resource`);
    }
    node = (node as Record<string, unknown>)[segment];
    if (node === undefined) {
      throw new Error(`i18n key "${key}" is missing from the locale resource`);
    }
  }
  if (typeof node !== 'string') {
    throw new Error(`i18n key "${key}" resolves to a non-string node in the locale resource`);
  }
  return node;
};

const strictT = ((key: string) => resolveResourceKey(key)) as TFunction;

describe('Plan Presentation', () => {
  it.each([
    ['free', 'free', 'Free', 'Free'],
    ['go', 'go', 'Go', 'Go'],
    ['plus', 'plus', 'Plus', 'Plus'],
    ['prolite', 'pro_5x', 'Pro 5x', 'Pro 5x'],
    ['pro-lite', 'pro_5x', 'Pro 5x', 'Pro 5x'],
    ['pro_lite', 'pro_5x', 'Pro 5x', 'Pro 5x'],
    ['pro', 'pro_20x', 'Pro 20x', 'Pro 20x'],
    ['self_serve_business_prolite', 'business_premium_5x', 'Business 5x', 'Business Premium 5x'],
    [
      'self_serve_business_usage_based',
      'business_usage_based',
      'Business PAYG',
      'Business Usage-based',
    ],
    ['ent26', 'enterprise', 'Enterprise', 'Enterprise'],
    ['enterprise', 'enterprise', 'Enterprise', 'Enterprise'],
    ['hc', 'enterprise', 'Enterprise', 'Enterprise'],
    ['enterprise_cbp_automation', 'enterprise_automation', 'Ent. Auto', 'Enterprise Automation'],
    ['enterprise_cbp_usage_based', 'enterprise_usage_based', 'Ent. PAYG', 'Enterprise Usage-based'],
    ['edu', 'edu', 'Edu', 'Education'],
    ['education', 'edu', 'Edu', 'Education'],
    ['edu_plus', 'edu_plus', 'Edu Plus', 'Education Plus'],
    ['edu_pro', 'edu_pro', 'Edu Pro', 'Education Pro'],
  ])('resolves Codex %s', (raw, canonical, shortLabel, fullLabel) => {
    const presentation = getPlanPresentation({ provider: 'codex', planType: raw, t });
    expect(presentation).toMatchObject({
      rawPlanType: raw,
      canonicalPlanType: canonical,
      shortLabel,
      fullLabel,
      known: true,
    });
  });

  it.each([
    ['plan_free', 'free', 'Free'],
    ['plan_pro', 'pro', 'Pro'],
    ['plan_max', 'max', 'Max'],
    ['plan_team', 'team', 'Team'],
  ])('resolves Claude %s', (raw, canonical, label) => {
    expect(getPlanPresentation({ provider: 'claude', planType: raw, t })).toMatchObject({
      rawPlanType: raw,
      canonicalPlanType: canonical,
      shortLabel: label,
      fullLabel: label,
      known: true,
    });
  });

  it.each([
    ['free', 'free', 'Free'],
    ['pro', 'pro', 'Pro'],
    ['ultra', 'ultra', 'Ultra'],
    ['ultra-lite', 'ultra-lite', 'Ultra Lite'],
    ['ultra_lite', 'ultra-lite', 'Ultra Lite'],
  ])('resolves Antigravity %s', (raw, canonical, label) => {
    expect(getPlanPresentation({ provider: 'antigravity', planType: raw, t })).toMatchObject({
      rawPlanType: raw,
      canonicalPlanType: canonical,
      shortLabel: label,
      fullLabel: label,
      known: true,
    });
  });

  it.each([
    ['codex', 'future_plan_x'],
    ['claude', 'future_plan_x'],
    ['antigravity', 'future_plan_x'],
    ['kimi', 'future_plan_x'],
    ['xai', 'future_plan_x'],
  ])('keeps unknown %s plans visible without a translation key', (provider, raw) => {
    const presentation = getPlanPresentation({ provider, planType: raw, t });
    expect(presentation).toEqual({
      provider,
      rawPlanType: raw,
      canonicalPlanType: `unknown:${provider}:${raw}`,
      shortLabel: raw,
      fullLabel: raw,
      known: false,
    });
  });

  it('returns null for an empty plan', () => {
    expect(getPlanPresentation({ provider: 'codex', planType: '  ', t })).toBeNull();
  });

  it('uses canonical values for filtering and display mode selection', () => {
    expect(getCanonicalPlanType('codex', 'pro-lite')).toBe('pro_5x');
    const presentation = getPlanPresentation({
      provider: 'codex',
      planType: 'self_serve_business_prolite',
      t,
    });
    expect(getPlanLabel(presentation, 'compact')).toBe('Business 5x');
    expect(getPlanLabel(presentation, 'full')).toBe('Business Premium 5x');
  });

  it('preserves unknown plan display casing while using normalized lookup values', () => {
    expect(
      getPlanPresentation({
        provider: 'antigravity',
        planType: 'Antigravity Future',
        t,
      })
    ).toEqual({
      provider: 'antigravity',
      rawPlanType: 'Antigravity Future',
      canonicalPlanType: 'unknown:antigravity:antigravity future',
      shortLabel: 'Antigravity Future',
      fullLabel: 'Antigravity Future',
      known: false,
    });
  });

  it('falls back to the plan portion for scoped unknown canonical identities', () => {
    expect(
      getCanonicalPlanFilterLabel('unknown:antigravity:antigravity future', t)
    ).toBe('antigravity future');
    expect(getCanonicalPlanFilterLabel('unknown:provider:future:premium', t)).toBe(
      'future:premium'
    );
    expect(
      getCanonicalPlanFilterLabel('unknown:antigravity:antigravity future', t)
    ).not.toContain('unknown:antigravity:');
  });

  it('matches known descriptors case-insensitively without losing canonical mapping', () => {
    expect(
      getPlanPresentation({
        provider: 'codex',
        planType: ' PRO ',
        t,
      })
    ).toMatchObject({
      rawPlanType: 'PRO',
      canonicalPlanType: 'pro_20x',
      shortLabel: 'Pro 20x',
      fullLabel: 'Pro 20x',
      known: true,
    });
  });

  it('resolves non-Codex plan aliases from nested token fields', () => {
    expect(
      resolveAuthFilePlanType({
        name: 'claude.json',
        type: 'claude',
        id_token: { planType: 'plan_pro' },
      })
    ).toBe('plan_pro');
  });

  it('falls through an unknown Antigravity plan to tier metadata', () => {
    expect(
      resolveAuthFilePlanType({
        name: 'antigravity.json',
        type: 'antigravity',
        planType: 'unknown',
        subscription: {
          plan: 'unknown',
          tierName: 'Antigravity Future',
          tierId: 'future-tier',
        },
      })
    ).toBe('Antigravity Future');
  });

  it('keeps a known Antigravity credential plan ahead of unknown tier metadata', () => {
    expect(
      resolveAntigravityPlanType(
        {
          plan: 'unknown',
          tierName: 'Antigravity Future',
          tierId: 'future-tier',
        },
        'pro'
      )
    ).toBe('pro');
  });

  it('falls through an unknown Codex plan to later subscription metadata', () => {
    expect(
      resolveAuthFilePlanType({
        name: 'codex.json',
        type: 'codex',
        planType: 'unknown',
        metadata: {
          subscription: {
            plan: 'pro',
          },
        },
      })
    ).toBe('pro');
  });

  it('points every descriptor label key at a real locale string leaf', () => {
    const descriptors = [
      ...Object.values(CODEX_PLAN_DESCRIPTORS),
      ...Object.values(CLAUDE_PLAN_DESCRIPTORS),
      ...Object.values(ANTIGRAVITY_PLAN_DESCRIPTORS),
    ];
    const seen = new Set<string>();
    descriptors.forEach((descriptor) => {
      [descriptor.shortLabelKey, descriptor.fullLabelKey ?? descriptor.shortLabelKey].forEach(
        (key) => {
          if (seen.has(key)) return;
          seen.add(key);
          expect(() => resolveResourceKey(key)).not.toThrow();
        }
      );
    });
  });

  it('resolves Codex education plans through nested short/full locale tokens', () => {
    for (const raw of ['edu', 'education']) {
      const presentation = getPlanPresentation({ provider: 'codex', planType: raw, t: strictT });
      expect(presentation).toMatchObject({
        canonicalPlanType: 'edu',
        shortLabel: 'Edu',
        fullLabel: 'Education',
        known: true,
      });
    }
  });
});
