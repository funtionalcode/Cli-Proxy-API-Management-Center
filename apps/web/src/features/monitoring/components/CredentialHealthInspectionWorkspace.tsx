import { useEffect } from 'react';
import { usePanelFeatureAvailability } from '@/hooks/usePanelFeatureAvailability';
import { CodexInspectionPage } from '@/features/monitoring/CodexInspectionPage';
import { ServerCodexInspectionPage } from '@/features/monitoring/ServerCodexInspectionPage';
import { CredentialHealthModeControl } from '@/features/monitoring/components/CredentialHealthModeControl';
import type {
  CredentialHealthInspectionMode,
  CredentialInspectionSnapshot,
  CredentialInspectionTarget,
} from '@/features/monitoring/model/credentialInspectionSnapshot';

interface CredentialHealthInspectionWorkspaceProps {
  mode: CredentialHealthInspectionMode;
  onModeChange: (mode: CredentialHealthInspectionMode) => void;
  onSnapshotChange: (snapshot: CredentialInspectionSnapshot) => void;
  onCredentialsChanged: () => void | Promise<void>;
  onOpenCredential: (target: CredentialInspectionTarget) => void;
}

export function CredentialHealthInspectionWorkspace({
  mode,
  onModeChange,
  onSnapshotChange,
  onCredentialsChanged,
  onOpenCredential,
}: CredentialHealthInspectionWorkspaceProps) {
  const availability = usePanelFeatureAvailability();

  useEffect(() => {
    if (
      mode === 'server' &&
      !availability.checking &&
      !availability.serverCodexInspectionAvailable
    ) {
      onModeChange('local');
    }
  }, [
    availability.checking,
    availability.serverCodexInspectionAvailable,
    mode,
    onModeChange,
  ]);

  const modeControl = (
    <CredentialHealthModeControl
      activeMode={mode}
      checking={availability.checking}
      serverAvailable={availability.serverCodexInspectionAvailable}
      onChange={onModeChange}
    />
  );

  if (mode === 'server' && availability.serverCodexInspectionAvailable) {
    return (
      <ServerCodexInspectionPage
        embedded
        modeControl={modeControl}
        onSnapshotChange={onSnapshotChange}
        onCredentialsChanged={onCredentialsChanged}
        onOpenCredential={onOpenCredential}
      />
    );
  }

  return (
    <CodexInspectionPage
      embedded
      modeControl={modeControl}
      onSnapshotChange={onSnapshotChange}
      onCredentialsChanged={onCredentialsChanged}
      onOpenCredential={onOpenCredential}
    />
  );
}
