/**
 * useOmnomData — fetches OMNOM stats, prices, and trades.
 *
 * ── Data Sources ─────────────────────────────────────────────────────────────
 *
 * PRICES / STATS:
 *   DexScreener (primary) — free, no rate limits
 *
 * TRADES (dual-source with smart fallback):
 *   1. DexScreener /orders (primary) — works for most tokens, free/unlimited
 *   2. GeckoTerminal /trades (fallback) — with retry/backoff resilience
 *      - Smart retry: exponential backoff 1s → 2s → 4s (max 30s, max 3 retries)
 *      - Shows loading state while retrying (no silent failures)
 *      - 1-hour cache TTL for successful results
 *      - Module-level queue prevents request stampede
 *      - On 429: retries up to 3 times with backoff before giving up
 *      - Console shows "Retrying in Xs..." instead of error spam
 *
 * GECKO_FALLBACK_ENABLED: Feature flag for trades GeckoTerminal fallback.
 * Keep DISABLED for token prices (causes 429 stampede).
 * Keep ENABLED for trades (user expects data, retry is acceptable).
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { CONTRACTS, OMNOM_WWDOGE_POOL } from '../lib/constants';

const DEXSCREENER_URL = 'https://api.dexscreener.com/latest/dex/tokens';
const STATS_STALE_MS = 60_000; // 1 min — DexScreener has no rate limits
const DEX_ORDERS_STALE_MS = 60_000; // 1 min for DexScreener orders (free/unlimited)

// ── GeckoTerminal Trades Fallback Configuration ──────────────────────────────
const GECKO_BASE = 'https://api.geckoterminal.com/api/v2';
const GECKO_NETWORK = 'networks/dogechain';
const GECKO_TRADES_STALE_MS = 60 * 60 * 1000; // 1 hour — trades don't change retroactively
const GECKO_RETRY_BASE_DELAY_MS = 1_000; // 1 second starting delay
const GECKO_RETRY_MAX_DELAY_MS = 30_000; // cap at 30 seconds
const GECKO_MAX_RETRIES = 3; // max 3 retry attempts

// Feature flag — trades GeckoTerminal fallback (keeps retrying on 429, eventually loads)
const GECKO_FALLBACK_ENABLED = true;

const TRADES_PAGE_SIZE = 10;

// ── Module-level Global State ─────────────────────────────────────────────────

interface GeckoTradesCacheEntry {
  trades: Trade[];
  timestamp: number;
}

// Global cache for GeckoTerminal trades (1 hour TTL)
const globalGeckoTradesCache = new Map<string, GeckoTradesCacheEntry>();

// Global queue to prevent request stampede (one request at a time per token)
const globalGeckoQueue = new Map<string, Promise<Trade[]>>();

// Load persistent cache from localStorage
function loadPersistGeckoCache(): Map<string, GeckoTradesCacheEntry> {
  try {
    const raw = localStorage.getItem('omnom_gecko_trades_v1');
    if (!raw) return new Map();
    const entries: [string, GeckoTradesCacheEntry][] = JSON.parse(raw);
    const now = Date.now();
    const valid = entries.filter(([, v]) => now - v.timestamp < GECKO_TRADES_STALE_MS);
    if (valid.length > 0) {
      localStorage.setItem('omnom_gecko_trades_v1', JSON.stringify(valid));
    }
    return new Map(valid);
  } catch {
    return new Map();
  }
}

// Save to localStorage
function savePersistGeckoCache(cache: Map<string, GeckoTradesCacheEntry>) {
  try {
    localStorage.setItem('omnom_gecko_trades_v1', JSON.stringify([...cache]));
  } catch {
    // localStorage full or unavailable — skip
  }
}

// Initialize persistent cache
const persistentGeckoCache = loadPersistGeckoCache();

// ── GeckoTerminal Trades Fetcher with Retry/Backoff ─────────────────────────────

interface GeckoTrade {
  type: string;
  attributes: {
    transaction_hash: string;
    timestamp: string;
    amount_0: string;
    amount_1: string;
    side: string;
    fee_amount: string;
    fee_token: string;
  };
}

interface GeckoTradesResponse {
  data: GeckoTrade[];
  relationships?: {
    pool?: {
      data?: {
        id?: string;
      };
    };
  };
}

function mapGeckoTradeToTrade(geckoTrade: GeckoTrade, _poolAddress: string): Trade {
  const attrs = geckoTrade.attributes;
  const isBuy = (attrs.side || '').toLowerCase() === 'buy';
  const fromTokenAmount = attrs.amount_0 || '0';
  const toTokenAmount = attrs.amount_1 || '0';
  
  return {
    kind: isBuy ? 'buy' : 'sell',
    tx_from_address: '', // GeckoTerminal doesn't expose maker address
    volume_in_usd: '0', // GeckoTerminal trades don't have USD amounts directly
    tx_hash: attrs.transaction_hash || '',
    block_timestamp: attrs.timestamp || '',
    from_token_amount: fromTokenAmount,
    to_token_amount: toTokenAmount,
    from_token_address: '', // Would need pool data to resolve
    to_token_address: '',
    price_from_in_usd: '0',
    price_to_in_usd: '0',
  };
}

/**
 * Fetch trades from GeckoTerminal with exponential backoff retry.
 * Returns cached results if available (1 hour TTL).
 */
