/**
 * Transaction Monitor Service — Phase 8: Monitoring and Alerts
 *
 * Tracks all swap attempts with success/failure status, captures diagnostic
 * information, monitors liquidity, and logs routing decisions for post-incident
 * analysis and ongoing operations.
 *
 * Features:
 *   - Transaction attempt tracking (user address, token pair, amount, timestamp, gas, route)
 *   - Alert system with priority levels (info, warning, critical)
 *   - Liquidity monitoring with TVL threshold notifications
 *   - Routing decision logging (last 100 decisions)
 *   - Integration with existing MonitorOverlay via localStorage
 */

import { getAddress } from 'viem';
import type { RouteResult, RouteStep } from '../pathFinder/types';

// ─── Alert Priority & Types ──────────────────────────────────────────────────

export type AlertPriority = 'info' | 'warning' | 'critical';
export type AlertType = 'tx_failed' | 'tx_success' | 'low_liquidity' | 'high_slippage' | 'rpc_error' | 'routing_error';

export interface Alert {
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

// ─── Transaction Tracking ─────────────────────────────────────────────────────

export interface SwapAttempt {
  id: string;
  userAddress: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  amountOutMin: string;
  timestamp: number;
  status: 'pending' | 'success' | 'failed' | 'reverted';
  txHash?: string;
  route?: string; // Serialized route ID
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

export interface RouteDiagnostic {
  routesConsidered: number;
  selectedRouteId: string;
  selectedRouteSteps: RouteStep[];
  availableRoutes: RouteResult[];
  priceImpact: number;
  outputAmount: string;
  outputAmountFormatted: string;
  routingTimeMs: number;
}

// ─── Liquidity Tracking ───────────────────────────────────────────────────────

export interface PoolSnapshot {
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

export interface LiquidityAlert {
  pair: string;
  tvlUsd: number;
  threshold: 'minimum' | 'low' | 'medium';
  previousTvl?: number;
  timestamp: number;
}

export interface LiquidityThresholds {
  minimum: number;  // $1,000
  low: number;       // $5,000
  medium: number;    // $10,000
}

// Default thresholds as specified in Phase 8
export const DEFAULT_LIQUIDITY_THRESHOLDS: LiquidityThresholds = {
  minimum: 1000,
  low: 5000,
  medium: 10000,
};

// ─── Routing Decision Log ─────────────────────────────────────────────────────

export interface RoutingDecision {
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

// ─── Aggregated Statistics ─────────────────────────────────────────────────────

export interface SwapStatistics {
  totalAttempts: number;
  successfulAttempts: number;
  failedAttempts: number;
  revertedAttempts: number;
  successRate: number;
  averageGasUsed: string;
  averageRoutingTimeMs: number;
  failureReasons: Record<string, number>;
  topTokensByVolume: Array<{ token: string; volume: string }>;
  lastUpdated: number;
}

// ─── Internal State ───────────────────────────────────────────────────────────

const MAX_SWAP_ATTEMPTS = 500;
const MAX_ROUTING_DECISIONS = 100;
const MAX_POOL_SNAPSHOTS = 1000;
const MAX_ALERTS = 200;

const STORAGE_PREFIX = 'omnom_monitor_';

// ─── Storage Helpers ─────────────────────────────────────────────────────────────

/**
 * Revive BigInt values from string representation after JSON parse.
 * Looks for string values that are numeric but exceed safe integer range.
 */
function reviveBigInts(_key: string, value: unknown): unknown {
  if (typeof value === 'string') {
    // Check if string looks like a BigInt (all digits, possibly with 'n' suffix)
    const trimmed = value.trim();
    if (/^\d+n$/.test(trimmed)) {
      return BigInt(trimmed.slice(0, -1));
    }
    // Also handle plain digit strings that are too large for safe integer
    if (/^\d+$/.test(trimmed) && BigInt(trimmed) > BigInt(Number.MAX_SAFE_INTEGER)) {
      return BigInt(trimmed);
    }
  }
  return value;
}

function loadFromStorage<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + key);
    return raw ? JSON.parse(raw, reviveBigInts) : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Custom JSON.stringify replacer that converts BigInt values to strings.
 * BigInt cannot be serialized by default JSON.stringify.
 * Handles nested objects recursively.
 */
function bigIntReplacer(_key: string, value: unknown): unknown {
  if (typeof value === 'bigint') {
    return value.toString() + 'n';
  }
  if (Array.isArray(value)) {
    return value.map(item => bigIntReplacer('', item));
  }
  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      result[k] = bigIntReplacer(k, v);
    }
    return result;
  }
  return value;
}

function saveToStorage<T>(key: string, data: T): void {
  try {
    localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(data, bigIntReplacer));
  } catch (e) {
    console.warn('[TransactionMonitor] Failed to save to localStorage:', e);
  }
}

