/**
 * PathFinder Integration with Transaction Monitoring — Phase 8
 *
 * Wraps the pathFinder functions to automatically log routing decisions
 * for post-incident analysis and ongoing operations.
 *
 * This integration captures:
 *   - All routing decisions with full context
 *   - Available routes vs selected route
 *   - Routing time and pool counts
 *   - Errors and fallback triggers
 */

import {
  findAllViableRoutes,
  findBestRoute,
  findAllRoutesForOutput,
  getPerDexQuotes,
  type RouteResult,
} from './index';
import { logRoutingDecision, recordPoolSnapshot } from '../monitoring/transactionMonitor';
import type { PoolReserves } from './types';
import { getTokenDecimals } from '../../lib/constants';

/**
 * Convert a raw reserve value to human-readable token count.
 * Divides by 10^decimals to get actual number of tokens (not 18-decimal normalized).
 */
function rawReserveToTokenCount(rawReserve: bigint, decimals: number): number {
  return Number(rawReserve) / Math.pow(10, decimals);
}

// ─── Instrumented Route Finding ───────────────────────────────────────────────

/**
 * Instrumented version of findAllViableRoutes that logs routing decisions
 */
export function findAllViableRoutesWithLogging(
  tokenIn: string,
  tokenOut: string,
  amountIn: bigint,
  pools: PoolReserves[],
  feeBps: number = 25,
  maxRoutes: number = 10,
): RouteResult[] {
  const startTime = performance.now();

  // Record pool snapshots for liquidity monitoring
  for (const pool of pools) {
    try {
      // Get actual decimals for each token and normalize reserves
      const decimals0 = getTokenDecimals(pool.token0);
      const decimals1 = getTokenDecimals(pool.token1);
      const r0Tokens = rawReserveToTokenCount(pool.reserve0, decimals0);
      const r1Tokens = rawReserveToTokenCount(pool.reserve1, decimals1);
      const tvl = 2 * Math.sqrt(r0Tokens * r1Tokens);
      recordPoolSnapshot({
        token0: pool.token0,
        token1: pool.token1,
        reserve0: pool.reserve0.toString(),
        reserve1: pool.reserve1.toString(),
        totalSupply: '0', // PoolReserves doesn't include totalSupply
        tvlUsd: tvl,
        dexName: pool.dexName,
        factory: pool.factory,
      });
    } catch {
      // Ignore snapshot errors
    }
  }

  // Find routes
  const routes = findAllViableRoutes(tokenIn, tokenOut, amountIn, pools, feeBps, maxRoutes);
  const routingTimeMs = Math.round(performance.now() - startTime);

  // Log the routing decision
  const selectedRoute = routes.length > 0 ? routes[0] : null;
  const selectionReason = selectedRoute
    ? `Best route with ${selectedRoute.totalExpectedOut.toString()} output`
    : 'No viable routes found';

  logRoutingDecision({
    tokenIn,
    tokenOut,
    amountIn,
    availableRoutes: routes,
    selectedRoute,
    routeSelectionReason: selectionReason,
    routingTimeMs,
    poolsCount: pools.length,
    error: routes.length === 0 ? `No routes found for ${tokenIn} -> ${tokenOut}` : undefined,
  });

  return routes;
}

/**
 * Instrumented version of findBestRoute that logs routing decisions
 */
export function findBestRouteWithLogging(
  tokenIn: string,
  tokenOut: string,
  amountIn: bigint,
  pools: PoolReserves[],
  feeBps: number = 25,
): RouteResult {
  const startTime = performance.now();
  const route = findBestRoute(tokenIn, tokenOut, amountIn, pools, feeBps);
  const routingTimeMs = Math.round(performance.now() - startTime);

  logRoutingDecision({
    tokenIn,
    tokenOut,
    amountIn,
    availableRoutes: route.id ? [route] : [],
    selectedRoute: route.id ? route : null,
    routeSelectionReason: route.id
      ? `Best route selected with ${route.totalExpectedOut.toString()} output`
      : 'No route found',
    routingTimeMs,
    poolsCount: pools.length,
    error: route.id ? undefined : `No best route found for ${tokenIn} -> ${tokenOut}`,
  });

  return route;
}

/**
 * Instrumented version of findAllRoutesForOutput that logs routing decisions
 */
export function findAllRoutesForOutputWithLogging(
  tokenIn: string,
  tokenOut: string,
  amountOut: bigint,
  pools: PoolReserves[],
  feeBps: number = 25,
  maxRoutes: number = 10,
): RouteResult[] {
  const startTime = performance.now();
  const routes = findAllRoutesForOutput(tokenIn, tokenOut, amountOut, pools, feeBps, maxRoutes);
  const routingTimeMs = Math.round(performance.now() - startTime);

  const selectedRoute = routes.length > 0 ? routes[0] : null;

  logRoutingDecision({
    tokenIn,
    tokenOut,
    amountIn: 0n, // For output-based routing, amountIn is calculated
    availableRoutes: routes,
    selectedRoute,
    routeSelectionReason: selectedRoute
      ? `Minimum input route selected: ${selectedRoute.totalAmountIn.toString()} required`
      : 'No routes found for desired output',
    routingTimeMs,
    poolsCount: pools.length,
    error: routes.length === 0 ? `No routes found for output ${amountOut}` : undefined,
  });

  return routes;
}

/**
 * Instrumented version of getPerDexQuotes that logs routing decisions
 */
export function getPerDexQuotesWithLogging(
  tokenIn: string,
  tokenOut: string,
  amountIn: bigint,
  pools: PoolReserves[],
): { dexName: string; router: string; output: bigint }[] {
  const startTime = performance.now();
  const quotes = getPerDexQuotes(tokenIn, tokenOut, amountIn, pools);
  const routingTimeMs = Math.round(performance.now() - startTime);

  logRoutingDecision({
    tokenIn,
    tokenOut,
    amountIn,
    availableRoutes: [], // Quotes are individual DEX quotes, not full routes
    selectedRoute: null,
    routeSelectionReason: `DEX comparison for ${tokenIn} -> ${tokenOut}`,
    routingTimeMs,
    poolsCount: pools.length,
  });

  return quotes;
}
