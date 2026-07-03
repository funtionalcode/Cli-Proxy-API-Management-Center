import { act, create, type ReactTestInstance } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { AuthFileCard } from './AuthFileCard';

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => {} },
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

const getText = (node: ReactTestInstance): string =>
  node.children
    .map((child) => {
      if (typeof child === 'string' || typeof child === 'number') return String(child);
      return getText(child);
    })
    .join('');

describe('AuthFileCard', () => {
  it('renders priority and weight metadata when present', () => {
    let renderer!: ReturnType<typeof create>;

    act(() => {
      renderer = create(
        <AuthFileCard
          file={{
            name: 'codex-account.json',
            type: 'codex',
            size: 1024,
            modified: 1782270000000,
            priority: 8,
            weight: 3,
          }}
          compact={false}
          selected={false}
          resolvedTheme="light"
          disableControls={false}
          deleting={null}
          statusUpdating={{}}
          statusBarCache={new Map()}
          onShowModels={vi.fn()}
          onDownload={vi.fn()}
          onOpenPrefixProxyEditor={vi.fn()}
          onDelete={vi.fn()}
          onToggleStatus={vi.fn()}
          onToggleSelect={vi.fn()}
        />
      );
    });

    const text = getText(renderer.root);
    expect(text).toContain('auth_files.priority_display');
    expect(text).toContain('8');
    expect(text).toContain('auth_files.weight_display');
    expect(text).toContain('3');
  });
});
