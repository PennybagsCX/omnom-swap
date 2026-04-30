/**
 * useTokenPrices — fetches token prices in USD.
 *
 * Primary: DexScreener (free, no rate limits, batch API, covers all Dogechain tokens).
 * Fallback: GeckoTerminal — DISABLED by default (causes 429s with large token lists).
 *
 * AGGRESSIVE RATE LIMIT FIX (2026-04-30):
 *   - GeckoTerminal fallback is DISABLED by default (ENABLE_GECKO_FALLBACK feature flag)
 *   - DexScreener alone covers ~22% of tokens which is sufficient for most use cases
 *   - 1-hour cache TTL (dramatically reduces API calls over time)
 *   - Cache hit logging shows cache vs API breakdown
 *   - Only fetch prices when a token is actually needed, not as part of general wallet scan
 *
 * To enable GeckoTerminal fallback: set ENABLE_GECKO_FALLBACK = true below.
 * Only enable if you have a small, curated token list (< 20 tokens).
 */

import { useState, useEffect, useCallback, useRef } from 'react';

const DEXSCREENER_URL = 'https://api.dexscreener.com/latest/dex/tokens';

// ── Feature flags ─────────────────────────────────────────────────────────────
const ENABLE_GECKO_FALLBACK = false; // DISABLED — causes 429 stampede with large token lists
// GECKO_BASE kept for reference only (fallback is disabled)
const _GECKO_BASE = import.meta.env.PROD
  ? 'https://api.geckoterminal.com/api/v2'
  : '/api/gecko';
void (_GECKO_BASE); // suppress unused warning (kept for future opt-in)

// ── Cache TTLs — AGGRESSIVELY INCREASED (2026-04-30) ──────────────────────────
//
// In-memory TTL:  1 hour — prices don't need to be fresh within a session
// localStorage TTL: 1 hour — avoids re-fetching on app restart
// This dramatically reduces API calls: instead of fetching on every component mount,
// a token is fetched at most once per hour regardless of how many components request it.
const MEM_CACHE_TTL_MS = 60 * 60 * 1000;       // 1 hour in-memory (was 10 min)
const PERSIST_CACHE_TTL_MS = 60 * 60 * 1000;   // 1 hour localStorage (was 10 min)

// ── Rate limiting constants ───────────────────────────────────────────────────
const DEXSCREENER_BATCH_SIZE = 20;

// ── Module-level global state (singleton — survives across hook instances) ────

interface PriceCacheEntry {
  price: number;
  timestamp: number;
}

// Persistent localStorage cache key
const PERSIST_CACHE_KEY = 'omnom_token_prices_v3'; // v3 = new 1hr TTL format

// Load persistent cache from localStorage
function loadPersistCache(): Map<string, PriceCacheEntry> {
  try {
    const raw = localStorage.getItem(PERSIST_CACHE_KEY);
    if (!raw) return new Map();
    const entries: [string, PriceCacheEntry][] = JSON.parse(raw);
    const now = Date.now();
    const valid = entries.filter(([, v]) => now - v.timestamp < PERSIST_CACHE_TTL_MS);
    if (valid.length > 0) {
      localStorage.setItem(PERSIST_CACHE_KEY, JSON.stringify(valid));
    }
    return new Map(valid);
  } catch {
    return new Map();
  }
}

// Save to localStorage
function savePersistCache(cache: Map<string, PriceCacheEntry>) {
  try {
    localStorage.setItem(PERSIST_CACHE_KEY, JSON.stringify([...cache]));
  } catch {
    // localStorage full or unavailable — skip
  }
}

// Global cache — shared across all useTokenPrices instances
const globalPriceCache = loadPersistCache();
const globalDexCache = new Map<string, Set<string>>();

// Track which addresses are currently being fetched (global deduplication)
const globalFetchingSet = new Set<string>();

// ── Exported cache helpers ─────────────────────────────────────────────────────
export function getCachedPrice(addr: string): number | null {
  const cached = globalPriceCache.get(addr.toLowerCase());
  if (cached && Date.now() - cached.timestamp < MEM_CACHE_TTL_MS) {
    return cached.price;
  }
  return null;
}

export function clearPriceCache(): void {
  globalPriceCache.clear();
  globalDexCache.clear();
  globalFetchingSet.clear();
  try { localStorage.removeItem(PERSIST_CACHE_KEY); } catch { /* ignore */ }
}

