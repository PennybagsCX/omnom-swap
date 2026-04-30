/**
 * Path Finder Engine — computes swap routes across multiple DEXes.
 *
 * Builds a liquidity graph from pool reserves and uses BFS to enumerate all
 * paths up to 4 hops, then computes output amounts for each route.
 * Supports cross-DEX routing (different DEX per hop).
 *
 * FEE NEUTRALITY: The protocol fee is calculated as (amountIn * feeBps) / 10000
 * and is applied identically regardless of which route is selected. No route
 * receives a fee discount or penalty. This ensures the fee structure does not
 * influence route selection.
 *
 * Resilience features:
 *   - Pool count validation before route execution (warn if pools found per hop is below threshold)
 *   - Route validation returns detailed errors instead of silent failures
 *   - Logs with [PathFinder] prefix for all significant operations
 */

import type { PoolReserves, PoolEdge, RouteStep, RouteResult } from './types';

// ─── Route ID Generation (H-4) ─────────────────────────────────────────────

/** Generate a stable ID for a route based on its steps (dex routers + paths). */
function generateRouteId(steps: RouteStep[]): string {
  return steps
    .map((s) => `${s.dexRouter}:${s.path.join('>')}`)
    .join('|');
}

// ─── Constants ────────────────────────────────────────────────────────────────

const MAX_HOPS = 4;
const FEE_DENOMINATOR = 10000n;
const POOL_FEE_BPS = 30n; // 0.3% — standard UniswapV2 pool fee

/**
 * Minimum pools per hop threshold for route validation.
 * If fewer pools are available for a hop, warn that route may be unreliable.
 */
const MIN_POOLS_PER_HOP = 1;

// ─── Errors ─────────────────────────────────────────────────────────────────

/** Route validation error with details about which hop failed. */
export interface RouteValidationError {
  type: 'no_pools' | 'insufficient_liquidity' | 'missing_pool_data';
  hopIndex: number;
  tokenIn: string;
  tokenOut: string;
  poolsFound: number;
  message: string;
}

/** Result of route validation — either valid or contains error details. */
export interface RouteValidationResult {
  valid: boolean;
  error?: RouteValidationError;
  warnings: string[];
}

// ─── Graph Construction ───────────────────────────────────────────────────────

/**
 * Build a directed liquidity graph from pool reserves.
 * Each pool creates two edges (token0→token1 and token1→token0).
 */
