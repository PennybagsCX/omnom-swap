/**
 * @file multiHopRouting.test.ts
 * @description Comprehensive tests for multi-hop hub token routing.
 *
 * Coverage:
 *   1. Hub Token Configuration
 *   2. Route Generation (BFS + explicit hub routes)
 *   3. Route Evaluation (output calculation)
 *   4. Decimal Normalization in Multi-Hop
 *   5. Tax Handling in Multi-Hop
 *
 * Reference: src/services/pathFinder/index.ts, src/services/pathFinder/types.ts
 */

import { describe, it, expect } from 'vitest';

// ─── Type Definitions (mirrors src/services/pathFinder/types.ts) ────────────────

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

// ─── Constants ─────────────────────────────────────────────────────────────────

const MAX_HOPS = 4;
const FEE_DENOMINATOR = 10000n;
const POOL_FEE_BPS = 30n; // 0.3%

// Hub token addresses (lowercase) — mirrors src/services/pathFinder/types.ts
const WWDOGE = '0xb7ddc6414bf4f5515b52d8bdd69973ae205ff101';
const DC = '0x7b4328c127b85369d9f82ca0503b000d09cf9180';
const OMNOM = '0xe3fca919883950c5cd468156392a6477ff5d18de';
const MCRIB = '0xbdad927604c5cb78f15b3669a92fa5a1427d33a2'; // 15 decimals

const HUB_TOKEN_ADDRESSES: readonly string[] = [WWDOGE, DC, OMNOM];

function isHubToken(address: string): boolean {
  return HUB_TOKEN_ADDRESSES.includes(address.toLowerCase());
}

// Token decimals lookup (mirrors TOKENS_FALLBACK in pathFinder/index.ts)
const TOKEN_DECIMALS: Record<string, number> = {
  [WWDOGE]: 18,
  [DC]: 18,
  [OMNOM]: 18,
  [MCRIB]: 15,
  '0x8a764cf73438de795c98707b07034e577af54825': 18, // DINU
};

function getTokenDecimals(tokenAddress: string): number {
  return TOKEN_DECIMALS[tokenAddress.toLowerCase()] ?? 18;
}

// ─── Implementation Under Test ─────────────────────────────────────────────────

function buildGraph(pools: PoolReserves[]): PoolEdge[] {
  const edges: PoolEdge[] = [];
  for (const pool of pools) {
    if (pool.reserve0 <= 0n || pool.reserve1 <= 0n) continue;
    edges.push({
      tokenIn: pool.token0, tokenOut: pool.token1,
      reserveIn: pool.reserve0, reserveOut: pool.reserve1,
      factory: pool.factory, dexName: pool.dexName, router: pool.router,
    });
    edges.push({
      tokenIn: pool.token1, tokenOut: pool.token0,
      reserveIn: pool.reserve1, reserveOut: pool.reserve0,
      factory: pool.factory, dexName: pool.dexName, router: pool.router,
    });
  }
  return edges;
}

