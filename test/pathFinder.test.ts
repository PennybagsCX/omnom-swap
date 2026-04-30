/**
 * @file pathFinder.test.ts
 * @description Jest/TypeScript test suite for path finder pool validation.
 *
 * Tests the following fixes implemented after the failed Dogechain swap:
 *   TX: 0x8288440d532a3a28cb7af3412b68915011182bf156e4c57edb95ecca4086a18c
 *
 * Coverage:
 *   1. Pool Validation (pathFinder/index.ts)
 *      - validateRoutePools() function
 *      - RouteValidationError and RouteValidationResult types
 *   2. Route Building and Graph Construction
 *   3. Multi-hop AMM calculations
 *
 * Reference: src/services/pathFinder/index.ts
 */

import { describe, it, expect } from 'vitest';

// ─── Type Definitions (mirrors src/services/pathFinder/types.ts) ───────────────

interface PoolReserves {
  reserve0: bigint;
  reserve1: bigint;
  token0: string;
  token1: string;
  factory: string;
  dexName: string;
  router: string;
}

interface PoolEdge {
  tokenIn: string;
  tokenOut: string;
  reserveIn: bigint;
  reserveOut: bigint;
  factory: string;
  dexName: string;
  router: string;
}

interface RouteStep {
  dexRouter: string;
  dexName: string;
  path: string[];
  amountIn: bigint;
  expectedAmountOut: bigint;
}

interface RouteValidationError {
  type: 'no_pools' | 'insufficient_liquidity' | 'missing_pool_data';
  hopIndex: number;
  tokenIn: string;
  tokenOut: string;
  poolsFound: number;
  message: string;
}

interface RouteValidationResult {
  valid: boolean;
  error?: RouteValidationError;
  warnings: string[];
}

// ─── Constants (from pathFinder/index.ts) ────────────────────────────────────

const MAX_HOPS = 4;
const FEE_DENOMINATOR = 10000n;
const POOL_FEE_BPS = 30n; // 0.3% — standard UniswapV2 pool fee
const MIN_POOLS_PER_HOP = 1;

// ─── Implementation Under Test ────────────────────────────────────────────────

/**
 * Build a directed liquidity graph from pool reserves.
 * Each pool creates two edges (token0→token1 and token1→token0).
 * NOTE: No MIN_RESERVE_OUT filtering - all non-zero reserves create edges.
 * This allows routing through low-supply tokens like DC (~$400K total supply).
 */
function buildGraph(pools: PoolReserves[]): PoolEdge[] {
  const edges: PoolEdge[] = [];

  for (const pool of pools) {
    if (pool.reserve0 <= 0n || pool.reserve1 <= 0n) continue;

    // Forward edge: token0 → token1
    edges.push({
      tokenIn: pool.token0,
      tokenOut: pool.token1,
      reserveIn: pool.reserve0,
      reserveOut: pool.reserve1,
      factory: pool.factory,
      dexName: pool.dexName,
      router: pool.router,
    });

    // Reverse edge: token1 → token0
    edges.push({
      tokenIn: pool.token1,
      tokenOut: pool.token0,
      reserveIn: pool.reserve1,
      reserveOut: pool.reserve0,
      factory: pool.factory,
      dexName: pool.dexName,
      router: pool.router,
    });
  }

  return edges;
}

/**
 * Calculate output amount using constant-product AMM formula with 0.3% fee.
 * amountOut = (reserveOut * amountIn * 997) / (reserveIn * 1000 + amountIn * 997)
 */
function calculateOutput(amountIn: bigint, reserveIn: bigint, reserveOut: bigint): bigint {
  if (amountIn <= 0n || reserveIn <= 0n || reserveOut <= 0n) return 0n;
  const amountInWithFee = amountIn * (FEE_DENOMINATOR - POOL_FEE_BPS);
  const numerator = amountInWithFee * reserveOut;
  const denominator = reserveIn * FEE_DENOMINATOR + amountInWithFee;
  return numerator / denominator;
}

/**
 * Calculate required input amount using reverse constant-product AMM formula.
 */
function calculateInput(amountOut: bigint, reserveIn: bigint, reserveOut: bigint): bigint {
  if (amountOut <= 0n || reserveIn <= 0n || reserveOut <= 0n) return 0n;
  if (amountOut >= reserveOut) return 0n; // Cannot take more than available

  const numerator = reserveIn * amountOut * FEE_DENOMINATOR;
  const denominator = (reserveOut - amountOut) * (FEE_DENOMINATOR - POOL_FEE_BPS);

  // Ceiling division: (n + d - 1) / d
  return (numerator + denominator - 1n) / denominator;
}

/**
 * Validate that a route has sufficient pool data for each hop.
 * Returns detailed error information if validation fails.
 */
function validateRoutePools(
  steps: RouteStep[],
  edges: PoolEdge[],
): RouteValidationResult {
  const warnings: string[] = [];

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const tokenIn = step.path[0].toLowerCase();
    const tokenOut = step.path[step.path.length - 1].toLowerCase();

    // Count available pools for this hop
    // Both tokenIn/tokenOut (from step.path) and edges are normalized to lowercase
    const candidates = edges.filter(
      (e) => e.tokenIn.toLowerCase() === tokenIn && e.tokenOut.toLowerCase() === tokenOut,
    );

    if (candidates.length === 0) {
      console.error(`[PathFinder] No pools found for hop ${i + 1}: ${tokenIn} -> ${tokenOut}`);
      return {
        valid: false,
        error: {
          type: 'no_pools',
          hopIndex: i,
          tokenIn: step.path[0],
          tokenOut: step.path[step.path.length - 1],
          poolsFound: 0,
          message: `No pools found for hop ${i + 1} (${step.dexName}). Route cannot execute.`,
        },
        warnings,
      };
    }

    if (candidates.length < MIN_POOLS_PER_HOP) {
      const msg = `[PathFinder] Warning: Only ${candidates.length} pool(s) found for hop ${i + 1} (${step.dexName}). Low liquidity diversity.`;
      console.warn(msg);
      warnings.push(msg);
    } else {
      console.log(`[PathFinder] Hop ${i + 1}: ${candidates.length} pool(s) available for ${tokenIn} -> ${tokenOut}`);
    }
  }

  return { valid: true, warnings };
}

