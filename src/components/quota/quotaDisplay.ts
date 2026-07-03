import type { QuotaAccountDisplayMode } from '@/features/quota/quotaPageUiState';
import type { AuthFileItem } from '@/types';
import { maskSensitiveText } from '@/utils/format';

const EMAIL_TOKEN_REGEX = /[^\s/\\()[\]{}<>:;"',]+@[^\s/\\()[\]{}<>:;"',]+/g;

const maskEmailLike = (value: string) => {
  const trimmed = value.trim();
  const match = trimmed.match(/^([^@\s]{1,3})[^@\s]*@(.+)$/);
  if (!match) return trimmed;
  return `${match[1]}***@${match[2]}`;
};

const splitFileExtension = (value: string) => {
  const slashIndex = Math.max(value.lastIndexOf('/'), value.lastIndexOf('\\'));
  const dotIndex = value.lastIndexOf('.');

  if (dotIndex <= slashIndex + 1 || dotIndex >= value.length - 1) {
    return { base: value, suffix: '' };
  }

  return {
    base: value.slice(0, dotIndex),
    suffix: value.slice(dotIndex),
  };
};

export const maskQuotaAccountText = (value: string) => {
  const trimmed = String(value || '').trim();
  if (!trimmed || trimmed === '-') return trimmed;

  const maskedSensitiveText = maskSensitiveText(trimmed);
  const maskedEmailText = maskedSensitiveText.replace(EMAIL_TOKEN_REGEX, (match) =>
    maskEmailLike(match)
  );

  if (maskedEmailText !== trimmed) {
    return maskedEmailText;
  }

  const { base, suffix } = splitFileExtension(maskedEmailText);
  if (base.length <= 8) {
    return maskedEmailText;
  }

  return `${base.slice(0, 3)}***${base.slice(-4)}${suffix}`;
};

export const resolveQuotaAccountDisplayText = (
  item: Pick<AuthFileItem, 'name'>,
  displayMode: QuotaAccountDisplayMode
) => {
  const full = String(item.name || '').trim();
  const primary = displayMode === 'full' ? full : maskQuotaAccountText(full);

  return {
    primary: primary || full || '-',
    full: full || '-',
    title: displayMode === 'full' ? full || primary || '-' : primary || '-',
  };
};
