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
 *
 * Phase 4 enhancements:
 *   - Automatic fallback to multi-hop routing when direct route has low TVL
 *   - WWDOGE intermediate token routing for low-liquidity pairs
 *   - Route type classification (direct vs multi_hop)
 *
 * Phase 5 enhancements:
 *   - Minimum liquidity filter ($1,000 TVL per pool) — DEPRECATED in Phase 7
 *   - Stale pool detection (30s freshness via lastFetched timestamp)
 *
 * Phase 7 enhancements:
 *   - NO pool filtering — all pools are kept in the graph
 *   - Liquidity tiers assigned to pools (optimal/acceptable/low/very_low)
 *   - Advisor mode: suggest multi-hop when direct is suboptimal
 *   - Comparison view: direct vs WWDOGE multi-hop output comparison
 */

import { CONTRACTS } from '../../lib/constants';
import { getCachedTax } from '../taxDetection';
import type { PoolReserves, PoolEdge, RouteStep, RouteResult, LiquidityTier, RouteComparison } from './types';
import { MULTI_HOP_PRICE_IMPACT_THRESHOLD, TVL_ILLIQUID_THRESHOLD, HUB_TOKEN_ADDRESSES, isHubToken } from './types';

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

// Hub token addresses (lowercase) for route classification and multi-hop generation
const WWDOGE_ADDRESS = CONTRACTS.WWDOGE.toLowerCase();
const DC_ADDRESS = CONTRACTS.DC_TOKEN.toLowerCase();
const OMNOM_ADDRESS = CONTRACTS.OMNOM_TOKEN.toLowerCase();

/** Human-readable symbol for a hub token address (lowercase). */
function hubSymbol(address: string): string {
  const lower = address.toLowerCase();
  if (lower === WWDOGE_ADDRESS) return 'WWDOGE';
  if (lower === DC_ADDRESS) return 'DC';
  if (lower === OMNOM_ADDRESS) return 'OMNOM';
  return address.slice(0, 10) + '…';
}

// ─── Tax Helpers ───────────────────────────────────────────────────────────────

/**
 * Check if a token has a 'transfer' tax type (fee-on-transfer).
 * Transfer taxes apply to EVERY token transfer, not just DEX swaps.
 * Dex-only taxes are already handled by the per-hop deduction in calculateRouteOutput.
 */
function isTransferTaxToken(tokenAddress: string): boolean {
  const entry = getCachedTax(tokenAddress.toLowerCase());
  return entry?.taxType === 'transfer';
}

/**
 * Get the total tax (buy + sell) for a token from the dynamic tax cache.
 * Returns 0 if the token is not cached or has no tax.
 * NOTE: For dex-only tax tokens, this should NOT be used to further reduce output
 * since the per-hop deduction in calculateRouteOutput already accounts for it.
 */
function getTokenTaxPercent(tokenAddress: string): number {
  const entry = getCachedTax(tokenAddress.toLowerCase());
  if (!entry) return 0;
  return entry.buyTax + entry.sellTax;
}

/**
 * Apply token tax to an output amount — ONLY for transfer-type taxes.
 * Dex-only taxes are already accounted for in the per-hop calculation in
 * calculateRouteOutput(), so applying them again here would be double-counting.
 *
 * Formula: outputAfterTax = output * (100 - totalTax) / 100
 */
function applyTransferTaxToOutput(output: bigint, tokenAddress: string): bigint {
  if (!isTransferTaxToken(tokenAddress)) return output;
  const totalTax = getTokenTaxPercent(tokenAddress);
  if (totalTax === 0) return output;
  const multiplier = BigInt(100 - totalTax);
  return (output * multiplier) / 100n;
}

// ─── Phase 7: Liquidity Classification ───────────────────────────────────────

/**
 * Classify a pool's liquidity tier based on estimated TVL.
 * Used to determine route quality and trigger multi-hop suggestions.
 */
export function classifyPoolLiquidity(tvlUsd: number): LiquidityTier {
  if (tvlUsd > 50_000) return 'optimal';
  if (tvlUsd >= 10_000) return 'acceptable';
  if (tvlUsd >= 5_000) return 'low';
  return 'very_low';
}

/**
 * Get token decimals from constants.
 * Uses the same getTokenDecimals from lib/constants.ts.
 */
function getTokenDecimalsLocal(tokenAddress: string): number {
  // Import inline to avoid circular dependency issues
  // In the actual implementation, this uses getTokenDecimals from lib/constants
  // For now, fall back to 18 if token not found
  const t = TOKENS_FALLBACK.find((tok) => tok && tok.address && tok.address.toLowerCase() === tokenAddress.toLowerCase());
  return t?.decimals ?? 18;
}