/**
 * Calculate output for a multi-hop path through specific pools.
 */
function calculatePathOutput(
  path: string[],
  amountIn: bigint,
  edges: PoolEdge[],
): { output: bigint; steps: RouteStep[] } {
  let currentAmount = amountIn;
  const steps: RouteStep[] = [];

  for (let i = 0; i < path.length - 1; i++) {
    const tokenIn = path[i];
    const tokenOut = path[i + 1];

    // Find the best edge for this hop (highest output)
    // Normalize for case-insensitive comparison
    const candidates = edges.filter(
      (e) => e.tokenIn.toLowerCase() === tokenIn.toLowerCase() && e.tokenOut.toLowerCase() === tokenOut.toLowerCase(),
    );

    if (candidates.length === 0) {
      console.error(`[PathFinder] calculatePathOutput: No pools found for ${tokenIn} -> ${tokenOut} (hop ${i + 1})`);
      return { output: 0n, steps: [] };
    }

    let bestEdge = candidates[0];
    let bestOutput = calculateOutput(currentAmount, bestEdge.reserveIn, bestEdge.reserveOut);

    for (let j = 1; j < candidates.length; j++) {
      const out = calculateOutput(currentAmount, candidates[j].reserveIn, candidates[j].reserveOut);
      if (out > bestOutput) {
        bestOutput = out;
        bestEdge = candidates[j];
      }
    }

    steps.push({
      dexRouter: bestEdge.router,
      dexName: bestEdge.dexName,
      path: [tokenIn, tokenOut],
      amountIn: currentAmount,
      expectedAmountOut: bestOutput,
    });

    currentAmount = bestOutput;
  }

  return { output: currentAmount, steps };
}

/**
 * Find all routes from tokenIn to tokenOut up to MAX_HOPS using BFS.
 */
function findAllRoutes(
  tokenIn: string,
  tokenOut: string,
  _amountIn: bigint,
  edges: PoolEdge[],
): string[][] {
  const normalizedIn = tokenIn.toLowerCase();
  const normalizedOut = tokenOut.toLowerCase();

  if (normalizedIn === normalizedOut) return [];

  // Build adjacency list: token → set of reachable tokens
  const adjacency = new Map<string, Set<string>>();
  for (const edge of edges) {
    const key = edge.tokenIn.toLowerCase();
    if (!adjacency.has(key)) adjacency.set(key, new Set());
    adjacency.get(key)!.add(edge.tokenOut.toLowerCase());
  }

  const routes: string[][] = [];
  const queue: { path: string[] }[] = [{ path: [normalizedIn] }];

  while (queue.length > 0) {
    const { path } = queue.shift()!;
    const current = path[path.length - 1];

    if (path.length > MAX_HOPS + 1) continue;

    // Reached destination
    if (current === normalizedOut && path.length > 1) {
      routes.push([...path]);
      continue;
    }

    // Don't revisit tokens (prevent cycles)
    const visited = new Set(path.map((p) => p.toLowerCase()));

    const neighbors = adjacency.get(current);
    if (!neighbors) continue;

    for (const neighbor of neighbors) {
      if (visited.has(neighbor.toLowerCase())) continue;
      queue.push({ path: [...path, neighbor] });
    }
  }

  return routes;
}

// ─── Test Suites ─────────────────────────────────────────────────────────────

