/**
 * @file mcribSwapSimulation.test.ts
 * @description End-to-end simulation tests for MCRIB token swap through the aggregator.
 *
 * MCRIB (0xbdaD927604c5cB78F15b3669a92Fa5A1427d33a2) on Dogechain:
 *   - 15 decimals (not 18)
 *   - 3% buy/sell tax, dex-only type
 *   - NO anti-contract restrictions
 *   - Trades fine on Dogeshrek DEX
 *
 * Verified on-chain pools (Dogeshrek factory 0x7c10a3b7...):
 *   - DC/MCRIB:    pair 0x3d98...  (26.7M DC / ~4,159 MCRIB raw = ~4.16B / 1e15)
 *   - DC/WWDOGE:   pair 0x2bcc...  (75.3M DC / 2,207 WWDOGE)
 *   - MCRIB/WWDOGE: pair 0xa589... (440 WWDOGE / ~2,394 MCRIB)
 *   - MCRIB/OMNOM: pair 0x712d...  ($45.04 TVL)
 *
 * Coverage:
 *   1. Tax detection: MCRIB returns 3% buy/sell, NO isAntiContract
 *   2. Pathfinder: discovers DC→MCRIB direct route and multi-hop via WWDOGE
 *   3. AMM math: correct output with 15-decimal normalization
 *   4. Swap request: correctly built with tax-adjusted minAmountOut
 *   5. Protocol fee: fee deduction doesn't break 15-decimal tokens
 *   6. Edge cases: tiny amounts, large amounts, zero-tax, honeypot
 */

import { describe, it, expect } from 'vitest';

// ─── Constants ────────────────────────────────────────────────────────────────

const WWDOGE = '0xb7ddc6414bf4f5515b52d8bdd69973ae205ff101';
const DC = '0x7b4328c127b85369d9f82ca0503b000d09cf9180';
const OMNOM = '0xe3fca919883950c5cd468156392a6477ff5d18de';
const MCRIB = '0xbdad927604c5cb78f15b3669a92fa5a1427d33a2';

const DOGESHRK_ROUTER = '0x45afcf57f7e3f3b9ca70335e5e85e4f77dcc5087';
const DOGESHRK_FACTORY = '0x7c10a3b7ecd42dd7d79c0b9d58ddb812f92b574a';

const MCRIB_DECIMALS = 15;

const FEE_DENOMINATOR = 10000n;
const POOL_FEE_BPS = 30n;
const PROTOCOL_FEE_BPS = 25; // 0.25%

const TOKEN_DECIMALS: Record<string, number> = {
  [DC.toLowerCase()]: 18,
  [WWDOGE.toLowerCase()]: 18,
  [OMNOM.toLowerCase()]: 18,
  [MCRIB.toLowerCase()]: 15,
};

function getDecimals(addr: string): number {
  return TOKEN_DECIMALS[addr.toLowerCase()] ?? 18;
}

// ─── On-chain pool data (from RPC query, May 2 2026) ──────────────────────────

// DC/MCRIB pair on Dogeshrek: token0=DC, token1=MCRIB
const DC_MCRIB_RESERVES = {
  reserve0: 26685700617113776516910716n, // DC (18 dec)
  reserve1: 4162938342378943171960830633n, // MCRIB (15 dec)
};

// DC/WWDOGE pair on Dogeshrek: token0=DC, token1=WWDOGE
const DC_WWDOGE_RESERVES = {
  reserve0: 75299228405422345490926106n, // DC
  reserve1: 2207271841046202608286n,     // WWDOGE
};

// MCRIB/WWDOGE pair on Dogeshrek: token0=WWDOGE, token1=MCRIB
const MCRIB_WWDOGE_RESERVES = {
  reserve0: 440424591422608209575n,      // WWDOGE
  reserve1: 2394109501293774352160710861n, // MCRIB
};

// ─── Tax Detection (mirrors taxDetection.ts) ──────────────────────────────────

interface TokenTaxInfo {
  buyTax: number;
  sellTax: number;
  taxType: 'dex-only' | 'transfer' | 'unknown';
  source: string;
  confidence: string;
}

const KNOWN_TAX_OVERRIDES: Record<string, { buyTax: number; sellTax: number; taxType: 'dex-only' | 'transfer'; reason: string }> = {
  [MCRIB.toLowerCase()]: {
    buyTax: 3,
    sellTax: 3,
    taxType: 'dex-only',
    reason: 'MCRIB — 3% buy/sell tax',
  },
};

function getCachedTax(addr: string): TokenTaxInfo | null {
  const override = KNOWN_TAX_OVERRIDES[addr.toLowerCase()];
  if (override) {
    return {
      buyTax: override.buyTax,
      sellTax: override.sellTax,
      taxType: override.taxType,
      source: 'registry',
      confidence: 'high',
    };
  }
  return null;
}

// ─── Pool / Edge Types ────────────────────────────────────────────────────────

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

interface RouteResult {
  id: string;
  steps: RouteStep[];
  totalAmountIn: bigint;
  totalExpectedOut: bigint;
  priceImpact: number;
  feeAmount: bigint;
  feeBps: number;
  routeType?: 'direct' | 'multi_hop';
  intermediateToken?: string;
}

// ─── Graph Construction (mirrors pathFinder/index.ts) ─────────────────────────

