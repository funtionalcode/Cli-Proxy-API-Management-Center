import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import {
  handleDemoApiRequest,
  handleDemoRawRequest,
  resetDemoConfigState,
} from './demoApi';

const weightedConfigYaml = [
  'debug: true',
  'request-log: true',
  'logging-to-file: true',
  'routing:',
  '  strategy: weighted-round-robin',
  'plugins:',
  '  enabled: true',
].join('\n');

describe('demo configuration API', () => {
  beforeEach(() => {
    resetDemoConfigState();
  });

  afterEach(() => {
    resetDemoConfigState();
  });

  it('persists config.yaml updates across YAML, raw config, and routing reads', async () => {
    await handleDemoApiRequest('put', '/config.yaml', weightedConfigYaml);

    const configYaml = await handleDemoApiRequest<string>('get', '/config.yaml');
    const rawResponse = await handleDemoRawRequest('/config.yaml');
    const rawConfig = await handleDemoApiRequest<Record<string, unknown>>('get', '/config');
    const routing = await handleDemoApiRequest<{ strategy: string }>(
      'get',
      '/routing/strategy'
    );

    expect(configYaml).toBe(weightedConfigYaml);
    expect(rawResponse.data).toBe(weightedConfigYaml);
    expect(rawConfig).toMatchObject({
      debug: true,
      routing: { strategy: 'weighted-round-robin' },
    });
    expect(rawConfig['codex-api-key']).toEqual(expect.any(Array));
    expect(routing).toEqual({ strategy: 'weighted-round-robin' });
  });

  it('keeps direct routing strategy updates consistent with config.yaml and raw config', async () => {
    await handleDemoApiRequest('put', '/routing/strategy', { value: 'fill-first' });

    const configYaml = await handleDemoApiRequest<string>('get', '/config.yaml');
    const parsed = parseYaml(configYaml) as { routing?: { strategy?: string } };
    const rawConfig = await handleDemoApiRequest<Record<string, unknown>>('get', '/config');
    const routing = await handleDemoApiRequest<{ strategy: string }>(
      'get',
      '/routing/strategy'
    );

    expect(parsed.routing?.strategy).toBe('fill-first');
    expect(rawConfig).toMatchObject({ routing: { strategy: 'fill-first' } });
    expect(routing).toEqual({ strategy: 'fill-first' });
  });

  it('resets session configuration back to the fixture baseline', async () => {
    await handleDemoApiRequest('put', '/config.yaml', weightedConfigYaml);
    resetDemoConfigState();

    const configYaml = await handleDemoApiRequest<string>('get', '/config.yaml');
    const parsed = parseYaml(configYaml) as { routing?: { strategy?: string } };
    const routing = await handleDemoApiRequest<{ strategy: string }>(
      'get',
      '/routing/strategy'
    );

    expect(parsed.routing?.strategy).toBe('round-robin');
    expect(routing).toEqual({ strategy: 'round-robin' });
  });
});
