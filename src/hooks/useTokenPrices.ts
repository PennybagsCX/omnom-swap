/**
 * useTokenPrices — fetches token prices in USD.
 *
 * Primary: DexScreener (free, no rate limits, batch API, covers all Dogechain tokens).
 * Fallback: GeckoTerminal for tokens DexScreener doesn't cover.
 *
 * Resilience against GeckoTerminal 429 errors:
 *   - 10-minute in-memory TTL cache (survives effect re-runs)
 *   - Persistent localStorage cache (survives app restarts — 10 min TTL)
 *   - Circuit breaker: 5-min cooldown after 429, then exponential backoff retry
 *   - Sequential fetching with 500ms delay between tokens
 *   - AbortController to cancel in-flight requests on effect teardown
 *
 * RATE LIMIT FIX (2026-04-29):
 *   - Removed individual token polling that caused 429 stampede on startup
 *   - Uses batch DexScreener API (20 tokens/request) as primary path
 *   - GeckoTerminal fallback only runs for tokens DexScreener misses
 *   - Global request queue serializes GeckoTerminal calls to avoid burst
 */

import { useState, useEffect, useCallback, useRef } from 'react';

const DEXSCREENER_URL = 'https://api.dexscreener.com/latest/dex/tokens';
const GECKO_BASE = import.meta.env.PROD
  ? 'https://api.geckoterminal.com/api/v2'
  : '/api/gecko';

// ── Cache TTLs ─────────────────────────────────────────────────────────────────
//
// In-memory TTL:  shorter — ensures fresh prices within a session
// localStorage TTL:  longer — avoids re-fetching on app restart
const MEM_CACHE_TTL_MS = 10 * 60 * 1000; // 10 min in-memory
const PERSIST_CACHE_TTL_MS = 10 * 60 * 1000; // 10 min localStorage (same as mem to stay consistent)

// ── Rate limiting constants ───────────────────────────────────────────────────
const DEXSCREENER_BATCH_SIZE = 20;
const GECKO_BATCH_SIZE = 5;          // Process GeckoTerminal tokens in small batches
const GECKO_DELAY_BETWEEN_BATCHES_MS = 2000; // 2s between batches (avoid 429 burst)

// ── Module-level global state (singleton — survives across hook instances) ────
//
// This prevents duplicate GeckoTerminal calls when multiple components use
// useTokenPrices simultaneously. All instances share the same cache and queue.

interface PriceCacheEntry {
  price: number;
  timestamp: number;
}

// Persistent localStorage cache key
const PERSIST_CACHE_KEY = 'omnom_token_prices_v2';

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

// Circuit breaker: global cooldown after 429
let globalGeckoCooldownUntil = 0;
let globalGeckoCooldownReason = '';

// Track queue processing state
let isGeckoQueueProcessing = false;
let lastGeckoBatchCompletedAt = 0;

// Accumulator for pending GeckoTerminal requests
let pendingGeckoTokens: string[] = [];
let pendingGeckoResolve: ((val: void) => void) | null = null;

