import { useEffect, useMemo, useState } from 'react';
import {
  isUsageServiceId,
  normalizeUsageServiceBase,
  usageServiceApi,
  type ManagerConfig,
} from '@/services/api/usageService';
import { DEMO_API_BASE, isDemoMode } from '@/features/demo/demoMode';
import { useAuthStore, useUsageServiceStore } from '@/stores';
import { detectApiBaseFromLocation, isLocalhost } from '@/utils/connection';

export type PanelHostMode = 'manager_embedded' | 'external_panel';

export type PanelFeatureUnavailableReason =
  | 'checking'
  | 'service_not_configured'
  | 'service_unavailable'
  | 'monitoring_disabled';

export interface PanelFeatureAvailability {
  checking: boolean;
  panelHostMode: PanelHostMode;
  panelBase: string;
  managerServiceBase: string;
  managerServiceAvailable: boolean;
  requestMonitoringAvailable: boolean;
  modelPricesAvailable: boolean;
  serverCodexInspectionAvailable: boolean;
  dockerSetupAvailable: boolean;
  externalManagerConfigAvailable: boolean;
  reason: PanelFeatureUnavailableReason | '';
}

export interface ResolvePanelFeatureAvailabilityInput {
  checking?: boolean;
  panelHostedByUsageService: boolean;
  panelBase: string;
  managerServiceBase: string;
  managerConfig: ManagerConfig | null;
  hasManagerCandidate: boolean;
  managementKey: string;
}

const normalizeBase = (value?: string) => normalizeUsageServiceBase(value || '');
const DEFAULT_MANAGER_SERVICE_PORT = '18317';

const buildDefaultManagerServiceCandidate = (base?: string): string => {
  const normalizedBase = normalizeBase(base);
  if (!normalizedBase) return '';

  try {
    const url = new URL(normalizedBase);
    url.port = DEFAULT_MANAGER_SERVICE_PORT;
    url.pathname = '';
    url.search = '';
    url.hash = '';
    return normalizeBase(url.toString());
  } catch {
    return '';
  }
};

type BaseParts = {
  hostname: string;
  port: string;
};

const readBaseParts = (base?: string): BaseParts | null => {
  const normalizedBase = normalizeBase(base);
  if (!normalizedBase) return null;

  try {
    const url = new URL(normalizedBase);
    return {
      hostname: url.hostname.toLowerCase(),
      port: url.port,
    };
  } catch {
    return null;
  }
};

const samePort = (left: BaseParts | null, right: BaseParts | null): boolean =>
  Boolean(left && right && left.port === right.port);

const managerBaseMatchesCandidate = (
  configuredManagerBase: string,
  managerServiceBase: string
): boolean => {
  const normalizedConfigured = normalizeBase(configuredManagerBase);
  const normalizedCandidate = normalizeBase(managerServiceBase);
  if (!normalizedConfigured || !normalizedCandidate) return true;
  if (normalizedConfigured === normalizedCandidate) return true;

  const configured = readBaseParts(normalizedConfigured);
  const candidate = readBaseParts(normalizedCandidate);
  return Boolean(
    configured && candidate && isLocalhost(configured.hostname) && samePort(configured, candidate)
  );
};

const cpaBaseMatchesPanel = ({
  configuredCpaBase,
  apiBase,
  managerServiceBase,
}: {
  configuredCpaBase: string;
  apiBase: string;
  managerServiceBase: string;
}): boolean => {
  const normalizedConfigured = normalizeBase(configuredCpaBase);
  const normalizedApiBase = normalizeBase(apiBase);
  if (!normalizedConfigured || !normalizedApiBase) return true;
  if (normalizedConfigured === normalizedApiBase) return true;

  const configured = readBaseParts(normalizedConfigured);
  const api = readBaseParts(normalizedApiBase);
  const manager = readBaseParts(managerServiceBase);
  if (!configured || !api || !manager || !samePort(configured, api)) return false;

  return (
    (isLocalhost(configured.hostname) && api.hostname === manager.hostname) ||
    (isLocalhost(api.hostname) && configured.hostname === manager.hostname)
  );
};

