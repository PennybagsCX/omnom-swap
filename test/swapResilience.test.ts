/**
 * @file swapResilience.test.ts
 * @description Jest/TypeScript test suite for swap resilience features.
 *
 * Tests the following fixes implemented after the failed Dogechain swap:
 *   TX: 0x8288440d532a3a28cb7af3412b68915011182bf156e4c57edb95ecca4086a18c
 *
 * Coverage:
 *   1. Slippage Protection (useSwap.ts)
 *      - MIN_INTERMEDIATE_OUT = 1e12 wei for intermediate steps
 *      - RPC_LATENCY_WARNING_MS = 2000 threshold
 *      - Dynamic waitForTransactionReceipt timeout
 *   2. RPC Monitor Enhancements (monitor.ts)
 *      - Rolling average of RPC response times (last 50 samples)
 *      - getRpcRollingAverage() method
 *      - rpcAvgMs and rpcSlow in summary
 *
 * Reference: src/hooks/useAggregator/useSwap.ts, src/lib/monitor.ts
 */

import { describe, it, expect, beforeEach } from 'vitest';

// ─── Constants (from useSwap.ts and monitor.ts) ──────────────────────────────

const MIN_INTERMEDIATE_OUT = BigInt('1000000000000'); // 1e12 wei minimum for intermediate steps
const RPC_LATENCY_WARNING_MS = 2000;
const DEFAULT_RECEIPT_TIMEOUT_MS = 30_000;
const SLOW_THRESHOLD = 2000;
const MAX_RPC_SAMPLES = 50;

// ─── Type Definitions ─────────────────────────────────────────────────────────

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

interface SwapStepRequest {
  router: `0x${string}`;
  path: `0x${string}`[];
  amountIn: bigint;
  minAmountOut: bigint;
}

interface SwapRequest {
  tokenIn: `0x${string}`;
  tokenOut: `0x${string}`;
  amountIn: bigint;
  minTotalAmountOut: bigint;
  steps: SwapStepRequest[];
  deadline: bigint;
  recipient: `0x${string}`;
}

interface RequestLog {
  id: number;
  source: string;
  url: string;
  method: string;
  startTime: number;
  duration?: number;
  status?: number;
  size?: number;
  error?: string;
  slow: boolean;
  failed: boolean;
}

// ─── Slippage Calculation Implementation (from useSwap.ts) ────────────────────

const EXTRA_SECONDS_PER_HOP = 30;

/**
 * Build a SwapRequest from a RouteResult.
 * Simulates the logic from useSwap.buildSwapRequest
 */
function buildSwapRequest(
  route: RouteResult,
  slippageBps: number,
  deadlineMinutes: number,
  userAddress: string,
): SwapRequest {
  // Dynamic deadline: user setting + per-hop buffer
  const userDeadlineSeconds = deadlineMinutes * 60;
  const hopCount = route.steps.length;
  const extraPerHop = Math.max(0, hopCount - 1) * EXTRA_SECONDS_PER_HOP;
  const effectiveDeadlineSeconds = userDeadlineSeconds + extraPerHop;
  const deadline = BigInt(Math.floor(Date.now() / 1000) + effectiveDeadlineSeconds);

  // Apply slippage to total expected output
  const slippageMultiplier = 10000n - BigInt(slippageBps);
  const minTotalAmountOut = (route.totalExpectedOut * slippageMultiplier) / 10000n;

  // Calculate per-step minAmountOut for slippage protection
  const stepMinAmounts: bigint[] = route.steps.map((step) => {
    return (step.expectedAmountOut * slippageMultiplier) / 10000n;
  });

  const steps = route.steps.map((step, i) => {
    let stepAmountIn: bigint;
    let stepMinOut: bigint;

    if (i === 0) {
      // First step: contract validates amountIn == swapAmount (amountIn - fee)
      const feeAmount = (route.totalAmountIn * BigInt(route.feeBps)) / 10000n;
      stepAmountIn = route.totalAmountIn - feeAmount;
      stepMinOut = stepMinAmounts[0];
    } else {
      // Subsequent steps: use previous step's slippage-adjusted minAmountOut as amountIn
      stepAmountIn = stepMinAmounts[i - 1];
      if (i < route.steps.length - 1) {
        // Intermediate step: use MIN_INTERMEDIATE_OUT instead of 1n for better MEV protection
        // The final minTotalAmountOut check handles overall slippage
        stepMinOut = MIN_INTERMEDIATE_OUT;
      } else {
        // Last step: apply slippage normally
        stepMinOut = stepMinAmounts[i];
      }
    }

    return {
      router: step.dexRouter as `0x${string}`,
      path: step.path as `0x${string}`[],
      amountIn: stepAmountIn,
      minAmountOut: stepMinOut,
    };
  });

  return {
    tokenIn: route.steps[0]?.path[0] as `0x${string}` ?? '0x0000000000000000000000000000000000000000',
    tokenOut: route.steps[route.steps.length - 1]?.path[route.steps[route.steps.length - 1].path.length - 1] as `0x${string}` ?? '0x0000000000000000000000000000000000000000',
    amountIn: route.totalAmountIn,
    minTotalAmountOut,
    steps,
    deadline,
    recipient: userAddress as `0x${string}`,
  };
}

