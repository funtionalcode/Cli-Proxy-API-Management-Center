import { describe, expect, it } from 'vitest';
import { getRangeBounds, shouldUseHourlyTimeline } from './range';

describe('monitoring range', () => {
  it('uses the previous local calendar day for yesterday', () => {
    const nowMs = new Date(2026, 7, 28, 15, 30, 0, 0).getTime();

    expect(getRangeBounds('yesterday', nowMs)).toEqual({
      startMs: new Date(2026, 7, 27, 0, 0, 0, 0).getTime(),
      endMs: new Date(2026, 7, 28, 0, 0, 0, 0).getTime(),
    });
  });

  it('uses an hourly timeline for yesterday', () => {
    expect(shouldUseHourlyTimeline('yesterday')).toBe(true);
  });

  it('keeps the existing range behavior', () => {
    const nowMs = new Date(2026, 7, 28, 15, 30, 0, 0).getTime();
    const todayStartMs = new Date(2026, 7, 28, 0, 0, 0, 0).getTime();

    expect(getRangeBounds('today', nowMs)).toEqual({
      startMs: todayStartMs,
      endMs: nowMs,
    });
    expect(getRangeBounds('7d', nowMs)).toEqual({
      startMs: todayStartMs - 6 * 24 * 60 * 60 * 1000,
      endMs: nowMs,
    });
    expect(getRangeBounds('14d', nowMs)).toEqual({
      startMs: todayStartMs - 13 * 24 * 60 * 60 * 1000,
      endMs: nowMs,
    });
    expect(getRangeBounds('30d', nowMs)).toEqual({
      startMs: todayStartMs - 29 * 24 * 60 * 60 * 1000,
      endMs: nowMs,
    });
    expect(getRangeBounds('all', nowMs)).toEqual({
      startMs: Number.NEGATIVE_INFINITY,
      endMs: nowMs,
    });
  });
});