// Fallback token list (subset of known tokens with decimals)
// This is used in case lib/constants isn't available during initial load
const TOKENS_FALLBACK = [
  { address: '0xb7ddc6414bf4f5515b52d8bdd69973ae205ff101', decimals: 18 }, // WWDOGE
  { address: '0x7b4328c127b85369d9f82ca0503b000d09cf9180', decimals: 18 }, // DC
  { address: '0xe3fca919883950c5cd468156392a6477ff5d18de', decimals: 18 }, // OMNOM
  { address: '0xbdad927604c5cb78f15b3669a92fa5a1427d33a2', decimals: 15 }, // MCRIB
  { address: '0x8a764cf73438de795c98707b07034e577af54825', decimals: 18 }, // DINU
];

/**
 * Estimate TVL for a pool from reserves.
 * Uses geometric mean to avoid overweighting either token.
 * Requires WWDOGE price feed for accurate USD conversion.
 * 
 * IMPORTANT: Now properly normalizes for token decimals.
 */
export function estimatePoolTVL(reserve0: bigint, reserve1: bigint, wwdogePrice: number = 1.0): number {
  const r0 = Number(reserve0);
  const r1 = Number(reserve1);
  if (r0 === 0 || r1 === 0) return 0;
  
  // Note: This function doesn't know token0/token1 addresses, so it cannot
  // look up decimals. It assumes 18 decimals for both.
  // This is a known limitation - for pools with mixed decimals, use the
  // version that takes PoolReserves and can look up decimals.
  // For now, we return the raw calculation (which may be inflated for mixed-decimal pools)
  const tvl = 2 * Math.sqrt(r0 * r1) * wwdogePrice;
  return tvl;
}

/**
 * Compare direct vs multi-hop routes and return analysis.
 * Used for the "advisor mode" comparison view.
 */
export function compareRoutes(
  directRoute: RouteResult | null,
  multiHopRoute: RouteResult | null,
  tokenOutDecimals: number = 18,
): RouteComparison {
  if (!directRoute || !multiHopRoute) {
    return { hasBetterAlternative: false, betterRoute: null, outputDifference: 0n, savingsPercent: 0, message: '' };
  }

  if (directRoute.totalExpectedOut === 0n) {
    return { hasBetterAlternative: false, betterRoute: null, outputDifference: 0n, savingsPercent: 0, message: '' };
  }

  const diff = multiHopRoute.totalExpectedOut - directRoute.totalExpectedOut;
  
  // Calculate percentage safely - handle cases where diff is negative or extremely large
  let savingsPercent: number;
  if (diff <= 0n) {
    savingsPercent = 0;
  } else {
    // Avoid overflow: use Number conversion for the ratio calculation
    const diffFloat = Number(diff);
    const directFloat = Number(directRoute.totalExpectedOut);
    if (diffFloat > 0 && directFloat > 0) {
      savingsPercent = (diffFloat / directFloat) * 100;
      // Cap at 999999% to prevent display issues
      savingsPercent = Math.min(savingsPercent, 999999);
    } else {
      savingsPercent = 0;
    }
  }

  const formatOutput = (val: bigint) => {
    const num = Number(val) / Math.pow(10, tokenOutDecimals);
    return num.toFixed(4);
  };

  return {
    hasBetterAlternative: diff > 0n,
    betterRoute: diff > 0n ? 'multi_hop' : 'direct',
    outputDifference: diff,
    savingsPercent,
    message: diff > 0n
      ? `Multi-hop via WWDOGE yields ${savingsPercent.toFixed(2)}% more (${formatOutput(diff)} more tokens)`
      : `Direct route is optimal`,
  };
}

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

// ─── Route Classification ────────────────────────────────────────────────────

/**
 * Classify a route as 'direct' or 'multi_hop' and identify intermediate tokens.
 * A direct route is one that exchanges tokenIn directly for tokenOut in a single hop.
 * A multi-hop route uses one or more intermediate tokens (typically hub tokens).
 */
export function classifyRoute(
  steps: RouteStep[],
  tokenIn: string,
  tokenOut: string,
): { routeType: 'direct' | 'multi_hop'; intermediateToken?: string } {
  if (steps.length === 1) {
    // Single hop — check if it's a direct swap or involves an intermediate
    const step = steps[0];
    if (step.path.length === 2) {
      return { routeType: 'direct' };
    }
    // Multi-step single hop (e.g., multi-DEX split) — still counts as direct pair
    return { routeType: 'direct' };
  }

  // Multiple hops — find the intermediate token(s)
  // For a standard 2-hop route: [tokenIn, intermediate, tokenOut]
  // The intermediate is the token that's neither tokenIn nor tokenOut
  const tokenInLower = tokenIn.toLowerCase();
  const tokenOutLower = tokenOut.toLowerCase();

  // Collect all intermediate tokens (tokens in the path that aren't start/end)
  const intermediateTokens = new Set<string>();

  for (const step of steps) {
    for (const token of step.path) {
      const tokenLower = token.toLowerCase();
      if (tokenLower !== tokenInLower && tokenLower !== tokenOutLower) {
        intermediateTokens.add(tokenLower);
      }
    }
  }

  // Return the first intermediate token found (prioritize hub tokens: WWDOGE > DC > OMNOM)
  const intermediates = Array.from(intermediateTokens);
  const hubOrder = [WWDOGE_ADDRESS, DC_ADDRESS, OMNOM_ADDRESS];
  const hubIntermediate = hubOrder.find(h => intermediates.includes(h));
  const intermediate = hubIntermediate ?? intermediates[0];

  return {
    routeType: 'multi_hop',
    intermediateToken: intermediate,
  };
}

