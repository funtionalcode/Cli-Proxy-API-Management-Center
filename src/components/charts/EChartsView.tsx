import { useEffect, useRef, type CSSProperties } from 'react';
import type { ECElementEvent, EChartsCoreOption, EChartsType, SetOptionOpts } from 'echarts/core';
import { echarts } from './echartsCore';

interface EChartsViewProps {
  option: EChartsCoreOption;
  ariaLabel: string;
  className?: string;
  style?: CSSProperties;
  role?: string;
  setOptionOpts?: SetOptionOpts;
  onClick?: (event: ECElementEvent) => void;
}

export function EChartsView({
  option,
  ariaLabel,
  className,
  style,
  role = 'img',
  setOptionOpts = { notMerge: true },
  onClick,
}: EChartsViewProps) {
  const elementRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<EChartsType | null>(null);

  useEffect(() => {
    if (!elementRef.current) return;

    const chart = chartRef.current ?? echarts.init(elementRef.current);
    chartRef.current = chart;
    chart.setOption(option, setOptionOpts);
  }, [option, setOptionOpts]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    chart.off('click');
    if (onClick) {
      chart.on('click', onClick);
    }

    return () => {
      chart.off('click');
    };
  }, [onClick]);

  useEffect(() => {
    const element = elementRef.current;
    const chart = chartRef.current;
    if (!element || !chart) return;

    const resize = () => chart.resize();
    const observer =
      typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null;
    observer?.observe(element);
    window.addEventListener('resize', resize);

    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', resize);
    };
  }, []);

  useEffect(
    () => () => {
      chartRef.current?.dispose();
      chartRef.current = null;
    },
    []
  );

  return (
    <div
      ref={elementRef}
      className={className}
      style={style}
      role={role}
      aria-label={ariaLabel}
    />
  );
}
