import { describe, expect, it } from 'vitest';
import { isOAuthAliasDraftDirty } from './oauthEditorState';

describe('oauthEditorState', () => {
  it('detects display-name, force-mapping and fork changes', () => {
    const initial = [
      {
        name: 'source',
        alias: 'target',
        fork: true,
        displayName: 'Target Model',
        forceMapping: true,
      },
    ];
    expect(isOAuthAliasDraftDirty([{ ...initial[0], fork: false }], initial)).toBe(true);
    expect(isOAuthAliasDraftDirty([{ ...initial[0], displayName: 'Renamed Model' }], initial)).toBe(
      true
    );
  });
});