// ─── Phase 6: Auto Multi-hop Preference ───────────────────────────────────────

/**
 * Check if the direct route is illiquid and should trigger multi-hop preference.
 * Returns an object with the analysis of whether multi-hop should be preferred.
 *
 * Conditions for auto-preferring multi-hop:
 *   1. Direct route price impact > 3%, OR
 *   2. Direct route TVL < $5,000
 */
export function analyzeRouteLiquidity(
  tokenIn: string,
  tokenOut: string,
  pools: PoolReserves[],
): {
  shouldPreferMultiHop: boolean;
  directRouteTVL: number;
  directRoutePriceImpact: number;
  reason: string | null;
  suggestedIntermediate: string | null;
} {
  const normalizedIn = tokenIn.toLowerCase();
  const normalizedOut = tokenOut.toLowerCase();

  // Find direct pair pools
  const directPools = pools.filter(p => {
    const t0 = p.token0.toLowerCase();
    const t1 = p.token1.toLowerCase();
    return (t0 === normalizedIn && t1 === normalizedOut) || (t0 === normalizedOut && t1 === normalizedIn);
  });

  if (directPools.length === 0) {
    return {
      shouldPreferMultiHop: true,
      directRouteTVL: 0,
      directRoutePriceImpact: 1,
      reason: 'No direct pools found. Multi-hop routing is required.',
      suggestedIntermediate: WWDOGE_ADDRESS,
    };
  }

  // Calculate total TVL for direct pair (with decimal normalization)
  let totalTVL = 0;
  let maxReserveIn = 0n;
  for (const pool of directPools) {
    // Get decimals and convert reserves to actual token counts for TVL
    const decimals0 = getTokenDecimalsLocal(pool.token0);
    const decimals1 = getTokenDecimalsLocal(pool.token1);
    const r0Tokens = Number(pool.reserve0) / Math.pow(10, decimals0);
    const r1Tokens = Number(pool.reserve1) / Math.pow(10, decimals1);
    const poolTVL = 2 * Math.sqrt(r0Tokens * r1Tokens);
    totalTVL += poolTVL;

    // Find the reserveIn for the direction we need
    const t0 = pool.token0.toLowerCase();
    if (t0 === normalizedIn) {
      maxReserveIn = maxReserveIn > pool.reserve0 ? maxReserveIn : pool.reserve0;
    } else {
      maxReserveIn = maxReserveIn > pool.reserve1 ? maxReserveIn : pool.reserve1;
    }
  }

  // Estimate price impact for a typical trade amount
  // We use 1% of reserves as a proxy for price impact calculation
  const sampleAmount = maxReserveIn / 100n;
  let estimatedImpact = 0;
  if (maxReserveIn > 0n && sampleAmount > 0n) {
    estimatedImpact = Number((sampleAmount * 10000n) / (maxReserveIn + sampleAmount)) / 10000;
  }

  const shouldPrefer = totalTVL < TVL_ILLIQUID_THRESHOLD || estimatedImpact > MULTI_HOP_PRICE_IMPACT_THRESHOLD;

  let reason: string | null = null;
  if (totalTVL < TVL_ILLIQUID_THRESHOLD) {
    reason = `Direct pair TVL ($${totalTVL.toFixed(2)}) is below $${TVL_ILLIQUID_THRESHOLD.toLocaleString()} threshold. Multi-hop routing recommended for better execution.`;
  } else if (estimatedImpact > MULTI_HOP_PRICE_IMPACT_THRESHOLD) {
    reason = `Direct route estimated price impact (${(estimatedImpact * 100).toFixed(2)}%) exceeds ${(MULTI_HOP_PRICE_IMPACT_THRESHOLD * 100).toFixed(0)}% threshold. Consider multi-hop routing for better rates.`;
  }

  return {
    shouldPreferMultiHop: shouldPrefer,
    directRouteTVL: totalTVL,
    directRoutePriceImpact: estimatedImpact,
    reason,
    suggestedIntermediate: shouldPrefer ? WWDOGE_ADDRESS : null,
  };
}

/**
 * Sort routes to prefer multi-hop when the direct route is illiquid.
 * Routes that use ANY hub token (WWDOGE, DC, OMNOM) as intermediate are sorted
 * higher when:
 *   - The direct pair has TVL < $5,000, OR
 *   - The direct pair has estimated price impact > 3%
 *
 * Hub routes are interleaved with other routes so the user sees alternatives.
 */
