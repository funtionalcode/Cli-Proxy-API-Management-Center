import type { DashboardTrafficPoint } from '@/services/api/usageService';

const hasTraffic = (point: DashboardTrafficPoint) => point.calls > 0 || point.tokens > 0;

const findLastElapsedIndex = (timeline: DashboardTrafficPoint[], nowMs?: number | null) => {
  if (typeof nowMs !== 'number' || !Number.isFinite(nowMs)) {
    return timeline.length - 1;
  }

  for (let index = timeline.length - 1; index >= 0; index -= 1) {
    if (timeline[index].bucket_ms <= nowMs) {
      return index;
    }
  }

  return -1;
};

export const buildVisibleTrafficTimeline = (
  timeline: DashboardTrafficPoint[],
  nowMs?: number | null
) => {
  if (timeline.length === 0) {
    return [];
  }

  const lastElapsedIndex = findLastElapsedIndex(timeline, nowMs);
  const endIndex = Math.max(0, lastElapsedIndex);
  const firstDataIndex = timeline.findIndex((point, index) => index <= endIndex && hasTraffic(point));

  if (firstDataIndex < 0) {
    return timeline.slice(0, endIndex + 1);
  }

  return timeline.slice(firstDataIndex, endIndex + 1);
};

export const isCurrentTrafficBucket = (
  point: DashboardTrafficPoint,
  nowMs?: number | null,
  bucketMs = 60 * 60 * 1000
) =>
  typeof nowMs === 'number' &&
  Number.isFinite(nowMs) &&
  nowMs >= point.bucket_ms &&
  nowMs < point.bucket_ms + bucketMs;
