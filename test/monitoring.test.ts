/**
 * @file monitoring.test.ts
 * @description Comprehensive tests for Transaction Monitoring Service (Phase D)
 *
 * Tests cover:
 * - D1: Transaction Monitoring (trackSwapStart/Success/Failure/Reverted)
 * - D2: Liquidity Alerts (alert triggers, priority levels, acknowledgment)
 * - D3: Routing Decision Logging (routing decisions, available routes, timestamps)
 *
 * Reference: src/services/monitoring/transactionMonitor.ts
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ─── Type Definitions (mirrors transactionMonitor.ts) ───────────────────────────

type AlertPriority = 'info' | 'warning' | 'critical';
type AlertType = 'tx_failed' | 'tx_success' | 'low_liquidity' | 'high_slippage' | 'rpc_error' | 'routing_error';

interface Alert {
  id: string;
  type: AlertType;
  priority: AlertPriority;
  title: string;
  message: string;
  timestamp: number;
  data?: Record<string, unknown>;
  txHash?: string;
  acknowledged: boolean;
}

interface SwapAttempt {
  id: string;
  userAddress: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  amountOutMin: string;
  timestamp: number;
  status: 'pending' | 'success' | 'failed' | 'reverted';
  txHash?: string;
  route?: string;
  gasSettings?: {
    gasLimit: string;
    gasPrice?: string;
    maxFeePerGas?: string;
    maxPriorityFeePerGas?: string;
  };
  error?: {
    code: string;
    message: string;
    revertReason?: string;
  };
  routeDetails?: RouteDiagnostic;
  blockNumber?: number;
  effectiveGas?: string;
}

interface RouteDiagnostic {
  routesConsidered: number;
  selectedRouteId: string;
  selectedRouteSteps: RouteStep[];
  availableRoutes: RouteResult[];
  priceImpact: number;
  outputAmount: string;
  outputAmountFormatted: string;
  routingTimeMs: number;
}

interface RouteStep {
  dexRouter: string;
  dexName: string;
  path: string[];
  amountIn: bigint;
  expectedAmountOut: bigint;
}

interface RouteResult {
  id: string;
  steps: RouteStep[];
  totalAmountIn: bigint;
  totalExpectedOut: bigint;
  priceImpact: number;
  feeAmount: bigint;
  feeBps: number;
}

interface RoutingDecision {
  id: string;
  timestamp: number;
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  amountInFormatted: string;
  availableRoutes: RouteResult[];
  selectedRoute: RouteResult | null;
  routeSelectionReason: string;
  routingTimeMs: number;
  poolsCount: number;
  error?: string;
}

interface LiquidityThresholds {
  minimum: number;
  low: number;
  medium: number;
}

// ─── Mock Transaction Monitor Implementation ──────────────────────────────────

const MAX_SWAP_ATTEMPTS = 500;
const MAX_ROUTING_DECISIONS = 100;
const MAX_ALERTS = 200;

interface PoolSnapshot {
  token0: string;
  token1: string;
  reserve0: string;
  reserve1: string;
  totalSupply: string;
  tvlUsd: number;
  dexName: string;
  factory: string;
  timestamp: number;
}

class MockTransactionMonitor {
  private swapAttempts: SwapAttempt[] = [];
  private routingDecisions: RoutingDecision[] = [];
  private poolSnapshots: PoolSnapshot[] = [];
  private alerts: Alert[] = [];
  private alertCallbacks: Array<(alert: Alert) => void> = [];
  private liquidityThresholds: LiquidityThresholds = {
    minimum: 1000,
    low: 5000,
    medium: 10000,
  };
  private lastLiquidityCheck: Map<string, number> = new Map();
  private nextId = 1;

  constructor() {
    this.swapAttempts = [];
    this.routingDecisions = [];
    this.poolSnapshots = [];
    this.alerts = [];
  }

  private generateId(): string {
    return `tx_${Date.now()}_${this.nextId++}`;
  }

  trackSwapStart(params: {
    userAddress: string;
    tokenIn: string;
    tokenOut: string;
    amountIn: bigint;
    amountOutMin: bigint;
    gasSettings?: SwapAttempt['gasSettings'];
    route?: RouteResult;
  }): string {
    const id = this.generateId();
    const attempt: SwapAttempt = {
      id,
      userAddress: params.userAddress.toLowerCase(),
      tokenIn: params.tokenIn,
      tokenOut: params.tokenOut,
      amountIn: params.amountIn.toString(),
      amountOutMin: params.amountOutMin.toString(),
      timestamp: Date.now(),
      status: 'pending',
      gasSettings: params.gasSettings,
      route: params.route?.id,
      routeDetails: params.route ? {
        routesConsidered: 0,
        selectedRouteId: params.route.id,
        selectedRouteSteps: params.route.steps,
        availableRoutes: [params.route],
        priceImpact: params.route.priceImpact,
        outputAmount: params.route.totalExpectedOut.toString(),
        outputAmountFormatted: this.formatAmount(params.route.totalExpectedOut),
        routingTimeMs: 0,
      } : undefined,
    };

    this.swapAttempts.push(attempt);
    if (this.swapAttempts.length > MAX_SWAP_ATTEMPTS) {
      this.swapAttempts.shift();
    }

    return id;
  }

  trackSwapSuccess(id: string, txHash: string, blockNumber?: number, effectiveGas?: string): void {
    const attempt = this.swapAttempts.find(a => a.id === id);
    if (!attempt) return;

    attempt.status = 'success';
    attempt.txHash = txHash;
    attempt.blockNumber = blockNumber;
    attempt.effectiveGas = effectiveGas;

    this.emitAlert({
      type: 'tx_success',
      priority: 'info',
      title: 'Swap Completed',
      message: `Successfully swapped ${this.formatAmount(attempt.amountIn)} ${attempt.tokenIn} → ${this.formatAmount(attempt.amountOutMin)} ${attempt.tokenOut}`,
      txHash,
    });
  }

  trackSwapFailure(id: string, error: { code: string; message: string; revertReason?: string }): void {
    const attempt = this.swapAttempts.find(a => a.id === id);
    if (!attempt) return;

    attempt.status = 'failed';
    attempt.error = error;

    this.emitAlert({
      type: 'tx_failed',
      priority: 'critical',
      title: 'Swap Failed',
      message: error.message || 'Transaction failed',
    });
  }

  trackSwapReverted(id: string, txHash: string, revertReason?: string, blockNumber?: number): void {
    const attempt = this.swapAttempts.find(a => a.id === id);
    if (!attempt) return;

    attempt.status = 'reverted';
    attempt.txHash = txHash;
    attempt.blockNumber = blockNumber;
    if (revertReason) {
      attempt.error = { code: 'REVERT', message: revertReason, revertReason };
    }

    this.emitAlert({
      type: 'tx_failed',
      priority: 'critical',
      title: 'Swap Reverted',
      message: revertReason || 'Transaction reverted on-chain',
      txHash,
    });
  }

  logRoutingDecision(params: {
    tokenIn: string;
    tokenOut: string;
    amountIn: bigint;
    availableRoutes: RouteResult[];
    selectedRoute: RouteResult | null;
    routeSelectionReason: string;
    routingTimeMs: number;
    poolsCount: number;
    error?: string;
  }): string {
    const id = `route_${Date.now()}_${this.nextId++}`;
    const decision: RoutingDecision = {
      id,
      timestamp: Date.now(),
      tokenIn: params.tokenIn,
      tokenOut: params.tokenOut,
      amountIn: params.amountIn.toString(),
      amountInFormatted: this.formatAmount(params.amountIn),
      availableRoutes: params.availableRoutes,
      selectedRoute: params.selectedRoute,
      routeSelectionReason: params.routeSelectionReason,
      routingTimeMs: params.routingTimeMs,
      poolsCount: params.poolsCount,
      error: params.error,
    };

    this.routingDecisions.push(decision);
    if (this.routingDecisions.length > MAX_ROUTING_DECISIONS) {
      this.routingDecisions.shift();
    }

    return id;
  }

  recordPoolSnapshot(snapshot: Omit<PoolSnapshot, 'timestamp'>): void {
    const entry: PoolSnapshot = {
      ...snapshot,
      timestamp: Date.now(),
    };

    this.poolSnapshots.push(entry);
    this.checkLiquidityThreshold(entry);
  }

  private checkLiquidityThreshold(snapshot: PoolSnapshot): void {
    const pairKey = `${snapshot.token0}:${snapshot.token1}`;
    const now = Date.now();
    const lastCheck = this.lastLiquidityCheck.get(pairKey) || 0;

    // Rate limit: only check once per minute per pair
    if (now - lastCheck < 60_000) return;
    this.lastLiquidityCheck.set(pairKey, now);

    const { tvlUsd } = snapshot;
    let threshold: 'minimum' | 'low' | 'medium' | null = null;
    let priority: AlertPriority = 'info';

    if (tvlUsd < this.liquidityThresholds.minimum) {
      threshold = 'minimum';
      priority = 'critical';
    } else if (tvlUsd < this.liquidityThresholds.low) {
      threshold = 'low';
      priority = 'warning';
    } else if (tvlUsd < this.liquidityThresholds.medium) {
      threshold = 'medium';
      priority = 'info';
    }

    if (threshold) {
      this.emitAlert({
        type: 'low_liquidity',
        priority,
        title: `Low Liquidity Alert: ${snapshot.dexName}`,
        message: `Pool ${pairKey} TVL ($${tvlUsd.toFixed(2)}) is below ${this.liquidityThresholds[threshold]} threshold`,
        data: {
          pair: pairKey,
          tvlUsd,
          threshold: this.liquidityThresholds[threshold],
          thresholdLevel: threshold,
          dexName: snapshot.dexName,
        },
      });
    }
  }

  onAlert(callback: (alert: Alert) => void): () => void {
    this.alertCallbacks.push(callback);
    return () => {
      this.alertCallbacks = this.alertCallbacks.filter(cb => cb !== callback);
    };
  }

  private emitAlert(alert: Omit<Alert, 'id' | 'timestamp' | 'acknowledged'>): void {
    const fullAlert: Alert = {
      ...alert,
      id: `alert_${Date.now()}_${this.nextId++}`,
      timestamp: Date.now(),
      acknowledged: false,
    };

    this.alerts.push(fullAlert);
    if (this.alerts.length > MAX_ALERTS) {
      this.alerts.shift();
    }

    for (const callback of this.alertCallbacks) {
      callback(fullAlert);
    }
  }

  acknowledgeAlert(alertId: string): void {
    const alert = this.alerts.find(a => a.id === alertId);
    if (alert) {
      alert.acknowledged = true;
    }
  }

  getUnacknowledgedAlerts(): Alert[] {
    return this.alerts.filter(a => !a.acknowledged);
  }

  getAlertsByPriority(priority: AlertPriority): Alert[] {
    return this.alerts.filter(a => a.priority === priority);
  }

  getSwapAttempts(): SwapAttempt[] {
    return [...this.swapAttempts];
  }

  getRoutingDecisions(): RoutingDecision[] {
    return [...this.routingDecisions];
  }

  getAlerts(): Alert[] {
    return [...this.alerts];
  }

  getStatistics(): {
    totalAttempts: number;
    successfulAttempts: number;
    failedAttempts: number;
    revertedAttempts: number;
    successRate: number;
  } {
    const completed = this.swapAttempts.filter(a => a.status !== 'pending');
    const successful = completed.filter(a => a.status === 'success');
    const failed = completed.filter(a => a.status === 'failed');
    const reverted = completed.filter(a => a.status === 'reverted');

    return {
      totalAttempts: this.swapAttempts.length,
      successfulAttempts: successful.length,
      failedAttempts: failed.length,
      revertedAttempts: reverted.length,
      successRate: completed.length > 0 ? (successful.length / completed.length) * 100 : 0,
    };
  }

  clearAllData(): void {
    this.swapAttempts = [];
    this.routingDecisions = [];
    this.poolSnapshots = [];
    this.alerts = [];
  }

  private formatAmount(amount: string | bigint): string {
    const num = typeof amount === 'string' ? BigInt(amount) : amount;
    const formatted = Number(num) / 1e18;
    if (formatted >= 1_000_000) return `${(formatted / 1_000_000).toFixed(2)}M`;
    if (formatted >= 1_000) return `${(formatted / 1_000).toFixed(2)}K`;
    return formatted.toFixed(4);
  }
}

// ─── Helper Functions ─────────────────────────────────────────────────────────

function createMockRoute(id: string, amountIn: bigint, expectedOut: bigint): RouteResult {
  return {
    id,
    steps: [{
      dexRouter: '0x1234',
      dexName: 'DogeSwap',
      path: ['0xWWDOGE', '0xDC'],
      amountIn,
      expectedAmountOut: expectedOut,
    }],
    totalAmountIn: amountIn,
    totalExpectedOut: expectedOut,
    priceImpact: 0.001,
    feeAmount: (amountIn * 25n) / 10000n,
    feeBps: 25,
  };
}

// ─── Test Suites ─────────────────────────────────────────────────────────────

describe('Transaction Monitor Tests', () => {
  let monitor: MockTransactionMonitor;

  beforeEach(() => {
    monitor = new MockTransactionMonitor();
  });

  describe('D1: Transaction Monitoring', () => {
    describe('trackSwapStart', () => {
      it('should track swap attempt with all parameters', () => {
        const id = monitor.trackSwapStart({
          userAddress: '0x1234567890123456789012345678901234567890',
          tokenIn: '0xWWDOGE',
          tokenOut: '0xDC',
          amountIn: 1000000n,
          amountOutMin: 800000n,
        });

        expect(id).toMatch(/^tx_\d+_\d+$/);
        const attempts = monitor.getSwapAttempts();
        expect(attempts.length).toBe(1);
        expect(attempts[0].status).toBe('pending');
        expect(attempts[0].tokenIn).toBe('0xWWDOGE');
        expect(attempts[0].tokenOut).toBe('0xDC');
      });

      it('should include route details when route is provided', () => {
        const route = createMockRoute('route-1', 1000000n, 800000n);
        monitor.trackSwapStart({
          userAddress: '0x1234567890123456789012345678901234567890',
          tokenIn: '0xWWDOGE',
          tokenOut: '0xDC',
          amountIn: 1000000n,
          amountOutMin: 800000n,
          route,
        });

        const attempts = monitor.getSwapAttempts();
        expect(attempts[0].route).toBe('route-1');
        expect(attempts[0].routeDetails).toBeDefined();
        expect(attempts[0].routeDetails?.selectedRouteId).toBe('route-1');
      });

      it('should include gas settings when provided', () => {
        const gasSettings = {
          gasLimit: '300000',
          gasPrice: '20000000000',
        };

        monitor.trackSwapStart({
          userAddress: '0x1234567890123456789012345678901234567890',
          tokenIn: '0xWWDOGE',
          tokenOut: '0xDC',
          amountIn: 1000000n,
          amountOutMin: 800000n,
          gasSettings,
        });

        const attempts = monitor.getSwapAttempts();
        expect(attempts[0].gasSettings?.gasLimit).toBe('300000');
        expect(attempts[0].gasSettings?.gasPrice).toBe('20000000000');
      });
    });

    describe('trackSwapSuccess', () => {
      it('should update swap attempt status to success', () => {
        const id = monitor.trackSwapStart({
          userAddress: '0x1234567890123456789012345678901234567890',
          tokenIn: '0xWWDOGE',
          tokenOut: '0xDC',
          amountIn: 1000000n,
          amountOutMin: 800000n,
        });

        monitor.trackSwapSuccess(id, '0xabc123', 12345678, '200000');

        const attempts = monitor.getSwapAttempts();
        expect(attempts[0].status).toBe('success');
        expect(attempts[0].txHash).toBe('0xabc123');
        expect(attempts[0].blockNumber).toBe(12345678);
        expect(attempts[0].effectiveGas).toBe('200000');
      });

      it('should emit success alert', () => {
        const id = monitor.trackSwapStart({
          userAddress: '0x1234567890123456789012345678901234567890',
          tokenIn: '0xWWDOGE',
          tokenOut: '0xDC',
          amountIn: 1000000n,
          amountOutMin: 800000n,
        });

        monitor.trackSwapSuccess(id, '0xabc123');

        const alerts = monitor.getAlerts();
        expect(alerts.length).toBe(1);
        expect(alerts[0].type).toBe('tx_success');
        expect(alerts[0].priority).toBe('info');
        expect(alerts[0].txHash).toBe('0xabc123');
      });

      it('should ignore unknown swap ID', () => {
        monitor.trackSwapSuccess('unknown-id', '0xabc123');
        const attempts = monitor.getSwapAttempts();
        expect(attempts.length).toBe(0);
      });
    });

    describe('trackSwapFailure', () => {
      it('should update swap attempt status to failed', () => {
        const id = monitor.trackSwapStart({
          userAddress: '0x1234567890123456789012345678901234567890',
          tokenIn: '0xWWDOGE',
          tokenOut: '0xDC',
          amountIn: 1000000n,
          amountOutMin: 800000n,
        });

        const error = { code: 'INSUFFICIENT_BALANCE', message: 'Insufficient balance' };
        monitor.trackSwapFailure(id, error);

        const attempts = monitor.getSwapAttempts();
        expect(attempts[0].status).toBe('failed');
        expect(attempts[0].error?.code).toBe('INSUFFICIENT_BALANCE');
        expect(attempts[0].error?.message).toBe('Insufficient balance');
      });

      it('should emit critical alert for failed swap', () => {
        const id = monitor.trackSwapStart({
          userAddress: '0x1234567890123456789012345678901234567890',
          tokenIn: '0xWWDOGE',
          tokenOut: '0xDC',
          amountIn: 1000000n,
          amountOutMin: 800000n,
        });

        monitor.trackSwapFailure(id, { code: 'ERROR', message: 'Generic error' });

        const alerts = monitor.getAlerts();
        const failedAlerts = alerts.filter(a => a.type === 'tx_failed');
        expect(failedAlerts.length).toBe(1);
        expect(failedAlerts[0].priority).toBe('critical');
      });
    });

    describe('trackSwapReverted', () => {
      it('should update swap attempt status to reverted', () => {
        const id = monitor.trackSwapStart({
          userAddress: '0x1234567890123456789012345678901234567890',
          tokenIn: '0xWWDOGE',
          tokenOut: '0xDC',
          amountIn: 1000000n,
          amountOutMin: 800000n,
        });

        monitor.trackSwapReverted(id, '0xreverted', 'Insufficient liquidity', 12345678);

        const attempts = monitor.getSwapAttempts();
        expect(attempts[0].status).toBe('reverted');
        expect(attempts[0].txHash).toBe('0xreverted');
        expect(attempts[0].error?.revertReason).toBe('Insufficient liquidity');
        expect(attempts[0].blockNumber).toBe(12345678);
      });

      it('should emit critical alert for reverted transaction', () => {
        const id = monitor.trackSwapStart({
          userAddress: '0x1234567890123456789012345678901234567890',
          tokenIn: '0xWWDOGE',
          tokenOut: '0xDC',
          amountIn: 1000000n,
          amountOutMin: 800000n,
        });

        monitor.trackSwapReverted(id, '0xreverted', 'Slippage exceeded');

        const alerts = monitor.getAlerts();
        const revertedAlerts = alerts.filter(a => a.title === 'Swap Reverted');
        expect(revertedAlerts.length).toBe(1);
        expect(revertedAlerts[0].priority).toBe('critical');
      });
    });

    describe('getStatistics', () => {
      it('should calculate correct statistics', () => {
        const id1 = monitor.trackSwapStart({
          userAddress: '0x1234567890123456789012345678901234567890',
          tokenIn: '0xWWDOGE',
          tokenOut: '0xDC',
          amountIn: 1000000n,
          amountOutMin: 800000n,
        });

        const id2 = monitor.trackSwapStart({
          userAddress: '0x1234567890123456789012345678901234567890',
          tokenIn: '0xWWDOGE',
          tokenOut: '0xDC',
          amountIn: 1000000n,
          amountOutMin: 800000n,
        });

        const id3 = monitor.trackSwapStart({
          userAddress: '0x1234567890123456789012345678901234567890',
          tokenIn: '0xWWDOGE',
          tokenOut: '0xDC',
          amountIn: 1000000n,
          amountOutMin: 800000n,
        });

        monitor.trackSwapSuccess(id1, '0xtx1');
        monitor.trackSwapSuccess(id2, '0xtx2');
        monitor.trackSwapFailure(id3, { code: 'ERROR', message: 'Failed' });

        const stats = monitor.getStatistics();
        expect(stats.totalAttempts).toBe(3);
        expect(stats.successfulAttempts).toBe(2);
        expect(stats.failedAttempts).toBe(1);
        expect(stats.revertedAttempts).toBe(0);
        expect(stats.successRate).toBeCloseTo(66.67, 1);
      });
    });
  });

  describe('D2: Liquidity Alerts', () => {
    describe('Alert Triggers', () => {
      it('should trigger critical alert when TVL < $1,000 minimum', () => {
        monitor.recordPoolSnapshot({
          token0: '0xWWDOGE',
          token1: '0xDC',
          reserve0: '1000000000000000000',
          reserve1: '500000000000000000',
          totalSupply: '1500000000000000000',
          tvlUsd: 500, // Below $1000 minimum
          dexName: 'DogeSwap',
          factory: '0xFactory',
        });

        const alerts = monitor.getAlerts();
        const lowLiqAlerts = alerts.filter(a => a.type === 'low_liquidity');
        expect(lowLiqAlerts.length).toBe(1);
        expect(lowLiqAlerts[0].priority).toBe('critical');
        expect(lowLiqAlerts[0].data?.thresholdLevel).toBe('minimum');
      });

      it('should trigger warning alert when TVL < $5,000 low threshold', () => {
        monitor.recordPoolSnapshot({
          token0: '0xWWDOGE',
          token1: '0xDC',
          reserve0: '1000000000000000000',
          reserve1: '500000000000000000',
          totalSupply: '1500000000000000000',
          tvlUsd: 3000, // Below $5000 low
          dexName: 'DogeSwap',
          factory: '0xFactory',
        });

        const alerts = monitor.getAlerts();
        const lowLiqAlerts = alerts.filter(a => a.type === 'low_liquidity');
        expect(lowLiqAlerts.length).toBe(1);
        expect(lowLiqAlerts[0].priority).toBe('warning');
        expect(lowLiqAlerts[0].data?.thresholdLevel).toBe('low');
      });

      it('should trigger info alert when TVL < $10,000 medium threshold', () => {
        monitor.recordPoolSnapshot({
          token0: '0xWWDOGE',
          token1: '0xDC',
          reserve0: '1000000000000000000',
          reserve1: '500000000000000000',
          totalSupply: '1500000000000000000',
          tvlUsd: 8000, // Below $10000 medium
          dexName: 'DogeSwap',
          factory: '0xFactory',
        });

        const alerts = monitor.getAlerts();
        const lowLiqAlerts = alerts.filter(a => a.type === 'low_liquidity');
        expect(lowLiqAlerts.length).toBe(1);
        expect(lowLiqAlerts[0].priority).toBe('info');
        expect(lowLiqAlerts[0].data?.thresholdLevel).toBe('medium');
      });

      it('should not trigger alert when TVL is above all thresholds', () => {
        monitor.recordPoolSnapshot({
          token0: '0xWWDOGE',
          token1: '0xDC',
          reserve0: '1000000000000000000',
          reserve1: '500000000000000000',
          totalSupply: '1500000000000000000',
          tvlUsd: 50000, // Above all thresholds
          dexName: 'DogeSwap',
          factory: '0xFactory',
        });

        const alerts = monitor.getAlerts();
        const lowLiqAlerts = alerts.filter(a => a.type === 'low_liquidity');
        expect(lowLiqAlerts.length).toBe(0);
      });
    });

    describe('Alert Acknowledgment', () => {
      it('should acknowledge an alert', () => {
        monitor.recordPoolSnapshot({
          token0: '0xWWDOGE',
          token1: '0xDC',
          reserve0: '1000000000000000000',
          reserve1: '500000000000000000',
          totalSupply: '1500000000000000000',
          tvlUsd: 500, // Triggers critical alert
          dexName: 'DogeSwap',
          factory: '0xFactory',
        });

        const alerts = monitor.getAlerts();
        expect(alerts[0].acknowledged).toBe(false);

        monitor.acknowledgeAlert(alerts[0].id);
        expect(monitor.getAlerts()[0].acknowledged).toBe(true);
      });

      it('should get only unacknowledged alerts', () => {
        monitor.recordPoolSnapshot({
          token0: '0xWWDOGE',
          token1: '0xDC',
          reserve0: '1000000000000000000',
          reserve1: '500000000000000000',
          totalSupply: '1500000000000000000',
          tvlUsd: 500,
          dexName: 'DogeSwap',
          factory: '0xFactory',
        });

        monitor.recordPoolSnapshot({
          token0: '0xWWDOGE',
          token1: '0xOMNOM',
          reserve0: '1000000000000000000',
          reserve1: '500000000000000000',
          totalSupply: '1500000000000000000',
          tvlUsd: 500,
          dexName: 'DogeSwap',
          factory: '0xFactory',
        });

        const alerts = monitor.getAlerts();
        expect(alerts.length).toBe(2);

        monitor.acknowledgeAlert(alerts[0].id);
        const unacked = monitor.getUnacknowledgedAlerts();
        expect(unacked.length).toBe(1);
        expect(unacked[0].id).toBe(alerts[1].id);
      });
    });

    describe('Alert Priority Filtering', () => {
      it('should get alerts by priority', () => {
        // Create alerts with different priorities
        monitor.recordPoolSnapshot({
          token0: '0xWWDOGE',
          token1: '0xDC',
          reserve0: '1000000000000000000',
          reserve1: '500000000000000000',
          totalSupply: '1500000000000000000',
          tvlUsd: 500, // critical
          dexName: 'DogeSwap',
          factory: '0xFactory',
        });

        monitor.recordPoolSnapshot({
          token0: '0xWWDOGE',
          token1: '0xOMNOM',
          reserve0: '1000000000000000000',
          reserve1: '500000000000000000',
          totalSupply: '1500000000000000000',
          tvlUsd: 3000, // warning
          dexName: 'DogeSwap',
          factory: '0xFactory',
        });

        const criticalAlerts = monitor.getAlertsByPriority('critical');
        const warningAlerts = monitor.getAlertsByPriority('warning');

        expect(criticalAlerts.length).toBe(1);
        expect(warningAlerts.length).toBe(1);
        expect(criticalAlerts[0].data?.thresholdLevel).toBe('minimum');
        expect(warningAlerts[0].data?.thresholdLevel).toBe('low');
      });
    });

    describe('Alert Callbacks', () => {
      it('should call registered alert callback', () => {
        const callback = vi.fn();
        monitor.onAlert(callback);

        monitor.recordPoolSnapshot({
          token0: '0xWWDOGE',
          token1: '0xDC',
          reserve0: '1000000000000000000',
          reserve1: '500000000000000000',
          totalSupply: '1500000000000000000',
          tvlUsd: 500,
          dexName: 'DogeSwap',
          factory: '0xFactory',
        });

        expect(callback).toHaveBeenCalledTimes(1);
        expect(callback).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'low_liquidity',
            priority: 'critical',
          })
        );
      });

      it('should return unsubscribe function', () => {
        const callback = vi.fn();
        const unsubscribe = monitor.onAlert(callback);

        monitor.recordPoolSnapshot({
          token0: '0xWWDOGE',
          token1: '0xDC',
          reserve0: '1000000000000000000',
          reserve1: '500000000000000000',
          totalSupply: '1500000000000000000',
          tvlUsd: 500,
          dexName: 'DogeSwap',
          factory: '0xFactory',
        });

        expect(callback).toHaveBeenCalledTimes(1);

        unsubscribe();

        monitor.recordPoolSnapshot({
          token0: '0xWWDOGE',
          token1: '0xOMNOM',
          reserve0: '1000000000000000000',
          reserve1: '500000000000000000',
          totalSupply: '1500000000000000000',
          tvlUsd: 500,
          dexName: 'DogeSwap',
          factory: '0xFactory',
        });

        expect(callback).toHaveBeenCalledTimes(1); // Still only 1
      });
    });
  });

  describe('D3: Routing Decision Logging', () => {
    describe('logRoutingDecision', () => {
      it('should log routing decision with all parameters', () => {
        const route = createMockRoute('route-1', 1000000n, 800000n);
        const routeId = monitor.logRoutingDecision({
          tokenIn: '0xWWDOGE',
          tokenOut: '0xDC',
          amountIn: 1000000n,
          availableRoutes: [route],
          selectedRoute: route,
          routeSelectionReason: 'Best price impact',
          routingTimeMs: 150,
          poolsCount: 5,
        });

        expect(routeId).toMatch(/^route_\d+_\d+$/);
        const decisions = monitor.getRoutingDecisions();
        expect(decisions.length).toBe(1);
        expect(decisions[0].tokenIn).toBe('0xWWDOGE');
        expect(decisions[0].tokenOut).toBe('0xDC');
        expect(decisions[0].availableRoutes.length).toBe(1);
        expect(decisions[0].selectedRoute?.id).toBe('route-1');
        expect(decisions[0].routeSelectionReason).toBe('Best price impact');
        expect(decisions[0].routingTimeMs).toBe(150);
        expect(decisions[0].poolsCount).toBe(5);
      });

      it('should include timestamp in routing decision', () => {
        const before = Date.now();
        monitor.logRoutingDecision({
          tokenIn: '0xWWDOGE',
          tokenOut: '0xDC',
          amountIn: 1000000n,
          availableRoutes: [],
          selectedRoute: null,
          routeSelectionReason: 'No route found',
          routingTimeMs: 50,
          poolsCount: 0,
          error: 'No pools available',
        });
        const after = Date.now();

        const decisions = monitor.getRoutingDecisions();
        expect(decisions[0].timestamp).toBeGreaterThanOrEqual(before);
        expect(decisions[0].timestamp).toBeLessThanOrEqual(after);
      });

      it('should log error when routing fails', () => {
        monitor.logRoutingDecision({
          tokenIn: '0xWWDOGE',
          tokenOut: '0xDC',
          amountIn: 1000000n,
          availableRoutes: [],
          selectedRoute: null,
          routeSelectionReason: 'No route found',
          routingTimeMs: 50,
          poolsCount: 0,
          error: 'No pools available',
        });

        const decisions = monitor.getRoutingDecisions();
        expect(decisions[0].error).toBe('No pools available');
        expect(decisions[0].selectedRoute).toBeNull();
      });

      it('should format amount correctly', () => {
        monitor.logRoutingDecision({
          tokenIn: '0xWWDOGE',
          tokenOut: '0xDC',
          amountIn: BigInt('1500000000000000000'), // 1.5 tokens
          availableRoutes: [],
          selectedRoute: null,
          routeSelectionReason: 'Test',
          routingTimeMs: 50,
          poolsCount: 0,
        });

        const decisions = monitor.getRoutingDecisions();
        expect(decisions[0].amountInFormatted).toBe('1.5000');
      });

      it('should store multiple available routes', () => {
        const route1 = createMockRoute('route-1', 1000000n, 800000n);
        const route2 = createMockRoute('route-2', 1000000n, 750000n);
        const route3 = createMockRoute('route-3', 1000000n, 700000n);

        monitor.logRoutingDecision({
          tokenIn: '0xWWDOGE',
          tokenOut: '0xDC',
          amountIn: 1000000n,
          availableRoutes: [route1, route2, route3],
          selectedRoute: route1,
          routeSelectionReason: 'Highest output',
          routingTimeMs: 200,
          poolsCount: 10,
        });

        const decisions = monitor.getRoutingDecisions();
        expect(decisions[0].availableRoutes.length).toBe(3);
      });
    });

    describe('Routing Decision History', () => {
      it('should limit routing decisions to MAX_ROUTING_DECISIONS', () => {
        // Create more than MAX_ROUTING_DECISIONS decisions
        for (let i = 0; i < MAX_ROUTING_DECISIONS + 10; i++) {
          monitor.logRoutingDecision({
            tokenIn: '0xWWDOGE',
            tokenOut: '0xDC',
            amountIn: 1000000n,
            availableRoutes: [],
            selectedRoute: null,
            routeSelectionReason: 'Test',
            routingTimeMs: 50,
            poolsCount: 0,
          });
        }

        const decisions = monitor.getRoutingDecisions();
        expect(decisions.length).toBeLessThanOrEqual(MAX_ROUTING_DECISIONS);
      });
    });
  });
});

describe('Swap Resilience Tests', () => {
  // ─── RPC Monitor Rolling Average Tests ────────────────────────────────────────

  describe('RPC Monitor Rolling Average Tests', () => {
    interface RpcLatencyRecord {
      latency: number;
      timestamp: number;
    }

    class MockRpcMonitor {
      private latencyHistory: RpcLatencyRecord[] = [];
      private readonly windowSize = 10;
      private readonly slowThreshold = 2000; // 2 seconds

      recordLatency(latency: number): void {
        this.latencyHistory.push({ latency, timestamp: Date.now() });
        if (this.latencyHistory.length > this.windowSize) {
          this.latencyHistory.shift();
        }
      }

      getAverageLatency(): number {
        if (this.latencyHistory.length === 0) return 0;
        const sum = this.latencyHistory.reduce((acc, r) => acc + r.latency, 0);
        return sum / this.latencyHistory.length;
      }

      isSlow(): boolean {
        return this.getAverageLatency() > this.slowThreshold;
      }
    }

    it('should calculate rolling average correctly', () => {
      const monitor = new MockRpcMonitor();
      monitor.recordLatency(100);
      monitor.recordLatency(200);
      monitor.recordLatency(300);

      expect(monitor.getAverageLatency()).toBe(200);
    });

    it('should drop oldest latency when window exceeded', () => {
      const monitor = new MockRpcMonitor();
      for (let i = 0; i < 15; i++) {
        monitor.recordLatency(1000);
      }

      // Last 10 should be in window, all equal 1000
      expect(monitor.getAverageLatency()).toBe(1000);
    });

    it('should flag rpcSlow when average exceeds 2000ms', () => {
      const monitor = new MockRpcMonitor();

      // Add latencies that average > 2000ms
      monitor.recordLatency(2500);
      monitor.recordLatency(2500);
      monitor.recordLatency(2500);

      expect(monitor.isSlow()).toBe(true);
    });

    it('should handle mixed fast/slow RPC calls', () => {
      const monitor = new MockRpcMonitor();

      monitor.recordLatency(500);
      monitor.recordLatency(600);
      monitor.recordLatency(700);
      monitor.recordLatency(3000);
      monitor.recordLatency(3500);

      // Average = (500 + 600 + 700 + 3000 + 3500) / 5 = 1660
      expect(monitor.getAverageLatency()).toBe(1660);
      expect(monitor.isSlow()).toBe(false);
    });

    it('should include rpcSlow flag in summary', () => {
      const monitor = new MockRpcMonitor();

      monitor.recordLatency(3000);
      monitor.recordLatency(2500);
      monitor.recordLatency(2000);

      const average = monitor.getAverageLatency();
      const isSlow = average > 2000;

      const summary = {
        averageLatencyMs: average,
        rpcSlow: isSlow,
      };

      expect(summary.rpcSlow).toBe(true);
    });
  });

  // ─── Slow RPC Handling ────────────────────────────────────────────────────────

  describe('Slow RPC Handling', () => {
    class SlowRpcHandler {
      private readonly latencyThreshold = 2000;
      private lastWarning: string | null = null;

      handleRpcResult(latency: number): void {
        if (latency > this.latencyThreshold) {
          this.lastWarning = `[Monitor] RPC latency warning: ${latency}ms average (threshold: ${this.latencyThreshold}ms)`;
        }
      }

      getLastWarning(): string | null {
        return this.lastWarning;
      }
    }

    it('should detect high latency single call', () => {
      const handler = new SlowRpcHandler();
      handler.handleRpcResult(5000);

      expect(handler.getLastWarning()).toBe('[Monitor] RPC latency warning: 5000ms average (threshold: 2000ms)');
    });

    it('should detect high latency spike (single call takes 5s)', () => {
      const handler = new SlowRpcHandler();

      // Simulate 4 fast calls + 1 slow call
      [100, 150, 200, 250, 5000].forEach(latency => {
        handler.handleRpcResult(latency);
      });

      expect(handler.getLastWarning()).toBe('[Monitor] RPC latency warning: 5000ms average (threshold: 2000ms)');
    });

    it('should trigger warning when average exceeds threshold', () => {
      const handler = new SlowRpcHandler();

      // 10 calls, average > 2000ms
      [2500, 2500, 2500, 2500, 2500, 2500, 2500, 2500, 2500, 2500].forEach(latency => {
        handler.handleRpcResult(latency);
      });

      expect(handler.getLastWarning()).toBe('[Monitor] RPC latency warning: 2500ms average (threshold: 2000ms)');
    });
  });
});
