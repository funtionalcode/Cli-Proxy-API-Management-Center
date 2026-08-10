import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { CredentialHealthModeControl } from './CredentialHealthModeControl';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe('CredentialHealthModeControl', () => {
  it('switches between local and server inspection without navigation links', () => {
    const onChange = vi.fn();
    let renderer: ReactTestRenderer;

    act(() => {
      renderer = create(
        <CredentialHealthModeControl
          activeMode="local"
          checking={false}
          serverAvailable
          onChange={onChange}
        />
      );
    });

    const tabs = renderer!.root.findAllByProps({ role: 'tab' });
    expect(tabs).toHaveLength(2);
    expect(tabs[0].props['aria-selected']).toBe(true);
    expect(tabs[1].props.disabled).toBe(false);

    act(() => {
      tabs[1].props.onClick({ preventDefault: vi.fn() });
    });

    expect(onChange).toHaveBeenCalledWith('server');
    expect(renderer!.root.findAllByType('a')).toHaveLength(0);
  });

  it('disables server inspection while availability is unknown or unavailable', () => {
    let renderer: ReactTestRenderer;

    act(() => {
      renderer = create(
        <CredentialHealthModeControl
          activeMode="local"
          checking={false}
          serverAvailable={false}
          onChange={vi.fn()}
        />
      );
    });

    let serverTab = renderer!.root.findAllByProps({ role: 'tab' })[1];
    expect(serverTab.props.disabled).toBe(true);
    expect(serverTab.props.title).toBe('monitoring.codex_inspection_mode_server_unavailable');

    act(() => {
      renderer!.update(
        <CredentialHealthModeControl
          activeMode="local"
          checking
          serverAvailable
          onChange={vi.fn()}
        />
      );
    });

    serverTab = renderer!.root.findAllByProps({ role: 'tab' })[1];
    expect(serverTab.props.disabled).toBe(true);
    expect(serverTab.props.title).toBeUndefined();
  });
});
