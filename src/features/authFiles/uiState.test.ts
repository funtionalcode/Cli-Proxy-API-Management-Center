import { describe, expect, it } from 'vitest';
import { normalizeAuthFilesSortMode, normalizeAuthFilesViewMode } from './uiState';

describe('authFiles uiState', () => {
  it('normalizes persisted sort modes', () => {
    expect(normalizeAuthFilesSortMode('default')).toBe('default');
    expect(normalizeAuthFilesSortMode('priority')).toBe('priority-desc');
    expect(normalizeAuthFilesSortMode('bad')).toBeNull();
  });

  it('normalizes persisted view modes', () => {
    expect(normalizeAuthFilesViewMode('diagram')).toBe('diagram');
    expect(normalizeAuthFilesViewMode('list')).toBe('list');
    expect(normalizeAuthFilesViewMode('bad')).toBeNull();
  });
});
