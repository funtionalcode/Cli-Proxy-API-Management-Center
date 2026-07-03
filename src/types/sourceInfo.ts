export type SourceProviderEnabledState = 'enabled' | 'disabled' | 'mixed';

export type SourceInfo = {
  displayName: string;
  type: string;
  identityKey?: string;
  providerEnabledState?: SourceProviderEnabledState;
};

export type CredentialInfo = {
  name: string;
  type: string;
};
