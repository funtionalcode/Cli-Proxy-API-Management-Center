import {
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import styles from './AccountRequestTimeTooltip.module.scss';

const VIEWPORT_MARGIN = 12;
const TOOLTIP_OFFSET = 8;
const TOOLTIP_MAX_WIDTH = 260;
const TOOLTIP_ESTIMATED_WIDTH = 180;
const TOOLTIP_ESTIMATED_HEIGHT = 52;

type TooltipPlacement = 'above' | 'below';

type TooltipPosition = {
  placement: TooltipPlacement;
  style: CSSProperties;
};

type AccountRequestTimeTooltipProps = {
  label: string;
  value: string;
  ariaLabel: string;
  children: ReactNode;
};

const clampNumber = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

const resolveTooltipPosition = (
  anchor: HTMLElement,
  tooltip: HTMLElement | null
): TooltipPosition | null => {
  if (typeof window === 'undefined') return null;

  const rect = anchor.getBoundingClientRect();
  const availableWidth = Math.max(0, window.innerWidth - VIEWPORT_MARGIN * 2);
  const maxWidth = Math.min(TOOLTIP_MAX_WIDTH, availableWidth);
  const tooltipWidth = Math.min(tooltip?.offsetWidth || TOOLTIP_ESTIMATED_WIDTH, maxWidth);
  const tooltipHeight = tooltip?.offsetHeight || TOOLTIP_ESTIMATED_HEIGHT;
  const spaceAbove = rect.top - VIEWPORT_MARGIN - TOOLTIP_OFFSET;
  const spaceBelow = window.innerHeight - rect.bottom - VIEWPORT_MARGIN - TOOLTIP_OFFSET;
  const placement: TooltipPlacement =
    spaceAbove >= tooltipHeight || spaceAbove >= spaceBelow ? 'above' : 'below';
  const left = clampNumber(
    rect.left + rect.width / 2 - tooltipWidth / 2,
    VIEWPORT_MARGIN,
    Math.max(VIEWPORT_MARGIN, window.innerWidth - VIEWPORT_MARGIN - tooltipWidth)
  );
  const top =
    placement === 'above'
      ? Math.max(VIEWPORT_MARGIN, rect.top - TOOLTIP_OFFSET - tooltipHeight)
      : Math.min(
          window.innerHeight - VIEWPORT_MARGIN - tooltipHeight,
          rect.bottom + TOOLTIP_OFFSET
        );

  return {
    placement,
    style: {
      left,
      top,
      width: 'max-content',
      maxWidth,
    },
  };
};

export function AccountRequestTimeTooltip({
  label,
  value,
  ariaLabel,
  children,
}: AccountRequestTimeTooltipProps) {
  const tooltipId = useId();
  const triggerRef = useRef<HTMLSpanElement | null>(null);
  const tooltipRef = useRef<HTMLSpanElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const [open, setOpen] = useState(false);
  const [tooltipPosition, setTooltipPosition] = useState<TooltipPosition | null>(null);
  const isBrowser = typeof document !== 'undefined';

  const updateTooltipPosition = useCallback(() => {
    if (!triggerRef.current) return;
    const nextPosition = resolveTooltipPosition(triggerRef.current, tooltipRef.current);
    if (nextPosition) setTooltipPosition(nextPosition);
  }, []);

  const scheduleTooltipPositionUpdate = useCallback(() => {
    if (typeof window === 'undefined') return;
    if (rafRef.current !== null) window.cancelAnimationFrame(rafRef.current);
    rafRef.current = window.requestAnimationFrame(() => {
      rafRef.current = null;
      updateTooltipPosition();
    });
  }, [updateTooltipPosition]);

  const showTooltip = useCallback(() => {
    updateTooltipPosition();
    setOpen(true);
  }, [updateTooltipPosition]);

  const hideTooltip = useCallback(() => setOpen(false), []);

  const handleKeyDown = useCallback((event: KeyboardEvent<HTMLSpanElement>) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    setOpen(false);
  }, []);

  useLayoutEffect(() => {
    if (open) updateTooltipPosition();
  }, [open, label, updateTooltipPosition, value]);

  useEffect(() => {
    if (!open || typeof window === 'undefined') return undefined;
    window.addEventListener('resize', scheduleTooltipPositionUpdate);
    window.addEventListener('scroll', scheduleTooltipPositionUpdate, true);

    return () => {
      window.removeEventListener('resize', scheduleTooltipPositionUpdate);
      window.removeEventListener('scroll', scheduleTooltipPositionUpdate, true);
    };
  }, [open, scheduleTooltipPositionUpdate]);

  useEffect(
    () => () => {
      if (rafRef.current !== null && typeof window !== 'undefined') {
        window.cancelAnimationFrame(rafRef.current);
      }
    },
    []
  );

  const tooltip = (
    <span
      ref={tooltipRef}
      id={tooltipId}
      role="tooltip"
      className={styles.tooltip}
      style={isBrowser ? tooltipPosition?.style : undefined}
      data-placement={tooltipPosition?.placement}
      data-account-request-time-tooltip-content="true"
    >
      <span className={styles.label} data-account-request-time-tooltip-label="true">
        {label}
      </span>
      <span className={styles.value} data-account-request-time-tooltip-value="true">
        {value}
      </span>
    </span>
  );

  return (
    <span
      ref={triggerRef}
      className={styles.trigger}
      tabIndex={0}
      aria-label={ariaLabel}
      aria-describedby={open ? tooltipId : undefined}
      data-account-request-time-tooltip="true"
      onMouseEnter={showTooltip}
      onMouseLeave={hideTooltip}
      onFocus={showTooltip}
      onBlur={hideTooltip}
      onKeyDown={handleKeyDown}
    >
      {children}
      {!isBrowser ? tooltip : null}
      {isBrowser && open && tooltipPosition ? createPortal(tooltip, document.body) : null}
    </span>
  );
}
