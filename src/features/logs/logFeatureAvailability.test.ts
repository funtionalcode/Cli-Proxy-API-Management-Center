import { describe, expect, it } from 'vitest';
import {
  isRequestLogsTab,
  isFileLogsAvailable,
  isLogsRouteAvailable,
} from './logFeatureAvailability';

describe('isFileLogsAvailable', () => {
  it('only enables log viewer when file logging is explicitly true', () => {
    expect(isFileLogsAvailable({ loggingToFile: true })).toBe(true);
    expect(isFileLogsAvailable({ loggingToFile: false })).toBe(false);
    expect(isFileLogsAvailable({})).toBe(false);
    expect(isFileLogsAvailable(null)).toBe(false);
  });
});

describe('isRequestLogsTab', () => {
  it('detects dedicated request log tabs from search params', () => {
    expect(isRequestLogsTab('?tab=errors')).toBe(true);
    expect(isRequestLogsTab('?tab=success')).toBe(true);
    expect(isRequestLogsTab(new URLSearchParams('tab=errors'))).toBe(true);
    expect(isRequestLogsTab(new URLSearchParams('tab=success'))).toBe(true);
    expect(isRequestLogsTab('?tab=logs')).toBe(false);
    expect(isRequestLogsTab('')).toBe(false);
    expect(isRequestLogsTab(null)).toBe(false);
  });
});

describe('isLogsRouteAvailable', () => {
  it('keeps regular file logs behind the logging-to-file switch', () => {
    expect(isLogsRouteAvailable({ loggingToFile: true }, '')).toBe(true);
    expect(isLogsRouteAvailable({ loggingToFile: false }, '')).toBe(false);
    expect(isLogsRouteAvailable(null, '')).toBe(false);
  });

  it('allows request log tabs without file logging enabled', () => {
    expect(isLogsRouteAvailable({ loggingToFile: false }, '?tab=errors')).toBe(true);
    expect(isLogsRouteAvailable({ loggingToFile: false }, '?tab=success')).toBe(true);
    expect(isLogsRouteAvailable({}, '?tab=errors')).toBe(true);
    expect(isLogsRouteAvailable({}, '?tab=success')).toBe(true);
    expect(isLogsRouteAvailable(null, '?tab=errors')).toBe(true);
    expect(isLogsRouteAvailable(null, '?tab=success')).toBe(true);
  });
});
