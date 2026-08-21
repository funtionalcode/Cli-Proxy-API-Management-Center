import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Select } from '@/components/ui/Select';
import { CoolingPolicySelect } from './CoolingPolicySelect';

const authState = vi.hoisted(() => ({
  serverVersion: null as string | null,
  serverCommit: null as string | null,
}));

vi.mock('@/stores/useAuthStore', () => ({
  useAuthStore: (selector: (state: typeof authState) => unknown) => selector(authState),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: { commit?: string }) =>
      params?.commit ? `${key}:${params.commit}` : key,
  }),
}));

describe('CoolingPolicySelect compatibility', () => {
  beforeEach(() => {
    authState.serverVersion = null;
    authState.serverCommit = null;
  });

  it('keeps all three policies available for a supported CPA build', () => {
    authState.serverVersion = 'v7.2.92-375-g6039d2c1';
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(<CoolingPolicySelect value="enabled" onChange={() => {}} />);
    });

    const select = renderer.root.findByType(Select);
    expect(select.props.value).toBe('enabled');
    expect(select.props.options.map((option: { value: string }) => option.value)).toEqual([
      'inherit',
      'enabled',
      'disabled',
    ]);
    expect(select.props.disabled).toBe(false);
    expect(renderer.root.findAllByProps({ role: 'note' })).toHaveLength(0);

    act(() => renderer.unmount());
  });

  it('fails closed for an unverified CPA build', () => {
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(<CoolingPolicySelect value="enabled" onChange={() => {}} />);
    });

    const select = renderer.root.findByType(Select);
    expect(select.props.value).toBe('inherit');
    expect(select.props.options.map((option: { value: string }) => option.value)).toEqual([
      'inherit',
      'disabled',
    ]);
    expect(select.props.disabled).toBe(false);
    expect(renderer.root.findByProps({ role: 'note' }).children.join('')).toContain('5bffd151');

    act(() => renderer.unmount());
  });

  it('maps legacy false to inherit and removes the unsupported enabled policy', () => {
    authState.serverVersion = 'v7.2.92';
    const onChange = vi.fn();
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(<CoolingPolicySelect value="enabled" onChange={onChange} />);
    });

    const select = renderer.root.findByType(Select);
    expect(select.props.value).toBe('inherit');
    expect(select.props.options.map((option: { value: string }) => option.value)).toEqual([
      'inherit',
      'disabled',
    ]);

    act(() => select.props.onChange('disabled'));
    expect(onChange).toHaveBeenCalledWith('disabled');

    act(() => renderer.unmount());
  });

  it('disables a Provider override that did not exist in legacy CPA', () => {
    authState.serverVersion = 'v7.2.92';
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(
        <CoolingPolicySelect value="inherit" onChange={() => {}} legacyProviderSupported={false} />
      );
    });

    expect(renderer.root.findByType(Select).props.disabled).toBe(true);
    expect(renderer.root.findByProps({ role: 'note' }).children.join('')).toContain(
      'legacy_provider_unsupported'
    );

    act(() => renderer.unmount());
  });

  it('disables an unsupported Provider override when the CPA build is unverified', () => {
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(
        <CoolingPolicySelect value="inherit" onChange={() => {}} legacyProviderSupported={false} />
      );
    });

    expect(renderer.root.findByType(Select).props.disabled).toBe(true);
    expect(renderer.root.findByProps({ role: 'note' }).children.join('')).toContain(
      'unverified_provider_unsupported'
    );

    act(() => renderer.unmount());
  });
});
