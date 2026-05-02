/**
 * useRoute — hook for path finding with debounced input.
 *
 * Takes tokenIn, tokenOut, amountIn and returns all available routes
 * using the path finder service. The default selected route is the one
 * with the highest output (an objective, verifiable criterion).
 *
 * Fixes applied:
 *   - H-01: Uses token-specific decimals from TOKENS array
 *   - H-02: Avoids BigInt→Number precision loss in priceQuote
 *   - H-07: Passes wagmi publicClient to pool fetcher
 *
 * Phase 5 enhancements:
 *   - Enhanced price impact warnings (>5% triggers alternative routing suggestion)
 *   - Automatic fallback mechanism now activates on >5% price impact (not just >10%)
 *   - Route freshness validation via lastFetched timestamp
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { parseUnits, formatUnits } from 'viem';
import { usePublicClient } from 'wagmi';
import { TOKENS, getTokenDecimals, PRICE_IMPACT_BLOCK, CONTRACTS } from '../../lib/constants';

import { fetchPoolsForSwap, fetchHubTokenPairs, isPoolStale } from '../../services/pathFinder/poolFetcher';
import { findAllViableRoutes, getPerDexQuotes, analyzeRouteLiquidity, compareRoutes } from '../../services/pathFinder';
import type { RouteResult, PoolReserves, TokenInfo, RouteComparison } from '../../services/pathFinder/types';

const DEBOUNCE_MS = 500;

/** Price impact threshold for triggering alternative routing suggestion (5%). */
const PRICE_IMPACT_WARN_THRESHOLD = 0.05;

export interface PerDexQuote {
  dexName: string;
  router: string;
  output: bigint;
}

export interface PriceImpactWarning {
  routeId: string;
  priceImpact: number;
  message: string;
  severity: 'warn' | 'block';
}

