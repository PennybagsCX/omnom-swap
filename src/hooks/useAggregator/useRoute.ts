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
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { parseUnits, formatUnits } from 'viem';
import { usePublicClient } from 'wagmi';
import { TOKENS, getTokenDecimals } from '../../lib/constants';

import { fetchPoolsForSwap } from '../../services/pathFinder/poolFetcher';
import { findAllViableRoutes, getPerDexQuotes } from '../../services/pathFinder';
import type { RouteResult, PoolReserves, TokenInfo } from '../../services/pathFinder/types';

const DEBOUNCE_MS = 500;

export interface PerDexQuote {
  dexName: string;
  router: string;
  output: bigint;
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

  const compute = useCallback(async () => {
    if (!tokenInAddress || !tokenOutAddress || !amountIn || parseFloat(amountIn) <= 0) {
      setRouteState(null);
      setAllRoutes([]);
      setDexQuotes([]);
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

      // ─── Fallback: Extreme Price Impact or Single DEX Detection ─────────────
      // If primary route has extreme price impact (>10%) or only returns 1 DEX,
      // or if no routes found at all, fetch additional pools from ALL_DEX_LIST 
      // directly to find better routes.
      // This handles cases where registeredRoutersCache is stale/incomplete.
      const primaryHasExtremeImpact = routes.length > 0 && routes[0].priceImpact > 0.10;
      const uniqueDexCount = routes.length > 0
        ? new Set(routes.flatMap(r => r.steps.map(s => s.dexName))).size
        : 0;
      
      // Trigger fallback if:
      // 1. Extreme price impact (>10%) detected on best route, OR
      // 2. Only 1 DEX available AND fewer than 5 pools found, OR
      // 3. ZERO routes found despite pools existing (edge case: BFS found paths but route computation failed)
      const shouldFallback = primaryHasExtremeImpact 
        || (uniqueDexCount === 1 && allPools.length < 5)
        || (routes.length === 0 && allPools.length > 0);

      if (shouldFallback && client) {
        console.warn(`[useRoute] Fallback triggered: extremeImpact=${primaryHasExtremeImpact}, uniqueDex=${uniqueDexCount}, poolCount=${allPools.length}, routeCount=${routes.length}`);

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

            // Recompute routes with full pool set
            routes = findAllViableRoutes(
              tokenInAddress,
              tokenOutAddress,
              amountInWei,
              allPools,
              feeBps,
            );

            console.log(`[useRoute] After fallback: ${routes.length} routes found, best priceImpact=${routes[0]?.priceImpact}`);
          }
        }
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
  };
}