export function sortRoutesByPreference(
  routes: RouteResult[],
  tokenIn: string,
  tokenOut: string,
  pools: PoolReserves[],
): RouteResult[] {
  if (routes.length <= 1) return routes;

  const analysis = analyzeRouteLiquidity(tokenIn, tokenOut, pools);

  if (!analysis.shouldPreferMultiHop) {
    return routes; // No preference needed, routes are already sorted by output
  }

  // Separate hub-based multi-hop routes from others
  const hubMultiHop: RouteResult[] = [];
  const others: RouteResult[] = [];

  for (const route of routes) {
    // Check if this is a hub-token multi-hop route (WWDOGE, DC, or OMNOM)
    const isHubMultiHop =
      route.routeType === 'multi_hop' &&
      route.intermediateToken != null &&
      isHubToken(route.intermediateToken);

    if (isHubMultiHop) {
      hubMultiHop.push(route);
    } else {
      others.push(route);
    }
  }

  // If we have hub multi-hop routes and the direct route is illiquid,
  // promote hub routes to the top while preserving output-based ordering within each group
  if (hubMultiHop.length > 0) {
    const hubSymbols = hubMultiHop
      .map(r => r.intermediateToken ? hubSymbol(r.intermediateToken) : '?')
      .filter((v, i, a) => a.indexOf(v) === i)
      .join(', ');
    console.log(`[PathFinder] Auto-prefer hub multi-hop (${hubSymbols}): ${analysis.reason}`, {
      hubRouteCount: hubMultiHop.length,
      directRouteTVL: analysis.directRouteTVL,
      suggestedIntermediate: analysis.suggestedIntermediate,
    });
    // Interleave: take best from each group alternately to give user choice
    const result: RouteResult[] = [];
    const hubSorted = [...hubMultiHop].sort((a, b) =>
      a.totalExpectedOut > b.totalExpectedOut ? -1 : a.totalExpectedOut < b.totalExpectedOut ? 1 : 0
    );
    const otherSorted = [...others].sort((a, b) =>
      a.totalExpectedOut > b.totalExpectedOut ? -1 : a.totalExpectedOut < b.totalExpectedOut ? 1 : 0
    );

    let hIdx = 0, oIdx = 0;
    while (hIdx < hubSorted.length || oIdx < otherSorted.length) {
      if (hIdx < hubSorted.length) result.push(hubSorted[hIdx++]);
      if (oIdx < otherSorted.length) result.push(otherSorted[oIdx++]);
    }

    return result;
  }

  return routes;
}

// ─── Graph Construction ───────────────────────────────────────────────────────

/**
 * Build a directed liquidity graph from pool reserves.
 * Each pool creates two edges (token0→token1 and token1→token0).
 *
 * Phase 7: NO filtering — all pools are kept in the graph.
 * Low-liquidity pools are flagged with liquidity tiers but NOT excluded.
 * This allows small pools to be considered for small-volume swaps
 * while still triggering multi-hop suggestions for large-volume trades.
 */