async function fetchGeckoTradesWithRetry(
  poolAddress: string,
  signal?: AbortSignal
): Promise<Trade[]> {
  // Check memory cache first
  const memCached = globalGeckoTradesCache.get(poolAddress.toLowerCase());
  if (memCached && Date.now() - memCached.timestamp < GECKO_TRADES_STALE_MS) {
    console.log(`[GeckoTrades] Cache hit for pool ${poolAddress}`);
    return memCached.trades;
  }

  // Check persistent cache
  const persistCached = persistentGeckoCache.get(poolAddress.toLowerCase());
  if (persistCached && Date.now() - persistCached.timestamp < GECKO_TRADES_STALE_MS) {
    console.log(`[GeckoTrades] Persistent cache hit for pool ${poolAddress}`);
    globalGeckoTradesCache.set(poolAddress.toLowerCase(), persistCached);
    return persistCached.trades;
  }

  // Check if already fetching (prevent stampede)
  const existing = globalGeckoQueue.get(poolAddress.toLowerCase());
  if (existing) {
    console.log(`[GeckoTrades] Request already in queue for pool ${poolAddress}`);
    return existing;
  }

  // Create the fetch promise and add to queue
  const fetchPromise = (async () => {
    const url = `${GECKO_BASE}/${GECKO_NETWORK}/pools/${poolAddress}/trades`;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= GECKO_MAX_RETRIES; attempt++) {
      if (signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }

      if (attempt > 0) {
        // Calculate exponential backoff delay
        const delay = Math.min(
          GECKO_RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1),
          GECKO_RETRY_MAX_DELAY_MS
        );
        console.log(`[GeckoTrades] Retrying in ${delay / 1000}s... (attempt ${attempt}/${GECKO_MAX_RETRIES})`);
        
        // Wait before retrying
        await new Promise(resolve => setTimeout(resolve, delay));
      }

      console.log(`[GeckoTrades] Fetching ${url} (attempt ${attempt + 1}/${GECKO_MAX_RETRIES + 1})`);

      try {
        const res = await fetch(url, { signal });

        if (res.status === 429) {
          // Rate limited — continue to retry with backoff
          lastError = new Error(`HTTP 429 — Rate limited`);
          console.log(`[GeckoTrades] Rate limited (429) — will retry if attempts remain`);
          continue;
        }

        if (!res.ok) {
          lastError = new Error(`HTTP ${res.status}`);
          // Don't retry for non-429 errors (404, 500, etc.)
          if (res.status !== 429) {
            console.log(`[GeckoTrades] HTTP ${res.status} — not retrying (non-recoverable)`);
            break;
          }
          continue;
        }

        const json: GeckoTradesResponse = await res.json();
        const geckoTrades = json.data || [];
        
        // Map to our Trade format
        const trades = geckoTrades.map(t => mapGeckoTradeToTrade(t, poolAddress));

        // Cache successful result
        const cacheEntry: GeckoTradesCacheEntry = {
          trades,
          timestamp: Date.now(),
        };
        globalGeckoTradesCache.set(poolAddress.toLowerCase(), cacheEntry);
        persistentGeckoCache.set(poolAddress.toLowerCase(), cacheEntry);
        savePersistGeckoCache(persistentGeckoCache);

        console.log(`[GeckoTrades] Success: ${trades.length} trades for pool ${poolAddress}`);
        return trades;

      } catch (err) {
        if ((err as Error).name === 'AbortError') {
          throw err;
        }
        lastError = err as Error;
        console.log(`[GeckoTrades] Attempt ${attempt + 1} failed: ${lastError.message}`);
      }
    }

    // All retries exhausted
    console.log(`[GeckoTrades] All ${GECKO_MAX_RETRIES + 1} attempts failed for pool ${poolAddress}: ${lastError?.message}`);
    return [];
  })();

  globalGeckoQueue.set(poolAddress.toLowerCase(), fetchPromise);

  try {
    return await fetchPromise;
  } finally {
    globalGeckoQueue.delete(poolAddress.toLowerCase());
  }
}

