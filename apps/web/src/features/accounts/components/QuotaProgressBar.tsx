import styles from './QuotaProgressBar.module.scss';

export interface QuotaProgressBarProps {
  percent: number | null;
  highThreshold: number;
  mediumThreshold: number;
}

export function QuotaProgressBar({
  percent,
  highThreshold,
  mediumThreshold,
}: QuotaProgressBarProps) {
  const normalized = percent === null ? null : Math.min(100, Math.max(0, percent));
  const fillClass =
    normalized === null
      ? styles.fillMedium
      : normalized >= highThreshold
        ? styles.fillHigh
        : normalized >= mediumThreshold
          ? styles.fillMedium
          : styles.fillLow;

  return (
    <div className={styles.track}>
      <div
        className={`${styles.fill} ${fillClass}`}
        style={{ width: `${Math.round(normalized ?? 0)}%` }}
      />
    </div>
  );
}
