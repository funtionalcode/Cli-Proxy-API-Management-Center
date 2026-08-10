export interface WindowUsageForecastMetrics {
  requests: number;
  tokens: number;
  cost: number;
}

export interface WindowUsageForecast extends WindowUsageForecastMetrics {
  basis: 'quota' | 'previous';
}

const isUsableMetrics = (
  metrics: WindowUsageForecastMetrics | null | undefined
): metrics is WindowUsageForecastMetrics =>
  metrics !== null &&
  metrics !== undefined &&
  Number.isFinite(metrics.requests) &&
  metrics.requests >= 0 &&
  Number.isFinite(metrics.tokens) &&
  metrics.tokens >= 0 &&
  Number.isFinite(metrics.cost) &&
  metrics.cost >= 0;

const hasUsage = (metrics: WindowUsageForecastMetrics): boolean =>
  metrics.requests > 0 || metrics.tokens > 0 || metrics.cost > 0;

const roundForecastCost = (value: number): number => {
  const scaled = value * 100;
  return Number.isFinite(scaled) ? Math.round(scaled) / 100 : value;
};

export const estimateWindowUsage = (input: {
  usedPercent: number | null;
  current: WindowUsageForecastMetrics | null;
  previous?: WindowUsageForecastMetrics | null;
}): WindowUsageForecast | null => {
  const hasCurrentUsage = isUsableMetrics(input.current) && hasUsage(input.current);
  const hasQuotaProgress =
    input.usedPercent !== null &&
    Number.isFinite(input.usedPercent) &&
    input.usedPercent > 0 &&
    input.usedPercent <= 100;
  if (hasCurrentUsage && hasQuotaProgress && input.current && input.usedPercent !== null) {
    const multiplier = 100 / input.usedPercent;
    const forecast = {
      requests: Math.max(input.current.requests, Math.round(input.current.requests * multiplier)),
      tokens: Math.max(input.current.tokens, Math.round(input.current.tokens * multiplier)),
      cost: Math.max(input.current.cost, roundForecastCost(input.current.cost * multiplier)),
      basis: 'quota',
    } satisfies WindowUsageForecast;
    if (
      Number.isFinite(multiplier) &&
      Number.isFinite(forecast.requests) &&
      Number.isFinite(forecast.tokens) &&
      Number.isFinite(forecast.cost)
    ) {
      return forecast;
    }
  }
  if (isUsableMetrics(input.previous)) {
    return { ...input.previous, basis: 'previous' };
  }
  return null;
};
