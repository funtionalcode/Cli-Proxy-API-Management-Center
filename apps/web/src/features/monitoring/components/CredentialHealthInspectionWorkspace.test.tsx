import type { ReactNode } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CredentialHealthInspectionWorkspace } from './CredentialHealthInspectionWorkspace';

type ModeControlProps = {
  activeMode: 'local' | 'server';
  checking: boolean;
  serverAvailable: boolean;
  onChange: (mode: 'local' | 'server') => void;
};

type EmbeddedInspectionPageProps = {
  embedded?: boolean;
  modeControl?: ReactNode;
};

const { mocks } = vi.hoisted(() => ({
  mocks: {
    availability: {
      checking: false,
      serverCodexInspectionAvailable: true,
    },
    modeControlProps: null as ModeControlProps | null,
    localPageProps: null as EmbeddedInspectionPageProps | null,
    serverPageProps: null as EmbeddedInspectionPageProps | null,
  },
}));

vi.mock('@/hooks/usePanelFeatureAvailability', () => ({
  usePanelFeatureAvailability: () => mocks.availability,
}));

vi.mock('@/features/monitoring/components/CredentialHealthModeControl', () => ({
  CredentialHealthModeControl: (props: ModeControlProps) => {
    mocks.modeControlProps = props;
    return <button data-testid="mode-control">mode-control</button>;
  },
}));

vi.mock('@/features/monitoring/CodexInspectionPage', () => ({
  CodexInspectionPage: (props: EmbeddedInspectionPageProps) => {
    mocks.localPageProps = props;
    return <section data-inspection-page="local">{props.modeControl}</section>;
  },
}));

vi.mock('@/features/monitoring/ServerCodexInspectionPage', () => ({
  ServerCodexInspectionPage: (props: EmbeddedInspectionPageProps) => {
    mocks.serverPageProps = props;
    return <section data-inspection-page="server">{props.modeControl}</section>;
  },
}));

const renderWorkspace = async (
  mode: 'local' | 'server',
  onModeChange = vi.fn()
): Promise<ReactTestRenderer> => {
  let renderer: ReactTestRenderer;
  await act(async () => {
    renderer = create(
      <CredentialHealthInspectionWorkspace
        mode={mode}
        onModeChange={onModeChange}
        onSnapshotChange={vi.fn()}
        onCredentialsChanged={vi.fn()}
        onOpenCredential={vi.fn()}
      />
    );
    await Promise.resolve();
  });
  return renderer!;
};

describe('CredentialHealthInspectionWorkspace', () => {
  beforeEach(() => {
    mocks.availability = {
      checking: false,
      serverCodexInspectionAvailable: true,
    };
    mocks.modeControlProps = null;
    mocks.localPageProps = null;
    mocks.serverPageProps = null;
  });

  it('renders server inspection as an embedded component with its mode control', async () => {
    const renderer = await renderWorkspace('server');
    const page = renderer.root.findByProps({ 'data-inspection-page': 'server' });

    expect(mocks.serverPageProps?.embedded).toBe(true);
    expect(mocks.modeControlProps).toMatchObject({
      activeMode: 'server',
      checking: false,
      serverAvailable: true,
    });
    expect(page.findByProps({ 'data-testid': 'mode-control' })).toBeDefined();
  });

  it('falls back to local inspection when server inspection is unavailable', async () => {
    mocks.availability = {
      checking: false,
      serverCodexInspectionAvailable: false,
    };
    const onModeChange = vi.fn();
    const renderer = await renderWorkspace('server', onModeChange);

    expect(renderer.root.findByProps({ 'data-inspection-page': 'local' })).toBeDefined();
    expect(mocks.localPageProps?.embedded).toBe(true);
    expect(mocks.modeControlProps?.serverAvailable).toBe(false);
    expect(onModeChange).toHaveBeenCalledWith('local');
  });
});
