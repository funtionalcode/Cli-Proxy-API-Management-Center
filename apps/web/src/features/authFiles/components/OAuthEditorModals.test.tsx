import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AutocompleteInput } from '@/components/ui/AutocompleteInput';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { SelectionCheckbox } from '@/components/ui/SelectionCheckbox';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { OAuthExcludedEditorModal, OAuthModelAliasEditorModal } from './OAuthEditorModals';

const { mocks } = vi.hoisted(() => ({
  mocks: {
    deleteOauthExcludedEntry: vi.fn(),
    deleteOauthModelAlias: vi.fn(),
    getModelDefinitions: vi.fn(),
    saveOauthExcludedModels: vi.fn(),
    saveOauthModelAlias: vi.fn(),
    showConfirmation: vi.fn(),
    showNotification: vi.fn(),
    t: vi.fn(),
  },
}));

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => {} },
  useTranslation: () => ({
    t: mocks.t,
  }),
}));

vi.mock('@/services/api', () => ({
  authFilesApi: {
    deleteOauthExcludedEntry: mocks.deleteOauthExcludedEntry,
    deleteOauthModelAlias: mocks.deleteOauthModelAlias,
    getModelDefinitions: mocks.getModelDefinitions,
    saveOauthExcludedModels: mocks.saveOauthExcludedModels,
    saveOauthModelAlias: mocks.saveOauthModelAlias,
  },
}));

vi.mock('@/stores', () => ({
  useNotificationStore: (
    selector: (state: {
      showConfirmation: typeof mocks.showConfirmation;
      showNotification: typeof mocks.showNotification;
    }) => unknown
  ) =>
    selector({
      showConfirmation: mocks.showConfirmation,
      showNotification: mocks.showNotification,
    }),
}));

vi.mock('@/components/ui/Modal', () => ({
  Modal: ({
    children,
    footer,
    onClose,
  }: {
    children?: ReactNode;
    footer?: ReactNode;
    onClose: () => void;
  }) => (
    <section>
      <button type="button" data-modal-close onClick={onClose}>
        modal-close
      </button>
      {children}
      <footer>{footer}</footer>
    </section>
  ),
}));

vi.mock('@/components/ui/AutocompleteInput', () => ({
  AutocompleteInput: (props: Record<string, unknown>) => (
    <div data-autocomplete={props.id ?? props.placeholder} />
  ),
}));

vi.mock('@/components/ui/Input', () => ({
  Input: (props: Record<string, unknown>) => <input data-input={props.placeholder} />,
}));

vi.mock('@/components/ui/Button', () => ({
  Button: ({ children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
}));

vi.mock('@/components/ui/SelectionCheckbox', () => ({
  SelectionCheckbox: (props: Record<string, unknown>) => (
    <div data-checkbox={String(props.checked)}>{props.label as ReactNode}</div>
  ),
}));

vi.mock('@/components/ui/ToggleSwitch', () => ({
  ToggleSwitch: (props: Record<string, unknown>) => <div data-toggle={String(props.checked)} />,
}));

vi.mock('@/components/ui/EmptyState', () => ({
  EmptyState: () => <div data-empty-state="true" />,
}));

vi.mock('@/components/ui/LoadingSpinner', () => ({
  LoadingSpinner: () => <div data-loading="true" />,
}));

vi.mock('@/components/ui/icons', () => ({
  IconInfo: () => <span data-icon="info" />,
  IconX: () => <span data-icon="x" />,
}));

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
};

const flushPromises = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

const REQUEST_SCOPE = {
  apiBase: 'http://old-cpa.local:8317',
  managementKey: 'old-cpa-key',
};
const NEXT_REQUEST_SCOPE = {
  apiBase: 'http://new-cpa.local:8317',
  managementKey: 'new-cpa-key',
};

const renderAliasModal = (provider = 'claude', onClose = vi.fn()) => {
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(
      <OAuthModelAliasEditorModal
        open
        provider={provider}
        files={[]}
        excluded={{}}
        modelAlias={{
          claude: [{ name: 'claude-existing', alias: 'claude-alias', fork: false }],
          codex: [{ name: 'codex-existing', alias: 'codex-alias', fork: true }],
          xai: [{ name: 'xai-existing', alias: 'xai-alias', fork: false }],
        }}
        requestScope={REQUEST_SCOPE}
        onClose={onClose}
        onSaved={vi.fn()}
      />
    );
  });
  return renderer;
};

const getAutocomplete = (renderer: ReactTestRenderer, placeholder: string): ReactTestInstance =>
  renderer.root
    .findAllByType(AutocompleteInput)
    .find((node) => node.props.placeholder === placeholder) ??
  (() => {
    throw new Error(`Autocomplete not found: ${placeholder}`);
  })();

const getAliasSourceOptions = (renderer: ReactTestRenderer) =>
  getAutocomplete(renderer, 'oauth_model_alias.alias_name_placeholder').props.options as Array<{
    value: string;
    label?: string;
  }>;