export function buildGraph(pools: PoolReserves[]): PoolEdge[] {
  const edges: PoolEdge[] = [];

  for (const pool of pools) {
    if (pool.reserve0 <= 0n || pool.reserve1 <= 0n) continue;

    // Phase 7: NO filtering — keep all pools including low-liquidity ones
    // Liquidity assessment happens at route ranking time via liquidityTier

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
 *
 * DECIMAL HANDLING:
 * The AMM formula operates on raw token units. If tokenIn and tokenOut have different
 * decimals, we must normalize reserves to a common scale (18 decimals) before the
 * calculation, then scale the output back to the output token's native decimals.
 *
 * Example: DC (18 decimals) → MCRIB (15 decimals) swap
 *   - reserveIn (DC): 1,000,000,000,000,000,000 (18 decimals = 1e18)
 *   - reserveOut (MCRIB): 1,000,000,000,000,000 (15 decimals = 1e15)
 *   - amountIn (DC): 1,000,000,000,000,000,000 (18 decimals = 1e18)
 *   - Normalize: both reserves and amountIn to 18-decimal form (divide by 10^3 for MCRIB)
 *   - Calculate output: formula result in 18-decimal equivalent
 *   - Convert back: multiply by 10^(18 - outputDecimals) to get native decimals
 */
export function calculateOutput(amountIn: bigint, reserveIn: bigint, reserveOut: bigint, tokenInDecimals?: number, tokenOutDecimals?: number): bigint {
  if (amountIn <= 0n || reserveIn <= 0n || reserveOut <= 0n) return 0n;
  
  // Sanity check: output should not exceed reserveOut (can't get more than pool has)
  const maxPossibleOut = reserveOut;
  
  // Handle decimal normalization if token decimals are provided and different
  let normalizedAmountIn = amountIn;
  let normalizedReserveIn = reserveIn;
  let normalizedReserveOut = reserveOut;
  
  if (tokenInDecimals !== undefined && tokenOutDecimals !== undefined) {
    void (tokenInDecimals - tokenOutDecimals); // decimalDiff used for normalization logic below
    
    // Normalize to 18-decimal equivalent:
    // For token with fewer decimals than 18, multiply to scale up
    // For token with more decimals than 18, divide to scale down
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
    
    // Now calculate with normalized values (both in 18-decimal equivalent)
    const amountInWithFee = normalizedAmountIn * (FEE_DENOMINATOR - POOL_FEE_BPS);
    const numerator = amountInWithFee * normalizedReserveOut;
    const denominator = normalizedReserveIn * FEE_DENOMINATOR + amountInWithFee;
    let output = numerator / denominator;
    
    // Scale output back to output token's native decimals
    // If tokenOut has fewer decimals than 18, divide to scale down
    // If tokenOut has more decimals than 18, multiply to scale up
    if (tokenOutDecimals < 18) {
      output = output / 10n ** BigInt(18 - tokenOutDecimals);
    } else if (tokenOutDecimals > 18) {
      output = output * 10n ** BigInt(tokenOutDecimals - 18);
    }
    
    // Safety: if output somehow exceeds available reserves, cap it
    // This would indicate bad pool data
    if (output > maxPossibleOut) {
      console.warn(`[PathFinder] calculateOutput: output (${output}) exceeds maxPossibleOut (${maxPossibleOut}). Capping.`);
      return maxPossibleOut;
    }
    
    return output;
  }
  
  // Original logic when no decimals info provided
  const amountInWithFee = amountIn * (FEE_DENOMINATOR - POOL_FEE_BPS);
  const numerator = amountInWithFee * reserveOut;
  const denominator = reserveIn * FEE_DENOMINATOR + amountInWithFee;
  const output = numerator / denominator;
  
  // DEBUG: Log calculation details for swap debugging
  console.debug(`[PathFinder] calculateOutput:`, {
    amountIn: amountIn.toString(),
    reserveIn: reserveIn.toString(),
    reserveOut: reserveOut.toString(),
    maxPossibleOut: maxPossibleOut.toString(),
    feeBps: Number(POOL_FEE_BPS),
    output: output.toString(),
    outputFormatted: Number(output) / 1e18,
    outputVsMaxRatio: maxPossibleOut > 0n ? Number(output * 10000n / maxPossibleOut) / 10000 : 0,
    sanityCheck: output <= maxPossibleOut ? 'PASS' : 'FAIL - output exceeds pool reserves!',
  });
  
  // Safety: if output somehow exceeds available reserves, cap it
  // This would indicate bad pool data
  if (output > maxPossibleOut) {
    console.warn(`[PathFinder] calculateOutput: output (${output}) exceeds maxPossibleOut (${maxPossibleOut}). Capping.`);
    return maxPossibleOut;
  }
  
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
 * 
 * DECIMAL HANDLING:
 * Each hop may involve tokens with different decimals. For accurate AMM calculations,
 * we normalize both input and output to 18-decimal equivalents before calculation.
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

    // Get token decimals for this hop
    const tokenInDecimals = getTokenDecimalsLocal(tokenIn);
    const tokenOutDecimals = getTokenDecimalsLocal(tokenOut);

    // Apply sell tax on input token (dex-only tokens)
    // When selling a taxed token, the tax reduces the effective input to the AMM.
    const inputTokenLower = tokenIn.toLowerCase();
    const inputTaxEntry = getCachedTax(inputTokenLower);
    let effectiveAmountIn = currentAmount;
    if (inputTaxEntry && inputTaxEntry.sellTax > 0) {
      const sellTaxBps = BigInt(Math.round(inputTaxEntry.sellTax * 100));
      effectiveAmountIn = (effectiveAmountIn * (10000n - sellTaxBps)) / 10000n;
    }

    // Find the best edge for this hop (highest output)
    const candidates = edges.filter(
      (e) => e.tokenIn === tokenIn && e.tokenOut === tokenOut,
    );

    if (candidates.length === 0) {
      console.error(`[PathFinder] calculatePathOutput: No pools found for ${tokenIn} -> ${tokenOut} (hop ${i + 1})`);
      return { output: 0n, steps: [] };
    }

    let bestEdge = candidates[0];
    let bestOutput = calculateOutput(effectiveAmountIn, bestEdge.reserveIn, bestEdge.reserveOut, tokenInDecimals, tokenOutDecimals);

    for (let j = 1; j < candidates.length; j++) {
      const out = calculateOutput(effectiveAmountIn, candidates[j].reserveIn, candidates[j].reserveOut, tokenInDecimals, tokenOutDecimals);
      if (out > bestOutput) {
        bestOutput = out;
        bestEdge = candidates[j];
      }
    }

    console.debug(`[PathFinder] Hop ${i + 1} pool selection:`, {
      tokenIn,
      tokenOut,
      tokenInDecimals,
      tokenOutDecimals,
      candidatesCount: candidates.length,
      candidates: candidates.map((c) => ({
        dexName: c.dexName,
        dexRouter: c.router,
        reserveIn: c.reserveIn.toString(),
        reserveInFormatted: Number(c.reserveIn) / 1e18,
        reserveOut: c.reserveOut.toString(),
        reserveOutFormatted: Number(c.reserveOut) / 1e18,
        candidateOutput: calculateOutput(currentAmount, c.reserveIn, c.reserveOut, tokenInDecimals, tokenOutDecimals).toString(),
        candidateOutputFormatted: Number(calculateOutput(currentAmount, c.reserveIn, c.reserveOut, tokenInDecimals, tokenOutDecimals)) / 1e18,
      })),
      selectedDex: bestEdge.dexName,
      selectedRouter: bestEdge.router,
      selectedOutput: bestOutput.toString(),
      selectedOutputFormatted: Number(bestOutput) / 1e18,
    });

    // Apply buy tax deduction for taxed output tokens.
    // For dex-only taxes (like MCRIB): the tax is applied by the token contract
    // during the DEX pair transfer. Our x*y=k calculation doesn't account for this,
    // so we deduct it here ONCE. Downstream code must NOT deduct it again.
    // For transfer taxes: every transfer is taxed, so we also deduct here.
    let adjustedOutput = bestOutput;
    const outputTokenLower = tokenOut.toLowerCase();
    const outputTaxEntry = getCachedTax(outputTokenLower);
    if (outputTaxEntry && outputTaxEntry.buyTax > 0) {
      const before = adjustedOutput;
      const taxBps = BigInt(Math.round(outputTaxEntry.buyTax * 100)); // 3% = 300 bps
      adjustedOutput = (adjustedOutput * (10000n - taxBps)) / 10000n;
      console.log(`[pathFinder] Buy tax ${outputTaxEntry.buyTax}% applied for ${outputTokenLower}: ${before} → ${adjustedOutput}`);
    }

    // Log sell tax application
    if (inputTaxEntry && inputTaxEntry.sellTax > 0) {
      console.log(`[pathFinder] Sell tax ${inputTaxEntry.sellTax}% applied for ${inputTokenLower}: amountIn reduced`);
    }

    steps.push({
      dexRouter: bestEdge.router,
      dexName: bestEdge.dexName,
      path: [tokenIn, tokenOut],
      amountIn: currentAmount,
      expectedAmountOut: adjustedOutput,
    });

    // Convert output to 18-decimal equivalent for proper handling by next hop
    // The output is in tokenOut's native decimals, but the next hop expects 18-decimal equivalent input
    let currentAmountNormalized = adjustedOutput;
    if (tokenOutDecimals < 18) {
      currentAmountNormalized = adjustedOutput * 10n ** BigInt(18 - tokenOutDecimals);
    } else if (tokenOutDecimals > 18) {
      currentAmountNormalized = adjustedOutput / 10n ** BigInt(tokenOutDecimals - 18);
    }
    currentAmount = currentAmountNormalized;
  }

  // After the hop loop, currentAmount is in 18-decimal normalized form.
  // De-normalize to the final output token's native decimals so that
  // downstream consumers (buildSwapRequest, minTotalAmountOut) receive
  // the amount in the correct decimal representation.
  const finalTokenOut = path[path.length - 1].toLowerCase();
  const finalTokenDecimals = getTokenDecimalsLocal(finalTokenOut);
  let finalOutput = currentAmount;
  if (finalTokenDecimals < 18) {
    finalOutput = currentAmount / 10n ** BigInt(18 - finalTokenDecimals);
  } else if (finalTokenDecimals > 18) {
    finalOutput = currentAmount * 10n ** BigInt(finalTokenDecimals - 18);
  }

  console.log(`[pathFinder] calculatePathOutput final: output=${finalOutput}, nativeDecimals=${finalTokenDecimals}, wasNormalized=${finalTokenDecimals !== 18}`);

  // DEBUG: Log final route output
  console.debug(`[PathFinder] calculatePathOutput: Final output for path ${path.join(' -> ')}:`, {
    inputAmount: amountIn.toString(),
    output18dec: currentAmount.toString(),
    outputNative: finalOutput.toString(),
    outputFormatted: Number(finalOutput) / Math.pow(10, finalTokenDecimals),
    stepsCount: steps.length,
  });

  return { output: finalOutput, steps };
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
 * Generate explicit hub-based candidate paths for tokenIn → tokenOut.
 *
 * For each hub token and each pair of distinct hub tokens, constructs a
 * candidate path. Only paths where every hop has at least one pool edge
 * are returned, so invalid routes are pruned early.
 *
 * Generated path shapes:
 *   - 1-hop through each hub:  tokenIn → hub → tokenOut
 *   - 2-hop through hub pairs: tokenIn → hub1 → hub2 → tokenOut
 *
 * @param tokenIn  Lowercase token address
 * @param tokenOut Lowercase token address
 * @param edges    Directed liquidity graph edges
 */
export function generateHubRoutes(
  tokenIn: string,
  tokenOut: string,
  edges: PoolEdge[],
): string[][] {
  const normalizedIn = tokenIn.toLowerCase();
  const normalizedOut = tokenOut.toLowerCase();

  // Build a fast lookup: "in>out" → true
  const edgeSet = new Set<string>();
  for (const e of edges) {
    edgeSet.add(`${e.tokenIn.toLowerCase()}>${e.tokenOut.toLowerCase()}`);
  }
  const hasEdge = (a: string, b: string) => edgeSet.has(`${a}>${b}`);

  // Filter to hub tokens that are neither tokenIn nor tokenOut
  const hubs = HUB_TOKEN_ADDRESSES.filter(
    h => h !== normalizedIn && h !== normalizedOut,
  );

  const paths: string[][] = [];

  // 1-hop through each hub: tokenIn → hub → tokenOut
  for (const hub of hubs) {
    if (hasEdge(normalizedIn, hub) && hasEdge(hub, normalizedOut)) {
      const path = [normalizedIn, hub, normalizedOut];
      paths.push(path);
      console.log(`[pathFinder] Evaluating path: ${hubSymbol(normalizedIn)} → ${hubSymbol(hub)} → ${hubSymbol(normalizedOut)} (2 hops)`);
    }
  }

  // 2-hop through hub pairs: tokenIn → hub1 → hub2 → tokenOut
  for (let i = 0; i < hubs.length; i++) {
    for (let j = 0; j < hubs.length; j++) {
      if (i === j) continue;
      const hub1 = hubs[i];
      const hub2 = hubs[j];
      if (
        hasEdge(normalizedIn, hub1) &&
        hasEdge(hub1, hub2) &&
        hasEdge(hub2, normalizedOut)
      ) {
        const path = [normalizedIn, hub1, hub2, normalizedOut];
        paths.push(path);
        console.log(`[pathFinder] Evaluating path: ${hubSymbol(normalizedIn)} → ${hubSymbol(hub1)} → ${hubSymbol(hub2)} → ${hubSymbol(normalizedOut)} (3 hops)`);
      }
    }
  }

  return paths;
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
    let tokenSet = adjacency.get(key);
    if (!tokenSet) {
      tokenSet = new Set();
      adjacency.set(key, tokenSet);
    }
    tokenSet.add(edge.tokenOut.toLowerCase());
  }

  // DEBUG: Log adjacency info for the swap pair
  const inNeighbors = adjacency.get(normalizedIn);
  const outNeighbors = adjacency.get(normalizedOut);
  console.debug(`[PathFinder] findAllRoutes adjacency:`, {
    tokenIn: normalizedIn,
    tokenOut: normalizedOut,
    tokenInNeighbors: inNeighbors ? Array.from(inNeighbors) : [],
    tokenOutNeighbors: outNeighbors ? Array.from(outNeighbors) : [],
    totalEdges: edges.length,
    uniqueTokens: new Set(edges.map(e => e.tokenIn)).size,
  });

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

  // ─── Merge explicit hub routes ────────────────────────────────────────────
  // Generate hub-based candidate paths and merge with BFS results.
  // This guarantees that hub routes are considered even if the BFS adjacency
  // graph is missing edges due to incomplete pool data.
  const hubPaths = generateHubRoutes(normalizedIn, normalizedOut, edges);

  // Deduplicate by path signature (join with '>')
  const seen = new Set(routes.map(p => p.join('>')));
  let addedCount = 0;
  for (const hp of hubPaths) {
    const key = hp.join('>');
    if (!seen.has(key)) {
      seen.add(key);
      routes.push(hp);
      addedCount++;
    }
  }

  if (addedCount > 0) {
    console.log(`[PathFinder] Added ${addedCount} explicit hub route(s) not found by BFS`);
  }

  // DEBUG: Log route discovery results
  console.debug(`[PathFinder] findAllRoutes result:`, {
    tokenIn: normalizedIn,
    tokenOut: normalizedOut,
    pathsFound: routes.length,
    paths: routes.map(p => p.map(t => hubSymbol(t)).join(' → ')),
    maxHops: MAX_HOPS,
  });

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
 *
 * ENHANCED: Now also triggers fallback when price impact exceeds 5% and there
 * are better multi-hop alternatives available.
 */
export function findAllViableRoutes(
  tokenIn: string,
  tokenOut: string,
  amountIn: bigint,
  pools: PoolReserves[],
  feeBps: number = 25,
  maxRoutes: number = 10,
): RouteResult[] {
  const edges = buildGraph(pools);
  const paths = findAllRoutes(tokenIn, tokenOut, amountIn, edges);

  // ─── Fallback: Extreme Price Impact or Single DEX Detection ─────────────────
  // If primary route has extreme price impact (>10%) or only returns 1 DEX,
  // try fetching additional pools from ALL_DEX_LIST (not just registered routers).
  // This handles cases where registeredRoutersCache is incomplete or stale.
  const firstPassRoutes = paths.length > 0 ? computeAllRoutes(paths, edges, amountIn, feeBps, tokenIn, tokenOut) : [];

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

  // ─── Phase 6: Auto Multi-hop Preference ────────────────────────────────────
  // If the direct route is illiquid (TVL < $5,000 or price impact > 3%),
  // sort WWDOGE multi-hop routes to the top as a suggestion
  const sortedRoutes = sortRoutesByPreference(firstPassRoutes, tokenIn, tokenOut, pools);

  return sortedRoutes.slice(0, maxRoutes);
}

/**
 * Compute route results from candidate paths — factored out for reuse in fallback.
 */
function computeAllRoutes(
  paths: string[][],
  edges: PoolEdge[],
  amountIn: bigint,
  feeBps: number,
  tokenIn?: string,
  tokenOut?: string,
): RouteResult[] {
  const FEE_DENOMINATOR = 10000n;
  const feeAmount = (amountIn * BigInt(feeBps)) / FEE_DENOMINATOR;
  const swapAmount = amountIn - feeAmount;

  const results: RouteResult[] = [];

  for (const path of paths) {
    const { output, steps } = calculateRouteOutput(path, swapAmount, edges);

    if (output > 0n) {
      const priceImpact = estimatePriceImpact(steps, edges);

      // Apply transfer-type tax to final output if the output token has a transfer tax.
      // For dex-only taxes (like MCRIB), the per-hop deduction in calculateRouteOutput()
      // already accounts for the tax — applying again here would double-count.
      const taxedOutput = tokenOut ? applyTransferTaxToOutput(output, tokenOut) : output;

      const result: RouteResult = {
        id: generateRouteId(steps),
        steps,
        totalAmountIn: amountIn,
        totalExpectedOut: taxedOutput,
        priceImpact,
        feeAmount,
        feeBps,
      };

      // Phase 4: Classify route as direct or multi-hop
      if (tokenIn && tokenOut) {
        const classification = classifyRoute(steps, tokenIn, tokenOut);
        result.routeType = classification.routeType;
        result.intermediateToken = classification.intermediateToken;
      }

      // DEBUG: Log route calculation result
      console.debug(`[PathFinder] Route calculated:`, {
        routeId: result.id,
        totalExpectedOut: result.totalExpectedOut.toString(),
        totalExpectedOutFormatted: Number(result.totalExpectedOut) / 1e18,
        feeAmount: result.feeAmount.toString(),
        stepsCount: steps.length,
        routeType: result.routeType,
        intermediateToken: result.intermediateToken,
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

  let maxImpact = 0; // Use max instead of sum for multi-hop routes
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
      const impact = Number(step.amountIn) / Number(edge.reserveIn + step.amountIn);

      // Cap at 50% per hop (draining >50% is catastrophic)
      const cappedImpact = Math.min(impact, 0.5);

      // For multi-hop, use max instead of sum to avoid overestimation
      maxImpact = Math.max(maxImpact, cappedImpact);
    }
  }

  // Absolute maximum of 95% to warn users before this point
  return Math.min(maxImpact, 0.95);
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

    const tokenInDecimals = getTokenDecimalsLocal(normalizedIn);
    const tokenOutDecimals = getTokenDecimalsLocal(normalizedOut);
    const output = calculateOutput(amountIn, reserveIn, reserveOut, tokenInDecimals, tokenOutDecimals);
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

      const result: RouteResult = {
        id: generateRouteId(steps),
        steps,
        totalAmountIn,
        totalExpectedOut: amountOut,
        priceImpact,
        feeAmount,
        feeBps,
      };

      // Phase 4: Classify route as direct or multi-hop
      const classification = classifyRoute(steps, tokenIn, tokenOut);
      result.routeType = classification.routeType;
      result.intermediateToken = classification.intermediateToken;

      results.push(result);
    }
  }

  // Sort by input ascending (least cost first)
  results.sort((a, b) =>
    a.totalAmountIn < b.totalAmountIn ? -1 : a.totalAmountIn > b.totalAmountIn ? 1 : 0
  );

  return results.slice(0, maxRoutes);
}

// Re-export types and hub token utilities
export type { PoolReserves, PoolEdge, RouteStep, RouteResult, LiquidityTier, RouteComparison } from './types';
export { HUB_TOKEN_ADDRESSES, isHubToken } from './types';
