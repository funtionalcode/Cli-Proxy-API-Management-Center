import iconGemini from '@/assets/icons/gemini.svg';
import iconCodex from '@/assets/icons/codex.svg';
import iconClaude from '@/assets/icons/claude.svg';
import iconVertex from '@/assets/icons/vertex.svg';
import iconOpenaiLight from '@/assets/icons/openai-light.svg';
import iconOpenaiDark from '@/assets/icons/openai-dark.svg';
import type { ProviderKind } from './rowData';

/** 品牌名，无需 i18n */
export const PROVIDER_KIND_LABELS: Record<ProviderKind, string> = {
  gemini: 'Gemini',
  codex: 'Codex',
  claude: 'Claude',
  vertex: 'Vertex',
  openai: 'OpenAI',
};

const KIND_ICONS: Record<Exclude<ProviderKind, 'openai'>, string> = {
  gemini: iconGemini,
  codex: iconCodex,
  claude: iconClaude,
  vertex: iconVertex,
};

export const getProviderKindIcon = (kind: ProviderKind, resolvedTheme: string): string => {
  if (kind === 'openai') {
    return resolvedTheme === 'dark' ? iconOpenaiDark : iconOpenaiLight;
  }
  return KIND_ICONS[kind];
};
