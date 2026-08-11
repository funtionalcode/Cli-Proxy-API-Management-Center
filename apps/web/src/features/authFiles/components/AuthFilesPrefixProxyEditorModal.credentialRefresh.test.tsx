import { act, type ComponentProps, type ReactNode } from 'react';
import { create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import type { AuthFileItem } from '@/types';
import type { PrefixProxyEditorState } from '@/features/authFiles/hooks/useAuthFilesPrefixProxyEditor';
import { AuthFilesPrefixProxyEditorModal } from './AuthFilesPrefixProxyEditorModal';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('@/components/ui/Modal', () => ({
  Modal: ({ children, footer }: { children?: ReactNode; footer?: ReactNode }) => (
    <div>
      <div>{children}</div>
      <div>{footer}</div>
    </div>
  ),
}));

const codexFile: AuthFileItem = {
  id: 'codex-runtime-auth-id',
  name: 'shared-codex.json',
  type: 'codex',
  authIndex: 'auth-2',
};

const createEditor = (
  authFile: AuthFileItem = codexFile,
  providerKey = 'codex'
): PrefixProxyEditorState => ({
  authFile,
  fileName: authFile.name,
  credentialKey: `${authFile.name}::${String(authFile.authIndex ?? '-')}`,
  fileInfoText: JSON.stringify(authFile),
  loading: false,
  saving: false,
  error: null,
  json: {},
  providerKey,
  prefix: '',
  proxyUrl: '',
  priority: '',
  weight: '',
  websockets: false,
  websocketsTouched: false,
  usingApi: false,
  usingApiTouched: false,
  note: '',
  noteTouched: false,
  excludedModelsText: '',
  excludedModelsTouched: false,
  headersText: '',
  headersTouched: false,
  headersError: null,
  modelAliasesText: '',
  modelAliasesTouched: false,
  modelAliasesError: null,
});

const renderModal = (
  overrides: Partial<ComponentProps<typeof AuthFilesPrefixProxyEditorModal>> = {}
) => {
  const onRefreshCredential = vi.fn();
  let renderer!: ReactTestRenderer;

  act(() => {
    renderer = create(
      <AuthFilesPrefixProxyEditorModal
        disableControls={false}
        editor={createEditor()}
        updatedText="{}"
        dirty={false}
        credentialRefreshing={false}
        onClose={vi.fn()}
        onCopyText={vi.fn()}
        onSave={vi.fn()}
        onRefreshCredential={onRefreshCredential}
        onChange={vi.fn()}
        {...overrides}
      />
    );
  });

  return { renderer, onRefreshCredential };
};

const findCredentialRefreshButtons = (renderer: ReactTestRenderer) =>
  renderer.root
    .findAllByType('button')
    .filter((button) => button.props['aria-label'] === 'auth_files.credential_refresh_button');

describe('AuthFilesPrefixProxyEditorModal credential refresh action', () => {
  it('refreshes the exact Codex runtime auth row from the modal footer', () => {
    const { renderer, onRefreshCredential } = renderModal();
    const button = findCredentialRefreshButtons(renderer)[0];

    expect(button).toBeDefined();
    expect(button.props.title).toBe('auth_files.credential_refresh_hint');
    act(() => button.props.onClick());
    expect(onRefreshCredential).toHaveBeenCalledWith(codexFile);
  });

  it('disables the modal action while the credential refresh is pending', () => {
    const { renderer } = renderModal({ credentialRefreshing: true });
    const button = findCredentialRefreshButtons(renderer)[0];

    expect(button.props.disabled).toBe(true);
    expect(button.findAll((node) => node.props.className === 'loading-spinner')).toHaveLength(1);
  });

  it('does not show the credential refresh action for another provider', () => {
    const claudeFile: AuthFileItem = {
      name: 'claude-account.json',
      type: 'claude',
    };
    const { renderer } = renderModal({
      editor: createEditor(claudeFile, 'claude'),
    });

    expect(findCredentialRefreshButtons(renderer)).toHaveLength(0);
  });

  it('redacts proxy credentials and sensitive headers from preview and copied text', () => {
    const onCopyText = vi.fn();
    const updatedText = JSON.stringify({
      proxy_url:
        'socks5://proxy-user:proxy-password@127.0.0.1:1080/proxy-path-secret?token=secret',
      headers: {
        Authorization: 'Bearer access-secret',
        Cookie: 'session=cookie-secret',
        'X-Tenant': 'tenant-a',
      },
    });
    const { renderer } = renderModal({ updatedText, onCopyText });
    const sourcePreview = renderer.root
      .findAllByType('textarea')
      .find((node) => node.props.rows === 10);
    const copyButton = renderer.root
      .findAllByType('button')
      .find((button) => button.props.title === 'auth_files.prefix_proxy_copy_redacted_hint');

    expect(sourcePreview?.props.value).toContain('socks5://127.0.0.1:1080');
    expect(sourcePreview?.props.value).toContain('tenant-a');
    expect(sourcePreview?.props.value).not.toContain('proxy-user');
    expect(sourcePreview?.props.value).not.toContain('proxy-password');
    expect(sourcePreview?.props.value).not.toContain('proxy-path-secret');
    expect(sourcePreview?.props.value).not.toContain('access-secret');
    expect(sourcePreview?.props.value).not.toContain('cookie-secret');

    expect(copyButton).toBeDefined();
    act(() => copyButton?.props.onClick());
    expect(onCopyText).toHaveBeenCalledWith(sourcePreview?.props.value);
  });

  it('allows excluded models to be edited from the auth-file modal', () => {
    const onChange = vi.fn();
    const editor = {
      ...createEditor(),
      excludedModelsText: 'claude-fable-4',
    };
    const { renderer } = renderModal({ editor, onChange });
    const excludedModelsTextarea = renderer.root
      .findAllByType('textarea')
      .find((node) => node.props['aria-label'] === 'auth_files.excluded_models_label');

    expect(excludedModelsTextarea?.props.value).toBe('claude-fable-4');
    act(() => excludedModelsTextarea?.props.onChange({ target: { value: 'claude-fable-5' } }));
    expect(onChange).toHaveBeenCalledWith('excludedModelsText', 'claude-fable-5');
  });
});