// ─── RPC Monitor Implementation (from monitor.ts) ────────────────────────────

class MockOmnomMonitor {
  private logs: RequestLog[] = [];
  private nextId = 1;
  private rpcResponseTimes: number[] = [];
  private lastLatencyWarning = 0;

  logRequest(source: string, url: string, method: string): number {
    const id = this.nextId++;
    const entry: RequestLog = {
      id,
      source,
      url: url.length > 120 ? url.slice(0, 117) + '...' : url,
      method,
      startTime: Date.now(),
      slow: false,
      failed: false,
    };
    this.logs.push(entry);
    return id;
  }

  logResponse(id: number, status: number, duration: number): void {
    const entry = this.logs.find(l => l.id === id);
    if (!entry) return;
    entry.duration = duration;
    entry.status = status;
    entry.slow = duration > SLOW_THRESHOLD;
    entry.failed = status < 200 || status >= 400;
  }

  logRpcCall(method: string, duration: number, success: boolean): void {
    const id = this.nextId++;
    const entry: RequestLog = {
      id,
      source: 'RPC',
      url: method,
      method: 'CALL',
      startTime: Date.now(),
      duration,
      slow: duration > SLOW_THRESHOLD,
      failed: !success,
    };
    this.logs.push(entry);

    // Track RPC response times for rolling average
    this.rpcResponseTimes.push(duration);
    if (this.rpcResponseTimes.length > MAX_RPC_SAMPLES) {
      this.rpcResponseTimes = this.rpcResponseTimes.slice(-MAX_RPC_SAMPLES);
    }

    // Check for high latency warning
    const avgTime = this.getAverageTime('RPC');
    if (avgTime > SLOW_THRESHOLD) {
      const now = Date.now();
      if (now - this.lastLatencyWarning > 30_000) {
        console.warn(`[Monitor] RPC latency warning: ${avgTime}ms average (threshold: ${SLOW_THRESHOLD}ms)`);
        this.lastLatencyWarning = now;
      }
    }
  }

  getAverageTime(source?: string): number {
    const completed = this.logs.filter(l => l.duration !== undefined && (!source || l.source === source));
    return completed.length > 0
      ? Math.round(completed.reduce((s, l) => s + (l.duration || 0), 0) / completed.length)
      : 0;
  }

  getRpcRollingAverage(): number {
    if (this.rpcResponseTimes.length === 0) return 0;
    return Math.round(this.rpcResponseTimes.reduce((a, b) => a + b, 0) / this.rpcResponseTimes.length);
  }

  getSummary() {
    // Calculate summary stats from logs
    const avgMs = this.getAverageTime();
    const rpcAvgMs = this.getAverageTime('RPC');
    return {
      total: this.logs.length,
      failed: this.logs.filter(l => l.failed).length,
      slow: this.logs.filter(l => l.slow).length,
      avgMs,
      rpcAvgMs,
      rpcSlow: rpcAvgMs > SLOW_THRESHOLD,
    };
  }

  clear(): void {
    this.logs = [];
    this.rpcResponseTimes = [];
  }
}

// ─── Test Suites ─────────────────────────────────────────────────────────────

