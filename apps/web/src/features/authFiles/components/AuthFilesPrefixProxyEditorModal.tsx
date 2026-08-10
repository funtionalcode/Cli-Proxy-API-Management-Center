import { useTranslation } from 'react-i18next';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { Input } from '@/components/ui/Input';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { IconRefreshCw } from '@/components/ui/icons';
import type { AuthFileItem } from '@/types';
import type {
  PrefixProxyEditorField,
  PrefixProxyEditorFieldValue,
  PrefixProxyEditorState,
} from '@/features/authFiles/hooks/useAuthFilesPrefixProxyEditor';
import {
  supportsAuthFileUsingApi,
  supportsAuthFileWebsockets,
} from '@/features/authFiles/constants';
import styles from '@/features/authFiles/AuthFilesPage.module.scss';

const REDACTED_VALUE = '[redacted]';
const SENSITIVE_KEY_PARTS = [
  'apikey',
  'authorization',
  'bearer',
  'clientsecret',
  'cookie',
  'credential',
  'managementkey',
  'password',
  'privatekey',
  'secret',
];

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const isSensitiveKey = (key: string) => {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');
  return (
    normalized === 'token' ||
    normalized.endsWith('token') ||
    SENSITIVE_KEY_PARTS.some((part) => normalized.includes(part))
  );
};

const redactProxyUrl = (value: string): string => {
  try {
    const parsed = new URL(value);
    parsed.username = '';
    parsed.password = '';
    parsed.pathname = '';
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return value ? REDACTED_VALUE : '';
  }
};

const redactJsonValue = (value: unknown, key = ''): unknown => {
  const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (normalizedKey === 'proxyurl' && typeof value === 'string') {
    return redactProxyUrl(value);
  }
  if (key && isSensitiveKey(key)) {
    return REDACTED_VALUE;
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactJsonValue(item));
  }
  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([entryKey, entryValue]) => [
        entryKey,
        redactJsonValue(entryValue, entryKey),
      ])
    );
  }
  return value;
};

const formatJsonText = (text: string, redactSensitive = false) => {
  if (!text) return '';
  try {
    const parsed = JSON.parse(text) as unknown;
    return JSON.stringify(redactSensitive ? redactJsonValue(parsed) : parsed, null, 2);
  } catch {
    return text;
  }
};

export type AuthFilesPrefixProxyEditorModalProps = {
  disableControls: boolean;
  editor: PrefixProxyEditorState | null;
  updatedText: string;
  dirty: boolean;
  credentialRefreshing: boolean;
  onClose: () => void;
  onCopyText: (text: string) => void | Promise<void>;
  onSave: () => void;
  onRefreshCredential: (file: AuthFileItem) => void | Promise<void>;
  onChange: (field: PrefixProxyEditorField, value: PrefixProxyEditorFieldValue) => void;
};