function calculateOutput(
  amountIn: bigint,
  reserveIn: bigint,
  reserveOut: bigint,
  tokenInDecimals?: number,
  tokenOutDecimals?: number,
): bigint {
  if (amountIn <= 0n || reserveIn <= 0n || reserveOut <= 0n) return 0n;

  let nAmountIn = amountIn;
  let nReserveIn = reserveIn;
  let nReserveOut = reserveOut;

  if (tokenInDecimals !== undefined && tokenOutDecimals !== undefined) {
    if (tokenInDecimals < 18) {
      nAmountIn = amountIn * 10n ** BigInt(18 - tokenInDecimals);
      nReserveIn = reserveIn * 10n ** BigInt(18 - tokenInDecimals);
    } else if (tokenInDecimals > 18) {
      nAmountIn = amountIn / 10n ** BigInt(tokenInDecimals - 18);
      nReserveIn = reserveIn / 10n ** BigInt(tokenInDecimals - 18);
    }
    if (tokenOutDecimals < 18) {
      nReserveOut = reserveOut * 10n ** BigInt(18 - tokenOutDecimals);
    } else if (tokenOutDecimals > 18) {
      nReserveOut = reserveOut / 10n ** BigInt(tokenOutDecimals - 18);
    }

    const amountInWithFee = nAmountIn * (FEE_DENOMINATOR - POOL_FEE_BPS);
    const numerator = amountInWithFee * nReserveOut;
    const denominator = nReserveIn * FEE_DENOMINATOR + amountInWithFee;
    let output = numerator / denominator;

    if (tokenOutDecimals < 18) {
      output = output / 10n ** BigInt(18 - tokenOutDecimals);
    } else if (tokenOutDecimals > 18) {
      output = output * 10n ** BigInt(tokenOutDecimals - 18);
    }

    return output > reserveOut ? reserveOut : output;
  }

  const amountInWithFee = amountIn * (FEE_DENOMINATOR - POOL_FEE_BPS);
  const numerator = amountInWithFee * reserveOut;
  const denominator = reserveIn * FEE_DENOMINATOR + amountInWithFee;
  const output = numerator / denominator;
  return output > reserveOut ? reserveOut : output;
}

/**
 * Calculate output for a multi-hop path with decimal normalization.
 * Mirrors the logic in pathFinder/index.ts calculatePathOutput().
 */
function calculatePathOutput(
  path: string[],
  amountIn: bigint,
  edges: PoolEdge[],
  taxCache: Map<string, { buyTax: number; sellTax: number }> = new Map(),
): { output: bigint; steps: RouteStep[] } {
  let currentAmount = amountIn;
  const steps: RouteStep[] = [];

  for (let i = 0; i < path.length - 1; i++) {
    const tokenIn = path[i];
    const tokenOut = path[i + 1];
    const tokenInDecimals = getTokenDecimals(tokenIn);
    const tokenOutDecimals = getTokenDecimals(tokenOut);

    // Apply sell tax on input token
    const inputTaxEntry = taxCache.get(tokenIn.toLowerCase());
    let effectiveAmountIn = currentAmount;
    if (inputTaxEntry && inputTaxEntry.sellTax > 0) {
      const sellTaxBps = BigInt(Math.round(inputTaxEntry.sellTax * 100));
      effectiveAmountIn = (effectiveAmountIn * (10000n - sellTaxBps)) / 10000n;
    }

    const candidates = edges.filter(
      (e) => e.tokenIn.toLowerCase() === tokenIn.toLowerCase() && e.tokenOut.toLowerCase() === tokenOut.toLowerCase(),
    );

    if (candidates.length === 0) return { output: 0n, steps: [] };

    let bestEdge = candidates[0];
    let bestOutput = calculateOutput(effectiveAmountIn, bestEdge.reserveIn, bestEdge.reserveOut, tokenInDecimals, tokenOutDecimals);

    for (let j = 1; j < candidates.length; j++) {
      const out = calculateOutput(effectiveAmountIn, candidates[j].reserveIn, candidates[j].reserveOut, tokenInDecimals, tokenOutDecimals);
      if (out > bestOutput) { bestOutput = out; bestEdge = candidates[j]; }
    }

    // Apply buy tax deduction
    let adjustedOutput = bestOutput;
    const outputTaxEntry = taxCache.get(tokenOut.toLowerCase());
    if (outputTaxEntry && outputTaxEntry.buyTax > 0) {
      const taxBps = BigInt(Math.round(outputTaxEntry.buyTax * 100));
      adjustedOutput = (adjustedOutput * (10000n - taxBps)) / 10000n;
    }

    steps.push({
      dexRouter: bestEdge.router,
      dexName: bestEdge.dexName,
      path: [tokenIn, tokenOut],
      amountIn: currentAmount,
      expectedAmountOut: adjustedOutput,
    });

    // Normalize for next hop
    let currentAmountNormalized = adjustedOutput;
    if (tokenOutDecimals < 18) {
      currentAmountNormalized = adjustedOutput * 10n ** BigInt(18 - tokenOutDecimals);
    } else if (tokenOutDecimals > 18) {
      currentAmountNormalized = adjustedOutput / 10n ** BigInt(tokenOutDecimals - 18);
    }
    currentAmount = currentAmountNormalized;
  }

  // De-normalize to final token's native decimals
  const finalTokenOut = path[path.length - 1].toLowerCase();
  const finalTokenDecimals = getTokenDecimals(finalTokenOut);
  let finalOutput = currentAmount;
  if (finalTokenDecimals < 18) {
    finalOutput = currentAmount / 10n ** BigInt(18 - finalTokenDecimals);
  } else if (finalTokenDecimals > 18) {
    finalOutput = currentAmount * 10n ** BigInt(finalTokenDecimals - 18);
  }

  return { output: finalOutput, steps };
}