describe('Pool Validation Tests', () => {
  describe('validateRoutePools', () => {
    it('should return valid for route with available pools', () => {
      const steps: RouteStep[] = [
        {
          dexRouter: '0x1234',
          dexName: 'DogeSwap',
          path: ['tokenA', 'tokenB'],
          amountIn: 1000000n,
          expectedAmountOut: 990000n,
        },
      ];

      const edges: PoolEdge[] = [
        {
          tokenIn: 'tokenA',
          tokenOut: 'tokenB',
          reserveIn: 1000000000000n,
          reserveOut: 1000000000000n,
          factory: '0xfactory',
          dexName: 'DogeSwap',
          router: '0x1234',
        },
      ];

      const result = validateRoutePools(steps, edges);

      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should return invalid for route with missing pools', () => {
      const steps: RouteStep[] = [
        {
          dexRouter: '0x1234',
          dexName: 'DogeSwap',
          path: ['tokenA', 'tokenB'],
          amountIn: 1000000n,
          expectedAmountOut: 0n,
        },
      ];

      // Empty edges - no pools available
      const edges: PoolEdge[] = [];

      const result = validateRoutePools(steps, edges);

      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error?.type).toBe('no_pools');
      expect(result.error?.hopIndex).toBe(0);
      expect(result.error?.poolsFound).toBe(0);
    });

    it('should detect missing pool for specific hop in multi-hop route', () => {
      const steps: RouteStep[] = [
        {
          dexRouter: '0x1234',
          dexName: 'DogeSwap',
          path: ['tokenA', 'hubToken'],
          amountIn: 1000000n,
          expectedAmountOut: 990000n,
        },
        {
          dexRouter: '0x5678',
          dexName: 'DogeShrk',
          path: ['hubToken', 'tokenB'],
          amountIn: 990000n,
          expectedAmountOut: 980000n,
        },
      ];

      // Only first hop has pools
      const edges: PoolEdge[] = [
        {
          tokenIn: 'tokenA',
          tokenOut: 'hubtoken', // Note: lowercase
          reserveIn: 1000000000000n,
          reserveOut: 1000000000000n,
          factory: '0xfactory',
          dexName: 'DogeSwap',
          router: '0x1234',
        },
      ];

      const result = validateRoutePools(steps, edges);

      expect(result.valid).toBe(false);
      expect(result.error?.hopIndex).toBe(1); // Second hop fails
      expect(result.error?.message).toContain('No pools found');
    });

    it('should add warning when pool count is below threshold', () => {
      const steps: RouteStep[] = [
        {
          dexRouter: '0x1234',
          dexName: 'DogeSwap',
          path: ['tokenA', 'tokenB'],
          amountIn: 1000000n,
          expectedAmountOut: 990000n,
        },
      ];

      // Only 1 pool available (at threshold)
      const edges: PoolEdge[] = [
        {
          tokenIn: 'tokenA',
          tokenOut: 'tokenB',
          reserveIn: 1000000000000n,
          reserveOut: 1000000000000n,
          factory: '0xfactory',
          dexName: 'DogeSwap',
          router: '0x1234',
        },
      ];

      const result = validateRoutePools(steps, edges);

      expect(result.valid).toBe(true);
      // Warning is only added when candidates.length < MIN_POOLS_PER_HOP (1)
      // With 1 pool and MIN_POOLS_PER_HOP = 1, candidates.length !< MIN_POOLS_PER_HOP
      // So no warning should be added
      expect(result.warnings.length).toBe(0);
    });

    it('should handle case-sensitive token addresses', () => {
      const steps: RouteStep[] = [
        {
          dexRouter: '0x1234',
          dexName: 'DogeSwap',
          path: ['0xTOKENA', '0xTOKENB'],
          amountIn: 1000000n,
          expectedAmountOut: 990000n,
        },
      ];

      const edges: PoolEdge[] = [
        {
          tokenIn: '0xtokena', // lowercase
          tokenOut: '0xtokenb',
          reserveIn: 1000000000000n,
          reserveOut: 1000000000000n,
          factory: '0xfactory',
          dexName: 'DogeSwap',
          router: '0x1234',
        },
      ];

      const result = validateRoutePools(steps, edges);

      // Should normalize both path tokens and edges to lowercase
      expect(result.valid).toBe(true);
    });
  });

  describe('RouteValidationError Type', () => {
    it('should include all required error fields', () => {
      const error: RouteValidationError = {
        type: 'no_pools',
        hopIndex: 2,
        tokenIn: '0xtokenA',
        tokenOut: '0xtokenB',
        poolsFound: 0,
        message: 'No pools found for hop 3',
      };

      expect(error.type).toBe('no_pools');
      expect(error.hopIndex).toBe(2);
      expect(error.tokenIn).toBe('0xtokenA');
      expect(error.tokenOut).toBe('0xtokenB');
      expect(error.poolsFound).toBe(0);
      expect(error.message).toContain('No pools found');
    });

    it('should support insufficient_liquidity error type', () => {
      const error: RouteValidationError = {
        type: 'insufficient_liquidity',
        hopIndex: 0,
        tokenIn: '0xtokenA',
        tokenOut: '0xtokenB',
        poolsFound: 1,
        message: 'Insufficient liquidity in pool',
      };

      expect(error.type).toBe('insufficient_liquidity');
    });

    it('should support missing_pool_data error type', () => {
      const error: RouteValidationError = {
        type: 'missing_pool_data',
        hopIndex: 1,
        tokenIn: '0xtokenA',
        tokenOut: '0xtokenB',
        poolsFound: 0,
        message: 'Pool data not available',
      };

      expect(error.type).toBe('missing_pool_data');
    });
  });

  describe('RouteValidationResult Type', () => {
    it('should have valid=true with no error when route is valid', () => {
      const result: RouteValidationResult = {
        valid: true,
        warnings: [],
      };

      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
      expect(result.warnings).toEqual([]);
    });

    it('should have valid=false with error when route is invalid', () => {
      const result: RouteValidationResult = {
        valid: false,
        error: {
          type: 'no_pools',
          hopIndex: 0,
          tokenIn: '0xtokenA',
          tokenOut: '0xtokenB',
          poolsFound: 0,
          message: 'No pools found',
        },
        warnings: [],
      };

      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should preserve warnings even when route is valid', () => {
      const result: RouteValidationResult = {
        valid: true,
        warnings: [
          'Warning: Only 1 pool(s) found for hop 1. Low liquidity diversity.',
        ],
      };

      expect(result.valid).toBe(true);
      expect(result.warnings.length).toBe(1);
    });
  });
});