const buildUnavailableState = (
  input: ResolvePanelFeatureAvailabilityInput,
  reason: PanelFeatureUnavailableReason
): PanelFeatureAvailability => ({
  checking: input.checking === true,
  panelHostMode: input.panelHostedByUsageService ? 'manager_embedded' : 'external_panel',
  panelBase: normalizeBase(input.panelBase),
  managerServiceBase: '',
  managerServiceAvailable: false,
  requestMonitoringAvailable: false,
  modelPricesAvailable: false,
  serverCodexInspectionAvailable: false,
  dockerSetupAvailable: input.panelHostedByUsageService,
  externalManagerConfigAvailable: false,
  reason,
});

export function resolvePanelFeatureAvailability(
  input: ResolvePanelFeatureAvailabilityInput
): PanelFeatureAvailability {
  if (!input.managementKey) {
    return buildUnavailableState(input, 'service_not_configured');
  }

  const managerServiceBase = normalizeBase(input.managerServiceBase);
  if (!managerServiceBase || !input.managerConfig) {
    return buildUnavailableState(
      input,
      input.hasManagerCandidate ? 'service_unavailable' : 'service_not_configured'
    );
  }

  const hasCPAConnection = Boolean(
    input.managerConfig.cpaConnection?.cpaBaseUrl &&
    input.managerConfig.cpaConnection?.managementKey
  );
  const collectorEnabled = input.managerConfig.collector?.enabled !== false;
  const requestMonitoringAvailable = hasCPAConnection && collectorEnabled;

  return {
    checking: input.checking === true,
    panelHostMode: input.panelHostedByUsageService ? 'manager_embedded' : 'external_panel',
    panelBase: normalizeBase(input.panelBase),
    managerServiceBase,
    managerServiceAvailable: true,
    requestMonitoringAvailable,
    modelPricesAvailable: true,
    serverCodexInspectionAvailable: true,
    dockerSetupAvailable: input.panelHostedByUsageService,
    externalManagerConfigAvailable: !input.panelHostedByUsageService,
    reason: requestMonitoringAvailable
      ? ''
      : !hasCPAConnection
        ? 'service_not_configured'
        : 'monitoring_disabled',
  };
}

export interface BuildPanelManagerServiceCandidatesInput {
  panelHostedByUsageService: boolean;
  panelBase: string;
  apiBase?: string;
  usageServiceEnabled?: boolean;
  usageServiceBase?: string;
}

export function buildPanelManagerServiceCandidates({
  panelHostedByUsageService,
  panelBase,
  apiBase,
  usageServiceEnabled,
  usageServiceBase,
}: BuildPanelManagerServiceCandidatesInput): string[] {
  const normalizedPanelBase = normalizeBase(panelBase);
  if (panelHostedByUsageService) {
    return normalizedPanelBase ? [normalizedPanelBase] : [];
  }

  return Array.from(
    new Set(
      [
        usageServiceEnabled && usageServiceBase ? usageServiceBase : '',
        buildDefaultManagerServiceCandidate(apiBase),
        buildDefaultManagerServiceCandidate(normalizedPanelBase),
        apiBase,
        normalizedPanelBase,
      ]
        .map(normalizeBase)
        .filter(Boolean)
    )
  );
}

