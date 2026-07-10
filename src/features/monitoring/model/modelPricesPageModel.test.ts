import { describe, expect, it } from 'vitest';
import {
  applyCandidatePrice,
  buildPriceFromDraft,
  buildModelPriceRows,
  buildModelPriceRowsFromModelStats,
  buildModelPriceSummary,
  buildSyncPriceModelsFromModelStats,
  buildSyncPriceModelsFromSummary,
  buildSyncPriceModelsFromUsage,
  filterModelPriceRows,
  shouldFallbackToModelPriceModelStats,
} from './modelPricesPageModel';

const usage = {
  apis: {
    'POST /v1/chat/completions': {
      models: {
        'alias-fast': {
          details: [
            {
              timestamp: '2026-05-22T00:00:00Z',
              source: 'source',
              resolved_model: 'gpt-5.5',
              tokens: {},
            },
          ],
        },
      },
    },
  },
};

const usageSummary = {
  sampled_events: 1,
  total_events: 1,
  truncated: false,
  models: [
    {
      model: 'alias-fast',
      calls: 1,
      requested_calls: 1,
      resolved_calls: 0,
    },
    {
      model: 'gpt-5.5',
      calls: 1,
      requested_calls: 0,
      resolved_calls: 1,
    },
  ],
};

describe('modelPricesPageModel', () => {
  it.each([{ status: 404 }, { status: 405 }, { code: 'method_not_allowed' }])(
    'falls back to model stats when the summary endpoint is unsupported: %j',
    (error) => {
      expect(shouldFallbackToModelPriceModelStats(error)).toBe(true);
    }
  );

  it.each([{ status: 401 }, { status: 500 }, new Error('network failed')])(
    'does not fall back to model stats for unrelated errors: %j',
    (error) => {
      expect(shouldFallbackToModelPriceModelStats(error)).toBe(false);
    }
  );

  it('builds sync models from requested, resolved, and saved prices', () => {
    expect(
      buildSyncPriceModelsFromUsage(usage, {
        'manual-model': { prompt: 1, completion: 2, cache: 0.5 },
      })
    ).toEqual(['alias-fast', 'gpt-5.5', 'manual-model']);
  });

  it('builds sync models from the lightweight usage summary', () => {
    expect(
      buildSyncPriceModelsFromSummary(usageSummary, {
        'manual-model': { prompt: 1, completion: 2, cache: 0.5 },
      })
    ).toEqual(['alias-fast', 'gpt-5.5', 'manual-model']);
  });

  it('keeps saved prices usable when the usage summary endpoint is unavailable', () => {
    const prices = {
      'manual-model': { prompt: 1, completion: 2, cache: 0.5 },
    };

    expect(buildSyncPriceModelsFromSummary(null, prices)).toEqual(['manual-model']);
    expect(buildModelPriceRows(null, prices)).toEqual([
      expect.objectContaining({
        model: 'manual-model',
        calls: 0,
        hasPrice: true,
      }),
    ]);
  });

  it('builds sync models from lightweight analytics model stats', () => {
    expect(
      buildSyncPriceModelsFromModelStats(
        [
          { model: 'gpt-5.5', calls: 12 },
          { model: 'glm-5.2', calls: 3 },
        ],
        {
          'manual-model': { prompt: 1, completion: 2, cache: 0.5 },
        }
      )
    ).toEqual(['glm-5.2', 'gpt-5.5', 'manual-model']);
  });

  it('marks missing models with candidates before saved rows', () => {
    const rows = buildModelPriceRows(
      usage,
      {
        'gpt-5.5': { prompt: 1, completion: 2, cache: 0.5 },
      },
      [
        {
          model: 'alias-fast',
          candidates: [
            {
              sourceModelId: 'openai/gpt-5.5',
              score: 0.75,
              reason: 'similar',
              price: { prompt: 1, completion: 2, cache: 0.5 },
            },
          ],
        },
      ]
    );

    expect(rows[0]).toMatchObject({
      model: 'alias-fast',
      hasPrice: false,
      candidateCount: 1,
      requestedCalls: 1,
    });
    expect(buildModelPriceSummary(rows)).toMatchObject({
      total: 2,
      saved: 1,
      missing: 1,
      candidates: 1,
    });
    expect(filterModelPriceRows(rows, 'candidates', '')).toHaveLength(1);
  });

  it('marks missing summary models with candidates before saved rows', () => {
    const rows = buildModelPriceRows(
      usageSummary,
      {
        'gpt-5.5': { prompt: 1, completion: 2, cache: 0.5 },
      },
      [
        {
          model: 'alias-fast',
          candidates: [
            {
              sourceModelId: 'openai/gpt-5.5',
              score: 0.75,
              reason: 'similar',
              price: { prompt: 1, completion: 2, cache: 0.5 },
            },
          ],
        },
      ]
    );

    expect(rows[0]).toMatchObject({
      model: 'alias-fast',
      hasPrice: false,
      candidateCount: 1,
      requestedCalls: 1,
    });
    expect(rows[1]).toMatchObject({
      model: 'gpt-5.5',
      calls: 1,
      requestedCalls: 0,
      resolvedCalls: 1,
    });
    expect(buildModelPriceSummary(rows)).toMatchObject({
      total: 2,
      saved: 1,
      missing: 1,
      candidates: 1,
    });
    expect(filterModelPriceRows(rows, 'candidates', '')).toHaveLength(1);
  });

  it('uses analytics model stats for price rows without expanding usage details', () => {
    const rows = buildModelPriceRowsFromModelStats(
      [
        { model: 'gpt-5.5', calls: 1877 },
        { model: 'glm-5.2', calls: 4 },
      ],
      {
        'gpt-5.5': { prompt: 5, completion: 30, cache: 0.5 },
      },
      [
        {
          model: 'glm-5.2',
          candidates: [
            {
              sourceModelId: 'openrouter/glm-5.2',
              score: 0.9,
              reason: 'exact',
              price: { prompt: 1.4, completion: 4.4, cache: 0.26 },
            },
          ],
        },
      ]
    );

    expect(rows[0]).toMatchObject({
      model: 'glm-5.2',
      calls: 4,
      requestedCalls: 4,
      candidateCount: 1,
      hasPrice: false,
    });
    expect(rows[1]).toMatchObject({
      model: 'gpt-5.5',
      calls: 1877,
      requestedCalls: 1877,
      hasPrice: true,
    });
  });

  it('applies a candidate under the local model name', () => {
    const next = applyCandidatePrice({}, 'alias-fast', {
      sourceModelId: 'openai/gpt-5.5',
      score: 0.75,
      reason: 'similar',
      price: { prompt: 1, completion: 2, cache: 0.5, source: 'openrouter' },
    });

    expect(next['alias-fast']).toMatchObject({
      prompt: 1,
      completion: 2,
      cache: 0.5,
      source: 'openrouter',
      sourceModelId: 'openai/gpt-5.5',
    });
  });

  it('marks manually entered prices with a manual source', () => {
    expect(
      buildPriceFromDraft({
        model: 'manual-model',
        prompt: '1',
        completion: '2',
        cache: '',
      })
    ).toMatchObject({
      prompt: 1,
      completion: 2,
      cache: 1,
      source: 'manual',
    });
  });
});