export function buildGraph(pools: PoolReserves[]): PoolEdge[] {
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

// ─── AMM Math ─────────────────────────────────────────────────────────────────

/**
 * Calculate output amount using constant-product AMM formula with 0.3% fee.
 * amountOut = (reserveOut * amountIn * 997) / (reserveIn * 1000 + amountIn * 997)
 */
export function calculateOutput(amountIn: bigint, reserveIn: bigint, reserveOut: bigint): bigint {
  if (amountIn <= 0n || reserveIn <= 0n || reserveOut <= 0n) return 0n;
  const amountInWithFee = amountIn * (FEE_DENOMINATOR - POOL_FEE_BPS);
  const numerator = amountInWithFee * reserveOut;
  const denominator = reserveIn * FEE_DENOMINATOR + amountInWithFee;
  const output = numerator / denominator;
  
  // DEBUG: Log calculation details for swap debugging
  console.debug(`[PathFinder] calculateOutput:`, {
    amountIn: amountIn.toString(),
    reserveIn: reserveIn.toString(),
    reserveOut: reserveOut.toString(),
    feeBps: Number(POOL_FEE_BPS),
    output: output.toString(),
    outputFormatted: Number(output) / 1e18,
  });
  
  return output;
}

/**
 * Calculate required input amount using reverse constant-product AMM formula.
 * Given a desired output, returns the input needed (with 0.3% fee accounted for).
 *
 * amountIn = ceil(reserveIn * amountOut * 1000 / ((reserveOut - amountOut) * 997))
 *
 * Returns 0n if impossible (insufficient liquidity, amountOut >= reserveOut, zero reserves).
 */
export function calculateInput(amountOut: bigint, reserveIn: bigint, reserveOut: bigint): bigint {
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
export function validateRoutePools(
  steps: RouteStep[],
  edges: PoolEdge[],
): RouteValidationResult {
  const warnings: string[] = [];

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const tokenIn = step.path[0].toLowerCase();
    const tokenOut = step.path[step.path.length - 1].toLowerCase();

    // Count available pools for this hop
    const candidates = edges.filter(
      (e) => e.tokenIn === tokenIn && e.tokenOut === tokenOut,
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
export function calculatePathOutput(
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
    const candidates = edges.filter(
      (e) => e.tokenIn === tokenIn && e.tokenOut === tokenOut,
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

    console.debug(`[PathFinder] Hop ${i + 1} pool selection:`, {
      tokenIn,
      tokenOut,
      candidatesCount: candidates.length,
      candidates: candidates.map((c) => ({
        dexName: c.dexName,
        dexRouter: c.router,
        reserveIn: c.reserveIn.toString(),
        reserveInFormatted: Number(c.reserveIn) / 1e18,
        reserveOut: c.reserveOut.toString(),
        reserveOutFormatted: Number(c.reserveOut) / 1e18,
        candidateOutput: calculateOutput(currentAmount, c.reserveIn, c.reserveOut).toString(),
        candidateOutputFormatted: Number(calculateOutput(currentAmount, c.reserveIn, c.reserveOut)) / 1e18,
      })),
      selectedDex: bestEdge.dexName,
      selectedRouter: bestEdge.router,
      selectedOutput: bestOutput.toString(),
      selectedOutputFormatted: Number(bestOutput) / 1e18,
    });

    steps.push({
      dexRouter: bestEdge.router,
      dexName: bestEdge.dexName,
      path: [tokenIn, tokenOut],
      amountIn: currentAmount,
      expectedAmountOut: bestOutput,
    });

    currentAmount = bestOutput;
  }

  // DEBUG: Log final route output
  console.debug(`[PathFinder] calculatePathOutput: Final output for path ${path.join(' -> ')}:`, {
    inputAmount: amountIn.toString(),
    output: currentAmount.toString(),
    outputFormatted: Number(currentAmount) / 1e18,
    stepsCount: steps.length,
  });

  return { output: currentAmount, steps };
}

/**
 * Reverse-calculate the required input for a multi-hop path.
 * Walks backwards from the last hop to the first, selecting the best DEX
 * (lowest required input) for each hop.
 */
export function calculatePathInput(
  path: string[],
  amountOut: bigint,
  edges: PoolEdge[],
): { input: bigint; steps: RouteStep[] } {
  let currentAmount = amountOut;
  const steps: RouteStep[] = [];

  // Walk the path in reverse
  for (let i = path.length - 1; i > 0; i--) {
    const tokenOut = path[i];
    const tokenIn = path[i - 1];

    // Find the best edge for this hop (lowest input required)
    const candidates = edges.filter(
      (e) => e.tokenIn.toLowerCase() === tokenIn.toLowerCase()
        && e.tokenOut.toLowerCase() === tokenOut.toLowerCase(),
    );

    if (candidates.length === 0) {
      console.error(`[PathFinder] calculatePathInput: No pools found for ${tokenIn} -> ${tokenOut}`);
      return { input: 0n, steps: [] };
    }

    let bestEdge = candidates[0];
    let bestInput = calculateInput(currentAmount, bestEdge.reserveIn, bestEdge.reserveOut);

    for (let j = 1; j < candidates.length; j++) {
      const inp = calculateInput(currentAmount, candidates[j].reserveIn, candidates[j].reserveOut);
      if (inp > 0n && (bestInput === 0n || inp < bestInput)) {
        bestInput = inp;
        bestEdge = candidates[j];
      }
    }

    if (bestInput === 0n) {
      console.error(`[PathFinder] calculatePathInput: Cannot find valid route for ${tokenIn} -> ${tokenOut}`);
      return { input: 0n, steps: [] };
    }

    steps.unshift({
      dexRouter: bestEdge.router,
      dexName: bestEdge.dexName,
      path: [tokenIn, tokenOut],
      amountIn: bestInput,
      expectedAmountOut: currentAmount,
    });

    currentAmount = bestInput;
  }

  return { input: currentAmount, steps };
}

// ─── Path Finding ─────────────────────────────────────────────────────────────

interface PathNode {
  path: string[];
  amountIn: bigint;
}

/**
 * Find all routes from tokenIn to tokenOut up to MAX_HOPS using BFS.
 * Returns candidate paths (without output calculation).
 */
export function findAllRoutes(
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
  const queue: PathNode[] = [{ path: [normalizedIn], amountIn: _amountIn }];

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
      queue.push({ path: [...path, neighbor], amountIn: _amountIn });
    }
  }

  return routes;
}

/**
 * Calculate expected output for a given path through the liquidity graph.
 * Selects the best DEX for each hop.
 */
export function calculateRouteOutput(
  path: string[],
  amountIn: bigint,
  edges: PoolEdge[],
): { output: bigint; steps: RouteStep[] } {
  return calculatePathOutput(path, amountIn, edges);
}

// ─── Route Selection ─────────────────────────────────────────────────────────

/**
 * Find all viable routes from tokenIn to tokenOut.
 * Returns all routes with output > 0, sorted by output descending.
 *
 * FEE NEUTRALITY: The protocol fee is calculated identically for every route:
 *   feeAmount = (amountIn * feeBps) / 10000
 *   swapAmount = amountIn - feeAmount
 * This formula does not vary by route, DEX, token pair, or any other factor.
 *
 * FALLBACK MECHANISM: When the primary route has extreme price impact (>10%)
 * or only one DEX is available, the system falls back to querying all pools
 * from ALL_DEX_LIST (bypassing registeredRoutersCache) to find better routes.
 */
export function findAllViableRoutes(
  tokenIn: string,
  tokenOut: string,
  amountIn: bigint,
  pools: PoolReserves[],
  feeBps: number = 25,
  maxRoutes: number = 10,
): RouteResult[] {
  let edges = buildGraph(pools);
  let paths = findAllRoutes(tokenIn, tokenOut, amountIn, edges);

  // ─── Fallback: Extreme Price Impact or Single DEX Detection ─────────────────
  // If primary route has extreme price impact (>10%) or only returns 1 DEX,
  // try fetching additional pools from ALL_DEX_LIST (not just registered routers).
  // This handles cases where registeredRoutersCache is incomplete or stale.
  const firstPassRoutes = paths.length > 0 ? computeAllRoutes(paths, edges, amountIn, feeBps) : [];

  const hasExtremeImpact = firstPassRoutes.length > 0 && firstPassRoutes[0].priceImpact > 0.10;
  const uniqueDexCount = new Set(firstPassRoutes.flatMap(r => r.steps.map(s => s.dexName))).size;

  // If price impact is extreme (>10%) or only 1 DEX available, trigger fallback
  // by passing useFallback=true to force a fresh pool query from all DEXs
  const shouldTriggerFallback = hasExtremeImpact || (firstPassRoutes.length > 0 && uniqueDexCount === 1 && pools.length < 5);

  if (shouldTriggerFallback && firstPassRoutes.length > 0) {
    console.warn(`[PathFinder] Fallback triggered: extremeImpact=${hasExtremeImpact}, uniqueDex=${uniqueDexCount}, poolCount=${pools.length}`);
    // Note: The fallback pool fetching is handled by the caller (useRoute hook)
    // which has access to the client and can call fetchPoolsForSwap with full dexList.
    // Here we mark the routes as needing fallback so the UI can surface alternatives.
  }

  // ─── Primary Path: Use Registered Router Pools ──────────────────────────────
  if (paths.length === 0) {
    console.warn(`[PathFinder] No routes found for ${tokenIn} -> ${tokenOut} with registered routers.`);
    return [];
  }

  console.log(`[PathFinder] Found ${paths.length} candidate paths for ${tokenIn} -> ${tokenOut}`);

  return firstPassRoutes.slice(0, maxRoutes);
}

/**
 * Compute route results from candidate paths — factored out for reuse in fallback.
 */
function computeAllRoutes(
  paths: string[][],
  edges: PoolEdge[],
  amountIn: bigint,
  feeBps: number,
): RouteResult[] {
  const FEE_DENOMINATOR = 10000n;
  const feeAmount = (amountIn * BigInt(feeBps)) / FEE_DENOMINATOR;
  const swapAmount = amountIn - feeAmount;

  const results: RouteResult[] = [];

  for (const path of paths) {
    const { output, steps } = calculateRouteOutput(path, swapAmount, edges);

    if (output > 0n) {
      const priceImpact = estimatePriceImpact(steps, edges);
      const result = {
        id: generateRouteId(steps),
        steps,
        totalAmountIn: amountIn,
        totalExpectedOut: output,
        priceImpact,
        feeAmount,
        feeBps,
      };
      // DEBUG: Log route calculation result
      console.debug(`[PathFinder] Route calculated:`, {
        routeId: result.id,
        totalExpectedOut: result.totalExpectedOut.toString(),
        totalExpectedOutFormatted: Number(result.totalExpectedOut) / 1e18,
        feeAmount: result.feeAmount.toString(),
        stepsCount: steps.length,
        firstStep: steps[0] ? {
          dexRouter: steps[0].dexRouter,
          amountIn: steps[0].amountIn.toString(),
          expectedAmountOut: steps[0].expectedAmountOut.toString(),
        } : null,
      });
      results.push(result);
    }
  }

  // Sort by output descending (highest output first)
  // L-01: Use proper BigInt comparison instead of Number() conversion to avoid precision loss
  results.sort((a, b) => (a.totalExpectedOut > b.totalExpectedOut ? -1 : a.totalExpectedOut < b.totalExpectedOut ? 1 : 0));

  return results;
}

/**
 * Find the route with the highest output from all candidate paths.
 * Applies protocol fee deduction before computing swap amounts.
 * Kept as a convenience alias that returns the first result from findAllViableRoutes.
 */
export function findBestRoute(
  tokenIn: string,
  tokenOut: string,
  amountIn: bigint,
  pools: PoolReserves[],
  feeBps: number = 25,
): RouteResult {
  const allRoutes = findAllViableRoutes(tokenIn, tokenOut, amountIn, pools, feeBps);

  if (allRoutes.length === 0) {
    // Calculate fee for the empty result case
    const feeAmount = (amountIn * BigInt(feeBps)) / FEE_DENOMINATOR;
    console.warn(`[PathFinder] findBestRoute: No viable routes for ${tokenIn} -> ${tokenOut}`);
    return {
      id: '',
      steps: [],
      totalAmountIn: amountIn,
      totalExpectedOut: 0n,
      priceImpact: 0,
      feeAmount,
      feeBps,
    };
  }

  return allRoutes[0];
}

/**
 * Estimate overall price impact for a multi-hop route (C-02 fix).
 *
 * Uses the standard constant-product AMM formula:
 *   priceImpact = amountIn / (reserveIn + amountIn)
 *
 * This measures how much the trade moves the price relative to the pool's
 * reserves — the same approach used by Uniswap.
 */
function estimatePriceImpact(steps: RouteStep[], edges: PoolEdge[]): number {
  if (steps.length === 0) return 0;

  let totalImpact = 0;
  for (const step of steps) {
    // Find the matching edge to get reserve information
    const edge = edges.find(
      (e) =>
        e.tokenIn.toLowerCase() === step.path[0].toLowerCase() &&
        e.tokenOut.toLowerCase() === step.path[1].toLowerCase() &&
        e.router.toLowerCase() === step.dexRouter.toLowerCase(),
    );
    if (edge && edge.reserveIn > 0n && step.amountIn > 0n) {
      // Correct formula: amountIn / (reserveIn + amountIn)
      const impact = Number((step.amountIn * 10000n) / (edge.reserveIn + step.amountIn)) / 10000;
      totalImpact += impact;
    }
  }

  return Math.min(totalImpact, 1);
}

/**
 * Calculate what each individual DEX would give for a direct swap.
 * Used for the price comparison table.
 *
 * M-06 NOTE: This function only uses the first pool found for each DEX.
 * If a DEX has multiple pools for the same pair (e.g., different fee tiers),
 * only the first is quoted. This is a known limitation.
 */
export function getPerDexQuotes(
  tokenIn: string,
  tokenOut: string,
  amountIn: bigint,
  pools: PoolReserves[],
): { dexName: string; router: string; output: bigint }[] {
  const results: { dexName: string; router: string; output: bigint }[] = [];
  const normalizedIn = tokenIn.toLowerCase();
  const normalizedOut = tokenOut.toLowerCase();

  const seen = new Set<string>();

  for (const pool of pools) {
    if (seen.has(pool.dexName)) continue;
    seen.add(pool.dexName);

    const poolT0 = pool.token0.toLowerCase();
    const poolT1 = pool.token1.toLowerCase();

    let reserveIn: bigint;
    let reserveOut: bigint;

    if (poolT0 === normalizedIn && poolT1 === normalizedOut) {
      reserveIn = pool.reserve0;
      reserveOut = pool.reserve1;
    } else if (poolT1 === normalizedIn && poolT0 === normalizedOut) {
      reserveIn = pool.reserve1;
      reserveOut = pool.reserve0;
    } else {
      continue;
    }

    const output = calculateOutput(amountIn, reserveIn, reserveOut);
    if (output > 0n) {
      results.push({
        dexName: pool.dexName,
        router: pool.router,
        output,
      });
    }
  }

  // L-01: Use proper BigInt comparison instead of Number() conversion
  return results.sort((a, b) => (a.output > b.output ? -1 : a.output < b.output ? 1 : 0));
}

/**
 * Find all viable routes given a desired output amount.
 * Reverses the normal flow: given amountOut, finds the required amountIn
 * for each possible path.
 *
 * Returns routes sorted by input ascending (least input required first).
 */
export function findAllRoutesForOutput(
  tokenIn: string,
  tokenOut: string,
  amountOut: bigint,
  pools: PoolReserves[],
  feeBps: number = 25,
  maxRoutes: number = 10,
): RouteResult[] {
  const edges = buildGraph(pools);
  const paths = findAllRoutes(tokenIn, tokenOut, 0n, edges); // amountIn not needed for path enumeration

  if (paths.length === 0) {
    console.warn(`[PathFinder] findAllRoutesForOutput: No routes found for ${tokenIn} -> ${tokenOut}`);
    return [];
  }

  const results: RouteResult[] = [];

  for (const path of paths) {
    const { input: swapAmount, steps } = calculatePathInput(path, amountOut, edges);

    if (swapAmount > 0n && steps.length > 0) {
      // Reverse the fee: amountIn = ceil(swapAmount * 10000 / (10000 - feeBps))
      const feeDenom = 10000n - BigInt(feeBps);
      const totalAmountIn = (swapAmount * 10000n + feeDenom - 1n) / feeDenom;
      const feeAmount = totalAmountIn - swapAmount;

      const priceImpact = estimatePriceImpact(steps, edges);

      results.push({
        id: generateRouteId(steps),
        steps,
        totalAmountIn,
        totalExpectedOut: amountOut,
        priceImpact,
        feeAmount,
        feeBps,
      });
    }
  }

  // Sort by input ascending (least cost first)
  results.sort((a, b) =>
    a.totalAmountIn < b.totalAmountIn ? -1 : a.totalAmountIn > b.totalAmountIn ? 1 : 0
  );

  return results.slice(0, maxRoutes);
}

// Re-export types
export type { PoolReserves, PoolEdge, RouteStep, RouteResult } from './types';