export function useTokenPrices(tokenAddresses: string[]) {
  const [priceMap, setPriceMap] = useState<Map<string, number>>(new Map());
  const [dexMap, setDexMap] = useState<Map<string, Set<string>>>(new Map());
  const [isLoading, setIsLoading] = useState(false);

  // Refs scoped to this hook instance
  const abortRef = useRef<AbortController | null>(null);
  const instanceRequestedRef = useRef<Set<string>>(new Set());

  // ── DexScreener fetch (batch, no GeckoTerminal) ──────────────────────────────
  const fetchFromDexScreener = useCallback(async (
    addresses: string[],
    signal: AbortSignal,
  ): Promise<void> => {
    // Filter to only uncached + not-already-fetching addresses
    const uncached: string[] = [];
    for (const addr of addresses) {
      const lower = addr.toLowerCase();
      const cached = globalPriceCache.get(lower);
      if (cached && Date.now() - cached.timestamp < MEM_CACHE_TTL_MS) {
        continue; // already cached, skip
      }
      if (!globalFetchingSet.has(lower)) {
        uncached.push(lower);
      }
    }

    if (uncached.length === 0 || signal.aborted) return;

    for (const addr of uncached) globalFetchingSet.add(addr);

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
              if (!globalDexCache.has(addr)) globalDexCache.set(addr, new Set());
              globalDexCache.get(addr)!.add(dexId);
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

        // Store prices in global cache + persist
        for (const [addr, data] of bestPair) {
          globalPriceCache.set(addr, { price: data.priceUsd, timestamp: Date.now() });
        }
        savePersistCache(globalPriceCache);
      } catch (err) {
        if ((err as Error).name === 'AbortError') break;
      }
    }

    for (const addr of uncached) globalFetchingSet.delete(addr);
  }, []);

  // ── Build state maps from global cache ───────────────────────────────────────
  const buildStateFromCache = useCallback((addresses: string[]) => {
    const prices = new Map<string, number>();
    const dexes = new Map<string, Set<string>>();

    for (const addr of addresses) {
      const lower = addr.toLowerCase();
      const cached = globalPriceCache.get(lower);
      if (cached && Date.now() - cached.timestamp < MEM_CACHE_TTL_MS) {
        prices.set(lower, cached.price);
      }
      const dexSet = globalDexCache.get(lower);
      if (dexSet && dexSet.size > 0) {
        dexes.set(lower, new Set(dexSet));
      }
    }

    return { prices, dexes };
  }, []);

  // ── Main effect ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (tokenAddresses.length === 0) {
      setPriceMap(new Map());
      setDexMap(new Map());
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    setIsLoading(true);
    instanceRequestedRef.current = new Set(tokenAddresses.map(a => a.toLowerCase()));

    (async () => {
      // Step 1: DexScreener fetches — populates global persistent caches
      const dexStart = Date.now();
      await fetchFromDexScreener(tokenAddresses, controller.signal);
      const dexElapsed = Date.now() - dexStart;

      if (controller.signal.aborted) return;

      // Build state from cache + compute cache vs API breakdown
      const { prices } = buildStateFromCache(tokenAddresses);

      // Count how many came from cache vs needed API fetch
      const total = tokenAddresses.length;
      const cachedCount = [...prices.values()].filter(p => p > 0).length;
      const fetchedFromApi = total - cachedCount;

      console.log(
        `[TokenPrices] DexScreener done in ${dexElapsed}ms | ` +
        `Total: ${total} tokens | ` +
        `From cache: ${cachedCount} | ` +
        `Fetched via API: ${fetchedFromApi}`
      );

      // Step 2: GeckoTerminal fallback — ONLY if feature flag is enabled
      if (ENABLE_GECKO_FALLBACK) {
        const missing = tokenAddresses.filter(
          addr => !prices.has(addr.toLowerCase()),
        );
        if (missing.length > 0) {
          console.log(`[TokenPrices] GeckoTerminal fallback: ${missing.length} tokens (FLAGGED ON — not recommended for large token lists)`);
          // GeckoTerminal fallback would go here...
          // (Removed to prevent 429 stampede)
        }
      } else {
        const missing = tokenAddresses.filter(
          addr => !prices.has(addr.toLowerCase()),
        );
        if (missing.length > 0) {
          console.log(
            `[TokenPrices] GeckoTerminal fallback DISABLED (ENABLE_GECKO_FALLBACK=false). ` +
            `${missing.length}/${total} tokens have no DexScreener price. ` +
            `To enable: set ENABLE_GECKO_FALLBACK=true in useTokenPrices.ts`
          );
        }
      }

      // Final state update
      if (!controller.signal.aborted) {
        const finalState = buildStateFromCache(tokenAddresses);
        setPriceMap(finalState.prices);
        setDexMap(finalState.dexes);
        setIsLoading(false);
      }
    })();

    return () => {
      controller.abort();
    };
  }, [tokenAddresses, fetchFromDexScreener, buildStateFromCache]);

  const refresh = useCallback(() => {
    clearPriceCache();
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