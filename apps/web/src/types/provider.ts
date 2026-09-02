/**
 * AI 提供商相关类型
 * 基于原项目 src/modules/ai-providers.js
 */

export interface ModelAlias {
  name: string;
  alias?: string;
  priority?: number;
  testModel?: string;
  image?: boolean;
  forceMapping?: boolean;
  inputModalities?: string[];
  outputModalities?: string[];
  thinking?: Record<string, unknown>;
}

export interface ApiKeyEntry {
  apiKey: string;
  weight?: number;
  proxyUrl?: string;
  headers?: Record<string, string>;
  authIndex?: string;
}

export interface CloakConfig {
  mode?: string;
  strictMode?: boolean;
  sensitiveWords?: string[];
  cacheUserId?: boolean;
}

/**
 * Claude request fingerprint profile. `''` keeps the caller-owned
 * fingerprint; `'claude-code-cli'` opts in to the Claude Code CLI
 * request fingerprint. `oauth-cli` is accepted upstream as a legacy
 * alias and is normalized to `'claude-code-cli'` on read.
 */
export type ClaudeFingerprintProfile = '' | 'claude-code-cli';

export interface GeminiKeyConfig {
  apiKey: string;
  priority?: number;
  weight?: number;
  prefix?: string;
  baseUrl?: string;
  proxyUrl?: string;
  models?: ModelAlias[];
  headers?: Record<string, string>;
  excludedModels?: string[];
  authIndex?: string;
  disableCooling?: boolean | null;
}

export interface ProviderKeyConfig {
  apiKey: string;
  priority?: number;
  weight?: number;
  prefix?: string;
  baseUrl?: string;
  websockets?: boolean;
  proxyUrl?: string;
  headers?: Record<string, string>;
  models?: ModelAlias[];
  excludedModels?: string[];
  cloak?: CloakConfig;
  authIndex?: string;
  disableCooling?: boolean | null;
  fingerprintProfile?: ClaudeFingerprintProfile;
  /**
   * @deprecated CPA compatibility only. Do not use for new writes;
   * use {@link fingerprintProfile} instead. Kept so older configs that
   * carry `experimental-cch-signing` round-trip losslessly.
   */
  experimentalCchSigning?: boolean;
  rebuildMidSystemMessage?: boolean;
}

export interface OpenAIProviderConfig {
  name: string;
  prefix?: string;
  baseUrl: string;
  apiKeyEntries: ApiKeyEntry[];
  disabled?: boolean;
  headers?: Record<string, string>;
  models?: ModelAlias[];
  priority?: number;
  testModel?: string;
  authIndex?: string;
  disableCooling?: boolean | null;
  [key: string]: unknown;
}