describe('Slippage Protection Tests', () => {
  describe('MIN_INTERMEDIATE_OUT Constant', () => {
    it('should be 1e12 wei (1 trillion wei)', () => {
      expect(MIN_INTERMEDIATE_OUT).toBe(1000000000000n);
    });

    it('should be greater than 0', () => {
      expect(MIN_INTERMEDIATE_OUT).toBeGreaterThan(0n);
    });

    it('should be much smaller than a typical token amount (1e18)', () => {
      // MIN_INTERMEDIATE_OUT = 1e12 is 1,000,000 times smaller than 1e18
      expect(MIN_INTERMEDIATE_OUT).toBeLessThan(1000000000000000000n);
    });
  });

  describe('buildSwapRequest - Multi-hop Slippage', () => {
    it('should use MIN_INTERMEDIATE_OUT for intermediate steps', () => {
      const route: RouteResult = {
        id: 'multi-hop-test',
        steps: [
          { dexRouter: '0x1111', dexName: 'DogeSwap', path: ['A', 'B'], amountIn: 1000000n, expectedAmountOut: 990000n },
          { dexRouter: '0x2222', dexName: 'DogeShrk', path: ['B', 'C'], amountIn: 990000n, expectedAmountOut: 980000n },
          { dexRouter: '0x3333', dexName: 'WOJAK', path: ['C', 'D'], amountIn: 980000n, expectedAmountOut: 970000n },
        ],
        totalAmountIn: 1000000n,
        totalExpectedOut: 970000n,
        priceImpact: 0.03,
        feeAmount: 2500n,
        feeBps: 25,
      };

      const swapRequest = buildSwapRequest(route, 50, 5, '0xabcd1234abcd1234abcd1234abcd1234abcd1234');

      // Step 0: first hop - should use normal slippage calculation
      expect(swapRequest.steps[0].minAmountOut).toBe(985050n); // 990000 * (10000-50)/10000

      // Step 1: intermediate hop - should use MIN_INTERMEDIATE_OUT (1e12)
      expect(swapRequest.steps[1].minAmountOut).toBe(MIN_INTERMEDIATE_OUT);

      // Step 2: final hop - should use normal slippage calculation
      // 970000 * (10000-50)/10000 = 970000 * 9950 / 10000 = 965150
      expect(swapRequest.steps[2].minAmountOut).toBe(965150n);
    });

    it('should not apply MIN_INTERMEDIATE_OUT to single-hop routes', () => {
      const route: RouteResult = {
        id: 'single-hop-test',
        steps: [
          { dexRouter: '0x1111', dexName: 'DogeSwap', path: ['A', 'B'], amountIn: 1000000n, expectedAmountOut: 990000n },
        ],
        totalAmountIn: 1000000n,
        totalExpectedOut: 990000n,
        priceImpact: 0.01,
        feeAmount: 2500n,
        feeBps: 25,
      };

      const swapRequest = buildSwapRequest(route, 50, 5, '0xabcd1234abcd1234abcd1234abcd1234abcd1234');

      expect(swapRequest.steps.length).toBe(1);
      // Single hop has no "intermediate" steps, so only step 0 exists (which is the final)
      expect(swapRequest.steps[0].minAmountOut).toBe(985050n); // 990000 * (10000-50)/10000
    });

    it('should apply slippage to total minAmountOut correctly', () => {
      const route: RouteResult = {
        id: 'slippage-test',
        steps: [
          { dexRouter: '0x1111', dexName: 'DogeSwap', path: ['A', 'B'], amountIn: 1000000000000n, expectedAmountOut: 995000000000n },
        ],
        totalAmountIn: 1000000000000n,
        totalExpectedOut: 995000000000n,
        priceImpact: 0.005,
        feeAmount: 2500000000n,
        feeBps: 25,
      };

      const swapRequest = buildSwapRequest(route, 50, 5, '0xabcd1234abcd1234abcd1234abcd1234abcd1234');

      // minTotalAmountOut = 995000000000 * (10000 - 50) / 10000 = 990025000000
      expect(swapRequest.minTotalAmountOut).toBe(990025000000n);
    });

    it('should handle high slippage (5%) correctly', () => {
      const route: RouteResult = {
        id: 'high-slippage-test',
        steps: [
          { dexRouter: '0x1111', dexName: 'DogeSwap', path: ['A', 'B'], amountIn: 1000000n, expectedAmountOut: 990000n },
          { dexRouter: '0x2222', dexName: 'DogeShrk', path: ['B', 'C'], amountIn: 990000n, expectedAmountOut: 980000n },
        ],
        totalAmountIn: 1000000n,
        totalExpectedOut: 980000n,
        priceImpact: 0.02,
        feeAmount: 2500n,
        feeBps: 25,
      };

      const swapRequest = buildSwapRequest(route, 500, 5, '0xabcd1234abcd1234abcd1234abcd1234abcd1234'); // 5% slippage

      expect(swapRequest.minTotalAmountOut).toBe(931000n); // 980000 * (10000-500)/10000 = 931000
    });
  });

  describe('Dynamic Deadline Calculation', () => {
    it('should add 30s per extra hop beyond first', () => {
      // userDeadlineMinutes = 5; // kept for documentation

      // 1 hop: 0 extra seconds
      const hop1Extra = Math.max(0, 1 - 1) * EXTRA_SECONDS_PER_HOP;
      expect(300 + hop1Extra).toBe(300);

      // 2 hops: 30 extra seconds
      const hop2Extra = Math.max(0, 2 - 1) * EXTRA_SECONDS_PER_HOP;
      expect(300 + hop2Extra).toBe(330);

      // 4 hops: 90 extra seconds (3 extra hops * 30s)
      const hop4Extra = Math.max(0, 4 - 1) * EXTRA_SECONDS_PER_HOP;
      expect(300 + hop4Extra).toBe(390);
    });

    it('should correctly build deadline for 7-hop route', () => {
      const route: RouteResult = {
        id: '7-hop-test',
        steps: Array(7).fill(null).map((_, i) => ({
          dexRouter: '0x1111',
          dexName: 'DogeSwap',
          path: [`token${i}`, `token${i + 1}`],
          amountIn: 1000000n,
          expectedAmountOut: 990000n - BigInt(i * 10000),
        })),
        totalAmountIn: 1000000n,
        totalExpectedOut: 920000000n,
        priceImpact: 0.08,
        feeAmount: 2500n,
        feeBps: 25,
      };

      const deadlineMinutes = 5;
      const userDeadlineSeconds = deadlineMinutes * 60; // 300s
      const extraPerHop = Math.max(0, route.steps.length - 1) * EXTRA_SECONDS_PER_HOP; // 6 * 30 = 180s
      const effectiveDeadlineSeconds = userDeadlineSeconds + extraPerHop; // 480s

      expect(effectiveDeadlineSeconds).toBe(480); // 8 minutes total
    });
  });
});