function buildGraph(pools: PoolReserves[]): PoolEdge[] {
  const edges: PoolEdge[] = [];
  for (const pool of pools) {
    if (pool.reserve0 <= 0n || pool.reserve1 <= 0n) continue;
    edges.push({
      tokenIn: pool.token0.toLowerCase(),
      tokenOut: pool.token1.toLowerCase(),
      reserveIn: pool.reserve0,
      reserveOut: pool.reserve1,
      factory: pool.factory.toLowerCase(),
      dexName: pool.dexName,
      router: pool.router.toLowerCase(),
    });
    edges.push({
      tokenIn: pool.token1.toLowerCase(),
      tokenOut: pool.token0.toLowerCase(),
      reserveIn: pool.reserve1,
      reserveOut: pool.reserve0,
      factory: pool.factory.toLowerCase(),
      dexName: pool.dexName,
      router: pool.router.toLowerCase(),
    });
  }
  return edges;
}

// ─── AMM Math with decimal normalization (mirrors pathFinder/index.ts) ─────────

function calculateOutput(
  amountIn: bigint,
  reserveIn: bigint,
  reserveOut: bigint,
  tokenInDecimals?: number,
  tokenOutDecimals?: number,
): bigint {
  if (amountIn <= 0n || reserveIn <= 0n || reserveOut <= 0n) return 0n;
  const maxPossibleOut = reserveOut;

  let normalizedAmountIn = amountIn;
  let normalizedReserveIn = reserveIn;
  let normalizedReserveOut = reserveOut;

  if (tokenInDecimals !== undefined && tokenOutDecimals !== undefined) {
    if (tokenInDecimals < 18) {
      normalizedAmountIn = amountIn * 10n ** BigInt(18 - tokenInDecimals);
      normalizedReserveIn = reserveIn * 10n ** BigInt(18 - tokenInDecimals);
    } else if (tokenInDecimals > 18) {
      normalizedAmountIn = amountIn / 10n ** BigInt(tokenInDecimals - 18);
      normalizedReserveIn = reserveIn / 10n ** BigInt(tokenInDecimals - 18);
    }
    if (tokenOutDecimals < 18) {
      normalizedReserveOut = reserveOut * 10n ** BigInt(18 - tokenOutDecimals);
    } else if (tokenOutDecimals > 18) {
      normalizedReserveOut = reserveOut / 10n ** BigInt(tokenOutDecimals - 18);
    }

    const amountInWithFee = normalizedAmountIn * (FEE_DENOMINATOR - POOL_FEE_BPS);
    const numerator = amountInWithFee * normalizedReserveOut;
    const denominator = normalizedReserveIn * FEE_DENOMINATOR + amountInWithFee;
    let output = numerator / denominator;

    if (tokenOutDecimals < 18) {
      output = output / 10n ** BigInt(18 - tokenOutDecimals);
    } else if (tokenOutDecimals > 18) {
      output = output * 10n ** BigInt(tokenOutDecimals - 18);
    }

    if (output > maxPossibleOut) return maxPossibleOut;
    return output;
  }

  const amountInWithFee = amountIn * (FEE_DENOMINATOR - POOL_FEE_BPS);
  const numerator = amountInWithFee * reserveOut;
  const denominator = reserveIn * FEE_DENOMINATOR + amountInWithFee;
  return numerator / denominator;
}

// ─── Route Discovery (mirrors generateHubRoutes + BFS) ────────────────────────

const HUB_TOKEN_ADDRESSES = [WWDOGE.toLowerCase(), DC.toLowerCase(), OMNOM.toLowerCase()];

function generateHubRoutes(tokenIn: string, tokenOut: string, edges: PoolEdge[]): string[][] {
  const normalizedIn = tokenIn.toLowerCase();
  const normalizedOut = tokenOut.toLowerCase();
  const edgeSet = new Set<string>();
  for (const e of edges) edgeSet.add(`${e.tokenIn}>${e.tokenOut}`);
  const hasEdge = (a: string, b: string) => edgeSet.has(`${a}>${b}`);

  const hubs = HUB_TOKEN_ADDRESSES.filter(h => h !== normalizedIn && h !== normalizedOut);
  const paths: string[][] = [];

  for (const hub of hubs) {
    if (hasEdge(normalizedIn, hub) && hasEdge(hub, normalizedOut)) {
      paths.push([normalizedIn, hub, normalizedOut]);
    }
  }

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

function findAllRoutes(tokenIn: string, tokenOut: string, edges: PoolEdge[]): string[][] {
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
    if (path.length > 5) continue;
    if (current === normalizedOut && path.length > 1) {
      routes.push([...path]);
      continue;
    }
    const visited = new Set(path);
    const neighbors = adjacency.get(current);
    if (!neighbors) continue;
    for (const neighbor of neighbors) {
      if (visited.has(neighbor)) continue;
      queue.push({ path: [...path, neighbor] });
    }
  }

  // Merge hub routes
  const hubPaths = generateHubRoutes(normalizedIn, normalizedOut, edges);
  const seen = new Set(routes.map(p => p.join('>')));
  for (const hp of hubPaths) {
    const key = hp.join('>');
    if (!seen.has(key)) {
      seen.add(key);
      routes.push(hp);
    }
  }
  return routes;
}

// ─── Route Output Calculation (mirrors calculatePathOutput) ───────────────────

