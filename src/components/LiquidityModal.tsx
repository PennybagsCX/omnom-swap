import { useState, useEffect, useCallback } from 'react';
import { useAccount, useChainId } from 'wagmi';
import { parseUnits, formatUnits } from 'viem';
import { X, Droplets, Loader2, AlertTriangle } from 'lucide-react';
import { TOKENS, NETWORK_INFO, CONTRACTS } from '../lib/constants';
import {
  usePoolReserves,
  useLpBalance,
  useDogeswapPair,
  useErc20Balances,
  useAddLiquidity,
  useRemoveLiquidity,
  computeWithdrawAmounts,
} from '../hooks/useLiquidity';

type ModalMode = 'add' | 'remove';

interface LiquidityModalProps {
  isOpen: boolean;
  onClose: () => void;
  mode: ModalMode;
  pairAddress: string;
  poolName: string;
  dexId: string;
  tvl?: number;
}

function tokenSymbol(address: string | undefined): string {
  if (!address) return '???';
  const lower = address.toLowerCase();
  const known = TOKENS.find(t => t.address.toLowerCase() === lower);
  return known ? known.symbol : `${address.slice(0, 4)}...${address.slice(-4)}`;
}

// Format LP balance — shows enough precision for very small positions
function fmtLp(val: bigint): string {
  const n = Number(formatUnits(val, 18));
  if (n === 0) return '0';
  if (n >= 1) return n.toLocaleString(undefined, { maximumFractionDigits: 4 });
  if (n >= 0.0001) return n.toFixed(6);
  // For tiny amounts, show scientific notation
  return n.toExponential(4);
}

