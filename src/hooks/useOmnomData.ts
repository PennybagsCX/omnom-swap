import { useState, useCallback } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { CONTRACTS, OMNOM_WWDOGE_POOL } from '../lib/constants';

// GeckoTerminal blocks HTTP origins (localhost) and Vercel datacenter IPs.
// In production (HTTPS), call GeckoTerminal directly — CORS is allowed for HTTPS origins.
// In development (HTTP localhost), route through the Vite dev server proxy.
const GECKO_BASE = import.meta.env.PROD
  ? 'https://api.geckoterminal.com/api/v2'
  : '/api/gecko';
const SLOW_STALE = 600_000; // 10 min for heavy endpoints
const FAST_STALE = 300_000; // 5 min for primary pool
const TRADES_PAGE_SIZE = 10;

export interface PoolTxns {
  buys: number; sells: number; buyers: number; sellers: number;
}

export interface PoolData {
  base_token_price_usd: string;
  quote_token_price_usd: string;
  volume_usd: { m5: string; m15: string; m30: string; h1: string; h6: string; h24: string };
  transactions: { m5: PoolTxns; m15: PoolTxns; m30: PoolTxns; h1: PoolTxns; h6: PoolTxns; h24: PoolTxns };
  price_change_percentage: { m5: string; m15: string; m30: string; h1: string; h6: string; h24: string };
  reserve_in_usd: string;
  fdv_usd: string;
  market_cap_usd: string;
  name: string;
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

interface PoolListItem {
  attributes: {
    address: string;
    reserve_in_usd: string;
    volume_usd: { h24: string; h6: string; h1: string };
    transactions: { h24: { buys: number; sells: number }; h6: { buys: number; sells: number }; h1: { buys: number; sells: number } };
    [key: string]: unknown;
  };
}

const baseOpts = {
  retry: (failureCount: number, error: Error) => {
    // Retry up to 3 times for 429 rate limits or network errors
    if (failureCount >= 3) return false;
    const msg = error.message || '';
    return msg.includes('429') || msg.includes('HTTP 429') || msg.includes('Failed to fetch');
  },
  retryDelay: (attempt: number) => Math.min(1000 * 2 ** attempt, 10000), // 1s, 2s, 4s
  placeholderData: keepPreviousData,
  refetchOnWindowFocus: false,
  refetchOnReconnect: true,
} as const;

export function useOmnomData() {
  // Primary pool — fast, critical for price
  const poolQuery = useQuery({
    queryKey: ['omnomPool'],
    queryFn: async (): Promise<PoolData> => {
      const res = await fetch(`${GECKO_BASE}/networks/dogechain/pools/${OMNOM_WWDOGE_POOL}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      return json.data.attributes;
    },
    ...baseOpts,
    staleTime: FAST_STALE,
    refetchInterval: FAST_STALE,
  });

  const p = poolQuery.data;

  // All pools list — aggregates TVL/volume/txns across ALL DEXes
  // Fetches ALL pages from GeckoTerminal (pagination-aware) so no pools are missed
  const POOLS_REFETCH_INTERVAL = 60_000; // 60s — conservative to avoid 429 rate limits
  const poolsListQuery = useQuery({
    queryKey: ['omnomPoolsList'],
    queryFn: async (): Promise<PoolListItem[]> => {
      const allPools: PoolListItem[] = [];
      let page = 1;
      const limit = 30;
      let lastPage = 1;

      // Fetch pages sequentially until we've fetched the last page
      do {
        const res = await fetch(`${GECKO_BASE}/networks/dogechain/tokens/${CONTRACTS.OMNOM_TOKEN}/pools?page=${page}&limit=${limit}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        if (Array.isArray(json.data)) {
          allPools.push(...json.data);
        }
        // GeckoTerminal pagination: meta.page.last indicates the last page number
        const metaLast = json.meta?.page?.last;
        if (typeof metaLast === 'number' && metaLast > lastPage) {
          lastPage = metaLast;
        }
        page++;
      } while (page <= lastPage);

      return allPools;
    },
    ...baseOpts,
    enabled: !!p, // only fetch after primary pool loads
    staleTime: SLOW_STALE,
    refetchInterval: POOLS_REFETCH_INTERVAL,
  });

  // All pools — needed early for multi-pool trades and aggregation
  const allPools = poolsListQuery.data ?? [];

  // Trades — recent transactions with pagination
  const [extraTrades, setExtraTrades] = useState<Trade[]>([]);
  const [nextTradesPage, setNextTradesPage] = useState(2);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  const mapTrade = useCallback((t: { attributes: Record<string, string | number> }): Trade => ({
    kind: String(t.attributes.kind || ''),
    tx_from_address: String(t.attributes.tx_from_address || ''),
    volume_in_usd: String(t.attributes.volume_in_usd || '0'),
    tx_hash: String(t.attributes.tx_hash || ''),
    block_timestamp: String(t.attributes.block_timestamp || ''),
    from_token_amount: String(t.attributes.from_token_amount || '0'),
    to_token_amount: String(t.attributes.to_token_amount || '0'),
    from_token_address: String(t.attributes.from_token_address || ''),
    to_token_address: String(t.attributes.to_token_address || ''),
    price_from_in_usd: String(t.attributes.price_from_in_usd || '0'),
    price_to_in_usd: String(t.attributes.price_to_in_usd || '0'),
    ...t.attributes,
  }), []);

  const tradesQuery = useQuery({
    queryKey: ['omnomTrades'],
    queryFn: async (): Promise<Trade[]> => {
      const res = await fetch(`${GECKO_BASE}/networks/dogechain/pools/${OMNOM_WWDOGE_POOL}/trades?page=1&limit=${TRADES_PAGE_SIZE}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (!Array.isArray(json.data)) return [];
      return json.data.map(mapTrade);
    },
    ...baseOpts,
    staleTime: FAST_STALE,
    refetchInterval: FAST_STALE,
  });

  // Multi-pool trades — fetch from other active pools to show all transactions
  // Uses staggered delays and 429 backoff to respect GeckoTerminal rate limits (30 calls/min)
  const activePoolTradesQuery = useQuery({
    queryKey: ['omnomMultiPoolTrades', allPools.length],
    queryFn: async (): Promise<Trade[]> => {
      const primaryPoolAddr = OMNOM_WWDOGE_POOL.toLowerCase();
      const activePools = allPools.filter(pl => {
        const txns = (pl.attributes.transactions?.h24?.buys || 0) + (pl.attributes.transactions?.h24?.sells || 0);
        return txns > 0 && pl.attributes.address?.toLowerCase() !== primaryPoolAddr;
      });
      const topPools = [...activePools]
        .sort((a, b) => {
          const aT = (a.attributes.transactions?.h24?.buys || 0) + (a.attributes.transactions?.h24?.sells || 0);
          const bT = (b.attributes.transactions?.h24?.buys || 0) + (b.attributes.transactions?.h24?.sells || 0);
          return bT - aT;
        })
        .slice(0, 3);
      const poolTrades: Trade[] = [];
      for (let i = 0; i < topPools.length; i++) {
        const pool = topPools[i];
        const poolAddr = pool.attributes.address;
        if (!poolAddr) continue;
        // 500ms stagger between requests to avoid rate limit
        if (i > 0) await new Promise(r => setTimeout(r, 500));
        try {
          const res = await fetch(`${GECKO_BASE}/networks/dogechain/pools/${poolAddr}/trades?page=1&limit=${TRADES_PAGE_SIZE}`);
          if (res.status === 429) {
            // Rate limited — wait 2s and retry once
            await new Promise(r => setTimeout(r, 2000));
            const retry = await fetch(`${GECKO_BASE}/networks/dogechain/pools/${poolAddr}/trades?page=1&limit=${TRADES_PAGE_SIZE}`);
            if (!retry.ok) continue;
            const json = await retry.json();
            if (!Array.isArray(json.data)) continue;
            poolTrades.push(...json.data.map(mapTrade));
            continue;
          }
          if (!res.ok) continue;
          const json = await res.json();
          if (!Array.isArray(json.data)) continue;
          poolTrades.push(...json.data.map(mapTrade));
        } catch { /* skip failed pool fetch */ }
      }
      return poolTrades;
    },
    ...baseOpts,
    enabled: allPools.length > 0,
    staleTime: SLOW_STALE,
    refetchInterval: false,
  });

  const initialTrades = tradesQuery.data ?? [];
  const hasMoreTrades = initialTrades.length === TRADES_PAGE_SIZE;
  const isLoadingMoreTrades = isLoadingMore;

  const loadMoreTrades = useCallback(async () => {
    if (!hasMoreTrades || isLoadingMore) return;
    setIsLoadingMore(true);
    try {
      const res = await fetch(`${GECKO_BASE}/networks/dogechain/pools/${OMNOM_WWDOGE_POOL}/trades?page=${nextTradesPage}&limit=${TRADES_PAGE_SIZE}`);
      if (!res.ok) return;
      const json = await res.json();
      if (!Array.isArray(json.data)) return;
      const newTrades = json.data.map(mapTrade);
      setExtraTrades(prev => [...prev, ...newTrades]);
      setNextTradesPage(prev => prev + 1);
    } finally {
      setIsLoadingMore(false);
    }
  }, [hasMoreTrades, isLoadingMore, nextTradesPage, mapTrade]);

  const otherPoolTrades = activePoolTradesQuery.data ?? [];
  const seen = new Set<string>();
  const trades = [...initialTrades, ...otherPoolTrades, ...extraTrades]
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

  // ── Error-aware states — null when query errored with no data ──
  const poolHasError = !!poolQuery.error && !p;
  const poolsListHasError = !!poolsListQuery.error && allPools.length === 0;

  // ── Aggregated stats across ALL pools ──
  const totalTvl: number | null = poolsListHasError ? null : allPools.reduce((sum, pl) => sum + (Number(pl.attributes.reserve_in_usd) || 0), 0);
  const totalVol24: number | null = poolsListHasError ? null : allPools.reduce((sum, pl) => sum + (Number(pl.attributes.volume_usd?.h24) || 0), 0);
  const totalVol6: number | null = poolsListHasError ? null : allPools.reduce((sum, pl) => sum + (Number(pl.attributes.volume_usd?.h6) || 0), 0);
  const totalVol1: number | null = poolsListHasError ? null : allPools.reduce((sum, pl) => sum + (Number(pl.attributes.volume_usd?.h1) || 0), 0);
  const totalTxns24: { buys: number; sells: number } | null = poolsListHasError ? null : allPools.reduce((sum, pl) => ({
    buys: sum.buys + (pl.attributes.transactions?.h24?.buys || 0),
    sells: sum.sells + (pl.attributes.transactions?.h24?.sells || 0),
  }), { buys: 0, sells: 0 });

  // ── Price from primary pool ──
  const priceUsd: number | null = poolHasError ? null : (p ? Number(p.base_token_price_usd) || 0 : 0);
  const fdvUsd: number | null = poolHasError ? null : (p ? Number(p.fdv_usd) || 0 : 0);
  const marketCapUsd: number | null = poolHasError ? null : (p ? Number(p.market_cap_usd) || 0 : 0);
  const priceChange24 = poolHasError ? null : (p?.price_change_percentage?.h24 ? parseFloat(p.price_change_percentage.h24) : null);

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
    staleTime: FAST_STALE,
    refetchInterval: FAST_STALE,
  });

  const mexcHasError = !!mexcQuery.error && !mexcQuery.data;
  const mexcPrice: number | null = mexcHasError ? null : (mexcQuery.data?.price ?? 0);
  const mexcVol24: number | null = mexcHasError ? null : (mexcQuery.data?.volume24 ?? 0);

  return {
    pool: p,
    allPools,
    trades,
    poolCount: allPools.length,

    // Price (from primary pool)
    priceUsd, fdvUsd, marketCapUsd, priceChange24,

    // MEXC CEX
    mexcPrice, mexcVol24,

    // Aggregated across ALL pools
    totalTvl,
    totalVol24, totalVol6, totalVol1,
    totalTxns24,

    // Trades pagination
    hasMoreTrades,
    isLoadingMoreTrades,
    loadMoreTrades,

    isLoading: poolQuery.isLoading,
    isTradesLoading: tradesQuery.isLoading,
    isPoolsListLoading: poolsListQuery.isLoading,
    poolError: poolQuery.error,
    tradesError: tradesQuery.error,
    poolsListError: poolsListQuery.error,
  };
}
