import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it } from 'vitest';
import { ModelInputList } from './ModelInputList';
import type { ModelEntry } from './modelInputListUtils';

describe('ModelInputList', () => {
  let renderer: ReactTestRenderer | null = null;

  const getRenderer = () => {
    if (!renderer) {
      throw new Error('ModelInputList test renderer is not mounted');
    }
    return renderer;
  };

  afterEach(() => {
    if (!renderer) return;
    act(() => {
      renderer?.unmount();
    });
    renderer = null;
  });

  it('updates input modalities immediately through the public input', () => {
    let entries: ModelEntry[] = [
      {
        name: 'image-model',
        alias: '',
        inputModalities: ['text', 'image'],
        outputModalities: ['image'],
      },
    ];

    const render = () => (
      <ModelInputList
        entries={entries}
        onChange={(next) => {
          entries = next;
          renderer?.update(render());
        }}
        showModalities
        inputModalitiesPlaceholder="Input modalities"
        outputModalitiesPlaceholder="Output modalities"
      />
    );

    act(() => {
      renderer = create(render());
    });

    const input = getRenderer().root.findByProps({ 'aria-label': 'Input modalities' });
    expect(input.type).toBe('textarea');
    act(() => {
      input.props.onChange({ target: { value: 'text,\n audio, ' } });
    });
    expect(entries[0]?.inputModalities).toEqual(['text', 'audio']);
    expect(entries[0]?.inputModalitiesDraft).toBe('text,\n audio, ');
    expect(entries[0]?.outputModalities).toEqual(['image']);
    expect(getRenderer().root.findByProps({ 'aria-label': 'Input modalities' }).props.value).toBe(
      'text,\n audio, '
    );

    const updatedInput = getRenderer().root.findByProps({ 'aria-label': 'Input modalities' });
    act(() => {
      updatedInput.props.onChange({ target: { value: '' } });
    });
    expect(entries[0]?.inputModalities).toEqual([]);
    expect(entries[0]?.outputModalities).toEqual(['image']);
    expect(getRenderer().root.findByProps({ 'aria-label': 'Input modalities' }).props.value).toBe(
      ''
    );
  });

  it('updates and clears only output modalities immediately through the public input', () => {
    let entries: ModelEntry[] = [
      {
        name: 'image-model',
        alias: '',
        inputModalities: ['text', 'image'],
        outputModalities: ['image'],
      },
    ];

    const render = () => (
      <ModelInputList
        entries={entries}
        onChange={(next) => {
          entries = next;
          renderer?.update(render());
        }}
        showModalities
        inputModalitiesPlaceholder="Input modalities"
        outputModalitiesPlaceholder="Output modalities"
      />
    );

    act(() => {
      renderer = create(render());
    });

    const output = getRenderer().root.findByProps({ 'aria-label': 'Output modalities' });
    act(() => {
      output.props.onChange({ target: { value: 'text, audio' } });
    });
    expect(entries[0]?.inputModalities).toEqual(['text', 'image']);
    expect(entries[0]?.outputModalities).toEqual(['text', 'audio']);

    const updatedOutput = getRenderer().root.findByProps({ 'aria-label': 'Output modalities' });
    act(() => {
      updatedOutput.props.onChange({ target: { value: '' } });
    });
    expect(entries[0]?.inputModalities).toEqual(['text', 'image']);
    expect(entries[0]?.outputModalities).toEqual([]);
    expect(getRenderer().root.findByProps({ 'aria-label': 'Output modalities' }).props.value).toBe(
      ''
    );
  });

  it('updates force mapping immediately through the public toggle', () => {
    const forceMappingLabel = 'Rewrite response model';
    let entries: ModelEntry[] = [
      {
        name: 'mapped-model',
        alias: '',
        forceMapping: false,
      },
    ];

    const render = () => (
      <ModelInputList
        entries={entries}
        onChange={(next) => {
          entries = next;
          renderer?.update(render());
        }}
        showForceMapping
        forceMappingLabel={forceMappingLabel}
      />
    );

    act(() => {
      renderer = create(render());
    });

    const labelText = getRenderer().root.find(
      (node) => node.type === 'span' && node.children.includes(forceMappingLabel)
    );
    expect(labelText.children).toContain(forceMappingLabel);
    expect(labelText.parent?.type).toBe('label');
    const toggle = labelText.parent!.findByProps({ type: 'checkbox' });
    expect(toggle.props['aria-label']).toBe(forceMappingLabel);
    act(() => {
      toggle.props.onChange({ target: { checked: true } });
    });
    expect(entries[0]?.forceMapping).toBe(true);
    const updatedLabelText = getRenderer().root.find(
      (node) => node.type === 'span' && node.children.includes(forceMappingLabel)
    );
    expect(updatedLabelText.parent!.findByProps({ type: 'checkbox' }).props.checked).toBe(true);
  });

  it('renders only requested advanced controls and keeps them disabled', () => {
    act(() => {
      renderer = create(
        <ModelInputList
          entries={[{ name: 'model', alias: '' }]}
          onChange={() => undefined}
          showModalities
          inputModalitiesPlaceholder="Input modalities"
          outputModalitiesPlaceholder="Output modalities"
          disabled
        />
      );
    });

    expect(
      getRenderer().root.findByProps({ 'aria-label': 'Input modalities' }).props.disabled
    ).toBe(true);
    expect(
      getRenderer().root.findByProps({ 'aria-label': 'Output modalities' }).props.disabled
    ).toBe(true);
    expect(getRenderer().root.findAllByProps({ type: 'checkbox' })).toHaveLength(0);
  });
});
