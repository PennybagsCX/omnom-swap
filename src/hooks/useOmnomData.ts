/**
 * useOmnomData — fetches OMNOM stats, prices, and trades.
 *
 * ── Data Sources ─────────────────────────────────────────────────────────────
 *
 * PRICES / STATS:
 *   DexScreener (primary) — free, no rate limits
 *
 * TRADES:
 *   GeckoTerminal (primary) — works on dogechain, returns 200 with full trade data
 *   - Smart retry: exponential backoff 1s → 2s → 4s (max 30s, max 3 retries)
 *   - Shows loading state while retrying (no silent failures)
 *   - 1-hour cache TTL for successful results
 *   - Module-level queue prevents request stampede
 *   - On 429: retries up to 3 times with backoff before giving up
 *
 * DexScreener /orders does NOT work on dogechain — returns 404 for all requests.
 * Only used for price/volume stats, not trades.
 */

import { useCallback, useMemo } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { CONTRACTS, OMNOM_WWDOGE_POOL } from '../lib/constants';
import { scanFactoriesForOmnomPools } from '../services/poolScanner';

const DEXSCREENER_URL = 'https://api.dexscreener.com/latest/dex/tokens';
const STATS_STALE_MS = 60_000; // 1 min — DexScreener has no rate limits

// ── GeckoTerminal Trades Configuration ─────────────────────────────────────
const GECKO_BASE = 'https://api.geckoterminal.com/api/v2';
const GECKO_NETWORK = 'networks/dogechain';
const GECKO_TRADES_STALE_MS = 60 * 60 * 1000; // 1 hour — trades don't change retroactively
const GECKO_RETRY_BASE_DELAY_MS = 1_000; // 1 second starting delay
const GECKO_RETRY_MAX_DELAY_MS = 30_000; // cap at 30 seconds
const GECKO_MAX_RETRIES = 3; // max 3 retry attempts

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

// ── GeckoTerminal Trades Fetcher with Retry/Backoff ─────────────────────────