// ─── Transaction Monitor Class ─────────────────────────────────────────────────

class TransactionMonitor {
  private swapAttempts: SwapAttempt[] = [];
  private routingDecisions: RoutingDecision[] = [];
  private poolSnapshots: PoolSnapshot[] = [];
  private alerts: Alert[] = [];
  private alertCallbacks: Array<(alert: Alert) => void> = [];
  private liquidityThresholds: LiquidityThresholds = DEFAULT_LIQUIDITY_THRESHOLDS;
  private lastLiquidityCheck: Map<string, number> = new Map();
  private nextId = 1;

  constructor() {
    // Load persisted data on initialization
    this.swapAttempts = loadFromStorage('swap_attempts', []);
    this.routingDecisions = loadFromStorage('routing_decisions', []);
    this.poolSnapshots = loadFromStorage('pool_snapshots', []);
    this.alerts = loadFromStorage('alerts', []);
  }

  // ─── ID Generation ───────────────────────────────────────────────────────────

  private generateId(): string {
    return `tx_${Date.now()}_${this.nextId++}`;
  }

  // ─── Swap Attempt Tracking ────────────────────────────────────────────────────

  /**
   * Start tracking a new swap attempt
   */
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
      userAddress: getAddress(params.userAddress),
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
    this.saveSwapAttempts();

    console.log(`[TransactionMonitor] Swap started: ${id}`, {
      tokenIn: params.tokenIn,
      tokenOut: params.tokenOut,
      amountIn: params.amountIn.toString(),
      route: params.route?.id,
    });

