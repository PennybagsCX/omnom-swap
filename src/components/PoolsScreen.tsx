import { useState, useMemo } from 'react';
import { ExternalLink, Droplets, PawPrint, AlertTriangle, Plus, Minus, Filter, ChevronUp, ChevronDown } from 'lucide-react';
import { NETWORK_INFO, calcPriceImpact, impactColor, resolveDexName } from '../lib/constants';
import { useOmnomData, type DexPair } from '../hooks/useOmnomData';
import { useNewPairMonitor } from '../hooks/useNewPairMonitor';
import { LiquidityModal } from './LiquidityModal';
import { formatCompactPrice } from '../lib/format';

const fmtUsd = formatCompactPrice;

const LOW_TVL_THRESHOLD = 500; // Pools below $500 TVL flagged as low-liquidity

type PoolCategory = 'all' | 'active' | 'inactive';

const CATEGORY_CONFIG: Record<PoolCategory, { label: string; color: string; bgColor: string; borderColor: string }> = {
  all: { label: 'All', color: 'text-white', bgColor: 'bg-surface-container-low', borderColor: 'border-outline-variant/30' },
  active: { label: 'Active', color: 'text-green-400', bgColor: 'bg-green-900/20', borderColor: 'border-green-500/30' },
  inactive: { label: 'Inactive', color: 'text-red-400', bgColor: 'bg-red-900/20', borderColor: 'border-red-500/30' },
};

function pctChange(val: number | undefined | null): { text: string; color: string } {
  if (val == null) return { text: '\u2014', color: 'text-on-surface-variant' };
  const n = val;
  const sign = n >= 0 ? '+' : '';
  return { text: `${sign}${n.toFixed(2)}%`, color: n >= 0 ? 'text-green-400' : 'text-red-400' };
}

