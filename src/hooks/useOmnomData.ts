import { useState, useCallback } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { CONTRACTS, OMNOM_WWDOGE_POOL } from '../lib/constants';

const DEXSCREENER_URL = 'https://api.dexscreener.com/latest/dex/tokens';
const STATS_STALE_MS = 60_000; // 1 min — DexScreener has no rate limits
const DEX_ORDERS_STALE_MS = 60_000; // 1 min for DexScreener orders (free/unlimited)

const TRADES_PAGE_SIZE = 10;

// ── DexScreener-only Strategy (NO GeckoTerminal fallback) ──────────────────────
//
// Primary: DexScreener /orders endpoint (free, unlimited) — fetches recent txs
// Fallback: NONE — GeckoTerminal trades cause 429 rate limit errors
//
// GeckoTerminal trades fallback is DISABLED via feature flag.
// Trades should ONLY come from DexScreener orders endpoint.

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

// ── DexScreener Orders (sole trades source — free/unlimited) ──────────────────

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

  // ── Trades — DexScreener ONLY (no GeckoTerminal fallback) ──────────────────

  const [extraTrades, setExtraTrades] = useState<Trade[]>([]);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  // DexScreener orders query — ONLY source (no rate limits, no fallback)
  const dexOrdersQuery = useQuery({
    queryKey: ['omnomDexOrders'],
    queryFn: async (): Promise<Trade[]> => {
      try {
        const res = await fetch(`${DEXSCREENER_URL}/${CONTRACTS.OMNOM_TOKEN}/orders?chain=dogechain&limit=${TRADES_PAGE_SIZE}`);
        if (res.status === 404) {
          console.log(`[DexOrders] DexScreener returned 404 for OMNOM orders — showing empty trades`);
          return [];
        }
        if (!res.ok) {
          console.log(`[DexOrders] DexScreener returned HTTP ${res.status} — showing empty trades`);
          return [];
        }
        const json: DexOrdersResponse = await res.json();
        const orders = json.orders || [];
        console.log(`[DexOrders] DexScreener fetched ${orders.length} orders for OMNOM`);
        return orders.map(mapDexOrderToTrade);
      } catch (err) {
        console.log(`[DexOrders] DexScreener fetch failed: ${err} — showing empty trades`);
        return [];
      }
    },
    staleTime: DEX_ORDERS_STALE_MS,
    refetchInterval: DEX_ORDERS_STALE_MS, // 60s — DexScreener has no rate limits
  });

  // Multi-pool orders from DexScreener — same primary source
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

  const hasMoreTrades = dexOrders.length === TRADES_PAGE_SIZE;

  const loadMoreTrades = useCallback(async () => {
    if (!hasMoreTrades || isLoadingMore) return;
    setIsLoadingMore(true);
    try {
      // DexScreener only — no GeckoTerminal fallback
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

  // Combine all trades (deduplicated by tx_hash)
  const seen = new Set<string>();
  const trades = [...dexOrders, ...activePoolOrders, ...extraTrades]
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

  // ── Error-aware states ──
  const dexHasError = !!dexQuery.error && pairs.length === 0;

  // ── Stats from DexScreener ──
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

  // ── MEXC CEX price/volume ──
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

  return {
    allPools: pairs,
    trades,
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

    isLoading: dexQuery.isLoading,
    isTradesLoading: dexOrdersQuery.isLoading,
    isPoolsListLoading: dexQuery.isLoading,
    poolError: dexQuery.error,
    tradesError: dexOrdersQuery.error,
    poolsListError: dexQuery.error,
  };
}