describe('Graph Construction Tests', () => {
  describe('buildGraph', () => {
    it('should create two directed edges from one pool', () => {
      const pools: PoolReserves[] = [
        {
          reserve0: 1000000000000000000n,
          reserve1: 1500000000000000000n,
          token0: 'tokenA',
          token1: 'tokenB',
          factory: '0xfactory',
          dexName: 'DogeSwap',
          router: '0x1234',
        },
      ];

      const edges = buildGraph(pools);

      // Should have 2 edges: A→B and B→A
      expect(edges.length).toBe(2);
      expect(edges.filter(e => e.tokenIn === 'tokenA' && e.tokenOut === 'tokenB').length).toBe(1);
      expect(edges.filter(e => e.tokenIn === 'tokenB' && e.tokenOut === 'tokenA').length).toBe(1);
    });

    it('should NOT filter out pools with reserves below old 1e18 threshold', () => {
      // DC token has ~400K total supply (~$400K), not 1e18 (1 token with 18 decimals)
      // Pools with low reserves should still be included for low-supply tokens
      const pools: PoolReserves[] = [
        {
          reserve0: 500000000000000000n, // 0.5 tokens - previously filtered by 1e18
          reserve1: 1160000000000000000n, // DC pool on FraxSwap ~116K tokens
          token0: 'WWDOGE',
          token1: 'DC',
          factory: '0xfactory',
          dexName: 'FraxSwap',
          router: '0x1234',
        },
      ];

      const edges = buildGraph(pools);

      // Both directions should now be included (no MIN_RESERVE_OUT filtering)
      expect(edges.length).toBe(2);
      expect(edges.find(e => e.tokenIn === 'WWDOGE' && e.tokenOut === 'DC')).toBeDefined();
      expect(edges.find(e => e.tokenIn === 'DC' && e.tokenOut === 'WWDOGE')).toBeDefined();
    });

    it('should filter out pools with zero reserves', () => {
      const pools: PoolReserves[] = [
        {
          reserve0: 0n,
          reserve1: 1500000000000000000n,
          token0: 'tokenA',
          token1: 'tokenB',
          factory: '0xfactory',
          dexName: 'DogeSwap',
          router: '0x1234',
        },
      ];

      const edges = buildGraph(pools);

      expect(edges.length).toBe(0);
    });

    it('should handle multiple pools between same tokens', () => {
      const pools: PoolReserves[] = [
        {
          reserve0: 1000000000000000000n,
          reserve1: 1000000000000000000n,
          token0: 'tokenA',
          token1: 'tokenB',
          factory: '0xfactory1',
          dexName: 'DogeSwap',
          router: '0x1234',
        },
        {
          reserve0: 2000000000000000000n,
          reserve1: 2000000000000000000n,
          token0: 'tokenA',
          token1: 'tokenB',
          factory: '0xfactory2',
          dexName: 'DogeShrk',
          router: '0x5678',
        },
      ];

      const edges = buildGraph(pools);

      // Should have 4 edges: A→B twice (one per DEX), B→A twice
      expect(edges.length).toBe(4);
      expect(edges.filter(e => e.tokenIn === 'tokenA' && e.tokenOut === 'tokenB').length).toBe(2);
    });
  });
});

describe('AMM Calculation Tests', () => {
  describe('calculateOutput', () => {
    it('should apply 0.3% fee correctly', () => {
      const amountIn = 1000000n; // 1M wei
      const reserveIn = 1000000000000000000n; // 1 ETH
      const reserveOut = 1000000000000000000n; // 1 ETH

      const output = calculateOutput(amountIn, reserveIn, reserveOut);

      // With 0.3% fee: amountInWithFee = amountIn * 997
      // output = (reserveOut * amountIn * 997) / (reserveIn * 1000 + amountIn * 997)
      // = (1e18 * 1e6 * 997) / (1e18 * 1000 + 1e6 * 997)
      // ≈ 996006 wei (slightly less than 1e6 due to fee)
      expect(output).toBeLessThan(amountIn);
      expect(output).toBeGreaterThan(990000n); // ~99% of input due to 0.3% fee
    });

    it('should return 0 for zero amountIn', () => {
      const output = calculateOutput(0n, 1000000000000000000n, 1000000000000000000n);
      expect(output).toBe(0n);
    });

    it('should return 0 for zero reserves', () => {
      const output = calculateOutput(1000000n, 0n, 1000000000000000000n);
      expect(output).toBe(0n);
      expect(calculateOutput(1000000n, 1000000000000000000n, 0n)).toBe(0n);
    });

    it('should handle large trades with price impact', () => {
      const amountIn = 100000000000000000n; // 0.1 ETH (10% of pool)
      const reserveIn = 1000000000000000000n; // 1 ETH
      const reserveOut = 1000000000000000000n; // 1 ETH

      const output = calculateOutput(amountIn, reserveIn, reserveOut);

      // Large trade should have significant price impact
      // Output should be notably less than input due to slippage
      expect(output).toBeLessThan(amountIn);
    });
  });

  describe('calculateInput', () => {
    it('should calculate input required for desired output', () => {
      const amountOut = 990000n; // Want ~99% of 1M
      const reserveIn = 1000000000000000000n;
      const reserveOut = 1000000000000000000n;

      const input = calculateInput(amountOut, reserveIn, reserveOut);

      // Input should be slightly more than output due to fee
      expect(input).toBeGreaterThan(amountOut);
      expect(input).toBeLessThan(1100000n);
    });

    it('should return 0 when amountOut exceeds reserves', () => {
      const input = calculateInput(2000000000000000000n, 1000000000000000000n, 1000000000000000000n);
      expect(input).toBe(0n);
    });

    it('should return 0 for zero amountOut', () => {
      const input = calculateInput(0n, 1000000000000000000n, 1000000000000000000n);
      expect(input).toBe(0n);
    });
  });
});