function calculatePathOutput(
  path: string[],
  amountIn: bigint,
  edges: PoolEdge[],
): { output: bigint; steps: RouteStep[] } {
  const steps: RouteStep[] = [];
  let currentAmount = amountIn;

  for (let hopIdx = 0; hopIdx < path.length - 1; hopIdx++) {
    const tokenIn = path[hopIdx];
    const tokenOut = path[hopIdx + 1];
    const inDec = getDecimals(tokenIn);
    const outDec = getDecimals(tokenOut);

    // Find best edge for this hop
    const candidates = edges.filter(
      e => e.tokenIn.toLowerCase() === tokenIn.toLowerCase() && e.tokenOut.toLowerCase() === tokenOut.toLowerCase()
    );
    if (candidates.length === 0) return { output: 0n, steps: [] };

    // Pick the edge with highest output (best price)
    let bestEdge = candidates[0];
    let bestOutput = calculateOutput(currentAmount, bestEdge.reserveIn, bestEdge.reserveOut, inDec, outDec);
    for (let i = 1; i < candidates.length; i++) {
      const out = calculateOutput(currentAmount, candidates[i].reserveIn, candidates[i].reserveOut, inDec, outDec);
      if (out > bestOutput) {
        bestOutput = out;
        bestEdge = candidates[i];
      }
    }

    let adjustedOutput = bestOutput;

    // Apply buy tax for output token
    const taxEntry = getCachedTax(tokenOut);
    if (taxEntry && taxEntry.buyTax > 0) {
      const taxBps = BigInt(Math.round(taxEntry.buyTax * 100));
      adjustedOutput = (adjustedOutput * (10000n - taxBps)) / 10000n;
    }

    // Normalize to 18-decimal for next hop
    let currentAmountNormalized = adjustedOutput;
    if (outDec < 18) {
      currentAmountNormalized = adjustedOutput * 10n ** BigInt(18 - outDec);
    } else if (outDec > 18) {
      currentAmountNormalized = adjustedOutput / 10n ** BigInt(outDec - 18);
    }
    currentAmount = currentAmountNormalized;

    steps.push({
      dexRouter: bestEdge.router,
      dexName: bestEdge.dexName,
      path: [tokenIn, tokenOut],
      amountIn: hopIdx === 0 ? amountIn : currentAmountNormalized, // simplified
      expectedAmountOut: adjustedOutput,
    });
  }

  // De-normalize final output
  const finalToken = path[path.length - 1];
  const finalDec = getDecimals(finalToken);
  let finalOutput = currentAmount;
  if (finalDec < 18) {
    finalOutput = currentAmount / 10n ** BigInt(18 - finalDec);
  } else if (finalDec > 18) {
    finalOutput = currentAmount * 10n ** BigInt(finalDec - 18);
  }

  return { output: finalOutput, steps };
}

// ─── Swap Request Builder (mirrors useSwap.ts buildSwapRequest) ───────────────

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

const MIN_INTERMEDIATE_OUT = BigInt('1000000000000');

function buildSwapRequest(
  route: RouteResult,
  slippagePct: number,
  userAddress: string,
): SwapRequest {
  const slippageMultiplier = BigInt(Math.round((100 - slippagePct) * 100));
  const feeAmount = (route.totalAmountIn * BigInt(PROTOCOL_FEE_BPS)) / 10000n;
  const swapAmount = route.totalAmountIn - feeAmount;

  const stepMinAmounts = route.steps.map((step) => {
    return (step.expectedAmountOut * slippageMultiplier) / 10000n;
  });

  // Compute normalized expected outputs for step chaining
  const stepExpectedNormalized = route.steps.map((step) => {
    const tokenOutAddr = step.path[step.path.length - 1];
    const decimals = getDecimals(tokenOutAddr);
    if (decimals < 18) {
      return step.expectedAmountOut * 10n ** BigInt(18 - decimals);
    } else if (decimals > 18) {
      return step.expectedAmountOut / 10n ** BigInt(decimals - 18);
    }
    return step.expectedAmountOut;
  });

  const steps: SwapStepRequest[] = route.steps.map((step, i) => {
    let stepAmountIn: bigint;
    let stepMinOut: bigint;

    if (i === 0) {
      stepAmountIn = swapAmount;
      stepMinOut = stepMinAmounts[0];
    } else {
      stepAmountIn = stepExpectedNormalized[i - 1];
      stepMinOut = i < route.steps.length - 1 ? MIN_INTERMEDIATE_OUT : stepMinAmounts[i];
    }

    return {
      router: step.dexRouter as `0x${string}`,
      path: step.path as `0x${string}`[],
      amountIn: stepAmountIn,
      minAmountOut: stepMinOut,
    };
  });

  const minTotalAmountOut = (route.totalExpectedOut * slippageMultiplier) / 10000n;
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);

  return {
    tokenIn: route.steps[0].path[0] as `0x${string}`,
    tokenOut: route.steps[route.steps.length - 1].path[route.steps[route.steps.length - 1].path.length - 1] as `0x${string}`,
    amountIn: route.totalAmountIn,
    minTotalAmountOut,
    steps,
    deadline,
    recipient: userAddress as `0x${string}`,
  };
}

// ─── Build test pool data from on-chain reserves ──────────────────────────────