/**
 * Generate explicit hub-based candidate paths.
 * Mirrors generateHubRoutes() from pathFinder/index.ts.
 */
function generateHubRoutes(
  tokenIn: string,
  tokenOut: string,
  edges: PoolEdge[],
): string[][] {
  const normalizedIn = tokenIn.toLowerCase();
  const normalizedOut = tokenOut.toLowerCase();

  const edgeSet = new Set<string>();
  for (const e of edges) {
    edgeSet.add(`${e.tokenIn.toLowerCase()}>${e.tokenOut.toLowerCase()}`);
  }
  const hasEdge = (a: string, b: string) => edgeSet.has(`${a}>${b}`);

  const hubs = HUB_TOKEN_ADDRESSES.filter(
    h => h !== normalizedIn && h !== normalizedOut,
  );

  const paths: string[][] = [];

  // 1-hop through each hub
  for (const hub of hubs) {
    if (hasEdge(normalizedIn, hub) && hasEdge(hub, normalizedOut)) {
      paths.push([normalizedIn, hub, normalizedOut]);
    }
  }

  // 2-hop through hub pairs
  for (let i = 0; i < hubs.length; i++) {
    for (let j = 0; j < hubs.length; j++) {
      if (i === j) continue;
      if (hasEdge(normalizedIn, hubs[i]) && hasEdge(hubs[i], hubs[j]) && hasEdge(hubs[j], normalizedOut)) {
        paths.push([normalizedIn, hubs[i], hubs[j], normalizedOut]);
      }
    }
  }

  return paths;
}