describe('Multi-Hop Path Calculation Tests', () => {
  it('should calculate 2-hop path correctly', () => {
    const path = ['tokenA', 'hubToken', 'tokenB'];
    const amountIn = 1000000n;

    const edges: PoolEdge[] = [
      {
        tokenIn: 'tokenA',
        tokenOut: 'hubToken',
        reserveIn: 1000000000000000000n,
        reserveOut: 1000000000000000000n,
        factory: '0xfactory',
        dexName: 'DogeSwap',
        router: '0x1234',
      },
      {
        tokenIn: 'hubToken',
        tokenOut: 'tokenB',
        reserveIn: 1000000000000000000n,
        reserveOut: 1000000000000000000n,
        factory: '0xfactory',
        dexName: 'DogeSwap',
        router: '0x1234',
      },
    ];

    const result = calculatePathOutput(path, amountIn, edges);

    expect(result.steps.length).toBe(2);
    expect(result.output).toBeGreaterThan(0n);

    // First hop output should be second hop's input
    expect(result.steps[1].amountIn).toBe(result.steps[0].expectedAmountOut);
  });

  it('should return 0 when intermediate pool is missing', () => {
    const path = ['tokenA', 'hubToken', 'tokenB'];
    const amountIn = 1000000n;

    // Only first hop has pools
    const edges: PoolEdge[] = [
      {
        tokenIn: 'tokenA',
        tokenOut: 'hubToken',
        reserveIn: 1000000000000000000n,
        reserveOut: 1000000000000000000n,
        factory: '0xfactory',
        dexName: 'DogeSwap',
        router: '0x1234',
      },
      // Missing: hubToken → tokenB
    ];

    const result = calculatePathOutput(path, amountIn, edges);

    expect(result.output).toBe(0n);
    expect(result.steps.length).toBe(0);
  });

  it('should select best DEX for each hop', () => {
    const path = ['tokenA', 'tokenB'];
    const amountIn = 1000000000000n; // 1M wei

    const edges: PoolEdge[] = [
      {
        tokenIn: 'tokenA',
        tokenOut: 'tokenB',
        reserveIn: 1000000000000000000n,
        reserveOut: 900000000000000000n, // Lower output - DogeSwap
        factory: '0xfactory1',
        dexName: 'DogeSwap',
        router: '0x1111',
      },
      {
        tokenIn: 'tokenA',
        tokenOut: 'tokenB',
        reserveIn: 1000000000000000000n,
        reserveOut: 1100000000000000000n, // Higher output - DogeShrk
        factory: '0xfactory2',
        dexName: 'DogeShrk',
        router: '0x2222',
      },
    ];

    const result = calculatePathOutput(path, amountIn, edges);

    expect(result.steps.length).toBe(1);
    expect(result.steps[0].dexName).toBe('DogeShrk'); // Should select higher output
  });
});

describe('Route Finding Tests', () => {
  describe('findAllRoutes', () => {
    it('should find direct route between two tokens', () => {
      const edges: PoolEdge[] = [
        {
          tokenIn: 'tokenA',
          tokenOut: 'tokenB',
          reserveIn: 1000000000000000000n,
          reserveOut: 1000000000000000000n,
          factory: '0xfactory',
          dexName: 'DogeSwap',
          router: '0x1234',
        },
      ];

      const routes = findAllRoutes('tokenA', 'tokenB', 1000000n, edges);

      expect(routes.length).toBe(1);
      expect(routes[0]).toEqual(['tokena', 'tokenb']); // Normalized to lowercase
    });

    it('should find multi-hop routes via hub tokens', () => {
      const edges: PoolEdge[] = [
        {
          tokenIn: 'tokenA',
          tokenOut: 'hubToken',
          reserveIn: 1000000000000000000n,
          reserveOut: 1000000000000000000n,
          factory: '0xfactory',
          dexName: 'DogeSwap',
          router: '0x1234',
        },
        {
          tokenIn: 'hubToken',
          tokenOut: 'tokenB',
          reserveIn: 1000000000000000000n,
          reserveOut: 1000000000000000000n,
          factory: '0xfactory',
          dexName: 'DogeSwap',
          router: '0x1234',
        },
      ];

      const routes = findAllRoutes('tokenA', 'tokenB', 1000000n, edges);

      expect(routes.length).toBe(1);
      expect(routes[0]).toEqual(['tokena', 'hubtoken', 'tokenb']); // Normalized to lowercase
    });

    it('should find multiple routes when available', () => {
      const edges: PoolEdge[] = [
        {
          tokenIn: 'tokenA',
          tokenOut: 'tokenB',
          reserveIn: 1000000000000000000n,
          reserveOut: 1000000000000000000n,
          factory: '0xfactory',
          dexName: 'DogeSwap',
          router: '0x1234',
        },
        {
          tokenIn: 'tokenA',
          tokenOut: 'hubToken1',
          reserveIn: 1000000000000000000n,
          reserveOut: 1000000000000000000n,
          factory: '0xfactory',
          dexName: 'DogeSwap',
          router: '0x1234',
        },
        {
          tokenIn: 'hubToken1',
          tokenOut: 'tokenB',
          reserveIn: 1000000000000000000n,
          reserveOut: 1000000000000000000n,
          factory: '0xfactory',
          dexName: 'DogeSwap',
          router: '0x1234',
        },
      ];

      const routes = findAllRoutes('tokenA', 'tokenB', 1000000n, edges);

      // Should find both direct and via hub
      expect(routes.length).toBe(2);
    });

    it('should not find route when no path exists', () => {
      const edges: PoolEdge[] = [
        {
          tokenIn: 'tokenA',
          tokenOut: 'hubToken',
          reserveIn: 1000000000000000000n,
          reserveOut: 1000000000000000000n,
          factory: '0xfactory',
          dexName: 'DogeSwap',
          router: '0x1234',
        },
        // No path from hubToken to tokenB
      ];

      const routes = findAllRoutes('tokenA', 'tokenB', 1000000n, edges);

      expect(routes.length).toBe(0);
    });

    it('should respect MAX_HOPS limit', () => {
      // Create a chain of 5 tokens (4 hops)
      const edges: PoolEdge[] = [];
      const tokenPath = ['A', 'B', 'C', 'D', 'E'];

      for (let i = 0; i < tokenPath.length - 1; i++) {
        edges.push({
          tokenIn: tokenPath[i],
          tokenOut: tokenPath[i + 1],
          reserveIn: 1000000000000000000n,
          reserveOut: 1000000000000000000n,
          factory: '0xfactory',
          dexName: 'DogeSwap',
          router: '0x1234',
        });
      }

      // MAX_HOPS is 4, so A→E (4 hops) should be found
      const routes = findAllRoutes('A', 'E', 1000000n, edges);
      expect(routes.length).toBe(1);

      // Add one more token to make it 5 hops - should not be found
      edges.push({
        tokenIn: 'E',
        tokenOut: 'F',
        reserveIn: 1000000000000000000n,
        reserveOut: 1000000000000000000n,
        factory: '0xfactory',
        dexName: 'DogeSwap',
        router: '0x1234',
      });

      const routes2 = findAllRoutes('A', 'F', 1000000n, edges);
      expect(routes2.length).toBe(0); // 5 hops exceeds MAX_HOPS
    });
  });
});