// Enhanced processGeckoQueue with strict rate limiting
async function processGeckoQueue(): Promise<void> {
  if (isGeckoQueueProcessing) return;
  isGeckoQueueProcessing = true;

  try {
    while (pendingGeckoTokens.length > 0) {
      // Check cooldown BEFORE starting new batch
      if (Date.now() < globalGeckoCooldownUntil) {
        const cooldownRemaining = globalGeckoCooldownUntil - Date.now();
        console.log(`[GeckoQueue] In cooldown (${globalGeckoCooldownReason}), waiting ${Math.round(cooldownRemaining / 1000)}s`);
        await new Promise(resolve => setTimeout(resolve, Math.min(cooldownRemaining, 5000)));
        if (Date.now() < globalGeckoCooldownUntil) continue;
      }

      // Enforce strict 2s gap between batches
      const timeSinceLastBatch = Date.now() - lastGeckoBatchCompletedAt;
      if (lastGeckoBatchCompletedAt > 0 && timeSinceLastBatch < GECKO_DELAY_BETWEEN_BATCHES_MS) {
        const waitTime = GECKO_DELAY_BETWEEN_BATCHES_MS - timeSinceLastBatch;
        console.log(`[GeckoQueue] Enforcing ${waitTime}ms gap between batches`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }

      const batch = pendingGeckoTokens.splice(0, GECKO_BATCH_SIZE);
      if (batch.length === 0) break;

      console.log(`[GeckoQueue] Processing batch of ${batch.length} tokens, ${pendingGeckoTokens.length} remaining`);

      let had429ThisBatch = false;

      // Fetch all tokens in the batch concurrently (small batch = manageable load)
      await Promise.all(
        batch.map(async (addr) => {
          if (globalFetchingSet.has(addr)) return;
          globalFetchingSet.add(addr);

          try {
            const url = `${GECKO_BASE}/networks/dogechain/tokens/${addr}/pools?limit=10`;
            const res = await fetch(url);

            if (res.status === 429) {
              // Circuit breaker: 30s cooldown on 429
              globalGeckoCooldownUntil = Date.now() + 30_000;
              globalGeckoCooldownReason = '429 from token pools endpoint';
              had429ThisBatch = true;
              console.log(`[GeckoQueue] Got 429 for ${addr}, entering 30s cooldown`);
              // Put token back in queue for retry after cooldown
              pendingGeckoTokens.push(addr);
              return;
            }

            if (!res.ok) return;

            const json = await res.json();
            const pools = json?.data;
            if (!Array.isArray(pools) || pools.length === 0) return;

            const attributes = pools[0]?.attributes;
            let price: number | null = null;
            if (attributes?.base_token_price_usd) {
              price = parseFloat(attributes.base_token_price_usd);
            } else if (attributes?.quote_token_price_usd) {
              price = parseFloat(attributes.quote_token_price_usd);
            }

            if (price !== null && !isNaN(price) && price > 0) {
              const entry = { price, timestamp: Date.now() };
              globalPriceCache.set(addr, entry);
            }
          } catch {
            // Network error — skip
          } finally {
            globalFetchingSet.delete(addr);
          }
        })
      );

      // Mark batch complete
      lastGeckoBatchCompletedAt = Date.now();

      // If we hit 429, pause longer before next batch
      if (had429ThisBatch) {
        console.log(`[GeckoQueue] 429 detected, waiting ${30_000}ms before continuing`);
        await new Promise(resolve => setTimeout(resolve, 30_000));
        // Clear the cooldown since we waited
        globalGeckoCooldownUntil = Date.now();
      }

      // Delay between batches to avoid 429 (only if queue still has items)
      if (pendingGeckoTokens.length > 0) {
        await new Promise(resolve => setTimeout(resolve, GECKO_DELAY_BETWEEN_BATCHES_MS));
      }
    }
  } finally {
    isGeckoQueueProcessing = false;
    if (pendingGeckoResolve) {
      pendingGeckoResolve();
      pendingGeckoResolve = null;
    }
  }
}

// ── Exported cache helpers (for external access if needed) ─────────────────────
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
  pendingGeckoTokens = [];
  globalGeckoCooldownUntil = 0;
  try { localStorage.removeItem(PERSIST_CACHE_KEY); } catch { /* ignore */ }
}

export function useTokenPrices(tokenAddresses: string[]) {
  const [priceMap, setPriceMap] = useState<Map<string, number>>(new Map());
  const [dexMap, setDexMap] = useState<Map<string, Set<string>>>(new Map());
  const [isLoading, setIsLoading] = useState(false);

  // Refs scoped to this hook instance
  const abortRef = useRef<AbortController | null>(null);
  // Track which addresses this instance has requested
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
      await fetchFromDexScreener(tokenAddresses, controller.signal);

      // Step 2: Check if we're in 429 cooldown
      if (Date.now() < globalGeckoCooldownUntil) {
        const state = buildStateFromCache(tokenAddresses);
        setPriceMap(state.prices);
        setDexMap(state.dexes);
        setIsLoading(false);
        return;
      }

      // Step 3: Queue missing tokens for GeckoTerminal (batched, not individual)
      const { prices: currentPrices } = buildStateFromCache(tokenAddresses);
      const missing = tokenAddresses.filter(
        addr => !currentPrices.has(addr.toLowerCase()),
      );

      if (missing.length > 0) {
        // Add to global queue (deduplicated — already-cached or in-flight tokens ignored)
        for (const addr of missing) {
          const lower = addr.toLowerCase();
          if (!pendingGeckoTokens.includes(lower)) {
            pendingGeckoTokens.push(lower);
          }
        }

        // Start queue processing if not already running
        if (!pendingGeckoResolve) {
          processGeckoQueue().catch(() => { /* ignore — queue handles errors */ });
        }

        // Wait for queue to be processed before final state update
        await new Promise<void>((resolve) => {
          pendingGeckoResolve = resolve;
          // Timeout after 30s to not block UI forever
          setTimeout(resolve, 30_000);
        });
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
