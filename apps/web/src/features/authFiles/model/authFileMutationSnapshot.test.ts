import { describe, expect, it, vi } from 'vitest';
import type { AuthFileLookupTarget } from '@/services/api';
import type { AuthFileItem } from '@/types';
import { resolveAuthFileStatusMutationTarget } from '@/utils/authFileStatusMutation';
import { getAuthFilePatchTarget } from './credentialStatus';
import { lookupAuthFileMutationSnapshot } from './authFileMutationSnapshot';

const credential: AuthFileItem = {
  name: 'shared.json',
  id: 'runtime-1',
  auth_index: 'auth-1',
  type: 'gemini-cli',
  account: 'first@example.com',
};
const sibling: AuthFileItem = {
  ...credential,
  id: 'runtime-2',
  auth_index: 'auth-2',
  account: 'second@example.com',
};
const lookupInventory = (files: AuthFileItem[]) =>
  vi.fn(async ({ name }: AuthFileLookupTarget) =>
    files.filter((file) => file.name === name || file.id === name)
  );

describe('lookupAuthFileMutationSnapshot', () => {
  it('preserves source siblings and deduplicates overlapping source and identity reads', async () => {
    const lookup = lookupInventory([credential, sibling]);
    const target = getAuthFilePatchTarget(credential);

    const files = await lookupAuthFileMutationSnapshot(target, lookup);

    expect(lookup.mock.calls).toEqual([[{ name: 'shared.json' }], [{ name: 'runtime-1' }]]);
    expect(files).toEqual([credential, sibling]);
    expect(resolveAuthFileStatusMutationTarget(files, target)).toMatchObject({
      target: credential,
      scope: 'credential',
      affectedFiles: [credential],
      failure: null,
    });
  });

  it('preserves source-file and expanded-child scopes without a redundant source-row lookup', async () => {
    const source = { ...credential, id: 'shared.json' };
    const lookup = lookupInventory([source, sibling]);
    const target = getAuthFilePatchTarget(source);

    const files = await lookupAuthFileMutationSnapshot(target, lookup);

    expect(lookup).toHaveBeenCalledExactlyOnceWith({ name: 'shared.json' });
    expect(resolveAuthFileStatusMutationTarget(files, target)).toMatchObject({
      scope: 'source-file',
      affectedFiles: [source, sibling],
      failure: null,
    });
    expect(
      resolveAuthFileStatusMutationTarget(files, getAuthFilePatchTarget(sibling))
    ).toMatchObject({
      scope: 'expanded-child',
      affectedFiles: [source, sibling],
      failure: null,
    });
  });

  it.each(['shared.json', 'runtime-1'])(
    'retains a cross-source collision with selector %s so the resolver fails closed',
    async (id) => {
      const collision = { ...sibling, name: 'other.json', id };
      const lookup = lookupInventory([credential, sibling, collision]);
      const target = getAuthFilePatchTarget(credential);

      const files = await lookupAuthFileMutationSnapshot(target, lookup);

      expect(files).toContainEqual(collision);
      expect(resolveAuthFileStatusMutationTarget(files, target).failure).toBe('ambiguous');
    }
  );

  it('checks the observed runtime ID when the requested target only has an auth index', async () => {
    const collision = { ...sibling, name: 'other.json', id: credential.id };
    const lookup = lookupInventory([credential, sibling, collision]);
    const target = { ...getAuthFilePatchTarget(credential), runtimeId: null };

    const files = await lookupAuthFileMutationSnapshot(target, lookup);

    expect(lookup.mock.calls).toEqual([[{ name: 'shared.json' }], [{ name: 'runtime-1' }]]);
    expect(files).toContainEqual(collision);
    expect(resolveAuthFileStatusMutationTarget(files, target).failure).toBe('ambiguous');
  });

  it('checks a changed runtime ID for refresh verification without accepting a stale status target', async () => {
    const replacement = { ...credential, id: 'runtime-new' };
    const collision = { ...sibling, name: 'other.json', id: 'runtime-new' };
    const lookup = lookupInventory([replacement, collision]);
    const target = getAuthFilePatchTarget(credential);

    const files = await lookupAuthFileMutationSnapshot(target, lookup);

    expect(lookup.mock.calls).toEqual([
      [{ name: 'shared.json' }],
      [{ name: 'runtime-1' }],
      [{ name: 'runtime-new' }],
    ]);
    expect(files).toEqual([replacement, collision]);
    expect(resolveAuthFileStatusMutationTarget(files, target).failure).toBe('runtime-id-changed');
    expect(resolveAuthFileStatusMutationTarget(files, { ...target, runtimeId: null }).failure).toBe(
      'ambiguous'
    );
  });

  it.each([
    { type: 'xai' },
    { account: 'replacement@example.com' },
    { auth_index: 'replacement-index' },
    { name: 'replacement.json' },
  ])('keeps identity replacement evidence for the original resolver: %j', async (replacement) => {
    const lookup = lookupInventory([{ ...credential, ...replacement }]);
    const target = getAuthFilePatchTarget(credential);

    const files = await lookupAuthFileMutationSnapshot(target, lookup);

    expect(resolveAuthFileStatusMutationTarget(files, target).failure).toBe('identity-changed');
  });

  it('does not deduplicate different account identities observed between reads', async () => {
    const replacement = { ...credential, account: 'replacement@example.com' };
    const lookup = vi
      .fn<(target: AuthFileLookupTarget) => Promise<AuthFileItem[]>>()
      .mockResolvedValueOnce([credential])
      .mockResolvedValueOnce([replacement]);
    const target = getAuthFilePatchTarget(credential);

    const files = await lookupAuthFileMutationSnapshot(target, lookup);

    expect(files).toEqual([credential, replacement]);
    expect(resolveAuthFileStatusMutationTarget(files, target).failure).toBe('ambiguous');
  });

  it('rejects an incomplete lookup instead of using a partial collision universe', async () => {
    const lookup = vi
      .fn<(target: AuthFileLookupTarget) => Promise<AuthFileItem[]>>()
      .mockResolvedValueOnce([credential])
      .mockRejectedValueOnce(new Error('identity lookup failed'));

    await expect(
      lookupAuthFileMutationSnapshot(getAuthFilePatchTarget(credential), lookup)
    ).rejects.toThrow('identity lookup failed');
  });

  it('leaves a missing source unresolved', async () => {
    const target = getAuthFilePatchTarget(credential);
    const files = await lookupAuthFileMutationSnapshot(target, lookupInventory([]));

    expect(files).toEqual([]);
    expect(resolveAuthFileStatusMutationTarget(files, target).failure).toBe('runtime-id-changed');
  });
});
