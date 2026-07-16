import type { TFunction } from 'i18next';
import { describe, expect, it } from 'vitest';
import en from '@/i18n/locales/en.json';
import ru from '@/i18n/locales/ru.json';
import zhCN from '@/i18n/locales/zh-CN.json';
import zhTW from '@/i18n/locales/zh-TW.json';
import {
  formatXaiBillingDiagnostics,
  getXaiProbeIssueKey,
  XAI_PROBE_ISSUE_CLASSIFICATIONS,
} from './xaiPresentation';

const locales = { en, ru, zhCN, zhTW };

const getPath = (value: unknown, path: string): unknown =>
  path.split('.').reduce<unknown>((current, segment) => {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return undefined;
    return (current as Record<string, unknown>)[segment];
  }, value);

const placeholders = (value: string) =>
  [...value.matchAll(/{{\s*([^}\s]+)\s*}}/g)].map((match) => match[1]).sort();

describe('xAI presentation', () => {
  it('keeps every supported issue classification translated in every locale', () => {
    const issueKeys = XAI_PROBE_ISSUE_CLASSIFICATIONS.map((classification) => {
      const key = getXaiProbeIssueKey(classification);
      expect(key, classification).toBeTypeOf('string');
      return key as string;
    });
    const templateKeys = [
      'auth_files.provider_inspection_badge_error_title',
      'monitoring.xai_inspection_log_result',
      'monitoring.xai_inspection_log_classified',
      'monitoring.xai_inspection_log_request_error',
    ];

    for (const key of [...issueKeys, ...templateKeys]) {
      const baseline = getPath(en, key);
      expect(baseline, `en:${key}`).toBeTypeOf('string');
      for (const [localeName, locale] of Object.entries(locales)) {
        const translated = getPath(locale, key);
        expect(translated, `${localeName}:${key}`).toBeTypeOf('string');
        expect(placeholders(String(translated)), `${localeName}:${key}`).toEqual(
          placeholders(String(baseline))
        );
      }
    }
  });

  it('uses a friendly fallback without dropping unknown partial diagnostics', () => {
    const messages: Record<string, string> = {
      'xai_quota.diagnostic_protocol_changed': 'Billing data format is not recognized',
      'xai_quota.diagnostic_unknown': 'The cause could not be determined',
      'xai_quota.partial_unknown': 'No diagnostic details are available',
    };
    const t = ((key: string) => messages[key] ?? key) as TFunction;

    expect(
      formatXaiBillingDiagnostics(
        [
          { classification: 'protocol_changed', statusCode: 200, message: 'schema changed' },
          { classification: 'future_xai_failure', statusCode: 503, message: 'future failure' },
        ],
        t
      )
    ).toBe('Billing data format is not recognized · The cause could not be determined');
  });

  it('directs client-version failures to upgrading CPA Manager Plus', () => {
    for (const [localeName, locale] of Object.entries(locales)) {
      expect(String(getPath(locale, 'xai_quota.diagnostic_client_outdated')), localeName).toContain(
        'CPA Manager Plus'
      );
      expect(
        String(getPath(locale, 'monitoring.xai_inspection_reason_client_outdated')),
        localeName
      ).toContain('CPA Manager Plus');
    }
  });
});
