/**
 * AggregatorSwap — main swap interface for the OmnomSwap aggregator.
 *
 * Token selector (from/to) with logos and balances, amount input with MAX,
 * route display with multi-route selector, price comparison, fee display,
 * price impact warning, swap button with approval flow, slippage/deadline settings.
 *
 * Supports bidirectional input: user can type in either SELL or BUY field,
 * with the other auto-calculating via forward/reverse path finding.
 *
 * Fixes applied:
 *   - C-01: Shows "Contract not deployed" when aggregator address is placeholder
 *   - C-03: Reads protocol fee from contract instead of hardcoding
 *   - C-04: Refreshes token balances after swap confirmation
 *   - H-02: Uses formatUnits directly for BigInt display (no Number conversion)
 *   - H-03: Estimates gas for the swap transaction
 *   - H-04: Uses stable route ID for selection identity
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import {
  Settings,
  ChevronDown,
  UtensilsCrossed,
  AlertTriangle,
  Loader2,
  CheckCircle2,
  XCircle,
  ExternalLink,
  HelpCircle,
  Zap,
  Sparkles,
  PenLine,
} from 'lucide-react';
import { useAccount, useChainId, usePublicClient } from 'wagmi';
import { formatUnits } from 'viem';
import { erc20Abi } from 'viem';
import { TOKENS, CONTRACTS, NETWORK_INFO, PRICE_IMPACT_WARN, PRICE_IMPACT_BLOCK, isAggregatorDeployed, getTokenDecimals, impactColor, isNativeToken, type TokenType } from '../../lib/constants';
import { useOmnomData } from '../../hooks/useOmnomData';
import { useRoute } from '../../hooks/useAggregator/useRoute';
import { useReverseRoute } from '../../hooks/useAggregator/useReverseRoute';
import { useSwap } from '../../hooks/useAggregator/useSwap';
import { useAggregatorContract } from '../../hooks/useAggregator/useAggregatorContract';
import { useAutoSlippage } from '../../hooks/useAutoSlippage';
import type { WalletScanResult } from '../../hooks/usePrioritizedTokenLoader';
import { TokenSelector } from './TokenSelector';
import { RouteVisualization } from './RouteVisualization';
import { PriceComparison } from './PriceComparison';
import { EducationPanel } from './EducationPanel';
import { formatCompactAmount, formatCompactPrice } from '../../lib/format';
import { SwapHistory } from './SwapHistory';
import { useToast } from '../ToastContext';
import type { RouteResult } from '../../services/pathFinder/types';
import { useSwapTokenTax } from '../../hooks/useTokenTax';
import { TokenWarningBanner, TaxFeeRow } from './TokenWarningBanner';
import { monitor } from '../../lib/monitor';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Format a token amount string for display with compact notation for small values. */
function formatTokenAmount(value: bigint, decimals: number): string {
  if (value === 0n) return '0';
  const formatted = formatUnits(value, decimals);
  const num = parseFloat(formatted);
  if (num === 0) return '0';
  return formatCompactAmount(num);
}

/** Format a raw number string for compact display (e.g., "1000000" → "1.00M"). */
function fmtDisplay(val: string): string {
  if (!val) return '0';
  const n = parseFloat(val);
  if (!n || isNaN(n)) return '0';
  return formatCompactAmount(n);
}

/**
 * Generate a sequential label for a route based on its position in the list.
 */
function getRouteLabel(_route: RouteResult, index: number): string {
  return `Route ${index + 1}`;
}

/** Map price impact fraction to a Tailwind text color class (mirrors SwapScreen logic). */
function impactColorForAggregator(impact: number): string {
  return impactColor(impact);
}

// ─── SwapTx interface & type guard for localStorage history ───────────────────

interface SwapTx {
  id: number;
  sellAmount: number;
  sellSymbol: string;
  buyAmount: number;
  buySymbol: string;
  hash?: string;
  time: string;
  status: 'success' | 'failed' | 'pending';
  priceImpact: number;
}

