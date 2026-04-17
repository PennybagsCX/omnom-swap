/**
 * useReverseRoute — hook for reverse path finding (given desired output, find required input).
 *
 * Mirrors the useRoute hook API but operates in reverse.
 * Uses the same debouncing and stale-request handling pattern.
 *
 * When the user types in the BUY field, this hook computes the required
 * sell amount for each route and selects the cheapest one.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { parseUnits, formatUnits } from 'viem';
import { usePublicClient } from 'wagmi';
import { TOKENS, getTokenDecimals } from '../../lib/constants';
import { formatCompactAmount } from '../../lib/format';
import { fetchAllPools } from '../../services/pathFinder/poolFetcher';
import { findAllRoutesForOutput } from '../../services/pathFinder';
import type { RouteResult, PoolReserves, TokenInfo } from '../../services/pathFinder/types';

const DEBOUNCE_MS = 500;

export function useReverseRoute(
  tokenInAddress: string | undefined,
  tokenOutAddress: string | undefined,
  amountOut: string | undefined,
  feeBps: number = 25,
) {
  const [route, setRouteState] = useState<RouteResult | null>(null);
  const [allRoutes, setAllRoutes] = useState<RouteResult[]>([]);
  const [pools, setPools] = useState<PoolReserves[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seqRef = useRef(0);
  // Promise-based refetch: allows callers to await route computation.
  const computePromiseRef = useRef<{
    resolve: (route: RouteResult | null) => void;
    reject: (err: Error) => void;
  } | null>(null);

  // Track the user's manually selected route ID so it survives route refreshes.
  // Reset to null when input parameters change (tokens or amount).
  const userSelectedRouteIdRef = useRef<string | null>(null);

  // Wrapped setRoute that records the user's manual selection.
  const setRoute = useCallback((r: RouteResult | null) => {
    userSelectedRouteIdRef.current = r?.id ?? null;
    setRouteState(r);
  }, []);

  const wagmiPublicClient = usePublicClient();

  const getTokenInfo = (address: string): TokenInfo | undefined => {
    const t = TOKENS.find((t) => t.address.toLowerCase() === address.toLowerCase());
    if (!t) return undefined;
    return { address: t.address, symbol: t.symbol, decimals: t.decimals ?? 18, logoURI: t.icon };
  };

  const compute = useCallback(async () => {
    if (!tokenInAddress || !tokenOutAddress || !amountOut || parseFloat(amountOut) <= 0) {
      setRouteState(null);
      setAllRoutes([]);
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
      const allPools = wagmiPublicClient
        ? await fetchAllPools(
            TOKENS.map((t) => ({
              address: t.address,
              symbol: t.symbol,
              decimals: t.decimals ?? 18,
              logoURI: t.icon,
            })),
            wagmiPublicClient,
          )
        : await fetchAllPools(
            TOKENS.map((t) => ({
              address: t.address,
              symbol: t.symbol,
              decimals: t.decimals ?? 18,
              logoURI: t.icon,
            })),
          );

      if (seq !== seqRef.current) return; // stale
      setPools(allPools);

      const amountOutWei = parseUnits(amountOut, outToken.decimals);
      routes = findAllRoutesForOutput(tokenInAddress, tokenOutAddress, amountOutWei, allPools, feeBps);

      if (seq !== seqRef.current) return;
      setAllRoutes(routes);

      // Preserve user's manually selected route across refreshes.
      if (routes.length > 0) {
        prevId = userSelectedRouteIdRef.current;
        const matchingRoute = prevId
          ? routes.find((r) => r.id === prevId) ?? routes[0]
          : routes[0];
        setRouteState(matchingRoute);
        userSelectedRouteIdRef.current = matchingRoute.id;
      } else {
        setRouteState(null);
      }
    } catch (err) {
      if (seq !== seqRef.current) return;
      setError(err instanceof Error ? err.message : 'Reverse route computation failed');
      setRouteState(null);
      setAllRoutes([]);
      if (computePromiseRef.current && seq === seqRef.current) {
        computePromiseRef.current.reject(err instanceof Error ? err : new Error('Reverse route computation failed'));
        computePromiseRef.current = null;
      }
    } finally {
      if (seq === seqRef.current) {
        setIsLoading(false);
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
  }, [tokenInAddress, tokenOutAddress, amountOut, feeBps, wagmiPublicClient]);

  // Reset user's manual route selection when input parameters change.
  useEffect(() => {
    userSelectedRouteIdRef.current = null;
  }, [tokenInAddress, tokenOutAddress, amountOut]);

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
   */
  const refetch = useCallback((): Promise<RouteResult | null> => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    return new Promise<RouteResult | null>((resolve, reject) => {
      computePromiseRef.current = { resolve, reject };
      compute();
    });
  }, [compute]);

  // Formatted input amount (the computed sell amount)
  const inDecimals = tokenInAddress ? getTokenDecimals(tokenInAddress) : 18;
  const formattedInput = route && route.totalAmountIn > 0n
    ? (() => {
        const raw = formatUnits(route.totalAmountIn, inDecimals);
        const num = parseFloat(raw);
        return formatCompactAmount(num);
      })()
    : null;

  return {
    route,
    allRoutes,
    setRoute,
    pools,
    isLoading,
    error,
    refetch,
    /** Formatted input string (the computed sell amount). */
    formattedInput,
    /** Decimals of the input (sell) token. */
    inDecimals,
  };
}
