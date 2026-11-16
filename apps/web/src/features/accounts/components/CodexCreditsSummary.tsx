import { useTranslation } from 'react-i18next';
import { getCodexCreditsDisplay, type CodexCreditsFields } from '@/utils/quota/codexCredits';
import styles from './CodexCreditsSummary.module.scss';

interface CodexCreditsSummaryProps {
  credits: CodexCreditsFields | null | undefined;
  inUse?: boolean;
}

export function CodexCreditsSummary({ credits, inUse = false }: CodexCreditsSummaryProps) {
  const { t, i18n } = useTranslation();
  const display = getCodexCreditsDisplay(credits);
  if (!display) return null;
  const value =
    display.kind === 'unlimited'
      ? t('codex_quota.credits_unlimited')
      : display.balance < 1
        ? '<1'
        : new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 0 }).format(
            Math.floor(display.balance)
          );
  const fullValue = display.kind === 'balance' ? String(credits?.creditsBalance) : value;
  return (
    <span className={styles.summary} data-codex-credits-summary="true">
      <span
        className={styles.balance}
        title={`${t('codex_quota.credits_balance_label')}: ${fullValue}`}
      >
        <span>{t('codex_quota.credits_balance_label')}</span>
        <strong data-codex-credits-balance="true">{value}</strong>
      </span>
      {inUse ? (
        <span className={styles.hint} data-codex-credits-in-use="true">
          {t('codex_quota.credits_in_use_hint')}
        </span>
      ) : null}
    </span>
  );
}