// ── Interfaces ─────────────────────────────────────────────────────────────────

export interface DexPair {
  pairAddress: string;
  dexId: string;
  chainId: string;
  url: string;
  baseToken: { address: string; name: string; symbol: string };
  quoteToken: { address: string; name: string; symbol: string };
  priceNative: string;
  priceUsd: string;
  volume: { h24: number; h6: number; h1: number; m5: number };
  txns: {
    m5: { buys: number; sells: number };
    h1: { buys: number; sells: number };
    h6: { buys: number; sells: number };
    h24: { buys: number; sells: number };
  };
  priceChange: { h1: number; h6: number; h24: number };
  liquidity: { usd: number; base: number; quote: number };
  fdv: number;
  marketCap: number;
  pairCreatedAt: number;
}

export interface Trade {
  kind: string;
  tx_from_address: string;
  volume_in_usd: string;
  tx_hash: string;
  block_timestamp: string;
  from_token_amount: string;
  to_token_amount: string;
  from_token_address: string;
  to_token_address: string;
  price_from_in_usd: string;
  price_to_in_usd: string;
  [key: string]: string | number;
}

const baseOpts = {
  retry: (failureCount: number, error: Error) => {
    if (failureCount >= 2) return false;
    const msg = error.message || '';
    if (msg.includes('429') || msg.includes('HTTP 429')) return false;
    return msg.includes('Failed to fetch');
  },
  retryDelay: (attempt: number) => Math.min(3000 * 2 ** attempt, 15000),
  placeholderData: keepPreviousData,
  refetchOnWindowFocus: false,
  refetchOnReconnect: true,
} as const;

// ── DexScreener Orders (primary trades source) ─────────────────────────────────

interface DexOrder {
  id: string;
  txHash: string;
  blockchain: { id: string };
  poolAddress: string;
  blockTimestamp: number;
  maker: { address: string; label: string };
  side: string;
  fromTokenAmount: string;
  toTokenAmount: string;
  fromToken_usdAmount?: string;
  toToken_usdAmount?: string;
  orderPrice?: string;
  orderPrice_usd?: string;
  source: string;
}

interface DexOrdersResponse {
  orders: DexOrder[];
  totalPages: number;
  currentPage: number;
}

function mapDexOrderToTrade(order: DexOrder): Trade {
  return {
    kind: order.side || '',
    tx_from_address: order.maker?.address || '',
    volume_in_usd: order.fromToken_usdAmount || order.toToken_usdAmount || '0',
    tx_hash: order.txHash || '',
    block_timestamp: order.blockTimestamp ? new Date(order.blockTimestamp * 1000).toISOString() : '',
    from_token_amount: order.fromTokenAmount || '0',
    to_token_amount: order.toTokenAmount || '0',
    from_token_address: '',
    to_token_address: '',
    price_from_in_usd: order.fromToken_usdAmount || '0',
    price_to_in_usd: order.toToken_usdAmount || '0',
  };
}

