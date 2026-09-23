import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { IconDollarSign } from '@/components/ui/icons';
import { useModelPriceAttention } from './useModelPriceAttention';
import { ModelPriceAttentionDot } from './ModelPriceAttentionDot';
import styles from './ModelPriceAttention.module.scss';

export interface ModelPriceAttentionLinkProps {
  variant?: 'action-bar' | 'inline';
  className?: string;
  onClick?: () => void;
}

const resolveShortLabel = (t: TFunction) => {
  const fallback = t('usage_stats.model_price_settings');
  const label = t('usage_stats.model_price_settings_short', { defaultValue: fallback });
  return label === 'usage_stats.model_price_settings_short' ? fallback : label;
};

export function ModelPriceAttentionLink({
  variant = 'inline',
  className,
  onClick,
}: ModelPriceAttentionLinkProps) {
  const { t } = useTranslation();
  const attention = useModelPriceAttention();

  if (!attention.modelPricesAvailable) {
    return null;
  }

  if (variant === 'action-bar') {
    const shortLabel = resolveShortLabel(t);
    const hasAttention = attention.hasAttention;
    const to = hasAttention ? '/model-prices?filter=missing' : '/model-prices';
    const title = hasAttention
      ? t('usage_stats.model_price_attention_tooltip', { count: attention.pendingCount })
      : t('usage_stats.model_price_settings');

    return (
      <Link
        to={to}
        className={className}
        title={title}
        aria-label={title}
        onClick={onClick}
        data-testid="monitoring-model-prices-link"
        data-has-attention={hasAttention}
      >
        <IconDollarSign size={16} />
        <span>{shortLabel}</span>
        {hasAttention ? <ModelPriceAttentionDot /> : null}
      </Link>
    );
  }

  // Inline variant for Dashboard & Usage Analytics: only shown when pending > 0
  if (!attention.hasAttention) {
    return null;
  }

  const tooltip = t('usage_stats.model_price_attention_tooltip', {
    count: attention.pendingCount,
  });

  return (
    <Link
      to="/model-prices?filter=missing"
      className={`${styles.inlineLink} ${className || ''}`}
      title={tooltip}
      aria-label={tooltip}
      onClick={onClick}
      data-testid="inline-model-price-attention-link"
    >
      <IconDollarSign size={14} />
      <ModelPriceAttentionDot />
    </Link>
  );
}