    return id;
  }

  /**
   * Update swap attempt with success status
   */
  trackSwapSuccess(
    id: string,
    txHash: string,
    blockNumber?: number,
    effectiveGas?: string
  ): void {
    const attempt = this.swapAttempts.find(a => a.id === id);
    if (!attempt) {
      console.warn(`[TransactionMonitor] Swap attempt not found: ${id}`);
      return;
    }

    attempt.status = 'success';
    attempt.txHash = txHash;
    attempt.blockNumber = blockNumber;
    attempt.effectiveGas = effectiveGas;
    this.saveSwapAttempts();

    // Emit success alert for critical paths
    this.emitAlert({
      type: 'tx_success',
      priority: 'info',
      title: 'Swap Completed',
      message: `Successfully swapped ${this.formatAmount(attempt.amountIn)} ${attempt.tokenIn} → ${this.formatAmount(attempt.amountOutMin)} ${attempt.tokenOut}`,
      txHash,
      data: { attemptId: id, amountIn: attempt.amountIn, amountOutMin: attempt.amountOutMin },
    });

    console.log(`[TransactionMonitor] Swap success: ${id}`, { txHash });
  }

  /**
   * Update swap attempt with failure status
   */
  trackSwapFailure(
    id: string,
    error: { code: string; message: string; revertReason?: string },
    diagnostic?: Partial<RouteDiagnostic>
  ): void {
    const attempt = this.swapAttempts.find(a => a.id === id);
    if (!attempt) {
      console.warn(`[TransactionMonitor] Swap attempt not found: ${id}`);
      return;
    }

    attempt.status = 'failed';
    attempt.error = error;
    if (diagnostic) {
      attempt.routeDetails = {
        ...attempt.routeDetails,
        ...diagnostic,
      } as RouteDiagnostic;
    }
    this.saveSwapAttempts();

    // Emit critical alert for failed transactions
    this.emitAlert({
      type: 'tx_failed',
      priority: 'critical',
      title: 'Swap Failed',
      message: error.message || 'Transaction failed',
      data: {
        attemptId: id,
        errorCode: error.code,
        revertReason: error.revertReason,
        tokenIn: attempt.tokenIn,
        tokenOut: attempt.tokenOut,
        amountIn: attempt.amountIn,
        routingDiagnostic: diagnostic,
      },
    });

    console.error(`[TransactionMonitor] Swap failed: ${id}`, {
      error: error.code,
      message: error.message,
      revertReason: error.revertReason,
      diagnostic,
    });
  }

  /**
   * Update swap attempt with revert status (on-chain revert)
   */
  trackSwapReverted(
    id: string,
    txHash: string,
    revertReason?: string,
    blockNumber?: number
  ): void {
    const attempt = this.swapAttempts.find(a => a.id === id);
    if (!attempt) {
      console.warn(`[TransactionMonitor] Swap attempt not found: ${id}`);
      return;
    }

    attempt.status = 'reverted';
    attempt.txHash = txHash;
    attempt.blockNumber = blockNumber;
    if (revertReason) {
      attempt.error = { code: 'REVERT', message: revertReason, revertReason };
    }
    this.saveSwapAttempts();

    // Emit critical alert for reverted transactions
    this.emitAlert({
      type: 'tx_failed',
      priority: 'critical',
      title: 'Swap Reverted',
      message: revertReason || 'Transaction reverted on-chain',
      txHash,
      data: {
        attemptId: id,
        revertReason,
        tokenIn: attempt.tokenIn,
        tokenOut: attempt.tokenOut,
        amountIn: attempt.amountIn,
        blockNumber,
      },
    });

    console.error(`[TransactionMonitor] Swap reverted: ${id}`, {
      txHash,
      revertReason,
      blockNumber,
    });
  }

  // ─── Routing Decision Logging ────────────────────────────────────────────────

  /**
   * Log a routing decision for post-incident analysis
   */
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
    this.saveRoutingDecisions();

    console.log(`[TransactionMonitor] Routing decision: ${id}`, {
      tokenIn: params.tokenIn,
      tokenOut: params.tokenOut,
      availableRoutes: params.availableRoutes.length,
      selectedRoute: params.selectedRoute?.id,
      routingTimeMs: params.routingTimeMs,
      error: params.error,
    });

    return id;
  }

  // ─── Liquidity Monitoring ───────────────────────────────────────────────────

  /**
   * Record a pool reserve snapshot for TVL tracking
   */
  recordPoolSnapshot(snapshot: Omit<PoolSnapshot, 'timestamp'>): void {
    const entry: PoolSnapshot = {
      ...snapshot,
      timestamp: Date.now(),
    };

    this.poolSnapshots.push(entry);
    if (this.poolSnapshots.length > MAX_POOL_SNAPSHOTS) {
      this.poolSnapshots.shift();
    }

    // Check liquidity threshold
    this.checkLiquidityThreshold(entry);
    this.savePoolSnapshots();
  }

  /**
   * Check liquidity against thresholds and emit alerts
   */
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
      // Find previous TVL for comparison
      const previousSnapshot = this.poolSnapshots
        .filter(s => s.token0 === snapshot.token0 && s.token1 === snapshot.token1 && s.tvlUsd > 0)
        .slice(-2, -1)[0];

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
          previousTvl: previousSnapshot?.tvlUsd,
          reserve0: snapshot.reserve0,
          reserve1: snapshot.reserve1,
        },
      });
    }
  }

  /**
   * Get current TVL for a token pair
   */
  getPairTVL(token0: string, token1: string): number {
    const snapshots = this.poolSnapshots
      .filter(s => s.token0 === token0 && s.token1 === token1)
      .slice(-10);

    if (snapshots.length === 0) return 0;
    return snapshots[snapshots.length - 1].tvlUsd;
  }

  /**
   * Get TVL trend for a token pair (last N snapshots)
   */
  getTVLTrend(token0: string, token1: string, count = 20): { tvl: number; timestamp: number }[] {
    return this.poolSnapshots
      .filter(s => s.token0 === token0 && s.token1 === token1)
      .slice(-count)
      .map(s => ({ tvl: s.tvlUsd, timestamp: s.timestamp }));
  }

  /**
   * Update liquidity thresholds
   */
  setLiquidityThresholds(thresholds: Partial<LiquidityThresholds>): void {
    this.liquidityThresholds = { ...this.liquidityThresholds, ...thresholds };
    console.log(`[TransactionMonitor] Updated liquidity thresholds:`, this.liquidityThresholds);
  }

  // ─── Alert System ────────────────────────────────────────────────────────────

  /**
   * Register a callback for alerts
   */
  onAlert(callback: (alert: Alert) => void): () => void {
    this.alertCallbacks.push(callback);
    return () => {
      this.alertCallbacks = this.alertCallbacks.filter(cb => cb !== callback);
    };
  }

  /**
   * Emit an alert to all registered callbacks and store it
   */
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
    this.saveAlerts();

    // Log with appropriate severity
    const logFn = fullAlert.priority === 'critical' ? console.error :
      fullAlert.priority === 'warning' ? console.warn : console.log;
    logFn(`[${fullAlert.priority.toUpperCase()}] ${fullAlert.title}: ${fullAlert.message}`, fullAlert.data);

    // Notify callbacks
    for (const callback of this.alertCallbacks) {
      try {
        callback(fullAlert);
      } catch (e) {
        console.error('[TransactionMonitor] Alert callback error:', e);
      }
    }
  }

  /**
   * Acknowledge an alert
   */
  acknowledgeAlert(alertId: string): void {
    const alert = this.alerts.find(a => a.id === alertId);
    if (alert) {
      alert.acknowledged = true;
      this.saveAlerts();
    }
  }

  /**
   * Get unacknowledged alerts
   */
  getUnacknowledgedAlerts(): Alert[] {
    return this.alerts.filter(a => !a.acknowledged);
  }

  /**
   * Get alerts by priority
   */
  getAlertsByPriority(priority: AlertPriority): Alert[] {
    return this.alerts.filter(a => a.priority === priority);
  }

  // ─── Statistics ──────────────────────────────────────────────────────────────

  /**
   * Calculate aggregated swap statistics
   */
  getStatistics(): SwapStatistics {
    const completed = this.swapAttempts.filter(a => a.status !== 'pending');
    const successful = completed.filter(a => a.status === 'success');
    const failed = completed.filter(a => a.status === 'failed');
    const reverted = completed.filter(a => a.status === 'reverted');

    // Count failure reasons
    const failureReasons: Record<string, number> = {};
    for (const attempt of failed.concat(reverted)) {
      const reason = attempt.error?.code || 'UNKNOWN';
      failureReasons[reason] = (failureReasons[reason] || 0) + 1;
    }

    // Calculate average gas (from successful attempts with gas data)
    let avgGas = '0';
    const gasAttempts = successful.filter(a => a.effectiveGas);
    if (gasAttempts.length > 0) {
      const totalGas = gasAttempts.reduce((sum, a) => sum + BigInt(a.effectiveGas || '0'), 0n);
      avgGas = (totalGas / BigInt(gasAttempts.length)).toString();
    }

    // Calculate average routing time from routing decisions
    let avgRoutingTime = 0;
    if (this.routingDecisions.length > 0) {
      const totalRoutingTime = this.routingDecisions.reduce((sum, d) => sum + d.routingTimeMs, 0);
      avgRoutingTime = Math.round(totalRoutingTime / this.routingDecisions.length);
    }

    return {
      totalAttempts: this.swapAttempts.length,
      successfulAttempts: successful.length,
      failedAttempts: failed.length,
      revertedAttempts: reverted.length,
      successRate: completed.length > 0 ? (successful.length / completed.length) * 100 : 0,
      averageGasUsed: avgGas,
      averageRoutingTimeMs: avgRoutingTime,
      failureReasons,
      topTokensByVolume: this.calculateTopTokensByVolume(),
      lastUpdated: Date.now(),
    };
  }

  private calculateTopTokensByVolume(): Array<{ token: string; volume: string }> {
    const volumeByToken: Record<string, bigint> = {};

    for (const attempt of this.swapAttempts) {
      const amount = BigInt(attempt.amountIn);
      volumeByToken[attempt.tokenIn] = (volumeByToken[attempt.tokenIn] || 0n) + amount;
    }

    return Object.entries(volumeByToken)
      .map(([token, volume]) => ({ token, volume: volume.toString() }))
      .sort((a, b) => BigInt(b.volume) > BigInt(a.volume) ? 1 : -1)
      .slice(0, 10);
  }

  // ─── Persistence ────────────────────────────────────────────────────────────

  private saveSwapAttempts(): void {
    saveToStorage('swap_attempts', this.swapAttempts);
  }

  private saveRoutingDecisions(): void {
    saveToStorage('routing_decisions', this.routingDecisions);
  }

  private savePoolSnapshots(): void {
    saveToStorage('pool_snapshots', this.poolSnapshots);
  }

  private saveAlerts(): void {
    saveToStorage('alerts', this.alerts);
  }

  // ─── Getters ────────────────────────────────────────────────────────────────

  getSwapAttempts(): SwapAttempt[] {
    return [...this.swapAttempts];
  }

  getRoutingDecisions(): RoutingDecision[] {
    return [...this.routingDecisions];
  }

  getRecentRoutingDecisions(count = 10): RoutingDecision[] {
    return this.routingDecisions.slice(-count);
  }

  getPoolSnapshots(): PoolSnapshot[] {
    return [...this.poolSnapshots];
  }

  getAlerts(): Alert[] {
    return [...this.alerts];
  }

  getRecentAlerts(count = 20): Alert[] {
    return this.alerts.slice(-count);
  }

  clearAllData(): void {
    this.swapAttempts = [];
    this.routingDecisions = [];
    this.poolSnapshots = [];
    this.alerts = [];
    localStorage.removeItem(STORAGE_PREFIX + 'swap_attempts');
    localStorage.removeItem(STORAGE_PREFIX + 'routing_decisions');
    localStorage.removeItem(STORAGE_PREFIX + 'pool_snapshots');
    localStorage.removeItem(STORAGE_PREFIX + 'alerts');
    console.log('[TransactionMonitor] All data cleared');
  }

  // ─── Utility ────────────────────────────────────────────────────────────────

  private formatAmount(amount: string | bigint): string {
    const num = typeof amount === 'string' ? BigInt(amount) : amount;
    const formatted = Number(num) / 1e18;
    if (formatted >= 1_000_000) return `${(formatted / 1_000_000).toFixed(2)}M`;
    if (formatted >= 1_000) return `${(formatted / 1_000).toFixed(2)}K`;
    return formatted.toFixed(4);
  }
}

