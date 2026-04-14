import { useState } from 'react';
import { BarChart3, TrendingUp, Activity, Clock, Hash, ArrowUpRight, ArrowDownRight, ExternalLink, ChevronDown, CircleDot } from 'lucide-react';
import { useOmnomData, Trade } from '../hooks/useOmnomData';
import { CONTRACTS, NETWORK_INFO, BUBBLEMAP_URL, impactColor, calcPriceImpact } from '../lib/constants';

const OMNOM = CONTRACTS.OMNOM_TOKEN.toLowerCase();
const WWDOGE = CONTRACTS.WWDOGE.toLowerCase();

function fmtUsd(n: number | null): string {
  if (n === null) return '\u2014';
  if (n === 0) return '$0';
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  if (n >= 1) return `$${n.toFixed(2)}`;
  if (n >= 0.01) return `$${n.toFixed(4)}`;
  const str = n.toFixed(10);
  const match = str.match(/0\.(0+)([1-9])/);
  if (match) return `$${n.toFixed(match[1].length + 2)}`;
  return `$${n.toFixed(6)}`;
}

function fmtTokenAmt(n: number | null): string {
  if (n === null) return '\u2014';
  if (n === 0) return '0';
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  if (n >= 1) return n.toFixed(2);
  return n.toFixed(6);
}

function tokenLabel(address: string): string {
  const addr = address.toLowerCase();
  if (addr === OMNOM) return 'OMNOM';
  if (addr === WWDOGE) return 'WWDOGE';
  return address.slice(0, 6) + '...';
}

