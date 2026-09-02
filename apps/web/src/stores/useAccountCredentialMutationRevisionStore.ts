import { create } from 'zustand';

export type AccountCredentialMutationKind = 'credential' | 'oauth' | 'quota' | 'reauth';

export interface AccountCredentialMutationRevision {
  connectionFingerprint: string;
  provider: string;
  kind: AccountCredentialMutationKind;
  revision: number;
  changedAtMs: number;
  credentialIdentity?: string;
}

interface AccountCredentialMutationRevisionState {
  events: Record<string, AccountCredentialMutationRevision>;
  publish: (event: Omit<AccountCredentialMutationRevision, 'revision' | 'changedAtMs'>) => void;
  clearForTests: () => void;
}

const normalizeProvider = (value: string): string => {
  const provider = value.trim().toLowerCase().replace(/_/g, '-');
  if (provider === 'x-ai' || provider === 'grok') return 'xai';
  if (provider === 'anthropic') return 'claude';
  return provider;
};

export const buildAccountCredentialMutationRevisionKey = (
  connectionFingerprint: string,
  provider: string
): string => `${connectionFingerprint.trim()}\u0000${normalizeProvider(provider)}`;

export const useAccountCredentialMutationRevisionStore =
  create<AccountCredentialMutationRevisionState>((set) => ({
    events: {},
    publish: (event) => {
      const connectionFingerprint = event.connectionFingerprint.trim();
      const provider = normalizeProvider(event.provider);
      if (!connectionFingerprint || !provider) return;
      const key = buildAccountCredentialMutationRevisionKey(connectionFingerprint, provider);
      set((state) => ({
        events: {
          ...state.events,
          [key]: {
            connectionFingerprint,
            provider,
            kind: event.kind,
            credentialIdentity: event.credentialIdentity?.trim() || undefined,
            revision: (state.events[key]?.revision ?? 0) + 1,
            changedAtMs: Date.now(),
          },
        },
      }));
    },
    clearForTests: () => set({ events: {} }),
  }));

export const publishAccountCredentialMutationRevision = (
  event: Omit<AccountCredentialMutationRevision, 'revision' | 'changedAtMs'>
): void => useAccountCredentialMutationRevisionStore.getState().publish(event);
