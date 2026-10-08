import { renderToStaticMarkup } from 'react-dom/server';
import { act } from 'react';
import { create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TFunction } from 'i18next';
import { Button } from '@/components/ui/Button';
import {
  UsageCoverageWarning,
  USAGE_COVERAGE_WARNING_DISMISSED_KEY,
} from './UsageCoverageWarning';

type StorageLike = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
  clear: () => void;
};

const createMemoryStorage = (): StorageLike => {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, String(value));
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
  };
};

const originalWindow = (globalThis as { window?: unknown }).window;

const t = ((key: string, options?: Record<string, unknown>) => {
  const translations: Record<string, string> = {
    'monitoring.coverage_warning_current': 'current {{deleted}}',
    'monitoring.coverage_warning_comparison': 'comparison {{deleted}}',
    'monitoring.coverage_warning_rolling': 'rolling {{deleted}}',
    'monitoring.coverage_warning_drilldown': 'drilldown {{deleted}}',
    'monitoring.coverage_warning_auxiliary': 'auxiliary {{deleted}}',
    'monitoring.coverage_warning_dismiss': '我知道了，不再显示',
  };
  let value = translations[key] ?? key;
  Object.entries(options ?? {}).forEach(([name, replacement]) => {
    value = value.replace(`{{${name}}}`, String(replacement));
  });
  return value;
}) as TFunction;

describe('UsageCoverageWarning', () => {
  let storage: StorageLike;

  beforeEach(() => {
    storage = createMemoryStorage();
    (globalThis as { window?: unknown }).window = { localStorage: storage };
  });

  afterEach(() => {
    if (originalWindow === undefined) {
      delete (globalThis as { window?: unknown }).window;
    } else {
      (globalThis as { window?: unknown }).window = originalWindow;
    }
  });

  it('identifies current and comparison deletion separately and reports fidelity limits', () => {
    const html = renderToStaticMarkup(
      <UsageCoverageWarning
        t={t}
        coverage={{
          scope: 'time_range',
          mode: 'mixed',
          raw_complete: false,
          core_aggregate_used: true,
          raw_event_count: 4,
          raw_deleted_event_count: 2,
          min_deleted_timestamp_ms: 1,
          max_deleted_timestamp_ms: 2,
          comparison_raw_event_count: 0,
          comparison_raw_deleted_event_count: 3,
          comparison_min_deleted_timestamp_ms: 3,
          comparison_max_deleted_timestamp_ms: 4,
          fidelity_limitations: ['event_details_require_raw_events'],
        }}
      />
    );

    expect(html).toContain('role="status"');
    expect(html).toContain('data-coverage-mode="mixed"');
    expect(html).toContain('current 2');
    expect(html).toContain('comparison 3');
    expect(html).toContain('monitoring.coverage_warning_limited');
    expect(html).toContain('我知道了，不再显示');
  });

  it('renders when only auxiliary requested ranges contain deleted raw events', () => {
    const html = renderToStaticMarkup(
      <UsageCoverageWarning
        t={t}
        coverage={{
          scope: 'requested_ranges',
          mode: 'aggregate_only',
          raw_complete: false,
          core_aggregate_used: true,
          raw_deleted_event_count: 0,
          min_deleted_timestamp_ms: 0,
          max_deleted_timestamp_ms: 0,
          auxiliary_ranges: [
            {
              scope: 'rolling_30m',
              from_ms: 1,
              to_ms: 2,
              raw_deleted_event_count: 2,
            },
            {
              scope: 'drilldown_preview',
              from_ms: 3,
              to_ms: 4,
              raw_deleted_event_count: 1,
            },
          ],
          fidelity_limitations: ['event_details_require_raw_events'],
        }}
      />
    );

    expect(html).toContain('rolling 2');
    expect(html).toContain('drilldown 1');
    expect(html).toContain('monitoring.coverage_warning_limited');
  });

  it('does not render without deleted raw events', () => {
    const html = renderToStaticMarkup(
      <UsageCoverageWarning
        t={t}
        coverage={{
          scope: 'time_range',
          mode: 'raw',
          raw_complete: true,
          core_aggregate_used: false,
          raw_event_count: 4,
          raw_deleted_event_count: 0,
          min_deleted_timestamp_ms: 0,
          max_deleted_timestamp_ms: 0,
          fidelity_limitations: [],
        }}
      />
    );

    expect(html).toBe('');
  });

  it('does not render dismiss button when dismissible is false', () => {
    const html = renderToStaticMarkup(
      <UsageCoverageWarning
        t={t}
        dismissible={false}
        coverage={{
          scope: 'time_range',
          mode: 'mixed',
          raw_complete: false,
          core_aggregate_used: true,
          raw_event_count: 4,
          raw_deleted_event_count: 2,
          min_deleted_timestamp_ms: 1,
          max_deleted_timestamp_ms: 2,
          fidelity_limitations: [],
        }}
      />
    );

    expect(html).not.toContain('我知道了，不再显示');
  });

  it('dismisses warning, writes to localStorage, and invokes onDismiss when clicked', () => {
    const onDismiss = vi.fn();
    let renderer!: ReactTestRenderer;

    act(() => {
      renderer = create(
        <UsageCoverageWarning
          t={t}
          onDismiss={onDismiss}
          coverage={{
            scope: 'time_range',
            mode: 'mixed',
            raw_complete: false,
            core_aggregate_used: true,
            raw_event_count: 4,
            raw_deleted_event_count: 2,
            min_deleted_timestamp_ms: 1,
            max_deleted_timestamp_ms: 2,
            fidelity_limitations: [],
          }}
        />
      );
    });

    const button = renderer.root.findByType(Button);
    expect(button).toBeTruthy();

    act(() => {
      button.props.onClick();
    });

    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(storage.getItem(USAGE_COVERAGE_WARNING_DISMISSED_KEY)).toBe('true');
    expect(renderer.toJSON()).toBeNull();
  });

  it('does not render when localStorage has already marked it as dismissed', () => {
    storage.setItem(USAGE_COVERAGE_WARNING_DISMISSED_KEY, 'true');

    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(
        <UsageCoverageWarning
          t={t}
          coverage={{
            scope: 'time_range',
            mode: 'mixed',
            raw_complete: false,
            core_aggregate_used: true,
            raw_event_count: 4,
            raw_deleted_event_count: 2,
            min_deleted_timestamp_ms: 1,
            max_deleted_timestamp_ms: 2,
            fidelity_limitations: [],
          }}
        />
      );
    });

    expect(renderer.toJSON()).toBeNull();
  });

  it('respects a custom storageKey for isolation', () => {
    const customKey = 'custom.coverage_dismissed';
    let renderer!: ReactTestRenderer;

    act(() => {
      renderer = create(
        <UsageCoverageWarning
          t={t}
          storageKey={customKey}
          coverage={{
            scope: 'time_range',
            mode: 'mixed',
            raw_complete: false,
            core_aggregate_used: true,
            raw_event_count: 4,
            raw_deleted_event_count: 2,
            min_deleted_timestamp_ms: 1,
            max_deleted_timestamp_ms: 2,
            fidelity_limitations: [],
          }}
        />
      );
    });

    const button = renderer.root.findByType(Button);
    act(() => {
      button.props.onClick();
    });

    expect(storage.getItem(customKey)).toBe('true');
    expect(storage.getItem(USAGE_COVERAGE_WARNING_DISMISSED_KEY)).toBeNull();
    expect(renderer.toJSON()).toBeNull();
  });
});