export function AuthFilesPrefixProxyEditorModal(props: AuthFilesPrefixProxyEditorModalProps) {
  const { t } = useTranslation();
  const {
    disableControls,
    editor,
    updatedText,
    dirty,
    credentialRefreshing,
    onClose,
    onCopyText,
    onSave,
    onRefreshCredential,
    onChange,
  } = props;
  const previewText = formatJsonText(updatedText, true);
  const fileInfoPreviewText = formatJsonText(editor?.fileInfoText ?? '', true);

  return (
    <Modal
      open={Boolean(editor)}
      onClose={onClose}
      closeDisabled={editor?.saving === true}
      width={720}
      title={
        editor?.fileName
          ? t('auth_files.auth_field_editor_title', { name: editor.fileName })
          : t('auth_files.prefix_proxy_button')
      }
      footer={
        <>
          {editor?.providerKey === 'codex' && (
            <Button
              variant="secondary"
              className={styles.prefixProxyCredentialRefreshButton}
              onClick={() => void onRefreshCredential(editor.authFile)}
              loading={credentialRefreshing}
              disabled={disableControls || editor.loading || editor.saving || credentialRefreshing}
              title={t('auth_files.credential_refresh_hint')}
              aria-label={t('auth_files.credential_refresh_button')}
            >
              {!credentialRefreshing && <IconRefreshCw size={16} />}
              {t('auth_files.credential_refresh_button')}
            </Button>
          )}
          <Button variant="secondary" onClick={onClose} disabled={editor?.saving === true}>
            {dirty ? t('common.cancel') : t('common.close')}
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              if (!previewText) return;
              void onCopyText(previewText);
            }}
            disabled={editor?.saving === true || !previewText}
            title={t('auth_files.prefix_proxy_copy_redacted_hint')}
          >
            {t('common.copy')}
          </Button>
          <Button
            onClick={onSave}
            loading={editor?.saving === true}
            disabled={
              disableControls ||
              editor?.saving === true ||
              !dirty ||
              !editor?.json ||
              Boolean(editor?.headersTouched && editor.headersError) ||
              Boolean(editor?.modelAliasesTouched && editor.modelAliasesError)
            }
          >
            {t('common.save')}
          </Button>
        </>
      }
    >
      {editor && (
        <div className={styles.prefixProxyEditor}>
          {editor.loading ? (
            <div className={styles.prefixProxyLoading}>
              <LoadingSpinner size={14} />
              <span>{t('auth_files.prefix_proxy_loading')}</span>
            </div>
          ) : (
            <>
              {editor.error && <div className={styles.prefixProxyError}>{editor.error}</div>}
              <div className={styles.prefixProxyJsonWrapper}>
                <label className={styles.prefixProxyLabel}>
                  {t('auth_files.prefix_proxy_info_label')}
                </label>
                <textarea
                  className={styles.prefixProxyTextarea}
                  rows={8}
                  readOnly
                  value={fileInfoPreviewText}
                />
              </div>
              {editor.json && (
                <div className={styles.prefixProxyJsonWrapper}>
                  <label className={styles.prefixProxyLabel}>
                    {t('auth_files.prefix_proxy_source_label')}
                  </label>
                  <textarea
                    className={styles.prefixProxyTextarea}
                    rows={10}
                    readOnly
                    value={previewText}
                  />
                </div>
              )}
              {editor.json && (
                <div className={styles.prefixProxySecurityNote}>
                  {t('auth_files.prefix_proxy_redacted_hint')}
                </div>
              )}
              {editor.json && (
                <div className={styles.prefixProxyFields}>
                  <Input
                    label={t('auth_files.prefix_label')}
                    value={editor.prefix}
                    disabled={disableControls || editor.saving || !editor.json}
                    onChange={(e) => onChange('prefix', e.target.value)}
                  />
                  <Input
                    label={t('auth_files.proxy_url_label')}
                    value={editor.proxyUrl}
                    placeholder={t('auth_files.proxy_url_placeholder')}
                    disabled={disableControls || editor.saving || !editor.json}
                    onChange={(e) => onChange('proxyUrl', e.target.value)}
                  />
                  <Input
                    label={t('auth_files.priority_label')}
                    value={editor.priority}
                    placeholder={t('auth_files.priority_placeholder')}
                    hint={t('auth_files.priority_hint')}
                    disabled={disableControls || editor.saving || !editor.json}
                    onChange={(e) => onChange('priority', e.target.value)}
                  />
                  <Input
                    label={t('auth_files.weight_label')}
                    value={editor.weight}
                    placeholder={t('auth_files.weight_placeholder')}
                    hint={t('auth_files.weight_hint')}
                    disabled={disableControls || editor.saving || !editor.json}
                    onChange={(e) => onChange('weight', e.target.value)}
                  />
                  {supportsAuthFileWebsockets(editor.providerKey) && (
                    <div className="form-group">
                      <label>{t('auth_files.websockets_label')}</label>
                      <ToggleSwitch
                        checked={Boolean(editor.websockets)}
                        onChange={(value) => onChange('websockets', value)}
                        disabled={disableControls || editor.saving || !editor.json}
                        ariaLabel={t('auth_files.websockets_label')}
                      />
                      <div className="hint">{t('auth_files.websockets_hint')}</div>
                    </div>
                  )}
                  {supportsAuthFileUsingApi(editor.providerKey) && (
                    <div className="form-group">
                      <label>{t('auth_files.using_api_label')}</label>
                      <ToggleSwitch
                        checked={editor.usingApi}
                        onChange={(value) => onChange('usingApi', value)}
                        disabled={disableControls || editor.saving || !editor.json}
                        ariaLabel={t('auth_files.using_api_label')}
                      />
                      <div className="hint">{t('auth_files.using_api_hint')}</div>
                    </div>
                  )}
                  <div className="form-group">
                    <label>{t('auth_files.headers_label')}</label>
                    <textarea
                      className={`input ${editor.headersError ? styles.prefixProxyTextareaInvalid : ''}`}
                      value={editor.headersText}
                      placeholder={t('auth_files.headers_placeholder')}
                      rows={4}
                      aria-invalid={Boolean(editor.headersError)}
                      disabled={disableControls || editor.saving || !editor.json}
                      onChange={(e) => onChange('headersText', e.target.value)}
                    />
                    {editor.headersError && <div className="error-box">{editor.headersError}</div>}
                    <div className="hint">{t('auth_files.headers_hint')}</div>
                  </div>
                  <div className="form-group">
                    <label>{t('auth_files.model_aliases_label')}</label>
                    <textarea
                      className={`input ${editor.modelAliasesError ? styles.prefixProxyTextareaInvalid : ''}`}
                      value={editor.modelAliasesText}
                      placeholder={t('auth_files.model_aliases_placeholder')}
                      rows={6}
                      aria-invalid={Boolean(editor.modelAliasesError)}
                      disabled={disableControls || editor.saving || !editor.json}
                      onChange={(e) => onChange('modelAliasesText', e.target.value)}
                    />
                    {editor.modelAliasesError && (
                      <div className="error-box">{editor.modelAliasesError}</div>
                    )}
                    <div className="hint">{t('auth_files.model_aliases_hint')}</div>
                  </div>
                  <Input
                    label={t('auth_files.note_label')}
                    value={editor.note}
                    placeholder={t('auth_files.note_placeholder')}
                    hint={t('auth_files.note_hint')}
                    disabled={disableControls || editor.saving || !editor.json}
                    onChange={(e) => onChange('note', e.target.value)}
                  />
                </div>
              )}
            </>
          )}
        </div>
      )}
    </Modal>
  );
}
