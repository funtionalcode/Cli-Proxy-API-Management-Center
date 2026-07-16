import { IconSettings } from '@/components/ui/icons';
import type { ConfigOverviewItem } from '@/features/monitoring/model/codexInspectionPresentation';
import styles from '../CodexInspectionPage.module.scss';

type CodexInspectionConfigOverviewProps = {
  title: string;
  editLabel: string;
  items: ConfigOverviewItem[];
  onEdit: (field?: string) => void;
  ariaLabel?: string;
};

// 已存在配置的「读」面板:可点击的 label/value 概览卡,点任意卡片直达对应字段编辑。
export function CodexInspectionConfigOverview({
  title,
  editLabel,
  items,
  onEdit,
  ariaLabel,
}: CodexInspectionConfigOverviewProps) {
  return (
    <section className={styles.configOverview} aria-label={ariaLabel ?? title}>
      <header className={styles.configOverviewHeader}>
        <span className={styles.configOverviewTitle}>{title}</span>
        <button
          type="button"
          className={styles.configOverviewEdit}
          onClick={() => onEdit()}
        >
          <IconSettings size={14} />
          <span>{editLabel}</span>
        </button>
      </header>
      <div className={styles.configOverviewGrid}>
        {items.map((item) => (
          <button
            key={item.key}
            type="button"
            className={[
              styles.configOverviewItem,
              item.tone ? styles[`tone-${item.tone}`] : '',
            ]
              .filter(Boolean)
              .join(' ')}
            onClick={() => onEdit(item.field)}
            title={item.value}
            aria-label={`${item.label}: ${item.value}`}
          >
            <span className={styles.configOverviewLabel}>{item.label}</span>
            <strong className={styles.configOverviewValue}>{item.value}</strong>
            {item.hint ? (
              <span className={styles.configOverviewHint}>{item.hint}</span>
            ) : null}
          </button>
        ))}
      </div>
    </section>
  );
}
