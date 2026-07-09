import { describe, expect, it } from 'vitest';
import {
  buildProxyConfigRows,
  filterProxyConfigRows,
  maskProxyURL,
  parseProxyURL,
} from './proxyConfigModel';

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

    expect(filterProxyConfigRows(rows, 'provider', 'gemini')).toHaveLength(1);
    expect(filterProxyConfigRows(rows, 'auth-file', 'gemini')).toHaveLength(0);
  });
});