export function useRoute(
  tokenInAddress: string | undefined,
  tokenOutAddress: string | undefined,
  amountIn: string | undefined,
  feeBps: number = 25,
) {
  const [route, setRouteState] = useState<RouteResult | null>(null);
  const [allRoutes, setAllRoutes] = useState<RouteResult[]>([]);
  const [dexQuotes, setDexQuotes] = useState<PerDexQuote[]>([]);
  const [pools, setPools] = useState<PoolReserves[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [priceImpactWarnings, setPriceImpactWarnings] = useState<PriceImpactWarning[]>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seqRef = useRef(0);
  // Promise-based refetch: allows callers to await route computation.
  // Resolved when the compute() triggered by refetch() completes.
  const computePromiseRef = useRef<{
    resolve: (route: RouteResult | null) => void;
    reject: (err: Error) => void;
  } | null>(null);

  // Track the user's manually selected route ID so it survives route refreshes.
  // Reset to null when input parameters change (tokens or amount).
  const userSelectedRouteIdRef = useRef<string | null>(null);

  // Wrapped setRoute that records the user's manual selection.
  // When the user clicks a route in the UI, this is called.
  const setRoute = useCallback((r: RouteResult | null) => {
    userSelectedRouteIdRef.current = r?.id ?? null;
    setRouteState(r);
  }, []);

  // H-07: use wagmi-configured client instead of standalone client
  const wagmiPublicClient = usePublicClient();

  // H-01: use token-specific decimals
  const getTokenInfo = (address: string): TokenInfo | undefined => {
    const t = TOKENS.find((t) => t.address.toLowerCase() === address.toLowerCase());
    if (!t) return undefined;
    return { address: t.address, symbol: t.symbol, decimals: t.decimals ?? 18, logoURI: t.icon };
  };

  /**
   * Check for stale pools and issue warnings.
   * Phase 5.1: Validates that pool reserves are fresh (within 30s).
   */
  function checkPoolFreshness(poolList: PoolReserves[]): PriceImpactWarning[] {
    const warnings: PriceImpactWarning[] = [];
    const stalePools = poolList.filter(p => isPoolStale(p));

    if (stalePools.length > 0) {
      console.warn(`[useRoute] ${stalePools.length} pool(s) have stale reserves (>30s old)`);
      // Note: We don't block the route, but we warn about it
      // The UI can use this warning to show a "refresh prices" prompt
    }

    return warnings;
  }

  /**
   * Generate price impact warnings for routes that exceed thresholds.
   * Phase 5.3: Enhanced to check >5% (not just >10%) and trigger suggestions.
   */
  function checkPriceImpact(routeList: RouteResult[]): PriceImpactWarning[] {
    const warnings: PriceImpactWarning[] = [];

    for (const r of routeList) {
      if (r.priceImpact > PRICE_IMPACT_BLOCK) {
        warnings.push({
          routeId: r.id,
          priceImpact: r.priceImpact,
          message: `Price impact of ${(r.priceImpact * 100).toFixed(1)}% exceeds safe threshold. Transaction may be blocked.`,
          severity: 'block',
        });
      } else if (r.priceImpact > PRICE_IMPACT_WARN_THRESHOLD) {
        warnings.push({
          routeId: r.id,
          priceImpact: r.priceImpact,
          message: `Price impact of ${(r.priceImpact * 100).toFixed(1)}% is high. Consider using a multi-hop route or reducing input amount.`,
          severity: 'warn',
        });
      }
    }

    return warnings;
  }

  const compute = useCallback(async () => {
    if (!tokenInAddress || !tokenOutAddress || !amountIn || parseFloat(amountIn) <= 0) {
      setRouteState(null);
      setAllRoutes([]);
      setDexQuotes([]);
      setPriceImpactWarnings([]);
      setIsLoading(false);
      return;
    }

    const inToken = getTokenInfo(tokenInAddress);
    const outToken = getTokenInfo(tokenOutAddress);
    if (!inToken || !outToken) {
      setRouteState(null);
      setAllRoutes([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    const seq = ++seqRef.current;
    // Hoist variables so they're accessible in the finally block for promise resolution
    let routes: RouteResult[] = [];
    let prevId: string | null = null;

    try {
      const client = wagmiPublicClient ?? undefined;
      // ─── Primary Route Fetch (using registered routers) ───────────────────────
      let allPools = await fetchPoolsForSwap(tokenInAddress, tokenOutAddress, client);

      if (seq !== seqRef.current) return; // stale
      setPools(allPools);

      const amountInWei = parseUnits(amountIn, inToken.decimals);

      // Find all viable routes (already sorted by output desc)
      routes = findAllViableRoutes(
        tokenInAddress,
        tokenOutAddress,
        amountInWei,
        allPools,
        feeBps,
      );

      // ─── Phase 5.1: Check pool freshness ───────────────────────────────────
      const freshnessWarnings = checkPoolFreshness(allPools);

      // ─── Phase 5.3: Price impact warnings (enhanced >5% threshold) ──────────
      // Now checks >5% in addition to the existing >10% check
      const impactWarnings = checkPriceImpact(routes);
      setPriceImpactWarnings([...freshnessWarnings, ...impactWarnings]);

      // ─── Fallback: Extreme Price Impact or Single DEX Detection ─────────────
      // ENHANCED: Now triggers on >5% price impact in addition to >10%
      // This ensures better multi-hop routes are found when direct route is illiquid
      const primaryHasHighImpact = routes.length > 0 && routes[0].priceImpact > PRICE_IMPACT_WARN_THRESHOLD;
      const primaryHasExtremeImpact = routes.length > 0 && routes[0].priceImpact > PRICE_IMPACT_BLOCK;
      const uniqueDexCount = routes.length > 0
        ? new Set(routes.flatMap(r => r.steps.map(s => s.dexName))).size
        : 0;

      // Trigger fallback if:
      // 1. High price impact (>5%) detected on best route AND better alternatives may exist, OR
      // 2. Extreme price impact (>10%) detected on best route, OR
      // 3. Only 1 DEX available AND fewer than 5 pools found, OR
      // 4. ZERO routes found despite pools existing (edge case: BFS found paths but route computation failed), OR
      // 5. ZERO pools found at all (need to search more aggressively with useAllDex=true)
      const shouldFallback = primaryHasHighImpact
        || primaryHasExtremeImpact
        || (uniqueDexCount === 1 && allPools.length < 5)
        || (routes.length === 0 && allPools.length > 0)
        || allPools.length === 0;  // No pools found at all - try harder with useAllDex=true

      if (shouldFallback && client) {
        console.warn(`[useRoute] Fallback triggered: highImpact=${primaryHasHighImpact}, extremeImpact=${primaryHasExtremeImpact}, uniqueDex=${uniqueDexCount}, poolCount=${allPools.length}, routeCount=${routes.length}`);

        // Fetch from ALL_DEX_LIST directly using fetchPoolsForSwap with useAllDex=true
        // This properly bypasses the registered router filter unlike fallbackGetPairs
        const allDexPools = await fetchPoolsForSwap(tokenInAddress, tokenOutAddress, client, true);

        console.log(`[useRoute] Fallback: primary had ${allPools.length} pools, ALL_DEX found ${allDexPools.length} pools`);

        // Merge pools from both sources (deduplicate by factory:token0:token1)
        if (allDexPools.length > 0) {
          const existingKeys = new Set(allPools.map(p => `${p.factory}:${p.token0}:${p.token1}`));
          const newPools = allDexPools.filter(p => {
            const key = `${p.factory}:${p.token0}:${p.token1}`;
            return !existingKeys.has(key);
          });

          if (newPools.length > 0) {
            console.log(`[useRoute] Fallback: found ${newPools.length} new pools not in primary results`);
            allPools = [...allPools, ...newPools];
            setPools(allPools);
          }
        }

        // ALSO fetch hub-token intermediate pairs to enable multi-hop routing
        // The standard fetchPoolsForSwap skips hub-to-hub pairs when both tokens are hubs,
        // but the fallback needs to find intermediate pools for BFS to discover multi-hop routes
        const hubPairs = await fetchHubTokenPairs(tokenInAddress, tokenOutAddress, client, true);

        console.log(`[useRoute] Fallback: found ${hubPairs.length} hub-token intermediate pools`);

        if (hubPairs.length > 0) {
          const existingKeys = new Set(allPools.map(p => `${p.factory}:${p.token0}:${p.token1}`));
          const newHubPools = hubPairs.filter(p => {
            const key = `${p.factory}:${p.token0}:${p.token1}`;
            return !existingKeys.has(key);
          });

          if (newHubPools.length > 0) {
            console.log(`[useRoute] Fallback: found ${newHubPools.length} new hub-hop pools`);
            allPools = [...allPools, ...newHubPools];
            setPools(allPools);
          }
        }

        // Recompute routes with full pool set (including hub-hop pairs for multi-hop routing)
        routes = findAllViableRoutes(
          tokenInAddress,
          tokenOutAddress,
          amountInWei,
          allPools,
          feeBps,
        );

        // Re-check price impact warnings after fallback
        const updatedImpactWarnings = checkPriceImpact(routes);
        setPriceImpactWarnings([...freshnessWarnings, ...updatedImpactWarnings]);

        console.log(`[useRoute] After fallback: ${routes.length} routes found, best priceImpact=${routes[0]?.priceImpact}`);
      }

      if (seq !== seqRef.current) return;
      setAllRoutes(routes);

      // Preserve user's manually selected route across refreshes.
      // If the previously selected route ID still exists in the new routes,
      // keep it selected. Otherwise, fall back to the best route (routes[0]).
      if (routes.length > 0) {
        prevId = userSelectedRouteIdRef.current;
        const matchingRoute = prevId
          ? routes.find((r) => r.id === prevId) ?? routes[0]
          : routes[0];
        setRouteState(matchingRoute);
        // Update the ref to reflect the actual selection (may be routes[0] if no match)
        userSelectedRouteIdRef.current = matchingRoute.id;
      } else {
        setRouteState(null);
      }

      // Get per-DEX quotes for comparison
      const quotes = getPerDexQuotes(tokenInAddress, tokenOutAddress, amountInWei, allPools);
      setDexQuotes(quotes);
    } catch (err) {
      if (seq !== seqRef.current) return;
      setError(err instanceof Error ? err.message : 'Route computation failed');
      setRouteState(null);
      setAllRoutes([]);
      // Reject the pending promise if this was a refetch-triggered compute
      if (computePromiseRef.current && seq === seqRef.current) {
        computePromiseRef.current.reject(err instanceof Error ? err : new Error('Route computation failed'));
        computePromiseRef.current = null;
      }
    } finally {
      if (seq === seqRef.current) {
        setIsLoading(false);
        // Resolve the pending promise if this was a refetch-triggered compute
        if (computePromiseRef.current) {
          computePromiseRef.current.resolve(
            routes.length > 0
              ? (prevId
                  ? routes.find((r) => r.id === prevId) ?? routes[0]
                  : routes[0])
              : null,
          );
          computePromiseRef.current = null;
        }
      }
    }
  }, [tokenInAddress, tokenOutAddress, amountIn, feeBps, wagmiPublicClient]);

  // Reset user's manual route selection when input parameters change.
  // This ensures that changing tokens or amounts resets to the best route,
  // while refetches (e.g., before swap execution) preserve the selection.
  useEffect(() => {
    userSelectedRouteIdRef.current = null;
  }, [tokenInAddress, tokenOutAddress, amountIn]);

  // Debounced computation
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(compute, DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [compute]);

  /**
   * Trigger a fresh route computation (bypasses debounce).
   * Returns a Promise that resolves with the fresh route once computation completes.
   * This allows callers (e.g., swap execution) to await the latest route data
   * instead of relying on fixed timeouts.
   */
  const refetch = useCallback((): Promise<RouteResult | null> => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    return new Promise<RouteResult | null>((resolve, reject) => {
      computePromiseRef.current = { resolve, reject };
      compute();
    });
  }, [compute]);

  const outDecimals = tokenOutAddress ? getTokenDecimals(tokenOutAddress) : 18;
  const formattedOutput = route && route.totalExpectedOut > 0n
    ? formatUnits(route.totalExpectedOut, outDecimals)
    : null;

  // Price quote kept for backward compatibility but consumers should prefer formattedOutput
  // Uses scaled BigInt division to avoid precision loss for large values
  const priceQuote = (() => {
    if (!route || route.totalExpectedOut <= 0n || route.totalAmountIn <= 0n) return null;
    // Scale by 1e6 to get ~6 decimal places of precision without Number() overflow
    const scaled = (route.totalExpectedOut * 1_000_000n) / route.totalAmountIn;
    return Number(scaled) / 1_000_000;
  })();

  return {
    route,
    allRoutes,
    setRoute,
    dexQuotes,
    pools,
    isLoading,
    error,
    refetch,
    priceQuote,
    /** H-02: formatted output string (avoids BigInt→Number precision loss). */
    formattedOutput,
    /** H-01: decimals of the output token. */
    outDecimals,
    /** Phase 5.3: Price impact warnings for routes exceeding thresholds. */
    priceImpactWarnings,
    /** Phase 5.3: Check if the best route has high price impact. */
    hasHighPriceImpact: route ? route.priceImpact > PRICE_IMPACT_WARN_THRESHOLD : false,
    /** Phase 5.3: Check if the best route has extreme price impact (may be blocked). */
    hasExtremePriceImpact: route ? route.priceImpact > PRICE_IMPACT_BLOCK : false,
    /** Phase 6: Route liquidity analysis for auto multi-hop suggestion. */
    routeLiquidityAnalysis: (() => {
      if (!tokenInAddress || !tokenOutAddress || pools.length === 0) return null;
      return analyzeRouteLiquidity(tokenInAddress, tokenOutAddress, pools);
    })(),
    /** Phase 6: Whether multi-hop should be suggested for this pair. */
    shouldSuggestMultiHop: (() => {
      if (!tokenInAddress || !tokenOutAddress || pools.length === 0) return false;
      const analysis = analyzeRouteLiquidity(tokenInAddress, tokenOutAddress, pools);
      return analysis.shouldPreferMultiHop;
    })(),
    /** Phase 7: Route comparison for advisor mode (direct vs multi-hop). */
    routeComparison: ((): RouteComparison | null => {
      if (!tokenInAddress || !tokenOutAddress || allRoutes.length === 0) return null;
      const bestDirect = allRoutes.find(r => r.routeType === 'direct');
      const bestMultiHop = allRoutes.find(r =>
        r.routeType === 'multi_hop' &&
        r.intermediateToken?.toLowerCase() === CONTRACTS.WWDOGE.toLowerCase()
      );
      return compareRoutes(bestDirect ?? null, bestMultiHop ?? null, outDecimals);
    })(),
    /** Phase 7: Pool liquidity data with TVL and tier information. */
    poolsWithLiquidity: pools.map(p => ({
      ...p,
      tvlUsd: p.tvlUsd ?? (() => {
        // Get actual decimals for each token and normalize reserves
        const decimals0 = getTokenDecimals(p.token0);
        const decimals1 = getTokenDecimals(p.token1);
        const exponent0 = 18 - decimals0;
        const exponent1 = 18 - decimals1;
        const r0Normalized = Number(p.reserve0) / Math.pow(10, exponent0);
        const r1Normalized = Number(p.reserve1) / Math.pow(10, exponent1);
        return 2 * Math.sqrt(r0Normalized * r1Normalized);
      })(),
    })),
  };
}