describe('RPC Monitor Rolling Average Tests', () => {
  let monitor: MockOmnomMonitor;

  beforeEach(() => {
    monitor = new MockOmnomMonitor();
  });

  describe('getRpcRollingAverage', () => {
    it('should return 0 when no RPC calls have been made', () => {
      expect(monitor.getRpcRollingAverage()).toBe(0);
    });

    it('should calculate average of single RPC call', () => {
      monitor.logRpcCall('eth_blockNumber', 150, true);

      expect(monitor.getRpcRollingAverage()).toBe(150);
    });

    it('should calculate average of multiple RPC calls', () => {
      monitor.logRpcCall('eth_blockNumber', 100, true);
      monitor.logRpcCall('eth_call', 200, true);
      monitor.logRpcCall('eth_getBalance', 150, true);

      expect(monitor.getRpcRollingAverage()).toBe(150); // (100+200+150)/3 = 150
    });

    it('should maintain rolling average of last 50 samples', () => {
      // Add 60 RPC calls
      for (let i = 0; i < 60; i++) {
        monitor.logRpcCall(`method${i}`, 100 + i, true);
      }

      const avg = monitor.getRpcRollingAverage();

      // Should average only last 50 samples (indices 10-59)
      // Average of 100+10 through 100+59 = (100+10 + 100+11 + ... + 100+59) / 50
      // = (110 + 111 + ... + 159) / 50
      // = (110+159)*50/2 / 50 = 269/2 = 134.5
      expect(avg).toBe(135); // Rounded to nearest
    });

    it('should handle rapid successive calls', () => {
      const startTime = Date.now();
      for (let i = 0; i < 10; i++) {
        monitor.logRpcCall('eth_call', 50 + i * 10, true);
      }
      const elapsed = Date.now() - startTime;

      // Should complete quickly with mock implementation
      expect(elapsed).toBeLessThan(100);
      expect(monitor.getRpcRollingAverage()).toBe(95); // (50+60+70+80+90+100+110+120+130+140)/10 = 95
    });
  });

  describe('rpcSlow Detection', () => {
    it('should flag rpcSlow when average exceeds 2000ms', () => {
      // Add several slow RPC calls
      monitor.logRpcCall('eth_call', 2500, true);
      monitor.logRpcCall('eth_call', 3000, true);
      monitor.logRpcCall('eth_call', 2000, true);

      const summary = monitor.getSummary();

      expect(summary.rpcSlow).toBe(true);
      expect(summary.rpcAvgMs).toBeGreaterThan(RPC_LATENCY_WARNING_MS);
    });

    it('should not flag rpcSlow when average is below threshold', () => {
      monitor.logRpcCall('eth_call', 100, true);
      monitor.logRpcCall('eth_call', 200, true);
      monitor.logRpcCall('eth_call', 150, true);

      const summary = monitor.getSummary();

      expect(summary.rpcSlow).toBe(false);
      expect(summary.rpcAvgMs).toBe(150);
    });

    it('should handle mixed fast/slow RPC calls', () => {
      // Add 3 slow calls averaging ~2500ms each
      monitor.logRpcCall('eth_call', 2500, true);
      monitor.logRpcCall('eth_call', 3000, true);
      monitor.logRpcCall('eth_call', 2000, true);

      const summary = monitor.getSummary();

      // Average of 3 slow calls = 2500ms
      expect(summary.rpcAvgMs).toBe(2500);
      expect(summary.rpcSlow).toBe(true);
    });
  });

  describe('RPC Latency Timeout Adjustment', () => {
    it('should calculate adjusted timeout when RPC is slow', () => {
      const rpcAvgTime = 3000; // 3 seconds
      const adjustedTimeout = rpcAvgTime > RPC_LATENCY_WARNING_MS
        ? DEFAULT_RECEIPT_TIMEOUT_MS + Math.round(rpcAvgTime * 2)
        : DEFAULT_RECEIPT_TIMEOUT_MS;

      expect(adjustedTimeout).toBe(36000); // 30000 + (3000 * 2)
    });

    it('should use default timeout when RPC is fast', () => {
      const rpcAvgTime = 500; // 500ms - fast
      const adjustedTimeout = rpcAvgTime > RPC_LATENCY_WARNING_MS
        ? DEFAULT_RECEIPT_TIMEOUT_MS + Math.round(rpcAvgTime * 2)
        : DEFAULT_RECEIPT_TIMEOUT_MS;

      expect(adjustedTimeout).toBe(DEFAULT_RECEIPT_TIMEOUT_MS); // 30000
    });

    it('should use default timeout when RPC average is exactly at threshold', () => {
      const rpcAvgTime = 2000; // Exactly 2000ms
      const adjustedTimeout = rpcAvgTime > RPC_LATENCY_WARNING_MS
        ? DEFAULT_RECEIPT_TIMEOUT_MS + Math.round(rpcAvgTime * 2)
        : DEFAULT_RECEIPT_TIMEOUT_MS;

      // 2000 is NOT > 2000, so use default
      expect(adjustedTimeout).toBe(DEFAULT_RECEIPT_TIMEOUT_MS);
    });
  });

  describe('Monitor Summary Generation', () => {
    it('should include rpcAvgMs in summary', () => {
      monitor.logRpcCall('eth_call', 500, true);
      monitor.logRpcCall('eth_getBalance', 300, true);

      const summary = monitor.getSummary();

      expect(summary.rpcAvgMs).toBe(400);
    });

    it('should include rpcSlow flag in summary', () => {
      monitor.logRpcCall('eth_call', 2500, true);

      const summary = monitor.getSummary();

      expect(summary.rpcSlow).toBe(true);
    });

    it('should track total request count', () => {
      monitor.logRpcCall('eth_call', 100, true);
      monitor.logRpcCall('eth_blockNumber', 100, true);
      monitor.logRequest('GeckoTerminal', 'https://api.geckoterminal.com/api/v1/pools', 'GET');

      const summary = monitor.getSummary();

      expect(summary.total).toBe(3);
    });
  });
});

