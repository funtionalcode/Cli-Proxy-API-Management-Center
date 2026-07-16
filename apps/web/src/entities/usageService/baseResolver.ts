import {
  isUsageServiceId,
  normalizeUsageServiceBase,
  usageServiceApi,
  type UsageServiceInfo,
} from '@/services/api/usageService';
import { detectApiBaseFromLocation } from '@/utils/connection';

export interface UsageServiceBaseInput {
  apiBase?: string;
  usageServiceEnabled?: boolean;
  usageServiceBase?: string;
  detectedBase?: string;
}

export interface ResolveUsageServiceBaseDeps {
  getInfo?: (base: string) => Promise<UsageServiceInfo>;
}

const normalizeCandidate = (value: string | undefined) => normalizeUsageServiceBase(value || '');

export const hasConfiguredUsageServiceBase = ({
  usageServiceEnabled,
  usageServiceBase,
}: Pick<UsageServiceBaseInput, 'usageServiceEnabled' | 'usageServiceBase'>) =>
  Boolean(usageServiceEnabled && normalizeCandidate(usageServiceBase));

export function buildUsageServiceBaseCandidates({
  apiBase,
  usageServiceEnabled,
  usageServiceBase,
  detectedBase,
}: UsageServiceBaseInput): string[] {
  const resolvedDetectedBase =
    detectedBase === undefined ? detectApiBaseFromLocation() : detectedBase;

  return Array.from(
    new Set(
      [
        usageServiceEnabled && usageServiceBase ? usageServiceBase : '',
        apiBase,
        resolvedDetectedBase,
      ]
        .map(normalizeCandidate)
        .filter(Boolean)
    )
  );
}

export async function resolveUsageServiceBase(
  input: UsageServiceBaseInput,
  deps: ResolveUsageServiceBaseDeps = {}
): Promise<string> {
  if (hasConfiguredUsageServiceBase(input)) {
    return normalizeCandidate(input.usageServiceBase);
  }

  const getInfo = deps.getInfo ?? usageServiceApi.getInfo;
  const candidates = buildUsageServiceBaseCandidates({
    ...input,
    usageServiceEnabled: false,
    usageServiceBase: '',
  });

  for (const candidate of candidates) {
    try {
      const info = await getInfo(candidate);
      if (isUsageServiceId(info.service)) {
        return candidate;
      }
    } catch {
      // 普通 CPA 面板或不可达的 Usage Service 都继续尝试下一个候选地址。
    }
  }

  return '';
}
