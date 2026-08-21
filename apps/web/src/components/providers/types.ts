import type { ApiKeyEntry, CoolingPolicy, GeminiKeyConfig, ProviderKeyConfig } from '@/types';
import type { CredentialWeightInputValue } from '@/utils/credentialWeight';
import type { HeaderEntry } from '@/utils/headers';

export interface ModelEntry {
  name: string;
  alias: string;
  priority?: number;
  testModel?: string;
  image?: boolean;
  forceMapping?: boolean;
  inputModalities?: string[];
  outputModalities?: string[];
  thinking?: Record<string, unknown>;
}

export interface OpenAIFormState {
  name: string;
  priority?: number;
  prefix: string;
  baseUrl: string;
  headers: HeaderEntry[];
  testModel?: string;
  modelEntries: ModelEntry[];
  apiKeyEntries: OpenAIFormApiKeyEntry[];
  disableCooling: CoolingPolicy;
}

export type OpenAIFormApiKeyEntry = Omit<ApiKeyEntry, 'weight'> & {
  weight?: CredentialWeightInputValue;
};

export type GeminiFormState = Omit<GeminiKeyConfig, 'headers' | 'models' | 'weight' | 'disableCooling'> & {
  disableCooling: CoolingPolicy;
  weight?: CredentialWeightInputValue;
  headers: HeaderEntry[];
  modelEntries: ModelEntry[];
  excludedText: string;
};

export type ProviderFormState = Omit<ProviderKeyConfig, 'headers' | 'weight' | 'disableCooling'> & {
  disableCooling: CoolingPolicy;
  weight?: CredentialWeightInputValue;
  headers: HeaderEntry[];
  modelEntries: ModelEntry[];
  excludedText: string;
};

export type VertexFormState = Omit<ProviderKeyConfig, 'headers' | 'weight' | 'disableCooling'> & {
  disableCooling: CoolingPolicy;
  weight?: CredentialWeightInputValue;
  headers: HeaderEntry[];
  modelEntries: ModelEntry[];
  excludedText: string;
};