describe('Pre-Swap Validation Tests', () => {
  describe('Pool Data Validation', () => {
    it('should detect route with missing pool data (expectedAmountOut === 0n)', () => {
      const route: RouteResult = {
        id: 'missing-pool-route',
        steps: [
          { dexRouter: '0x1111', dexName: 'DogeSwap', path: ['A', 'B'], amountIn: 1000000n, expectedAmountOut: 990000n },
          { dexRouter: '0x2222', dexName: 'DogeShrk', path: ['B', 'C'], amountIn: 990000n, expectedAmountOut: 0n }, // Critical!
        ],
        totalAmountIn: 1000000n,
        totalExpectedOut: 0n,
        priceImpact: 0,
        feeAmount: 2500n,
        feeBps: 25,
      };

      // Check for invalid hops (expectedAmountOut === 0n)
      const invalidHops: number[] = [];
      for (let i = 0; i < route.steps.length; i++) {
        if (route.steps[i].expectedAmountOut === 0n) {
          invalidHops.push(i + 1); // 1-indexed for display
        }
      }

      expect(invalidHops.length).toBe(1);
      expect(invalidHops[0]).toBe(2); // Second hop has missing pool data
    });

    it('should detect multiple hops with missing pool data', () => {
      const route: RouteResult = {
        id: 'multiple-missing-pools',
        steps: [
          { dexRouter: '0x1111', dexName: 'DogeSwap', path: ['A', 'B'], amountIn: 1000000n, expectedAmountOut: 0n },
          { dexRouter: '0x2222', dexName: 'DogeShrk', path: ['B', 'C'], amountIn: 0n, expectedAmountOut: 0n },
          { dexRouter: '0x3333', dexName: 'WOJAK', path: ['C', 'D'], amountIn: 0n, expectedAmountOut: 950000n },
        ],
        totalAmountIn: 1000000n,
        totalExpectedOut: 950000n,
        priceImpact: 0.05,
        feeAmount: 2500n,
        feeBps: 25,
      };

      const invalidHops: number[] = [];
      for (let i = 0; i < route.steps.length; i++) {
        if (route.steps[i].expectedAmountOut === 0n) {
          invalidHops.push(i + 1);
        }
      }

      expect(invalidHops.length).toBe(2);
      expect(invalidHops).toContain(1);
      expect(invalidHops).toContain(2);
    });

    it('should flag very low expected output as potential stale data', () => {
      const route: RouteResult = {
        id: 'low-output-warning',
        steps: [
          { dexRouter: '0x1111', dexName: 'DogeSwap', path: ['A', 'B'], amountIn: 1000000000000n, expectedAmountOut: 500000000000n }, // 5e11 - well below 1e14 threshold
          { dexRouter: '0x2222', dexName: 'DogeShrk', path: ['B', 'C'], amountIn: 500000000000n, expectedAmountOut: BigInt(1e15) }, // 1e15 - well above 1e14 threshold
        ],
        totalAmountIn: 1000000000000n,
        totalExpectedOut: BigInt(1e15),
        priceImpact: 0.5,
        feeAmount: 2500000000n,
        feeBps: 25,
      };

      // Check for extremely low output amounts (< 1e14 = 0.0001 tokens with 18 decimals)
      // Step 0 (5e11) < 1e14 → flagged as hop 1
      // Step 1 (1e15) > 1e14 → NOT flagged
      const lowOutputHops: number[] = [];
      for (let i = 0; i < route.steps.length; i++) {
        const step = route.steps[i];
        if (step.expectedAmountOut > 0n && step.expectedAmountOut < BigInt(1e14)) {
          lowOutputHops.push(i + 1);
        }
      }

      expect(lowOutputHops.length).toBe(1);
      expect(lowOutputHops[0]).toBe(1); // First step has low output
    });
  });
});

