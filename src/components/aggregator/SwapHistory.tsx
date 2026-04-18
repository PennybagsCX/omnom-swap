/**
 * SwapHistory — list recent swaps executed through the aggregator.
 *
 * Reads SwapExecuted events from the blockchain and displays them
 * in a card-based layout matching the Direct Swap's Recent Swaps section.
 *
 * Optionally accepts a `localHistory` prop with localStorage-persisted
 * swap entries, which are displayed at the top (most recent first).
 *
 * H-05: Gracefully handles placeholder aggregator address.
 */

import { useState, useEffect } from 'react';
import { usePublicClient } from 'wagmi';
import { formatUnits } from 'viem';
import { ExternalLink, ChevronDown, Ghost, UtensilsCrossed } from 'lucide-react';
import { OMNOMSWAP_AGGREGATOR_ADDRESS, NETWORK_INFO, TOKENS, isAggregatorDeployed } from '../../lib/constants';
import { formatCompactAmount } from '../../lib/format';

// ─── Types ────────────────────────────────────────────────────────────────────

/** An entry from localStorage representing a locally-recorded swap. */
export interface LocalSwapEntry {
  id: number;
  sellAmount: number;
  sellSymbol: string;
  buyAmount: number;
  buySymbol: string;
  hash?: string;
  time: string;
  status: string;
  priceImpact: number;
}

interface SwapEvent {
  user: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: bigint;
  amountOut: bigint;
  feeCollected: bigint;
  blockNumber: bigint;
  transactionHash: string | null;
}

