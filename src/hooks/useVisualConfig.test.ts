import { act, createElement, createRef, useImperativeHandle, useState, type Ref } from 'react';
import { create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { VisualConfigEditor } from '@/components/config/VisualConfigEditor';
import type { VisualConfigValues } from '@/types/visualConfig';
import { useVisualConfig } from './useVisualConfig';

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => {} },
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('@/components/common/PageTransitionLayer', () => ({
  usePageTransitionLayer: () => null,
}));

vi.mock('@/hooks/useMediaQuery', () => ({
  useMediaQuery: () => false,
}));

vi.mock('@/components/config/VisualConfigEditorBlocks', () => ({
  ApiKeysCardEditor: () => null,
  PayloadFilterRulesEditor: () => null,
  PayloadRulesEditor: () => null,
  PluginStoreAuthEditor: () => null,
}));

type UseVisualConfigResult = ReturnType<typeof useVisualConfig>;

type UseVisualConfigHarness = {
  getCurrent: () => UseVisualConfigResult;
  unmount: () => void;
};

function HookHarness({ hookRef }: { hookRef: Ref<UseVisualConfigResult> }) {
  const hook = useVisualConfig();
  useImperativeHandle(hookRef, () => hook, [hook]);
  return null;
}

const mountUseVisualConfig = (): UseVisualConfigHarness => {
  const hookRef = createRef<UseVisualConfigResult>();
  let renderer: ReactTestRenderer | null = null;

  act(() => {
    renderer = create(createElement(HookHarness, { hookRef }));
  });

  return {
    getCurrent: () => {
      if (!hookRef.current) {
        throw new Error('Failed to mount useVisualConfig test harness');
      }
      return hookRef.current;
    },
    unmount: () => {
      if (!renderer) return;
      act(() => {
        renderer?.unmount();
      });
    },
  };
};

function getRenderedText(node: ReactTestInstance): string {
  return node.children
    .map((child) => (typeof child === 'string' ? child : getRenderedText(child)))
    .join('');
}