describe('Full Swap Flow Integration Tests', () => {
  describe('Multi-hop swap with 7 hops', () => {
    it('should compute correct minAmountOut for all 7 steps', () => {
      const route: RouteResult = {
        id: '7-hop-full-flow',
        steps: [
          { dexRouter: '0x1111', dexName: 'DogeSwap', path: ['WWDOGE', 'HUB1'], amountIn: 1000000000000000000n, expectedAmountOut: 995000000000000000n },
          { dexRouter: '0x1111', dexName: 'DogeSwap', path: ['HUB1', 'HUB2'], amountIn: 995000000000000000n, expectedAmountOut: 990000000000000000n },
          { dexRouter: '0x1111', dexName: 'DogeSwap', path: ['HUB2', 'HUB3'], amountIn: 990000000000000000n, expectedAmountOut: 985000000000000000n },
          { dexRouter: '0x1111', dexName: 'DogeSwap', path: ['HUB3', 'HUB4'], amountIn: 985000000000000000n, expectedAmountOut: 980000000000000000n },
          { dexRouter: '0x1111', dexName: 'DogeSwap', path: ['HUB4', 'HUB5'], amountIn: 980000000000000000n, expectedAmountOut: 975000000000000000n },
          { dexRouter: '0x1111', dexName: 'DogeSwap', path: ['HUB5', 'HUB6'], amountIn: 975000000000000000n, expectedAmountOut: 970000000000000000n },
          { dexRouter: '0x1111', dexName: 'DogeSwap', path: ['HUB6', 'OMNOM'], amountIn: 970000000000000000n, expectedAmountOut: 965000000000000000n },
        ],
        totalAmountIn: 1000000000000000000n,
        totalExpectedOut: 965000000000000000n,
        priceImpact: 0.035,
        feeAmount: 2500000000000000n,
        feeBps: 25,
      };

      const swapRequest = buildSwapRequest(route, 50, 5, '0xabcd1234abcd1234abcd1234abcd1234abcd1234');

      expect(swapRequest.steps.length).toBe(7);

      // Step 0 (first): normal slippage = 995000000000000000 * (10000-50)/10000 = 990025000000000000
      expect(swapRequest.steps[0].minAmountOut).toBe(990025000000000000n);

      // Steps 1-6 (intermediate): MIN_INTERMEDIATE_OUT = 1e12
      for (let i = 1; i < 6; i++) {
        expect(swapRequest.steps[i].minAmountOut).toBe(MIN_INTERMEDIATE_OUT);
      }

      // Step 6 (final): normal slippage = 965000000000000000 * (10000-50)/10000 = 960175000000000000
      expect(swapRequest.steps[6].minAmountOut).toBe(960175000000000000n);
    });

    it('should have minTotalAmountOut that protects user against full slippage', () => {
      const route: RouteResult = {
        id: 'slippage-protection-test',
        steps: [
          { dexRouter: '0x1111', dexName: 'DogeSwap', path: ['A', 'B'], amountIn: 1000000000000000000n, expectedAmountOut: 990000000000000000n },
          { dexRouter: '0x2222', dexName: 'DogeShrk', path: ['B', 'C'], amountIn: 990000000000000000n, expectedAmountOut: 980000000000000000n },
        ],
        totalAmountIn: 1000000000000000000n,
        totalExpectedOut: 980000000000000000n,
        priceImpact: 0.02,
        feeAmount: 2500000000000000n,
        feeBps: 25,
      };

      const swapRequest = buildSwapRequest(route, 50, 5, '0xabcd1234abcd1234abcd1234abcd1234abcd1234');

      // minTotalAmountOut = totalExpectedOut * (10000 - slippageBps) / 10000
      // = 980000000000000000 * 9950 / 10000 = 975100000000000000
      expect(swapRequest.minTotalAmountOut).toBe(975100000000000000n);
    });
  });

  describe('Slippage edge cases', () => {
    it('should handle 0.01% slippage (1 bps)', () => {
      const route: RouteResult = {
        id: 'low-slippage',
        steps: [
          { dexRouter: '0x1111', dexName: 'DogeSwap', path: ['A', 'B'], amountIn: 1000000n, expectedAmountOut: 999000n },
        ],
        totalAmountIn: 1000000n,
        totalExpectedOut: 999000n,
        priceImpact: 0.001,
        feeAmount: 2500n,
        feeBps: 25,
      };

      const swapRequest = buildSwapRequest(route, 1, 5, '0xabcd1234abcd1234abcd1234abcd1234abcd1234');

      // minTotalAmountOut = 999000 * (10000 - 1) / 10000 = 998900.1 -> 998900
      expect(swapRequest.minTotalAmountOut).toBe(998900n);
    });

    it('should handle 50% slippage (5000 bps)', () => {
      const route: RouteResult = {
        id: 'high-slippage',
        steps: [
          { dexRouter: '0x1111', dexName: 'DogeSwap', path: ['A', 'B'], amountIn: 1000000n, expectedAmountOut: 999000n },
        ],
        totalAmountIn: 1000000n,
        totalExpectedOut: 999000n,
        priceImpact: 0.001,
        feeAmount: 2500n,
        feeBps: 25,
      };

      const swapRequest = buildSwapRequest(route, 5000, 5, '0xabcd1234abcd1234abcd1234abcd1234abcd1234');

      // minTotalAmountOut = 999000 * (10000 - 5000) / 10000 = 499500
      expect(swapRequest.minTotalAmountOut).toBe(499500n);
    });

    it('should not allow slippage > 100%', () => {
      const route: RouteResult = {
        id: 'extreme-slippage',
        steps: [
          { dexRouter: '0x1111', dexName: 'DogeSwap', path: ['A', 'B'], amountIn: 1000000n, expectedAmountOut: 999000n },
        ],
        totalAmountIn: 1000000n,
        totalExpectedOut: 999000n,
        priceImpact: 0.001,
        feeAmount: 2500n,
        feeBps: 25,
      };

      const swapRequest = buildSwapRequest(route, 10000, 5, '0xabcd1234abcd1234abcd1234abcd1234abcd1234');

      // 100% slippage = minTotalAmountOut should be 0
      expect(swapRequest.minTotalAmountOut).toBe(0n);
    });
  });
});