function timeAgo(dateStr: string | undefined): string {
  if (!dateStr) return '';
  const ts = new Date(dateStr).getTime();
  if (isNaN(ts)) return '';
  const diff = Date.now() - ts;
  if (diff < 0) return 'just now';
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function TradeRow({ tx, poolTvl }: { tx: Trade; poolTvl: number | null }) {
  const vol = parseFloat(tx.volume_in_usd || '0');
  const isBuy = (tx.kind || '').toLowerCase() === 'buy';
  const time = timeAgo(tx.block_timestamp);
  const txHash = tx.tx_hash || '';
  const wallet = tx.tx_from_address || '';

  // Identify which amount is OMNOM and which is WWDOGE
  const fromAmt = parseFloat(tx.from_token_amount || '0');
  const toAmt = parseFloat(tx.to_token_amount || '0');
  const fromLabel = tokenLabel(tx.from_token_address);
  const toLabel = tokenLabel(tx.to_token_address);

  // Estimate trade impact: trade volume vs half the pool TVL
  const tradeImpact = poolTvl && poolTvl > 0 ? calcPriceImpact(vol, poolTvl / 2) : 0;

  return (
    <div className="flex items-center justify-between px-4 py-3 border-b border-outline-variant/5 hover:bg-surface-container-high transition-colors">
      <div className="flex items-center gap-3">
        <div className={`w-6 h-6 flex items-center justify-center shrink-0 ${isBuy ? 'bg-green-400/10' : 'bg-red-400/10'}`}>
          {isBuy ? <ArrowUpRight className="w-3.5 h-3.5 text-green-400" /> : <ArrowDownRight className="w-3.5 h-3.5 text-red-400" />}
        </div>
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-2">
            <span className={`font-headline font-bold text-xs uppercase ${isBuy ? 'text-green-400' : 'text-red-400'}`}>
              {isBuy ? 'Buy' : 'Sell'}
            </span>
            <span className="font-headline text-xs text-white">
              {isBuy
                ? <>{fmtTokenAmt(toAmt)} <span className="text-primary">{toLabel}</span> <span className="text-on-surface-variant">for</span> {fmtTokenAmt(fromAmt)} <span className="text-on-surface-variant">{fromLabel}</span></>
                : <>{fmtTokenAmt(fromAmt)} <span className="text-primary">{fromLabel}</span> <span className="text-on-surface-variant">for</span> {fmtTokenAmt(toAmt)} <span className="text-on-surface-variant">{toLabel}</span></>
              }
            </span>
          </div>
          <div className="flex items-center gap-2">
            {time && <span className="text-[10px] text-on-surface-variant">{time}</span>}
            {wallet && (
              <a
                href={`${NETWORK_INFO.blockExplorer}/address/${wallet}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[10px] text-on-surface-variant hover:text-primary font-mono"
              >
                {wallet.slice(0, 6)}...{wallet.slice(-4)}
              </a>
            )}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-3 shrink-0">
        <div className="text-right">
          <p className={`font-headline text-xs ${tradeImpact > 0 ? impactColor(tradeImpact) : 'text-white'}`}>{fmtUsd(vol)}</p>
          {txHash && (
            <a
              href={`${NETWORK_INFO.blockExplorer}/tx/${txHash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[9px] text-on-surface-variant hover:text-primary font-mono"
            >
              {txHash.slice(0, 10)}...{txHash.slice(-6)}
            </a>
          )}
        </div>
        {txHash && (
          <a
            href={`${NETWORK_INFO.blockExplorer}/tx/${txHash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-on-surface-variant hover:text-primary"
          >
            <ExternalLink className="w-3 h-3" />
          </a>
        )}
      </div>
    </div>
  );
}

export function StatsScreen() {
  const {
    priceUsd, fdvUsd, marketCapUsd, totalTvl,
    totalVol24, totalVol6, totalVol1,
    priceChange24,
    totalTxns24,
    trades,
    hasMoreTrades,
    isLoadingMoreTrades,
    loadMoreTrades,
    isLoading,
    mexcPrice, mexcVol24,
  } = useOmnomData();

  const txns24Total = totalTxns24 ? totalTxns24.buys + totalTxns24.sells : null;
  const [visibleCount, setVisibleCount] = useState(10);
  const visibleTrades = trades.slice(0, visibleCount);
  const hasMoreToShow = visibleCount < trades.length;

  return (
    <div className="max-w-6xl mx-auto w-full px-4">
      <div className="flex items-center gap-3 mb-8">
        <BarChart3 className="w-6 h-6 text-primary" />
        <h2 className="font-headline font-black text-3xl tracking-tighter uppercase text-white">Feeding Frenzy</h2>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          <span className="ml-4 font-headline text-on-surface-variant uppercase tracking-widest text-sm">Loading stats...</span>
        </div>
      )}

      {!isLoading && (
        <>
          {/* Price hero */}
          <div className="bg-surface-container-low p-4 md:p-8 border border-primary/20 mb-8 flex flex-col md:flex-row md:items-end md:justify-between gap-4">
            <div className="min-w-0">
              <p className="text-[10px] font-headline uppercase tracking-widest text-on-surface-variant mb-2">$OMNOM Price</p>
              <div className="flex items-baseline gap-2 md:gap-3 flex-wrap">
                <span className="font-headline font-black text-2xl sm:text-3xl md:text-5xl text-primary whitespace-nowrap">{fmtUsd(priceUsd)}</span>
                {priceChange24 !== null && !isNaN(priceChange24) && (
                  <span className={`font-headline font-bold text-base md:text-lg flex items-center gap-1 ${priceChange24 >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {priceChange24 >= 0 ? <ArrowUpRight className="w-4 h-4" /> : <ArrowDownRight className="w-4 h-4" />}
                    {priceChange24 >= 0 ? '+' : ''}{priceChange24.toFixed(2)}%
                  </span>
                )}
              </div>
            </div>
            <div className="flex gap-4 md:gap-6 flex-wrap">
              <div>
                <p className="text-[10px] font-headline uppercase text-on-surface-variant">FDV</p>
                <p className="font-headline font-bold text-white">{fmtUsd(fdvUsd)}</p>
              </div>
              <div>
                <p className="text-[10px] font-headline uppercase text-on-surface-variant">Market Cap</p>
                <p className="font-headline font-bold text-white">{fmtUsd(marketCapUsd)}</p>
              </div>
              <div>
                <p className="text-[10px] font-headline uppercase text-on-surface-variant">Pool TVL</p>
                <p className="font-headline font-bold text-white">{fmtUsd(totalTvl)}</p>
              </div>
            </div>
          </div>

          {/* MEXC CEX data */}
          <div className="grid grid-cols-2 gap-4 mb-8">
            <div className="bg-surface-container-low p-4 border-b-2 text-center flex flex-col items-center justify-center" style={{ borderBottomColor: 'rgb(41, 91, 249)' }}>
              <p className="text-[10px] font-headline uppercase text-on-surface-variant mb-2">MEXC $OMNOM Price</p>
              <p className="font-headline font-bold text-white text-lg whitespace-nowrap">{fmtUsd(mexcPrice)}</p>
              <p className="text-[10px] font-headline" style={{ color: 'rgb(41, 91, 249)' }}>CEX</p>
            </div>
            <div className="bg-surface-container-low p-4 border-b-2 text-center flex flex-col items-center justify-center" style={{ borderBottomColor: 'rgba(41, 91, 249, 0.6)' }}>
              <p className="text-[10px] font-headline uppercase text-on-surface-variant mb-2">MEXC $OMNOM 24H Vol</p>
              <p className="font-headline font-bold text-white text-lg">{fmtUsd(mexcVol24)}</p>
              <p className="text-[10px] font-headline" style={{ color: 'rgb(41, 91, 249)' }}>CEX</p>
            </div>
          </div>

          {/* Metric grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
            <div className="bg-surface-container-low p-4 border-b-2 border-primary text-center flex flex-col items-center justify-center">
              <div className="flex items-center justify-center gap-2 mb-2">
                <TrendingUp className="w-4 h-4 text-primary" />
                <p className="text-[10px] font-headline uppercase text-on-surface-variant">24H Volume</p>
              </div>
              <p className="font-headline font-bold text-white text-lg">{fmtUsd(totalVol24)}</p>
              <p className="text-[10px] font-headline text-primary">ON CHAIN</p>
            </div>
            <div className="bg-surface-container-low p-4 border-b-2 border-secondary text-center flex flex-col items-center justify-center">
              <div className="flex items-center justify-center gap-2 mb-2">
                <Activity className="w-4 h-4 text-secondary" />
                <p className="text-[10px] font-headline uppercase text-on-surface-variant">6H Volume</p>
              </div>
              <p className="font-headline font-bold text-white text-lg">{fmtUsd(totalVol6)}</p>
              <p className="text-[10px] font-headline text-secondary">ON CHAIN</p>
            </div>
            <div className="bg-surface-container-low p-4 border-b-2 border-green-400 text-center flex flex-col items-center justify-center">
              <div className="flex items-center justify-center gap-2 mb-2">
                <Clock className="w-4 h-4 text-green-400" />
                <p className="text-[10px] font-headline uppercase text-on-surface-variant">1H Volume</p>
              </div>
              <p className="font-headline font-bold text-white text-lg">{fmtUsd(totalVol1)}</p>
              <p className="text-[10px] font-headline text-green-400">ON CHAIN</p>
            </div>
            <div className="bg-surface-container-low p-4 border-b-2 border-outline-variant text-center flex flex-col items-center justify-center">
              <div className="flex items-center justify-center gap-2 mb-2">
                <Hash className="w-4 h-4 text-outline-variant" />
                <p className="text-[10px] font-headline uppercase text-on-surface-variant">24H Txns</p>
              </div>
              <p className="font-headline font-bold text-white text-lg">{txns24Total !== null ? txns24Total.toLocaleString() : '\u2014'}</p>
              <div className="flex gap-2 mt-1 justify-center">
                <span className="text-[10px] text-green-400">{totalTxns24 ? totalTxns24.buys : '\u2014'} buys</span>
                <span className="text-[10px] text-on-surface-variant">/</span>
                <span className="text-[10px] text-red-400">{totalTxns24 ? totalTxns24.sells : '\u2014'} sells</span>
              </div>
            </div>
          </div>

          {/* Buy/Sell ratio bar */}
          {totalTxns24 && txns24Total !== null && txns24Total > 0 && (
            <div className="bg-surface-container-low p-4 border border-outline-variant/10 mb-8">
              <p className="text-[10px] font-headline uppercase tracking-widest text-on-surface-variant mb-2">24H Buy / Sell Ratio</p>
              <div className="flex h-3 w-full overflow-hidden">
                <div className="bg-green-400/80" style={{ width: `${(totalTxns24.buys / txns24Total) * 100}%` }}></div>
                <div className="bg-red-400/80" style={{ width: `${(totalTxns24.sells / txns24Total) * 100}%` }}></div>
              </div>
              <div className="flex justify-between mt-1">
                <span className="text-[10px] text-green-400">{((totalTxns24.buys / txns24Total) * 100).toFixed(1)}% Buys</span>
                <span className="text-[10px] text-red-400">{((totalTxns24.sells / txns24Total) * 100).toFixed(1)}% Sells</span>
              </div>
            </div>
          )}

          {/* Holder Distribution — Bubblemap */}
          <div className="bg-surface-container-low border border-primary/20 p-6 mb-8 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
                <CircleDot className="w-5 h-5 text-primary" />
              </div>
              <div>
                <h3 className="font-headline font-bold text-white uppercase tracking-wider text-sm">Holder Distribution</h3>
                <p className="text-xs text-on-surface-variant mt-1">Visualize $OMNOM token holders, whale wallets, and supply concentration with interactive bubble maps on Dogechain.</p>
              </div>
            </div>
            <a
              href={BUBBLEMAP_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 px-5 py-2.5 font-headline font-bold text-xs uppercase tracking-widest bg-primary text-black hover:bg-white transition-colors shadow-[0_0_20px_rgba(255,215,0,0.2)] cursor-pointer whitespace-nowrap shrink-0"
            >
              <CircleDot className="w-4 h-4" />
              View Bubble Map
            </a>
          </div>

          {/* Recent transactions */}
          <div className="bg-surface-container-low border border-outline-variant/15">
            <div className="flex items-center justify-between px-4 py-3 border-b border-outline-variant/20">
              <h3 className="font-headline font-bold text-sm uppercase tracking-wider text-white">
                Recent Transactions
                <span className="ml-2 text-[10px] text-on-surface-variant font-normal tracking-widest normal-case">
                  ({txns24Total !== null ? txns24Total : '\u2014'} txns in last 24h)
                </span>
              </h3>
              <a
                href={`${NETWORK_INFO.blockExplorer}/token/${CONTRACTS.OMNOM_TOKEN}/token-transfers`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[10px] font-headline uppercase tracking-widest text-primary hover:text-white flex items-center gap-1"
              >
                View All <ExternalLink className="w-3 h-3" />
              </a>
            </div>
            <div>
              {trades.length > 0 ? (
                <>
                  {visibleTrades.map((tx, i) => (
                    <TradeRow key={`${tx.tx_hash}-${i}`} tx={tx} poolTvl={totalTvl} />
                  ))}

                  {/* Load More button — shows more locally, or fetches next page from API */}
                  {(hasMoreToShow || hasMoreTrades) && (
                    <div className="px-4 py-3 border-t border-outline-variant/10">
                      <button
                        onClick={() => {
                          if (hasMoreToShow) {
                            setVisibleCount(prev => prev + 10);
                          } else if (hasMoreTrades) {
                            loadMoreTrades();
                            setVisibleCount(prev => prev + 10);
                          }
                        }}
                        disabled={isLoadingMoreTrades}
                        className="w-full flex items-center justify-center gap-2 py-2 font-headline text-xs uppercase tracking-widest text-on-surface-variant hover:text-primary border border-outline-variant/15 hover:border-primary/30 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {isLoadingMoreTrades ? (
                          <>
                            <div className="w-3 h-3 border border-primary border-t-transparent rounded-full animate-spin" />
                            Loading...
                          </>
                        ) : (
                          <>
                            Load More
                            <ChevronDown className="w-3 h-3" />
                          </>
                        )}
                      </button>
                    </div>
                  )}
                </>
              ) : (
                <div className="text-center py-12 text-on-surface-variant">
                  <Hash className="w-10 h-10 mx-auto mb-3 opacity-20" />
                  <p className="font-headline text-xs uppercase tracking-widest">No recent transactions</p>
                  <p className="text-[10px] mt-1 opacity-60">Trades will appear here when activity occurs</p>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