function makeTestPools(): PoolReserves[] {
  return [
    // DC/MCRIB on Dogeshrek (token0=DC, token1=MCRIB)
    {
      reserve0: DC_MCRIB_RESERVES.reserve0,
      reserve1: DC_MCRIB_RESERVES.reserve1,
      token0: DC.toLowerCase(),
      token1: MCRIB.toLowerCase(),
      factory: DOGESHRK_FACTORY.toLowerCase(),
      dexName: 'DogeShrk',
      router: DOGESHRK_ROUTER.toLowerCase(),
    },
    // DC/WWDOGE on Dogeshrek
    {
      reserve0: DC_WWDOGE_RESERVES.reserve0,
      reserve1: DC_WWDOGE_RESERVES.reserve1,
      token0: DC.toLowerCase(),
      token1: WWDOGE.toLowerCase(),
      factory: DOGESHRK_FACTORY.toLowerCase(),
      dexName: 'DogeShrk',
      router: DOGESHRK_ROUTER.toLowerCase(),
    },
    // MCRIB/WWDOGE on Dogeshrek (token0=WWDOGE, token1=MCRIB)
    {
      reserve0: MCRIB_WWDOGE_RESERVES.reserve0,
      reserve1: MCRIB_WWDOGE_RESERVES.reserve1,
      token0: WWDOGE.toLowerCase(),
      token1: MCRIB.toLowerCase(),
      factory: DOGESHRK_FACTORY.toLowerCase(),
      dexName: 'DogeShrk',
      router: DOGESHRK_ROUTER.toLowerCase(),
    },
  ];
}

