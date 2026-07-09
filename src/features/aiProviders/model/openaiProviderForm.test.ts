import { describe, expect, it } from 'vitest';
import {
  buildOpenAIBaseline,
  buildOpenAIProviderPayload,
  parseOpenAIWeightInput,
} from './openaiProviderForm';
import type { OpenAIFormState } from '@/components/providers/types';

const baseForm = (): OpenAIFormState => ({
  name: 'OpenRouter',
  weight: 2,
  priority: 7,
  prefix: 'team-a',
  baseUrl: 'https://openrouter.ai/api/v1',
  headers: [{ key: 'X-App', value: 'CPA' }],
  apiKeyEntries: [
    {
      apiKey: ' sk-a ',
      weight: 3,
      proxyUrl: ' http://proxy.local ',
      authIndex: ' auth-a ',
      headers: { 'X-Key': 'A' },
    },
  ],
  modelEntries: [{ name: 'openai/gpt-4.1', alias: 'gpt-4.1' }],
  testModel: 'openai/gpt-4.1',
  disableCooling: true,
});

describe('OpenAI provider form model', () => {
  it('builds provider payload with provider and per-key weights', () => {
    const payload = buildOpenAIProviderPayload(baseForm(), {
      disabled: false,
      testModel: 'openai/gpt-4.1',
    });

    expect(payload).toMatchObject({
      name: 'OpenRouter',
      weight: 2,
      priority: 7,
      prefix: 'team-a',
      baseUrl: 'https://openrouter.ai/api/v1',
      disabled: false,
      disableCooling: true,
      testModel: 'openai/gpt-4.1',
      apiKeyEntries: [
        {
          apiKey: 'sk-a',
          weight: 3,
          proxyUrl: 'http://proxy.local',
          authIndex: 'auth-a',
          headers: { 'X-Key': 'A' },
        },
      ],
    });
  });

  it('keeps weights in the dirty-check baseline', () => {
    const baseline = buildOpenAIBaseline(baseForm(), 'openai/gpt-4.1');

    expect(baseline.weight).toBe(2);
    expect(baseline.apiKeyEntries[0]?.weight).toBe(3);
  });

  it('parses only positive weight values from inputs', () => {
    expect(parseOpenAIWeightInput(' 4 ')).toBe(4);
    expect(parseOpenAIWeightInput('')).toBeUndefined();
    expect(parseOpenAIWeightInput('0')).toBeUndefined();
    expect(parseOpenAIWeightInput('-1')).toBeUndefined();
  });
});
