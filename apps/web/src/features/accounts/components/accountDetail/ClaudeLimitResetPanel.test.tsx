import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseClaudeLimitResets } from '@/utils/quota/claudeLimitReset';
import { ClaudeLimitResetPanel } from './ClaudeLimitResetPanel';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-i18next')>()),
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) => `${key}:${JSON.stringify(values ?? {})}`,
    i18n: { language: 'en' },
  }),
}));
const nowMs = Date.parse('2026-11-16T12:00:00Z');
const status = parseClaudeLimitResets({
  grants: [
    {
      id: 'fable',
      label: 'Fable reset',
      resets_left: 2,
      usable_now: true,
      clears: ['five_hour'],
      ends_at: '2026-11-16T13:00:00Z',
    },
    { id: 'weekly', label: 'Weekly reset', resets_left: 1, usable_now: false, paused: true },
  ],
})!;
let renderer: ReactTestRenderer | undefined;
afterEach(() => {
  if (renderer) act(() => renderer!.unmount());
  renderer = undefined;
});

describe('ClaudeLimitResetPanel', () => {
  it('shows three banked resets with independent Full and Fable availability and expiry', () => {
    const mixed = parseClaudeLimitResets({
      eligible: true,
      grants: [
        {
          id: 'full_launch',
          label: 'Full reset',
          type: 'full',
          gives_back_weekly: false,
          resets_left: 1,
          usable_now: true,
          ends_at: '2026-12-10T22:00:00Z',
          clears: ['five_hour', 'seven_day'],
        },
        {
          id: 'fable_launch',
          label: 'Fable reset',
          type: 'full',
          gives_back_weekly: true,
          resets_left: 2,
          usable_now: false,
          ends_at: '2027-03-09T07:59:00Z',
          clears: ['five_hour', 'seven_day_overage_included'],
        },
      ],
    })!;
    const onReset = vi.fn();
    act(() => {
      renderer = create(
        <ClaudeLimitResetPanel
          status={mixed}
          organizationId="org-1"
          nowMs={nowMs}
          disabled={false}
          onReset={onReset}
        />
      );
    });
    expect(
      renderer!.root.findByProps({ 'data-claude-reset-banked': 'true' }).children.join('')
    ).toBe('3');
    const counters = renderer!.root
      .findAllByType('span')
      .map((element) => element.children.join(''));
    expect(counters).toContain('claude_quota.reset_usable_count:{"count":1}');
    const full = renderer!.root.findByProps({ 'data-claude-reset-grant': 'full_launch' });
    const fable = renderer!.root.findByProps({ 'data-claude-reset-grant': 'fable_launch' });
    expect(full.findAllByType('strong')[0].children.join('')).toContain('reset_kind_full');
    expect(fable.findAllByType('strong')[0].children.join('')).toContain('reset_kind_fable');
    expect(full.findByProps({ 'data-claude-reset-expiry': 'full_launch' }).children).not.toEqual(
      fable.findByProps({ 'data-claude-reset-expiry': 'fable_launch' }).children
    );
    const fullButton = full.findByType('button');
    expect(fullButton.props.disabled).toBe(false);
    expect(fable.findByType('button').props.disabled).toBe(true);
    expect(onReset).not.toHaveBeenCalled();
    act(() => fullButton.props.onClick());
    expect(onReset).toHaveBeenCalledExactlyOnceWith('full_launch');
  });

  it('does not spend on render and forwards only the explicitly selected usable grant', () => {
    const onReset = vi.fn();
    act(() => {
      renderer = create(
        <ClaudeLimitResetPanel
          status={status}
          organizationId="org-1"
          nowMs={nowMs}
          disabled={false}
          onReset={onReset}
        />
      );
    });
    expect(onReset).not.toHaveBeenCalled();
    const buttons = renderer!.root.findAllByType('button');
    const fable = buttons.find((button) => button.props['data-claude-reset-action'] === 'fable')!;
    const weekly = buttons.find((button) => button.props['data-claude-reset-action'] === 'weekly')!;
    expect(fable.props.disabled).toBe(false);
    expect(weekly.props.disabled).toBe(true);
    act(() => fable.props.onClick());
    expect(onReset).toHaveBeenCalledExactlyOnceWith('fable');
    expect(JSON.stringify(renderer!.toJSON())).toContain('Fable reset');
  });

  it.each([
    { organizationId: null, currentTime: nowMs, disabled: false },
    { organizationId: 'org-1', currentTime: nowMs + 3_600_000, disabled: false },
    { organizationId: 'org-1', currentTime: nowMs, disabled: true },
  ])('disables actions when context, expiry or pending state prevents spending: %j', (config) => {
    act(() => {
      renderer = create(
        <ClaudeLimitResetPanel
          status={status}
          organizationId={config.organizationId}
          nowMs={config.currentTime}
          disabled={config.disabled}
          onReset={vi.fn()}
        />
      );
    });
    expect(
      renderer!.root
        .findAllByType('button')
        .filter((button) => button.props['data-claude-reset-action'])
        .every((button) => button.props.disabled)
    ).toBe(true);
  });

  it('shows unknown inventory without presenting a zero or a reset action', () => {
    act(() => {
      renderer = create(
        <ClaudeLimitResetPanel
          status={null}
          organizationId={null}
          nowMs={nowMs}
          disabled={false}
          onReset={vi.fn()}
        />
      );
    });
    expect(
      renderer!.root
        .findAllByType('button')
        .filter((button) => button.props['data-claude-reset-action'])
    ).toHaveLength(0);
    expect(JSON.stringify(renderer!.toJSON())).toContain('claude_quota.reset_unknown');
  });
});