describe('useVisualConfig', () => {
  it('loads plugin system state from plugins.enabled', () => {
    const harness = mountUseVisualConfig();
    const yaml = ['plugins:', '  enabled: true', ''].join('\n');

    act(() => {
      const result = harness.getCurrent().loadVisualValuesFromYaml(yaml);
      expect(result.ok).toBe(true);
    });

    expect(harness.getCurrent().visualValues.pluginsEnabled).toBe(true);
    harness.unmount();
  });

  it('loads plugin directory and store sources from plugins config', () => {
    const harness = mountUseVisualConfig();
    const yaml = [
      'plugins:',
      '  enabled: true',
      '  dir: /data/cpa/plugins',
      '  store-sources:',
      '    - https://plugins.example.com/official.json',
      '    - https://plugins.example.com/private.json',
      '',
    ].join('\n');

    act(() => {
      const result = harness.getCurrent().loadVisualValuesFromYaml(yaml);
      expect(result.ok).toBe(true);
    });

    expect(harness.getCurrent().visualValues.pluginsEnabled).toBe(true);
    expect(harness.getCurrent().visualValues.pluginsDir).toBe('/data/cpa/plugins');
    expect(harness.getCurrent().visualValues.pluginStoreSourcesText).toBe(
      [
        'https://plugins.example.com/official.json',
        'https://plugins.example.com/private.json',
      ].join('\n')
    );

    harness.unmount();
  });

  it('loads plugin store auth rules from plugins config', () => {
    const harness = mountUseVisualConfig();
    const yaml = [
      'plugins:',
      '  store-auth:',
      '    - match: https://api.github.com/repos/acme/private/releases/',
      '      apply-to:',
      '        - metadata',
      '        - artifact',
      '      type: github-token',
      '      token-env: GITHUB_TOKEN',
      '      allow-insecure: true',
      '',
    ].join('\n');

    act(() => {
      const result = harness.getCurrent().loadVisualValuesFromYaml(yaml);
      expect(result.ok).toBe(true);
    });

    expect(harness.getCurrent().visualValues.pluginStoreAuth).toEqual([
      expect.objectContaining({
        match: 'https://api.github.com/repos/acme/private/releases/',
        applyTo: ['metadata', 'artifact'],
        type: 'github-token',
        tokenEnv: 'GITHUB_TOKEN',
        allowInsecure: true,
      }),
    ]);

    harness.unmount();
  });

  it('writes plugins.enabled when enabling plugin system from visual editor', () => {
    const harness = mountUseVisualConfig();
    const yaml = ['host: 127.0.0.1', ''].join('\n');

    act(() => {
      const result = harness.getCurrent().loadVisualValuesFromYaml(yaml);
      expect(result.ok).toBe(true);
    });

    act(() => {
      harness.getCurrent().setVisualValues({ pluginsEnabled: true });
    });

    const savedYaml = harness.getCurrent().applyVisualChangesToYaml(yaml);
    expect(savedYaml).toContain('plugins:');
    expect(savedYaml).toContain('enabled: true');

    harness.unmount();
  });

  it('writes plugin directory and store sources while preserving plugin configs', () => {
    const harness = mountUseVisualConfig();
    const yaml = ['plugins:', '  configs:', '    demo:', '      enabled: true', ''].join('\n');

    act(() => {
      const result = harness.getCurrent().loadVisualValuesFromYaml(yaml);
      expect(result.ok).toBe(true);
    });

    act(() => {
      harness.getCurrent().setVisualValues({
        pluginsDir: '/opt/cpa/plugins',
        pluginStoreSourcesText: [
          'https://plugins.example.com/official.json',
          '',
          ' https://plugins.example.com/private.json ',
        ].join('\n'),
      });
    });

    const savedYaml = harness.getCurrent().applyVisualChangesToYaml(yaml);
    const parsed = parseYaml(savedYaml) as {
      plugins?: {
        dir?: string;
        'store-sources'?: string[];
        configs?: { demo?: { enabled?: boolean } };
      };
    };

    expect(parsed.plugins?.dir).toBe('/opt/cpa/plugins');
    expect(parsed.plugins?.['store-sources']).toEqual([
      'https://plugins.example.com/official.json',
      'https://plugins.example.com/private.json',
    ]);
    expect(parsed.plugins?.configs?.demo?.enabled).toBe(true);

    harness.unmount();
  });

  it('writes plugin store auth rules only after editing the auth field', () => {
    const harness = mountUseVisualConfig();
    const yaml = ['plugins:', '  configs:', '    demo:', '      enabled: true', ''].join('\n');

    act(() => {
      const result = harness.getCurrent().loadVisualValuesFromYaml(yaml);
      expect(result.ok).toBe(true);
    });

    const unchangedYaml = harness.getCurrent().applyVisualChangesToYaml(yaml);
    expect(parseYaml(unchangedYaml) as { plugins?: { 'store-auth'?: unknown } }).toEqual(
      expect.objectContaining({
        plugins: expect.not.objectContaining({ 'store-auth': expect.anything() }),
      })
    );

    act(() => {
      harness.getCurrent().setVisualValues({
        pluginStoreAuth: [
          {
            id: 'rule-1',
            match: 'https://downloads.example.com/private/',
            applyTo: ['artifact'],
            type: 'bearer',
            tokenEnv: 'PLUGIN_TOKEN',
            usernameEnv: '',
            passwordEnv: '',
            headerName: '',
            headerValueEnv: '',
            allowInsecure: false,
          },
        ],
      });
    });

    const savedYaml = harness.getCurrent().applyVisualChangesToYaml(yaml);
    const parsed = parseYaml(savedYaml) as {
      plugins?: {
        'store-auth'?: Array<Record<string, unknown>>;
        configs?: { demo?: { enabled?: boolean } };
      };
    };

    expect(parsed.plugins?.['store-auth']).toEqual([
      {
        match: 'https://downloads.example.com/private/',
        type: 'bearer',
        'apply-to': ['artifact'],
        'token-env': 'PLUGIN_TOKEN',
      },
    ]);
    expect(parsed.plugins?.configs?.demo?.enabled).toBe(true);

    harness.unmount();
  });

  it('clears plugin directory and store sources without removing plugin configs', () => {
    const harness = mountUseVisualConfig();
    const yaml = [
      'plugins:',
      '  dir: /opt/cpa/plugins',
      '  store-sources:',
      '    - https://plugins.example.com/official.json',
      '  configs:',
      '    demo:',
      '      enabled: true',
      '',
    ].join('\n');

    act(() => {
      const result = harness.getCurrent().loadVisualValuesFromYaml(yaml);
      expect(result.ok).toBe(true);
    });

    act(() => {
      harness.getCurrent().setVisualValues({
        pluginsDir: '',
        pluginStoreSourcesText: '',
      });
    });

    const savedYaml = harness.getCurrent().applyVisualChangesToYaml(yaml);
    const parsed = parseYaml(savedYaml) as {
      plugins?: {
        dir?: string;
        'store-sources'?: string[];
        configs?: { demo?: { enabled?: boolean } };
      };
    };

    expect(parsed.plugins?.dir).toBeUndefined();
    expect(parsed.plugins?.['store-sources']).toBeUndefined();
    expect(parsed.plugins?.configs?.demo?.enabled).toBe(true);

    harness.unmount();
  });

  it('clears camelCase codex identityConfuse when disabling from visual editor', () => {
    const harness = mountUseVisualConfig();
    const yaml = [
      'host: 127.0.0.1',
      'codex:',
      '  identityConfuse: true',
      '  other-setting: kept',
      '',
    ].join('\n');

    act(() => {
      const result = harness.getCurrent().loadVisualValuesFromYaml(yaml);
      expect(result.ok).toBe(true);
    });
    expect(harness.getCurrent().visualValues.codexIdentityConfuse).toBe(true);

    act(() => {
      harness.getCurrent().setVisualValues({ codexIdentityConfuse: false });
    });

    const savedYaml = harness.getCurrent().applyVisualChangesToYaml(yaml);
    expect(savedYaml).not.toContain('identityConfuse: true');
    expect(savedYaml).not.toContain('identityConfuse:');
    expect(savedYaml).toContain('identity-confuse: false');
    expect(savedYaml).toContain('other-setting: kept');

    harness.unmount();
  });

  it('round-trips disable-image-generation passthrough without rewriting it', () => {
    const harness = mountUseVisualConfig();
    const yaml = ['disable-image-generation: passthrough', 'debug: false', ''].join('\n');

    act(() => {
      expect(harness.getCurrent().loadVisualValuesFromYaml(yaml).ok).toBe(true);
    });
    expect(harness.getCurrent().visualValues.disableImageGeneration).toBe('passthrough');

    act(() => {
      harness.getCurrent().setVisualValues({ debug: true });
    });
    const parsed = parseYaml(harness.getCurrent().applyVisualChangesToYaml(yaml)) as Record<
      string,
      unknown
    >;
    expect(parsed['disable-image-generation']).toBe('passthrough');
    expect(parsed.debug).toBe(true);

    harness.unmount();
  });

  it('uses CPA defaults for absent quota and WebSocket auth fields', () => {
    const harness = mountUseVisualConfig();
    const yaml = ['host: 127.0.0.1', ''].join('\n');

    act(() => {
      expect(harness.getCurrent().loadVisualValuesFromYaml(yaml).ok).toBe(true);
    });

    expect(harness.getCurrent().visualValues.quotaSwitchProject).toBe(false);
    expect(harness.getCurrent().visualValues.quotaSwitchPreviewModel).toBe(false);
    expect(harness.getCurrent().visualValues.wsAuth).toBe(true);

    const parsed = parseYaml(harness.getCurrent().applyVisualChangesToYaml(yaml)) as Record<
      string,
      unknown
    >;
    expect(parsed['quota-exceeded']).toBeUndefined();
    expect(parsed['ws-auth']).toBeUndefined();
    expect(parsed.pprof).toBeUndefined();

    harness.unmount();
  });

  it('applies only dirty fields to the latest YAML document', () => {
    const harness = mountUseVisualConfig();
    const baselineYaml = [
      'pprof:',
      '  enable: false',
      '  addr: 127.0.0.1:8316',
      'ws-auth: true',
      'quota-exceeded:',
      '  switch-project: false',
      '  switch-preview-model: false',
      '  antigravity-credits: false',
      'debug: false',
      '',
    ].join('\n');
    const latestYaml = [
      'pprof:',
      '  enable: true',
      '  addr: 127.0.0.1:9316',
      '  future-profile-mode: latest',
      'ws-auth: false',
      'quota-exceeded:',
      '  switch-project: true',
      '  switch-preview-model: true',
      '  antigravity-credits: true',
      '  future-quota-mode: latest',
      'debug: false',
      'unknown-root-key: latest',
      '',
    ].join('\n');

    act(() => {
      expect(harness.getCurrent().loadVisualValuesFromYaml(baselineYaml).ok).toBe(true);
      harness.getCurrent().setVisualValues({ debug: true });
    });

    const parsed = parseYaml(harness.getCurrent().applyVisualChangesToYaml(latestYaml)) as {
      pprof?: Record<string, unknown>;
      'ws-auth'?: boolean;
      'quota-exceeded'?: Record<string, unknown>;
      debug?: boolean;
      'unknown-root-key'?: string;
    };
    expect(parsed.pprof).toEqual({
      enable: true,
      addr: '127.0.0.1:9316',
      'future-profile-mode': 'latest',
    });
    expect(parsed['ws-auth']).toBe(false);
    expect(parsed['quota-exceeded']).toEqual({
      'switch-project': true,
      'switch-preview-model': true,
      'antigravity-credits': true,
      'future-quota-mode': 'latest',
    });
    expect(parsed.debug).toBe(true);
    expect(parsed['unknown-root-key']).toBe('latest');

    harness.unmount();
  });

  it.each([
    ['null', 'pprof: null # keep null pprof\ndebug: false\n', null],
    ['scalar', 'pprof: disabled # keep scalar pprof\ndebug: false\n', 'disabled'],
  ])('preserves a %s pprof node during unrelated saves', (_name, yaml, expectedPprof) => {
    const harness = mountUseVisualConfig();

    act(() => {
      expect(harness.getCurrent().loadVisualValuesFromYaml(yaml).ok).toBe(true);
      harness.getCurrent().setVisualValues({ debug: true });
    });

    const savedYaml = harness.getCurrent().applyVisualChangesToYaml(yaml);
    const parsed = parseYaml(savedYaml) as { pprof?: unknown; debug?: boolean };
    expect(parsed.pprof).toBe(expectedPprof);
    expect(savedYaml).toContain('# keep');
    expect(parsed.debug).toBe(true);

    harness.unmount();
  });

  it('writes only the quota option explicitly changed from an absent quota block', () => {
    const harness = mountUseVisualConfig();
    const yaml = ['host: 127.0.0.1', ''].join('\n');

    act(() => {
      expect(harness.getCurrent().loadVisualValuesFromYaml(yaml).ok).toBe(true);
      harness.getCurrent().setVisualValues({ quotaSwitchProject: true });
    });

    const parsed = parseYaml(harness.getCurrent().applyVisualChangesToYaml(yaml)) as {
      'quota-exceeded'?: Record<string, unknown>;
    };
    expect(parsed['quota-exceeded']).toEqual({ 'switch-project': true });

    harness.unmount();
  });

  it('writes ws-auth false when the user explicitly disables the CPA default', () => {
    const harness = mountUseVisualConfig();
    const yaml = ['host: 127.0.0.1', ''].join('\n');

    act(() => {
      expect(harness.getCurrent().loadVisualValuesFromYaml(yaml).ok).toBe(true);
      harness.getCurrent().setVisualValues({ wsAuth: false });
    });

    const parsed = parseYaml(harness.getCurrent().applyVisualChangesToYaml(yaml)) as Record<
      string,
      unknown
    >;
    expect(parsed['ws-auth']).toBe(false);

    harness.unmount();
  });

  it('rejects zero Redis usage retention because CPA normalizes it to 60', () => {
    const harness = mountUseVisualConfig();

    act(() => {
      harness.getCurrent().setVisualValues({ redisUsageQueueRetentionSeconds: '0' });
    });

    expect(harness.getCurrent().visualValidationErrors.redisUsageQueueRetentionSeconds).toBe(
      'retention_seconds_range'
    );
    harness.unmount();
  });

  it('keeps an existing management key unchanged during unrelated visual edits', () => {
    const harness = mountUseVisualConfig();
    const hash = '$2a$10$01234567890123456789012345678901234567890123456789012';
    const yaml = [
      'remote-management:',
      `  secret-key: '${hash}'`,
      '  allow-remote: false',
      '',
    ].join('\n');

    act(() => {
      expect(harness.getCurrent().loadVisualValuesFromYaml(yaml).ok).toBe(true);
    });
    expect(harness.getCurrent().visualValues.rmSecretKey).toBe('');
    expect(harness.getCurrent().visualValues.rmSecretKeyAction).toBe('unchanged');
    expect(harness.getCurrent().visualValues.rmSecretKeyConfigured).toBe(true);

    act(() => {
      harness.getCurrent().setVisualValues({ rmAllowRemote: true });
    });
    const parsed = parseYaml(harness.getCurrent().applyVisualChangesToYaml(yaml)) as {
      'remote-management'?: Record<string, unknown>;
    };
    expect(parsed['remote-management']?.['secret-key']).toBe(hash);
    expect(parsed['remote-management']?.['allow-remote']).toBe(true);

    harness.unmount();
  });

  it('replaces a management key without trimming its bytes', () => {
    const harness = mountUseVisualConfig();
    const yaml = ['remote-management:', "  secret-key: '$2a$10$existing'", ''].join('\n');

    act(() => {
      expect(harness.getCurrent().loadVisualValuesFromYaml(yaml).ok).toBe(true);
      harness.getCurrent().setVisualValues({
        rmSecretKey: '  exact key  ',
        rmSecretKeyAction: 'replace',
      });
    });

    const parsed = parseYaml(harness.getCurrent().applyVisualChangesToYaml(yaml)) as {
      'remote-management'?: Record<string, unknown>;
    };
    expect(parsed['remote-management']?.['secret-key']).toBe('  exact key  ');

    harness.unmount();
  });

  it('does not clear an existing management key through an empty replacement', () => {
    const harness = mountUseVisualConfig();
    const hash = '$2a$10$existing';
    const yaml = ['remote-management:', `  secret-key: '${hash}'`, ''].join('\n');

    act(() => {
      expect(harness.getCurrent().loadVisualValuesFromYaml(yaml).ok).toBe(true);
      harness.getCurrent().setVisualValues({
        rmSecretKey: '',
        rmSecretKeyAction: 'replace',
      });
    });

    const parsed = parseYaml(harness.getCurrent().applyVisualChangesToYaml(yaml)) as {
      'remote-management'?: Record<string, unknown>;
    };
    expect(parsed['remote-management']?.['secret-key']).toBe(hash);

    harness.unmount();
  });

  it('explicitly clears the management key to disable the Management API', () => {
    const harness = mountUseVisualConfig();
    const yaml = ['remote-management:', "  secret-key: '$2a$10$existing'", ''].join('\n');

    act(() => {
      expect(harness.getCurrent().loadVisualValuesFromYaml(yaml).ok).toBe(true);
      harness.getCurrent().setVisualValues({ rmSecretKey: '', rmSecretKeyAction: 'clear' });
    });

    const parsed = parseYaml(harness.getCurrent().applyVisualChangesToYaml(yaml)) as {
      'remote-management'?: Record<string, unknown>;
    };
    expect(parsed['remote-management']?.['secret-key']).toBe('');

    harness.unmount();
  });

  it('loads and saves the added CPA runtime settings', () => {
    const harness = mountUseVisualConfig();
    const yaml = [
      'pprof:',
      '  enable: true',
      '  addr: 127.0.0.1:9316',
      'save-cooldown-status: true',
      'transient-error-cooldown-seconds: -1',
      'disable-claude-cloak-mode: true',
      'gpt-image-2-base-model: gpt-5.4',
      'video-result-auth-cache-ttl: 45m',
      '',
    ].join('\n');

    act(() => {
      expect(harness.getCurrent().loadVisualValuesFromYaml(yaml).ok).toBe(true);
    });
    expect(harness.getCurrent().visualValues).toEqual(
      expect.objectContaining({
        pprofEnable: true,
        pprofAddr: '127.0.0.1:9316',
        saveCooldownStatus: true,
        transientErrorCooldownSeconds: '-1',
        disableClaudeCloakMode: true,
        gptImage2BaseModel: 'gpt-5.4',
        videoResultAuthCacheTtl: '45m',
      })
    );

    act(() => {
      harness.getCurrent().setVisualValues({
        pprofEnable: false,
        pprofAddr: '127.0.0.1:8316',
        saveCooldownStatus: false,
        transientErrorCooldownSeconds: '15',
        disableClaudeCloakMode: false,
        gptImage2BaseModel: 'gpt-5.4-mini',
        videoResultAuthCacheTtl: '3h',
      });
    });

    const parsed = parseYaml(harness.getCurrent().applyVisualChangesToYaml(yaml)) as Record<
      string,
      unknown
    >;
    expect(parsed.pprof).toEqual({ enable: false, addr: '127.0.0.1:8316' });
    expect(parsed['save-cooldown-status']).toBe(false);
    expect(parsed['transient-error-cooldown-seconds']).toBe(15);
    expect(parsed['disable-claude-cloak-mode']).toBe(false);
    expect(parsed['gpt-image-2-base-model']).toBe('gpt-5.4-mini');
    expect(parsed['video-result-auth-cache-ttl']).toBe('3h');

    harness.unmount();
  });

  it('loads and writes managed header and account env switches', () => {
    const harness = mountUseVisualConfig();
    const yaml = [
      'host: 127.0.0.1',
      'managed-header-profile:',
      '  online-update: false',
      'normalize-account-env: false',
      '',
    ].join('\n');

    act(() => {
      const result = harness.getCurrent().loadVisualValuesFromYaml(yaml);
      expect(result.ok).toBe(true);
    });

    expect(harness.getCurrent().visualValues.managedHeaderOnlineUpdate).toBe(false);
    expect(harness.getCurrent().visualValues.normalizeAccountEnv).toBe(false);

    act(() => {
      harness.getCurrent().setVisualValues({
        managedHeaderOnlineUpdate: true,
        normalizeAccountEnv: true,
      });
    });

    const savedYaml = harness.getCurrent().applyVisualChangesToYaml(yaml);
    const parsed = parseYaml(savedYaml) as {
      'managed-header-profile'?: { 'online-update'?: boolean };
      'normalize-account-env'?: boolean;
    };

    expect(parsed['managed-header-profile']?.['online-update']).toBe(true);
    expect(parsed['normalize-account-env']).toBe(true);

    harness.unmount();
  });

  it('drives management key keep, replace, and clear actions through the editor controls', () => {
    const originalHash = '$2a$10$existing-secret-hash';
    const hookHarness = mountUseVisualConfig();
    const patches: Array<Partial<VisualConfigValues>> = [];
    act(() => {
      expect(
        hookHarness
          .getCurrent()
          .loadVisualValuesFromYaml(
            ['remote-management:', `  secret-key: '${originalHash}'`, ''].join('\n')
          ).ok
      ).toBe(true);
    });
    const initialValues = hookHarness.getCurrent().visualValues;
    expect(initialValues.rmSecretKeyConfigured).toBe(true);
    const editorRef = createRef<{ getValues: () => VisualConfigValues }>();
    let renderer: ReactTestRenderer | null = null;

    function EditorHarness({
      harnessRef,
    }: {
      harnessRef: Ref<{ getValues: () => VisualConfigValues }>;
    }) {
      const [values, setValues] = useState(initialValues);
      useImperativeHandle(harnessRef, () => ({ getValues: () => values }), [values]);
      return createElement(VisualConfigEditor, {
        values,
        onChange: (patch: Partial<VisualConfigValues>) => {
          patches.push(patch);
          setValues((previous) => ({ ...previous, ...patch }));
        },
      });
    }

    act(() => {
      renderer = create(createElement(EditorHarness, { harnessRef: editorRef }));
    });

    const getPasswordInput = () =>
      renderer!.root.find(
        (node) =>
          typeof node.type === 'string' && node.type === 'input' && node.props.type === 'password'
      );
    const getActionButton = (labelKey: string) =>
      renderer!.root.findAllByType('button').find((button) => getRenderedText(button) === labelKey);

    expect(getPasswordInput().props.value).toBe('');
    expect(JSON.stringify(renderer!.toJSON())).not.toContain(originalHash);

    act(() => {
      getPasswordInput().props.onChange({ target: { value: '  exact replacement  ' } });
    });
    expect(patches[patches.length - 1]).toEqual({
      rmSecretKey: '  exact replacement  ',
      rmSecretKeyAction: 'replace',
    });
    expect(editorRef.current?.getValues().rmSecretKey).toBe('  exact replacement  ');
    expect(editorRef.current?.getValues().rmSecretKeyAction).toBe('replace');

    act(() => {
      getPasswordInput().props.onChange({ target: { value: '' } });
    });
    expect(patches[patches.length - 1]).toEqual({
      rmSecretKey: '',
      rmSecretKeyAction: 'unchanged',
    });
    expect(editorRef.current?.getValues().rmSecretKeyAction).toBe('unchanged');

    const clearButton = getActionButton(
      'config_management.visual.sections.remote.secret_key_clear'
    );
    expect(clearButton).toBeDefined();
    act(() => {
      clearButton!.props.onClick();
    });
    expect(patches[patches.length - 1]).toEqual({
      rmSecretKey: '',
      rmSecretKeyAction: 'clear',
    });
    expect(editorRef.current?.getValues().rmSecretKeyAction).toBe('clear');

    const keepButton = getActionButton('config_management.visual.sections.remote.secret_key_keep');
    expect(keepButton).toBeDefined();
    act(() => {
      keepButton!.props.onClick();
    });
    expect(patches[patches.length - 1]).toEqual({
      rmSecretKey: '',
      rmSecretKeyAction: 'unchanged',
    });
    expect(editorRef.current?.getValues().rmSecretKey).toBe('');
    expect(editorRef.current?.getValues().rmSecretKeyAction).toBe('unchanged');

    act(() => {
      renderer?.unmount();
    });
    hookHarness.unmount();
  });
});