interface SwapHistoryProps {
  /** Optional array of localStorage-persisted swap entries to display alongside on-chain events. */
  localHistory?: LocalSwapEntry[];
  /** Optional callback to clear the local history. */
  onClearLocalHistory?: () => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getTokenSymbol(address: string): string {
  const token = TOKENS.find((t) => t.address.toLowerCase() === address.toLowerCase());
  return token?.symbol ?? `${address.slice(0, 6)}...`;
}

function getTokenDecimalsFor(address: string): number {
  const token = TOKENS.find((t) => t.address.toLowerCase() === address.toLowerCase());
  return token?.decimals ?? 18;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function SwapHistory({ localHistory = [], onClearLocalHistory }: SwapHistoryProps) {
  const publicClient = usePublicClient();
  const [swaps, setSwaps] = useState<SwapEvent[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  // H-05: check if contract is deployed
  const contractDeployed = isAggregatorDeployed();

  const hasLocalHistory = localHistory.length > 0;

  useEffect(() => {
    // H-05: skip fetching if contract is not deployed
    if (!publicClient || !contractDeployed) return;

    let cancelled = false;

    const fetchSwaps = async () => {
      setIsLoading(true);
      try {
        // Fetch SwapExecuted events — last 10000 blocks
        const blockNumber = await publicClient.getBlockNumber();
        const fromBlock = blockNumber > 10000n ? blockNumber - 10000n : 0n;

        const logs = await publicClient.getLogs({
          address: OMNOMSWAP_AGGREGATOR_ADDRESS,
          event: {
            type: 'event',
            name: 'SwapExecuted',
            inputs: [
              { name: 'user', type: 'address', indexed: true },
              { name: 'tokenIn', type: 'address', indexed: false },
              { name: 'tokenOut', type: 'address', indexed: false },
              { name: 'amountIn', type: 'uint256', indexed: false },
              { name: 'amountOut', type: 'uint256', indexed: false },
              { name: 'feeCollected', type: 'uint256', indexed: false },
            ],
          },
          fromBlock,
          toBlock: 'latest',
        });

        if (cancelled) return;

        const events: SwapEvent[] = logs.map((log) => {
          const args = log.args as Record<string, unknown> | undefined;
          return {
            user: (args?.user as string) ?? '0x0',
            tokenIn: (args?.tokenIn as string) ?? '0x0',
            tokenOut: (args?.tokenOut as string) ?? '0x0',
            amountIn: (args?.amountIn as bigint) ?? 0n,
            amountOut: (args?.amountOut as bigint) ?? 0n,
            feeCollected: (args?.feeCollected as bigint) ?? 0n,
            blockNumber: log.blockNumber ?? 0n,
            transactionHash: log.transactionHash ?? null,
          };
        });

        setSwaps(events.reverse()); // newest first
      } catch {
        // Contract may not be deployed yet
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    fetchSwaps();
    return () => { cancelled = true; };
  }, [publicClient, contractDeployed]);

  // Determine if there's any content to show at all
  const hasContent = hasLocalHistory || swaps.length > 0;

  return (
    <div className="w-full">
      {/* Collapsible header — matches Direct Swap's Recent Swaps toggle */}
      <button
        onClick={() => setShowHistory(!showHistory)}
        className="w-full flex items-center justify-between p-4 glass-panel shadow-[0_0_20px_rgba(0,0,0,0.2)] border border-outline-variant/15 hover:border-primary/30 transition-colors cursor-pointer"
      >
        <span className="font-headline font-bold uppercase text-sm text-white">Recent Swaps</span>
        <ChevronDown className={`w-4 h-4 text-on-surface-variant transition-transform ${showHistory ? 'rotate-180' : ''}`} />
      </button>

      {/* Expand/collapse with smooth animation — matches Direct Swap */}
      <div className={`overflow-hidden transition-all duration-300 ease-in-out ${showHistory ? 'max-h-[600px] opacity-100 mt-2' : 'max-h-0 opacity-0'}`}>
        <div className="glass-panel border border-outline-variant/15 p-4 space-y-3">
          {isLoading ? (
            <div className="text-on-surface-variant font-body text-sm animate-pulse text-center py-8">
              Loading swap history...
            </div>
          ) : !hasContent ? (
            /* Empty state matching Direct Swap's Ghost icon style */
            <div className="flex flex-col items-center justify-center py-8 text-on-surface-variant">
              <Ghost className="w-12 h-12 mb-3 opacity-20" />
              <div className="text-sm font-headline uppercase tracking-widest text-white mb-1">No Swaps Found</div>
              <div className="text-[10px] uppercase tracking-wider opacity-60">
                {!contractDeployed
                  ? 'Contract not deployed — history will appear after deployment'
                  : 'The void remains empty'}
              </div>
            </div>
          ) : (
            <>
              {/* Clear history button */}
              {hasLocalHistory && onClearLocalHistory && (
                <div className="flex justify-end">
                  <button
                    onClick={onClearLocalHistory}
                    className="text-[10px] text-on-surface-variant/60 hover:text-red-400 transition-colors uppercase tracking-widest font-headline"
                    aria-label="Clear swap history"
                  >
                    Clear History
                  </button>
                </div>
              )}

              {/* Local history entries (most recent first) */}
              {localHistory.slice(0, 20).map((tx) => (
                <div key={`local-${tx.id}`} className="border-b border-outline-variant/10 pb-2 last:border-0 last:pb-0">
                  <div className="flex items-center gap-1.5 text-xs flex-wrap">
                    <span className="font-bold text-white truncate whitespace-nowrap">
                      {formatCompactAmount(tx.sellAmount)} {tx.sellSymbol}
                    </span>
                    <UtensilsCrossed className="w-2.5 h-2.5 text-on-surface-variant rotate-90 shrink-0" />
                    <span className="font-bold text-primary truncate whitespace-nowrap">
                      {formatCompactAmount(tx.buyAmount)} {tx.buySymbol}
                    </span>
                  </div>
                  <div className="flex items-center justify-between mt-0.5">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-on-surface-variant">
                        {tx.time}
                      </span>
                      {tx.hash && (
                        <a
                          href={`${NETWORK_INFO.blockExplorer}/tx/${tx.hash}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-on-surface-variant hover:text-primary"
                        >
                          <ExternalLink className="w-2.5 h-2.5" />
                        </a>
                      )}
                    </div>
                    <span className={`text-[9px] font-bold uppercase ${
                      tx.status === 'success' ? 'text-green-400' : tx.status === 'failed' ? 'text-red-400' : 'text-yellow-400'
                    }`}>
                      {tx.status}
                    </span>
                  </div>
                </div>
              ))}

              {/* Separator between local and on-chain entries */}
              {hasLocalHistory && swaps.length > 0 && (
                <div className="border-t border-outline-variant/20 pt-2">
                  <span className="text-[9px] font-headline uppercase tracking-widest text-on-surface-variant/50">On-chain events</span>
                </div>
              )}

              {/* On-chain events */}
              {swaps.slice(0, 20).map((swap, idx) => {
                const inSymbol = getTokenSymbol(swap.tokenIn);
                const outSymbol = getTokenSymbol(swap.tokenOut);
                const inDecimals = getTokenDecimalsFor(swap.tokenIn);
                const outDecimals = getTokenDecimalsFor(swap.tokenOut);
                const amountInFormatted = parseFloat(formatUnits(swap.amountIn, inDecimals));
                const amountOutFormatted = parseFloat(formatUnits(swap.amountOut, outDecimals));

                return (
                  <div key={`chain-${idx}`} className="border-b border-outline-variant/10 pb-2 last:border-0 last:pb-0">
                    <div className="flex items-center gap-1.5 text-xs flex-wrap">
                      <span className="font-bold text-white truncate whitespace-nowrap">
                        {formatCompactAmount(amountInFormatted)} {inSymbol}
                      </span>
                      <UtensilsCrossed className="w-2.5 h-2.5 text-on-surface-variant rotate-90 shrink-0" />
                      <span className="font-bold text-primary truncate whitespace-nowrap">
                        {formatCompactAmount(amountOutFormatted)} {outSymbol}
                      </span>
                    </div>
                    <div className="flex items-center justify-between mt-0.5">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-on-surface-variant">
                          {swap.user.slice(0, 6)}...{swap.user.slice(-4)}
                        </span>
                        {swap.transactionHash && (
                          <a
                            href={`${NETWORK_INFO.blockExplorer}/tx/${swap.transactionHash}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-on-surface-variant hover:text-primary"
                          >
                            <ExternalLink className="w-2.5 h-2.5" />
                          </a>
                        )}
                      </div>
                      <span className="text-[9px] font-bold uppercase text-green-400">success</span>
                    </div>
                  </div>
                );
              })}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