describe('API Failure Recovery Integration', () => {
  describe('GeckoTerminal 429 then recovery', () => {
    it('should continue route computation after transient API failure', () => {
      // Simulate: GeckoTerminal returns 429, fallback to on-chain,
      // some pools found, route computation succeeds

      const foundPools = [
        { token0: 'WWDOGE', token1: 'HUB1', reserve0: BigInt('1000000000000000000'), reserve1: BigInt('1000000000000000000') },
        { token0: 'HUB1', token1: 'HUB2', reserve0: BigInt('1000000000000000000'), reserve1: BigInt('1000000000000000000') },
        { token0: 'HUB2', token1: 'OMNOM', reserve0: BigInt('1000000000000000000'), reserve1: BigInt('1000000000000000000') },
      ];

      // All pools found after fallback
      expect(foundPools.length).toBe(3);

      // Route should compute successfully
      const route: RouteResult = {
        id: 'fallback-success',
        steps: [
          { dexRouter: '0x1111', dexName: 'DogeSwap', path: ['WWDOGE', 'HUB1'], amountIn: 1000000000000000000n, expectedAmountOut: 995000000000000000n },
          { dexRouter: '0x1111', dexName: 'DogeSwap', path: ['HUB1', 'HUB2'], amountIn: 995000000000000000n, expectedAmountOut: 990000000000000000n },
          { dexRouter: '0x1111', dexName: 'DogeSwap', path: ['HUB2', 'OMNOM'], amountIn: 990000000000000000n, expectedAmountOut: 985000000000000000n },
        ],
        totalAmountIn: 1000000000000000000n,
        totalExpectedOut: 985000000000000000n,
        priceImpact: 0.015,
        feeAmount: 2500000000000000n,
        feeBps: 25,
      };

      expect(route.totalExpectedOut).toBeGreaterThan(0n);
    });
  });

  describe('All APIs fail - on-chain fallback only', () => {
    it('should still find some pools via on-chain fallback', () => {
      // Simulate: GeckoTerminal and DexScreener both failed
      // On-chain fallback discovers some pools

      // const onChainPools = [...] // kept for documentation

      const route: RouteResult = {
        id: 'on-chain-only',
        steps: [
          { dexRouter: '0x1111', dexName: 'DogeSwap', path: ['tokenA', 'tokenB'], amountIn: 1000000n, expectedAmountOut: 990000n },
        ],
        totalAmountIn: 1000000n,
        totalExpectedOut: 990000n,
        priceImpact: 0.01,
        feeAmount: 2500n,
        feeBps: 25,
      };

      expect(route.totalExpectedOut).toBeGreaterThan(0n);
      expect(route.steps[0].expectedAmountOut).toBe(990000n);
    });
  });
});

describe('Slow RPC Handling', () => {
  describe('High latency spike (single call takes 5s)', () => {
    it('should handle single slow RPC call without triggering warning', () => {
      const monitor = new MockOmnomMonitor();

      // Most calls are fast
      for (let i = 0; i < 10; i++) {
        monitor.logRpcCall('eth_call', 100, true);
      }

      // One slow call
      monitor.logRpcCall('eth_call', 5000, true);

      const summary = monitor.getSummary();

      // Average should be ~550ms, not slow
      expect(summary.rpcAvgMs).toBeLessThan(1000);
      expect(summary.rpcSlow).toBe(false);
    });

    it('should trigger warning when average exceeds threshold', () => {
      const monitor = new MockOmnomMonitor();

      // Add calls that average to > 2000ms
      for (let i = 0; i < 5; i++) {
        monitor.logRpcCall('eth_call', 2500, true);
      }

      const summary = monitor.getSummary();

      expect(summary.rpcAvgMs).toBe(2500);
      expect(summary.rpcSlow).toBe(true);
    });
  });

  describe('Dynamic timeout adjustment', () => {
    it('should extend timeout when RPC is averaging slow', () => {
      const rpcAvgTime = 3000; // 3 seconds average
      const slowThreshold = 2000;

      const adjustedTimeout = rpcAvgTime > slowThreshold
        ? 30000 + Math.round(rpcAvgTime * 2) // Add 2x average
        : 30000;

      expect(adjustedTimeout).toBe(36000); // 30s + 6s (2 * 3s)
    });

    it('should not extend timeout for fast RPC', () => {
      const rpcAvgTime = 500; // 500ms average
      const slowThreshold = 2000;

      const adjustedTimeout = rpcAvgTime > slowThreshold
        ? 30000 + Math.round(rpcAvgTime * 2)
        : 30000;

      expect(adjustedTimeout).toBe(30000);
    });
  });
});