const getModalCloseButton = (renderer: ReactTestRenderer) =>
  renderer.root.find((node) => node.type === 'button' && node.props['data-modal-close'] === true);

const readText = (node: ReactTestInstance): string =>
  node.children
    .map((child) =>
      typeof child === 'string' || typeof child === 'number' ? String(child) : readText(child)
    )
    .join('');

describe('OAuthEditorModals provider model isolation', () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset());
    mocks.t.mockImplementation((key: string, options?: Record<string, unknown>) =>
      options ? `${key}:${JSON.stringify(options)}` : key
    );
    mocks.saveOauthExcludedModels.mockResolvedValue(undefined);
    mocks.saveOauthModelAlias.mockResolvedValue(undefined);
  });

  it('hides the previous provider catalog immediately and ignores its late response', async () => {
    const claudeRequest = deferred<Array<{ id: string }>>();
    const codexRequest = deferred<Array<{ id: string }>>();
    mocks.getModelDefinitions.mockImplementation((provider: string) => {
      if (provider === 'claude') return claudeRequest.promise;
      if (provider === 'codex') return codexRequest.promise;
      return Promise.resolve([]);
    });

    const renderer = renderAliasModal('claude');
    await act(flushPromises);
    expect(mocks.getModelDefinitions).toHaveBeenCalledWith('claude', REQUEST_SCOPE);

    await act(async () => {
      getAutocomplete(renderer, 'oauth_model_alias.provider_placeholder').props.onChange('codex');
      await flushPromises();
    });

    expect(getAliasSourceOptions(renderer).map((option) => option.value)).toEqual([
      'codex-existing',
    ]);
    expect(mocks.getModelDefinitions).toHaveBeenCalledWith('codex', REQUEST_SCOPE);

    await act(async () => {
      claudeRequest.resolve([{ id: 'claude-api-model' }]);
      await flushPromises();
    });
    expect(getAliasSourceOptions(renderer).map((option) => option.value)).toEqual([
      'codex-existing',
    ]);

    await act(async () => {
      codexRequest.resolve([]);
      await flushPromises();
    });
    expect(getAliasSourceOptions(renderer).map((option) => option.value)).toEqual([
      'codex-existing',
    ]);
  });

  it('does not reuse a provider catalog from the previous CPA connection', async () => {
    const oldRequest = deferred<Array<{ id: string }>>();
    const newRequest = deferred<Array<{ id: string }>>();
    mocks.getModelDefinitions.mockImplementation(
      (_provider: string, requestScope: typeof REQUEST_SCOPE) =>
        requestScope.apiBase === REQUEST_SCOPE.apiBase ? oldRequest.promise : newRequest.promise
    );
    const modelAlias = {
      xai: [{ name: 'xai-existing', alias: 'xai-alias', fork: false }],
    };
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(
        <OAuthModelAliasEditorModal
          open
          provider="xai"
          files={[]}
          excluded={{}}
          modelAlias={modelAlias}
          requestScope={REQUEST_SCOPE}
          onClose={vi.fn()}
          onSaved={vi.fn()}
        />
      );
    });
    await act(async () => {
      oldRequest.resolve([{ id: 'old-only-model' }]);
      await flushPromises();
    });
    expect(getAliasSourceOptions(renderer).map((option) => option.value)).toContain(
      'old-only-model'
    );

    await act(async () => {
      renderer.update(
        <OAuthModelAliasEditorModal
          open
          provider="xai"
          files={[]}
          excluded={{}}
          modelAlias={modelAlias}
          requestScope={NEXT_REQUEST_SCOPE}
          onClose={vi.fn()}
          onSaved={vi.fn()}
        />
      );
      await flushPromises();
    });
    expect(getAliasSourceOptions(renderer).map((option) => option.value)).not.toContain(
      'old-only-model'
    );

    await act(async () => {
      newRequest.resolve([{ id: 'new-only-model' }]);
      await flushPromises();
    });
    expect(getAliasSourceOptions(renderer).map((option) => option.value)).toContain(
      'new-only-model'
    );
  });

  it('confirms before closing a dirty alias draft and locks provider switching', async () => {
    mocks.getModelDefinitions.mockResolvedValue([]);
    const onClose = vi.fn();
    const renderer = renderAliasModal('xai', onClose);
    await act(flushPromises);

    const aliasInput = renderer.root.find(
      (node) =>
        node.type === 'input' && node.props.placeholder === 'oauth_model_alias.alias_placeholder'
    );
    await act(async () => {
      aliasInput.props.onChange({ target: { value: 'updated-alias' } });
      await flushPromises();
    });

    const providerInput = getAutocomplete(renderer, 'oauth_model_alias.provider_placeholder');
    expect(providerInput.props.disabled).toBe(true);
    await act(async () => {
      providerInput.props.onChange('codex');
      await flushPromises();
    });
    expect(getAutocomplete(renderer, 'oauth_model_alias.provider_placeholder').props.value).toBe(
      'xai'
    );

    await act(async () => {
      getModalCloseButton(renderer).props.onClick();
      await flushPromises();
    });

    expect(onClose).not.toHaveBeenCalled();
    expect(mocks.showConfirmation).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'common.unsaved_changes_title',
        message: 'common.unsaved_changes_message',
        confirmText: 'common.leave',
        cancelText: 'common.stay',
        variant: 'danger',
      })
    );

    const confirmation = mocks.showConfirmation.mock.calls[0]?.[0] as {
      onConfirm: () => void;
    };
    confirmation.onConfirm();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps rule and mapping controls disabled until a provider is selected', async () => {
    mocks.getModelDefinitions.mockResolvedValue([]);
    const aliasRenderer = renderAliasModal('');
    await act(flushPromises);

    expect(
      getAutocomplete(aliasRenderer, 'oauth_model_alias.alias_name_placeholder').props.disabled
    ).toBe(true);
    expect(
      aliasRenderer.root.find(
        (node) =>
          node.type === 'input' && node.props.placeholder === 'oauth_model_alias.alias_placeholder'
      ).props.disabled
    ).toBe(true);

    let excludedRenderer!: ReactTestRenderer;
    act(() => {
      excludedRenderer = create(
        <OAuthExcludedEditorModal
          open
          files={[]}
          excluded={{}}
          modelAlias={{}}
          requestScope={REQUEST_SCOPE}
          onClose={vi.fn()}
          onSaved={vi.fn()}
        />
      );
    });
    await act(flushPromises);
    expect(excludedRenderer.root.findByType(Input).props.disabled).toBe(true);
  });

  it.each([
    ['404 response', Object.assign(new Error('missing'), { status: 404 }), false],
    ['ordinary failure', Object.assign(new Error('failed'), { status: 500 }), true],
  ])('keeps current mappings editable after a %s', async (_label, error, notifies) => {
    mocks.getModelDefinitions.mockRejectedValue(error);
    const renderer = renderAliasModal('xai');

    await act(flushPromises);

    const sourceInput = getAutocomplete(renderer, 'oauth_model_alias.alias_name_placeholder');
    expect(getAliasSourceOptions(renderer).map((option) => option.value)).toEqual(['xai-existing']);
    expect(sourceInput.props.value).toBe('xai-existing');
    expect(sourceInput.props.disabled).toBe(false);
    expect(
      renderer.root.find(
        (node) =>
          node.type === 'input' && node.props.placeholder === 'oauth_model_alias.alias_placeholder'
      ).props.disabled
    ).toBe(false);
    expect(renderer.root.findAllByType(ToggleSwitch)).toHaveLength(2);
    expect(renderer.root.findAllByType(ToggleSwitch).every((node) => !node.props.disabled)).toBe(
      true
    );
    expect(
      renderer.root.findAllByType(Button).find((node) => node.props.title === 'common.delete')
        ?.props.disabled
    ).toBe(false);
    expect(mocks.showNotification).toHaveBeenCalledTimes(notifies ? 1 : 0);
  });

  it('keeps exact exclusions editable and saves custom wildcard rules when catalogs are unsupported', async () => {
    mocks.getModelDefinitions.mockRejectedValue(
      Object.assign(new Error('missing'), { status: 404 })
    );
    const onSaved = vi.fn();
    const onClose = vi.fn();
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(
        <OAuthExcludedEditorModal
          open
          provider="codex"
          files={[]}
          excluded={{ codex: ['gpt-4o', 'gpt-*'] }}
          modelAlias={{}}
          requestScope={REQUEST_SCOPE}
          onClose={onClose}
          onSaved={onSaved}
        />
      );
    });
    await act(flushPromises);

    const modelCheckboxes = renderer.root.findAllByType(SelectionCheckbox);
    expect(modelCheckboxes).toHaveLength(1);
    expect(readText(modelCheckboxes[0])).toContain('gpt-4o');
    expect(modelCheckboxes[0].props.checked).toBe(true);
    expect(readText(renderer.root)).toContain('gpt-*');

    await act(async () => {
      renderer.root.findByType(Input).props.onChange({ target: { value: '*-preview' } });
      await flushPromises();
    });
    await act(async () => {
      renderer.root.findByType(Input).props.onKeyDown({ key: 'Enter', preventDefault: vi.fn() });
      await flushPromises();
    });

    const saveButton = renderer.root
      .findAllByType(Button)
      .find((node) => readText(node).includes('oauth_excluded.save'));
    if (!saveButton) throw new Error('Save button not found');

    await act(async () => {
      saveButton.props.onClick();
      await flushPromises();
    });

    expect(mocks.saveOauthExcludedModels).toHaveBeenCalledWith(
      'codex',
      ['*-preview', 'gpt-*', 'gpt-4o'],
      REQUEST_SCOPE
    );
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(mocks.showConfirmation).not.toHaveBeenCalled();
  });
});