// Singleton instance
export const transactionMonitor = new TransactionMonitor();

// ─── Exported Helpers for Direct Use ─────────────────────────────────────────

/**
 * Quick helper to track a swap start from the swap flow
 */
export function trackSwapStart(params: {
  userAddress: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: bigint;
  amountOutMin: bigint;
  gasSettings?: SwapAttempt['gasSettings'];
  route?: RouteResult;
}): string {
  return transactionMonitor.trackSwapStart(params);
}

/**
 * Quick helper to track a swap success
 */
export function trackSwapSuccess(
  id: string,
  txHash: string,
  blockNumber?: number,
  effectiveGas?: string
): void {
  transactionMonitor.trackSwapSuccess(id, txHash, blockNumber, effectiveGas);
}

/**
 * Quick helper to track a swap failure
 */
export function trackSwapFailure(
  id: string,
  error: { code: string; message: string; revertReason?: string },
  diagnostic?: Partial<RouteDiagnostic>
): void {
  transactionMonitor.trackSwapFailure(id, error, diagnostic);
}

/**
 * Quick helper to track a swap revert
 */
export function trackSwapReverted(
  id: string,
  txHash: string,
  revertReason?: string,
  blockNumber?: number
): void {
  transactionMonitor.trackSwapReverted(id, txHash, revertReason, blockNumber);
}

/**
 * Quick helper to log a routing decision
 */
export function logRoutingDecision(params: {
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
  return transactionMonitor.logRoutingDecision(params);
}

/**
 * Quick helper to record a pool snapshot
 */
export function recordPoolSnapshot(snapshot: Omit<PoolSnapshot, 'timestamp'>): void {
  transactionMonitor.recordPoolSnapshot(snapshot);
}

/**
 * Subscribe to alerts
 */
export function onAlert(callback: (alert: Alert) => void): () => void {
  return transactionMonitor.onAlert(callback);
}
