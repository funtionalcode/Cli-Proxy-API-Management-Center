import { describe, expect, it } from 'vitest';
import {
  buildOAuthRulePreviewRows,
  getOAuthRulePreviewProviders,
  matchesOAuthExcludedPattern,
  partitionOAuthRulePreviewRows,
} from './oauthRulePreview';

describe('oauthRulePreview', () => {
  it('matches CPA-style excluded model wildcards case-insensitively', () => {
    expect(matchesOAuthExcludedPattern('GPT-*', 'gpt-5-codex')).toBe(true);
    expect(matchesOAuthExcludedPattern('*-preview', 'o1-preview')).toBe(true);
    expect(matchesOAuthExcludedPattern('gemini-*-pro', 'gemini-2.5-pro')).toBe(true);
    expect(matchesOAuthExcludedPattern('gpt-*', 'claude-sonnet')).toBe(false);
  });

  it('resolves a client alias to the upstream model and force-mapped response name', () => {
    const rows = buildOAuthRulePreviewRows({
      providers: ['codex'],
      excluded: {},
      aliases: {
        codex: [
          {
            name: 'gpt-5-codex',
            alias: 'team-codex',
            displayName: 'Team Codex',
            forceMapping: true,
          },
        ],
      },
      inputModel: 'TEAM-CODEX',
    });

    expect(rows[0]).toMatchObject({
      provider: 'codex',
      upstreamModel: 'gpt-5-codex',
      matchedAlias: 'team-codex',
      matchedExclude: '',
      responseModel: 'team-codex',
      forceMapping: true,
      effectiveStatus: 'aliased',
      explanationKey: 'accounts.oauth_preview_aliased',
      catalogModels: [{ id: 'team-codex', displayName: 'Team Codex' }],
    });
  });

  it('shows every client-visible catalog model when fork keeps the source', () => {
    const rows = buildOAuthRulePreviewRows({
      providers: ['codex'],
      excluded: {},
      aliases: {
        codex: [
          { name: 'gpt-5-codex', alias: 'team-codex', fork: true },
          { name: 'gpt-5-codex', alias: 'fast-codex' },
        ],
      },
      inputModel: 'gpt-5-codex',
    });

    expect(rows[0].catalogModels).toEqual([
      { id: 'gpt-5-codex', displayName: '' },
      { id: 'team-codex', displayName: '' },
      { id: 'fast-codex', displayName: '' },
    ]);
    expect(rows[0].effectiveStatus).toBe('available');
  });

  it('applies global exclusions after resolving an alias to its upstream model', () => {
    const rows = buildOAuthRulePreviewRows({
      providers: ['codex'],
      excluded: { codex: ['gpt-5-*'] },
      aliases: {
        codex: [{ name: 'gpt-5-codex', alias: 'team-codex', fork: true }],
      },
      inputModel: 'team-codex',
    });

    expect(rows[0]).toMatchObject({
      upstreamModel: 'gpt-5-codex',
      matchedExclude: 'gpt-5-*',
      catalogModels: [],
      effectiveStatus: 'excluded',
      explanationKey: 'accounts.oauth_preview_excluded',
    });
  });

  it('preserves CPA thinking suffixes while matching exclusions against the catalog model', () => {
    const rows = buildOAuthRulePreviewRows({
      providers: ['codex'],
      excluded: { codex: ['gpt-5-*'] },
      aliases: {
        codex: [
          {
            name: 'gpt-5-codex',
            alias: 'team-codex',
            forceMapping: true,
          },
        ],
      },
      inputModel: 'team-codex(high)',
    });

    expect(rows[0]).toMatchObject({
      upstreamModel: 'gpt-5-codex(high)',
      matchedAlias: 'team-codex',
      matchedExclude: 'gpt-5-*',
      catalogModels: [],
      responseModel: 'team-codex',
      effectiveStatus: 'excluded',
    });
  });

  it('keeps unmatched models direct and provider-specific', () => {
    const rows = buildOAuthRulePreviewRows({
      providers: ['claude'],
      excluded: { codex: ['*'] },
      aliases: { xai: [{ name: 'grok', alias: 'xai-default' }] },
      inputModel: 'sonnet',
    });

    expect(rows.find((row) => row.provider === 'claude')).toMatchObject({
      upstreamModel: 'sonnet',
      matchedAlias: '',
      matchedExclude: '',
      catalogModels: [{ id: 'sonnet', displayName: '' }],
      responseModel: 'sonnet',
      effectiveStatus: 'available',
    });
  });

  it('collects providers from credentials and both global rule maps', () => {
    expect(
      getOAuthRulePreviewProviders({
        providers: ['Codex', 'claude'],
        excluded: { Kimi: ['*'] },
        aliases: { XAI: [{ name: 'grok', alias: 'xai-default' }] },
      })
    ).toEqual(['claude', 'codex', 'kimi', 'xai']);
  });

  it('separates affected providers from direct-use providers and applies the provider filter', () => {
    const rows = buildOAuthRulePreviewRows({
      providers: ['codex', 'claude', 'kimi'],
      excluded: { kimi: ['team-*'] },
      aliases: { codex: [{ name: 'gpt-5-codex', alias: 'team-codex' }] },
      inputModel: 'team-codex',
    });

    const allProviders = partitionOAuthRulePreviewRows(rows);
    expect(allProviders.affectedRows.map((row) => row.provider)).toEqual(['codex', 'kimi']);
    expect(allProviders.directRows.map((row) => row.provider)).toEqual(['claude']);

    const directProvider = partitionOAuthRulePreviewRows(rows, 'CLAUDE');
    expect(directProvider.affectedRows).toEqual([]);
    expect(directProvider.directRows).toHaveLength(1);
    expect(directProvider.directRows[0]?.provider).toBe('claude');
  });
});