export function managerConfigMatchesPanel({
  panelHostedByUsageService,
  apiBase,
  managerServiceBase,
  config,
}: {
  panelHostedByUsageService: boolean;
  apiBase: string;
  managerServiceBase?: string;
  config: ManagerConfig;
}): boolean {
  if (panelHostedByUsageService) return true;

  const normalizedApiBase = normalizeBase(apiBase);
  const configuredCpaBase = normalizeBase(config.cpaConnection?.cpaBaseUrl || '');
  const normalizedManagerBase = normalizeBase(managerServiceBase || '');
  if (
    configuredCpaBase &&
    normalizedApiBase &&
    !cpaBaseMatchesPanel({
      configuredCpaBase,
      apiBase: normalizedApiBase,
      managerServiceBase: normalizedManagerBase,
    })
  ) {
    return false;
  }

  const externalConfig = config.externalUsageService;
  if (externalConfig?.enabled === false) return false;

  const configuredManagerBase = normalizeBase(externalConfig?.serviceBase || '');
  return managerBaseMatchesCandidate(configuredManagerBase, normalizedManagerBase);
}

type PanelFeatureAvailabilityRequestInput = {
  apiBase: string;
  managementKey: string;
  usageServiceRevision: number;
  usageServiceEnabled: boolean;
  usageServiceBase: string;
  panelBase: string;
};

type PanelFeatureAvailabilityRequest = {
  key: string;
  promise: Promise<PanelFeatureAvailability>;
};

const initialAvailability: PanelFeatureAvailability = {
  checking: true,
  panelHostMode: 'external_panel',
  panelBase: '',
  managerServiceBase: '',
  managerServiceAvailable: false,
  requestMonitoringAvailable: false,
  modelPricesAvailable: false,
  serverCodexInspectionAvailable: false,
  dockerSetupAvailable: false,
  externalManagerConfigAvailable: false,
  reason: 'checking',
};

const demoAvailability: PanelFeatureAvailability = {
  checking: false,
  panelHostMode: 'manager_embedded',
  panelBase: DEMO_API_BASE,
  managerServiceBase: DEMO_API_BASE,
  managerServiceAvailable: true,
  requestMonitoringAvailable: true,
  modelPricesAvailable: true,
  serverCodexInspectionAvailable: true,
  dockerSetupAvailable: true,
  externalManagerConfigAvailable: false,
  reason: '',
};

let cachedAvailabilityKey = '';
let cachedAvailability: PanelFeatureAvailability | null = null;
let inFlightAvailabilityRequest: PanelFeatureAvailabilityRequest | null = null;
let latestAvailabilityRequestKey = '';

const buildAvailabilityRequestKey = ({
  apiBase,
  managementKey,
  usageServiceRevision,
  usageServiceEnabled,
  usageServiceBase,
  panelBase,
}: PanelFeatureAvailabilityRequestInput): string =>
  [
    normalizeBase(panelBase),
    normalizeBase(apiBase),
    usageServiceEnabled ? '1' : '0',
    normalizeBase(usageServiceBase),
    managementKey,
    String(usageServiceRevision),
  ].join('\u001f');

async function detectPanelFeatureAvailability({
  apiBase,
  managementKey,
  panelBase,
  usageServiceEnabled,
  usageServiceBase,
}: PanelFeatureAvailabilityRequestInput): Promise<PanelFeatureAvailability> {
  const normalizedPanelBase = normalizeBase(panelBase);
  if (!managementKey) {
    return resolvePanelFeatureAvailability({
      checking: false,
      panelHostedByUsageService: false,
      panelBase: normalizedPanelBase,
      managerServiceBase: '',
      managerConfig: null,
      hasManagerCandidate: false,
      managementKey,
    });
  }

  const candidates = buildPanelManagerServiceCandidates({
    panelHostedByUsageService: false,
    panelBase: normalizedPanelBase,
    apiBase,
    usageServiceEnabled,
    usageServiceBase,
  });

  for (const candidate of candidates) {
    try {
      const info = await usageServiceApi.getInfo(candidate);
      if (!isUsageServiceId(info.service)) continue;
      const panelHostedByUsageService = normalizeBase(candidate) === normalizedPanelBase;
      const response = await usageServiceApi.getManagerConfig(candidate, managementKey);
      if (
        !managerConfigMatchesPanel({
          panelHostedByUsageService,
          apiBase,
          managerServiceBase: candidate,
          config: response.config,
        })
      ) {
        continue;
      }
      return resolvePanelFeatureAvailability({
        checking: false,
        panelHostedByUsageService,
        panelBase: normalizedPanelBase,
        managerServiceBase: candidate,
        managerConfig: response.config,
        hasManagerCandidate: candidates.length > 0,
        managementKey,
      });
    } catch {
      // Continue probing; a regular CPA endpoint or unreachable Manager Server is expected here.
    }
  }

  const unavailableState = resolvePanelFeatureAvailability({
    checking: false,
    panelHostedByUsageService: false,
    panelBase: normalizedPanelBase,
    managerServiceBase: '',
    managerConfig: null,
    hasManagerCandidate: candidates.length > 0,
    managementKey,
  });
  return unavailableState;
}

