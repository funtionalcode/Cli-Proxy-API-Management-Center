import { act } from 'react';
import { create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import type { QuotaCooldownInfo } from '@/services/api/usageService';
import type { AuthFileItem } from '@/types';
import { AuthFileCard } from './AuthFileCard';

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => {} },
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      if (key === 'common.not_set') return 'Not set';
      return options ? `${key}:${JSON.stringify(options)}` : key;
    },
  }),
}));

const file: AuthFileItem = {
  name: 'credential.json',
  type: 'xai',
  disabled: true,
};

const renderCard = (quotaCooldown: QuotaCooldownInfo): ReactTestRenderer => {
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(
      <AuthFileCard
        file={{ ...file, type: quotaCooldown.provider ?? file.type }}
        compact
        selected={false}
        resolvedTheme="dark"
        disableControls={false}
        deleting={null}
        statusUpdating={{}}
        statusBarCache={new Map()}
        quotaCooldown={quotaCooldown}
        onShowModels={vi.fn()}
        onDownload={vi.fn()}
        onOpenPrefixProxyEditor={vi.fn()}
        onDelete={vi.fn()}
        onToggleStatus={vi.fn()}
        onToggleSelect={vi.fn()}
      />
    );
  });
  return renderer;
};

const findCooldownBadge = (renderer: ReactTestRenderer): ReactTestInstance => {
  const badge = renderer.root.findAllByType('span').find((node) => {
    const title = node.props.title;
    return typeof title === 'string' && title.startsWith('auth_files.quota_cooldown_badge_title_');
  });
  if (!badge) throw new Error('Quota cooldown badge not found');
  return badge;
};

const textContent = (node: ReactTestInstance): string =>
  node.children
    .map((child) => (typeof child === 'string' || typeof child === 'number' ? String(child) : ''))
    .join('');

describe('AuthFileCard quota cooldown presentation', () => {
  it('renders xAI cooldown as event-driven xAI automation', () => {
    const badge = findCooldownBadge(
      renderCard({
        authFileName: file.name,
        provider: 'xai',
        owner: 'cpamp_xai_free_usage',
        disabledAtMs: 1_900_000_000_000,
        recoverAtMs: 2_000_000_000_000,
      })
    );

    expect(textContent(badge)).toContain('auth_files.quota_cooldown_badge_xai');
    expect(badge.props.title).toContain('auth_files.quota_cooldown_badge_title_xai');
    expect(badge.props.title).not.toContain('"disabledAt":"Not set"');
  });

  it('renders Codex cooldown with the Codex reset-time policy', () => {
    const badge = findCooldownBadge(
      renderCard({
        authFileName: file.name,
        provider: 'codex',
        owner: 'cpamp_usage_429',
        disabledAtMs: 1_900_000_000_000,
        recoverAtMs: 2_000_000_000_000,
      })
    );

    expect(textContent(badge)).toContain('auth_files.quota_cooldown_badge_codex');
    expect(badge.props.title).toContain('auth_files.quota_cooldown_badge_title_codex');
  });

  it('uses the localized not-set value when disabled time is absent', () => {
    const badge = findCooldownBadge(
      renderCard({
        authFileName: file.name,
        provider: 'xai',
        owner: 'cpamp_xai_free_usage',
        recoverAtMs: 2_000_000_000_000,
      })
    );

    expect(badge.props.title).toContain('"disabledAt":"Not set"');
  });
});
