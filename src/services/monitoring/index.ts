/**
 * Monitoring Integration — Phase 8: Monitoring and Alerts
 *
 * React hooks and utilities for integrating the TransactionMonitor
 * with the OMNOM SWAP UI components.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  transactionMonitor,
  type Alert,
  type SwapAttempt,
  type RoutingDecision,
  type SwapStatistics,
  type PoolSnapshot,
  type AlertPriority,
} from './transactionMonitor';

// ─── useMonitoring Alertes ───────────────────────────────────────────────────

/**
 * Hook to subscribe to monitoring alerts with React state integration.
 * Automatically cleans up on unmount.
 */
export function useMonitoringAlerts(priority?: AlertPriority, maxCount = 50) {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [unacknowledgedCount, setUnacknowledgedCount] = useState(0);

  useEffect(() => {
    // Initial load
    const initialAlerts = priority
      ? transactionMonitor.getAlertsByPriority(priority)
      : transactionMonitor.getAlerts();
    setAlerts(initialAlerts.slice(-maxCount));
    setUnacknowledgedCount(transactionMonitor.getUnacknowledgedAlerts().length);

    // Subscribe to new alerts
    const unsubscribe = transactionMonitor.onAlert((alert) => {
      if (!priority || alert.priority === priority) {
        setAlerts(prev => [...prev.slice(-maxCount + 1), alert]);
      }
      setUnacknowledgedCount(transactionMonitor.getUnacknowledgedAlerts().length);
    });

    return unsubscribe;
  }, [priority, maxCount]);

  const acknowledgeAlert = useCallback((alertId: string) => {
    transactionMonitor.acknowledgeAlert(alertId);
    setUnacknowledgedCount(transactionMonitor.getUnacknowledgedAlerts().length);
  }, []);

  return {
    alerts,
    unacknowledgedCount,
    acknowledgeAlert,
  };
}

// ─── useSwapAttempts ─────────────────────────────────────────────────────────

/**
 * Hook to access swap attempt history
 */
export function useSwapAttempts() {
  const [attempts, setAttempts] = useState<SwapAttempt[]>([]);

  useEffect(() => {
    setAttempts(transactionMonitor.getSwapAttempts());

    // Poll for updates (since swaps happen outside React)
    const interval = setInterval(() => {
      setAttempts(transactionMonitor.getSwapAttempts());
    }, 2000);

    return () => clearInterval(interval);
  }, []);

  return attempts;
}

// ─── useSwapStatistics ─────────────────────────────────────────────────────────

/**
 * Hook to access aggregated swap statistics
 */
export function useSwapStatistics() {
  const [stats, setStats] = useState<SwapStatistics>(() => transactionMonitor.getStatistics());

  useEffect(() => {
    const interval = setInterval(() => {
      setStats(transactionMonitor.getStatistics());
    }, 5000);

    return () => clearInterval(interval);
  }, []);

  return stats;
}

// ─── useRoutingDecisions ─────────────────────────────────────────────────────

/**
 * Hook to access routing decision history
 */
export function useRoutingDecisions(maxCount = 20) {
  const [decisions, setDecisions] = useState<RoutingDecision[]>([]);

  useEffect(() => {
    setDecisions(transactionMonitor.getRecentRoutingDecisions(maxCount));

    const interval = setInterval(() => {
      setDecisions(transactionMonitor.getRecentRoutingDecisions(maxCount));
    }, 3000);

    return () => clearInterval(interval);
  }, [maxCount]);

  return decisions;
}

// ─── useLiquiditySnapshots ───────────────────────────────────────────────────

/**
 * Hook to access pool liquidity snapshots
 */
export function useLiquiditySnapshots(token0?: string, token1?: string) {
  const [snapshots, setSnapshots] = useState<PoolSnapshot[]>([]);

  useEffect(() => {
    const allSnapshots = transactionMonitor.getPoolSnapshots();
    const filtered = token0 && token1
      ? allSnapshots.filter(s =>
          (s.token0 === token0 && s.token1 === token1) ||
          (s.token0 === token1 && s.token1 === token0)
        )
      : allSnapshots;
    setSnapshots(filtered.slice(-100));

    const interval = setInterval(() => {
      const snaps = transactionMonitor.getPoolSnapshots();
      const filt = token0 && token1
        ? snaps.filter(s =>
            (s.token0 === token0 && s.token1 === token1) ||
            (s.token0 === token1 && s.token1 === token0)
          )
        : snaps;
      setSnapshots(filt.slice(-100));
    }, 10000);

    return () => clearInterval(interval);
  }, [token0, token1]);

  return snapshots;
}

// ─── useTVLTrend ─────────────────────────────────────────────────────────────

/**
 * Hook to get TVL trend for a token pair (for charts)
 */
export function useTVLTrend(token0: string, token1: string, points = 20) {
  return useMemo(() => {
    return transactionMonitor.getTVLTrend(token0, token1, points);
  }, [token0, token1, points]);
}

// ─── useLiquidityAlert ───────────────────────────────────────────────────────

/**
 * Hook to monitor liquidity for a specific pair and get threshold alerts
 */
export function useLiquidityAlert(token0: string, token1: string) {
  const [tvl, setTvl] = useState(0);
  const [trend, setTrend] = useState<{ tvl: number; timestamp: number }[]>([]);
  const [isLowLiquidity, setIsLowLiquidity] = useState(false);

  useEffect(() => {
    const updateTVL = () => {
      const currentTVL = transactionMonitor.getPairTVL(token0, token1);
      const currentTrend = transactionMonitor.getTVLTrend(token0, token1, 20);
      setTvl(currentTVL);
      setTrend(currentTrend);
      setIsLowLiquidity(currentTVL < 5000); // Low threshold
    };

    updateTVL();
    const interval = setInterval(updateTVL, 15000);

    return () => clearInterval(interval);
  }, [token0, token1]);

  return { tvl, trend, isLowLiquidity };
}

// ─── useCriticalAlerts ───────────────────────────────────────────────────────

/**
 * Hook specifically for critical alerts that need immediate attention
 */
export function useCriticalAlerts() {
  const [criticalAlerts, setCriticalAlerts] = useState<Alert[]>([]);

  useEffect(() => {
    const updateCritical = () => {
      const alerts = transactionMonitor.getAlertsByPriority('critical');
      setCriticalAlerts(alerts.slice(-10));
    };

    updateCritical();
    const interval = setInterval(updateCritical, 2000);

    return () => clearInterval(interval);
  }, []);

  return criticalAlerts;
}

// ─── Debug Helpers ───────────────────────────────────────────────────────────

/**
 * Expose monitoring instance to window for debugging
 */
if (typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).__OMNOM_MONITOR = {
    getSwapAttempts: () => transactionMonitor.getSwapAttempts(),
    getRoutingDecisions: () => transactionMonitor.getRoutingDecisions(),
    getPoolSnapshots: () => transactionMonitor.getPoolSnapshots(),
    getAlerts: () => transactionMonitor.getAlerts(),
    getStatistics: () => transactionMonitor.getStatistics(),
    getPairTVL: (t0: string, t1: string) => transactionMonitor.getPairTVL(t0, t1),
    clearAllData: () => transactionMonitor.clearAllData(),
  };

  console.log(
    '%c[OMNOM Monitor] Transaction monitoring installed. Use window.__OMNOM_MONITOR for inspection.',
    'color: #00ff88; font-weight: bold'
  );
}