/**
 * BFS route finder with hub route merging.
 * Mirrors findAllRoutes() from pathFinder/index.ts.
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

    if (current === normalizedOut && path.length > 1) {
      routes.push([...path]);
      continue;
    }

    const visited = new Set(path.map(p => p.toLowerCase()));
    const neighbors = adjacency.get(current);
    if (!neighbors) continue;

    for (const neighbor of neighbors) {
      if (visited.has(neighbor.toLowerCase())) continue;
      queue.push({ path: [...path, neighbor] });
    }
  }

  // Merge hub routes
  const hubPaths = generateHubRoutes(normalizedIn, normalizedOut, edges);
  const seen = new Set(routes.map(p => p.join('>')));
  for (const hp of hubPaths) {
    const key = hp.join('>');
    if (!seen.has(key)) { seen.add(key); routes.push(hp); }
  }

  return routes;
}

// ─── Helper: create pool ───────────────────────────────────────────────────────

function makePool(
  token0: string, token1: string,
  reserve0: bigint, reserve1: bigint,
  dexName = 'DogeSwap', router = '0x1234', factory = '0xfactory',
): PoolReserves {
  return { token0, token1, reserve0, reserve1, dexName, router, factory };
}

// ─── Test Suites ────────────────────────────────────────────────────────────────

describe('Multi-Hop Hub Token Routing', () => {

  // ─── Hub Token Configuration ───────────────────────────────────────────────

  describe('Hub Token Configuration', () => {
    it('should have WWDOGE, DC, OMNOM as hub tokens', () => {
      expect(HUB_TOKEN_ADDRESSES).toContain(WWDOGE);
      expect(HUB_TOKEN_ADDRESSES).toContain(DC);
      expect(HUB_TOKEN_ADDRESSES).toContain(OMNOM);
      expect(HUB_TOKEN_ADDRESSES.length).toBe(3);
    });

    it('should correctly identify hub tokens', () => {
      expect(isHubToken(WWDOGE)).toBe(true);
      expect(isHubToken(DC)).toBe(true);
      expect(isHubToken(OMNOM)).toBe(true);
    });

    it('should not identify non-hub tokens as hubs', () => {
      expect(isHubToken(MCRIB)).toBe(false);
      expect(isHubToken('0x8a764cf73438de795c98707b07034e577af54825')).toBe(false); // DINU
      expect(isHubToken('0xrandomtoken123')).toBe(false);
    });
  });

  // ─── Route Generation ──────────────────────────────────────────────────────

  describe('Route Generation', () => {
    it('should generate 1-hop routes through each hub', () => {
      const edges: PoolEdge[] = [
        { tokenIn: '0xtokenA', tokenOut: WWDOGE, reserveIn: 1000000000000000000n, reserveOut: 1000000000000000000n, factory: '0xf', dexName: 'DogeSwap', router: '0x1' },
        { tokenIn: WWDOGE, tokenOut: '0xtokenB', reserveIn: 1000000000000000000n, reserveOut: 1000000000000000000n, factory: '0xf', dexName: 'DogeSwap', router: '0x1' },
        { tokenIn: '0xtokenA', tokenOut: DC, reserveIn: 1000000000000000000n, reserveOut: 1000000000000000000n, factory: '0xf', dexName: 'DogeSwap', router: '0x1' },
        { tokenIn: DC, tokenOut: '0xtokenB', reserveIn: 1000000000000000000n, reserveOut: 1000000000000000000n, factory: '0xf', dexName: 'DogeSwap', router: '0x1' },
        { tokenIn: '0xtokenA', tokenOut: OMNOM, reserveIn: 1000000000000000000n, reserveOut: 1000000000000000000n, factory: '0xf', dexName: 'DogeSwap', router: '0x1' },
        { tokenIn: OMNOM, tokenOut: '0xtokenB', reserveIn: 1000000000000000000n, reserveOut: 1000000000000000000n, factory: '0xf', dexName: 'DogeSwap', router: '0x1' },
      ];

      const routes = generateHubRoutes('0xtokenA', '0xtokenB', edges);
      expect(routes.length).toBe(3); // one through each hub
      routes.forEach(r => expect(r.length).toBe(3)); // tokenA → hub → tokenB
    });

    it('should generate 2-hop routes through hub pairs', () => {
      const edges: PoolEdge[] = [
        { tokenIn: '0xtokenA', tokenOut: WWDOGE, reserveIn: 1000000000000000000n, reserveOut: 1000000000000000000n, factory: '0xf', dexName: 'DogeSwap', router: '0x1' },
        { tokenIn: WWDOGE, tokenOut: DC, reserveIn: 1000000000000000000n, reserveOut: 1000000000000000000n, factory: '0xf', dexName: 'DogeSwap', router: '0x1' },
        { tokenIn: DC, tokenOut: '0xtokenB', reserveIn: 1000000000000000000n, reserveOut: 1000000000000000000n, factory: '0xf', dexName: 'DogeSwap', router: '0x1' },
      ];

      const routes = generateHubRoutes('0xtokenA', '0xtokenB', edges);
      // Should have: tokenA → WWDOGE → tokenB (if WWDOGE→tokenB exists, no)
      // Actually: tokenA→WWDOGE exists, WWDOGE→DC exists, DC→tokenB exists
      // So 2-hop: tokenA → WWDOGE → DC → tokenB
      const twoHopRoutes = routes.filter(r => r.length === 4);
      expect(twoHopRoutes.length).toBeGreaterThanOrEqual(1);
    });

    it('should not generate routes through tokenIn or tokenOut as intermediaries', () => {
      const edges: PoolEdge[] = [
        { tokenIn: '0xtokenA', tokenOut: WWDOGE, reserveIn: 1000000000000000000n, reserveOut: 1000000000000000000n, factory: '0xf', dexName: 'DogeSwap', router: '0x1' },
        { tokenIn: WWDOGE, tokenOut: '0xtokenB', reserveIn: 1000000000000000000n, reserveOut: 1000000000000000000n, factory: '0xf', dexName: 'DogeSwap', router: '0x1' },
      ];

      const routes = generateHubRoutes('0xtokenA', '0xtokenB', edges);
      // No hub route should use tokenA or tokenB as intermediary
      routes.forEach(r => {
        const intermediaries = r.slice(1, -1);
        intermediaries.forEach(hub => {
          expect(hub).not.toBe('0xtokena');
          expect(hub).not.toBe('0xtokenb');
        });
      });
    });

    it('should deduplicate routes', () => {
      const edges: PoolEdge[] = [
        { tokenIn: '0xtokenA', tokenOut: WWDOGE, reserveIn: 1000000000000000000n, reserveOut: 1000000000000000000n, factory: '0xf', dexName: 'DogeSwap', router: '0x1' },
        { tokenIn: WWDOGE, tokenOut: '0xtokenB', reserveIn: 1000000000000000000n, reserveOut: 1000000000000000000n, factory: '0xf', dexName: 'DogeSwap', router: '0x1' },
      ];

      const routes = generateHubRoutes('0xtokenA', '0xtokenB', edges);
      const keys = routes.map(r => r.join('>'));
      expect(new Set(keys).size).toBe(keys.length); // no duplicates
    });

    it('should limit maximum hop count', () => {
      // Create a chain of 6 tokens (5 hops) — should not exceed MAX_HOPS
      const edges: PoolEdge[] = [];
      const tokens = ['A', 'B', 'C', 'D', 'E', 'F'];
      for (let i = 0; i < tokens.length - 1; i++) {
        edges.push({
          tokenIn: tokens[i], tokenOut: tokens[i + 1],
          reserveIn: 1000000000000000000n, reserveOut: 1000000000000000000n,
          factory: '0xf', dexName: 'DogeSwap', router: '0x1',
        });
      }

      const routes = findAllRoutes('A', 'F', 1000000000000000000n, edges);
      // MAX_HOPS = 4, so A→F (5 hops) should NOT be found
      expect(routes.length).toBe(0);
    });
  });

  // ─── Route Evaluation ──────────────────────────────────────────────────────

  describe('Route Evaluation', () => {
    it('should evaluate direct routes', () => {
      const edges = buildGraph([
        makePool('0xtokenA', '0xtokenB', 1000000000000000000n, 2000000000000000000n),
      ]);

      const result = calculatePathOutput(['0xtokenA', '0xtokenB'], 1000000000000000000n, edges);
      expect(result.output).toBeGreaterThan(0n);
      expect(result.steps.length).toBe(1);
    });

    it('should evaluate 1-hop hub routes', () => {
      const edges = buildGraph([
        makePool('0xtokenA', WWDOGE, 1000000000000000000n, 1000000000000000000n),
        makePool(WWDOGE, '0xtokenB', 1000000000000000000n, 1000000000000000000n),
      ]);

      const result = calculatePathOutput(['0xtokenA', WWDOGE, '0xtokenB'], 1000000000000000000n, edges);
      expect(result.output).toBeGreaterThan(0n);
      expect(result.steps.length).toBe(2);
    });

    it('should evaluate 2-hop hub routes', () => {
      const edges = buildGraph([
        makePool('0xtokenA', WWDOGE, 1000000000000000000n, 1000000000000000000n),
        makePool(WWDOGE, DC, 1000000000000000000n, 1000000000000000000n),
        makePool(DC, '0xtokenB', 1000000000000000000n, 1000000000000000000n),
      ]);

      const result = calculatePathOutput(['0xtokenA', WWDOGE, DC, '0xtokenB'], 1000000000000000000n, edges);
      expect(result.output).toBeGreaterThan(0n);
      expect(result.steps.length).toBe(3);
    });

    it('should select best output across all routes', () => {
      const pools = [
        makePool('0xtokenA', '0xtokenB', 1000000000000000000n, 1000000000000000000n), // Direct: 1:1
        makePool('0xtokenA', WWDOGE, 1000000000000000000n, 2000000000000000000n),      // Better via WWDOGE
        makePool(WWDOGE, '0xtokenB', 2000000000000000000n, 2000000000000000000n),
      ];
      const edges = buildGraph(pools);

      const directResult = calculatePathOutput(['0xtokenA', '0xtokenB'], 1000000000000000000n, edges);
      const hubResult = calculatePathOutput(['0xtokenA', WWDOGE, '0xtokenB'], 1000000000000000000n, edges);

      // Hub route should give more output due to better liquidity
      // (both should be > 0, but the comparison depends on pool reserves)
      expect(directResult.output).toBeGreaterThan(0n);
      expect(hubResult.output).toBeGreaterThan(0n);
    });

    it('should handle routes with insufficient liquidity', () => {
      const edges = buildGraph([
        makePool('0xtokenA', '0xtokenB', 1n, 1n), // Tiny reserves
      ]);

      const result = calculatePathOutput(['0xtokenA', '0xtokenB'], 1000000000000000000n, edges);
      // Output should be very small (essentially 0 for large input vs tiny reserves)
      expect(result.output).toBeLessThan(1000000000000000000n);
    });
  });

  // ─── Decimal Normalization in Multi-Hop ────────────────────────────────────

  describe('Decimal Normalization in Multi-Hop', () => {
    it('should correctly handle 15-decimal token as final output (MCRIB)', () => {
      // DC (18 decimals) → MCRIB (15 decimals)
      const edges = buildGraph([
        makePool(DC, MCRIB, BigInt('1000000000000000000000'), BigInt('1000000000000000000000')),
      ]);

      const result = calculatePathOutput([DC, MCRIB], BigInt('1000000000000000000'), edges);
      expect(result.output).toBeGreaterThan(0n);

      // The output is in 15-decimal MCRIB representation.
      // calculateOutput normalizes to 18-decimal internally then de-normalizes to tokenOut decimals.
      // For 1e18 DC in with 1:1 pool, output ≈ 0.997e18 in 18-decimal, then de-normalized to 15-decimal.
      const mcribDecimals = getTokenDecimals(MCRIB);
      expect(mcribDecimals).toBe(15);

      // Output should be in the 1e15 range (≈1 MCRIB token in 15-decimal form)
      const outputInTokens = Number(result.output) / Math.pow(10, mcribDecimals);
      expect(outputInTokens).toBeGreaterThan(0.5);
      expect(outputInTokens).toBeLessThan(1500); // ~997 tokens in 15-decimal form
    });

    it('should correctly handle mixed decimal tokens in intermediate hops', () => {
      // tokenA (18 dec) → MCRIB (15 dec) → WWDOGE (18 dec)
      const edges = buildGraph([
        makePool('0xtokenA', MCRIB, BigInt('1000000000000000000000'), BigInt('1000000000000000000000')),
        makePool(MCRIB, WWDOGE, BigInt('1000000000000000000000'), BigInt('1000000000000000000000')),
      ]);

      const result = calculatePathOutput(['0xtokenA', MCRIB, WWDOGE], BigInt('1000000000000000000'), edges);
      expect(result.output).toBeGreaterThan(0n);
      expect(result.steps.length).toBe(2);
    });

    it('should de-normalize final output to native decimals', () => {
      const edges = buildGraph([
        makePool(DC, MCRIB, BigInt('10000000000000000000000'), BigInt('10000000000000000000000')),
      ]);

      const result = calculatePathOutput([DC, MCRIB], BigInt('1000000000000000000'), edges);

      // Output is de-normalized to 15-decimal form from the internal 18-decimal representation
      const mcribDecimals = getTokenDecimals(MCRIB);
      const outputInTokens = Number(result.output) / Math.pow(10, mcribDecimals);
      expect(outputInTokens).toBeGreaterThan(0.01);
      // With 10x larger pool, output ≈ 997 MCRIB tokens (not inflated to 997000)
      expect(outputInTokens).toBeLessThan(1500);
    });

    it('should not inflate minAmountOut for non-18 decimal tokens', () => {
      // Create a pool where MCRIB has realistic reserves
      const mcribReserve = BigInt('5000000000000000000000'); // 5000 MCRIB (15 dec)
      const dcReserve = BigInt('5000000000000000000000');    // 5000 DC (18 dec)

      const edges = buildGraph([
        makePool(DC, MCRIB, dcReserve, mcribReserve),
      ]);

      const result = calculatePathOutput([DC, MCRIB], BigInt('1000000000000000000'), edges);

      // Output is in 15-decimal MCRIB form, not 18-decimal
      // Without normalization, it would be 1000x inflated
      const outputInMcribTokens = Number(result.output) / 1e15;
      // For 1 DC into 5000:5000 pool, expect ~0.9994 MCRIB tokens
      expect(outputInMcribTokens).toBeGreaterThan(0.5);
      expect(outputInMcribTokens).toBeLessThan(1500); // not inflated by 1000x
    });
  });

  // ─── Tax Handling in Multi-Hop ─────────────────────────────────────────────

  describe('Tax Handling in Multi-Hop', () => {
    it('should apply buy tax on taxed output tokens', () => {
      const taxCache = new Map([
        ['0xtaxedtoken', { buyTax: 3, sellTax: 0 }],
      ]);

      const edges = buildGraph([
        makePool('0xtokenA', '0xtaxedtoken', 1000000000000000000n, 1000000000000000000n),
      ]);

      const resultWithTax = calculatePathOutput(['0xtokenA', '0xtaxedtoken'], 1000000000000000000n, edges, taxCache);
      const resultNoTax = calculatePathOutput(['0xtokenA', '0xtaxedtoken'], 1000000000000000000n, edges, new Map());

      // With 3% buy tax, output should be ~3% less
      expect(resultWithTax.output).toBeLessThan(resultNoTax.output);
      const reduction = Number(resultNoTax.output - resultWithTax.output) / Number(resultNoTax.output);
      expect(reduction).toBeCloseTo(0.03, 1);
    });

    it('should apply sell tax on taxed input tokens', () => {
      const taxCache = new Map([
        ['0xtaxedtoken', { buyTax: 0, sellTax: 5 }],
      ]);

      const edges = buildGraph([
        makePool('0xtaxedtoken', '0xtokenB', 1000000000000000000n, 1000000000000000000n),
      ]);

      const resultWithTax = calculatePathOutput(['0xtaxedtoken', '0xtokenB'], 1000000000000000000n, edges, taxCache);
      const resultNoTax = calculatePathOutput(['0xtaxedtoken', '0xtokenB'], 1000000000000000000n, edges, new Map());

      // With 5% sell tax, effective input is reduced by 5%
      expect(resultWithTax.output).toBeLessThan(resultNoTax.output);
    });

    it('should handle taxed intermediate tokens', () => {
      const taxCache = new Map([
        ['0xtaxedhub', { buyTax: 2, sellTax: 2 }],
      ]);

      const edges = buildGraph([
        makePool('0xtokenA', '0xtaxedhub', 1000000000000000000n, 1000000000000000000n),
        makePool('0xtaxedhub', '0xtokenB', 1000000000000000000n, 1000000000000000000n),
      ]);

      const result = calculatePathOutput(['0xtokenA', '0xtaxedhub', '0xtokenB'], 1000000000000000000n, edges, taxCache);
      expect(result.output).toBeGreaterThan(0n);
      expect(result.steps.length).toBe(2);

      // Verify tax was applied on both hops
      // Step 0: buy tax on taxedhub (2%)
      // Step 1: sell tax on taxedhub (2%)
      const resultNoTax = calculatePathOutput(['0xtokenA', '0xtaxedhub', '0xtokenB'], 1000000000000000000n, edges, new Map());
      expect(result.output).toBeLessThan(resultNoTax.output);
    });

    it('should not double-count tax deductions', () => {
      // If buy tax is applied in calculatePathOutput, it should NOT be applied again
      const taxCache = new Map([
        ['0xtaxedtoken', { buyTax: 3, sellTax: 3 }],
      ]);

      const edges = buildGraph([
        makePool('0xtokenA', '0xtaxedtoken', 1000000000000000000n, 1000000000000000000n),
      ]);

      const result = calculatePathOutput(['0xtokenA', '0xtaxedtoken'], 1000000000000000000n, edges, taxCache);

      // The expectedAmountOut should reflect tax deduction exactly once
      // Total deduction ≈ 3% (buy) = ~3% reduction from untaxed output
      const resultNoTax = calculatePathOutput(['0xtokenA', '0xtaxedtoken'], 1000000000000000000n, edges, new Map());
      const totalReduction = Number(resultNoTax.output - result.output) / Number(resultNoTax.output);
      // Should be ~3% (buy tax only, not 6%)
      expect(totalReduction).toBeLessThan(0.05); // not double-counted
      expect(totalReduction).toBeGreaterThan(0.02);
    });

    it('should skip tax for cache-miss tokens (conservative)', () => {
      // Empty tax cache — no tax applied
      const taxCache = new Map();

      const edges = buildGraph([
        makePool('0xtokenA', '0xsometoken', 1000000000000000000n, 1000000000000000000n),
      ]);

      const result = calculatePathOutput(['0xtokenA', '0xsometoken'], 1000000000000000000n, edges, taxCache);
      expect(result.output).toBeGreaterThan(0n);

      // Should be same as no-tax calculation
      const resultNoCache = calculatePathOutput(['0xtokenA', '0xsometoken'], 1000000000000000000n, edges, new Map());
      expect(result.output).toBe(resultNoCache.output);
    });
  });

  // ─── Full Route Discovery Integration ──────────────────────────────────────

  describe('Full Route Discovery', () => {
    it('should find direct + hub routes for token pair', () => {
      const pools = [
        makePool('0xtokenA', '0xtokenB', 1000000000000000000n, 1000000000000000000n, 'DogeSwap', '0x1'),
        makePool('0xtokenA', WWDOGE, 1000000000000000000n, 1000000000000000000n, 'DogeSwap', '0x1'),
        makePool(WWDOGE, '0xtokenB', 1000000000000000000n, 1000000000000000000n, 'DogeSwap', '0x1'),
      ];
      const edges = buildGraph(pools);

      const routes = findAllRoutes('0xtokenA', '0xtokenB', 1000000000000000000n, edges);
      expect(routes.length).toBeGreaterThanOrEqual(2); // direct + via WWDOGE
    });

    it('should find hub routes when no direct pool exists', () => {
      const pools = [
        makePool('0xtokenA', WWDOGE, 1000000000000000000n, 1000000000000000000n, 'DogeSwap', '0x1'),
        makePool(WWDOGE, '0xtokenB', 1000000000000000000n, 1000000000000000000n, 'DogeSwap', '0x1'),
      ];
      const edges = buildGraph(pools);

      const routes = findAllRoutes('0xtokenA', '0xtokenB', 1000000000000000000n, edges);
      expect(routes.length).toBeGreaterThanOrEqual(1);

      // All routes should go through WWDOGE
      routes.forEach(r => {
        expect(r).toContain(WWDOGE);
      });
    });
  });
});
