import type { MonitoringEventRow } from './hooks/useMonitoringData';
import type { ModelPrice } from '@/utils/usage';

export const buildModelPriceCandidateModels = (
  facetModels: readonly string[],
  rows: readonly Pick<MonitoringEventRow, 'model'>[],
  modelPrices: Record<string, ModelPrice>
) =>
  Array.from(
    new Set([
      ...facetModels.map((model) => model.trim()),
      ...rows.map((row) => row.model.trim()),
      ...Object.keys(modelPrices).map((model) => model.trim()),
    ])
  )
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right));
