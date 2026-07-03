import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OpenAIKeyTestStatusIndicator } from './OpenAIKeyTestStatusIndicator';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

describe('OpenAIKeyTestStatusIndicator', () => {
  let renderer: ReactTestRenderer | null = null;

  beforeEach(() => {
    renderer?.unmount();
    renderer = null;
  });

  it('shows a tooltip on focus when an error message exists', () => {
    act(() => {
      renderer = create(
        <OpenAIKeyTestStatusIndicator status="error" message="invalid api key" />
      );
    });

    const trigger = renderer!.root.find(
      (node) =>
        typeof node.type === 'string' &&
        node.type === 'span' &&
        typeof node.props.className === 'string' &&
        node.props.className.includes('keyStatusTriggerInteractive')
    );

    act(() => {
      trigger.props.onFocus();
    });

    const tooltip = renderer!.root.findByProps({ role: 'tooltip' });
    const tooltipText = tooltip.find(
      (node) =>
        typeof node.type === 'string' &&
        node.type === 'span' &&
        typeof node.props.className === 'string' &&
        node.props.className.includes('keyStatusTooltipText')
    );
    expect(tooltipText.children.join('')).toContain('invalid api key');
  });

  it('keeps the idle icon non-interactive before any test runs', () => {
    act(() => {
      renderer = create(<OpenAIKeyTestStatusIndicator status="idle" message="" />);
    });

    const trigger = renderer!.root.find(
      (node) =>
        typeof node.type === 'string' &&
        node.type === 'span' &&
        typeof node.props.className === 'string' &&
        node.props.className.includes('keyStatusTrigger')
    );
    expect(trigger.props.tabIndex).toBe(-1);
    expect(() => renderer!.root.findByProps({ role: 'tooltip' })).toThrow();
  });

  it('keeps the success icon non-interactive even without a message', () => {
    act(() => {
      renderer = create(<OpenAIKeyTestStatusIndicator status="success" message="" />);
    });

    const trigger = renderer!.root.find(
      (node) =>
        typeof node.type === 'string' &&
        node.type === 'span' &&
        typeof node.props.className === 'string' &&
        node.props.className.includes('keyStatusTrigger')
    );
    expect(trigger.props.tabIndex).toBe(-1);
    expect(() => renderer!.root.findByProps({ role: 'tooltip' })).toThrow();
  });
});
