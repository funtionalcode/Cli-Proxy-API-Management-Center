import { describe, expect, it } from 'vitest';
import { DEFAULT_ACCOUNTS_WORKSPACE_UI_STATE } from './accountsWorkspaceUiState';
import {
  readAccountsWorkspaceUrlState,
  writeAccountsWorkspaceUrlSearch,
} from './accountsWorkspaceUrlState';

describe('accountsWorkspaceUrlState', () => {
  it('reads validated workspace filters, detail deep links and OAuth editors', () => {
    const state = readAccountsWorkspaceUrlState(
      '?view=oauth&healthMode=server&search=team%2A&provider=codex&status=weekly_limited&plan=pro&quota=lt20&operation=reauth&sort=name&direction=asc&pageSize=20&display=masked&account=file.json%00auth-1&tab=diagnostics&editor=alias&editorProvider=codex',
      DEFAULT_ACCOUNTS_WORKSPACE_UI_STATE
    );

    expect(state).toMatchObject({
      view: 'oauth',
      healthMode: 'server',
      search: 'team*',
      providerFilter: 'codex',
      statusFilter: 'weekly_limited',
      planFilter: 'pro',
      quotaBandFilter: 'lt20',
      operationalFilter: 'reauth',
      accountSort: { key: 'name', direction: 'asc' },
      pageSize: 20,
      accountDisplayMode: 'masked',
      account: 'file.json\u0000auth-1',
      detailTab: 'diagnostics',
      editor: 'alias',
      editorProvider: 'codex',
    });
  });

  it('writes only non-default workspace state and preserves unrelated query params', () => {
    const search = writeAccountsWorkspaceUrlSearch(
      '?keep=1&view=value',
      {
        ...DEFAULT_ACCOUNTS_WORKSPACE_UI_STATE,
        view: 'health',
        healthMode: 'server',
        search: 'shared',
        account: 'shared.json',
        detailTab: 'quota',
        editor: null,
        editorProvider: '',
      },
      DEFAULT_ACCOUNTS_WORKSPACE_UI_STATE
    );

    expect(search).toBe(
      '?keep=1&view=health&healthMode=server&search=shared&account=shared.json&tab=quota'
    );
  });

  it('round-trips the credential configuration tab', () => {
    const search = writeAccountsWorkspaceUrlSearch(
      '',
      {
        ...DEFAULT_ACCOUNTS_WORKSPACE_UI_STATE,
        view: 'accounts',
        healthMode: 'local',
        account: 'shared.json\u0000auth-2',
        detailTab: 'config',
        editor: null,
        editorProvider: '',
      },
      DEFAULT_ACCOUNTS_WORKSPACE_UI_STATE
    );

    expect(search).toBe('?account=shared.json%00auth-2&tab=config');
    expect(
      readAccountsWorkspaceUrlState(search, DEFAULT_ACCOUNTS_WORKSPACE_UI_STATE).detailTab
    ).toBe('config');
  });

  it('migrates legacy credential-tab links to configuration', () => {
    const state = readAccountsWorkspaceUrlState(
      '?account=shared.json%00auth-2&tab=credential',
      DEFAULT_ACCOUNTS_WORKSPACE_UI_STATE
    );

    expect(state.detailTab).toBe('config');
    expect(writeAccountsWorkspaceUrlSearch('', state, DEFAULT_ACCOUNTS_WORKSPACE_UI_STATE)).toBe(
      '?account=shared.json%00auth-2&tab=config'
    );
  });

  it('falls back safely for unsupported query values', () => {
    const state = readAccountsWorkspaceUrlState(
      '?view=invalid&healthMode=remote&status=nope&quota=bad&sort=unknown&pageSize=999&tab=nope&editor=bad',
      DEFAULT_ACCOUNTS_WORKSPACE_UI_STATE
    );

    expect(state.view).toBe('accounts');
    expect(state.healthMode).toBe('local');
    expect(state.statusFilter).toBe('all');
    expect(state.quotaBandFilter).toBe('all');
    expect(state.accountSort).toEqual({ key: 'recent', direction: 'desc' });
    expect(state.pageSize).toBe(10);
    expect(state.detailTab).toBe('overview');
    expect(state.editor).toBeNull();
  });

  it('falls legacy quota and contribution views back to the credential list', () => {
    expect(
      readAccountsWorkspaceUrlState('?view=quota', DEFAULT_ACCOUNTS_WORKSPACE_UI_STATE).view
    ).toBe('accounts');
    expect(
      readAccountsWorkspaceUrlState('?view=value', DEFAULT_ACCOUNTS_WORKSPACE_UI_STATE).view
    ).toBe('accounts');
    expect(
      readAccountsWorkspaceUrlState('?view=inspection', DEFAULT_ACCOUNTS_WORKSPACE_UI_STATE)
    ).toMatchObject({ view: 'health', healthMode: 'local' });
  });

  it('round-trips the sort direction independently of local preferences', () => {
    const search = writeAccountsWorkspaceUrlSearch(
      '',
      {
        ...DEFAULT_ACCOUNTS_WORKSPACE_UI_STATE,
        view: 'accounts',
        healthMode: 'local',
        account: null,
        detailTab: 'overview',
        editor: null,
        editorProvider: '',
        accountSort: { key: 'name', direction: 'desc' },
      },
      DEFAULT_ACCOUNTS_WORKSPACE_UI_STATE
    );
    const state = readAccountsWorkspaceUrlState(search, {
      ...DEFAULT_ACCOUNTS_WORKSPACE_UI_STATE,
      accountSort: { key: 'recent', direction: 'asc' },
    });

    expect(search).toBe('?sort=name&direction=desc');
    expect(state.accountSort).toEqual({ key: 'name', direction: 'desc' });
  });

  it('round-trips precise Codex status filters', () => {
    const search = writeAccountsWorkspaceUrlSearch(
      '',
      {
        ...DEFAULT_ACCOUNTS_WORKSPACE_UI_STATE,
        view: 'accounts',
        healthMode: 'local',
        statusFilter: 'disabled_with_reset',
        account: null,
        detailTab: 'overview',
        editor: null,
        editorProvider: '',
      },
      DEFAULT_ACCOUNTS_WORKSPACE_UI_STATE
    );

    expect(search).toBe('?status=disabled_with_reset');
    expect(
      readAccountsWorkspaceUrlState(search, DEFAULT_ACCOUNTS_WORKSPACE_UI_STATE).statusFilter
    ).toBe('disabled_with_reset');
  });
});