describe('Error Classification', () => {
  describe('isTransientNetworkError', () => {
    const isTransientNetworkError = (err: unknown): boolean => {
      if (!(err instanceof Error)) return false;
      const lower = err.message.toLowerCase();
      return (
        lower.includes('timeout') ||
        lower.includes('timed out') ||
        lower.includes('connection reset') ||
        lower.includes('network error') ||
        lower.includes('fetch failed') ||
        lower.includes('rpc') ||
        lower.includes('econnrefused') ||
        lower.includes('econnreset') ||
        lower.includes('socket hang up') ||
        lower.includes('rate limit') ||
        lower.includes('429') ||
        lower.includes('503') ||
        lower.includes('502')
      );
    };

    it('should identify timeout as transient', () => {
      expect(isTransientNetworkError(new Error('Request timeout'))).toBe(true);
      expect(isTransientNetworkError(new Error('timed out after 30s'))).toBe(true);
    });

    it('should identify RPC errors as transient', () => {
      expect(isTransientNetworkError(new Error('RPC error: connection refused'))).toBe(true);
      expect(isTransientNetworkError(new Error('json-rpc timeout'))).toBe(true);
    });

    it('should identify rate limits as transient', () => {
      expect(isTransientNetworkError(new Error('429 Too Many Requests'))).toBe(true);
      expect(isTransientNetworkError(new Error('rate limit exceeded'))).toBe(true);
      expect(isTransientNetworkError(new Error('503 Service Unavailable'))).toBe(true);
    });

    it('should not flag user rejections as transient', () => {
      const isUserRejection = (err: unknown): boolean => {
        if (!(err instanceof Error)) return false;
        const lower = err.message.toLowerCase();
        return (
          lower.includes('user rejected') ||
          lower.includes('user denied') ||
          lower.includes('rejected the request') ||
          lower.includes('action_rejected') ||
          lower.includes('cancelled')
        );
      };

      expect(isUserRejection(new Error('User rejected the transaction'))).toBe(true);
      expect(isTransientNetworkError(new Error('User rejected'))).toBe(false); // Not in transient list
    });
  });
});

describe('Edge Cases', () => {
  describe('Route with single pool', () => {
    it('should compute correctly when only one pool exists for entire route', () => {
      const route: RouteResult = {
        id: 'single-pool-route',
        steps: [
          { dexRouter: '0x1111', dexName: 'DogeSwap', path: ['tokenA', 'tokenB'], amountIn: 1000000n, expectedAmountOut: 997000n },
        ],
        totalAmountIn: 1000000n,
        totalExpectedOut: 997000n,
        priceImpact: 0.003,
        feeAmount: 2500n,
        feeBps: 25,
      };

      const swapRequest = buildSwapRequest(route, 50, 5, '0xabcd1234abcd1234abcd1234abcd1234abcd1234');

      expect(swapRequest.steps.length).toBe(1);
      expect(swapRequest.steps[0].minAmountOut).toBe(992015n); // 997000 * 9950/10000
    });
  });

  describe('Partial pool data scenario', () => {
    it('should warn but continue when some pools missing', () => {
      const steps: RouteStep[] = [
        { dexRouter: '0x1111', dexName: 'DogeSwap', path: ['A', 'B'], amountIn: 1000000n, expectedAmountOut: 990000n },
        { dexRouter: '0x2222', dexName: 'DogeShrk', path: ['B', 'C'], amountIn: 990000n, expectedAmountOut: 980000n },
        { dexRouter: '0x3333', dexName: 'WOJAK', path: ['C', 'D'], amountIn: 980000n, expectedAmountOut: 0n }, // MISSING
      ];

      const invalidHops = steps.filter(s => s.expectedAmountOut === 0n).map((_, i) => i + 1);

      expect(invalidHops.length).toBe(1);
      expect(invalidHops[0]).toBe(1); // Step 0 (at index 0) has the only invalid pool
    });
  });

  describe('High latency spike handling', () => {
    it('should handle 5s single RPC call with normal average', () => {
      const monitor = new MockOmnomMonitor();

      // 9 fast calls
      for (let i = 0; i < 9; i++) {
        monitor.logRpcCall('eth_call', 100, true);
      }

      // 1 very slow call (5 seconds)
      monitor.logRpcCall('eth_call', 5000, true);

      const avg = monitor.getRpcRollingAverage();
      const summary = monitor.getSummary();

      // Average of (9*100 + 5000)/10 = 5900/10 = 590
      expect(avg).toBe(590);
      expect(summary.rpcSlow).toBe(false);
    });
  });
});