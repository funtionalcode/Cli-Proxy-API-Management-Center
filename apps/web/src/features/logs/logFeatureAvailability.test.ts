import { describe, expect, it } from 'vitest';
import {
  isErrorLogsTab,
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

describe('isErrorLogsTab', () => {
  it('detects the dedicated error logs tab from search params', () => {
    expect(isErrorLogsTab('?tab=errors')).toBe(true);
    expect(isErrorLogsTab(new URLSearchParams('tab=errors'))).toBe(true);
    expect(isErrorLogsTab('?tab=logs')).toBe(false);
    expect(isErrorLogsTab('')).toBe(false);
    expect(isErrorLogsTab(null)).toBe(false);
  });
});

describe('isLogsRouteAvailable', () => {
  it('keeps regular file logs behind the logging-to-file switch', () => {
    expect(isLogsRouteAvailable({ loggingToFile: true }, '')).toBe(true);
    expect(isLogsRouteAvailable({ loggingToFile: false }, '')).toBe(false);
    expect(isLogsRouteAvailable(null, '')).toBe(false);
  });

  it('allows the error request logs tab without file logging enabled', () => {
    expect(isLogsRouteAvailable({ loggingToFile: false }, '?tab=errors')).toBe(true);
    expect(isLogsRouteAvailable({}, '?tab=errors')).toBe(true);
    expect(isLogsRouteAvailable(null, '?tab=errors')).toBe(true);
  });
});
