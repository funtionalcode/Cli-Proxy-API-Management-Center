import type { ReactNode } from 'react';
import { Card } from '@/components/ui/Card';
import styles from '../CodexInspectionPage.module.scss';

type PanelProps = {
  title?: string;
  subtitle?: string;
  extra?: ReactNode;
  children: ReactNode;
  className?: string;
};

export function Panel({ title, subtitle, extra, children, className }: PanelProps) {
  const showHeader = Boolean(title || subtitle || extra);

  return (
    <Card className={[styles.panel, className].filter(Boolean).join(' ')}>
      {showHeader ? (
        <div className={styles.panelHeader}>
          <div className={styles.panelHeading}>
            {title ? <h2 className={styles.panelTitle}>{title}</h2> : null}
            {subtitle ? <p className={styles.panelSubtitle}>{subtitle}</p> : null}
          </div>
          {extra ? <div className={styles.panelExtra}>{extra}</div> : null}
        </div>
      ) : null}
      {children}
    </Card>
  );
}
