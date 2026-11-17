import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { CodexCreditsSummary } from './CodexCreditsSummary';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en-US' } }),
}));

describe('CodexCreditsSummary', () => {
  it('仅显示向下取整的余额，悬浮时不展示原始小数', () => {
    const html = renderToStaticMarkup(
      <CodexCreditsSummary
        credits={{ creditsHasCredits: true, creditsBalance: '59897.4803850000' }}
        inUse
      />
    );
    expect(html).toContain('59,897');
    expect(html).not.toContain('59897.4803850000');
    expect(html).toContain('codex_quota.credits_in_use_hint');
    expect(html).not.toContain('$');
  });

  it('显示不足一积分而不是零', () => {
    const html = renderToStaticMarkup(
      <CodexCreditsSummary credits={{ creditsHasCredits: true, creditsBalance: '0.4' }} />
    );
    expect(html).toContain('&lt;1');
    expect(html).not.toContain('0.4');
    expect(html).not.toContain('data-codex-credits-in-use');
  });

  it('区分无限积分和不可用积分', () => {
    expect(
      renderToStaticMarkup(
        <CodexCreditsSummary credits={{ creditsHasCredits: true, creditsUnlimited: true }} />
      )
    ).toContain('codex_quota.credits_unlimited');
    expect(
      renderToStaticMarkup(
        <CodexCreditsSummary credits={{ creditsHasCredits: false, creditsBalance: '42' }} />
      )
    ).toBe('');
    expect(renderToStaticMarkup(<CodexCreditsSummary credits={undefined} />)).toBe('');
  });
});
