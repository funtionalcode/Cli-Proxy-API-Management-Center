import { describe, expect, it } from 'vitest';
import {
  buildOAuthAliasModelOptions,
  buildOAuthExcludedModelOptions,
} from './oauthProviderModelOptions';

describe('oauthProviderModelOptions', () => {
  it('merges catalog models with existing exact exclusions without presenting wildcards as models', () => {
    expect(
      buildOAuthExcludedModelOptions(
        [{ id: 'GPT-5', display_name: 'GPT 5' }, { id: 'gpt-5' }],
        ['custom-model', 'gpt-*']
      )
    ).toEqual([{ id: 'gpt-5', display_name: 'GPT 5' }, { id: 'custom-model' }]);
  });

  it('keeps current-provider alias sources editable when the endpoint catalog is empty', () => {
    expect(
      buildOAuthAliasModelOptions(
        [],
        [{ name: 'current-provider-model', alias: 'model-alias', fork: false }]
      )
    ).toEqual([{ id: 'current-provider-model' }]);
  });

  it('deduplicates configured alias sources already present in the endpoint catalog', () => {
    expect(
      buildOAuthAliasModelOptions(
        [{ id: 'source-model', display_name: 'Source model' }],
        [{ name: 'source-model', alias: 'alias', fork: true }]
      )
    ).toEqual([{ id: 'source-model', display_name: 'Source model' }]);
  });
});