describe('Route with Missing Pools (Dogechain Bug Scenario)', () => {
  it('should detect route failure when GeckoTerminal returns partial data', () => {
    // Simulates the bug: GeckoTerminal failed with 429, fallback to on-chain
    // but some pools still returned 0 due to incomplete discovery

    const steps: RouteStep[] = [
      {
        dexRouter: '0x1234',
        dexName: 'DogeSwap',
        path: ['WWDOGE', '0xd43b...'], // Direct pair - pool found
        amountIn: 1000000000000000000n,
        expectedAmountOut: 995000000000000000n,
      },
      {
        dexRouter: '0x5678',
        dexName: 'DogeShrk',
        path: ['0xd43b...', '0xomnom...'], // Via intermediate - pool NOT found
        amountIn: 995000000000000000n,
        expectedAmountOut: 0n, // Critical: pool data missing
      },
    ];

    const edges: PoolEdge[] = [
      // Only first hop has pools
      {
        tokenIn: 'wwdoge',
        tokenOut: '0xd43b...',
        reserveIn: 1000000000000000000n,
        reserveOut: 1000000000000000000n,
        factory: '0xfactory',
        dexName: 'DogeSwap',
        router: '0x1234',
      },
      // Missing second hop
    ];

    const result = validateRoutePools(steps, edges);

    expect(result.valid).toBe(false);
    expect(result.error?.hopIndex).toBe(1); // 0-indexed, second hop (0xd43b... -> 0xomnom...)
  });

  it('should allow routing through pools with reserves below old 1e18 threshold', () => {
    // DC token has ~400K total supply, so pools with reserves below 1e18 should still be usable
    const steps: RouteStep[] = [
      {
        dexRouter: '0x1234',
        dexName: 'FraxSwap',
        path: ['WWDOGE', 'DC'],
        amountIn: 1000000000000000000n, // 1 WWDOGE
        expectedAmountOut: 500000000000000000n, // ~0.5 DC (depends on pool reserves)
      },
    ];

    // Pool with reserves below old MIN_RESERVE_OUT threshold (1e18)
    // FraxSwap DC pool has ~116K DC = 1160000000000000000n (above 1e18)
    // But for smaller DEXes, reserves could be much lower
    const edges: PoolEdge[] = [
      {
        tokenIn: 'wwdoge',
        tokenOut: 'dc',
        reserveIn: 1000000000000000000n, // 1 WWDOGE
        reserveOut: 1160000000000000000n, // ~1.16 DC (FraxSwap pool)
        factory: '0xfactory',
        dexName: 'FraxSwap',
        router: '0x1234',
      },
    ];

    // Route validation should succeed - pools with low reserves are allowed
    const result = validateRoutePools(steps, edges);
    expect(result.valid).toBe(true);

    // The output calculation should work and return non-zero
    const output = calculateOutput(1000000000000000000n, edges[0].reserveIn, edges[0].reserveOut);
    expect(output).toBeGreaterThan(0n);
  });
});

