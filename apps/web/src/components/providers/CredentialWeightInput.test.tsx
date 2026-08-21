import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { CredentialWeightInput } from './CredentialWeightInput';

describe('CredentialWeightInput', () => {
  it('preserves signed and invalid text so validation can report it without blocking typing', () => {
    const onChange = vi.fn();
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(
        <CredentialWeightInput value={undefined} onChange={onChange} disabled={false} />
      );
    });
    const input = renderer.root.findByType('input');

    act(() => input.props.onChange({ target: { value: '-' } }));
    expect(onChange).toHaveBeenLastCalledWith('-');

    act(() => input.props.onChange({ target: { value: '-2' } }));
    expect(onChange).toHaveBeenLastCalledWith('-2');

    act(() => input.props.onChange({ target: { value: '1.5' } }));
    expect(onChange).toHaveBeenLastCalledWith('1.5');

    act(() => input.props.onChange({ target: { value: '' } }));
    expect(onChange).toHaveBeenLastCalledWith(undefined);

    act(() => renderer.unmount());
  });
});
