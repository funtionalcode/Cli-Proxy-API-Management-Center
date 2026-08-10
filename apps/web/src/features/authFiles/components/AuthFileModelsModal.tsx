import { useTranslation } from 'react-i18next';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import type { AuthFileModelItem } from '@/features/authFiles/constants';
import { getProviderRecordValues, isModelExcluded } from '@/features/authFiles/constants';
import type { OAuthModelAliasEntry } from '@/types';
import styles from '@/features/authFiles/AuthFilesPage.module.scss';

export type AuthFileModelsModalProps = {
  open: boolean;
  fileName: string;
  fileType: string;
  loading: boolean;
  error: 'unsupported' | 'failed' | null;
  models: AuthFileModelItem[];
  excluded: Record<string, string[]>;
  aliases?: Record<string, OAuthModelAliasEntry[]>;
  onClose: () => void;
  onRetry?: () => void;
  onCopyText: (text: string) => void;
};

export type AuthFileModelsContentProps = {
  fileType: string;
  loading: boolean;
  error: 'unsupported' | 'failed' | null;
  models: AuthFileModelItem[];
  excluded: Record<string, string[]>;
  aliases?: Record<string, OAuthModelAliasEntry[]>;
  onRetry?: () => void;
  onCopyText: (text: string) => void;
};

export function AuthFileModelsContent(props: AuthFileModelsContentProps) {
  const { t } = useTranslation();
  const { fileType, loading, error, models, excluded, aliases = {}, onRetry, onCopyText } = props;

  if (loading && models.length === 0) {
    return (
      <div className={styles.hint}>
        {t('auth_files.models_loading', { defaultValue: '正在加载模型列表...' })}
      </div>
    );
  }

  if (error === 'unsupported' && models.length === 0) {
    return (
      <EmptyState
        title={t('auth_files.models_unsupported', { defaultValue: '当前版本不支持此功能' })}
        description={t('auth_files.models_unsupported_desc', {
          defaultValue: '请更新 CLI Proxy API 到最新版本后重试',
        })}
      />
    );
  }

  if (error === 'failed' && models.length === 0) {
    return (
      <EmptyState
        title={t('accounts.model_load_failed', {
          defaultValue: '无法加载模型列表',
        })}
        description={t('accounts.model_load_failed_desc', {
          defaultValue: '模型服务请求失败，请稍后重试。',
        })}
        action={
          onRetry ? (
            <Button variant="primary" size="sm" onClick={onRetry}>
              {t('common.retry')}
            </Button>
          ) : undefined
        }
      />
    );
  }

  if (models.length === 0) {
    return (
      <EmptyState
        title={t('auth_files.models_empty', { defaultValue: '该凭证暂无可用模型' })}
        description={t('auth_files.models_empty_desc', {
          defaultValue:
            '该认证凭证可能尚未被服务器加载,或尚未在 AI 提供商里绑定任何模型。可前往 AI 提供商配置页检查绑定状态。',
        })}
        action={
          <Button
            variant="primary"
            size="sm"
            onClick={() => {
              window.location.hash = '#/ai-providers';
            }}
          >
            {t('auth_files.models_empty_action', {
              defaultValue: '前往 AI 提供商配置',
            })}
          </Button>
        }
      />
    );
  }

  const providerAliases = getProviderRecordValues(aliases, fileType)
    .flat()
    .filter((entry, index, entries) => {
      const name = entry.name.trim().toLowerCase();
      const alias = entry.alias.trim().toLowerCase();
      return (
        entries.findIndex(
          (candidate) =>
            candidate.name.trim().toLowerCase() === name &&
            candidate.alias.trim().toLowerCase() === alias
        ) === index
      );
    });

  return (
    <>
      {loading ? (
        <div className={styles.hint} role="status">
          {t('auth_files.models_loading', { defaultValue: '正在加载模型列表...' })}
        </div>
      ) : null}
      {error ? (
        <div className={styles.hint} role={error === 'failed' ? 'alert' : 'note'}>
          {error === 'failed'
            ? t('accounts.model_load_failed', { defaultValue: '无法加载模型列表' })
            : t('auth_files.models_unsupported', { defaultValue: '当前版本不支持此功能' })}
          {onRetry ? (
            <Button variant="secondary" size="sm" onClick={onRetry}>
              {t('common.retry')}
            </Button>
          ) : null}
        </div>
      ) : null}
      <div className={styles.modelsList}>
        {models.map((model) => {
          const excludedModel = isModelExcluded(model.id, fileType, excluded);
          const modelAliases = providerAliases
            .filter((entry) => entry.name.trim().toLowerCase() === model.id.trim().toLowerCase())
            .map((entry) => entry.alias.trim())
            .filter(Boolean);
          return (
            <div
              key={model.id}
              className={`${styles.modelItem} ${excludedModel ? styles.modelItemExcluded : ''}`}
              onClick={() => {
                onCopyText(model.id);
              }}
              title={
                excludedModel
                  ? t('auth_files.models_excluded_hint', {
                      defaultValue: '此 OAuth 模型已被禁用',
                    })
                  : t('common.copy', { defaultValue: '点击复制' })
              }
            >
              <span className={styles.modelId}>{model.id}</span>
              {model.display_name && model.display_name !== model.id && (
                <span className={styles.modelDisplayName}>{model.display_name}</span>
              )}
              {model.type && <span className={styles.modelType}>{model.type}</span>}
              {modelAliases.length > 0 ? (
                <span className={styles.modelType}>→ {modelAliases.join(', ')}</span>
              ) : null}
              {excludedModel && (
                <span className={styles.modelExcludedBadge}>
                  {t('auth_files.models_excluded_badge', { defaultValue: '已禁用' })}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

export function AuthFileModelsModal(props: AuthFileModelsModalProps) {
  const { t } = useTranslation();
  const {
    open,
    fileName,
    fileType,
    loading,
    error,
    models,
    excluded,
    aliases,
    onClose,
    onRetry,
    onCopyText,
  } = props;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('auth_files.models_title', { defaultValue: '支持的模型' }) + ` - ${fileName}`}
      footer={
        <Button variant="secondary" onClick={onClose}>
          {t('common.close')}
        </Button>
      }
    >
      <AuthFileModelsContent
        fileType={fileType}
        loading={loading}
        error={error}
        models={models}
        excluded={excluded}
        aliases={aliases}
        onRetry={onRetry}
        onCopyText={onCopyText}
      />
    </Modal>
  );
}