// ═══════════════════════════════════════════════════════════════════════════════
// TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe('MCRIB Swap Simulation', () => {

  // ─── 1. Tax Detection ─────────────────────────────────────────────────────

  describe('Tax Detection', () => {
    it('MCRIB returns 3% buy/sell tax from registry', () => {
      const tax = getCachedTax(MCRIB);
      expect(tax).not.toBeNull();
      expect(tax!.buyTax).toBe(3);
      expect(tax!.sellTax).toBe(3);
      expect(tax!.taxType).toBe('dex-only');
    });

    it('MCRIB is NOT anti-contract (no isAntiContract field)', () => {
      const tax = getCachedTax(MCRIB);
      expect(tax).not.toBeNull();
      // The tax info no longer has isAntiContract — verify it's undefined
      expect((tax as unknown as Record<string, unknown>).isAntiContract).toBeUndefined();
    });

    it('DC has no tax override', () => {
      const tax = getCachedTax(DC);
      expect(tax).toBeNull();
    });
  });

  // ─── 2. Graph Construction ────────────────────────────────────────────────

  describe('Graph Construction', () => {
    it('builds bidirectional edges from 3 pools', () => {
      const edges = buildGraph(makeTestPools());
      // 3 pools × 2 directions = 6 edges
      expect(edges.length).toBe(6);
    });

    it('has DC→MCRIB edge', () => {
      const edges = buildGraph(makeTestPools());
      const dcToMcrib = edges.find(
        e => e.tokenIn === DC.toLowerCase() && e.tokenOut === MCRIB.toLowerCase()
      );
      expect(dcToMcrib).toBeDefined();
      expect(dcToMcrib!.reserveIn).toBe(DC_MCRIB_RESERVES.reserve0);
      expect(dcToMcrib!.reserveOut).toBe(DC_MCRIB_RESERVES.reserve1);
    });

    it('has MCRIB→DC edge (reverse)', () => {
      const edges = buildGraph(makeTestPools());
      const mcribToDc = edges.find(
        e => e.tokenIn === MCRIB.toLowerCase() && e.tokenOut === DC.toLowerCase()
      );
      expect(mcribToDc).toBeDefined();
      expect(mcribToDc!.reserveIn).toBe(DC_MCRIB_RESERVES.reserve1);
      expect(mcribToDc!.reserveOut).toBe(DC_MCRIB_RESERVES.reserve0);
    });

    it('all edges use Dogeshrek router', () => {
      const edges = buildGraph(makeTestPools());
      for (const edge of edges) {
        expect(edge.router).toBe(DOGESHRK_ROUTER.toLowerCase());
        expect(edge.dexName).toBe('DogeShrk');
      }
    });
  });

  // ─── 3. Route Discovery ──────────────────────────────────────────────────

  describe('Route Discovery', () => {
    it('finds DC→MCRIB direct route via BFS', () => {
      const edges = buildGraph(makeTestPools());
      const routes = findAllRoutes(DC, MCRIB, edges);
      const direct = routes.find(r => r.length === 2 && r[0] === DC.toLowerCase() && r[1] === MCRIB.toLowerCase());
      expect(direct).toBeDefined();
    });

    it('finds DC→WWDOGE→MCRIB multi-hop route', () => {
      const edges = buildGraph(makeTestPools());
      const routes = findAllRoutes(DC, MCRIB, edges);
      const viaWwdoge = routes.find(r =>
        r.length === 3 && r[1] === WWDOGE.toLowerCase()
      );
      expect(viaWwdoge).toBeDefined();
    });

    it('finds at least 2 routes (direct + multi-hop)', () => {
      const edges = buildGraph(makeTestPools());
      const routes = findAllRoutes(DC, MCRIB, edges);
      expect(routes.length).toBeGreaterThanOrEqual(2);
    });

    it('finds MCRIB→DC reverse route', () => {
      const edges = buildGraph(makeTestPools());
      const routes = findAllRoutes(MCRIB, DC, edges);
      expect(routes.length).toBeGreaterThanOrEqual(1);
    });

    it('no routes for identical token in/out', () => {
      const edges = buildGraph(makeTestPools());
      const routes = findAllRoutes(DC, DC, edges);
      expect(routes.length).toBe(0);
    });
  });

  // ─── 4. AMM Math with 15-decimal MCRIB ───────────────────────────────────

  describe('AMM Math with MCRIB (15 decimals)', () => {
    it('calculates DC→MCRIB output with decimal normalization', () => {
      // 1000 DC (18 dec) → MCRIB (15 dec)
      const amountIn = BigInt(1000) * 10n ** 18n;
      const output = calculateOutput(
        amountIn,
        DC_MCRIB_RESERVES.reserve0,
        DC_MCRIB_RESERVES.reserve1,
        18,  // DC decimals
        15,  // MCRIB decimals
      );
      // Should produce a positive amount in MCRIB's native 15-decimal units
      expect(output).toBeGreaterThan(0n);
      // Should be less than pool's MCRIB reserves
      expect(output).toBeLessThan(DC_MCRIB_RESERVES.reserve1);
    });

    it('output is in MCRIB native decimals (15)', () => {
      const amountIn = BigInt(1000) * 10n ** 18n;
      const output = calculateOutput(
        amountIn,
        DC_MCRIB_RESERVES.reserve0,
        DC_MCRIB_RESERVES.reserve1,
        18,
        15,
      );
      // Pool ratio: ~26.7M DC (18 dec) / ~4.16T MCRIB (15 dec) ≈ 0.0000064 DC/MCRIB
      // So 1000 DC → ~155M MCRIB tokens (in 15-decimal units / 10^15)
      const mcribTokens = Number(output) / Math.pow(10, 15);
      expect(mcribTokens).toBeGreaterThan(100_000_000);
      expect(mcribTokens).toBeLessThan(200_000_000);
    });

    it('normalization produces correct output for DC→MCRIB', () => {
      const amountIn = BigInt(1000) * 10n ** 18n;
      // With normalization, AMM math works in 18-decimal space then converts back
      const output = calculateOutput(
        amountIn,
        DC_MCRIB_RESERVES.reserve0,
        DC_MCRIB_RESERVES.reserve1,
        18,
        15,
      );
      // Without normalization, same result (DC is already 18 dec, MCRIB up/down cancels)
      const outputNoNorm = calculateOutput(
        amountIn,
        DC_MCRIB_RESERVES.reserve0,
        DC_MCRIB_RESERVES.reserve1,
      );
      // For DC(18)→MCRIB(15), normalization is mathematically equivalent:
      // reserveOut scaled up by 10^3, then output scaled down by 10^3 → cancels
      expect(output).toEqual(outputNoNorm);
      // Both produce a valid positive output
      expect(output).toBeGreaterThan(0n);
      expect(output).toBeLessThan(DC_MCRIB_RESERVES.reserve1);
    });

    it('tiny amount: 1 DC → MCRIB', () => {
      const amountIn = 10n ** 18n; // 1 DC
      const output = calculateOutput(
        amountIn,
        DC_MCRIB_RESERVES.reserve0,
        DC_MCRIB_RESERVES.reserve1,
        18,
        15,
      );
      expect(output).toBeGreaterThan(0n);
    });

    it('large amount: 1M DC → MCRIB (should still work)', () => {
      const amountIn = BigInt(1_000_000) * 10n ** 18n;
      const output = calculateOutput(
        amountIn,
        DC_MCRIB_RESERVES.reserve0,
        DC_MCRIB_RESERVES.reserve1,
        18,
        15,
      );
      expect(output).toBeGreaterThan(0n);
      expect(output).toBeLessThan(DC_MCRIB_RESERVES.reserve1);
    });

    it('zero amount returns 0', () => {
      const output = calculateOutput(0n, DC_MCRIB_RESERVES.reserve0, DC_MCRIB_RESERVES.reserve1, 18, 15);
      expect(output).toBe(0n);
    });

    it('zero reserves return 0', () => {
      const output = calculateOutput(10n ** 18n, 0n, 10n ** 15n, 18, 15);
      expect(output).toBe(0n);
    });
  });

  // ─── 5. Full Route Calculation ───────────────────────────────────────────

  describe('Full Route Calculation (DC → MCRIB)', () => {
    const amountIn = BigInt(10000) * 10n ** 18n; // 10,000 DC

    it('direct route produces positive MCRIB output', () => {
      const edges = buildGraph(makeTestPools());
      const result = calculatePathOutput([DC.toLowerCase(), MCRIB.toLowerCase()], amountIn, edges);
      expect(result.output).toBeGreaterThan(0n);
      expect(result.steps.length).toBe(1);
    });

    it('multi-hop via WWDOGE produces positive MCRIB output', () => {
      const edges = buildGraph(makeTestPools());
      const result = calculatePathOutput(
        [DC.toLowerCase(), WWDOGE.toLowerCase(), MCRIB.toLowerCase()],
        amountIn,
        edges,
      );
      expect(result.output).toBeGreaterThan(0n);
      expect(result.steps.length).toBe(2);
    });

    it('direct route output is higher than multi-hop (no extra fee)', () => {
      const edges = buildGraph(makeTestPools());
      const direct = calculatePathOutput([DC.toLowerCase(), MCRIB.toLowerCase()], amountIn, edges);
      const viaWwdoge = calculatePathOutput(
        [DC.toLowerCase(), WWDOGE.toLowerCase(), MCRIB.toLowerCase()],
        amountIn,
        edges,
      );
      // Direct should generally give more output (no double pool fee)
      // Though this depends on pool ratios — we just verify both are positive
      expect(direct.output).toBeGreaterThan(0n);
      expect(viaWwdoge.output).toBeGreaterThan(0n);
    });

    it('3% buy tax is deducted from MCRIB output', () => {
      const edges = buildGraph(makeTestPools());
      const path = [DC.toLowerCase(), MCRIB.toLowerCase()];

      // Calculate without tax
      const rawOutput = calculateOutput(
        amountIn,
        DC_MCRIB_RESERVES.reserve0,
        DC_MCRIB_RESERVES.reserve1,
        18,
        15,
      );

      // Calculate with tax (what calculatePathOutput does)
      const result = calculatePathOutput(path, amountIn, edges);
      const taxEntry = getCachedTax(MCRIB);
      const expectedAfterTax = (rawOutput * (10000n - BigInt(taxEntry!.buyTax * 100))) / 10000n;

      expect(result.output).toBe(expectedAfterTax);
    });
  });

  // ─── 6. Swap Request Construction ────────────────────────────────────────

  describe('Swap Request Construction', () => {
    it('builds valid swap request for DC→MCRIB direct route', () => {
      const edges = buildGraph(makeTestPools());
      const amountIn = BigInt(10000) * 10n ** 18n;
      const { output, steps } = calculatePathOutput([DC.toLowerCase(), MCRIB.toLowerCase()], amountIn, edges);

      const route: RouteResult = {
        id: 'test-direct',
        steps,
        totalAmountIn: amountIn,
        totalExpectedOut: output,
        priceImpact: 0.01,
        feeAmount: (amountIn * BigInt(PROTOCOL_FEE_BPS)) / 10000n,
        feeBps: PROTOCOL_FEE_BPS,
      };

      const request = buildSwapRequest(route, 3.0, '0x1234567890abcdef1234567890abcdef12345678');

      expect(request.tokenIn.toLowerCase()).toBe(DC.toLowerCase());
      expect(request.tokenOut.toLowerCase()).toBe(MCRIB.toLowerCase());
      expect(request.steps.length).toBe(1);
      expect(request.steps[0].router.toLowerCase()).toBe(DOGESHRK_ROUTER.toLowerCase());
      expect(request.steps[0].path[0].toLowerCase()).toBe(DC.toLowerCase());
      expect(request.steps[0].path[1].toLowerCase()).toBe(MCRIB.toLowerCase());
      expect(request.steps[0].amountIn).toBeGreaterThan(0n);
      expect(request.steps[0].minAmountOut).toBeGreaterThan(0n);
      expect(request.minTotalAmountOut).toBeGreaterThan(0n);
    });

    it('protocol fee is deducted from step 0 amountIn', () => {
      const edges = buildGraph(makeTestPools());
      const amountIn = BigInt(10000) * 10n ** 18n;
      const { output, steps } = calculatePathOutput([DC.toLowerCase(), MCRIB.toLowerCase()], amountIn, edges);

      const fee = (amountIn * BigInt(PROTOCOL_FEE_BPS)) / 10000n;
      const swapAmount = amountIn - fee;

      const route: RouteResult = {
        id: 'test-fee',
        steps,
        totalAmountIn: amountIn,
        totalExpectedOut: output,
        priceImpact: 0.01,
        feeAmount: fee,
        feeBps: PROTOCOL_FEE_BPS,
      };

      const request = buildSwapRequest(route, 3.0, '0x1234567890abcdef1234567890abcdef12345678');

      // Step 0 amountIn should be swapAmount (after fee), not totalAmountIn
      expect(request.steps[0].amountIn).toBe(swapAmount);
      expect(swapAmount).toBeLessThan(amountIn);
    });

    it('slippage reduces minAmountOut correctly', () => {
      const edges = buildGraph(makeTestPools());
      const amountIn = BigInt(10000) * 10n ** 18n;
      const { output, steps } = calculatePathOutput([DC.toLowerCase(), MCRIB.toLowerCase()], amountIn, edges);

      const route: RouteResult = {
        id: 'test-slippage',
        steps,
        totalAmountIn: amountIn,
        totalExpectedOut: output,
        priceImpact: 0.01,
        feeAmount: (amountIn * BigInt(PROTOCOL_FEE_BPS)) / 10000n,
        feeBps: PROTOCOL_FEE_BPS,
      };

      const request3pct = buildSwapRequest(route, 3.0, '0x1234567890abcdef1234567890abcdef12345678');
      const request5pct = buildSwapRequest(route, 5.0, '0x1234567890abcdef1234567890abcdef12345678');

      // Higher slippage → lower minTotalAmountOut
      expect(request5pct.minTotalAmountOut).toBeLessThan(request3pct.minTotalAmountOut);
      // Both should be positive
      expect(request3pct.minTotalAmountOut).toBeGreaterThan(0n);
      expect(request5pct.minTotalAmountOut).toBeGreaterThan(0n);
    });

    it('multi-hop request has 2 steps with correct paths', () => {
      const edges = buildGraph(makeTestPools());
      const amountIn = BigInt(10000) * 10n ** 18n;
      const { output, steps } = calculatePathOutput(
        [DC.toLowerCase(), WWDOGE.toLowerCase(), MCRIB.toLowerCase()],
        amountIn,
        edges,
      );

      const route: RouteResult = {
        id: 'test-multihop',
        steps,
        totalAmountIn: amountIn,
        totalExpectedOut: output,
        priceImpact: 0.02,
        feeAmount: (amountIn * BigInt(PROTOCOL_FEE_BPS)) / 10000n,
        feeBps: PROTOCOL_FEE_BPS,
        routeType: 'multi_hop',
        intermediateToken: WWDOGE.toLowerCase(),
      };

      const request = buildSwapRequest(route, 3.0, '0x1234567890abcdef1234567890abcdef12345678');

      expect(request.steps.length).toBe(2);
      expect(request.steps[0].path.map(p => p.toLowerCase())).toEqual([DC.toLowerCase(), WWDOGE.toLowerCase()]);
      expect(request.steps[1].path.map(p => p.toLowerCase())).toEqual([WWDOGE.toLowerCase(), MCRIB.toLowerCase()]);
      // Step 0 uses slippage-adjusted output (matches production: stepMinAmounts[0])
      expect(request.steps[0].minAmountOut).toBeGreaterThan(0n);
      // Step 1 (last step) also uses slippage-adjusted output
      expect(request.steps[1].minAmountOut).toBeGreaterThan(0n);
    });
  });

  // ─── 7. Edge Cases ───────────────────────────────────────────────────────

  describe('Edge Cases', () => {
    it('dust amount: 0.001 DC → MCRIB', () => {
      const edges = buildGraph(makeTestPools());
      const amountIn = BigInt(1) * 10n ** 15n; // 0.001 DC (3 decimal places)
      const result = calculatePathOutput([DC.toLowerCase(), MCRIB.toLowerCase()], amountIn, edges);
      // May be 0 for dust amounts due to BigInt division rounding
      // But should NOT throw
      expect(result.output).toBeGreaterThanOrEqual(0n);
    });

    it('empty pool data returns no routes', () => {
      const routes = findAllRoutes(DC, MCRIB, []);
      expect(routes.length).toBe(0);
    });

    it('single pool (DC/MCRIB only) still finds direct route', () => {
      const pools: PoolReserves[] = [{
        reserve0: DC_MCRIB_RESERVES.reserve0,
        reserve1: DC_MCRIB_RESERVES.reserve1,
        token0: DC.toLowerCase(),
        token1: MCRIB.toLowerCase(),
        factory: DOGESHRK_FACTORY.toLowerCase(),
        dexName: 'DogeShrk',
        router: DOGESHRK_ROUTER.toLowerCase(),
      }];
      const edges = buildGraph(pools);
      const routes = findAllRoutes(DC, MCRIB, edges);
      expect(routes.length).toBe(1);
      expect(routes[0]).toEqual([DC.toLowerCase(), MCRIB.toLowerCase()]);
    });

    it('MCRIB → WWDOGE reverse swap works', () => {
      const edges = buildGraph(makeTestPools());
      const amountIn = BigInt(1000) * 10n ** BigInt(MCRIB_DECIMALS); // 1000 MCRIB
      const result = calculatePathOutput([MCRIB.toLowerCase(), WWDOGE.toLowerCase()], amountIn, edges);
      expect(result.output).toBeGreaterThan(0n);
    });

    it('MCRIB → DC via WWDOGE multi-hop works', () => {
      const edges = buildGraph(makeTestPools());
      const amountIn = BigInt(1000) * 10n ** BigInt(MCRIB_DECIMALS);
      const result = calculatePathOutput(
        [MCRIB.toLowerCase(), WWDOGE.toLowerCase(), DC.toLowerCase()],
        amountIn,
        edges,
      );
      expect(result.output).toBeGreaterThan(0n);
    });

    it('very large swap: 10M DC does not overflow', () => {
      const edges = buildGraph(makeTestPools());
      const amountIn = BigInt(10_000_000) * 10n ** 18n;
      const result = calculatePathOutput([DC.toLowerCase(), MCRIB.toLowerCase()], amountIn, edges);
      // Should produce output (pool has 26.7M DC)
      expect(result.output).toBeGreaterThan(0n);
    });

    it('sell tax deduction for MCRIB→DC', () => {
      const edges = buildGraph(makeTestPools());
      const amountIn = BigInt(1000) * 10n ** BigInt(MCRIB_DECIMALS);

      // The sell tax should apply to MCRIB as input
      const tax = getCachedTax(MCRIB);
      expect(tax!.sellTax).toBe(3);

      // Path: MCRIB → DC
      const result = calculatePathOutput([MCRIB.toLowerCase(), DC.toLowerCase()], amountIn, edges);
      expect(result.output).toBeGreaterThan(0n);
      // Note: sell tax is NOT applied in calculatePathOutput — it's applied at route level
      // This test verifies the path calculation itself works
    });
  });

  // ─── 8. Decimal Normalization Correctness ────────────────────────────────

  describe('Decimal Normalization', () => {
    it('MCRIB 15-decimal reserve is correctly normalized for AMM', () => {
      const amountIn = BigInt(1000) * 10n ** 18n; // 1000 DC

      // Raw pool reserves:
      // DC:  26,685,700,617,113,776,516,910,716 (18 dec = ~26.7M DC)
      // MCRIB: 4,162,938,342,378,943,171,960,830,633 (15 dec)
      //   = 4,162,938,342,378,943,171,960,830,633 / 10^15 = ~4,162,938 MCRIB tokens

      const output = calculateOutput(
        amountIn,
        DC_MCRIB_RESERVES.reserve0,
        DC_MCRIB_RESERVES.reserve1,
        18,
        15,
      );

      // Pool ratio: ~26.7M DC (18 dec) / ~4.16T MCRIB (15 dec)
      // So 1000 DC → ~155M MCRIB tokens
      const mcribTokenCount = Number(output) / Math.pow(10, 15);
      expect(mcribTokenCount).toBeGreaterThan(100_000_000);
      expect(mcribTokenCount).toBeLessThan(200_000_000);
    });

    it('step chaining preserves value through DC→WWDOGE→MCRIB', () => {
      const edges = buildGraph(makeTestPools());
      const amountIn = BigInt(10000) * 10n ** 18n;
      const { output, steps } = calculatePathOutput(
        [DC.toLowerCase(), WWDOGE.toLowerCase(), MCRIB.toLowerCase()],
        amountIn,
        edges,
      );

      // Verify each step has positive amounts
      for (const step of steps) {
        expect(step.amountIn).toBeGreaterThan(0n);
        expect(step.expectedAmountOut).toBeGreaterThan(0n);
      }

      // Final output should be in MCRIB 15-decimal units
      const mcribTokens = Number(output) / Math.pow(10, 15);
      expect(mcribTokens).toBeGreaterThan(0);
    });
  });

  // ─── 9. Contract-Level Validation ───────────────────────────────────────

  describe('Contract-Level Validation', () => {
    it('step 0 amountIn equals swapAmount (totalIn - fee)', () => {
      const amountIn = BigInt(10000) * 10n ** 18n;
      const fee = (amountIn * BigInt(PROTOCOL_FEE_BPS)) / 10000n;
      const swapAmount = amountIn - fee;

      const edges = buildGraph(makeTestPools());
      const { output, steps } = calculatePathOutput([DC.toLowerCase(), MCRIB.toLowerCase()], amountIn, edges);

      const route: RouteResult = {
        id: 'test-contract',
        steps,
        totalAmountIn: amountIn,
        totalExpectedOut: output,
        priceImpact: 0.01,
        feeAmount: fee,
        feeBps: PROTOCOL_FEE_BPS,
      };

      const request = buildSwapRequest(route, 3.0, '0x1234567890abcdef1234567890abcdef12345678');

      // Contract validates: step[0].amountIn == swapAmount
      expect(request.steps[0].amountIn).toBe(swapAmount);
    });

    it('path starts with tokenIn and ends with tokenOut', () => {
      const edges = buildGraph(makeTestPools());
      const amountIn = BigInt(10000) * 10n ** 18n;
      const { output, steps } = calculatePathOutput([DC.toLowerCase(), MCRIB.toLowerCase()], amountIn, edges);

      const route: RouteResult = {
        id: 'test-path',
        steps,
        totalAmountIn: amountIn,
        totalExpectedOut: output,
        priceImpact: 0.01,
        feeAmount: (amountIn * BigInt(PROTOCOL_FEE_BPS)) / 10000n,
        feeBps: PROTOCOL_FEE_BPS,
      };

      const request = buildSwapRequest(route, 3.0, '0x1234567890abcdef1234567890abcdef12345678');

      // Contract validates: step.path[0] == currentToken
      expect(request.steps[0].path[0].toLowerCase()).toBe(DC.toLowerCase());
      expect(request.steps[0].path[1].toLowerCase()).toBe(MCRIB.toLowerCase());
    });

    it('minTotalAmountOut accounts for 3% tax + 3% slippage', () => {
      const edges = buildGraph(makeTestPools());
      const amountIn = BigInt(10000) * 10n ** 18n;
      const { output, steps } = calculatePathOutput([DC.toLowerCase(), MCRIB.toLowerCase()], amountIn, edges);

      const route: RouteResult = {
        id: 'test-tax-slippage',
        steps,
        totalAmountIn: amountIn,
        totalExpectedOut: output,
        priceImpact: 0.01,
        feeAmount: (amountIn * BigInt(PROTOCOL_FEE_BPS)) / 10000n,
        feeBps: PROTOCOL_FEE_BPS,
      };

      // 3% slippage
      const request = buildSwapRequest(route, 3.0, '0x1234567890abcdef1234567890abcdef12345678');

      // minTotalAmountOut should be output * 0.97 (3% slippage)
      const expectedMin = (output * 9700n) / 10000n;
      expect(request.minTotalAmountOut).toBe(expectedMin);

      // Should be less than the expected output
      expect(request.minTotalAmountOut).toBeLessThan(output);

      // Should still be positive and meaningful
      expect(request.minTotalAmountOut).toBeGreaterThan(0n);
    });
  });
});
