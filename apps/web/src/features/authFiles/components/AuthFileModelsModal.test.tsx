import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { AuthFileModelsContent } from './AuthFileModelsModal';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const readText = (value: unknown): string => {
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.map(readText).join('');
  if (value && typeof value === 'object' && 'children' in value) {
    return readText((value as { children?: unknown }).children);
  }
  return '';
};

const renderContent = (
  overrides: Partial<ComponentProps<typeof AuthFileModelsContent>> = {}
): ReactTestRenderer => {
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(
      <AuthFileModelsContent
        fileType="codex"
        loading={false}
        error={null}
        models={[]}
        excluded={{}}
        aliases={{}}
        onRetry={vi.fn()}
        onCopyText={vi.fn()}
        {...overrides}
      />
    );
  });
  return renderer;
};

describe('AuthFileModelsContent', () => {
  it('keeps last-known models visible while refresh is loading or failed', () => {
    const retry = vi.fn();
    const renderer = renderContent({
      loading: true,
      error: 'failed',
      models: [{ id: 'last-known-model' }],
      onRetry: retry,
    });

    const text = readText(renderer.toJSON());
    expect(text).toContain('auth_files.models_loading');
    expect(text).toContain('accounts.model_load_failed');
    expect(text).toContain('last-known-model');

    act(() => {
      renderer.root.findByType('button').props.onClick();
    });
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('shows every alias mapped to a model', () => {
    const renderer = renderContent({
      models: [{ id: 'gpt-5-codex' }],
      aliases: {
        codex: [
          { name: 'gpt-5-codex', alias: 'fast-alias' },
          { name: 'gpt-5-codex', alias: 'secondary-alias' },
        ],
      },
    });

    const text = readText(renderer.toJSON());
    expect(text).toContain('fast-alias');
    expect(text).toContain('secondary-alias');
  });

  it('deduplicates aliases shared by equivalent Gemini provider keys', () => {
    const renderer = renderContent({
      fileType: 'gemini',
      models: [{ id: 'gemini-2.5-pro' }],
      aliases: {
        gemini: [{ name: 'gemini-2.5-pro', alias: 'shared-alias' }],
        'gemini-cli': [{ name: 'gemini-2.5-pro', alias: 'shared-alias' }],
      },
    });

    const text = readText(renderer.toJSON());
    expect(text.match(/shared-alias/g)).toHaveLength(1);
  });
});
