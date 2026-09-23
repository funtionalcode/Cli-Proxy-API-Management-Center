import styles from './ModelPriceAttention.module.scss';

export interface ModelPriceAttentionDotProps {
  className?: string;
}

export function ModelPriceAttentionDot({ className }: ModelPriceAttentionDotProps) {
  return (
    <span
      className={`${styles.attentionDot} ${className || ''}`}
      aria-hidden="true"
      data-testid="model-price-attention-dot"
    />
  );
}
