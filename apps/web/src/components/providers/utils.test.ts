import { describe, expect, it } from 'vitest';
import { buildApiKeyEntry, buildCodexResponsesEndpoint } from './utils';

describe('provider utils', () => {
  it('builds Codex responses endpoints from common base URL forms', () => {
    expect(buildCodexResponsesEndpoint('https://api.example.test')).toBe(
      'https://api.example.test/v1/responses'
    );
    expect(buildCodexResponsesEndpoint('https://api.example.test/v1')).toBe(
      'https://api.example.test/v1/responses'
    );
    expect(buildCodexResponsesEndpoint('https://api.example.test/v1/models')).toBe(
      'https://api.example.test/v1/responses'
    );
    expect(buildCodexResponsesEndpoint('https://api.example.test/v1/responses')).toBe(
      'https://api.example.test/v1/responses'
    );
  });

  it('preserves an explicit zero weight when building an OpenAI key entry', () => {
    expect(buildApiKeyEntry({ apiKey: 'key', weight: 0 })).toMatchObject({
      apiKey: 'key',
      weight: 0,
    });
    expect(buildApiKeyEntry()).toHaveProperty('weight', undefined);
  });
});
