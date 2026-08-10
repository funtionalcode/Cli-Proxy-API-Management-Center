/**
 * RelativeTime
 * 统一时间显示 — 把所有抽屉 / 卡片 / 列表里的"短 / 长 / 相对" 时间口径收敛为同一种契约。
 *
 * 模式:
 *   - absolute: 仅绝对 (e.g. 2026-07-08 13:41)
 *   - relative: 仅相对 (e.g. +4h)
 *   - both:     同时显示两段 (e.g. 2026-07-08 13:41 · +4h)
 *
 * 不依赖 i18n, 由调用方传入 locale 或已格式化字符串 — 这样组件保持 pure / 易测。
 */
import { useEffect, useState, type JSX } from 'react';

export type RelativeTimeMode = 'absolute' | 'relative' | 'both';

interface RelativeTimeProps {
  /** 时间戳(ms);空值时显示 fallback */
  timestamp: number | null | undefined;
  /** 显示模式,默认 both */
  mode?: RelativeTimeMode;
  /** 绝对时间格式化的 locale,默认 zh-CN */
  locale?: string;
  /** 空值回退文本 */
  fallback?: string;
  /** 自定义格式化函数;不传时回退到默认 Intl */
  formatAbsolute?: (ts: number, locale: string) => string;
}

const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

const defaultFormatAbsolute = (ts: number, locale: string): string => {
  try {
    return new Intl.DateTimeFormat(locale || 'zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date(ts));
  } catch {
    return new Date(ts).toISOString();
  }
};

const formatRelative = (diffMs: number): string => {
  const abs = Math.abs(diffMs);
  const sign = diffMs < 0 ? '-' : '+';
  if (abs < MINUTE) return `${sign}now`;
  if (abs < HOUR) return `${sign}${Math.round(abs / MINUTE)}m`;
  if (abs < DAY) return `${sign}${Math.round(abs / HOUR)}h`;
  if (abs < WEEK) return `${sign}${Math.round(abs / DAY)}d`;
  return `${sign}${Math.round(abs / WEEK)}w`;
};

export const RelativeTime = ({
  timestamp,
  mode = 'both',
  locale = 'zh-CN',
  fallback = '-',
  formatAbsolute = defaultFormatAbsolute,
}: RelativeTimeProps): JSX.Element => {
  const [nowMs, setNowMs] = useState<number | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      setNowMs(Date.now());
    }, 0);
    return () => clearTimeout(timer);
  }, [timestamp]);

  if (timestamp === null || timestamp === undefined || !Number.isFinite(timestamp)) {
    return <>{fallback}</>;
  }
  const absolute = formatAbsolute(timestamp, locale);
  const relative = nowMs === null ? null : formatRelative(timestamp - nowMs);

  if (mode === 'absolute') return <>{absolute}</>;
  if (mode === 'relative') return <>{relative ?? fallback}</>;
  if (relative === null) return <>{absolute}</>;
  return <>{`${absolute} · ${relative}`}</>;
};
