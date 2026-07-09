import { describe, expect, it } from 'vitest';
import { buildCodexResponsesEndpoint, parseProviderWeightInput } from './utils';

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

  it('parses optional provider weights as positive integers', () => {
    expect(parseProviderWeightInput(' 4 ')).toBe(4);
    expect(parseProviderWeightInput(2.9)).toBe(2);
    expect(parseProviderWeightInput('')).toBeUndefined();
    expect(parseProviderWeightInput('0')).toBeUndefined();
    expect(parseProviderWeightInput('-1')).toBeUndefined();
  });
});