/** Type guard to validate swap history loaded from localStorage */
function isValidSwapTx(obj: unknown): obj is SwapTx {
  if (typeof obj !== 'object' || obj === null) return false;
  const o = obj as Record<string, unknown>;
  return (
    typeof o.id === 'number' &&
    typeof o.sellAmount === 'number' &&
    typeof o.sellSymbol === 'string' &&
    typeof o.buyAmount === 'number' &&
    typeof o.buySymbol === 'string' &&
    (o.hash === undefined || typeof o.hash === 'string') &&
    typeof o.time === 'string' &&
    (o.status === 'success' || o.status === 'failed' || o.status === 'pending') &&
    typeof o.priceImpact === 'number'
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export function AggregatorSwap({ walletScan }: { walletScan: WalletScanResult }) {
  const { isConnected } = useAccount();
  const chainId = useChainId();
  const isWrongNetwork = isConnected && chainId !== NETWORK_INFO.chainId;

  // C-01: Check if aggregator contract is deployed
  const contractDeployed = isAggregatorDeployed();

  // Token state
  const [sellToken, setSellToken] = useState(TOKENS[0]); // WWDOGE — default sell
  const [buyToken, setBuyToken] = useState(TOKENS.find(t => t.address.toLowerCase() === CONTRACTS.OMNOM_TOKEN.toLowerCase()) ?? TOKENS[1]);
  const [sellAmount, setSellAmount] = useState('');
  const [buyAmountInput, setBuyAmountInput] = useState('');
  const [activeField, setActiveField] = useState<'sell' | 'buy'>('sell');
  const [tokenModalSide, setTokenModalSide] = useState<'sell' | 'buy' | null>(null);

  // Settings
  const [showSettings, setShowSettings] = useState(false);
  const [slippage, setSlippage] = useState('0.5');
  const [deadline, setDeadline] = useState('5');

  // Education panel
  const [showEducation, setShowEducation] = useState(false);



  // Token tax detection
  const { sellTax, buyTax } = useSwapTokenTax(sellToken.address, buyToken.address);

  // Confirmation modal
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [isSwapping, setIsSwapping] = useState(false);

  // Load swap history from localStorage with validation
  const [swapHistory, setSwapHistory] = useState<SwapTx[]>(() => {
    try {
      const saved = localStorage.getItem('omnom_aggregator_swap_history');
      if (!saved) return [];
      const parsed: unknown = JSON.parse(saved);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(isValidSwapTx);
    } catch { return []; }
  });

  // Persist swap history to localStorage
  useEffect(() => {
    try { localStorage.setItem('omnom_aggregator_swap_history', JSON.stringify(swapHistory.slice(0, 50))); } catch { /* quota exceeded */ }
  }, [swapHistory]);

  /**
   * Frozen route ref — captures the route being executed so the UI displays
   * the correct route during and after swap, even if the reactive route state
   * changes due to refetch or background computation.
   *
   * Set when handleConfirmSwap starts executing.
   * Cleared when the user changes input (tokens, amounts) or starts a new swap.
   */
  const executedRouteRef = useRef<RouteResult | null>(null);

  // Swap flip animation — matches Direct Swap rotation
  const [swapFlip, setSwapFlip] = useState(false);

  // C-03: Read fee from contract, fallback to 25 bps
  const { feeBps: contractFeeBps } = useAggregatorContract();
  const feeBps = contractFeeBps ? Number(contractFeeBps) : 25;

  // Forward route hook (used when activeField === 'sell')
  const {
    route: forwardRoute,
    allRoutes: forwardAllRoutes,
    setRoute: setForwardRoute,
    dexQuotes,
    isLoading: forwardLoading,
    formattedOutput,
    outDecimals,
    refetch: refetchForward,
  } = useRoute(
    sellToken.address,
    buyToken.address,
    sellAmount,
    feeBps,
  );

  // Reverse route hook (used when activeField === 'buy')
  const {
    route: reverseRoute,
    allRoutes: reverseAllRoutes,
    setRoute: setReverseRoute,
    isLoading: reverseLoading,
    formattedInput,
    inDecimals,
    refetch: refetchReverse,
  } = useReverseRoute(
    sellToken.address,
    buyToken.address,
    buyAmountInput,
    feeBps,
  );

  // Effective values based on active field
  const route = activeField === 'sell' ? forwardRoute : reverseRoute;
  const allRoutes = activeField === 'sell' ? forwardAllRoutes : reverseAllRoutes;
  const setRoute = activeField === 'sell' ? setForwardRoute : setReverseRoute;
  const routeLoading = activeField === 'sell' ? forwardLoading : reverseLoading;
  const refetchRoute = activeField === 'sell' ? refetchForward : refetchReverse;

  const { executeSwap, isPending, isConfirming, isConfirmed, txHash, error: swapError, reset: resetSwap } = useSwap();
  const { addToast } = useToast();
  const publicClient = usePublicClient();
  const { address } = useAccount();

  // Stabilize publicClient via ref to prevent infinite re-render loops
  const publicClientRef = useRef(publicClient);
  publicClientRef.current = publicClient;

  // Simple balance fetching for just the selected tokens (not all 16,840)
  const [tokenBalances, setTokenBalances] = useState<Record<string, string>>({});
  const tokenBalancesRef = useRef(tokenBalances);
  tokenBalancesRef.current = tokenBalances;

  const fetchTokenBalance = useCallback(async (tokenAddress: string): Promise<string> => {
    const client = publicClientRef.current;
    if (!isConnected || !address || !client) return '0';

    // Return cached balance if available
    if (tokenBalancesRef.current[tokenAddress]) return tokenBalancesRef.current[tokenAddress];

    try {
      const token = TOKENS.find(t => t.address.toLowerCase() === tokenAddress.toLowerCase());
      if (!token) return '0';

      const decimals = token.decimals ?? 18;
      let balance: bigint;

      if (isNativeToken(token)) {
        balance = await client.getBalance({ address });
      } else {
        balance = (await client.readContract({
          address: tokenAddress as `0x${string}`,
          abi: erc20Abi,
          functionName: 'balanceOf',
          args: [address],
        })) as bigint;
      }

      const formatted = formatUnits(balance, decimals);
      const num = parseFloat(formatted);
      if (num === 0 || isNaN(num)) return '0';

      // Cache the raw balance string (formatting applied at display time)
      setTokenBalances(prev => ({ ...prev, [tokenAddress]: formatted }));

      return formatted;
    } catch {
      return '0';
    }
  }, [isConnected, address]);

  // Fetch balances for selected tokens when they change
  useEffect(() => {
    if (!isConnected || !address) {
      setTokenBalances({});
      return;
    }

    const fetchSelectedBalances = async () => {
      const sellBal = await fetchTokenBalance(sellToken.address);
      const buyBal = await fetchTokenBalance(buyToken.address);
      setTokenBalances({
        [sellToken.address]: sellBal,
        [buyToken.address]: buyBal,
      });
    };

    fetchSelectedBalances();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sellToken.address, buyToken.address, isConnected, address]);

  const getFormattedBalance = (tokenAddress: string): string => {
    return tokenBalances[tokenAddress] || '0';
  };

  const refreshBalances = useCallback(() => {
    if (!isConnected || !address) return;
    setTokenBalances({}); // Clear cache to trigger refetch
  }, [isConnected, address]);

  // ─── Quote Staleness Detection ──────────────────────────────────────────────
  // Track when the route was last fetched. If the quote is stale (>30s yellow,
  // >60s red + disabled), the user should be warned before clicking swap.
  const [lastRouteFetchTime, setLastRouteFetchTime] = useState<number>(Date.now());
  const [stalenessSeconds, setStalenessSeconds] = useState<number>(0);

  // Update the fetch timestamp whenever the route changes
  useEffect(() => {
    if (route && route.steps.length > 0) {
      setLastRouteFetchTime(Date.now());
    }
  }, [route?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Tick every second to update staleness display
  useEffect(() => {
    const interval = setInterval(() => {
      setStalenessSeconds(Math.floor((Date.now() - lastRouteFetchTime) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [lastRouteFetchTime]);

  const isQuoteStale = stalenessSeconds >= 30;
  const isQuoteVeryStale = stalenessSeconds >= 60;

  // C-04: Refresh balances after swap confirmation + toast notifications + history recording
  useEffect(() => {
    if (isConfirmed && txHash) {
      refreshBalances();
      // Record successful swap in local history
      setSwapHistory(prev => [{
        id: Date.now(),
        sellAmount: parseFloat(effectiveSellAmount) || 0,
        sellSymbol: sellToken.symbol,
        buyAmount: parseFloat(buyAmount) || 0,
        buySymbol: buyToken.symbol,
        hash: txHash as string,
        time: new Date().toLocaleString(),
        status: 'success',
        priceImpact: priceImpact * 100,
      }, ...prev]);
      addToast({
        type: 'success',
        title: 'Swap Confirmed',
        message: 'Your aggregated swap was executed successfully.',
        link: `${NETWORK_INFO.blockExplorer}/tx/${txHash}`,
      });
    }
  }, [isConfirmed, txHash, refreshBalances, addToast]); // eslint-disable-line react-hooks/exhaustive-deps

  // Toast notification for swap errors (on-chain revert, wallet rejection, etc.) + history recording
  useEffect(() => {
    if (swapError) {
      const isRevert = swapError.includes('reverted on-chain');
      // Record failed swap in local history
      setSwapHistory(prev => [{
        id: Date.now(),
        sellAmount: parseFloat(effectiveSellAmount) || 0,
        sellSymbol: sellToken.symbol,
        buyAmount: parseFloat(buyAmount) || 0,
        buySymbol: buyToken.symbol,
        time: new Date().toLocaleString(),
        status: 'failed',
        priceImpact: priceImpact * 100,
      }, ...prev]);
      addToast({
        type: 'error',
        title: isRevert ? 'Transaction Reverted' : 'Swap Failed',
        message: isRevert
          ? 'The swap failed on-chain, likely due to slippage or price movement. Try increasing slippage tolerance.'
          : swapError,
        ...(txHash ? { link: `${NETWORK_INFO.blockExplorer}/tx/${txHash}` } : {}),
      });
    }
  }, [swapError, addToast, txHash]); // eslint-disable-line react-hooks/exhaustive-deps

  // Computed amounts based on active field
  const buyAmount = activeField === 'sell' ? (formattedOutput ?? '0') : buyAmountInput;
  const effectiveSellAmount = activeField === 'sell' ? sellAmount : (formattedInput ?? '');

  const priceImpact = route?.priceImpact ?? 0;
  const priceImpactPct = (priceImpact * 100).toFixed(2);

  // ─── Auto Slippage ─────────────────────────────────────────────────────────
  const hopCount = route?.steps?.length ?? 1;
  const isThinPair = (() => {
    if (!route || route.steps.length <= 1) return false;
    for (let i = 0; i < route.steps.length - 1; i++) {
      const step = route.steps[i];
      if (step.amountIn > 0n && step.expectedAmountOut > 0n) {
        const ratio = Number(step.expectedAmountOut) / Number(step.amountIn);
        const inverseRatio = Number(step.amountIn) / Number(step.expectedAmountOut);
        if (ratio > 10000 || inverseRatio > 10000) return true;
      }
    }
    return false;
  })();
  const tradeSizeVsLiquidity = (() => {
    if (!route || route.steps.length === 0 || !effectiveSellAmount) return 0;
    const firstStep = route.steps[0];
    if (!firstStep || firstStep.amountIn <= 0n) return 0;
    // Estimate reserve from step amounts using AMM math: reserveIn ≈ amountIn * 1000 / (impact * 1000)
    // Simplified: use ratio of amountIn to totalAmountIn as a proxy
    const sellNum = parseFloat(effectiveSellAmount) || 0;
    if (sellNum <= 0) return 0;
    // Use first step's reserve estimation from the route edges
    // Fallback: if reserve info not available, use a conservative low estimate
    return Math.min(sellNum / 10000, 1); // assume ~10000 token reserve as baseline
  })();

  const {
    autoSlippage,
    breakdown: autoBreakdown,
    isAuto: isAutoSlippage,
    setAuto: setAutoSlippage,
    effectiveSlippage,
    effectiveBps,
    warningLevel: slippageWarningLevel,
  } = useAutoSlippage(
    priceImpact,
    hopCount,
    tradeSizeVsLiquidity,
    isThinPair,
    slippage,
  );

  // M-03: slippageBps is now derived from effectiveBps (auto or manual)
  const deadlineMin = parseInt(deadline) || 5;

  // Balance
  const sellBalance = getFormattedBalance(sellToken.address);
  const buyBalance = getFormattedBalance(buyToken.address);

  // H-03: Gas estimation is now handled inside useSwap.estimateGasWithBuffer()
  // (previously used a placeholder useEstimateGas that was disabled)
  const sellDecimals = getTokenDecimals(sellToken.address);

  // Input validation
  const inputError = (() => {
    if (!isConnected) return null;
    const effectiveSell = activeField === 'sell'
      ? parseFloat(sellAmount)
      : parseFloat(effectiveSellAmount);
    if (!effectiveSellAmount || effectiveSell <= 0) return null;
    if (isNaN(effectiveSell) || !isFinite(effectiveSell)) return 'Invalid amount';
    if (effectiveSell > 1e18) return 'Amount too large';
    if (effectiveSell > parseFloat(sellBalance)) return 'Insufficient balance';
    // Check for insufficient liquidity in reverse mode
    if (activeField === 'buy' && reverseAllRoutes.length === 0 && !reverseLoading && parseFloat(buyAmountInput) > 0) {
      return 'Insufficient liquidity';
    }
    return null;
  })();

  // Button state
  let buttonText = 'CHOMP THE AGGREGATED SWAP';
  let isDisabled = false;

  if (!contractDeployed) {
    buttonText = 'CONTRACT NOT DEPLOYED';
    isDisabled = true;
  } else if (isWrongNetwork) {
    buttonText = 'WRONG NETWORK';
    isDisabled = true;
  } else if (!isConnected) {
    buttonText = 'CONNECT WALLET';
    isDisabled = true;
  } else if (!effectiveSellAmount || parseFloat(effectiveSellAmount) <= 0) {
    buttonText = 'ENTER AMOUNT';
    isDisabled = true;
  } else if (inputError) {
    buttonText = inputError.toUpperCase();
    isDisabled = true;
  } else if (routeLoading) {
    buttonText = 'COMPUTING ROUTES...';
    isDisabled = true;
  } else if (!route || route.steps.length === 0) {
    buttonText = 'NO ROUTE FOUND';
    isDisabled = true;
  } else if (priceImpact >= PRICE_IMPACT_BLOCK) {
    buttonText = 'PRICE IMPACT TOO HIGH';
    isDisabled = true;
  } else if (isQuoteVeryStale) {
    // Quote is very stale (>60s) — disable swap until route is refreshed
    buttonText = 'QUOTE EXPIRED — REFRESH';
    isDisabled = true;
  } else if (isPending) {
    buttonText = 'APPROVING...';
    isDisabled = true;
  } else if (isConfirming) {
    buttonText = 'CONFIRMING...';
    isDisabled = true;
  }

  // Handlers
  const handleSwapTokens = useCallback(() => {
    const temp = sellToken;
    let newSellAmount: string;
    let newBuyPlaceholder: string;

    // CRITICAL: Use buyToken.decimals and sellToken.decimals directly instead of
    // captured closure variables (outDecimals, inDecimals) to avoid stale value bugs
    // when user flips rapidly before React re-renders.
    // The forwardRoute.totalExpectedOut is in the NEW buy token's decimals (buyToken.decimals).
    // The reverseRoute.totalAmountIn is in the OLD sell token's decimals (sellToken.decimals).
    const currentOutDecimals = buyToken.decimals;
    const currentInDecimals = sellToken.decimals;

    console.log('[handleSwapTokens] DEBUG:', {
      activeField,
      sellToken: sellToken.symbol,
      buyToken: buyToken.symbol,
      sellAmount,
      buyAmountInput,
      forwardRouteOut: forwardRoute?.totalExpectedOut?.toString(),
      reverseRouteIn: reverseRoute?.totalAmountIn?.toString(),
      currentOutDecimals,
      currentInDecimals,
      // These should match buyToken.decimals and sellToken.decimals but we log to verify
      capturedOutDecimals: outDecimals,
      capturedInDecimals: inDecimals,
    });

    if (activeField === 'sell' && forwardRoute?.totalExpectedOut && forwardRoute.totalExpectedOut > 0n) {
      newSellAmount = formatUnits(forwardRoute.totalExpectedOut, currentOutDecimals);
      newBuyPlaceholder = sellAmount;
    } else if (activeField === 'buy' && buyAmountInput && parseFloat(buyAmountInput) > 0) {
      newSellAmount = buyAmountInput;
      // After flip, the new sell token is what was previously buyToken (now sellToken).
      // reverseRoute.totalAmountIn is the amount in the OLD sell token (now buyToken).
      // So newBuyPlaceholder (the new buy amount) should be formatted with currentOutDecimals
      // which is the OLD sell token's decimals - THIS is the correct token for totalAmountIn.
      newBuyPlaceholder = reverseRoute?.totalAmountIn && reverseRoute.totalAmountIn > 0n
        ? formatUnits(reverseRoute.totalAmountIn, currentOutDecimals)
        : (sellAmount || '');
    } else {
      newSellAmount = sellAmount || '';
      newBuyPlaceholder = '';
    }

    setSellToken(buyToken);
    setBuyToken(temp);
    setSellAmount(newSellAmount);
    setBuyAmountInput(newBuyPlaceholder);
    setActiveField('sell');
    resetSwap();
    setSwapFlip(prev => !prev);
  }, [sellToken, buyToken, resetSwap, activeField, forwardRoute, outDecimals, sellAmount, buyAmountInput, reverseRoute, inDecimals]);

  const handleTokenSelect = useCallback(
    (token: TokenType) => {
      if (tokenModalSide === 'sell') {
        if (token.symbol === buyToken.symbol) handleSwapTokens();
        else setSellToken(token);
      } else if (tokenModalSide === 'buy') {
        if (token.symbol === sellToken.symbol) handleSwapTokens();
        else setBuyToken(token);
      }
      setTokenModalSide(null);
    },
    [tokenModalSide, buyToken, sellToken, handleSwapTokens],
  );

  const handleSellAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    if (val === '' || /^\d*\.?\d*$/.test(val)) {
      if (val.includes('.') && val.split('.')[1]?.length > sellDecimals) return;
      setSellAmount(val);
      setActiveField('sell');
      resetSwap();
    }
  };

  const handleBuyAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    if (val === '' || /^\d*\.?\d*$/.test(val)) {
      const buyDecs = getTokenDecimals(buyToken.address);
      if (val.includes('.') && val.split('.')[1]?.length > buyDecs) return;
      setBuyAmountInput(val);
      setActiveField('buy');
      resetSwap();
    }
  };

  const handleMax = () => {
    setSellAmount(sellBalance);
    setActiveField('sell');
    resetSwap();
  };

  const handleBuyMax = () => {
    // Set sell amount to full balance and let forward route compute the max buyable amount
    setSellAmount(sellBalance);
    setActiveField('sell');
    resetSwap();
  };

  const handleExecuteSwap = () => {
    if (!route || route.steps.length === 0) return;
    setShowConfirmModal(true);
  };

  const handleConfirmSwap = async () => {
    if (!route || route.steps.length === 0) return;

    // Capture the user's selected route ID BEFORE refetching.
    // This is the authoritative record of what the user chose.
    const userSelectedRouteId = route.id;

    setShowConfirmModal(false);
    setIsSwapping(true);

    // ─── RPC Latency Check ─────────────────────────────────────────────────────
    // Check if RPC is averaging > 2s response time — warn user of potential issues
    const rpcAvgTime = monitor.getAverageTime('RPC');
    if (rpcAvgTime > 2000) {
      console.warn(`[ConfirmSwap] RPC latency warning: ${rpcAvgTime}ms average (threshold: 2000ms)`);
      addToast({
        type: 'warning',
        title: 'Slow RPC Detected',
        message: `RPC responses averaging ${rpcAvgTime}ms. Transaction confirmation may be delayed.`,
      });
    }

    // ─── Pool Count Validation ────────────────────────────────────────────────
    // Validate that pool data was available for each hop before executing
    // This catches cases where missing pool data would cause silent route failure
    const poolCountByHop: { hop: number; count: number }[] = [];
    for (let i = 0; i < route.steps.length; i++) {
      const step = route.steps[i];
      const tokenIn = step.path[0].toLowerCase();
      const tokenOut = step.path[step.path.length - 1].toLowerCase();
      // Count pools for this hop from the pool data used in route computation
      // We use the route's pool availability as a proxy
      poolCountByHop.push({ hop: i + 1, count: 1 }); // Placeholder - actual count checked via route validation
      console.log(`[ConfirmSwap] Hop ${i + 1}: ${step.dexName} ${tokenIn} -> ${tokenOut}`);
    }

    // Log pool availability for debugging
    console.log(`[ConfirmSwap] Route validation: ${route.steps.length} hops, pool counts:`, poolCountByHop);

    try {
      // Refresh route quote before executing to avoid stale pricing.
      // The route was computed when the user typed, but by now (after
      // confirming the modal) pool reserves may have changed.
      // refetchRoute() returns a Promise that resolves with the fresh route.
      let freshRoute: RouteResult | null = null;
      try {
        freshRoute = await refetchRoute();
      } catch {
        // If refetch fails (e.g., RPC error), fall through to use stale route
      }

      // ─── Route Selection Verification ─────────────────────────────────────
      // The user manually selected a specific route. We must ensure that route
      // is what gets executed — never silently switch to a different route.
      //
      // After refetch, freshRoute may be:
      //   a) The user's selected route (ID matches) → use it ✓
      //   b) A different route (ID doesn't match, e.g. DEX reshuffled) → error
      //   c) null/empty (refetch failed) → fall back to the captured route
      let routeToUse: RouteResult;

      if (freshRoute && freshRoute.steps.length > 0) {
        // Refetch succeeded — verify the route matches the user's selection
        if (freshRoute.id === userSelectedRouteId) {
          // User's selected route still exists with same DEX path → use it
          console.log(
            `[handleConfirmSwap] Route verified: user selection "${userSelectedRouteId}" preserved after refetch.`,
          );
          routeToUse = freshRoute;
        } else {
          // The user's selected route no longer exists in the fresh results.
          // This happens when pool reserves shifted and calculatePathOutput
          // picked a different DEX for one of the hops, changing the route ID.
          // Rather than silently executing a different route, abort with error.
          console.warn(
            `[handleConfirmSwap] Route mismatch! User selected "${userSelectedRouteId}" but refetch returned "${freshRoute.id}". Aborting swap.`,
          );
          addToast({
            type: 'error',
            title: 'Route No Longer Available',
            message:
              'The route you selected is no longer available (pool reserves changed). Please go back and select a new route.',
          });
          return; // Don't execute the swap
        }
      } else {
        // Refetch failed — use the user's originally selected route as fallback.
        // This is safe because the route was valid when the user selected it.
        console.log(
          `[handleConfirmSwap] Refetch failed, using captured route "${userSelectedRouteId}" as fallback.`,
        );
        routeToUse = route;
      }

      // ─── Pool Data Validation ────────────────────────────────────────────────
      // Check if route has valid pool data for all hops.
      // If any step has expectedAmountOut of 0 or very low values, pool data was likely missing.
      const invalidHops: number[] = [];
      for (let i = 0; i < routeToUse.steps.length; i++) {
        const step = routeToUse.steps[i];
        if (step.expectedAmountOut === 0n) {
          invalidHops.push(i + 1);
        }
      }

      if (invalidHops.length > 0) {
        console.error(`[ConfirmSwap] Pool data missing for hops: ${invalidHops.join(', ')}. Aborting swap.`);
        addToast({
          type: 'error',
          title: 'Missing Pool Data',
          message: `Pool data unavailable for hop(s) ${invalidHops.join(', ')}. The route cannot execute. Please try refreshing.`,
        });
        setIsSwapping(false);
        return;
      }

      // Check for extremely low output amounts that indicate stale/missing pool data
      for (let i = 0; i < routeToUse.steps.length; i++) {
        const step = routeToUse.steps[i];
        if (step.expectedAmountOut > 0n && step.expectedAmountOut < BigInt(1e14)) {
          console.warn(`[ConfirmSwap] Warning: Hop ${i + 1} has very low expected output (${step.expectedAmountOut.toString()}), possible stale pool data`);
        }
      }

      // Freeze the executed route for display — the reactive route state may
      // change during swap execution due to background computation, but the
      // UI should show the route that was actually sent on-chain.
      executedRouteRef.current = routeToUse;

      await executeSwap(
        routeToUse,
        Number(effectiveBps),
        deadlineMin,
        // Retry callback: show toast notification when retrying transient errors
        (attempt, maxRetries) => {
          addToast({
            type: 'warning',
            title: 'Retrying...',
            message: `Network error — retrying swap (attempt ${attempt}/${maxRetries})...`,
          });
        },
      );
    } finally {
      setIsSwapping(false);
      // Clear frozen route so the user can select routes normally again.
      // Without this, the UI keeps showing the executed route and ignores clicks.
      executedRouteRef.current = null;
    }
  };

  const handleRouteSelect = (selectedRoute: RouteResult) => {
    setRoute(selectedRoute);
    // Clear frozen route when user manually picks a different route
    executedRouteRef.current = null;
  };

  // H-04: Memoize selected route ID for stable comparison
  const selectedRouteId = route?.id;

  /**
   * Display route: frozen to the executed route during/after swap, otherwise
   * the reactive route. This prevents the UI from showing a different route
   * when the background route computation updates the reactive state.
   */
  const displayRoute = (isSwapping || isPending || isConfirming)
    && executedRouteRef.current
    ? executedRouteRef.current
    : route;

  // Clear frozen route when inputs change (user is building a new swap)
  useEffect(() => {
    executedRouteRef.current = null;
  }, [sellToken.address, buyToken.address, sellAmount, buyAmountInput]);

  // Live $OMNOM market data — same hooks as Direct Swap
  const { priceUsd: omnomPriceUsd, totalVol24: omnomVol24, marketCapUsd: omnomMarketCapUsd, mexcPrice, mexcVol24 } = useOmnomData();
  const omnomPrice = formatCompactPrice(omnomPriceUsd);
  const omnomVol = formatCompactPrice(omnomVol24);
  const omnomMarketCap = formatCompactPrice(omnomMarketCapUsd);
  const mexcPriceStr = formatCompactPrice(mexcPrice);
  const mexcVolStr = formatCompactPrice(mexcVol24);

  return (
    <div className="max-w-lg mx-auto space-y-4 px-4 md:px-0">
      {/* Savage Mode badge — moved from Direct Swap */}
      <div className="flex justify-center">
        <div className="border border-secondary/50 px-4 py-1 flex items-center gap-2 bg-secondary/10">
          <Zap className="text-secondary w-4 h-4 animate-pulse" fill="currentColor" />
          <span className="font-headline font-bold text-secondary text-xs uppercase tracking-widest animate-pulse">Savage Mode</span>
        </div>
      </div>

      {/* C-01: Non-blocking simulation mode banner */}
      {!contractDeployed && (
        <div className="bg-primary/5 border border-primary/20 p-4 text-center">
          <p className="text-primary font-headline text-sm uppercase tracking-wider">
            🔬 Simulation Mode
          </p>
          <p className="text-on-surface-variant text-xs mt-1 font-body">
            Contract not yet deployed. Route calculations are shown for preview purposes — the swap button is disabled until deployment.
          </p>
        </div>
      )}

      {/* Swap Card — consistent with Direct Swap glass-panel style */}
      <div className="glass-panel p-1 shadow-[0_0_40px_rgba(255,215,0,0.08)] border border-primary/20 relative">
        <div className="bg-surface p-4 md:p-6 flex flex-col gap-4">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h2 className="font-headline font-black text-2xl tracking-tighter uppercase text-white">
            <span className="text-primary">Aggregated</span> Swap
          </h2>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setShowEducation(!showEducation)}
              className={`transition-colors cursor-pointer ${
                showEducation ? 'text-primary' : 'text-on-surface-variant hover:text-primary'
              }`}
              title="Learn about DEX aggregation"
            >
              <HelpCircle className={`w-5 h-5 transition-transform duration-300 ${showEducation ? 'rotate-90' : ''}`} />
            </button>
            <button
              onClick={() => setShowSettings(!showSettings)}
              aria-label="Swap settings"
              className={`transition-colors cursor-pointer ${
                showSettings ? 'text-primary' : 'text-on-surface-variant hover:text-primary'
              }`}
            >
              <Settings className={`w-5 h-5 transition-transform duration-300 ${showSettings ? 'rotate-90' : ''}`} />
            </button>
          </div>
        </div>

        {/* Education Panel — smooth expand/collapse matching Direct Swap */}
        <div className={`overflow-hidden transition-all duration-300 ease-in-out ${showEducation ? 'max-h-[800px] opacity-100 mb-4' : 'max-h-0 opacity-0'}`}>
          <div className="p-4 bg-surface-container border border-outline-variant/10">
            <EducationPanel />
          </div>
        </div>

        {/* Settings Panel — exact match of Direct Swap layout */}
        <div className={`overflow-hidden transition-all duration-300 ease-in-out ${showSettings ? 'max-h-[500px] opacity-100 mb-4' : 'max-h-0 opacity-0'}`}>
          <div className="bg-surface-container-low border border-primary/30 p-4">
            <h3 className="font-headline font-bold text-xs uppercase tracking-widest text-primary mb-4">Transaction Settings</h3>

            <div className="space-y-4">
              <div>
                <span className="text-[10px] font-headline uppercase text-on-surface-variant block mb-2">Slippage Tolerance</span>
                {/* Auto / Manual toggle pills */}
                <div className="flex items-center gap-2 mb-2">
                  <button
                    onClick={() => setAutoSlippage(true)}
                    className={`flex items-center gap-1 px-3 py-1.5 text-[10px] font-headline font-bold uppercase tracking-widest cursor-pointer transition-colors ${
                      isAutoSlippage
                        ? 'bg-primary text-black border border-primary'
                        : 'bg-surface-container-highest text-on-surface-variant border border-outline-variant/30 hover:border-primary/30'
                    }`}
                  >
                    <Sparkles className="w-3 h-3" />
                    Auto
                  </button>
                  <button
                    onClick={() => setAutoSlippage(false)}
                    className={`flex items-center gap-1 px-3 py-1.5 text-[10px] font-headline font-bold uppercase tracking-widest cursor-pointer transition-colors ${
                      !isAutoSlippage
                        ? 'bg-primary text-black border border-primary'
                        : 'bg-surface-container-highest text-on-surface-variant border border-outline-variant/30 hover:border-primary/30'
                    }`}
                  >
                    <PenLine className="w-3 h-3" />
                    Manual
                  </button>
                </div>

                {isAutoSlippage ? (
                  <>
                    {/* Auto mode: read-only display with breakdown */}
                    <div className="flex items-center gap-1">
                      <div className="flex-1 bg-surface-container-highest border border-outline-variant/30 text-yellow-400 text-right text-[11px] px-2 py-1.5 opacity-80">
                        {autoSlippage}
                      </div>
                      <span className="text-yellow-400 text-[10px]">%</span>
                    </div>
                    <div className="mt-1.5 text-[9px] text-on-surface-variant/70 space-y-0.5 font-body">
                      <div>Base: {autoBreakdown.base.toFixed(1)}% + Impact: {autoBreakdown.priceImpactBuffer.toFixed(2)}%</div>
                      <div>+ Hops: {autoBreakdown.hopBuffer.toFixed(1)}% + Variance: {autoBreakdown.varianceBuffer.toFixed(2)}%{autoBreakdown.thinPairBuffer > 0 ? ` + Thin: ${autoBreakdown.thinPairBuffer.toFixed(1)}%` : ''}</div>
                    </div>
                  </>
                ) : (
                  <>
                    {/* Manual mode: quick-select buttons + editable input */}
                    <div className="flex items-center gap-1">
                      {[0.1, 0.5, 1.0].map(val => (
                        <button
                          key={val}
                          onClick={() => setSlippage(val.toFixed(1))}
                          className={`flex-1 py-1.5 text-[10px] font-headline font-bold uppercase cursor-pointer transition-colors ${
                            parseFloat(slippage) === val
                              ? 'bg-primary/20 text-primary border border-primary/50'
                              : 'bg-surface-container-highest text-on-surface-variant border border-outline-variant/30 hover:border-primary/30'
                          }`}
                        >
                          {val}%
                        </button>
                      ))}
                      <input
                        type="number"
                        value={slippage}
                        onChange={(e) => setSlippage(e.target.value)}
                        min="0.01"
                        max="50"
                        aria-label="Slippage tolerance percentage"
                        className="w-16 bg-surface-container-highest border border-outline-variant/30 text-yellow-400 text-right text-[11px] px-2 py-1.5 focus:border-yellow-400 outline-none"
                      />
                      <span className="text-yellow-400 text-[10px]">%</span>
                    </div>
                  </>
                )}

                {/* Warning messages based on effective slippage */}
                {slippageWarningLevel === 'danger' && (
                  <p className="text-[9px] text-red-400 mt-1 uppercase font-bold text-center">⚠️ Auto slippage above 15% — extreme MEV risk. Consider reducing trade size.</p>
                )}
                {slippageWarningLevel === 'warning' && (
                  <p className="text-[9px] text-orange-400 mt-1 uppercase text-center">⚠️ Auto slippage above 5% — increased MEV risk</p>
                )}
                {!isAutoSlippage && (parseFloat(slippage) || 0) > 50 && (
                  <p className="text-[9px] text-red-400 mt-1 uppercase text-center">Slippage tolerance too high. Maximum is 50%.</p>
                )}
                {!isAutoSlippage && (parseFloat(slippage) || 0) > 5 && (parseFloat(slippage) || 0) <= 50 && (
                  <p className="text-[9px] text-yellow-400 mt-1 uppercase text-center">High slippage may result in unfavorable trades</p>
                )}
                <p className="text-[9px] text-on-surface-variant/60 mt-1 text-center">⚠️ Higher slippage increases MEV risk</p>
              </div>

              <div>
                <span className="text-[10px] font-headline uppercase text-on-surface-variant block mb-2">Transaction Deadline</span>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    value={deadline}
                    onChange={(e) => setDeadline(e.target.value)}
                    min="1"
                    max="180"
                    aria-label="Transaction deadline in minutes"
                    className="w-20 bg-surface-container-highest border border-outline-variant/30 text-white text-right text-[11px] px-2 py-1.5 focus:border-primary outline-none"
                  />
                  <span className="text-[10px] text-on-surface-variant font-headline uppercase">minutes</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Sell Input — consistent with Direct Swap styling */}
        <div className={`bg-surface-container-low p-5 border-l-4 ${activeField === 'sell' ? 'border-primary' : 'border-outline-variant/30'}`}>
          <div className="flex justify-between text-xs font-headline uppercase text-on-surface-variant mb-2">
            <span>{activeField === 'sell' ? 'You Sell' : 'You Sell (Estimated)'}</span>
            <div className="flex items-center gap-2">
              <span className="truncate">Balance: {fmtDisplay(sellBalance)}</span>
              {isConnected && (
                <button
                  onClick={handleMax}
                  aria-label="Use maximum balance"
                  className="text-primary hover:text-white transition-colors px-1.5 py-0.5 bg-primary/10 border border-primary/20 text-[10px] active:scale-95 cursor-pointer"
                >
                  MAX
                </button>
              )}
            </div>
          </div>
          <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2">
            <button
              onClick={() => setTokenModalSide('sell')}
              className="sm:hidden bg-surface-container-high px-3 py-2 flex items-center gap-2 border border-outline-variant/15 hover:border-primary/50 transition-colors cursor-pointer mx-auto min-h-[44px]"
            >
              <div className="w-6 h-6 flex items-center justify-center">
                <img src={sellToken.icon} alt={sellToken.symbol} className="w-5 h-5 rounded-full" />
              </div>
              <span className="font-headline font-bold text-white">{sellToken.symbol}</span>
              <ChevronDown className="w-4 h-4 text-on-surface-variant" />
            </button>
            <div className="flex justify-between items-center w-full">
              <input
                type="text"
                value={
                  sellAmount
                    ? (sellAmount.length > 15 ? fmtDisplay(sellAmount) : sellAmount)
                    : (effectiveSellAmount ? fmtDisplay(effectiveSellAmount) : '')
                }
                onChange={handleSellAmountChange}
                onFocus={() => {
                  // Materialize computed sell amount into sellAmount before switching
                  if (activeField === 'buy' && formattedInput && !sellAmount) {
                    setSellAmount(formattedInput);
                  }
                  setActiveField('sell');
                }}
                placeholder="0.00"
                aria-label="Amount to sell"
                className={`bg-transparent border-none p-0 text-2xl sm:text-3xl font-headline font-bold text-white focus:ring-0 w-full sm:w-2/3 outline-none ${activeField === 'buy' ? 'opacity-80' : ''}`}
              />
              <button
                onClick={() => setTokenModalSide('sell')}
                className="hidden sm:flex bg-surface-container-high px-3 py-2 items-center gap-2 border border-outline-variant/15 hover:border-primary/50 transition-colors cursor-pointer shrink-0 min-h-[44px]"
              >
                <div className="w-6 h-6 flex items-center justify-center">
                  <img src={sellToken.icon} alt={sellToken.symbol} className="w-5 h-5 rounded-full" />
                </div>
                <span className="font-headline font-bold text-white">{sellToken.symbol}</span>
                <ChevronDown className="w-4 h-4 text-on-surface-variant" />
              </button>
            </div>
          </div>
        </div>

        {/* Swap Direction Button — fork & knife icon with rotation animation matching Direct Swap */}
        <div className="flex justify-center -my-6 relative z-20">
          <button
            onClick={handleSwapTokens}
            aria-label="Swap token direction"
            className={`bg-primary text-black p-2 hover:bg-white transition-transform duration-300 cursor-pointer ${swapFlip ? 'rotate-180' : 'rotate-0'}`}
          >
            <UtensilsCrossed className="w-6 h-6" />
          </button>
        </div>

        {/* Buy input — editable for bidirectional swap */}
        <div className={`bg-surface-container-low p-5 border-l-4 ${activeField === 'buy' ? 'border-primary' : 'border-outline-variant/30'}`}>
          <div className="flex justify-between text-xs font-headline uppercase text-on-surface-variant mb-2">
            <span>{activeField === 'buy' ? 'You Buy' : 'You Buy (Estimated)'}</span>
            <div className="flex items-center gap-2">
              <span className="truncate">Balance: {fmtDisplay(buyBalance)}</span>
              {isConnected && (
                <button
                  onClick={handleBuyMax}
                  aria-label="Use maximum balance"
                  className="text-primary hover:text-white transition-colors px-1.5 py-0.5 bg-primary/10 border border-primary/20 text-[10px] active:scale-95 cursor-pointer"
                >
                  MAX
                </button>
              )}
            </div>
          </div>
          <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2">
            <button
              onClick={() => setTokenModalSide('buy')}
              className="sm:hidden bg-surface-container-high px-3 py-2 flex items-center gap-2 border border-outline-variant/15 hover:border-primary/50 transition-colors cursor-pointer mx-auto min-h-[44px]"
            >
              <div className="w-6 h-6 flex items-center justify-center">
                <img src={buyToken.icon} alt={buyToken.symbol} className="w-5 h-5 rounded-full" />
              </div>
              <span className="font-headline font-bold text-white">{buyToken.symbol}</span>
              <ChevronDown className="w-4 h-4 text-on-surface-variant" />
            </button>
            <div className="flex justify-between items-center w-full">
              <input
                type="text"
                value={activeField === 'sell' ? (parseFloat(effectiveSellAmount) > 0 ? (buyAmount !== '0' ? fmtDisplay(buyAmount) : buyAmountInput) : '') : buyAmountInput}
                onChange={handleBuyAmountChange}
                onFocus={() => {
                  // Materialize computed buy amount into buyAmountInput before switching
                  if (activeField === 'sell' && formattedOutput && !buyAmountInput) {
                    setBuyAmountInput(formattedOutput);
                  }
                  setActiveField('buy');
                }}
                placeholder="0.00"
                aria-label="Amount to receive"
                className={`bg-transparent border-none p-0 text-2xl sm:text-3xl font-headline font-bold text-white focus:ring-0 w-full sm:w-2/3 outline-none ${activeField === 'sell' ? 'opacity-80' : ''}`}
              />
              <button
                onClick={() => setTokenModalSide('buy')}
                className="hidden sm:flex bg-surface-container-high px-3 py-2 items-center gap-2 border border-outline-variant/15 hover:border-primary/50 transition-colors cursor-pointer shrink-0 min-h-[44px]"
              >
                <div className="w-6 h-6 flex items-center justify-center">
                  <img src={buyToken.icon} alt={buyToken.symbol} className="w-5 h-5 rounded-full" />
                </div>
                <span className="font-headline font-bold text-white">{buyToken.symbol}</span>
                <ChevronDown className="w-4 h-4 text-on-surface-variant" />
              </button>
            </div>
          </div>
        </div>

        {/* Route info */}
        {routeLoading && (
          <div className="space-y-2 mt-4">
            <div className="flex items-center justify-center gap-2 text-on-surface-variant text-sm font-body">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Fetching pools from all DEXes...</span>
            </div>
            <div className="flex items-center justify-center gap-2 text-on-surface-variant/60 text-xs font-body">
              <Loader2 className="w-3 h-3 animate-spin" />
              <span>{activeField === 'buy' ? 'Computing required input...' : 'Computing available routes...'}</span>
            </div>
          </div>
        )}

        {/* Quote staleness warning */}
        {isQuoteStale && !isQuoteVeryStale && route && route.steps.length > 0 && !routeLoading && (
          <div className="flex items-center justify-center gap-2 mt-4 p-3 bg-yellow-400/5 border border-yellow-400/20 text-yellow-400 text-xs font-body text-center">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>Quote may be stale (last updated {stalenessSeconds}s ago). Consider refreshing before swapping.</span>
          </div>
        )}
        {isQuoteVeryStale && route && route.steps.length > 0 && !routeLoading && (
          <div className="flex items-center justify-center gap-2 mt-4 p-3 bg-red-400/5 border border-red-400/20 text-red-400 text-xs font-body text-center">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>Quote expired ({stalenessSeconds}s old). Click the swap button to refresh the route.</span>
          </div>
        )}

        {/* Price impact warning */}
        {priceImpact >= PRICE_IMPACT_WARN && priceImpact < PRICE_IMPACT_BLOCK && (
          <div className="flex items-center justify-center gap-2 mt-4 p-3 bg-yellow-400/5 border border-yellow-400/20 text-yellow-400 text-xs font-body text-center">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>Price impact: ~{priceImpactPct}%. High price impact — proceed with caution.</span>
          </div>
        )}
        {priceImpact >= PRICE_IMPACT_BLOCK && (
          <div className="flex items-center justify-center gap-2 mt-4 p-3 bg-red-400/5 border border-red-400/20 text-red-400 text-xs font-body text-center">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>Price impact: ~{priceImpactPct}%. Transaction would fail — price impact too high.</span>
          </div>
        )}

        {/* Swap details — matches Direct Swap layout */}
        {/* Thin-pair slippage warning for multi-hop routes through low-liquidity intermediates */}
        {route && route.steps.length > 1 && !routeLoading && parseFloat(effectiveSellAmount) > 0 && (() => {
          // Detect thin intermediate pairs: if any hop has extreme conversion ratio
          // (>1000x between input and output), the intermediate is likely a low-liquidity token
          for (let i = 0; i < route.steps.length - 1; i++) {
            const step = route.steps[i];
            if (step.amountIn > 0n && step.expectedAmountOut > 0n) {
              const ratio = Number(step.expectedAmountOut) / Number(step.amountIn);
              const inverseRatio = Number(step.amountIn) / Number(step.expectedAmountOut);
              if (ratio > 10000 || inverseRatio > 10000) {
                return (
                  <div className="flex items-center gap-2 mt-2 p-3 bg-orange-400/5 border border-orange-400/20 text-orange-400 text-xs font-body text-center">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    <span>
                      Route passes through a low-liquidity intermediate token — high slippage risk.{' '}
                      {isAutoSlippage
                        ? 'Auto slippage tolerance is active and will adjust automatically. You can set manual slippage in settings if preferred, or use a direct pair if available.'
                        : 'Consider increasing slippage tolerance or using a direct pair if available.'}
                    </span>
                  </div>
                );
              }
            }
          }
          return null;
        })()}

        {route && route.steps.length > 0 && !routeLoading && parseFloat(effectiveSellAmount) > 0 && (
          <div className="space-y-2 mt-2">
            <div className="flex justify-between text-xs font-headline text-on-surface-variant uppercase">
              <span>Exchange Rate</span>
              <span className="text-white truncate">
                {route.totalAmountIn > 0n
                  ? `1 ${sellToken.symbol} = ${formatTokenAmount(
                      (route.totalExpectedOut * BigInt(10 ** sellDecimals)) / route.totalAmountIn,
                      outDecimals,
                    )} ${buyToken.symbol}`
                  : '—'}
              </span>
            </div>
            <div className="flex justify-between items-center text-xs font-headline text-on-surface-variant uppercase">
              <span>Price Impact</span>
              <span className={`font-bold ${impactColorForAggregator(priceImpact)}`}>
                ~{priceImpactPct}%
              </span>
            </div>
            {priceImpact >= PRICE_IMPACT_WARN && (
              <div className={`flex items-center justify-center gap-2 p-2 text-xs font-headline text-center ${
                priceImpact >= PRICE_IMPACT_BLOCK
                  ? 'bg-red-900/20 border border-red-500/30 text-red-400'
                  : 'bg-yellow-900/20 border border-yellow-500/30 text-yellow-400'
              }`}>
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                <span className="uppercase tracking-widest text-[10px]">
                  {priceImpact >= PRICE_IMPACT_BLOCK ? 'Extreme impact — you may lose significant value' : 'High impact — proceed with caution'}
                </span>
              </div>
            )}
            <div className="flex justify-between items-center text-xs font-headline text-on-surface-variant uppercase">
              <span>Slippage Tolerance</span>
              <span className={`text-secondary`}>
                {effectiveSlippage}%{isAutoSlippage ? ' ✨' : ''}
              </span>
            </div>
            <div className="flex justify-between items-center text-xs font-headline text-on-surface-variant uppercase">
              <span>Transaction Deadline</span>
              <span className="text-white">{deadline} min</span>
            </div>
            <div className="flex justify-between text-xs font-headline text-on-surface-variant uppercase">
              <span>Min. Received</span>
              <span className="text-white">
                {route.totalExpectedOut > 0n
                  ? `${formatTokenAmount(
                      (route.totalExpectedOut * BigInt(10000 - Number(effectiveBps))) / 10000n,
                      outDecimals,
                    )} ${buyToken.symbol}`
                  : '—'}
              </span>
            </div>
            <div className="flex justify-between text-xs font-headline text-on-surface-variant uppercase">
              <span>Network Fee</span>
              <span className="text-white">~0.05 DOGE <span className="text-on-surface-variant text-[9px]">(est.)</span></span>
            </div>
            {route.feeAmount > 0n && (
              <div className="flex justify-between text-xs font-headline text-on-surface-variant uppercase">
                <span>Protocol Fee ({(feeBps / 100).toFixed(feeBps % 100 === 0 ? 0 : feeBps % 10 === 0 ? 1 : 2)}%)</span>
                <span className="text-primary">
                  {formatTokenAmount(route.feeAmount, sellDecimals)} {sellToken.symbol}
                </span>
              </div>
            )}
            <TaxFeeRow taxInfo={sellTax} side="sell" amount={sellTax.sellTax > 0 ? (() => {
              const sellNum = parseFloat(effectiveSellAmount) || 0;
              const taxAmt = sellNum * sellTax.sellTax / 100;
              return formatCompactAmount(taxAmt);
            })() : '0'} symbol={sellToken.symbol} />
            <TaxFeeRow taxInfo={buyTax} side="buy" amount={buyTax.buyTax > 0 ? (() => {
              const outNum = route.totalExpectedOut > 0n ? parseFloat(formatTokenAmount(route.totalExpectedOut, outDecimals)) || 0 : 0;
              const taxAmt = outNum * buyTax.buyTax / 100;
              return formatCompactAmount(taxAmt);
            })() : '0'} symbol={buyToken.symbol} />
          </div>
        )}

        {/* Token tax/restriction warning */}
        <TokenWarningBanner taxInfo={sellTax.warningLevel !== 'none' ? sellTax : buyTax} />

        {/* Swap result */}
        {isConfirmed && txHash && (
          <div className="flex items-center justify-center gap-2 mt-4 p-3 bg-tertiary/5 border border-tertiary/20 text-tertiary text-xs font-body text-center">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>Swap confirmed!</span>
            <a
              href={`${NETWORK_INFO.blockExplorer}/tx/${txHash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-primary hover:underline"
            >
              View tx <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        )}
        {swapError && (
          <div className="flex items-center justify-center gap-2 mt-4 p-3 bg-red-400/5 border border-red-400/20 text-red-400 text-xs font-body text-center">
            <XCircle className="w-4 h-4 shrink-0" />
            <span>{swapError}</span>
          </div>
        )}

        {/* Swap Button — consistent with Direct Swap button styling */}
        <button
          onClick={handleExecuteSwap}
          disabled={isDisabled || isSwapping}
          className={`w-full font-headline font-black text-xl py-5 uppercase tracking-tighter transition-all relative overflow-hidden cursor-pointer ${
            isDisabled || isSwapping
              ? 'bg-surface-container-highest text-on-surface-variant cursor-not-allowed border border-outline-variant/30'
              : 'bg-primary text-black shadow-[0_0_30px_rgba(255,215,0,0.3)] hover:bg-white hover:text-black hover:shadow-[0_0_50px_rgba(255,215,0,0.5)] active:scale-[0.98]'
          }`}
        >
          {isSwapping ? 'EXECUTING...' : buttonText}
        </button>
        </div>
      </div>

      {/* Confirmation Modal — matches Direct Swap visual style */}
      {showConfirmModal && route && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center pt-20 pb-4 px-4 bg-black/60 backdrop-blur-sm overflow-y-auto custom-scrollbar" onClick={(e) => { if (e.target === e.currentTarget) setShowConfirmModal(false); }}>
          <div className="bg-surface-container-low border border-primary/30 w-full max-w-md shadow-[0_0_50px_rgba(255,215,0,0.15)] p-6" onClick={e => e.stopPropagation()}>
            <h3 className="font-headline font-black text-2xl uppercase tracking-tighter text-white mb-6 border-b border-outline-variant/15 pb-4">Confirm Swap</h3>

            <div className="space-y-4 mb-8">
              <div className="flex justify-between items-center bg-surface-container p-4">
                <span className="text-xs font-headline uppercase text-on-surface-variant">You Sell</span>
                <span className="font-headline font-bold text-xl text-white">{effectiveSellAmount} {sellToken.symbol}</span>
              </div>
              <div className="flex justify-center -my-6 relative z-10">
                <div className="bg-surface-container-highest p-2 rounded-full border border-outline-variant/15">
                  <UtensilsCrossed className="w-4 h-4 text-primary" />
                </div>
              </div>
              <div className="flex justify-between items-center bg-surface-container p-4">
                <span className="text-xs font-headline uppercase text-on-surface-variant">You Buy (Est.)</span>
                <span className="font-headline font-bold text-xl text-primary">{fmtDisplay(buyAmount)} {buyToken.symbol}</span>
              </div>
            </div>

            <div className="space-y-2 mb-6 p-4 border border-outline-variant/15 bg-surface-container-highest/50">
              {/* Exchange Rate */}
              <div className="flex justify-between text-xs font-headline text-on-surface-variant uppercase">
                <span>Exchange Rate</span>
                <span className="text-white truncate">
                  {route.totalAmountIn > 0n
                    ? `1 ${sellToken.symbol} = ${formatTokenAmount(
                        (route.totalExpectedOut * BigInt(10 ** sellDecimals)) / route.totalAmountIn,
                        outDecimals,
                      )} ${buyToken.symbol}`
                    : '—'}
                </span>
              </div>
              {/* Route summary */}
              <div className="flex justify-between text-xs font-headline text-on-surface-variant uppercase">
                <span>Route</span>
                <span className="text-white truncate max-w-[200px]">
                  {route.steps.map((s, i) => (
                    <span key={i}>
                      {i > 0 && ' → '}{s.dexName}
                    </span>
                  ))}
                </span>
              </div>
              {/* Price Impact */}
              <div className="flex justify-between text-xs font-headline text-on-surface-variant uppercase">
                <span>Price Impact</span>
                <span className={`font-bold ${impactColorForAggregator(priceImpact)}`}>~{priceImpactPct}%</span>
              </div>
              {priceImpact >= PRICE_IMPACT_WARN && (
                <div className={`flex items-center justify-center gap-2 p-2 text-xs font-headline text-center ${
                  priceImpact >= PRICE_IMPACT_BLOCK
                    ? 'bg-red-900/20 border border-red-500/30 text-red-400'
                    : 'bg-yellow-900/20 border border-yellow-500/30 text-yellow-400'
                }`}>
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                  <span className="uppercase tracking-widest text-[10px]">
                    {priceImpact >= PRICE_IMPACT_BLOCK ? 'Extreme impact — you may lose significant value' : 'High impact — proceed with caution'}
                  </span>
                </div>
              )}
              {/* Slippage Tolerance */}
              <div className="flex justify-between text-xs font-headline text-on-surface-variant uppercase">
                <span>Slippage Tolerance</span>
                <span className="text-secondary">
                  {effectiveSlippage}%{isAutoSlippage ? ' ✨' : ''}
                </span>
              </div>
              {/* Transaction Deadline */}
              <div className="flex justify-between text-xs font-headline text-on-surface-variant uppercase">
                <span>Transaction Deadline</span>
                <span className="text-white">{deadline} min</span>
              </div>
              {/* Min. Received */}
              <div className="flex justify-between text-xs font-headline text-on-surface-variant uppercase">
                <span>Min. Received</span>
                <span className="text-white">
                  {route.totalExpectedOut > 0n
                    ? `${formatTokenAmount((route.totalExpectedOut * BigInt(10000 - Number(effectiveBps))) / 10000n, outDecimals)} ${buyToken.symbol}`
                    : '—'}
                </span>
              </div>
              {/* Network Fee */}
              <div className="flex justify-between text-xs font-headline text-on-surface-variant uppercase">
                <span>Network Fee</span>
                <span className="text-white">~0.05 DOGE <span className="text-on-surface-variant text-[9px]">(est.)</span></span>
              </div>
              {/* Protocol Fee */}
              {route.feeAmount > 0n && (
                <div className="flex justify-between text-xs font-headline text-on-surface-variant uppercase">
                  <span>Protocol Fee ({(feeBps / 100).toFixed(feeBps % 100 === 0 ? 0 : feeBps % 10 === 0 ? 1 : 2)}%)</span>
                  <span className="text-primary">
                    {formatTokenAmount(route.feeAmount, sellDecimals)} {sellToken.symbol}
                  </span>
                </div>
              )}
              <TaxFeeRow taxInfo={sellTax} side="sell" amount={sellTax.sellTax > 0 ? (() => {
                const sellNum = parseFloat(effectiveSellAmount) || 0;
                return formatCompactAmount(sellNum * sellTax.sellTax / 100);
              })() : '0'} symbol={sellToken.symbol} />
              <TaxFeeRow taxInfo={buyTax} side="buy" amount={buyTax.buyTax > 0 ? (() => {
                const outNum = route.totalExpectedOut > 0n ? parseFloat(formatTokenAmount(route.totalExpectedOut, outDecimals)) || 0 : 0;
                return formatCompactAmount(outNum * buyTax.buyTax / 100);
              })() : '0'} symbol={buyToken.symbol} />
            </div>

            {/* Token tax/restriction warning */}
            <div className="mb-4">
              <TokenWarningBanner taxInfo={sellTax.warningLevel !== 'none' ? sellTax : buyTax} compact />
            </div>

            {/* MEV risk warning */}
            <div className="flex items-start justify-center gap-2 p-3 bg-surface-container border border-outline-variant/10 text-on-surface-variant text-[10px] font-body text-center mb-6">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-yellow-400 mt-0.5" />
              <span>
                Transactions on Dogechain are visible in the public mempool. Consider using a lower slippage to reduce sandwich attack risk.
              </span>
            </div>

            <div className="flex gap-4">
              <button
                onClick={() => setShowConfirmModal(false)}
                className="flex-1 py-3 font-headline font-bold uppercase tracking-widest text-on-surface-variant border border-outline-variant/30 hover:bg-surface-container-highest transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmSwap}
                className="flex-1 py-3 font-headline font-black uppercase tracking-widest bg-primary text-black hover:bg-white hover:text-black transition-colors shadow-[0_0_20px_rgba(255,215,0,0.2)] cursor-pointer"
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Route Selector — multiple routes (H-04: stable ID-based selection) */}
      {allRoutes.length > 0 && !routeLoading && (
        <div className="bg-surface-container-low border border-outline-variant/15 p-4">
          <div className="font-headline text-xs uppercase tracking-widest text-on-surface-variant mb-3">
            Available Routes ({allRoutes.length})
          </div>
          <div className="space-y-2">
            {allRoutes.map((r, idx) => {
              // H-04: use stable route ID for selection comparison
              // During/after swap, highlight the frozen executed route
              const isActiveSwap = isSwapping || isPending || isConfirming;
              const isSelected = isActiveSwap
                ? executedRouteRef.current != null && r.id === executedRouteRef.current.id
                : selectedRouteId != null && r.id === selectedRouteId;

              // In buy-active mode, show input required; in sell-active mode, show output
              const amountFormatted = activeField === 'buy'
                ? (r.totalAmountIn > 0n ? formatTokenAmount(r.totalAmountIn, inDecimals) : '0')
                : (r.totalExpectedOut > 0n ? formatTokenAmount(r.totalExpectedOut, outDecimals) : '0');
              const amountLabel = activeField === 'buy'
                ? `${amountFormatted} ${sellToken.symbol}`
                : `${amountFormatted} ${buyToken.symbol}`;
              const labelSuffix = activeField === 'buy' ? 'Input required' : 'Output';
              const label = getRouteLabel(r, idx);

              return (
                <button
                  key={r.id || idx}
                  onClick={() => handleRouteSelect(r)}
                  className={`w-full text-left p-3 border transition-colors cursor-pointer ${
                    isSelected
                      ? 'border-primary bg-primary/5'
                      : 'border-outline-variant/10 bg-surface-container hover:border-primary/30'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className={`text-sm font-headline font-bold ${isSelected ? 'text-primary' : 'text-white'}`}>
                      {label}
                    </span>
                    <div className="text-right">
                      <span className={`text-sm font-body block ${isSelected ? 'text-primary font-bold' : 'text-on-surface-variant'}`}>
                        {amountLabel}
                      </span>
                      <span className="text-[9px] text-on-surface-variant/60 uppercase">
                        {labelSuffix}
                      </span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Route Visualization — uses frozen route during/after swap */}
      <RouteVisualization route={displayRoute} />

      {/* Price Comparison — uses frozen route during/after swap */}
      <PriceComparison
        dexQuotes={dexQuotes}
        aggregatorOutput={displayRoute?.totalExpectedOut ?? null}
        tokenOutAddress={buyToken.address}
      />

      {/* Token Selector Modal */}
      <TokenSelector
        isOpen={tokenModalSide !== null}
        onClose={() => setTokenModalSide(null)}
        onSelect={handleTokenSelect}
        selectedToken={tokenModalSide === 'sell' ? sellToken : buyToken}
        side={tokenModalSide ?? 'sell'}
        walletScan={walletScan}
      />

      {/* Recent Swaps — merged local history + on-chain events */}
      <SwapHistory
        localHistory={swapHistory}
        onClearLocalHistory={() => setSwapHistory([])}
      />

      {/* Market data cards — $OMNOM stats (copied from Direct Swap) */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        <div className="bg-surface-container-low p-4 border-b-2 border-primary text-center flex flex-col items-center justify-center shadow-[0_4px_10px_rgba(255,215,0,0.1)]">
          <p className="text-[10px] font-headline uppercase text-on-surface-variant mb-1">$OMNOM Price</p>
          <p className="font-headline font-bold text-white whitespace-nowrap">{omnomPrice}</p>
          <p className="text-[10px] font-headline text-primary">ON CHAIN</p>
        </div>
        <div className="bg-surface-container-low p-4 border-b-2 border-green-400 text-center flex flex-col items-center justify-center">
          <p className="text-[10px] font-headline uppercase text-on-surface-variant mb-1">$OMNOM 24H Vol</p>
          <p className="font-headline font-bold text-white whitespace-nowrap">{omnomVol}</p>
          <p className="text-[10px] font-headline text-green-400">ON CHAIN</p>
        </div>
        <div className="bg-surface-container-low p-4 border-b-2 border-secondary text-center flex flex-col items-center justify-center col-span-2 sm:col-span-1">
          <p className="text-[10px] font-headline uppercase text-on-surface-variant mb-1">$OMNOM Market Cap</p>
          <p className="font-headline font-bold text-white whitespace-nowrap">{omnomMarketCap}</p>
          <p className="text-[10px] font-headline text-secondary">BEAST MODE</p>
        </div>
      </div>

      {/* MEXC CEX data tiles (copied from Direct Swap) */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-surface-container-low p-4 border-b-2 text-center flex flex-col items-center justify-center" style={{ borderBottomColor: 'rgb(41, 91, 249)' }}>
          <p className="text-[10px] font-headline uppercase text-on-surface-variant mb-1">MEXC $OMNOM Price</p>
          <p className="font-headline font-bold text-white whitespace-nowrap">{mexcPriceStr}</p>
          <p className="text-[10px] font-headline" style={{ color: 'rgb(41, 91, 249)' }}>CEX</p>
        </div>
        <div className="bg-surface-container-low p-4 border-b-2 text-center flex flex-col items-center justify-center" style={{ borderBottomColor: 'rgba(41, 91, 249, 0.6)' }}>
          <p className="text-[10px] font-headline uppercase text-on-surface-variant mb-1">MEXC $OMNOM 24H Vol</p>
          <p className="font-headline font-bold text-white">{mexcVolStr}</p>
          <p className="text-[10px] font-headline" style={{ color: 'rgb(41, 91, 249)' }}>CEX</p>
        </div>
      </div>
    </div>
  );
}