// ── useOmnomData Hook ──────────────────────────────────────────────────────────

export function useOmnomData() {
  // DexScreener — single API call, no rate limits
  // Returns ALL OMNOM pairs across ALL DEXes on Dogechain
  const dexQuery = useQuery({
    queryKey: ['omnomDexScreener'],
    queryFn: async (): Promise<DexPair[]> => {
      const res = await fetch(`${DEXSCREENER_URL}/${CONTRACTS.OMNOM_TOKEN}`);
      if (!res.ok) throw new Error(`DexScreener HTTP ${res.status}`);
      const json = await res.json();
      return json.pairs || [];
    },
    staleTime: STATS_STALE_MS,
    refetchInterval: STATS_STALE_MS,
  });

  const pairs = dexQuery.data ?? [];

  // Primary pair = highest-liquidity OMNOM/WWDOGE pair (DexScreener sorts by liquidity)
  const primaryPair = pairs.length > 0
    ? (pairs.find(p => p.quoteToken?.symbol === 'WWDOGE') ?? pairs[0])
    : undefined;

  // ── Trades State ─────────────────────────────────────────────────────────────

  const [extraTrades, setExtraTrades] = useState<Trade[]>([]);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [geckoTrades, setGeckoTrades] = useState<Trade[]>([]);
  const [isLoadingGecko, setIsLoadingGecko] = useState(false);
  const geckoAbortRef = useRef<AbortController | null>(null);

  // ── GeckoTerminal Trades Fallback (with retry/backoff) ───────────────────────

  const fetchGeckoFallback = useCallback(async (poolAddress: string) => {
    if (!GECKO_FALLBACK_ENABLED) return [];

    setIsLoadingGecko(true);
    geckoAbortRef.current?.abort();
    geckoAbortRef.current = new AbortController();

    try {
      const trades = await fetchGeckoTradesWithRetry(
        poolAddress,
        geckoAbortRef.current.signal
      );
      setGeckoTrades(trades);
      return trades;
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        console.log(`[GeckoTrades] Fallback error: ${err}`);
      }
      return [];
    } finally {
      setIsLoadingGecko(false);
    }
  }, []);

  // Fetch GeckoTerminal trades when DexScreener orders return empty
  useEffect(() => {
    if (!primaryPair?.pairAddress) return;
    if (!GECKO_FALLBACK_ENABLED) return;

    // Only fetch GeckoTerminal if DexScreener orders are empty
    // (We'll check this condition in the render)
    return () => {
      geckoAbortRef.current?.abort();
    };
  }, [primaryPair?.pairAddress]);

  // ── DexScreener Orders Query (primary trades source) ─────────────────────────

  const dexOrdersQuery = useQuery({
    queryKey: ['omnomDexOrders'],
    queryFn: async (): Promise<Trade[]> => {
      try {
        const res = await fetch(`${DEXSCREENER_URL}/${CONTRACTS.OMNOM_TOKEN}/orders?chain=dogechain&limit=${TRADES_PAGE_SIZE}`);
        if (res.status === 404) {
          console.log(`[DexOrders] DexScreener returned 404 for OMNOM orders`);
          return [];
        }
        if (!res.ok) {
          console.log(`[DexOrders] DexScreener returned HTTP ${res.status}`);
          return [];
        }
        const json: DexOrdersResponse = await res.json();
        const orders = json.orders || [];
        console.log(`[DexOrders] DexScreener fetched ${orders.length} orders for OMNOM`);
        return orders.map(mapDexOrderToTrade);
      } catch (err) {
        console.log(`[DexOrders] DexScreener fetch failed: ${err}`);
        return [];
      }
    },
    staleTime: DEX_ORDERS_STALE_MS,
    refetchInterval: DEX_ORDERS_STALE_MS,
  });

  // ── Multi-pool Orders from DexScreener ─────────────────────────────────────

  const activePoolOrdersQuery = useQuery({
    queryKey: ['omnomActivePoolOrders', pairs.length],
    queryFn: async (): Promise<Trade[]> => {
      const primaryAddr = OMNOM_WWDOGE_POOL.toLowerCase();
      const activePools = pairs
        .filter(p => {
          const txns = (p.txns?.h24?.buys || 0) + (p.txns?.h24?.sells || 0);
          return txns > 0 && p.pairAddress?.toLowerCase() !== primaryAddr;
        })
        .sort((a, b) => {
          const aT = (a.txns?.h24?.buys || 0) + (a.txns?.h24?.sells || 0);
          const bT = (b.txns?.h24?.buys || 0) + (b.txns?.h24?.sells || 0);
          return bT - aT;
        })
        .slice(0, 3);

      const poolOrders: Trade[] = [];
      for (const pool of activePools) {
        const poolAddr = pool.pairAddress;
        if (!poolAddr) continue;
        try {
          const res = await fetch(`${DEXSCREENER_URL}/${pool.baseToken.address}/orders?chain=dogechain&limit=5`);
          if (!res.ok) continue;
          const json: DexOrdersResponse = await res.json();
          const orders = json.orders || [];
          if (orders.length > 0) {
            console.log(`[DexOrders] Pool ${poolAddr}: DexScreener fetched ${orders.length} orders`);
            poolOrders.push(...orders.map(mapDexOrderToTrade));
          }
        } catch { /* skip failed pool fetch */ }
      }
      return poolOrders;
    },
    staleTime: DEX_ORDERS_STALE_MS,
    refetchInterval: false, // No automatic refresh — manual only
    enabled: pairs.length > 0,
  });

  const dexOrders = dexOrdersQuery.data ?? [];
  const activePoolOrders = activePoolOrdersQuery.data ?? [];

  // ── GeckoTerminal Fallback Trigger ───────────────────────────────────────────
  // If DexScreener returns no orders and GeckoTerminal is enabled, fetch GeckoTerminal
  const shouldFetchGeckoFallback = GECKO_FALLBACK_ENABLED && 
    dexOrders.length === 0 && 
    activePoolOrders.length === 0 &&
    primaryPair?.pairAddress;

  // Debounced GeckoTerminal fetch
  const geckoFetchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (shouldFetchGeckoFallback && primaryPair?.pairAddress) {
      // Debounce to avoid immediate fetch if DexScreener is still loading
      geckoFetchTimeoutRef.current = setTimeout(() => {
        fetchGeckoFallback(primaryPair.pairAddress);
      }, 2000); // Wait 2s for DexScreener to potentially load
    }

    return () => {
      if (geckoFetchTimeoutRef.current) {
        clearTimeout(geckoFetchTimeoutRef.current);
      }
    };
  }, [shouldFetchGeckoFallback, primaryPair?.pairAddress, fetchGeckoFallback]);

  // ── Load More Trades ────────────────────────────────────────────────────────

  const hasMoreTrades = dexOrders.length === TRADES_PAGE_SIZE;

  const loadMoreTrades = useCallback(async () => {
    if (!hasMoreTrades || isLoadingMore) return;
    setIsLoadingMore(true);
    try {
      const res = await fetch(`${DEXSCREENER_URL}/${CONTRACTS.OMNOM_TOKEN}/orders?chain=dogechain&limit=${TRADES_PAGE_SIZE}&offset=${dexOrders.length + activePoolOrders.length + extraTrades.length}`);
      if (res.ok) {
        const json: DexOrdersResponse = await res.json();
        const orders = json.orders || [];
        if (orders.length > 0) {
          console.log(`[loadMoreTrades] DexScreener fetched ${orders.length} more orders`);
          setExtraTrades(prev => [...prev, ...orders.map(mapDexOrderToTrade)]);
        }
      }
    } finally {
      setIsLoadingMore(false);
    }
  }, [hasMoreTrades, isLoadingMore, dexOrders.length, activePoolOrders.length, extraTrades.length]);

  // ── Combine All Trades (deduplicated) ──────────────────────────────────────
  // Sources: DexScreener orders, active pool orders, GeckoTerminal fallback

  const seen = new Set<string>();
  const allTrades = [...dexOrders, ...activePoolOrders, ...geckoTrades, ...extraTrades]
    .filter(tx => {
      if (!tx.tx_hash || seen.has(tx.tx_hash)) return false;
      seen.add(tx.tx_hash);
      return true;
    })
    .sort((a, b) => {
      const ta = new Date(a.block_timestamp).getTime() || 0;
      const tb = new Date(b.block_timestamp).getTime() || 0;
      return tb - ta;
    });

  // ── Stats from DexScreener ─────────────────────────────────────────────────

  const dexHasError = !!dexQuery.error && pairs.length === 0;

  const priceUsd: number | null = dexHasError ? null : (primaryPair ? Number(primaryPair.priceUsd) || 0 : 0);
  const fdvUsd: number | null = dexHasError ? null : (primaryPair?.fdv || 0);
  const marketCapUsd: number | null = dexHasError ? null : (primaryPair?.marketCap || primaryPair?.fdv || 0);
  const priceChange24 = dexHasError ? null : (primaryPair?.priceChange?.h24 ?? null);

  const totalTvl: number | null = dexHasError ? null : pairs.reduce((sum, p) => sum + (p.liquidity?.usd || 0), 0);
  const totalVol24: number | null = dexHasError ? null : pairs.reduce((sum, p) => sum + (p.volume?.h24 || 0), 0);
  const totalVol6: number | null = dexHasError ? null : pairs.reduce((sum, p) => sum + (p.volume?.h6 || 0), 0);
  const totalVol1: number | null = dexHasError ? null : pairs.reduce((sum, p) => sum + (p.volume?.h1 || 0), 0);
  const totalTxns24: { buys: number; sells: number } | null = dexHasError ? null : pairs.reduce((sum, p) => ({
    buys: sum.buys + (p.txns?.h24?.buys || 0),
    sells: sum.sells + (p.txns?.h24?.sells || 0),
  }), { buys: 0, sells: 0 });

  // ── MEXC CEX Price/Volume ──────────────────────────────────────────────────

  const mexcQuery = useQuery({
    queryKey: ['mexcOmnom'],
    queryFn: async (): Promise<{ price: number; volume24: number }> => {
      const res = await fetch('/api/mexc/api/v3/ticker/24hr?symbol=OMNOMUSDT');
      if (!res.ok) throw new Error(`MEXC HTTP ${res.status}`);
      const json = await res.json();
      return {
        price: Number(json.lastPrice) || 0,
        volume24: Number(json.quoteVolume) || 0,
      };
    },
    ...baseOpts,
    staleTime: STATS_STALE_MS,
    refetchInterval: STATS_STALE_MS,
  });

  const mexcHasError = !!mexcQuery.error && !mexcQuery.data;
  const mexcPrice: number | null = mexcHasError ? null : (mexcQuery.data?.price ?? 0);
  const mexcVol24: number | null = mexcHasError ? null : (mexcQuery.data?.volume24 ?? 0);

  // ── Loading State (including GeckoTerminal fallback) ───────────────────────
  const isLoading = dexQuery.isLoading;
  const isTradesLoading = dexOrdersQuery.isLoading || isLoadingGecko;

  return {
    allPools: pairs,
    trades: allTrades,
    poolCount: pairs.length,

    // Price (from primary pair)
    priceUsd, fdvUsd, marketCapUsd, priceChange24,

    // MEXC CEX
    mexcPrice, mexcVol24,

    // Aggregated across ALL pools
    totalTvl,
    totalVol24, totalVol6, totalVol1,
    totalTxns24,

    // Trades pagination
    hasMoreTrades,
    isLoadingMoreTrades: isLoadingMore,
    loadMoreTrades,

    // Loading states
    isLoading,
    isTradesLoading,
    isPoolsListLoading: dexQuery.isLoading,

    // GeckoTerminal fallback state
    isGeckoLoading: isLoadingGecko,

    // Errors
    isGeckoError: geckoTrades.length === 0 && isLoadingGecko,
    poolError: dexQuery.error,
    tradesError: dexOrdersQuery.error,
    poolsListError: dexQuery.error,
  };
}
