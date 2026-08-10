/**
 * CopyableText
 * 长 ID / 文件名 / 追踪号等"需要复制的不可变文本"用此组件包裹,点击即复制。
 *
 * 设计目标:
 *   - 视觉: 等宽字体,小尺寸,带左侧副本图标
 *   - 触屏: 仍可点击(button),会触觉反馈
 *   - a11y: button role,带 aria-label 解释复制动作
 */
import { useCallback, useState, type JSX } from 'react';
import { useTranslation } from 'react-i18next';
import { IconCopy } from '@/components/ui/icons';
import styles from './CopyableText.module.scss';

interface CopyableTextProps {
  value: string;
  /** 复制的 fallback;留空时复制 value */
  copyValue?: string;
  /** 自定义 aria-label;留空时使用 "复制 {value}" */
  ariaLabel?: string;
  /** 复制成功后是否显示 ✓ 反馈 (默认 1.6s) */
  showFeedback?: boolean;
  className?: string;
}

export const CopyableText = ({
  value,
  copyValue,
  ariaLabel,
  showFeedback = true,
  className,
}: CopyableTextProps): JSX.Element => {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  const handleClick = useCallback(() => {
    const text = copyValue ?? value;
    if (!text) return;
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(text).then(
        () => {
          if (showFeedback) {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1600);
          }
        },
        () => {
          // Fallback to legacy execCommand
          const ta = document.createElement('textarea');
          ta.value = text;
          document.body.appendChild(ta);
          ta.select();
          document.execCommand('copy');
          document.body.removeChild(ta);
          if (showFeedback) {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1600);
          }
        }
      );
    }
  }, [value, copyValue, showFeedback]);

  return (
    <button
      type="button"
      className={[styles.button, className].filter(Boolean).join(' ')}
      onClick={handleClick}
      aria-label={ariaLabel ?? t('common.copy_value', { defaultValue: '复制', value })}
      title={value}
    >
      <span className={styles.text}>{value}</span>
      <span className={styles.icon} aria-hidden="true">
        {copied ? '✓' : <IconCopy size={12} />}
      </span>
    </button>
  );
};
