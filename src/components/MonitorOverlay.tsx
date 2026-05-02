/**
 * MonitorOverlay — Dev-only floating console dashboard.
 * Shows live request status, slow/failed counts, per-source breakdowns,
 * plus Phase 8 transaction monitoring data (swap stats, alerts, routing decisions).
 *
 * Toggle with Ctrl+Shift+D or click to expand/collapse.
 */

import { useState, useEffect, useCallback } from 'react';
import { monitor } from '../lib/monitor';
import {
  useSwapStatistics,
  useMonitoringAlerts,
  useRoutingDecisions,
} from '../services/monitoring';

// ─── Tab Components ───────────────────────────────────────────────────────────

function NetworkTab() {
  const [summary, setSummary] = useState(monitor.getSummary());

  useEffect(() => {
    const interval = setInterval(() => {
      setSummary(monitor.getSummary());
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const { total, failed, slow, avgMs, bySource } = summary;

  return (
    <div>
      {/* Summary row */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 10, flexWrap: 'wrap' }}>
        <span>
          <span style={{ color: '#88aaff' }}>{total}</span> reqs
        </span>
        <span>
          <span style={{ color: failed > 0 ? '#ff4444' : '#00ff88' }}>{failed}</span> failed
        </span>
        <span>
          <span style={{ color: slow > 0 ? '#ffaa00' : '#00ff88' }}>{slow}</span> slow
        </span>
        <span>
          avg <span style={{ color: avgMs > 2000 ? '#ff4444' : avgMs > 500 ? '#ffaa00' : '#00ff88' }}>{avgMs}ms</span>
        </span>
      </div>

      {/* Per-source breakdown */}
      {Object.entries(bySource).length > 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 8 }}>
          <thead>
            <tr style={{ color: '#666', borderBottom: '1px solid #333' }}>
              <th style={{ textAlign: 'left', padding: '2px 6px' }}>Source</th>
              <th style={{ textAlign: 'right', padding: '2px 6px' }}>Count</th>
              <th style={{ textAlign: 'right', padding: '2px 6px' }}>Avg</th>
              <th style={{ textAlign: 'right', padding: '2px 6px' }}>Fail</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(bySource).map(([source, data]) => (
              <tr key={source} style={{ borderBottom: '1px solid #222' }}>
                <td style={{ padding: '2px 6px', color: '#88aaff' }}>{source}</td>
                <td style={{ textAlign: 'right', padding: '2px 6px' }}>{data.count}</td>
                <td style={{
                  textAlign: 'right',
                  padding: '2px 6px',
                  color: data.avgMs > 2000 ? '#ff4444' : data.avgMs > 500 ? '#ffaa00' : '#00ff88',
                }}>
                  {data.avgMs}ms
                </td>
                <td style={{
                  textAlign: 'right',
                  padding: '2px 6px',
                  color: data.failed > 0 ? '#ff4444' : '#666',
                }}>
                  {data.failed}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function SwapsTab() {
  const stats = useSwapStatistics();

  return (
    <div>
      {/* Success rate */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ color: '#666', marginBottom: 4 }}>Success Rate</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{
            flex: 1,
            height: 8,
            background: '#222',
            borderRadius: 4,
            overflow: 'hidden',
          }}>
            <div style={{
              width: `${stats.successRate}%`,
              height: '100%',
              background: stats.successRate > 90 ? '#00ff88' : stats.successRate > 70 ? '#ffaa00' : '#ff4444',
              transition: 'width 0.3s',
            }} />
          </div>
          <span style={{ color: stats.successRate > 90 ? '#00ff88' : stats.successRate > 70 ? '#ffaa00' : '#ff4444', fontSize: 12 }}>
            {stats.successRate.toFixed(1)}%
          </span>
        </div>
      </div>

      {/* Stats grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
        <div style={{ background: '#1a1a1a', borderRadius: 4, padding: 8 }}>
          <div style={{ color: '#666', fontSize: 10 }}>Total Attempts</div>
          <div style={{ color: '#88aaff', fontSize: 16, fontWeight: 'bold' }}>{stats.totalAttempts}</div>
        </div>
        <div style={{ background: '#1a1a1a', borderRadius: 4, padding: 8 }}>
          <div style={{ color: '#666', fontSize: 10 }}>Successful</div>
          <div style={{ color: '#00ff88', fontSize: 16, fontWeight: 'bold' }}>{stats.successfulAttempts}</div>
        </div>
        <div style={{ background: '#1a1a1a', borderRadius: 4, padding: 8 }}>
          <div style={{ color: '#666', fontSize: 10 }}>Failed</div>
          <div style={{ color: '#ff4444', fontSize: 16, fontWeight: 'bold' }}>{stats.failedAttempts}</div>
        </div>
        <div style={{ background: '#1a1a1a', borderRadius: 4, padding: 8 }}>
          <div style={{ color: '#666', fontSize: 10 }}>Reverted</div>
          <div style={{ color: '#ffaa00', fontSize: 16, fontWeight: 'bold' }}>{stats.revertedAttempts}</div>
        </div>
      </div>

      {/* Routing time */}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
        <span style={{ color: '#666' }}>Avg Routing Time</span>
        <span style={{ color: stats.averageRoutingTimeMs > 500 ? '#ffaa00' : '#00ff88' }}>
          {stats.averageRoutingTimeMs}ms
        </span>
      </div>

      {/* Top failure reasons */}
      {Object.keys(stats.failureReasons).length > 0 && (
        <div>
          <div style={{ color: '#666', marginBottom: 4 }}>Failure Reasons</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {Object.entries(stats.failureReasons).slice(0, 5).map(([reason, count]) => (
              <div key={reason} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10 }}>
                <span style={{ color: '#888' }}>{reason}</span>
                <span style={{ color: '#ff4444' }}>{count}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function AlertsTab() {
  const { alerts, unacknowledgedCount } = useMonitoringAlerts(undefined, 50);

  if (alerts.length === 0) {
    return (
      <div style={{ color: '#666', textAlign: 'center', padding: 20 }}>
        No alerts
      </div>
    );
  }

  return (
    <div style={{ maxHeight: 300, overflowY: 'auto' }}>
      {unacknowledgedCount > 0 && (
        <div style={{ color: '#ff4444', marginBottom: 8, fontSize: 10 }}>
          {unacknowledgedCount} unacknowledged
        </div>
      )}
      {alerts.slice().reverse().map((alert) => (
        <div
          key={alert.id}
          style={{
            background: alert.acknowledged ? '#1a1a1a' : '#2a1a1a',
            borderLeft: `3px solid ${
              alert.priority === 'critical' ? '#ff4444' :
              alert.priority === 'warning' ? '#ffaa00' : '#00ff88'
            }`,
            padding: '6px 8px',
            marginBottom: 4,
            borderRadius: '0 4px 4px 0',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <span style={{
              color: alert.priority === 'critical' ? '#ff4444' : alert.priority === 'warning' ? '#ffaa00' : '#00ff88',
              fontSize: 10,
              fontWeight: 'bold',
            }}>
              {alert.title}
            </span>
            <span style={{ color: '#666', fontSize: 9 }}>
              {new Date(alert.timestamp).toLocaleTimeString()}
            </span>
          </div>
          <div style={{ color: '#888', fontSize: 10, marginTop: 2 }}>
            {alert.message}
          </div>
          {alert.txHash && (
            <div style={{ color: '#666', fontSize: 9, marginTop: 2 }}>
              TX: {alert.txHash.slice(0, 10)}...
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function RoutingTab() {
  const decisions = useRoutingDecisions(20);

  if (decisions.length === 0) {
    return (
      <div style={{ color: '#666', textAlign: 'center', padding: 20 }}>
        No routing decisions logged
      </div>
    );
  }

  return (
    <div style={{ maxHeight: 300, overflowY: 'auto' }}>
      {decisions.slice().reverse().map((decision) => (
        <div
          key={decision.id}
          style={{
            background: '#1a1a1a',
            padding: '8px',
            marginBottom: 4,
            borderRadius: 4,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
            <span style={{ color: '#88aaff', fontSize: 10 }}>
              {decision.tokenIn.slice(0, 8)}... → {decision.tokenOut.slice(0, 8)}...
            </span>
            <span style={{ color: '#666', fontSize: 9 }}>
              {new Date(decision.timestamp).toLocaleTimeString()}
            </span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10 }}>
            <span style={{ color: '#888' }}>
              {decision.availableRoutes.length} routes | {decision.poolsCount} pools
            </span>
            <span style={{ color: decision.routingTimeMs > 500 ? '#ffaa00' : '#00ff88' }}>
              {decision.routingTimeMs}ms
            </span>
          </div>
          {decision.selectedRoute && (
            <div style={{ color: '#00ff88', fontSize: 9, marginTop: 2 }}>
              Selected: {decision.selectedRoute.routeType} | Output: {(Number(decision.selectedRoute.totalExpectedOut) / Number(1e18)).toFixed(4)}
            </div>
          )}
          {decision.error && (
            <div style={{ color: '#ff4444', fontSize: 9, marginTop: 2 }}>
              Error: {decision.error}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

type Tab = 'network' | 'swaps' | 'alerts' | 'routing';

export function MonitorOverlay() {
  const [expanded, setExpanded] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>('network');

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'D') {
        e.preventDefault();
        setExpanded(prev => !prev);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const handleToggle = useCallback(() => setExpanded(prev => !prev), []);

  if (!monitor.enabled) return null;

  // Get counts for tab badges
  const { unacknowledgedCount: alertCount } = useMonitoringAlerts(undefined, 100);
  const stats = useSwapStatistics();
  const hasCritical = stats.failedAttempts > 0 || stats.revertedAttempts > 0;

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 12,
        right: 12,
        zIndex: 99999,
        fontFamily: 'monospace',
        fontSize: 11,
        lineHeight: 1.4,
        userSelect: 'none',
      }}
    >
      {expanded ? (
        <div
          style={{
            background: 'rgba(15, 15, 20, 0.95)',
            border: '1px solid rgba(255,255,255,0.15)',
            borderRadius: 8,
            padding: 12,
            minWidth: 400,
            maxWidth: 520,
            maxHeight: 500,
            overflowY: 'auto',
            color: '#ccc',
          }}
        >
          {/* Header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
            <span style={{ color: '#00ff88', fontWeight: 'bold' }}>OMNOM Monitor</span>
            <button
              onClick={handleToggle}
              style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', fontSize: 14 }}
            >
              x
            </button>
          </div>

          {/* Tab bar */}
          <div style={{ display: 'flex', gap: 4, marginBottom: 12, borderBottom: '1px solid #333', paddingBottom: 8 }}>
            {(['network', 'swaps', 'alerts', 'routing'] as Tab[]).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                style={{
                  background: activeTab === tab ? '#222' : 'transparent',
                  border: '1px solid',
                  borderColor: activeTab === tab ? '#00ff88' : '#333',
                  borderRadius: 4,
                  padding: '4px 8px',
                  color: activeTab === tab ? '#00ff88' : '#888',
                  cursor: 'pointer',
                  fontSize: 10,
                  textTransform: 'capitalize',
                }}
              >
                {tab}
                {tab === 'alerts' && alertCount > 0 && (
                  <span style={{ color: '#ff4444', marginLeft: 4 }}>({alertCount})</span>
                )}
              </button>
            ))}
          </div>

          {/* Tab content */}
          <div style={{ minHeight: 200 }}>
            {activeTab === 'network' && <NetworkTab />}
            {activeTab === 'swaps' && <SwapsTab />}
            {activeTab === 'alerts' && <AlertsTab />}
            {activeTab === 'routing' && <RoutingTab />}
          </div>

          {/* Quick actions */}
          <div style={{ display: 'flex', gap: 8, marginTop: 12, paddingTop: 8, borderTop: '1px solid #333' }}>
            <button
              onClick={() => monitor.printSummary()}
              style={{ background: '#222', border: '1px solid #444', color: '#aaa', borderRadius: 4, padding: '4px 8px', cursor: 'pointer', fontSize: 10 }}
            >
              Print Summary
            </button>
            <button
              onClick={() => monitor.printSlow()}
              style={{ background: '#222', border: '1px solid #444', color: '#aaa', borderRadius: 4, padding: '4px 8px', cursor: 'pointer', fontSize: 10 }}
            >
              Print Slow
            </button>
            <button
              onClick={() => { monitor.clear(); }}
              style={{ background: '#222', border: '1px solid #444', color: '#aaa', borderRadius: 4, padding: '4px 8px', cursor: 'pointer', fontSize: 10 }}
            >
              Clear
            </button>
          </div>
        </div>
      ) : (
        /* Collapsed pill */
        <button
          onClick={handleToggle}
          style={{
            background: 'rgba(15, 15, 20, 0.85)',
            border: '1px solid rgba(255,255,255,0.15)',
            borderRadius: 20,
            padding: '4px 10px',
            color: '#00ff88',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: hasCritical ? '#ff4444' : alertCount > 0 ? '#ffaa00' : '#00ff88',
              display: 'inline-block',
            }}
          />
          <span style={{ fontSize: 10 }}>
            Monitor
            {alertCount > 0 && <span style={{ color: '#ff4444' }}> {alertCount}a</span>}
          </span>
        </button>
      )}
    </div>
  );
}
