/**
 * MonitorOverlay — Dev-only floating console dashboard.
 * Shows live request status, slow/failed counts, and per-source breakdowns.
 * Toggle with Ctrl+Shift+D or click to expand/collapse.
 */

import { useState, useEffect, useCallback } from 'react';
import { monitor } from '../lib/monitor';

export function MonitorOverlay() {
  const [expanded, setExpanded] = useState(false);
  const [summary, setSummary] = useState(monitor.getSummary());

  useEffect(() => {
    const interval = setInterval(() => {
      setSummary(monitor.getSummary());
    }, 1000);
    return () => clearInterval(interval);
  }, []);

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

  const { total, failed, slow, avgMs, bySource } = summary;

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
            minWidth: 340,
            maxWidth: 480,
            maxHeight: 400,
            overflowY: 'auto',
            color: '#ccc',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={{ color: '#00ff88', fontWeight: 'bold' }}>OMNOM Monitor</span>
            <button
              onClick={handleToggle}
              style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', fontSize: 14 }}
            >
              x
            </button>
          </div>

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

          {/* Quick actions */}
          <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
            <button
              onClick={() => monitor.printSummary()}
              style={{ background: '#222', border: '1px solid #444', color: '#aaa', borderRadius: 4, padding: '2px 8px', cursor: 'pointer', fontSize: 10 }}
            >
              Print Summary
            </button>
            <button
              onClick={() => monitor.printSlow()}
              style={{ background: '#222', border: '1px solid #444', color: '#aaa', borderRadius: 4, padding: '2px 8px', cursor: 'pointer', fontSize: 10 }}
            >
              Print Slow
            </button>
            <button
              onClick={() => { monitor.clear(); setSummary(monitor.getSummary()); }}
              style={{ background: '#222', border: '1px solid #444', color: '#aaa', borderRadius: 4, padding: '2px 8px', cursor: 'pointer', fontSize: 10 }}
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
              background: failed > 0 ? '#ff4444' : slow > 0 ? '#ffaa00' : '#00ff88',
              display: 'inline-block',
            }}
          />
          <span style={{ fontSize: 10 }}>
            {total} reqs
            {failed > 0 && <span style={{ color: '#ff4444' }}> {failed}f</span>}
            {slow > 0 && <span style={{ color: '#ffaa00' }}> {slow}s</span>}
          </span>
        </button>
      )}
    </div>
  );
}