function requestPanelFeatureAvailability(input: PanelFeatureAvailabilityRequestInput): {
  key: string;
  promise: Promise<PanelFeatureAvailability>;
} {
  const key = buildAvailabilityRequestKey(input);
  if (cachedAvailabilityKey === key && cachedAvailability) {
    return { key, promise: Promise.resolve(cachedAvailability) };
  }
  if (inFlightAvailabilityRequest?.key === key) {
    return inFlightAvailabilityRequest;
  }

  latestAvailabilityRequestKey = key;
  const promise = detectPanelFeatureAvailability(input).then((availability) => {
    if (latestAvailabilityRequestKey === key) {
      cachedAvailabilityKey = key;
      cachedAvailability = availability;
    }
    return availability;
  });
  inFlightAvailabilityRequest = { key, promise };
  promise.finally(() => {
    if (inFlightAvailabilityRequest?.key === key) {
      inFlightAvailabilityRequest = null;
    }
  });
  return inFlightAvailabilityRequest;
}

export function usePanelFeatureAvailability(): PanelFeatureAvailability {
  const demoMode = __DEMO_SITE__ && isDemoMode();
  const apiBase = useAuthStore((state) => state.apiBase);
  const managementKey = useAuthStore((state) => state.managementKey);
  const usageServiceEnabled = useUsageServiceStore((state) => state.enabled);
  const usageServiceBase = useUsageServiceStore((state) => state.serviceBase);
  const usageServiceRevision = useUsageServiceStore((state) => state.revision);
  const panelBase = useMemo(() => detectApiBaseFromLocation(), []);
  const requestInput = useMemo(
    () => ({
      apiBase,
      managementKey,
      usageServiceEnabled,
      usageServiceBase,
      usageServiceRevision,
      panelBase,
    }),
    [apiBase, managementKey, panelBase, usageServiceBase, usageServiceEnabled, usageServiceRevision]
  );
  const requestKey = useMemo(() => buildAvailabilityRequestKey(requestInput), [requestInput]);
  const [state, setState] = useState<PanelFeatureAvailability>(() =>
    demoMode
      ? demoAvailability
      : cachedAvailabilityKey === requestKey && cachedAvailability
        ? cachedAvailability
        : initialAvailability
  );

  useEffect(() => {
    let cancelled = false;
    if (demoMode) {
      return () => {
        cancelled = true;
      };
    }

    const hasCachedAvailability = cachedAvailabilityKey === requestKey && cachedAvailability;
    if (!hasCachedAvailability) {
      queueMicrotask(() => {
        if (cancelled) return;
        setState((current) => ({
          ...current,
          checking: true,
          panelBase: normalizeBase(panelBase),
          reason: 'checking',
        }));
      });
    }

    const request = requestPanelFeatureAvailability(requestInput);
    request.promise.then((availability) => {
      if (cancelled || request.key !== requestKey) return;
      setState(availability);
    });

    return () => {
      cancelled = true;
    };
  }, [panelBase, demoMode, requestInput, requestKey]);

  return demoMode ? demoAvailability : state;
}
