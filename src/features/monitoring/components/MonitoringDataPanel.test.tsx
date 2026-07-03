import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import styles from '@/features/monitoring/MonitoringCenterPage.module.scss';
import { MonitoringDataPanel } from './MonitoringDataPanel';

describe('MonitoringDataPanel', () => {
  const tabs = [
    { id: 'accounts' as const, label: 'Accounts', badge: 2 },
    { id: 'apiKeys' as const, label: 'Client Keys', badge: 4 },
    { id: 'realtime' as const, label: 'Realtime', badge: 10 },
  ];

  it('keeps stable tabpanel ids for every tab and renders active content only', () => {
    const markup = renderToStaticMarkup(
      <MonitoringDataPanel
        tabs={tabs}
        activeTab="apiKeys"
        onTabChange={() => {}}
        ariaLabel="Data tabs"
        actions={<button type="button">Refresh</button>}
        renderContent={(tab) => <span>{tab} content</span>}
      />
    );

    expect(markup).toContain(styles.dataPanel);
    expect(markup.match(/role="tabpanel"/g) ?? []).toHaveLength(3);
    expect(markup).toContain('id="monitoring-data-tabs-accounts-panel"');
    expect(markup).toContain('id="monitoring-data-tabs-apiKeys-panel"');
    expect(markup).toContain('id="monitoring-data-tabs-realtime-panel"');
    expect(markup).toContain('apiKeys content');
    expect(markup).not.toContain('accounts content');
    expect(markup).not.toContain('realtime content');
  });
});