export function PoolsScreen() {
  // Monitor on-chain PairCreated events for instant new-pool detection
  useNewPairMonitor();

  const {
    totalTvl, totalVol24, totalTxns24, poolCount,
    allPools,
    isPoolsListLoading, poolsListError,
  } = useOmnomData();

  // Category filter state
  const [categoryFilter, setCategoryFilter] = useState<PoolCategory>('all');

  // Sort state
  type SortColumn = 'tvl' | 'volume24h' | 'change24h' | 'txns24h' | 'price' | 'impact';
  const [sortColumn, setSortColumn] = useState<SortColumn | ''>('');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');

  // Filter pools by category
  const filteredPools = useMemo(() => {
    if (categoryFilter === 'all') return allPools as DexPair[];
    return (allPools as DexPair[]).filter(pool => {
      const category = (pool as DexPair & { _category?: 'active' | 'inactive' })._category;
      return category === categoryFilter;
    });
  }, [allPools, categoryFilter]);

  // Sort handler
  const handleSort = (column: SortColumn) => {
    if (sortColumn === column) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(column);
      setSortDirection('desc');
    }
  };

  // Sort indicator component
  const SortIndicator = ({ column }: { column: SortColumn }) => {
    if (sortColumn !== column) return null;
    return sortDirection === 'asc' ? <ChevronUp className="w-3 h-3 inline ml-1" /> : <ChevronDown className="w-3 h-3 inline ml-1" />;
  };

  // Sorted pools
  const sortedPools = useMemo(() => {
    if (!sortColumn) return filteredPools;
    return [...filteredPools].sort((a, b) => {
      const aTvl = a.liquidity?.usd || 0;
      const bTvl = b.liquidity?.usd || 0;
      const aVol24 = a.volume?.h24 || 0;
      const bVol24 = b.volume?.h24 || 0;
      const aChange = a.priceChange?.h24 ?? 0;
      const bChange = b.priceChange?.h24 ?? 0;
      const aTxns = (a.txns?.h24?.buys || 0) + (a.txns?.h24?.sells || 0);
      const bTxns = (b.txns?.h24?.buys || 0) + (b.txns?.h24?.sells || 0);
      const aPrice = parseFloat(a.priceUsd || '0');
      const bPrice = parseFloat(b.priceUsd || '0');
      const aImpact = aTvl > 0 ? calcPriceImpact(100, aTvl / 2) : 0;
      const bImpact = bTvl > 0 ? calcPriceImpact(100, bTvl / 2) : 0;

      let compare = 0;
      switch (sortColumn) {
        case 'tvl':
          compare = aTvl - bTvl;
          break;
        case 'volume24h':
          compare = aVol24 - bVol24;
          break;
        case 'change24h':
          compare = aChange - bChange;
          break;
        case 'txns24h':
          compare = aTxns - bTxns;
          break;
        case 'price':
          compare = aPrice - bPrice;
          break;
        case 'impact':
          compare = aImpact - bImpact;
          break;
      }

      return sortDirection === 'asc' ? compare : -compare;
    });
  }, [filteredPools, sortColumn, sortDirection]);

  const pools = sortedPools;

  const [lpModal, setLpModal] = useState<{
    open: boolean;
    mode: 'add' | 'remove';
    pairAddress: string;
    poolName: string;
    dexId: string;
    tvl: number;
  }>({ open: false, mode: 'add', pairAddress: '', poolName: '', dexId: '', tvl: 0 });

  const openLpModal = (mode: 'add' | 'remove', pairAddress: string, poolName: string, dexId: string, tvl: number) => {
    setLpModal({ open: true, mode, pairAddress, poolName, dexId, tvl });
  };

  const closeLpModal = () => {
    setLpModal(prev => ({ ...prev, open: false }));
  };

  const isRateLimited = !!poolsListError;
  const txns24Total = totalTxns24 ? totalTxns24.buys + totalTxns24.sells : null;
  const hasError = !!poolsListError;

  return (
    <div className="max-w-6xl mx-auto w-full px-4">
      <div className="flex items-center gap-3 mb-8">
        <PawPrint className="w-6 h-6 text-primary" />
        <h2 className="font-headline font-black text-3xl tracking-tighter uppercase text-white">The Feeding Grounds</h2>
      </div>

      {/* Summary cards — aggregated across ALL pools */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <div className="bg-surface-container-low p-4 border-l-2 border-primary text-center flex flex-col items-center justify-center">
          <p className="text-[10px] font-headline uppercase text-on-surface-variant mb-1">Pool TVL</p>
          <p className="font-headline font-bold text-white text-xl">{fmtUsd(totalTvl)}</p>
        </div>
        <div className="bg-surface-container-low p-4 border-l-2 border-secondary text-center flex flex-col items-center justify-center">
          <p className="text-[10px] font-headline uppercase text-on-surface-variant mb-1">24H Volume</p>
          <p className="font-headline font-bold text-white text-xl">{fmtUsd(totalVol24)}</p>
        </div>
        <div className="bg-surface-container-low p-4 border-l-2 border-green-400 text-center flex flex-col items-center justify-center">
          <p className="text-[10px] font-headline uppercase text-on-surface-variant mb-1">24H Txns</p>
          <p className="font-headline font-bold text-white text-xl">{txns24Total !== null ? txns24Total.toLocaleString() : '\u2014'}</p>
          <div className="flex gap-2 mt-1 justify-center">
            <span className="text-[10px] text-green-400">{totalTxns24 ? totalTxns24.buys : '\u2014'} buys</span>
            <span className="text-[10px] text-on-surface-variant">/</span>
            <span className="text-[10px] text-red-400">{totalTxns24 ? totalTxns24.sells : '\u2014'} sells</span>
          </div>
        </div>
        <div className="bg-surface-container-low p-4 border-l-2 border-outline-variant text-center flex flex-col items-center justify-center">
          <p className="text-[10px] font-headline uppercase text-on-surface-variant mb-1">On-Chain Pools</p>
          <p className="font-headline font-bold text-white text-xl">{poolCount ? poolCount : '\u2014'}</p>
        </div>
      </div>

      {/* Category filter toggle */}
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-3">
          <Filter className="w-4 h-4 text-on-surface-variant" />
          <span className="text-[10px] font-headline uppercase text-on-surface-variant tracking-widest">Filter by Status</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {(Object.keys(CATEGORY_CONFIG) as PoolCategory[]).map(cat => {
            const config = CATEGORY_CONFIG[cat];
            const isActive = categoryFilter === cat;
            const count = cat === 'all' ? poolCount : (allPools as DexPair[]).filter(p => {
              const category = (p as DexPair & { _category?: 'active' | 'inactive' })._category;
              if (!category) return cat === 'active' && (p.liquidity?.usd || 0) > 0;
              return category === cat;
            }).length;

            return (
              <button
                key={cat}
                onClick={() => setCategoryFilter(cat)}
                className={`px-3 py-1.5 text-[10px] font-headline font-bold uppercase tracking-wider border transition-all ${isActive ? config.color + ' ' + config.bgColor + ' ' + config.borderColor : 'text-on-surface-variant bg-surface-container-low border-outline-variant/30 hover:border-outline-variant'}`}
              >
                {config.label} ({count})
              </button>
            );
          })}
        </div>
      </div>

      {/* Rate limit warning */}
      {hasError && isRateLimited && pools.length === 0 && (
        <div className="mb-6 flex items-center justify-center bg-yellow-900/20 border border-yellow-500/30 p-4 text-center">
          <AlertTriangle className="w-5 h-5 text-yellow-400 shrink-0 mr-2" />
          <div>
            <p className="text-yellow-400 font-headline uppercase tracking-widest text-sm">Pool list temporarily unavailable</p>
            <p className="text-yellow-400/60 text-xs mt-0.5">API rate limit reached — summary data above is live.</p>
          </div>
        </div>
      )}

      {hasError && pools.length > 0 && (
        <div className="mb-4 flex items-center justify-center gap-2 bg-yellow-900/20 border border-yellow-500/30 p-3 text-center">
          <AlertTriangle className="w-4 h-4 text-yellow-400 shrink-0" />
          <span className="text-yellow-400 text-xs font-headline uppercase tracking-widest">Showing cached pool list — will refresh automatically</span>
        </div>
      )}

      {isPoolsListLoading && pools.length === 0 && (
        <div className="flex items-center justify-center py-12">
          <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          <span className="ml-3 font-headline text-on-surface-variant uppercase tracking-widest text-xs">Loading pool list...</span>
        </div>
      )}

      {!isPoolsListLoading && !hasError && pools.length === 0 && (
        <div className="text-center py-12 text-on-surface-variant">
          <Droplets className="w-10 h-10 mx-auto mb-3 opacity-20" />
          <p className="font-headline uppercase tracking-widest text-xs">No additional pools found</p>
        </div>
      )}

      {pools.length > 0 && (
        <>
          {/* Mobile card layout */}
          <div className="md:hidden space-y-3">
            {pools.map((pool, i) => {
              const dexId = pool.dexId || '';
              const tvl = pool.liquidity?.usd || 0;
              const pVol24 = pool.volume?.h24 || 0;
              const change = pctChange(pool.priceChange?.h24);
              const pTxns = (pool.txns?.h24?.buys || 0) + (pool.txns?.h24?.sells || 0);
              const price = parseFloat(pool.priceUsd || '0');
              const poolName = `${pool.baseToken?.symbol || '?'}/${pool.quoteToken?.symbol || '?'}`;
              const refImpact = tvl > 0 ? calcPriceImpact(100, tvl / 2) : 0;
              const poolCategory = (pool as DexPair & { _category?: 'active' | 'inactive' })._category;

              return (
                <div key={pool.pairAddress} className={`bg-surface-container-low border border-outline-variant/15 p-4 ${i === 0 ? 'border-l-4 border-l-primary bg-primary/5' : ''}`}>
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2 flex-wrap">
                      {i === 0 && <span className="text-[8px] font-headline font-bold text-primary bg-primary/10 border border-primary/20 px-1">PRIMARY</span>}
                      {(() => {
                        const badge = poolCategory || (tvl > 0 ? 'active' : null);
                        if (!badge) return null;
                        const cfg = CATEGORY_CONFIG[badge as 'active' | 'inactive' | 'all'];
                        return (
                          <span className={`text-[8px] font-headline font-bold px-1 ${cfg.color} ${cfg.bgColor} border ${cfg.borderColor}`}>
                            {badge.toUpperCase()}
                          </span>
                        );
                      })()}
                      <span className="font-headline font-bold text-white text-sm">{poolName}</span>
                      {tvl > 0 && tvl < LOW_TVL_THRESHOLD && (
                        <span className="relative group">
                          <span className="flex items-center gap-1 text-[8px] font-headline font-bold text-yellow-400 bg-yellow-900/20 border border-yellow-500/30 px-1.5 py-0.5 cursor-help">
                            <AlertTriangle className="w-2.5 h-2.5" />
                            LOW LIQ
                          </span>
                          <span className="absolute left-0 top-full mt-1 z-50 hidden group-hover:block bg-surface-container-low border border-yellow-500/30 px-2 py-1.5 text-[9px] font-headline text-yellow-400 whitespace-nowrap shadow-lg">
                            Low liquidity — increase slippage to 3%+
                          </span>
                        </span>
                      )}
                    </div>
                    <span className="font-headline text-[10px] uppercase text-on-surface-variant">{resolveDexName(dexId)}</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 mb-3 text-xs">
                    <div>
                      <span className="text-on-surface-variant font-headline uppercase text-[9px] block">TVL</span>
                      <span className={`font-headline font-bold ${tvl > 0 && tvl < LOW_TVL_THRESHOLD ? 'text-yellow-400' : 'text-white'}`}>{fmtUsd(tvl)}</span>
                    </div>
                    <div>
                      <span className="text-on-surface-variant font-headline uppercase text-[9px] block">24H Vol</span>
                      <span className="font-headline font-bold text-white">{fmtUsd(pVol24)}</span>
                    </div>
                    <div>
                      <span className="text-on-surface-variant font-headline uppercase text-[9px] block">24H Chg</span>
                      <span className={`font-headline font-bold ${change.color}`}>{change.text}</span>
                    </div>
                    <div>
                      <span className="text-on-surface-variant font-headline uppercase text-[9px] block">Txns</span>
                      <span className="font-headline font-bold text-white">{pTxns}</span>
                    </div>
                    <div>
                      <span className="text-on-surface-variant font-headline uppercase text-[9px] block">Price</span>
                      <span className="font-headline font-bold text-primary">{fmtUsd(price)}</span>
                    </div>
                    {refImpact > 0 && (
                      <div>
                        <span className="text-on-surface-variant font-headline uppercase text-[9px] block">Impact ($100)</span>
                        <span className={`font-headline font-bold ${impactColor(refImpact)}`}>~{(refImpact * 100).toFixed(2)}%</span>
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2 pt-2 border-t border-outline-variant/10">
                    <button
                      onClick={() => openLpModal('add', pool.pairAddress, poolName, dexId, tvl)}
                      className="flex items-center gap-1.5 px-3 py-2 text-[10px] font-headline font-bold uppercase tracking-widest text-primary bg-primary/10 border border-primary/20 hover:bg-primary hover:text-black transition-colors cursor-pointer whitespace-nowrap"
                    >
                      <Plus className="w-3 h-3" />
                      Add LP
                    </button>
                    <button
                      onClick={() => openLpModal('remove', pool.pairAddress, poolName, dexId, tvl)}
                      className="flex items-center gap-1.5 px-3 py-2 text-[10px] font-headline font-bold uppercase tracking-widest text-secondary bg-secondary/10 border border-secondary/20 hover:bg-secondary hover:text-white transition-colors cursor-pointer whitespace-nowrap"
                    >
                      <Minus className="w-3 h-3" />
                      Withdraw
                    </button>
                    <div className="flex-1" />
                    <a
                      href={`${NETWORK_INFO.blockExplorer}/address/${pool.pairAddress}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-on-surface-variant hover:text-primary transition-colors p-2"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Desktop table */}
          <div className="hidden md:block bg-surface-container-low border border-outline-variant/15 overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-outline-variant/20">
                  <th className="font-headline text-[10px] uppercase tracking-widest text-on-surface-variant px-4 py-3">Pool</th>
                  <th className="font-headline text-[10px] uppercase tracking-widest text-on-surface-variant px-4 py-3">DEX</th>
                  <th onClick={() => handleSort('tvl')} className="font-headline text-[10px] uppercase tracking-widest text-on-surface-variant px-4 py-3 text-right cursor-pointer hover:text-primary transition-colors">
                    TVL <SortIndicator column="tvl" />
                  </th>
                  <th onClick={() => handleSort('volume24h')} className="font-headline text-[10px] uppercase tracking-widest text-on-surface-variant px-4 py-3 text-right cursor-pointer hover:text-primary transition-colors">
                    24H Vol <SortIndicator column="volume24h" />
                  </th>
                  <th onClick={() => handleSort('change24h')} className="font-headline text-[10px] uppercase tracking-widest text-on-surface-variant px-4 py-3 text-right cursor-pointer hover:text-primary transition-colors">
                    24H Change <SortIndicator column="change24h" />
                  </th>
                  <th onClick={() => handleSort('txns24h')} className="font-headline text-[10px] uppercase tracking-widest text-on-surface-variant px-4 py-3 text-right cursor-pointer hover:text-primary transition-colors">
                    24H Txns <SortIndicator column="txns24h" />
                  </th>
                  <th onClick={() => handleSort('price')} className="font-headline text-[10px] uppercase tracking-widest text-on-surface-variant px-4 py-3 text-right cursor-pointer hover:text-primary transition-colors">
                    Price <SortIndicator column="price" />
                  </th>
                  <th onClick={() => handleSort('impact')} className="font-headline text-[10px] uppercase tracking-widest text-on-surface-variant px-4 py-3 text-right cursor-pointer hover:text-primary transition-colors">
                    Impact ($100) <SortIndicator column="impact" />
                  </th>
                  <th className="px-4 py-3 text-center">Actions</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {pools.map((pool, i) => {
                  const dexId = pool.dexId || '';
                  const tvl = pool.liquidity?.usd || 0;
                  const pVol24 = pool.volume?.h24 || 0;
                  const change = pctChange(pool.priceChange?.h24);
                  const pTxns = (pool.txns?.h24?.buys || 0) + (pool.txns?.h24?.sells || 0);
                  const price = parseFloat(pool.priceUsd || '0');
                  const poolName = `${pool.baseToken?.symbol || '?'}/${pool.quoteToken?.symbol || '?'}`;
                  const refImpact = tvl > 0 ? calcPriceImpact(100, tvl / 2) : 0;
                  const poolCategory = (pool as DexPair & { _category?: 'active' | 'inactive' })._category;

                  return (
                    <tr key={pool.pairAddress} className={`border-b border-outline-variant/5 hover:bg-surface-container-high transition-colors ${i === 0 ? 'bg-primary/5' : ''}`}>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2 flex-wrap">
                          {i === 0 && <span className="text-[8px] font-headline font-bold text-primary bg-primary/10 border border-primary/20 px-1">PRIMARY</span>}
                          {(() => {
                            const badge = poolCategory || (tvl > 0 ? 'active' : null);
                            if (!badge) return null;
                            const cfg = CATEGORY_CONFIG[badge as 'active' | 'inactive' | 'all'];
                            return (
                              <span className={`text-[8px] font-headline font-bold px-1 ${cfg.color} ${cfg.bgColor} border ${cfg.borderColor}`}>
                                {badge.toUpperCase()}
                              </span>
                            );
                          })()}
                          <span className="font-headline font-bold text-white text-sm">{poolName}</span>
                          {tvl > 0 && tvl < LOW_TVL_THRESHOLD && (
                            <span className="relative group/liq">
                              <AlertTriangle className="w-3 h-3 text-yellow-400 shrink-0 cursor-help" />
                              <span className="absolute left-0 top-full mt-1 z-50 hidden group-hover/liq:block bg-surface-container-low border border-yellow-500/30 px-2 py-1.5 text-[9px] font-headline text-yellow-400 whitespace-nowrap shadow-lg">
                                Low liquidity — increase slippage to 3%+
                              </span>
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className="font-headline text-xs uppercase text-on-surface-variant">{resolveDexName(dexId)}</span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className={`font-headline text-sm ${tvl > 0 && tvl < LOW_TVL_THRESHOLD ? 'text-yellow-400' : 'text-white'}`}>{fmtUsd(tvl)}</span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className="font-headline text-sm text-white">{fmtUsd(pVol24)}</span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className={`font-headline text-sm ${change.color}`}>{change.text}</span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className="font-headline text-sm text-on-surface-variant">{pTxns.toLocaleString()}</span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className="font-headline text-sm text-primary">{fmtUsd(price)}</span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className={`font-headline text-sm ${impactColor(refImpact)}`}>{refImpact > 0 ? `~${(refImpact * 100).toFixed(2)}%` : '—'}</span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => openLpModal('add', pool.pairAddress, poolName, dexId, tvl)}
                            className="flex items-center gap-1 px-2 py-1 text-[9px] font-headline font-bold uppercase tracking-widest text-primary bg-primary/10 border border-primary/20 hover:bg-primary hover:text-black transition-colors cursor-pointer whitespace-nowrap"
                            title="Add Liquidity"
                          >
                            <Plus className="w-3 h-3" />
                            <span className="hidden md:inline">Add LP</span>
                          </button>
                          <button
                            onClick={() => openLpModal('remove', pool.pairAddress, poolName, dexId, tvl)}
                            className="flex items-center gap-1 px-2 py-1 text-[9px] font-headline font-bold uppercase tracking-widest text-secondary bg-secondary/10 border border-secondary/20 hover:bg-secondary hover:text-white transition-colors cursor-pointer"
                            title="Remove Liquidity"
                          >
                            <Minus className="w-3 h-3" />
                            <span className="hidden md:inline">Withdraw</span>
                          </button>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <a
                          href={`${NETWORK_INFO.blockExplorer}/address/${pool.pairAddress}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-on-surface-variant hover:text-primary transition-colors"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      <LiquidityModal
        isOpen={lpModal.open}
        onClose={closeLpModal}
        mode={lpModal.mode}
        pairAddress={lpModal.pairAddress}
        poolName={lpModal.poolName}
        dexId={lpModal.dexId}
        tvl={lpModal.tvl}
      />
    </div>
  );
}
