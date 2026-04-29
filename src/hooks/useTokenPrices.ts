/**
 * useTokenPrices — fetches token prices in USD.
 *
 * Primary: DexScreener (free, no rate limits, batch API, covers all Dogechain tokens).
 * Fallback: GeckoTerminal for tokens DexScreener doesn't cover.
 *
 * DEX info and prices are cached in refs so they survive effect re-runs
 * (caused by the wallet scan updating heldTokenAddresses progressively).
 */

import { useState, useEffect, useCallback, useRef } from 'react';

const DEXSCREENER_URL = 'https://api.dexscreener.com/latest/dex/tokens';
const GECKO_BASE = import.meta.env.PROD
  ? 'https://api.geckoterminal.com/api/v2'
  : '/api/gecko';

const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const DEXSCREENER_BATCH_SIZE = 20;
const GECKO_COOLDOWN_MS = 5 * 60 * 1000; // 5 min cooldown after 429

interface PriceCacheEntry {
  price: number;
  timestamp: number;
}

export function useTokenPrices(tokenAddresses: string[]) {
  const [priceMap, setPriceMap] = useState<Map<string, number>>(new Map());
  const [dexMap, setDexMap] = useState<Map<string, Set<string>>>(new Map());
  const [isLoading, setIsLoading] = useState(false);

  // Persistent caches — survive effect re-runs
  const priceCacheRef = useRef<Map<string, PriceCacheEntry>>(new Map());
  const dexCacheRef = useRef<Map<string, Set<string>>>(new Map());
  const abortRef = useRef<AbortController | null>(null);
  // Track which addresses are currently being fetched to avoid redundant work
  const fetchingRef = useRef<Set<string>>(new Set());
  // Circuit breaker: if GeckoTerminal returns 429, stop all GeckoTerminal calls for cooldown
  const geckoCooldownUntilRef = useRef<number>(0);

  const fetchFromDexScreener = useCallback(async (
    addresses: string[],
    signal: AbortSignal,
  ): Promise<void> => {
    // Filter to only uncached + not-already-fetching addresses
    const uncached: string[] = [];
    for (const addr of addresses) {
      const lower = addr.toLowerCase();
      const cached = priceCacheRef.current.get(lower);
      if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
        continue; // already cached, skip
      }
      if (!fetchingRef.current.has(lower)) {
        uncached.push(lower);
      }
    }

    if (uncached.length === 0 || signal.aborted) return;

    for (const addr of uncached) fetchingRef.current.add(addr);

    for (let i = 0; i < uncached.length; i += DEXSCREENER_BATCH_SIZE) {
      if (signal.aborted) break;

      const batch = uncached.slice(i, i + DEXSCREENER_BATCH_SIZE);
      const url = `${DEXSCREENER_URL}/${batch.join(',')}`;

      try {
        const res = await fetch(url, { signal });
        if (!res.ok) continue;

        const json = await res.json();
        const pairs = json?.pairs;
        if (!Array.isArray(pairs)) continue;

        const bestPair = new Map<string, { priceUsd: number; liq: number }>();

        for (const pair of pairs) {
          if (signal.aborted) break;

          const baseAddr = (pair.baseToken?.address ?? '').toLowerCase();
          const quoteAddr = (pair.quoteToken?.address ?? '').toLowerCase();
          const priceUsd = parseFloat(pair.priceUsd);
          const priceNative = parseFloat(pair.priceNative);
          const liq = pair.liquidity?.usd ?? 0;
          const dexId = pair.dexId;

          if (isNaN(priceUsd) || priceUsd <= 0) continue;

          // Accumulate DEX info in persistent cache
          if (dexId && liq > 0) {
            for (const addr of [baseAddr, quoteAddr]) {
              if (!addr) continue;
              if (!dexCacheRef.current.has(addr)) dexCacheRef.current.set(addr, new Set());
              dexCacheRef.current.get(addr)!.add(dexId);
            }
          }

          if (baseAddr) {
            const existing = bestPair.get(baseAddr);
            if (!existing || liq > existing.liq) {
              bestPair.set(baseAddr, { priceUsd, liq });
            }
          }

          if (quoteAddr && priceNative > 0) {
            const quotePrice = priceUsd / priceNative;
            if (quotePrice > 0) {
              const existing = bestPair.get(quoteAddr);
              if (!existing || liq > existing.liq) {
                bestPair.set(quoteAddr, { priceUsd: quotePrice, liq });
              }
            }
          }
        }

        // Store prices in persistent cache
        for (const [addr, data] of bestPair) {
          priceCacheRef.current.set(addr, { price: data.priceUsd, timestamp: Date.now() });
        }
      } catch (err) {
        if ((err as Error).name === 'AbortError') break;
      }
    }

    for (const addr of uncached) fetchingRef.current.delete(addr);
  }, []);

  const fetchFromGecko = useCallback(async (
    address: string,
    signal: AbortSignal,
  ): Promise<{ price: number | null; hit429: boolean }> => {
    const addr = address.toLowerCase();
    const cached = priceCacheRef.current.get(addr);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      return { price: cached.price, hit429: false };
    }

    if (signal.aborted) return { price: null, hit429: false };

    try {
      const url = `${GECKO_BASE}/networks/dogechain/tokens/${addr}/pools?limit=10`;
      const res = await fetch(url, { signal });

      if (res.status === 429) {
        geckoCooldownUntilRef.current = Date.now() + GECKO_COOLDOWN_MS;
        return { price: null, hit429: true };
      }

      if (!res.ok) return { price: null, hit429: false };

      const json = await res.json();
      const pools = json?.data;
      if (!Array.isArray(pools) || pools.length === 0) return { price: null, hit429: false };

      const attributes = pools[0]?.attributes;
      let price: number | null = null;
      if (attributes?.base_token_price_usd) {
        price = parseFloat(attributes.base_token_price_usd);
      } else if (attributes?.quote_token_price_usd) {
        price = parseFloat(attributes.quote_token_price_usd);
      }

      if (price !== null && !isNaN(price) && price > 0) {
        priceCacheRef.current.set(addr, { price, timestamp: Date.now() });
        return { price, hit429: false };
      }

      return { price: null, hit429: false };
    } catch (err) {
      if ((err as Error).name === 'AbortError') return { price: null, hit429: false };
      return { price: null, hit429: false };
    }
  }, []);

  // Build state maps from caches for the requested addresses
  const buildStateFromCache = useCallback((addresses: string[]) => {
    const prices = new Map<string, number>();
    const dexes = new Map<string, Set<string>>();

    for (const addr of addresses) {
      const lower = addr.toLowerCase();
      const cached = priceCacheRef.current.get(lower);
      if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
        prices.set(lower, cached.price);
      }
      const dexSet = dexCacheRef.current.get(lower);
      if (dexSet && dexSet.size > 0) {
        dexes.set(lower, new Set(dexSet));
      }
    }

    return { prices, dexes };
  }, []);

  useEffect(() => {
    if (tokenAddresses.length === 0) {
      setPriceMap(new Map());
      setDexMap(new Map());
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    setIsLoading(true);

    (async () => {
      // Step 1: DexScreener fetches — populates persistent caches
      await fetchFromDexScreener(tokenAddresses, controller.signal);

      // Step 2: GeckoTerminal fallback for tokens DexScreener missed
      // Skip entirely if we're in a 429 cooldown from a previous cycle
      if (Date.now() < geckoCooldownUntilRef.current) {
        const state = buildStateFromCache(tokenAddresses);
        setPriceMap(state.prices);
        setDexMap(state.dexes);
        setIsLoading(false);
        return;
      }

      const { prices: currentPrices } = buildStateFromCache(tokenAddresses);
      const missing = tokenAddresses.filter(
        addr => !currentPrices.has(addr.toLowerCase()),
      );

      for (let i = 0; i < missing.length; i++) {
        if (controller.signal.aborted) break;

        const result = await fetchFromGecko(missing[i], controller.signal);

        // Circuit breaker: stop all GeckoTerminal calls on 429
        if (result.hit429) break;

        if (i % 3 === 0 || i === missing.length - 1) {
          const state = buildStateFromCache(tokenAddresses);
          setPriceMap(state.prices);
          setDexMap(state.dexes);
        }
      }

      // Final state update from all cached data
      if (!controller.signal.aborted) {
        const state = buildStateFromCache(tokenAddresses);
        setPriceMap(state.prices);
        setDexMap(state.dexes);
        setIsLoading(false);
      }
    })();

    return () => {
      controller.abort();
    };
  }, [tokenAddresses, fetchFromDexScreener, fetchFromGecko, buildStateFromCache]);

  const refresh = useCallback(() => {
    priceCacheRef.current.clear();
    dexCacheRef.current.clear();
    geckoCooldownUntilRef.current = 0;
    setPriceMap(new Map());
    setDexMap(new Map());
  }, []);

  return {
    priceMap,
    dexMap,
    isLoading,
    refresh,
  };
}
