import { describe, expect, it } from 'vitest';
import {
  buildAccountModelRuleDiff,
  buildAccountModelRuleProjection,
  matchesAccountModelRule,
  setAccountModelExactRule,
} from './accountModelRules';

describe('accountModelRules', () => {
  it('matches exact and wildcard rules case-insensitively', () => {
    expect(matchesAccountModelRule('GPT-5-Codex', 'gpt-5-codex')).toBe(true);
    expect(matchesAccountModelRule('gpt-5-mini', 'gpt-5-*')).toBe(true);
    expect(matchesAccountModelRule('gpt-5-mini', 'gpt-5.*')).toBe(false);
    expect(matchesAccountModelRule('claude-sonnet', '*-mini')).toBe(false);
  });

  it('combines runtime models, excluded definitions, and custom exact rules', () => {
    const projection = buildAccountModelRuleProjection({
      provider: 'codex',
      runtimeModels: [{ id: 'gpt-5-codex', display_name: 'Codex' }],
      modelDefinitions: [
        { id: 'gpt-5-codex', display_name: 'Codex static' },
        { id: 'gpt-5-mini', display_name: 'Mini' },
        { id: 'unrelated-model' },
      ],
      credentialRules: ['gpt-5-mini', 'custom-private-model'],
      globalRules: { codex: ['gpt-5-*'] },
    });

    expect(projection.rows.map((row) => row.id)).toEqual(['gpt-5-codex', 'gpt-5-mini']);
    expect(projection.rows[0]).toMatchObject({
      runtimeAvailable: true,
      scope: 'global',
    });
    expect(projection.rows[1]).toMatchObject({
      runtimeAvailable: false,
      scope: 'both',
      hasCredentialExactRule: true,
    });
    expect(projection.advancedCredentialRules).toEqual(['custom-private-model']);
    expect(projection.advancedGlobalRules).toEqual(['gpt-5-*']);
  });

  it('preserves the provider model id while using a normalized key for matching', () => {
    const projection = buildAccountModelRuleProjection({
      provider: 'codex',
      runtimeModels: [{ id: 'GPT-5-Codex', display_name: 'Codex' }],
      modelDefinitions: [{ id: 'gpt-5-codex', display_name: 'Static Codex' }],
      credentialRules: ['gpt-5-codex'],
      globalRules: {},
    });

    expect(projection.rows).toHaveLength(1);
    expect(projection.rows[0]).toMatchObject({
      id: 'GPT-5-Codex',
      display_name: 'Codex',
      hasCredentialExactRule: true,
      scope: 'credential',
    });
  });

  it('combines Gemini and Gemini CLI global rule aliases', () => {
    const projection = buildAccountModelRuleProjection({
      provider: 'gemini-cli',
      runtimeModels: [{ id: 'gemini-2.5-pro' }, { id: 'gemini-2.5-flash' }],
      modelDefinitions: [],
      credentialRules: [],
      globalRules: {
        gemini: ['gemini-2.5-pro'],
        'gemini-cli': ['gemini-2.5-flash'],
      },
    });

    expect(projection.rows.every((row) => row.scope === 'global')).toBe(true);
    expect(projection.globalRules).toEqual(['gemini-2.5-flash', 'gemini-2.5-pro']);
  });

  it('marks wildcard-only credential exclusions as advanced rules', () => {
    const projection = buildAccountModelRuleProjection({
      provider: 'claude',
      runtimeModels: [],
      modelDefinitions: [{ id: 'claude-sonnet' }, { id: 'claude-haiku' }],
      credentialRules: ['claude-*'],
      globalRules: {},
    });

    expect(projection.rows).toHaveLength(2);
    expect(projection.rows.every((row) => row.hasCredentialWildcardRule)).toBe(true);
    expect(projection.advancedCredentialRules).toEqual(['claude-*']);
  });

  it('keeps unknown global state distinct and projects shared-source exclusions', () => {
    const unknownProjection = buildAccountModelRuleProjection({
      provider: 'codex',
      runtimeModels: [{ id: 'unknown-model' }],
      modelDefinitions: [],
      credentialRules: [],
      globalRules: { codex: ['unknown-model'] },
      globalRulesKnown: false,
    });
    const sharedProjection = buildAccountModelRuleProjection({
      provider: 'codex',
      runtimeModels: [{ id: 'shared-model' }, { id: 'shared-global-model' }],
      modelDefinitions: [],
      credentialRules: ['shared-model', 'shared-global-model'],
      globalRules: { codex: ['shared-global-model'] },
      credentialRulesShared: true,
    });

    expect(unknownProjection.rows).toMatchObject([{ id: 'unknown-model', scope: 'unknown' }]);
    expect(sharedProjection.rows).toMatchObject([
      { id: 'shared-model', scope: 'shared' },
      { id: 'shared-global-model', scope: 'shared-global' },
    ]);
  });

  it('adds and removes only the selected exact rule', () => {
    expect(setAccountModelExactRule(['gpt-*'], 'GPT-5-Codex', true)).toEqual([
      'gpt-*',
      'gpt-5-codex',
    ]);
    expect(setAccountModelExactRule(['gpt-*', 'gpt-5-codex'], 'gpt-5-codex', false)).toEqual([
      'gpt-*',
    ]);
  });

  it('builds added, removed, and unchanged rule previews', () => {
    expect(buildAccountModelRuleDiff('model-a\nmodel-b', 'model-b, model-c')).toEqual({
      added: ['model-c'],
      removed: ['model-a'],
      unchanged: ['model-b'],
    });
  });
});