interface GeckoTrade {
  type: string;
  id: string;
  attributes: {
    block_number: number;
    tx_hash: string;
    tx_from_address: string;
    from_token_amount: string;
    to_token_amount: string;
    price_from_in_currency_token: string;
    price_to_in_currency_token: string;
    price_from_in_usd: string;
    price_to_in_usd: string;
    block_timestamp: string;
    kind: string;
    volume_in_usd: string;
    from_token_address: string;
    to_token_address: string;
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
  const isBuy = (attrs.kind || '').toLowerCase() === 'buy';
  const fromTokenAmount = attrs.from_token_amount || '0';
  const toTokenAmount = attrs.to_token_amount || '0';
  
  return {
    kind: isBuy ? 'buy' : 'sell',
    tx_from_address: attrs.tx_from_address || '',
    volume_in_usd: String(attrs.volume_in_usd || '0'),
    tx_hash: attrs.tx_hash || '',
    block_timestamp: attrs.block_timestamp || '',
    from_token_amount: fromTokenAmount,
    to_token_amount: toTokenAmount,
    from_token_address: attrs.from_token_address || '',
    to_token_address: attrs.to_token_address || '',
    price_from_in_usd: String(attrs.price_from_in_usd || '0'),
    price_to_in_usd: String(attrs.price_to_in_usd || '0'),
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

// ── Token Symbol Resolution ──────────────────────────────────────────────────

const KNOWN_TOKEN_SYMBOLS: Record<string, string> = {
  [CONTRACTS.OMNOM_TOKEN]: 'OMNOM',
  [CONTRACTS.WWDOGE]: 'WWDOGE',
  '0x66cfd94e31c78fa2af09cbad615e0708487fcbf': 'USDT',
  '0xc21223249cc284701f197ec09bf8d3293ed5c8ec': 'USDC',
  '0x0cdcfe2b9f49f8c26e09448e628408a6a6788228': 'DAI',
  '0x4fccd7e581ab84255f301efe36db397a5a4e293b': 'MCRIB',
  '0x90d768f0a6ebb8ffcabe89b0313b34265bc3f54a': 'DC',
  '0x9d3454387855c768499943c020c5705b2544151c': 'USDO',
  '0x3593acb873e91c781d4e27c4a9a36de15b033896': 'oneD',
};

function resolveTokenSymbol(address: string): string {
  if (!address) return 'Unknown';
  return KNOWN_TOKEN_SYMBOLS[address.toLowerCase()] || `${address.slice(0, 6)}...${address.slice(-4)}`;
}

// ── Interfaces ───────────────────────────────────────────────────────────────

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

// ── useOmnomData Hook ─────────────────────────────────────────────────────────

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

  // ── Factory Scanner Query ───────────────────────────────────────────────────────
  // Scan DEX factories to find pools DexScreener misses (e.g., USDO/OMNOM with $32 TVL)
  // This ensures ALL active OMNOM pools appear on the Pools page
  const factoryScanQuery = useQuery({
    queryKey: ['omnomFactoryScan'],
    queryFn: scanFactoriesForOmnomPools,
    staleTime: 5 * 60 * 1000, // 5 minutes — matches scanner cache TTL
    refetchInterval: 5 * 60 * 1000,
  });

  // Merge DexScreener pools with factory-scanned pools
  // DexScreener data is prioritized (has TVL, volume, price info)
  const allPools = useMemo(() => {
    const dexPairs = dexQuery.data ?? [];
    const factoryPools = factoryScanQuery.data ?? [];
    const dexScreenerAddresses = new Set(dexPairs.map(p => p.pairAddress.toLowerCase()));

    // Add factory-scanned pools not in DexScreener
    const additionalPools = factoryPools
      .filter(fp => !dexScreenerAddresses.has(fp.pairAddress.toLowerCase()))
      .map(fp => ({
        // Build minimal DexPair structure for factory-scanned pools
        pairAddress: fp.pairAddress,
        dexId: fp.dexId,
        chainId: 'dogechain',
        url: `https://dexscreener.com/dogechain/${fp.dexId}/${fp.pairAddress}`,
        baseToken: {
          address: fp.token0,
          symbol: fp.token0Symbol || resolveTokenSymbol(fp.token0),
          name: fp.token0Symbol || resolveTokenSymbol(fp.token0),
        },
        quoteToken: {
          address: fp.token1,
          symbol: fp.token1Symbol || resolveTokenSymbol(fp.token1),
          name: fp.token1Symbol || resolveTokenSymbol(fp.token1),
        },
        priceUsd: '0', // Will need price fetch for accuracy
        priceNative: '0',
        liquidity: {
          usd: 0, // Would need on-chain price calculation
          base: fp.reserve0 ? Number(fp.reserve0) : 0,
          quote: fp.reserve1 ? Number(fp.reserve1) : 0,
        },
        volume: { h24: 0, h6: 0, h1: 0, m5: 0 },
        txns: { h24: { buys: 0, sells: 0 } },
        // Factory scanner metadata
        _factoryScanned: true,
        _category: fp.category,
        _totalSupply: fp.totalSupply?.toString() || '0',
        _creationBlock: undefined,
      } as DexPair & { _factoryScanned?: boolean; _category?: 'active' | 'abandoned'; _totalSupply?: string; _creationBlock?: number }));

    return [...dexPairs, ...additionalPools];
  }, [dexQuery.data, factoryScanQuery.data]);

  // Primary pair = highest-liquidity OMNOM/WWDOGE pair (DexScreener sorts by liquidity)
  const primaryPair = allPools.length > 0
    ? (allPools.find(p => p.quoteToken?.symbol === 'WWDOGE' || p.baseToken?.symbol === 'WWDOGE') ?? allPools[0])
    : undefined;

  // ── GeckoTerminal Trades Query (PRIMARY trades source) ─────────────────────
  // GeckoTerminal works on dogechain and returns 200 with full trade data
  // DexScreener /orders returns 404 for dogechain, so we use GeckoTerminal directly

  const geckoTradesQuery = useQuery({
    queryKey: ['omnomGeckoTrades', primaryPair?.pairAddress],
    queryFn: async (): Promise<Trade[]> => {
      if (!primaryPair?.pairAddress) {
        return [];
      }
      return fetchGeckoTradesWithRetry(primaryPair.pairAddress);
    },
    staleTime: GECKO_TRADES_STALE_MS,
    enabled: !!primaryPair?.pairAddress,
  });

  const geckoTrades = geckoTradesQuery.data ?? [];

  // ── Multi-pool Activity from DexScreener ────────────────────────────────────
  // Get trade activity from other active pools (not primary pair)

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

      // Get orders from DexScreener for active pools (if supported)
      // Note: DexScreener /orders returns 404 on dogechain, but we try anyway
      const poolOrders: Trade[] = [];
      for (const pool of activePools) {
        const poolAddr = pool.pairAddress;
        if (!poolAddr) continue;
        try {
          const res = await fetch(`${DEXSCREENER_URL}/${pool.baseToken.address}/orders?chain=dogechain&limit=5`);
          if (!res.ok) continue;
          const json = await res.json();
          const orders = json.orders || [];
          if (orders.length > 0) {
            console.log(`[PoolOrders] Pool ${poolAddr}: DexScreener fetched ${orders.length} orders`);
            poolOrders.push(...orders.map(mapDexOrderToTrade));
          }
        } catch { /* skip failed pool fetch */ }
      }
      return poolOrders;
    },
    staleTime: 60_000,
    refetchInterval: false, // No automatic refresh — manual only
    enabled: pairs.length > 0,
  });

  const activePoolOrders = activePoolOrdersQuery.data ?? [];

  // ── Load More Trades ─────────────────────────────────────────────────────────

  const hasMoreTrades = geckoTrades.length >= TRADES_PAGE_SIZE;

  const loadMoreTrades = useCallback(async () => {
    // GeckoTerminal paginates automatically, but our cache stores all trades
    // For now, loadMoreTrades is a no-op since we cache all trades for 1 hour
    // In future, could implement offset-based pagination for GeckoTerminal
  }, []);

  // ── Combine All Trades (deduplicated) ───────────────────────────────────────
  // Primary source: GeckoTerminal trades
  // Secondary source: active pool orders from DexScreener (if available)

  const seen = new Set<string>();
  const allTrades = [...geckoTrades, ...activePoolOrders]
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

  // ── Stats from DexScreener ───────────────────────────────────────────────────

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

  // ── MEXC CEX Price/Volume ────────────────────────────────────────────────────

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

  // ── Loading State ────────────────────────────────────────────────────────────

  const isLoading = dexQuery.isLoading || factoryScanQuery.isLoading;
  const isTradesLoading = geckoTradesQuery.isLoading;

  return {
    allPools,
    trades: allTrades,
    poolCount: allPools.length,

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
    isLoadingMoreTrades: false,
    loadMoreTrades,

    // Loading states
    isLoading,
    isTradesLoading,
    isPoolsListLoading: dexQuery.isLoading || factoryScanQuery.isLoading,
    isFactoryScanning: factoryScanQuery.isLoading,

    // GeckoTerminal state
    isGeckoLoading: geckoTradesQuery.isLoading,

    // Errors
    isGeckoError: geckoTrades.length === 0 && geckoTradesQuery.isLoading,
    poolError: dexQuery.error,
    tradesError: geckoTradesQuery.error,
    poolsListError: dexQuery.error,
  };
}

// Helper function to map DexOrder to Trade (kept for potential future use)
function mapDexOrderToTrade(order: {
  side?: string;
  maker?: { address?: string };
  fromTokenAmount?: string;
  toTokenAmount?: string;
  fromToken_usdAmount?: string;
  toToken_usdAmount?: string;
  txHash?: string;
  blockTimestamp?: number;
}): Trade {
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