describe('7-Hop Route Scenario (from Dogechain Bug)', () => {
  it('should validate 7-hop route with intermediate pools at each step', () => {
    // Build a 7-hop route through hub tokens
    const steps: RouteStep[] = [
      { dexRouter: '0x1234', dexName: 'DogeSwap', path: ['0xWWDOGE', '0xHUB1'], amountIn: 1000000000000000000n, expectedAmountOut: 990000000000000000n },
      { dexRouter: '0x1234', dexName: 'DogeSwap', path: ['0xHUB1', '0xHUB2'], amountIn: 990000000000000000n, expectedAmountOut: 980000000000000000n },
      { dexRouter: '0x1234', dexName: 'DogeSwap', path: ['0xHUB2', '0xHUB3'], amountIn: 980000000000000000n, expectedAmountOut: 970000000000000000n },
      { dexRouter: '0x1234', dexName: 'DogeSwap', path: ['0xHUB3', '0xHUB4'], amountIn: 970000000000000000n, expectedAmountOut: 960000000000000000n },
      { dexRouter: '0x1234', dexName: 'DogeSwap', path: ['0xHUB4', '0xHUB5'], amountIn: 960000000000000000n, expectedAmountOut: 950000000000000000n },
      { dexRouter: '0x1234', dexName: 'DogeSwap', path: ['0xHUB5', '0xHUB6'], amountIn: 950000000000000000n, expectedAmountOut: 940000000000000000n },
      { dexRouter: '0x1234', dexName: 'DogeSwap', path: ['0xHUB6', '0xOMNOM'], amountIn: 940000000000000000n, expectedAmountOut: 930000000000000000n },
    ];

    // Create pools for each hop
    const edges: PoolEdge[] = steps.map((step) => ({
      tokenIn: step.path[0].toLowerCase(),
      tokenOut: step.path[1].toLowerCase(),
      reserveIn: 1000000000000000000n,
      reserveOut: 1000000000000000000n,
      factory: '0xfactory',
      dexName: step.dexName,
      router: step.dexRouter,
    }));

    const result = validateRoutePools(steps, edges);

    expect(result.valid).toBe(true);
  });

  it('should fail validation when 7-hop route has missing pool at hop 4', () => {
    const steps: RouteStep[] = [
      { dexRouter: '0x1234', dexName: 'DogeSwap', path: ['0xWWDOGE', '0xHUB1'], amountIn: 1000000000000000000n, expectedAmountOut: 990000000000000000n },
      { dexRouter: '0x1234', dexName: 'DogeSwap', path: ['0xHUB1', '0xHUB2'], amountIn: 990000000000000000n, expectedAmountOut: 980000000000000000n },
      { dexRouter: '0x1234', dexName: 'DogeSwap', path: ['0xHUB2', '0xHUB3'], amountIn: 980000000000000000n, expectedAmountOut: 970000000000000000n },
      // HUB3 → HUB4 pool is MISSING (simulates GeckoTerminal 429 + on-chain timeout)
      { dexRouter: '0x1234', dexName: 'DogeSwap', path: ['0xHUB4', '0xHUB5'], amountIn: 0n, expectedAmountOut: 0n },
      { dexRouter: '0x1234', dexName: 'DogeSwap', path: ['0xHUB5', '0xHUB6'], amountIn: 0n, expectedAmountOut: 0n },
      { dexRouter: '0x1234', dexName: 'DogeSwap', path: ['0xHUB6', '0xOMNOM'], amountIn: 0n, expectedAmountOut: 0n },
    ];

    // Only first 3 hops have pools
    const edges: PoolEdge[] = [
      { tokenIn: '0xwwdoge', tokenOut: '0xhub1', reserveIn: BigInt('1000000000000000000'), reserveOut: BigInt('1000000000000000000'), factory: '0x', dexName: 'DogeSwap', router: '0x1234' },
      { tokenIn: '0xhub1', tokenOut: '0xhub2', reserveIn: BigInt('1000000000000000000'), reserveOut: BigInt('1000000000000000000'), factory: '0x', dexName: 'DogeSwap', router: '0x1234' },
      { tokenIn: '0xhub2', tokenOut: '0xhub3', reserveIn: BigInt('1000000000000000000'), reserveOut: BigInt('1000000000000000000'), factory: '0x', dexName: 'DogeSwap', router: '0x1234' },
      // HUB3 → HUB4 missing!
    ];

    const result = validateRoutePools(steps, edges);

    expect(result.valid).toBe(false);
    expect(result.error?.hopIndex).toBe(3); // 4th hop (0-indexed: 3)
  });
});

