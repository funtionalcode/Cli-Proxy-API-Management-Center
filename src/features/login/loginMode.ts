import { isUsageServiceId, type UsageServiceInfo } from '@/services/api/usageService';

export const resolveUsageServiceLoginMode = (info?: UsageServiceInfo | null) => {
  const hostedByUsageService = isUsageServiceId(info?.service);
  const projectInitialized = info?.projectInitialized ?? info?.configured;
  return {
    hostedByUsageService,
    usageServiceNeedsSetup:
      hostedByUsageService && (info?.setupRequired === true || projectInitialized !== true),
  };
};
