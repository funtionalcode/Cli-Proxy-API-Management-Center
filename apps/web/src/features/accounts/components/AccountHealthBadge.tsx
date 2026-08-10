/**
 * AccountHealthBadge
 * 跨 Tab / 跨状态显示一致的"账号健康度"信号。所有展示源(列表卡片 / 抽屉顶部 / 额度 Tab / 检查建议 Tab)
 * 都消费同一个组件 + 同一套色板 token,避免色卡漂移。
 *
 * 严重度映射:
 *   ok       — 关键配额窗口仍有余量(绿色)
 *   warning  — 健康度偏低、未禁用、可能需要关注(琥珀)
 *   cooldown — 周期配额冷却中(蓝)
 *   critical — 配额耗尽 / 认证失效(红)
 *   disabled — 账号被禁用(灰)
 *   unknown  — 无法判断(灰)
 */
import type { JSX } from 'react';
import './AccountHealthBadge.module.scss';

export type AccountHealthSeverity =
  | 'ok'
  | 'warning'
  | 'cooldown'
  | 'critical'
  | 'disabled'
  | 'unknown';

interface AccountHealthBadgeProps {
  severity: AccountHealthSeverity;
  /** 短标签(如 "可用" / "低额度" / "周冷却" / "已耗尽" / "已禁用") */
  label: string;
  /** 长描述(展示为悬浮气泡) */
  hint?: string;
  /** 自定义 className */
  className?: string;
  /** size: 'sm' 用于列表、'md' 用于抽屉 */
  size?: 'sm' | 'md';
}

const SEVERITY_CLASS: Record<AccountHealthSeverity, string> = {
  ok: 'healthBadgeOk',
  warning: 'healthBadgeWarning',
  cooldown: 'healthBadgeCooldown',
  critical: 'healthBadgeCritical',
  disabled: 'healthBadgeDisabled',
  unknown: 'healthBadgeUnknown',
};

export const AccountHealthBadge = ({
  severity,
  label,
  hint,
  className,
  size = 'md',
}: AccountHealthBadgeProps): JSX.Element => {
  const cls = [
    'healthBadge',
    `healthBadge-${size}`,
    SEVERITY_CLASS[severity],
    className,
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <span className={cls} title={hint}>
      <span className="healthBadgeDot" aria-hidden="true" />
      <span className="healthBadgeLabel">{label}</span>
    </span>
  );
};

/**
 * 把不同来源的"健康度语义"映射到统一 severity。
 * 不直接耦合 row / listItem — 调用方提供 raw 信号即可。
 */
export const severityFromQuotaStatus = (
  status: string | number | null | undefined,
  disabled?: boolean
): AccountHealthSeverity => {
  if (disabled) return 'disabled';
  const token = String(status ?? '').trim();
  switch (token) {
    case 'available':
      return 'ok';
    case 'warning':
      return 'warning';
    case 'cooldown':
      return 'cooldown';
    case 'exhausted':
      return 'critical';
    default:
      return 'unknown';
  }
};