export function LiquidityModal({ isOpen, onClose, mode, pairAddress, poolName, dexId, tvl }: LiquidityModalProps) {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const isWrongNetwork = isConnected && chainId !== NETWORK_INFO.chainId;
  const isV3 = dexId === 'quickswap_dogechain';

  // Pool data — read from GeckoTerminal's pair to get token addresses
  const { token0, token1, symbol0, symbol1 } = usePoolReserves(
    isV3 ? undefined : pairAddress,
  );
  // Resolve the DogeSwap pair — LP tokens, reserves, and totalSupply live here
  const dogeswapPair = useDogeswapPair(token0 as string | undefined, token1 as string | undefined);
  const { reserve0, reserve1, totalSupply, isLoading: isPoolLoading } = usePoolReserves(
    isV3 ? undefined : (dogeswapPair ?? pairAddress),
  );
  const { lpBalance, refetch: refetchLp } = useLpBalance(dogeswapPair ?? pairAddress);

  // Token balances — also reads native DOGE if token is WWDOGE
  const { balanceA: rawBalA, balanceB: rawBalB, nativeBalance, isLoading: isLoadingBalances } = useErc20Balances(
    token0 as string | undefined,
    token1 as string | undefined,
  );

  const isToken0WWDOGE = token0?.toLowerCase() === CONTRACTS.WWDOGE.toLowerCase();
  const isToken1WWDOGE = token1?.toLowerCase() === CONTRACTS.WWDOGE.toLowerCase();

  const rawBalANum = !isConnected ? 0 : rawBalA ? Number(formatUnits(rawBalA, 18)) : 0;
  const rawBalBNum = !isConnected ? 0 : rawBalB ? Number(formatUnits(rawBalB, 18)) : 0;
  const nativeDoge = !isConnected ? 0 : Number(formatUnits(nativeBalance, 18));
  // Swap page uses native DOGE balance for WWDOGE — match that behavior here
  const balanceA = isToken0WWDOGE ? nativeDoge : rawBalANum;
  const balanceB = isToken1WWDOGE ? nativeDoge : rawBalBNum;

  // Actions
  const { addLiquidity } = useAddLiquidity();
  const { removeLiquidity } = useRemoveLiquidity();

  // Add LP state
  const [amountA, setAmountA] = useState('');
  const [amountB, setAmountB] = useState('');
  const [slippage, setSlippage] = useState('3.0');
  const [deadline, setDeadline] = useState('5');

  // Remove LP state
  const [removePercent, setRemovePercent] = useState(100);
  const [showRemoveConfirm, setShowRemoveConfirm] = useState(false);

  // Transaction state
  const [isPending, setIsPending] = useState(false);

  // Reset state on open/mode change
  useEffect(() => {
    if (isOpen) {
      setAmountA('');
      setAmountB('');
      setRemovePercent(100);
      setShowRemoveConfirm(false);
      setIsPending(false);
    }
  }, [isOpen, mode]);

  // Pool ratio for auto-fill (guarded against zero division)
  const r0Num = reserve0 > 0n ? Number(formatUnits(reserve0, 18)) : 0;
  const poolRatio = r0Num > 0 && reserve1 > 0n
    ? Number(formatUnits(reserve1, 18)) / r0Num
    : 0;

  const handleAmountAChange = useCallback((val: string) => {
    if (val === '' || /^\d*\.?\d*$/.test(val)) {
      setAmountA(val);
      if (poolRatio > 0 && val) {
        const parsed = parseFloat(val);
        if (!isNaN(parsed)) {
          setAmountB((parsed * poolRatio).toFixed(6).replace(/\.?0+$/, ''));
        }
      } else {
        setAmountB('');
      }
    }
  }, [poolRatio]);

  const handleAmountBChange = useCallback((val: string) => {
    if (val === '' || /^\d*\.?\d*$/.test(val)) {
      setAmountB(val);
      if (poolRatio > 0 && val) {
        const parsed = parseFloat(val);
        if (!isNaN(parsed) && poolRatio > 0) {
          setAmountA((parsed / poolRatio).toFixed(6).replace(/\.?0+$/, ''));
        }
      } else {
        setAmountA('');
      }
    }
  }, [poolRatio]);

  const parsedSlippage = parseFloat(slippage) || 1;
  const slippageError = parsedSlippage <= 0 ? 'Slippage must be > 0%' : '';
  const slippageWarning = parsedSlippage > 5 ? 'High slippage may result in unfavorable execution' : '';
  const parsedA = parseFloat(amountA) || 0;
  const parsedB = parseFloat(amountB) || 0;
  const balancesLoaded = !isLoadingBalances;
  // Auto-wrap: native DOGE can cover WWDOGE deficit (reserve 2 DOGE for gas)
  const gasReserve = 2;
  const availableNativeForWrap = Math.max(0, nativeDoge - gasReserve);
  const insufficientBalance = balancesLoaded && isConnected && (
    (isToken0WWDOGE ? parsedA > availableNativeForWrap : parsedA > rawBalANum) ||
    (isToken1WWDOGE ? parsedB > availableNativeForWrap : parsedB > rawBalBNum)
  );

  // Withdraw calculations
  const withdrawAmounts = lpBalance > 0n && totalSupply > 0n && reserve0 > 0n
    ? computeWithdrawAmounts(lpBalance, totalSupply, reserve0, reserve1, removePercent)
    : { amount0: 0n, amount1: 0n, liquidityToWithdraw: 0n };

  // Add LP handler — direct pair interaction (no router needed)
  const handleAddLiquidity = async () => {
    if (!address || !token0 || !token1 || parsedA <= 0 || parsedB <= 0) return;
    setIsPending(true);
    try {
      const amountADesired = parseUnits(parsedA.toString(), 18);
      const amountBDesired = parseUnits(parsedB.toString(), 18);
      const slippageBpsInt = BigInt(Math.floor(parsedSlippage * 100));
      const basisPoints = 10000n;
      await addLiquidity({
        token0,
        token1,
        amountADesired,
        amountBDesired,
        amountAMin: (amountADesired * (basisPoints - slippageBpsInt)) / basisPoints,
        amountBMin: (amountBDesired * (basisPoints - slippageBpsInt)) / basisPoints,
        slippageBps: Math.floor(parsedSlippage * 100),
        deadlineMinutes: Math.max(1, Math.min(60, parseInt(deadline) || 20)),
        recipient: address,
      });
      setAmountA('');
      setAmountB('');
      refetchLp();
      onClose();
    } catch {
      // toast handled in hook
    } finally {
      setIsPending(false);
    }
  };

  // Remove LP handler — direct pair interaction (no router needed)
  const handleRemoveLiquidity = async () => {
    if (!address || !token0 || !token1 || withdrawAmounts.liquidityToWithdraw <= 0n) return;
    setIsPending(true);
    try {
      const slippageBpsInt = BigInt(Math.floor(parsedSlippage * 100));
      const basisPoints = 10000n;
      await removeLiquidity({
        lpTokenAddress: pairAddress as `0x${string}`,
        tokenA: token0,
        tokenB: token1,
        liquidity: withdrawAmounts.liquidityToWithdraw,
        amountAMin: (withdrawAmounts.amount0 * (basisPoints - slippageBpsInt)) / basisPoints,
        amountBMin: (withdrawAmounts.amount1 * (basisPoints - slippageBpsInt)) / basisPoints,
        deadlineMinutes: Math.max(1, Math.min(60, parseInt(deadline) || 20)),
        recipient: address,
      });
      refetchLp();
      onClose();
    } catch {
      // toast handled in hook
    } finally {
      setIsPending(false);
    }
  };

  if (!isOpen) return null;

  // V3 pools can't do LP in Phase 1
  if (isV3) {
    return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center pt-20 pb-4 px-4 bg-black/60 backdrop-blur-sm overflow-y-auto" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
        <div className="bg-surface-container-low border border-primary/30 w-full max-w-md shadow-[0_0_50px_rgba(255,215,0,0.15)] p-6" onClick={e => e.stopPropagation()}>
          <div className="flex justify-between items-center mb-6">
            <h2 className="font-headline font-black text-xl uppercase tracking-tighter text-white">{poolName}</h2>
            <button onClick={onClose} className="text-on-surface-variant hover:text-primary transition-colors cursor-pointer">
              <X className="w-6 h-6" />
            </button>
          </div>
          <div className="flex flex-col items-center py-8 text-center">
            <AlertTriangle className="w-10 h-10 text-yellow-400 mb-4" />
            <p className="font-headline font-bold text-white uppercase mb-2">V3 LP Coming Soon</p>
            <p className="text-sm text-on-surface-variant">
              This pool uses concentrated liquidity (Algebra V3). LP management for V3 pools will be available in a future update.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const symA = symbol0 || tokenSymbol(token0);
  const symB = symbol1 || tokenSymbol(token1);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center pt-20 pb-4 px-4 bg-black/60 backdrop-blur-sm overflow-y-auto" onClick={(e) => { if (e.target === e.currentTarget && !isPending) onClose(); }}>
      <div className="bg-surface-container-low border border-primary/30 w-full max-w-md shadow-[0_0_50px_rgba(255,215,0,0.15)] flex flex-col max-h-[80vh] my-auto" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex justify-between items-center p-6 border-b border-outline-variant/15 shrink-0">
          <div className="flex items-center gap-3">
            <Droplets className="w-5 h-5 text-primary" />
            <h2 className="font-headline font-black text-xl uppercase tracking-tighter text-white">
              {mode === 'add' ? 'Add Liquidity' : 'Remove Liquidity'}
            </h2>
          </div>
          {!isPending && (
            <button onClick={onClose} className="text-on-surface-variant hover:text-primary transition-colors cursor-pointer">
              <X className="w-6 h-6" />
            </button>
          )}
        </div>

        <div className="p-6 overflow-y-auto flex-1">
          {isPoolLoading ? (
            <div className="flex flex-col items-center justify-center py-12">
              <Loader2 className="w-8 h-8 text-primary animate-spin mb-3" />
              <span className="font-headline text-xs uppercase tracking-widest text-on-surface-variant">Loading pool data...</span>
            </div>
          ) : (
          <>
          {/* Pool info */}
          <div className="bg-surface-container p-4 mb-6 border-l-4 border-primary">
            <span className="text-[10px] font-headline uppercase tracking-widest text-on-surface-variant block mb-1">Pool</span>
            <span className="font-headline font-bold text-white">{poolName}</span>
            {reserve0 > 0n && (
              <div className="text-xs text-on-surface-variant mt-2 font-mono">
                {Number(formatUnits(reserve0, 18)).toLocaleString(undefined, { maximumFractionDigits: 2 })} {symA} / {Number(formatUnits(reserve1, 18)).toLocaleString(undefined, { maximumFractionDigits: 2 })} {symB}
              </div>
            )}
            {poolRatio > 0 && (
              <div className="text-[10px] text-on-surface-variant mt-1">
                1 {symA} = {poolRatio.toFixed(6)} {symB}
              </div>
            )}
            {/* Low-liquidity warning */}
            {(reserve0 === 0n || reserve1 === 0n) && (
              <div className="flex items-center gap-2 mt-3 text-xs font-headline bg-yellow-900/20 border border-yellow-500/30 text-yellow-400 p-2">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                <span className="uppercase tracking-widest">Empty pool — first LP sets the ratio. Use high slippage (5%+).</span>
              </div>
            )}
            {totalSupply > 0n && totalSupply < parseUnits('100', 18) && (
              <div className="flex items-center gap-2 mt-3 text-xs font-headline bg-yellow-900/20 border border-yellow-500/30 text-yellow-400 p-2">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                <span className="uppercase tracking-widest">Low-liquidity pool — high slippage recommended (3%+).</span>
              </div>
            )}
          </div>

          {mode === 'add' ? (
            /* ─── ADD LIQUIDITY ─── */
            <div className="space-y-4">
              {/* Token A input */}
              <div className="bg-surface-container-low p-4 border-l-4 border-primary">
                <div className="flex justify-between text-xs font-headline uppercase text-on-surface-variant mb-2">
                  <span>{symA}</span>
                  <div className="flex items-center gap-2">
                    {isConnected && (
                      <>
                        <span>Balance: {balanceA.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 5 })}</span>
                        <button
                          onClick={() => {
                            const max = balanceA * 0.99;
                            if (max > 0) handleAmountAChange(max.toString());
                          }}
                          className="text-primary hover:text-white transition-colors px-1.5 py-0.5 bg-primary/10 border border-primary/20 text-[10px] active:scale-95 cursor-pointer"
                        >
                          MAX
                        </button>
                      </>
                    )}
                  </div>
                </div>
                <input
                  type="text"
                  value={amountA}
                  onChange={(e) => handleAmountAChange(e.target.value)}
                  className="w-full bg-transparent border-none p-0 text-2xl font-headline font-bold text-white focus:ring-0 outline-none"
                  placeholder="0.00"
                  disabled={isPending}
                />
              </div>

              {/* Token B input */}
              <div className="bg-surface-container-low p-4 border-l-4 border-outline-variant/30">
                <div className="flex justify-between text-xs font-headline uppercase text-on-surface-variant mb-2">
                  <span>{symB}</span>
                  <div className="flex items-center gap-2">
                    {isConnected && (
                      <>
                        <span>Balance: {balanceB.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 5 })}</span>
                        <button
                          onClick={() => {
                            const max = balanceB * 0.99;
                            if (max > 0) handleAmountBChange(max.toString());
                          }}
                          className="text-primary hover:text-white transition-colors px-1.5 py-0.5 bg-primary/10 border border-primary/20 text-[10px] active:scale-95 cursor-pointer"
                        >
                          MAX
                        </button>
                      </>
                    )}
                  </div>
                </div>
                <input
                  type="text"
                  value={amountB}
                  onChange={(e) => handleAmountBChange(e.target.value)}
                  className="w-full bg-transparent border-none p-0 text-2xl font-headline font-bold text-white focus:ring-0 outline-none"
                  placeholder="0.00"
                  disabled={isPending}
                />
              </div>

              {/* Slippage & deadline */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <span className="text-[10px] font-headline uppercase text-on-surface-variant block mb-1">Slippage</span>
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      value={slippage}
                      onChange={(e) => setSlippage(e.target.value)}
                      className="w-full bg-surface-container-highest border border-outline-variant/30 text-white text-right text-xs px-2 py-1.5 focus:border-primary outline-none"
                      disabled={isPending}
                    />
                    <span className="text-[10px] text-on-surface-variant">%</span>
                  </div>
                </div>
                <div>
                  <span className="text-[10px] font-headline uppercase text-on-surface-variant block mb-1">Deadline</span>
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      value={deadline}
                      onChange={(e) => setDeadline(e.target.value)}
                      className="w-full bg-surface-container-highest border border-outline-variant/30 text-white text-right text-xs px-2 py-1.5 focus:border-primary outline-none"
                      disabled={isPending}
                    />
                    <span className="text-[10px] text-on-surface-variant">min</span>
                  </div>
                </div>
              </div>

              {/* Slippage warning */}
              {slippageError && (
                <div className="flex items-center gap-2 p-3 text-xs font-headline bg-red-900/20 border border-red-500/30 text-red-400">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span className="uppercase tracking-widest">{slippageError}</span>
                </div>
              )}
              {!slippageError && slippageWarning && (
                <div className="flex items-center gap-2 p-3 text-xs font-headline bg-yellow-900/20 border border-yellow-500/30 text-yellow-400">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span className="uppercase tracking-widest">{slippageWarning}</span>
                </div>
              )}

              {/* Your LP balance */}
              {lpBalance > 0n && (
                <div className="text-xs font-headline text-on-surface-variant uppercase">
                  Your LP Balance: {fmtLp(lpBalance)}
                </div>
              )}

              {/* Low-liquidity warning for Add LP */}
              {((tvl !== undefined && tvl > 0 && tvl < 500) || (reserve0 > 0n && totalSupply < parseUnits('1000', 18))) && (
                <div className="flex items-start gap-2 p-3 text-xs font-headline bg-yellow-900/20 border border-yellow-500/30 text-yellow-400">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <div className="uppercase tracking-widest">
                    <span className="font-bold">Low-Liquidity Pool</span>
                    <span className="block mt-1 normal-case tracking-normal text-yellow-400/80">
                      This pool has limited liquidity. If your transaction fails, increase slippage to 3-5% and try again.
                    </span>
                  </div>
                </div>
              )}

              {/* Action buttons */}
              <div className="space-y-2 pt-2">
                <button
                  onClick={handleAddLiquidity}
                  disabled={isPending || isWrongNetwork || parsedA <= 0 || parsedB <= 0 || !isConnected || !!slippageError || insufficientBalance}
                  className={`w-full font-headline font-black text-lg py-4 uppercase tracking-tighter transition-all cursor-pointer ${
                    isPending || isWrongNetwork || parsedA <= 0 || parsedB <= 0 || !isConnected || !!slippageError || insufficientBalance
                      ? 'bg-surface-container-highest text-on-surface-variant cursor-not-allowed border border-outline-variant/30'
                      : 'bg-primary text-black shadow-[0_0_30px_rgba(255,215,0,0.3)] hover:bg-white hover:text-black active:scale-[0.98]'
                  }`}
                >
                  {isPending ? (
                    <span className="flex items-center justify-center gap-2">
                      <Loader2 className="w-5 h-5 animate-spin" />
                      Adding Liquidity...
                    </span>
                  ) : isWrongNetwork ? 'WRONG NETWORK' : !isConnected ? 'CONNECT WALLET' : slippageError ? 'INVALID SLIPPAGE' : insufficientBalance ? 'INSUFFICIENT BALANCE' : !balancesLoaded ? 'LOADING BALANCES...' : parsedA <= 0 || parsedB <= 0 ? 'ENTER AMOUNTS' : 'ADD LIQUIDITY'}
                </button>
              </div>
            </div>
          ) : (
            /* ─── REMOVE LIQUIDITY ─── */
            <div className="space-y-4">
              {/* LP balance */}
              <div className="bg-surface-container p-4 border-l-4 border-secondary">
                <span className="text-[10px] font-headline uppercase tracking-widest text-on-surface-variant block mb-1">Your LP Tokens</span>
                <span className="font-headline font-bold text-xl text-white">
                  {fmtLp(lpBalance)}
                </span>
              </div>

              {/* Percentage buttons */}
              <div>
                <span className="text-[10px] font-headline uppercase text-on-surface-variant block mb-2">Amount to Remove</span>
                <div className="flex gap-2">
                  {[25, 50, 75, 100].map(pct => (
                    <button
                      key={pct}
                      onClick={() => setRemovePercent(pct)}
                      className={`flex-1 py-2 text-xs font-headline font-bold uppercase cursor-pointer transition-colors ${
                        removePercent === pct
                          ? 'bg-primary/20 text-primary border border-primary/50'
                          : 'bg-surface-container-highest text-on-surface-variant border border-outline-variant/30 hover:border-primary/30'
                      }`}
                      disabled={isPending}
                    >
                      {pct}%
                    </button>
                  ))}
                </div>
              </div>

              {/* Expected output */}
              {withdrawAmounts.liquidityToWithdraw > 0n && (
                <div className="bg-surface-container p-4 border border-outline-variant/15 space-y-2">
                  <div className="flex justify-between text-xs font-headline uppercase text-on-surface-variant">
                    <span>You Receive</span>
                    <span className="text-white">{Number(formatUnits(withdrawAmounts.amount0, 18)).toLocaleString(undefined, { maximumFractionDigits: 4 })} {symA}</span>
                  </div>
                  <div className="flex justify-between text-xs font-headline uppercase text-on-surface-variant">
                    <span></span>
                    <span className="text-white">{Number(formatUnits(withdrawAmounts.amount1, 18)).toLocaleString(undefined, { maximumFractionDigits: 4 })} {symB}</span>
                  </div>
                </div>
              )}

              {/* Slippage */}
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-headline uppercase text-on-surface-variant">Slippage</span>
                <input
                  type="number"
                  value={slippage}
                  onChange={(e) => setSlippage(e.target.value)}
                  className="w-20 bg-surface-container-highest border border-outline-variant/30 text-white text-right text-xs px-2 py-1.5 focus:border-primary outline-none"
                  disabled={isPending}
                />
                <span className="text-[10px] text-on-surface-variant">%</span>
              </div>

              {/* Slippage warning */}
              {slippageError && (
                <div className="flex items-center gap-2 p-3 text-xs font-headline bg-red-900/20 border border-red-500/30 text-red-400">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span className="uppercase tracking-widest">{slippageError}</span>
                </div>
              )}
              {!slippageError && slippageWarning && (
                <div className="flex items-center gap-2 p-3 text-xs font-headline bg-yellow-900/20 border border-yellow-500/30 text-yellow-400">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span className="uppercase tracking-widest">{slippageWarning}</span>
                </div>
              )}

              {/* Action buttons */}
              <div className="space-y-2 pt-2">
                <button
                  onClick={() => setShowRemoveConfirm(true)}
                  disabled={isPending || isWrongNetwork || lpBalance <= 0n || !isConnected || !!slippageError}
                  className={`w-full font-headline font-black text-lg py-4 uppercase tracking-tighter transition-all cursor-pointer ${
                    isPending || isWrongNetwork || lpBalance <= 0n || !isConnected
                      ? 'bg-surface-container-highest text-on-surface-variant cursor-not-allowed border border-outline-variant/30'
                      : 'bg-secondary text-white shadow-[0_0_30px_rgba(157,0,255,0.3)] hover:bg-white hover:text-black active:scale-[0.98]'
                  }`}
                >
                  {isPending ? (
                    <span className="flex items-center justify-center gap-2">
                      <Loader2 className="w-5 h-5 animate-spin" />
                      Removing Liquidity...
                    </span>
                  ) : isWrongNetwork ? 'WRONG NETWORK' : !isConnected ? 'CONNECT WALLET' : slippageError ? 'INVALID SLIPPAGE' : lpBalance <= 0n ? 'NO LP POSITION' : 'REMOVE LIQUIDITY'}
                </button>
              </div>
            </div>
          )}
          </>
          )}
        </div>
      </div>

      {/* Remove LP confirmation overlay */}
      {showRemoveConfirm && !isPending && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center pt-20 pb-4 px-4 bg-black/70 backdrop-blur-sm overflow-y-auto" onClick={(e) => { if (e.target === e.currentTarget) setShowRemoveConfirm(false); }}>
          <div className="bg-surface-container-low border border-secondary/30 w-full max-w-sm shadow-[0_0_50px_rgba(157,0,255,0.15)] p-6" onClick={e => e.stopPropagation()}>
            <h3 className="font-headline font-black text-xl uppercase tracking-tighter text-white mb-4 border-b border-outline-variant/15 pb-3">Confirm Withdrawal</h3>

            <div className="space-y-3 mb-6">
              <div className="flex justify-between text-xs font-headline uppercase text-on-surface-variant">
                <span>Pool</span>
                <span className="text-white">{poolName}</span>
              </div>
              <div className="flex justify-between text-xs font-headline uppercase text-on-surface-variant">
                <span>Removing</span>
                <span className="text-white">{removePercent}% of LP position</span>
              </div>
              {withdrawAmounts.liquidityToWithdraw > 0n && (
                <>
                  <div className="flex justify-between text-xs font-headline uppercase text-on-surface-variant">
                    <span>You Receive</span>
                    <span className="text-white">{Number(formatUnits(withdrawAmounts.amount0, 18)).toLocaleString(undefined, { maximumFractionDigits: 4 })} {symA}</span>
                  </div>
                  <div className="flex justify-between text-xs font-headline uppercase text-on-surface-variant">
                    <span></span>
                    <span className="text-white">{Number(formatUnits(withdrawAmounts.amount1, 18)).toLocaleString(undefined, { maximumFractionDigits: 4 })} {symB}</span>
                  </div>
                </>
              )}
              <div className="flex justify-between text-xs font-headline uppercase text-on-surface-variant">
                <span>Slippage</span>
                <span className="text-secondary">{slippage}%</span>
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setShowRemoveConfirm(false)}
                className="flex-1 py-3 font-headline font-bold uppercase tracking-widest text-on-surface-variant border border-outline-variant/30 hover:bg-surface-container-highest transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={() => { setShowRemoveConfirm(false); handleRemoveLiquidity(); }}
                className="flex-1 py-3 font-headline font-black uppercase tracking-widest bg-secondary text-white hover:bg-white hover:text-black transition-colors shadow-[0_0_20px_rgba(157,0,255,0.2)] cursor-pointer"
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