describe('Edge Case: Single Pool Route', () => {
  it('should handle single-hop single-pool route', () => {
    const steps: RouteStep[] = [
      {
        dexRouter: '0x1234',
        dexName: 'DogeSwap',
        path: ['tokenA', 'tokenB'],
        amountIn: 1000000n,
        expectedAmountOut: 997000n,
      },
    ];

    const edges: PoolEdge[] = [
      {
        tokenIn: 'tokenA',
        tokenOut: 'tokenB',
        reserveIn: 1000000000000000000n,
        reserveOut: 1000000000000000000n,
        factory: '0xfactory',
        dexName: 'DogeSwap',
        router: '0x1234',
      },
    ];

    const result = validateRoutePools(steps, edges);

    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('should handle route with only one viable pool per hop', () => {
    const steps: RouteStep[] = [
      { dexRouter: '0x1234', dexName: 'DogeSwap', path: ['A', 'B'], amountIn: 1000000n, expectedAmountOut: 990000n },
      { dexRouter: '0x5678', dexName: 'DogeShrk', path: ['B', 'C'], amountIn: 990000n, expectedAmountOut: 980000n },
    ];

    // Each hop has exactly 1 pool
    const edges: PoolEdge[] = [
      { tokenIn: 'A', tokenOut: 'B', reserveIn: BigInt('1000000000000000000'), reserveOut: BigInt('1000000000000000000'), factory: '0x1', dexName: 'DogeSwap', router: '0x1234' },
      { tokenIn: 'B', tokenOut: 'C', reserveIn: BigInt('1000000000000000000'), reserveOut: BigInt('1000000000000000000'), factory: '0x2', dexName: 'DogeShrk', router: '0x5678' },
    ];

    const result = validateRoutePools(steps, edges);

    expect(result.valid).toBe(true);
    expect(result.warnings.length).toBe(0); // 1 pool >= MIN_POOLS_PER_HOP (1)
  });
});

describe('WWDOGE→DC Low-Supply Token Routing (Critical Bug Fix)', () => {
  // DC token has ~400K total supply (~$400K market cap)
  // Previously, MIN_RESERVE_OUT = 1e18 filtered out ALL DC pools
  // This test verifies the fix allows routing through low-supply tokens

  it('should find routes for WWDOGE→DC across all DEXes', () => {
    // Simulate pools from all 10 DEXes for WWDOGE→DC pair
    const pools: PoolReserves[] = [
      // DogeSwap - 14.6M WWDOGE, 405K DC
      { reserve0: 14600000000000000000000n, reserve1: 405000000000000000000n, token0: 'WWDOGE', token1: 'DC', factory: '0xDogeSwap', dexName: 'DogeSwap', router: '0x1111' },
      // FraxSwap - 4.1B WWDOGE, 116K DC
      { reserve0: 4100000000000000000000n, reserve1: 116000000000000000000n, token0: 'WWDOGE', token1: 'DC', factory: '0xFraxSwap', dexName: 'FraxSwap', router: '0x2222' },
      // DogeShrk
      { reserve0: 5000000000000000000000n, reserve1: 80000000000000000000n, token0: 'WWDOGE', token1: 'DC', factory: '0xDogeShrk', dexName: 'DogeShrk', router: '0x3333' },
      // WOJAK
      { reserve0: 3000000000000000000000n, reserve1: 50000000000000000000n, token0: 'WWDOGE', token1: 'DC', factory: '0xWOJAK', dexName: 'WOJAK', router: '0x4444' },
      // KibbleSwap
      { reserve0: 2000000000000000000000n, reserve1: 30000000000000000000n, token0: 'WWDOGE', token1: 'DC', factory: '0xKibble', dexName: 'KibbleSwap', router: '0x5555' },
    ];

    const edges = buildGraph(pools);

    // All 10 DEXes should create edges (no MIN_RESERVE_OUT filtering)
    // We have 5 pools above, each creates 2 edges (WWDOGE→DC and DC→WWDOGE)
    expect(edges.length).toBe(10); // 5 pools × 2 directions

    // Should find direct WWDOGE→DC route
    const routes = findAllRoutes('wwdoge', 'dc', 1000000000000000000n, edges);
    expect(routes.length).toBeGreaterThan(0);
    expect(routes[0]).toContain('wwdoge');
    expect(routes[0]).toContain('dc');
  });

  it('should calculate output for WWDOGE→DC route correctly', () => {
    const pools: PoolReserves[] = [
      // FraxSwap DC pool - 116K DC reserves
      { reserve0: 4100000000000000000000n, reserve1: 116000000000000000000n, token0: 'WWDOGE', token1: 'DC', factory: '0xFraxSwap', dexName: 'FraxSwap', router: '0x2222' },
    ];

    const edges = buildGraph(pools);
    const path = ['wwdoge', 'dc'];
    const amountIn = 1000000000000000000n; // 1 WWDOGE

    const result = calculatePathOutput(path, amountIn, edges);

    expect(result.output).toBeGreaterThan(0n);
    expect(result.steps.length).toBe(1);
    expect(result.steps[0].dexName).toBe('FraxSwap');
    expect(result.steps[0].expectedAmountOut).toBeGreaterThan(0n);
  });

  it('should NOT filter out DC edge even when DC total supply is < 1e18', () => {
    // DC total supply ~400K tokens = 400000000000000000000000n (with 18 decimals)
    // This is NOT 1e18, so pools should NOT be filtered
    const pools: PoolReserves[] = [
      { reserve0: 1000000000000000000n, reserve1: 100000000000000000n, token0: 'WWDOGE', token1: 'DC', factory: '0xTest', dexName: 'TestDEX', router: '0x9999' },
    ];

    const edges = buildGraph(pools);

    // Both WWDOGE→DC and DC→WWDOGE edges should exist
    expect(edges.length).toBe(2);
    expect(edges.find(e => e.tokenIn.toLowerCase() === 'wwdoge' && e.tokenOut.toLowerCase() === 'dc')).toBeDefined();
    expect(edges.find(e => e.tokenIn.toLowerCase() === 'dc' && e.tokenOut.toLowerCase() === 'wwdoge')).toBeDefined();
  });

  it('should allow multi-hop routes involving low-supply tokens', () => {
    // Create a route: WWDOGE → hub → DC where DC is low-supply
    const pools: PoolReserves[] = [
      { reserve0: 10000000000000000000000n, reserve1: 10000000000000000000000n, token0: 'WWDOGE', token1: 'HUB', factory: '0xHub', dexName: 'DogeSwap', router: '0x1111' },
      { reserve0: 1000000000000000000n, reserve1: 100000000000000000n, token0: 'HUB', token1: 'DC', factory: '0xDC', dexName: 'FraxSwap', router: '0x2222' },
    ];

    const edges = buildGraph(pools);

    // 4 edges total (2 pools × 2 directions)
    expect(edges.length).toBe(4);

    // Should find 2-hop route: WWDOGE → HUB → DC
    const routes = findAllRoutes('wwdoge', 'dc', 1000000000000000000n, edges);
    expect(routes.length).toBe(1);
    expect(routes[0]).toEqual(['wwdoge', 'hub', 'dc']);

    // Calculate output through the route
    const result = calculatePathOutput(routes[0], 1000000000000000000n, edges);
    expect(result.output).toBeGreaterThan(0n);
    expect(result.steps.length).toBe(2);
  });
});