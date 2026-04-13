import { useState } from 'react';
import { ExternalLink, Droplets, PawPrint, AlertTriangle, Plus, Minus } from 'lucide-react';
import { CONTRACTS, NETWORK_INFO } from '../lib/constants';
import { useOmnomData } from '../hooks/useOmnomData';
import { LiquidityModal } from './LiquidityModal';

interface PoolData {
  id: string;
  attributes: {
    name: string;
    pool_currency: string;
    base_token_price_usd: string;
    quote_token_price_usd: string;
    reserve_in_usd: string;
    address: string;
    volume_usd: { h24: string; h6: string; h1: string };
    price_change_percentage: { h24: string; h6: string; h1: string };
    transactions: { h24: { buys: number; sells: number }; h6: { buys: number; sells: number }; h1: { buys: number; sells: number } };
  };
  relationships?: {
    dex?: { data?: { id?: string } };
  };
}

function fmtUsd(n: number): string {
  if (n === 0) return '$0';
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  if (n >= 1) return `$${n.toFixed(2)}`;
  if (n >= 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(8)}`;
}

function pctChange(val: string | undefined): { text: string; color: string } {
  if (!val) return { text: '\u2014', color: 'text-on-surface-variant' };
  const n = parseFloat(val);
  if (isNaN(n)) return { text: '\u2014', color: 'text-on-surface-variant' };
  const sign = n >= 0 ? '+' : '';
  return { text: `${sign}${n.toFixed(2)}%`, color: n >= 0 ? 'text-green-400' : 'text-red-400' };
}

export function PoolsScreen() {
  const {
    totalTvl, totalVol24, totalTxns24, poolCount,
    allPools,
    isPoolsListLoading, poolsListError,
  } = useOmnomData();

  const [lpModal, setLpModal] = useState<{
    open: boolean;
    mode: 'add' | 'remove';
    pairAddress: string;
    poolName: string;
    dexId: string;
  }>({ open: false, mode: 'add', pairAddress: '', poolName: '', dexId: '' });

  const openLpModal = (mode: 'add' | 'remove', pairAddress: string, poolName: string, dexId: string) => {
    setLpModal({ open: true, mode, pairAddress, poolName, dexId });
  };

  const closeLpModal = () => {
    setLpModal(prev => ({ ...prev, open: false }));
  };

  const pools = allPools as unknown as PoolData[];
  const isRateLimited = poolsListError?.message?.includes('429');
  const txns24Total = totalTxns24.buys + totalTxns24.sells;
  const hasError = !!poolsListError;

  return (
    <div className="max-w-6xl mx-auto w-full px-4">
      <div className="flex items-center gap-3 mb-8">
        <PawPrint className="w-6 h-6 text-primary" />
        <h2 className="font-headline font-black text-3xl tracking-tighter uppercase text-white">The Feeding Grounds</h2>
      </div>

      {/* Summary cards — aggregated across ALL pools */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <div className="bg-surface-container-low p-4 border-l-2 border-primary text-center">
          <p className="text-[10px] font-headline uppercase text-on-surface-variant mb-1">Pool TVL</p>
          <p className="font-headline font-bold text-white text-xl">{fmtUsd(totalTvl)}</p>
        </div>
        <div className="bg-surface-container-low p-4 border-l-2 border-secondary text-center">
          <p className="text-[10px] font-headline uppercase text-on-surface-variant mb-1">24H Volume</p>
          <p className="font-headline font-bold text-white text-xl">{fmtUsd(totalVol24)}</p>
        </div>
        <div className="bg-surface-container-low p-4 border-l-2 border-green-400 text-center">
          <p className="text-[10px] font-headline uppercase text-on-surface-variant mb-1">24H Txns</p>
          <p className="font-headline font-bold text-white text-xl">{txns24Total.toLocaleString()}</p>
          <div className="flex gap-2 mt-1 justify-center">
            <span className="text-[10px] text-green-400">{totalTxns24.buys} buys</span>
            <span className="text-[10px] text-on-surface-variant">/</span>
            <span className="text-[10px] text-red-400">{totalTxns24.sells} sells</span>
          </div>
        </div>
        <div className="bg-surface-container-low p-4 border-l-2 border-outline-variant text-center">
          <p className="text-[10px] font-headline uppercase text-on-surface-variant mb-1">On-Chain Pools</p>
          <p className="font-headline font-bold text-white text-xl">{poolCount > 0 ? poolCount : '\u2014'}</p>
        </div>
      </div>

      {/* Rate limit warning */}
      {hasError && isRateLimited && pools.length === 0 && (
        <div className="mb-6 flex items-center bg-yellow-900/20 border border-yellow-500/30 p-4">
          <AlertTriangle className="w-5 h-5 text-yellow-400 shrink-0 mr-2" />
          <div>
            <p className="text-yellow-400 font-headline uppercase tracking-widest text-sm">Pool list temporarily unavailable</p>
            <p className="text-yellow-400/60 text-xs mt-0.5">API rate limit reached — summary data above is live.</p>
          </div>
        </div>
      )}

      {hasError && pools.length > 0 && (
        <div className="mb-4 flex items-center gap-2 bg-yellow-900/20 border border-yellow-500/30 p-3">
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
              const attr = pool.attributes;
              const dexId = pool.relationships?.dex?.data?.id?.replace('dogechain_', '') || '';
              const tvl = parseFloat(attr.reserve_in_usd || '0');
              const pVol24 = parseFloat(attr.volume_usd?.h24 || '0');
              const change = pctChange(attr.price_change_percentage?.h24);
              const pTxns = (attr.transactions?.h24?.buys || 0) + (attr.transactions?.h24?.sells || 0);
              const price = parseFloat(attr.base_token_price_usd || '0');

              return (
                <div key={pool.id} className={`bg-surface-container-low border border-outline-variant/15 p-4 ${i === 0 ? 'border-l-4 border-l-primary bg-primary/5' : ''}`}>
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      {i === 0 && <span className="text-[8px] font-headline font-bold text-primary bg-primary/10 border border-primary/20 px-1">PRIMARY</span>}
                      <span className="font-headline font-bold text-white text-sm">{attr.name}</span>
                    </div>
                    <span className="font-headline text-[10px] uppercase text-on-surface-variant">{dexId || '\u2014'}</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 mb-3 text-xs">
                    <div>
                      <span className="text-on-surface-variant font-headline uppercase text-[9px] block">TVL</span>
                      <span className="font-headline font-bold text-white">{fmtUsd(tvl)}</span>
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
                  </div>
                  <div className="flex items-center gap-2 pt-2 border-t border-outline-variant/10">
                    <button
                      onClick={() => openLpModal('add', attr.address, attr.name, dexId)}
                      className="flex items-center gap-1.5 px-3 py-2 text-[10px] font-headline font-bold uppercase tracking-widest text-primary bg-primary/10 border border-primary/20 hover:bg-primary hover:text-black transition-colors cursor-pointer"
                    >
                      <Plus className="w-3 h-3" />
                      Add LP
                    </button>
                    <button
                      onClick={() => openLpModal('remove', attr.address, attr.name, dexId)}
                      className="flex items-center gap-1.5 px-3 py-2 text-[10px] font-headline font-bold uppercase tracking-widest text-secondary bg-secondary/10 border border-secondary/20 hover:bg-secondary hover:text-white transition-colors cursor-pointer"
                    >
                      <Minus className="w-3 h-3" />
                      Withdraw
                    </button>
                    <div className="flex-1" />
                    <a
                      href={`${NETWORK_INFO.blockExplorer}/address/${attr.address}`}
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
                  <th className="font-headline text-[10px] uppercase tracking-widest text-on-surface-variant px-4 py-3 text-right">TVL</th>
                  <th className="font-headline text-[10px] uppercase tracking-widest text-on-surface-variant px-4 py-3 text-right">24H Vol</th>
                  <th className="font-headline text-[10px] uppercase tracking-widest text-on-surface-variant px-4 py-3 text-right">24H Change</th>
                  <th className="font-headline text-[10px] uppercase tracking-widest text-on-surface-variant px-4 py-3 text-right">24H Txns</th>
                  <th className="font-headline text-[10px] uppercase tracking-widest text-on-surface-variant px-4 py-3 text-right">Price</th>
                  <th className="px-4 py-3 text-center">Actions</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {pools.map((pool, i) => {
                  const attr = pool.attributes;
                  const dexId = pool.relationships?.dex?.data?.id?.replace('dogechain_', '') || '';
                  const tvl = parseFloat(attr.reserve_in_usd || '0');
                  const pVol24 = parseFloat(attr.volume_usd?.h24 || '0');
                  const change = pctChange(attr.price_change_percentage?.h24);
                  const pTxns = (attr.transactions?.h24?.buys || 0) + (attr.transactions?.h24?.sells || 0);
                  const price = parseFloat(attr.base_token_price_usd || '0');

                  return (
                    <tr key={pool.id} className={`border-b border-outline-variant/5 hover:bg-surface-container-high transition-colors ${i === 0 ? 'bg-primary/5' : ''}`}>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          {i === 0 && <span className="text-[8px] font-headline font-bold text-primary bg-primary/10 border border-primary/20 px-1">PRIMARY</span>}
                          <span className="font-headline font-bold text-white text-sm">{attr.name}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className="font-headline text-xs uppercase text-on-surface-variant">{dexId || '\u2014'}</span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className="font-headline text-sm text-white">{fmtUsd(tvl)}</span>
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
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => openLpModal('add', attr.address, attr.name, dexId)}
                            className="flex items-center gap-1 px-2 py-1 text-[9px] font-headline font-bold uppercase tracking-widest text-primary bg-primary/10 border border-primary/20 hover:bg-primary hover:text-black transition-colors cursor-pointer"
                            title="Add Liquidity"
                          >
                            <Plus className="w-3 h-3" />
                            <span className="hidden md:inline">Add LP</span>
                          </button>
                          <button
                            onClick={() => openLpModal('remove', attr.address, attr.name, dexId)}
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
                          href={`${NETWORK_INFO.blockExplorer}/address/${attr.address}`}
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

      {/* Pool addresses for reference */}
      <div className="mt-6 bg-surface-container-low border border-outline-variant/10 p-4">
        <h3 className="font-headline font-bold text-xs uppercase tracking-widest text-on-surface-variant mb-3">Contract Reference</h3>
        <div className="space-y-2 text-xs font-mono">
          <div className="flex gap-4"><span className="text-on-surface-variant w-32 shrink-0">OMNOM:</span><a href={`${NETWORK_INFO.blockExplorer}/token/${CONTRACTS.OMNOM_TOKEN}/token-transfers`} target="_blank" rel="noopener noreferrer" className="text-white hover:text-primary break-all">{CONTRACTS.OMNOM_TOKEN}</a></div>
          <div className="flex gap-4"><span className="text-on-surface-variant w-32 shrink-0">V3 Router:</span><span className="text-white break-all">{CONTRACTS.ALGEBRA_V3_ROUTER}</span></div>
          <div className="flex gap-4"><span className="text-on-surface-variant w-32 shrink-0">V2 Router:</span><span className="text-white break-all">{CONTRACTS.DOGESWAP_V2_ROUTER}</span></div>
          <div className="flex gap-4"><span className="text-on-surface-variant w-32 shrink-0">V3 Quoter:</span><span className="text-white break-all">{CONTRACTS.ALGEBRA_QUOTER}</span></div>
          <div className="flex gap-4"><span className="text-on-surface-variant w-32 shrink-0">WWDOGE:</span><span className="text-white break-all">{CONTRACTS.WWDOGE}</span></div>
        </div>
      </div>

      <LiquidityModal
        isOpen={lpModal.open}
        onClose={closeLpModal}
        mode={lpModal.mode}
        pairAddress={lpModal.pairAddress}
        poolName={lpModal.poolName}
        dexId={lpModal.dexId}
      />
    </div>
  );
}
