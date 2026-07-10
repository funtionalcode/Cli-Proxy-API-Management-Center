import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PROXY_CONFIG_ENABLED_FILTER,
  buildProxyConfigRows,
  filterProxyConfigRows,
  maskProxyURL,
  parseProxyURL,
} from './proxyConfigModel';

const buildEnabledStateRows = () =>
  buildProxyConfigRows({
    config: { proxyUrl: '' },
    providers: {
      gemini: [{ apiKey: 'gemini-key', proxyUrl: '' }],
      codex: [],
      claude: [],
      vertex: [],
      openai: [
        {
          name: 'disabled-openai',
          baseUrl: 'https://disabled.example.com/v1',
          disabled: true,
          apiKeyEntries: [{ apiKey: 'disabled-key-1' }, { apiKey: 'disabled-key-2' }],
        },
        {
          name: 'enabled-openai',
          baseUrl: 'https://enabled.example.com/v1',
          disabled: false,
          apiKeyEntries: [{ apiKey: 'enabled-key' }],
        },
      ],
    },
    authFiles: [
      { name: 'disabled.json', type: 'codex', disabled: true },
      { name: 'enabled.json', type: 'codex' },
    ],
  });

describe('proxyConfigModel', () => {
  it('parses authenticated proxy urls without exposing the password', () => {
    const parsed = parseProxyURL('http://alice:p%40ss@proxy.local:7890');

    expect(parsed.valid).toBe(true);
    expect(parsed.scheme).toBe('http');
    expect(parsed.host).toBe('proxy.local');
    expect(parsed.port).toBe('7890');
    expect(parsed.username).toBe('alice');
    expect(parsed.passwordMasked).toBe('••••••');
    expect(maskProxyURL('http://alice:p%40ss@proxy.local:7890')).toContain('alice');
    expect(maskProxyURL('http://alice:p%40ss@proxy.local:7890')).not.toContain('p%40ss');
  });

  it('treats direct values as explicit direct connections', () => {
    const parsed = parseProxyURL('direct');

    expect(parsed.valid).toBe(true);
    expect(parsed.direct).toBe(true);
    expect(parsed.scheme).toBe('direct');
  });

  it('builds rows for global proxy, provider entries, openai entries, and auth files', () => {
    const rows = buildProxyConfigRows({
      config: { proxyUrl: 'http://global:8080' },
      providers: {
        gemini: [{ apiKey: 'gemini-key', proxyUrl: 'socks5://gemini:1080' }],
        codex: [],
        claude: [],
        vertex: [],
        openai: [
          {
            name: 'xai',
            baseUrl: 'https://api.x.ai/v1',
            apiKeyEntries: [{ apiKey: 'xai-key', proxyUrl: 'http://u:p@xai-proxy:8080' }],
          },
        ],
      },
      authFiles: [
        {
          name: 'codex.json',
          type: 'codex',
          authIndex: 1,
          proxy_url: 'direct',
        },
      ],
    });

    expect(rows).toHaveLength(4);
    expect(rows.map((row) => row.scope)).toEqual([
      'global',
      'provider',
      'provider',
      'auth-file',
    ]);
    expect(rows[1].status).toBe('override');
    expect(rows[2].parsed.username).toBe('u');
    expect(rows[3].status).toBe('direct');
  });

  it('maps provider and auth-file disabled state onto rows', () => {
    const rows = buildEnabledStateRows();

    expect(DEFAULT_PROXY_CONFIG_ENABLED_FILTER).toBe('enabled');
    expect(rows.find((row) => row.id === 'global')?.enabledState).toBe('enabled');
    expect(rows.find((row) => row.id === 'provider:gemini:0')?.enabledState).toBe('enabled');
    expect(
      rows
        .filter((row) => row.provider === 'disabled-openai')
        .every((row) => row.enabledState === 'disabled')
    ).toBe(true);
    expect(rows.find((row) => row.provider === 'enabled-openai')?.enabledState).toBe('enabled');
    expect(rows.find((row) => row.name === 'disabled.json')?.enabledState).toBe('disabled');
    expect(rows.find((row) => row.name === 'enabled.json')?.enabledState).toBe('enabled');
  });

  it('filters enabled state together with scope and free text', () => {
    const rows = buildEnabledStateRows();

    const enabledRows = filterProxyConfigRows(rows, 'all', 'enabled', '');
    const disabledRows = filterProxyConfigRows(rows, 'all', 'disabled', '');

    expect(enabledRows).toHaveLength(4);
    expect(enabledRows.every((row) => row.enabledState === 'enabled')).toBe(true);
    expect(disabledRows).toHaveLength(3);
    expect(disabledRows.every((row) => row.enabledState === 'disabled')).toBe(true);
    expect(filterProxyConfigRows(rows, 'all', 'all', '')).toHaveLength(rows.length);
    expect(filterProxyConfigRows(rows, 'auth-file', 'disabled', 'disabled.json')).toHaveLength(1);
    expect(filterProxyConfigRows(rows, 'provider', 'disabled', 'disabled-openai')).toHaveLength(2);
    expect(filterProxyConfigRows(rows, 'auth-file', 'enabled', 'disabled.json')).toHaveLength(0);
  });

  it('filters rows by scope and free text', () => {
    const rows = buildProxyConfigRows({
      config: { proxyUrl: '' },
      providers: {
        gemini: [{ apiKey: 'gemini-key', proxyUrl: '' }],
        codex: [],
        claude: [],
        vertex: [],
        openai: [],
      },
      authFiles: [],
    });

    expect(filterProxyConfigRows(rows, 'provider', 'all', 'gemini')).toHaveLength(1);
    expect(filterProxyConfigRows(rows, 'auth-file', 'all', 'gemini')).toHaveLength(0);
  });
});
