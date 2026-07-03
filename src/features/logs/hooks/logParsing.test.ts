import { describe, expect, it } from 'vitest';
import { parseDurationToMs, parseLogLine } from './logParsing';

describe('parseDurationToMs', () => {
  it('converts mixed duration units to milliseconds', () => {
    expect(parseDurationToMs('350ms')).toBe(350);
    expect(parseDurationToMs('1.2s')).toBe(1200);
    expect(parseDurationToMs('1s 250ms')).toBe(1250);
    expect(parseDurationToMs('500us')).toBe(0.5);
  });
});

describe('parseLogLine timings', () => {
  it('extracts english and chinese timing labels', () => {
    const parsed = parseLogLine(
      '[GIN] | 200 | latency=1.2s | 排队: 10ms | 127.0.0.1 | POST /v1/chat'
    );

    expect(parsed.latency).toBe('1.2s');
    expect(parsed.timings).toEqual(
      expect.arrayContaining([
        { label: 'latency', value: '1.2s', milliseconds: 1200 },
        { label: '排队', value: '10ms', milliseconds: 10 },
      ])
    );
  });
});
