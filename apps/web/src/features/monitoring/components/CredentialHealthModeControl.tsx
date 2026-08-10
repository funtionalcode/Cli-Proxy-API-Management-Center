import { useTranslation } from 'react-i18next';
import type { CredentialHealthInspectionMode } from '@/features/monitoring/model/credentialInspectionSnapshot';
import styles from '../CodexInspectionPage.module.scss';

interface CredentialHealthModeControlProps {
  activeMode: CredentialHealthInspectionMode;
  checking: boolean;
  serverAvailable: boolean;
  onChange: (mode: CredentialHealthInspectionMode) => void;
}

export function CredentialHealthModeControl({
  activeMode,
  checking,
  serverAvailable,
  onChange,
}: CredentialHealthModeControlProps) {
  const { t } = useTranslation();

  return (
    <div
      className={styles.credentialHealthTabs}
      role="tablist"
      aria-label={t('monitoring.codex_inspection_mode_label')}
    >
      <button
        type="button"
        role="tab"
        aria-selected={activeMode === 'local'}
        className={`${styles.credentialHealthTab} ${activeMode === 'local' ? styles.credentialHealthTabActive : ''}`}
        onClick={() => onChange('local')}
      >
        {t('monitoring.codex_inspection_mode_local')}
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={activeMode === 'server'}
        className={`${styles.credentialHealthTab} ${activeMode === 'server' ? styles.credentialHealthTabActive : ''}`}
        onClick={() => onChange('server')}
        disabled={checking || !serverAvailable}
        title={
          !checking && !serverAvailable
            ? t('monitoring.codex_inspection_mode_server_unavailable')
            : undefined
        }
      >
        {t('monitoring.codex_inspection_mode_server')}
      </button>
    </div>
  );
}
