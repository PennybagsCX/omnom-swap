import { useState, useCallback } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { CONTRACTS, OMNOM_WWDOGE_POOL } from '../lib/constants';

const GECKO_BASE = import.meta.env.PROD
  ? 'https://api.geckoterminal.com/api/v2'
  : '/api/gecko';
const DEXSCREENER_URL = 'https://api.dexscreener.com/latest/dex/tokens';
const STATS_STALE_MS = 60_000; // 1 min — DexScreener has no rate limits
const TRADES_STALE_MS = 900_000; // 15 min for GeckoTerminal trades
const TRADES_PAGE_SIZE = 10;

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

  // ── Trades — GeckoTerminal (only remaining GeckoTerminal consumer) ──

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

  // Primary pool trades
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
    staleTime: TRADES_STALE_MS,
    refetchInterval: TRADES_STALE_MS,
  });

  // Multi-pool trades — uses DexScreener pair addresses to find active pools
  const activePoolTradesQuery = useQuery({
    queryKey: ['omnomMultiPoolTrades', pairs.length],
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

      const poolTrades: Trade[] = [];
      for (const pool of activePools) {
        const poolAddr = pool.pairAddress;
        if (!poolAddr) continue;
        try {
          const res = await fetch(`${GECKO_BASE}/networks/dogechain/pools/${poolAddr}/trades?page=1&limit=${TRADES_PAGE_SIZE}`);
          if (res.status === 429) break;
          if (!res.ok) continue;
          const json = await res.json();
          if (!Array.isArray(json.data)) continue;
          poolTrades.push(...json.data.map(mapTrade));
        } catch { /* skip failed pool fetch */ }
      }
      return poolTrades;
    },
    ...baseOpts,
    enabled: pairs.length > 0,
    staleTime: TRADES_STALE_MS,
    refetchInterval: false,
  });

  const initialTrades = tradesQuery.data ?? [];
  const hasMoreTrades = initialTrades.length === TRADES_PAGE_SIZE;

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
    isTradesLoading: tradesQuery.isLoading,
    isPoolsListLoading: dexQuery.isLoading,
    poolError: dexQuery.error,
    tradesError: tradesQuery.error,
    poolsListError: dexQuery.error,
  };
}
