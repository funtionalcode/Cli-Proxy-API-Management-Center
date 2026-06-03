import { describe, expect, it } from 'vitest';
import type { AuthFileItem } from '@/types';
import {
  compareAuthFilePlan,
  getAuthFilePlanValue,
} from './constants';

const authFile = (overrides: Partial<AuthFileItem>): AuthFileItem => ({
  name: 'auth.json',
  ...overrides,
});

describe('auth file plan sorting', () => {
  it('prefers Codex id_token plan_type over oauth account_type', () => {
    const file = authFile({
      name: 'codex-pro.json',
      provider: 'codex',
      type: 'codex',
      account_type: 'oauth',
      id_token: {
        chatgpt_account_id: 'account-1',
        plan_type: 'pro',
      },
    });

    expect(getAuthFilePlanValue(file)).toBe('pro');
  });

  it('prefers new-api balance group over account_type', () => {
    const file = authFile({
      name: 'new-api.json',
      account_type: 'api_key',
      balance: {
        group: 'vip',
      },
    });

    expect(getAuthFilePlanValue(file)).toBe('vip');
  });

  it('sorts actual Codex plan values from high to low by default', () => {
    const files = [
      authFile({
        name: 'free.json',
        account_type: 'oauth',
        id_token: { plan_type: 'free' },
      }),
      authFile({
        name: 'plus.json',
        account_type: 'oauth',
        id_token: { plan_type: 'plus' },
      }),
      authFile({
        name: 'prolite.json',
        account_type: 'oauth',
        id_token: { plan_type: 'prolite' },
      }),
      authFile({
        name: 'pro.json',
        account_type: 'oauth',
        id_token: { plan_type: 'pro' },
      }),
    ];

    const sorted = [...files].sort((left, right) => {
      const planCompare = compareAuthFilePlan(left, right);
      if (planCompare !== 0) return planCompare;
      return left.name.localeCompare(right.name);
    });

    expect(sorted.map((file) => file.name)).toEqual([
      'pro.json',
      'prolite.json',
      'plus.json',
      'free.json',
    ]);
  });
});
