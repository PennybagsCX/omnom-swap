import { useState, useEffect, useCallback, useMemo } from 'react';
import { Settings, ChevronDown, UtensilsCrossed, X, AlertTriangle, Sparkles, PenLine } from 'lucide-react';
import { useAccount, useBalance, useReadContract, useWriteContract, useChainId, usePublicClient } from 'wagmi';
import { erc20Abi, parseAbi, parseUnits, formatUnits } from 'viem';
import { TOKENS, CONTRACTS, NETWORK_INFO, isNativeToken, isDogeSwapNativeToken, OMNOM_WWDOGE_POOL, V2_ROUTER_ABI, PRICE_IMPACT_WARN, PRICE_IMPACT_BLOCK, calcPriceImpact, impactColor } from '../lib/constants';
import { useOmnomData } from '../hooks/useOmnomData';
import { usePoolReserves, useTokenDecimals } from '../hooks/useLiquidity';
import { useToast } from './ToastContext';
import { formatCompactPrice, formatCompactAmount } from '../lib/format';
import { useAutoSlippage } from '../hooks/useAutoSlippage';

import { SwapHistory } from './aggregator/SwapHistory';
import { TokenWarningBanner } from './aggregator/TokenWarningBanner';
import { getCachedTaxInfo } from '../hooks/useTokenTax';

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
  const tx = obj as Record<string, unknown>;
  return (
    typeof tx.id === 'number' &&
    typeof tx.sellAmount === 'number' &&
    typeof tx.sellSymbol === 'string' &&
    typeof tx.buyAmount === 'number' &&
    typeof tx.buySymbol === 'string' &&
    (tx.hash === undefined || typeof tx.hash === 'string') &&
    typeof tx.time === 'string' &&
    (tx.status === 'success' || tx.status === 'failed' || tx.status === 'pending') &&
    typeof tx.priceImpact === 'number'
  );
}

// Price impact thresholds imported from constants.ts

// Compact price formatting with subscript zero notation
const fmtPrice = formatCompactPrice;
const fmtUsd = formatCompactPrice;

// Token amounts — compact notation for small values
function fmtAmt(n: number): string {
  return formatCompactAmount(n);
}

export function SwapScreen() {

const [sellAmount, setSellAmount] = useState<string>('');
  const [buyAmountInput, setBuyAmountInput] = useState<string>('');
  const [activeField, setActiveField] = useState<'sell' | 'buy'>('sell');
  const [sellToken, setSellToken] = useState(TOKENS[0]); // WWDOGE — default sell
  const [buyToken, setBuyToken] = useState(() => TOKENS.find(t => t.address.toLowerCase() === CONTRACTS.OMNOM_TOKEN.toLowerCase()) || TOKENS[0]); // OMNOM — default buy
  const [exchangeRate, setExchangeRate] = useState(0);
  const [tokenModalSide, setTokenModalSide] = useState<'sell' | 'buy' | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [slippage, setSlippage] = useState<string>('0.5');
  const [deadline, setDeadline] = useState<string>('5');
  // Load swap history from localStorage with validation (Fix 5)
  const [swapHistory, setSwapHistory] = useState<SwapTx[]>(() => {
    try {
      const saved = localStorage.getItem('omnom_swap_history');
      if (!saved) return [];
      const parsed: unknown = JSON.parse(saved);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(isValidSwapTx);
    } catch { return []; }
  });

  // Persist swap history to localStorage
  useEffect(() => {
    try { localStorage.setItem('omnom_swap_history', JSON.stringify(swapHistory.slice(0, 50))); } catch { /* localStorage may be unavailable in private mode */ }
  }, [swapHistory]);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [isSwapping, setIsSwapping] = useState(false);
  const [swapFlip, setSwapFlip] = useState(false);
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const isWrongNetwork = isConnected && chainId !== NETWORK_INFO.chainId;
  const { addToast } = useToast();

  // Dynamic decimals from token contracts (Fix 4)
  const sellDecimals = useTokenDecimals(sellToken?.address);
  const buyDecimals = useTokenDecimals(buyToken?.address);

  const { writeContractAsync: writeContract } = useWriteContract();

  // Balance queries — native token via useBalance, ERC-20 via useReadContract
  const sellNativeBalance = useBalance({ address, query: { enabled: isConnected && isNativeToken(sellToken) } });
  const sellErc20Balance = useReadContract({
    address: sellToken.address as `0x${string}`,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: { enabled: isConnected && !isNativeToken(sellToken) }
  });
  const buyNativeBalance = useBalance({ address, query: { enabled: isConnected && isNativeToken(buyToken) } });
  const buyErc20Balance = useReadContract({
    address: buyToken.address as `0x${string}`,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: { enabled: isConnected && !isNativeToken(buyToken) }
  });

  // Balance queries for all DogeSwap tokens (for token selector display)
  const wwdogeBalance = useBalance({ address, query: { enabled: isConnected } });
  const omnomBalance = useReadContract({
    address: CONTRACTS.OMNOM_TOKEN as `0x${string}`,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: { enabled: isConnected }
  });
  const dcBalance = useReadContract({
    address: CONTRACTS.DC_TOKEN as `0x${string}`,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: { enabled: isConnected }
  });
  const dinuBalance = useReadContract({
    address: CONTRACTS.DINU_TOKEN as `0x${string}`,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: { enabled: isConnected }
  });

  // Balance map for DogeSwap tokens
  const dogeswapBalances = useMemo(() => {
    if (!isConnected) return new Map<string, number>();
    const map = new Map<string, number>();
    map.set(CONTRACTS.WWDOGE.toLowerCase(), wwdogeBalance.data ? Number(formatUnits(wwdogeBalance.data.value, 18)) : 0);
    map.set(CONTRACTS.OMNOM_TOKEN.toLowerCase(), omnomBalance.data ? Number(formatUnits(omnomBalance.data as bigint, 18)) : 0);
    map.set(CONTRACTS.DC_TOKEN.toLowerCase(), dcBalance.data ? Number(formatUnits(dcBalance.data as bigint, 18)) : 0);
    map.set(CONTRACTS.DINU_TOKEN.toLowerCase(), dinuBalance.data ? Number(formatUnits(dinuBalance.data as bigint, 18)) : 0);
    return map;
  }, [isConnected, wwdogeBalance.data, omnomBalance.data, dcBalance.data, dinuBalance.data]);


  const displaySellBalance = (() => {
    if (!isConnected) return 0;
    if (isNativeToken(sellToken)) {
      return sellNativeBalance.data ? Number(formatUnits(sellNativeBalance.data.value, sellNativeBalance.data.decimals)) : 0;
    }
    return sellErc20Balance.data ? Number(formatUnits(sellErc20Balance.data as bigint, sellDecimals)) : 0;
  })();

  const displayBuyBalance = (() => {
    if (!isConnected) return 0;
    if (isNativeToken(buyToken)) {
      return buyNativeBalance.data ? Number(formatUnits(buyNativeBalance.data.value, buyNativeBalance.data.decimals)) : 0;
    }
    return buyErc20Balance.data ? Number(formatUnits(buyErc20Balance.data as bigint, buyDecimals)) : 0;
  })();

  const filteredTokens = useMemo(() => {
    return TOKENS.filter(t => isDogeSwapNativeToken(t));
  }, []);

  const parsedBuyInput = parseFloat(buyAmountInput) || 0;

  // Pool reserves for quoting and price impact
  const { reserve0: poolRes0, reserve1: poolRes1, token0: poolT0, token1: poolT1 } = usePoolReserves(OMNOM_WWDOGE_POOL);

  // Live $OMNOM market data — shared across all components via centralized hook
  const { priceUsd: omnomPriceUsd, totalVol24: omnomVol24, marketCapUsd: omnomMarketCapUsd, mexcPrice, mexcVol24 } = useOmnomData();
  const omnomPrice = fmtPrice(omnomPriceUsd);
  const omnomVol = fmtUsd(omnomVol24);
  const omnomMarketCap = fmtUsd(omnomMarketCapUsd);
  const mexcPriceStr = fmtPrice(mexcPrice);
  const mexcVolStr = fmtUsd(mexcVol24);

  // ─── Reverse calculation: BUY → SELL (when activeField === 'buy') ─────────
  const computedSellAmount = useMemo(() => {
    if (activeField !== 'buy' || parsedBuyInput <= 0 || !poolT0 || !poolT1) return '';
    const buyAddr = (isNativeToken(buyToken) ? CONTRACTS.WWDOGE : buyToken.address).toLowerCase();
    const sellAddr = (isNativeToken(sellToken) ? CONTRACTS.WWDOGE : sellToken.address).toLowerCase();
    const sellIsT0 = sellAddr === poolT0.toLowerCase();
    const sellIsT1 = sellAddr === poolT1.toLowerCase();
    const buyIsT0 = buyAddr === poolT0.toLowerCase();
    const buyIsT1 = buyAddr === poolT1.toLowerCase();
    if (!((sellIsT0 && buyIsT1) || (sellIsT1 && buyIsT0))) return '';
    const reserveSell = sellIsT0 ? poolRes0 : poolRes1;
    const reserveBuy = sellIsT0 ? poolRes1 : poolRes0;
    if (reserveSell <= 0n || reserveBuy <= 0n) return '';
    const parsedBuyWei = parseUnits(parsedBuyInput.toString(), buyDecimals);
    if (parsedBuyWei >= reserveBuy) return '';
    // Reverse formula: amountIn = ceil(reserveIn * amountOut * 1000 / ((reserveOut - amountOut) * 997))
    const numerator = reserveSell * parsedBuyWei * 1000n;
    const denominator = (reserveBuy - parsedBuyWei) * 997n;
    const sellWei = (numerator + denominator - 1n) / denominator;
    return formatUnits(sellWei, sellDecimals);
  }, [activeField, parsedBuyInput, buyToken, sellToken, poolRes0, poolRes1, poolT0, poolT1, buyDecimals, sellDecimals]);

  // Sync sell field when buy is active and reverse calculation produces a result
  useEffect(() => {
    if (activeField === 'buy' && computedSellAmount !== '') {
      setSellAmount(computedSellAmount);
    }
  }, [activeField, computedSellAmount]);

  // Retry effect: when pool data becomes available and there's a pending buy input,
  // force recalculation of sell amount. This handles the race condition where user
  // types in BUY field before pool data is loaded.
  useEffect(() => {
    if (activeField !== 'buy' || parsedBuyInput <= 0) return;
    // Pool data just became available (was null/undefined before)
    // Trigger recalculation by reading computedSellAmount fresh
    if (poolT0 && poolT1 && computedSellAmount !== '') {
      setSellAmount(computedSellAmount);
    }
  }, [activeField, poolT0, poolT1, parsedBuyInput, computedSellAmount]);

  // Price quoting via V2 router (primary source on Dogechain)
  const effectiveSellAmount = activeField === 'sell' ? sellAmount : (computedSellAmount || sellAmount);
  const effectiveParsedSell = parseFloat(effectiveSellAmount) || 0;
  const parsedSellWei = effectiveParsedSell > 0 ? parseUnits(effectiveParsedSell.toString(), sellDecimals) : 0n;

  const getRouterPath = useCallback((from: typeof TOKENS[0], to: typeof TOKENS[0]) => {
    const fromAddr = isNativeToken(from) || from.symbol === 'DC'
      ? CONTRACTS.WWDOGE as `0x${string}`
      : from.address as `0x${string}`;
    const toAddr = isNativeToken(to) || to.symbol === 'DC'
      ? CONTRACTS.WWDOGE as `0x${string}`
      : to.address as `0x${string}`;
    return [fromAddr, toAddr];
  }, []);

  // Algebra V3 Quoter — primary price source for accurate V3 pool pricing
  const { data: v3Quote } = useReadContract({
    address: CONTRACTS.ALGEBRA_QUOTER as `0x${string}`,
    abi: parseAbi([
      'function quoteExactInputSingle(address tokenIn, address tokenOut, uint256 amountIn, uint160 limitSqrtPrice) external view returns (uint256 amountOut)'
    ]),
    functionName: 'quoteExactInputSingle',
    args: parsedSellWei > 0n && sellToken.address !== buyToken.address
      ? [
          (isNativeToken(sellToken) ? CONTRACTS.WWDOGE : sellToken.address) as `0x${string}`,
          (isNativeToken(buyToken) ? CONTRACTS.WWDOGE : buyToken.address) as `0x${string}`,
          parsedSellWei,
          0n,
        ]
      : undefined,
    query: { enabled: parsedSellWei > 0n && sellToken.address !== buyToken.address }
  });

  // V2 router fallback for pairs without V3 liquidity
  const { data: v2AmountsOut } = useReadContract({
    address: CONTRACTS.DOGESWAP_V2_ROUTER as `0x${string}`,
    abi: parseAbi(['function getAmountsOut(uint amountIn, address[] memory path) public view returns (uint[] memory amounts)']),
    functionName: 'getAmountsOut',
    args: parsedSellWei > 0n && sellToken.address !== buyToken.address
      ? [parsedSellWei, getRouterPath(sellToken, buyToken)]
      : undefined,
    query: { enabled: parsedSellWei > 0n && sellToken.address !== buyToken.address }
  });

  // Direct V2 pool reserve quote (constant product formula with 0.3% fee)
  // Primary source for the main OMNOM/WWDOGE pool — avoids V3 tiny-pool misquotes
  const poolBasedCalc = (() => {
    if (effectiveParsedSell <= 0 || parsedSellWei <= 0n || !poolT0 || !poolT1) return { rate: 0, buyWei: 0n };
    const sellAddr = (isNativeToken(sellToken) ? CONTRACTS.WWDOGE : sellToken.address).toLowerCase();
    const buyAddr = (isNativeToken(buyToken) ? CONTRACTS.WWDOGE : buyToken.address).toLowerCase();
    const sellIsT0 = sellAddr === poolT0.toLowerCase();
    const sellIsT1 = sellAddr === poolT1.toLowerCase();
    const buyIsT0 = buyAddr === poolT0.toLowerCase();
    const buyIsT1 = buyAddr === poolT1.toLowerCase();
    if (!((sellIsT0 && buyIsT1) || (sellIsT1 && buyIsT0))) return { rate: 0, buyWei: 0n };
    const reserveSell = sellIsT0 ? poolRes0 : poolRes1;
    const reserveBuy = sellIsT0 ? poolRes1 : poolRes0;
    if (reserveSell <= 0n || reserveBuy <= 0n) return { rate: 0, buyWei: 0n };
    // V2 AMM with 0.3% fee: amountOut = reserveBuy * amountIn * 997 / (reserveSell * 1000 + amountIn * 997)
    const buyWei = (reserveBuy * parsedSellWei * 997n) / (reserveSell * 1000n + parsedSellWei * 997n);
    const rate = Number(formatUnits(buyWei, buyDecimals)) / effectiveParsedSell;
    return { rate, buyWei };
  })();

  const poolBasedRate = poolBasedCalc.rate;
  const calculatedBuyWei = poolBasedCalc.buyWei;

  useEffect(() => {
    // Primary: direct V2 pool math (reliable, uses main pool with real liquidity)
    // Fallback: V3 Quoter → V2 Router (may quote against thin liquidity pools)
    if (poolBasedRate > 0) {
      setExchangeRate(poolBasedRate);
    } else if (v3Quote !== undefined && v3Quote !== null && parsedSellWei > 0n) {
      const outAmount = formatUnits(v3Quote as bigint, buyDecimals);
      const rate = Number(outAmount) / effectiveParsedSell;
      setExchangeRate(rate);
    } else if (v2AmountsOut && (v2AmountsOut as bigint[]).length === 2 && parsedSellWei > 0n) {
      const outAmount = formatUnits((v2AmountsOut as bigint[])[1], buyDecimals);
      const rate = Number(outAmount) / effectiveParsedSell;
      setExchangeRate(rate);
    } else if (sellToken.address === buyToken.address || sellToken.symbol === buyToken.symbol) {
      setExchangeRate(1);
    } else if (effectiveParsedSell === 0) {
      setExchangeRate(0);
    }
  }, [poolBasedRate, v3Quote, v2AmountsOut, parsedSellWei, effectiveParsedSell, sellToken, buyToken, buyDecimals]);

  // Price impact (estimated from pool reserves) — works in both directions
  const priceImpact = (() => {
    if (effectiveParsedSell <= 0 || !poolT0) return 0;
    const sellAddr = (isNativeToken(sellToken) ? CONTRACTS.WWDOGE : sellToken.address).toLowerCase();
    const reserveSell = sellAddr === poolT0.toLowerCase()
      ? Number(formatUnits(poolRes0, sellDecimals))
      : Number(formatUnits(poolRes1, sellDecimals));
    return calcPriceImpact(effectiveParsedSell, reserveSell);
  })();

  // ─── Auto Slippage ─────────────────────────────────────────────────────────
  // Direct swap: hopCount is 1 (or 2 if routing through WDOGE)
  const directHopCount = (() => {
    if (sellToken.address === buyToken.address) return 1;
    const sellIsNative = isNativeToken(sellToken);
    const buyIsNative = isNativeToken(buyToken);
    // If neither is native, may route through WDOGE (2 hops)
    if (!sellIsNative && !buyIsNative) return 2;
    return 1;
  })();

  // tradeSizeVsLiquidity = inputAmount / reserveIn
  const directTradeSizeVsLiquidity = (() => {
    if (effectiveParsedSell <= 0 || !poolT0) return 0;
    const sellAddr = (isNativeToken(sellToken) ? CONTRACTS.WWDOGE : sellToken.address).toLowerCase();
    const reserveSell = sellAddr === poolT0.toLowerCase()
      ? Number(formatUnits(poolRes0, sellDecimals))
      : Number(formatUnits(poolRes1, sellDecimals));
    if (reserveSell <= 0) return 0;
    return Math.min(effectiveParsedSell / reserveSell, 1);
  })();

  // isThinPair: true if reserveIn < 1000 WDOGE equivalent
  const directIsThinPair = (() => {
    if (!poolT0) return false;
    const sellAddr = (isNativeToken(sellToken) ? CONTRACTS.WWDOGE : sellToken.address).toLowerCase();
    const reserveSell = sellAddr === poolT0.toLowerCase() ? poolRes0 : poolRes1;
    const reserveSellNum = Number(formatUnits(reserveSell, sellDecimals));
    return reserveSellNum > 0 && reserveSellNum < 1000;
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
    directHopCount,
    directTradeSizeVsLiquidity,
    directIsThinPair,
    slippage,
  );

  // Calculations — use effective slippage
  const effectiveSlippageNum = parseFloat(effectiveSlippage) || 0;
  const slippageTooHigh = effectiveSlippageNum > 50; // Fix 2: upper-bound validation

  // Buy amount display: when sell is active, compute from forward calc; when buy is active, show user input
  const buyAmountDisplay = activeField === 'sell'
    ? (exchangeRate > 0 ? fmtAmt(effectiveParsedSell * exchangeRate) : '0')
    : buyAmountInput;
  const minReceived = exchangeRate > 0 ? fmtAmt(effectiveParsedSell * exchangeRate * (1 - effectiveSlippageNum / 100)) : '0';

  // Reverse calculation error (when buy field is active)
  const reverseError = useMemo(() => {
    if (activeField !== 'buy' || parsedBuyInput <= 0) return null;
    if (!poolT0 || !poolT1) return 'Loading pool...';
    const buyAddr = (isNativeToken(buyToken) ? CONTRACTS.WWDOGE : buyToken.address).toLowerCase();
    const sellAddr = (isNativeToken(sellToken) ? CONTRACTS.WWDOGE : sellToken.address).toLowerCase();
    const sellIsT0 = sellAddr === poolT0.toLowerCase();
    const buyIsT1 = buyAddr === poolT1.toLowerCase();
    const sellIsT1 = sellAddr === poolT1.toLowerCase();
    const buyIsT0 = buyAddr === poolT0.toLowerCase();
    if (!((sellIsT0 && buyIsT1) || (sellIsT1 && buyIsT0))) return null; // Not this pool pair — may use V3/V2 fallback
    const reserveBuy = sellIsT0 ? poolRes1 : poolRes0;
    const parsedBuyWei = parseUnits(parsedBuyInput.toString(), buyDecimals);
    if (parsedBuyWei >= reserveBuy) return 'Insufficient liquidity';
    return null;
  }, [activeField, parsedBuyInput, buyToken, sellToken, poolT0, poolT1, poolRes0, poolRes1, buyDecimals]);

  // Input validation
  const inputError = (() => {
    if (!isConnected) return null;
    if (reverseError) return reverseError;
    if (!effectiveSellAmount || effectiveParsedSell <= 0) return null;
    if (isNaN(effectiveParsedSell) || !isFinite(effectiveParsedSell)) return 'Invalid amount';
    if (effectiveParsedSell > 1e18) return 'Amount too large';
    if (effectiveParsedSell > displaySellBalance) return 'Insufficient balance';
    return null;
  })();

  // Button state
  let buttonText = "CHOMP THE SWAP";
  let isDisabled = false;

  if (isWrongNetwork) {
    buttonText = "WRONG NETWORK";
    isDisabled = true;
  } else if (!isConnected) {
    buttonText = "CONNECT WALLET";
    isDisabled = true;
  } else if (!effectiveSellAmount || effectiveParsedSell <= 0) {
    buttonText = "ENTER AMOUNT";
    isDisabled = true;
  } else if (inputError) {
    buttonText = inputError.toUpperCase();
    isDisabled = true;
  } else if (slippageTooHigh) {
    buttonText = "SLIPPAGE TOO HIGH";
    isDisabled = true;
  } else if (exchangeRate <= 0) {
    buttonText = "NO LIQUIDITY";
    isDisabled = true;
  } else if (priceImpact >= PRICE_IMPACT_BLOCK) {
    buttonText = "PRICE IMPACT TOO HIGH";
    isDisabled = true;
  }

  const handleExecuteAction = () => {
    setShowConfirmModal(true);
  };

  const handleSwapTokens = () => {
    const temp = sellToken;
    let newSellAmount: string;
    let newBuyPlaceholder: string;

    // CRITICAL: Capture decimals BEFORE state updates to avoid stale closure bug.
    // calculatedBuyWei is in OLD buy token's decimals (buyToken.decimals before flip).
    // After flip, buyToken becomes NEW sell token, but calculatedBuyWei still needs
    // to be formatted with OLD buy decimals, not NEW buy decimals.
    const currentBuyDecimals = buyToken.decimals;

    if (activeField === 'sell' && effectiveParsedSell > 0 && calculatedBuyWei > 0n) {
      // User was editing sell, use calculated buy output as new sell amount
      newSellAmount = formatUnits(calculatedBuyWei, currentBuyDecimals);
      newBuyPlaceholder = sellAmount;
    } else if (activeField === 'buy' && buyAmountInput && parseFloat(buyAmountInput) > 0) {
      // User was editing buy, use their input as new sell amount
      newSellAmount = buyAmountInput;
      newBuyPlaceholder = computedSellAmount || sellAmount;
    } else {
      // Fallback: preserve what we can
      newSellAmount = sellAmount || '';
      newBuyPlaceholder = '';
    }

    setSellToken(buyToken);
    setBuyToken(temp);
    setSellAmount(newSellAmount);
    setBuyAmountInput(newBuyPlaceholder);
    setActiveField('sell');
    setSwapFlip(prev => !prev);
  };

  const handleTokenSelect = (token: typeof TOKENS[0]) => {
    if (tokenModalSide === 'sell') {
      if (token.symbol === buyToken.symbol) handleSwapTokens();
      else setSellToken(token);
    } else if (tokenModalSide === 'buy') {
      if (token.symbol === sellToken.symbol) handleSwapTokens();
      else setBuyToken(token);
    }
    setTokenModalSide(null);
  };

  const handleSellAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    if (val === '' || /^\d*\.?\d*$/.test(val)) {
      // Prevent excessive decimal places
      if (val.includes('.') && val.split('.')[1]?.length > 18) return;
      setSellAmount(val);
      setActiveField('sell');
    }
  };

  // NEW handler for buy field input
  const handleBuyAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    if (val === '' || /^\d*\.?\d*$/.test(val)) {
      if (val.includes('.') && val.split('.')[1]?.length > 18) return;
      setBuyAmountInput(val);
      setActiveField('buy');
    }
  };

  const publicClient = usePublicClient();

  const parsedRouterAbi = V2_ROUTER_ABI;

  // Swap via V2 router — atomic single transaction (correct WDOGE function names)
  const handleConfirmSwap = async () => {
    if (!address || parsedSellWei <= 0n) return;
    setIsSwapping(true);

    const routerAddress = CONTRACTS.DOGESWAP_V2_ROUTER as `0x${string}`;
    const isSellingNative = isNativeToken(sellToken);
    const isBuyingNative = isNativeToken(buyToken);
    // Dynamic deadline: user setting + per-hop buffer (no artificial minimum)
    const _EXTRA_PER_HOP = 30;
    const _userSec = (parseInt(deadline) || 5) * 60;
    const _hopCount = (sellToken.address !== buyToken.address) ? 1 : 0;
    const _extraHop = Math.max(0, _hopCount - 1) * _EXTRA_PER_HOP;
    const _effectiveSec = _userSec + _extraHop;
    const txDeadline = Math.floor(Date.now() / 1000) + _effectiveSec;

    try {
      // Compute expected output from pool reserves
      let buyWeiOut = 0n;
      if (poolT0 && poolT1) {
        const sellAddr = (isSellingNative ? CONTRACTS.WWDOGE : sellToken.address).toLowerCase();
        const buyAddr = (isBuyingNative ? CONTRACTS.WWDOGE : buyToken.address).toLowerCase();
        const sellIsT0 = sellAddr === poolT0.toLowerCase();
        const sellIsT1 = sellAddr === poolT1.toLowerCase();
        const buyIsT0 = buyAddr === poolT0.toLowerCase();
        const buyIsT1 = buyAddr === poolT1.toLowerCase();
        if ((sellIsT0 && buyIsT1) || (sellIsT1 && buyIsT0)) {
          const reserveSell = sellIsT0 ? poolRes0 : poolRes1;
          const reserveBuy = sellIsT0 ? poolRes1 : poolRes0;
          if (reserveSell > 0n && reserveBuy > 0n) {
            buyWeiOut = (reserveBuy * parsedSellWei * 997n) / (reserveSell * 1000n + parsedSellWei * 997n);
          }
        }
      }
      if (buyWeiOut <= 0n && v3Quote != null) buyWeiOut = v3Quote as bigint;
      if (buyWeiOut <= 0n && v2AmountsOut && (v2AmountsOut as bigint[]).length === 2) buyWeiOut = (v2AmountsOut as bigint[])[1];

      if (buyWeiOut <= 0n) {
        addToast({ type: 'error', title: 'No Quote', message: 'Could not determine swap output' });
        setIsSwapping(false);
        return;
      }

      const slippageBps = effectiveBps;
      const amountOutMin = (buyWeiOut * (10000n - slippageBps)) / 10000n;
      const sellAddr = (isSellingNative ? CONTRACTS.WWDOGE : sellToken.address) as `0x${string}`;
      const buyAddr = (isBuyingNative ? CONTRACTS.WWDOGE : buyToken.address) as `0x${string}`;
      const path = [sellAddr, buyAddr];

      // Approve router if selling ERC-20
      if (!isSellingNative && publicClient) {
        const allowance = await publicClient.readContract({
          address: sellToken.address as `0x${string}`,
          abi: erc20Abi,
          functionName: 'allowance',
          args: [address, routerAddress],
        });
        if ((allowance as bigint) < parsedSellWei) {
          addToast({ type: 'warning', title: 'Approving', message: 'Approving token spend...' });
          // 2% approval buffer: accounts for fee rounding, re-wrapping, and price shifts
          // (amount * 102 / 100) — MEV protection: bounded approval, not unlimited
          const approvalAmount = (parsedSellWei * 102n) / 100n;
          const approveHash = await writeContract({
            address: sellToken.address as `0x${string}`,
            abi: erc20Abi,
            functionName: 'approve',
            args: [routerAddress, approvalAmount],
          });
          const r = await publicClient.waitForTransactionReceipt({ hash: approveHash });
          if (r.status !== 'success') {
            addToast({ type: 'error', title: 'Approval Failed', message: 'Token approval reverted' });
            setIsSwapping(false);
            setShowConfirmModal(false);
            return;
          }
        }
      }

      // Execute swap via V2 router
      addToast({ type: 'warning', title: 'Swapping', message: 'Executing swap...' });

      let swapHash: `0x${string}`;
      if (isSellingNative) {
        swapHash = await writeContract({
          address: routerAddress,
          abi: parsedRouterAbi,
          functionName: 'swapExactWDOGEForTokens',
          args: [amountOutMin, path, address, BigInt(txDeadline)],
          value: parsedSellWei,
        });
      } else if (isBuyingNative) {
        swapHash = await writeContract({
          address: routerAddress,
          abi: parsedRouterAbi,
          functionName: 'swapExactTokensForWDOGE',
          args: [parsedSellWei, amountOutMin, path, address, BigInt(txDeadline)],
        });
      } else {
        swapHash = await writeContract({
          address: routerAddress,
          abi: parsedRouterAbi,
          functionName: 'swapExactTokensForTokens',
          args: [parsedSellWei, amountOutMin, path, address, BigInt(txDeadline)],
        });
      }

      addToast({ type: 'warning', title: 'Submitted', message: 'Waiting for confirmation...' });

      if (publicClient) {
        const receipt = await publicClient.waitForTransactionReceipt({ hash: swapHash });
        setShowConfirmModal(false);

        if (receipt.status === 'success') {
          const buyAmountActual = Number(formatUnits(buyWeiOut, buyDecimals));
          setSwapHistory(prev => [{
            id: Date.now(), sellAmount: effectiveParsedSell, sellSymbol: sellToken.symbol,
            buyAmount: buyAmountActual, buySymbol: buyToken.symbol,
            hash: swapHash as string, time: 'Just now', status: 'success',
            priceImpact: priceImpact * 100,
          }, ...prev]);
          setSellAmount('');
          setBuyAmountInput('');
          setActiveField('sell');
          addToast({
            type: 'success', title: 'Swap Complete',
            message: `${effectiveParsedSell} ${sellToken.symbol} → ${fmtAmt(buyAmountActual)} ${buyToken.symbol}`,
            link: `${NETWORK_INFO.blockExplorer}/tx/${swapHash}`,
          });
        } else {
          setSwapHistory(prev => [{
            id: Date.now(), sellAmount: effectiveParsedSell, sellSymbol: sellToken.symbol,
            buyAmount: 0, buySymbol: buyToken.symbol,
            hash: swapHash as string, time: 'Just now', status: 'failed',
            priceImpact: priceImpact * 100,
          }, ...prev]);
          addToast({
            type: 'error', title: 'Swap Failed', message: 'Transaction reverted on-chain',
            link: `${NETWORK_INFO.blockExplorer}/tx/${swapHash}`,
          });
        }
      } else {
        setShowConfirmModal(false);
        const buyAmountActual = Number(formatUnits(buyWeiOut, buyDecimals));
        setSwapHistory(prev => [{
          id: Date.now(), sellAmount: effectiveParsedSell, sellSymbol: sellToken.symbol,
          buyAmount: buyAmountActual, buySymbol: buyToken.symbol,
          hash: swapHash as string, time: 'Just now', status: 'success',
            priceImpact: priceImpact * 100,
        }, ...prev]);
        setSellAmount('');
        setBuyAmountInput('');
        setActiveField('sell');
        addToast({
          type: 'success', title: 'Transaction Sent',
          message: `${effectiveParsedSell} ${sellToken.symbol} → ${fmtAmt(buyAmountActual)} ${buyToken.symbol}`,
          link: `${NETWORK_INFO.blockExplorer}/tx/${swapHash}`,
        });
      }
    } catch (error) {
      setShowConfirmModal(false);
      const isRejected = error instanceof Error && (
        error.message.toLowerCase().includes('user rejected') ||
        error.message.toLowerCase().includes('user denied') ||
        error.message.toLowerCase().includes('rejected the request') ||
        error.message.toLowerCase().includes('action_rejected') ||
        error.message.toLowerCase().includes('userrejected')
      );
      const isNetworkError = error instanceof Error && (
        error.message.toLowerCase().includes('timeout') ||
        error.message.toLowerCase().includes('network error') ||
        error.message.toLowerCase().includes('fetch failed') ||
        error.message.toLowerCase().includes('rpc') ||
        error.message.toLowerCase().includes('429') ||
        error.message.toLowerCase().includes('503') ||
        error.message.toLowerCase().includes('502')
      );

      if (isRejected) {
        addToast({ type: 'error', title: 'Swap Cancelled', message: 'Transaction was rejected' });
      } else if (isNetworkError) {
        addToast({ type: 'error', title: 'Network Error', message: 'Network issue — please try again in a moment' });
      } else {
        const msg = error instanceof Error ? error.message : 'Swap failed';
        addToast({ type: 'error', title: 'Swap Failed', message: msg.substring(0, 120) });
      }
    } finally {
      setIsSwapping(false);
    }
  };

  return (
    <div className="flex flex-col items-center min-h-[80vh] relative">
      {/* Background glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 max-w-[500px] w-full h-[500px] bg-primary/10 blur-[120px] rounded-none pointer-events-none"></div>

      <div className="w-full max-w-[480px] relative z-10 px-4 md:px-0">
        {/* Swap card */}
        <div className="glass-panel p-1 shadow-[0_0_40px_rgba(255,215,0,0.08)] border border-primary/20">
          <div className="bg-surface p-6 flex flex-col gap-4">
            <div className="flex justify-between items-center mb-2">
              <h2 className="font-headline font-bold text-xl uppercase tracking-tight text-white">Swap Assets</h2>
              <button
                onClick={() => setShowSettings(!showSettings)}
                aria-label="Swap settings"
                className={`transition-colors cursor-pointer ${showSettings ? 'text-primary' : 'text-on-surface-variant hover:text-primary'}`}
              >
                <Settings className={`w-5 h-5 transition-transform duration-300 ${showSettings ? 'rotate-90' : ''}`} />
              </button>
            </div>

            {/* Settings panel — smooth expand/collapse */}
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
                    {!isAutoSlippage && slippageTooHigh && (
                      <p className="text-[9px] text-red-400 mt-1 uppercase text-center">Slippage tolerance too high. Maximum is 50%.</p>
                    )}
                    {!isAutoSlippage && !slippageTooHigh && parseFloat(slippage) > 5 && (
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
                        className="w-20 bg-surface-container-highest border border-outline-variant/30 text-white text-right text-[11px] px-2 py-1.5 focus:border-primary outline-none"
                      />
                      <span className="text-[10px] text-on-surface-variant font-headline uppercase">minutes</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Sell input */}
            <div className={`bg-surface-container-low p-5 border-l-4 ${activeField === 'sell' ? 'border-primary' : 'border-outline-variant/30'}`}>
              <div className="flex justify-between text-xs font-headline uppercase text-on-surface-variant mb-2">
                <span>{activeField === 'sell' ? 'You Sell' : 'You Sell (Estimated)'}</span>
                <div className="flex items-center gap-2">
                  <span className="truncate">Balance: {fmtAmt(displaySellBalance)}</span>
                  <button
                    onClick={() => {
                      const max = displaySellBalance * 0.99; // Reserve for gas
                      setSellAmount(max > 0 ? max.toString() : '0');
                      setActiveField('sell');
                    }}
                    aria-label="Use maximum balance"
                    className="text-primary hover:text-white transition-colors px-1.5 py-0.5 bg-primary/10 border border-primary/20 text-[10px] active:scale-95 cursor-pointer"
                  >
                    MAX
                  </button>
                </div>
              </div>
              <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2">
                <button
                  onClick={() => setTokenModalSide('sell')}
                  className="sm:hidden bg-surface-container-high px-3 py-2 flex items-center gap-2 border border-outline-variant/15 hover:border-primary/50 transition-colors cursor-pointer mx-auto"
                >
                  <div className="w-6 h-6 flex items-center justify-center">
                    <img className="w-5 h-5" alt="" src={sellToken.icon as string} />
                  </div>
                  <span className="font-headline font-bold">{sellToken.symbol}</span>
                  <ChevronDown className="w-4 h-4" />
                </button>
                <div className="flex justify-between items-center w-full">
                  <input
                    type="text"
                    value={sellAmount}
                    onChange={handleSellAmountChange}
                    onFocus={() => setActiveField('sell')}
                    aria-label="Amount to sell"
                    className={`bg-transparent border-none p-0 text-2xl sm:text-3xl font-headline font-bold text-white focus:ring-0 w-full sm:w-2/3 outline-none ${activeField === 'buy' ? 'opacity-80' : ''}`}
                    placeholder="0.00"
                  />
                  <button
                    onClick={() => setTokenModalSide('sell')}
                    className="hidden sm:flex bg-surface-container-high px-3 py-2 items-center gap-2 border border-outline-variant/15 hover:border-primary/50 transition-colors cursor-pointer shrink-0"
                  >
                    <div className="w-6 h-6 flex items-center justify-center">
                      <img className="w-5 h-5" alt="" src={sellToken.icon as string} />
                    </div>
                    <span className="font-headline font-bold">{sellToken.symbol}</span>
                    <ChevronDown className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>

            {/* Swap direction */}
            <div className="flex justify-center -my-6 relative z-20">
              <button
                onClick={handleSwapTokens}
                aria-label="Swap token direction"
                className={`bg-primary text-black p-2 hover:bg-white transition-transform duration-300 cursor-pointer ${swapFlip ? 'rotate-180' : 'rotate-0'}`}
              >
                <UtensilsCrossed className="w-6 h-6" />
              </button>
            </div>

            {/* Buy input — now editable for bidirectional swap */}
            <div className={`bg-surface-container-low p-5 border-l-4 ${activeField === 'buy' ? 'border-primary' : 'border-outline-variant/30'}`}>
              <div className="flex justify-between text-xs font-headline uppercase text-on-surface-variant mb-2">
                <span>{activeField === 'buy' ? 'You Buy' : 'You Buy (Estimated)'}</span>
                <div className="flex items-center gap-2">
                  <span className="truncate">Balance: {fmtAmt(displayBuyBalance)}</span>
                  {isConnected && (
                    <button
                      aria-label="Use maximum balance"
                      onClick={() => {
                        // Calculate maximum BUY amount from user's BUY token balance
                        if (displayBuyBalance <= 0) return;
                        const maxBuy = displayBuyBalance * 0.99; // Reserve for gas/slippage
                        if (maxBuy <= 0) return;

                        // Set buy amount to max buy balance
                        setBuyAmountInput(maxBuy.toString());
                        setActiveField('buy');

                        // Calculate required sell input via reverse computation
                        if (poolT0 && poolT1) {
                          const buyAddr = (isNativeToken(buyToken) ? CONTRACTS.WWDOGE : buyToken.address).toLowerCase();
                          const sellAddr = (isNativeToken(sellToken) ? CONTRACTS.WWDOGE : sellToken.address).toLowerCase();
                          const sellIsT0 = sellAddr === poolT0.toLowerCase();
                          const sellIsT1 = sellAddr === poolT1.toLowerCase();
                          const buyIsT0 = buyAddr === poolT0.toLowerCase();
                          const buyIsT1 = buyAddr === poolT1.toLowerCase();
                          if ((sellIsT0 && buyIsT1) || (sellIsT1 && buyIsT0)) {
                            const reserveBuy = sellIsT0 ? poolRes1 : poolRes0;
                            const reserveSell = sellIsT0 ? poolRes0 : poolRes1;
                            if (reserveSell > 0n && reserveBuy > 0n) {
                              const buyWei = parseUnits(maxBuy.toString(), buyDecimals);
                              if (buyWei < reserveBuy) {
                                // Reverse formula: amountIn = ceil(reserveIn * amountOut * 1000 / ((reserveOut - amountOut) * 997))
                                const numerator = reserveSell * buyWei * 1000n;
                                const denominator = (reserveBuy - buyWei) * 997n;
                                const sellWei = (numerator + denominator - 1n) / denominator;
                                const sellAmountStr = formatUnits(sellWei, sellDecimals);
                                setSellAmount(sellAmountStr);
                                return;
                              }
                            }
                          }
                        }
                      }}
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
                  className="sm:hidden bg-surface-container-high px-3 py-2 flex items-center gap-2 border border-outline-variant/15 hover:border-primary/50 transition-colors cursor-pointer mx-auto"
                >
                  <div className="w-6 h-6 flex items-center justify-center">
                    <img className="w-5 h-5" alt="" src={buyToken.icon as string} />
                  </div>
                  <span className="font-headline font-bold">{buyToken.symbol}</span>
                  <ChevronDown className="w-4 h-4" />
                </button>
                <div className="flex justify-between items-center w-full">
                  <input
                    type="text"
                    value={activeField === 'sell' ? (effectiveParsedSell > 0 ? (exchangeRate > 0 ? buyAmountDisplay : buyAmountInput) : '') : buyAmountInput}
                    onChange={handleBuyAmountChange}
                    onFocus={() => setActiveField('buy')}
                    aria-label="Amount to receive"
                    className={`bg-transparent border-none p-0 text-2xl sm:text-3xl font-headline font-bold text-white focus:ring-0 w-full sm:w-2/3 outline-none ${activeField === 'sell' ? 'opacity-80' : ''}`}
                    placeholder="0.00"
                  />
                  <button
                    onClick={() => setTokenModalSide('buy')}
                    className="hidden sm:flex bg-surface-container-high px-3 py-2 items-center gap-2 border border-outline-variant/15 hover:border-primary/50 transition-colors cursor-pointer shrink-0"
                  >
                    <div className="w-6 h-6 flex items-center justify-center">
                      <img className="w-5 h-5" alt="" src={buyToken.icon as string} />
                    </div>
                    <span className="font-headline font-bold">{buyToken.symbol}</span>
                    <ChevronDown className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>

            {/* Swap details */}
            <div className="space-y-2 mt-2">
              <div className="flex justify-between text-xs font-headline text-on-surface-variant uppercase">
                <span>Exchange Rate</span>
                <span className="text-white truncate">{exchangeRate > 0 ? `1 ${sellToken.symbol} = ${fmtAmt(exchangeRate)} ${buyToken.symbol}` : '—'}</span>
              </div>
              <div className="flex justify-between items-center text-xs font-headline text-on-surface-variant uppercase">
                <span>Price Impact</span>
                <span className={`font-bold ${effectiveParsedSell > 0 ? impactColor(priceImpact) : 'text-on-surface-variant'}`}>
                  {effectiveParsedSell > 0
                    ? `~${(priceImpact * 100).toFixed(2)}%`
                    : '—'}
                </span>
              </div>
              {effectiveParsedSell > 0 && priceImpact >= PRICE_IMPACT_WARN && (
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
                <span className="text-secondary">{effectiveSlippage}%{isAutoSlippage ? ' ✨' : ''}</span>
              </div>
              <div className="flex justify-between items-center text-xs font-headline text-on-surface-variant uppercase">
                <span>Transaction Deadline</span>
                <span className="text-white">{deadline} min</span>
              </div>
              <div className="flex justify-between text-xs font-headline text-on-surface-variant uppercase">
                <span>Min. Received</span>
                <span className="text-white">{effectiveParsedSell > 0 && exchangeRate > 0 ? `${minReceived} ${buyToken.symbol}` : '—'}</span>
              </div>
              <div className="flex justify-between text-xs font-headline text-on-surface-variant uppercase">
                <span>Network Fee</span>
                <span className="text-white">~0.05 DOGE <span className="text-on-surface-variant text-[9px]">(est.)</span></span>
              </div>
            </div>

            {/* Token tax warning */}
            {buyToken && (() => {
              const taxInfo = getCachedTaxInfo(buyToken.address);
              return taxInfo.warningLevel !== 'none' ? <TokenWarningBanner taxInfo={taxInfo} compact /> : null;
            })()}

            {/* Action button */}
            <button
              disabled={isDisabled}
              onClick={handleExecuteAction}
              className={`w-full font-headline font-black text-xl py-5 uppercase tracking-tighter transition-all relative overflow-hidden cursor-pointer ${
                isDisabled
                  ? 'bg-surface-container-highest text-on-surface-variant cursor-not-allowed border border-outline-variant/30'
                  : 'bg-primary text-black shadow-[0_0_30px_rgba(255,215,0,0.3)] hover:bg-white hover:text-black hover:shadow-[0_0_50px_rgba(255,215,0,0.5)] active:scale-[0.98]'
              }`}
            >
              {buttonText}
            </button>
          </div>
        </div>

        {/* Swap history — shared SwapHistory component */}
        <div className="mt-4 w-full relative z-10">
          <SwapHistory
            localHistory={swapHistory}
            onClearLocalHistory={() => setSwapHistory([])}
          />
        </div>

        {/* Market data cards — $OMNOM stats */}
        <div className="mt-8 grid grid-cols-2 sm:grid-cols-3 gap-4">
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

        {/* MEXC CEX data tiles */}
        <div className="mt-4 grid grid-cols-2 gap-4">
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
      {tokenModalSide && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={(e) => { if (e.target === e.currentTarget) { setTokenModalSide(null); } }} role="dialog" aria-modal="true">
          <div className="bg-surface-container-low border border-outline-variant/20 w-full max-w-md mx-0 sm:mx-4 shadow-2xl max-h-[85vh] sm:max-h-[80vh] sm:rounded-2xl rounded-t-none overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b border-outline-variant/15 shrink-0">
              <div className="flex items-center gap-2">
                <h3 className="font-headline font-bold text-lg uppercase tracking-tight text-white">Select Token</h3>
                <span className="text-[9px] px-1.5 py-0.5 bg-purple-500/20 text-purple-400 rounded font-body">DOGESWAP</span>
              </div>
              <button onClick={() => { setTokenModalSide(null); }} className="text-on-surface-variant hover:text-white transition-colors cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="px-4 py-2 bg-primary/10 border-b border-primary/20">
              <span className="text-[10px] font-headline uppercase tracking-widest text-primary">DogeSwap Native Tokens</span>
            </div>

            <div className="max-h-80 overflow-y-auto custom-scrollbar">
              {filteredTokens.length > 0 ? filteredTokens.map((token) => {
                const isSelected = token.symbol === (tokenModalSide === 'sell' ? sellToken.symbol : buyToken.symbol);
                const tokenBalance = dogeswapBalances.get(token.address.toLowerCase()) || 0;
                const hasBalance = tokenBalance > 0;
                return (
                  <button
                    key={token.symbol}
                    onClick={() => { handleTokenSelect(token); }}
                    disabled={isSelected}
                    className={`w-full flex items-center gap-3 px-4 py-3 transition-colors cursor-pointer ${
                      isSelected
                        ? 'bg-primary/5 border-l-2 border-l-primary'
                        : hasBalance
                        ? 'bg-primary/5 border-l-2 border-l-primary/30 hover:bg-surface-container-high'
                        : 'hover:bg-surface-container-high border-l-2 border-l-transparent'
                    }`}
                  >
                    <div className="w-9 h-9 rounded-full overflow-hidden bg-surface-container-highest flex items-center justify-center shrink-0">
                      {token.icon && token.isImage ? (
                        <img src={token.icon} alt={token.symbol} className="w-full h-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                      ) : (
                        <span className="text-xs font-headline font-bold text-primary">{token.symbol.slice(0, 2)}</span>
                      )}
                    </div>
                    <div className="flex-1 text-left min-w-0">
                      <div className="font-headline font-bold text-sm text-white">{token.symbol}</div>
                      <div className="text-xs text-on-surface-variant font-body truncate">{token.name}</div>
                    </div>
                    <div className="text-right overflow-hidden">
                      <div className="text-sm font-body text-white truncate whitespace-nowrap">
                        {isConnected ? (hasBalance ? fmtAmt(tokenBalance) : '0') : ''}
                      </div>
                    </div>
                  </button>
                );
              }) : (
                <div className="p-8 text-center text-on-surface-variant font-body text-sm">
                  No tokens found
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Confirmation modal */}
      {showConfirmModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center pt-20 pb-4 px-4 bg-black/60 backdrop-blur-sm overflow-y-auto custom-scrollbar" onClick={(e) => { if (e.target === e.currentTarget && !isSwapping) setShowConfirmModal(false); }}>
          <div className="bg-surface-container-low border border-primary/30 w-full max-w-md shadow-[0_0_50px_rgba(255,215,0,0.15)] p-6" onClick={e => e.stopPropagation()}>
            {isSwapping ? (
              <div className="flex flex-col items-center justify-center py-12">
                <div className="relative w-24 h-24 mb-6">
                  <div className="absolute inset-0 border-4 border-outline-variant/30 rounded-full"></div>
                  <div className="absolute inset-0 border-4 border-primary rounded-full border-t-transparent animate-spin"></div>
                  <UtensilsCrossed className="absolute inset-0 m-auto w-8 h-8 text-primary animate-pulse" />
                </div>
                <h3 className="font-headline font-black text-2xl uppercase tracking-tighter text-white mb-2 animate-pulse">EXECUTING SWAP</h3>
                <p className="text-on-surface-variant text-sm font-body">Chomping through the blockchain...</p>
              </div>
            ) : (
              <>
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
                    <span className="font-headline font-bold text-xl text-primary">{buyAmountDisplay} {buyToken.symbol}</span>
                  </div>
                </div>

                <div className="space-y-2 mb-8 p-4 border border-outline-variant/15 bg-surface-container-highest/50">
                  <div className="flex justify-between text-xs font-headline text-on-surface-variant uppercase">
                    <span>Rate</span>
                    <span className="text-white truncate">1 {sellToken.symbol} = {fmtAmt(exchangeRate)} {buyToken.symbol}</span>
                  </div>
                  <div className="flex justify-between text-xs font-headline text-on-surface-variant uppercase">
                    <span>Price Impact</span>
                    <span className={`font-bold ${impactColor(priceImpact)}`}>~{(priceImpact * 100).toFixed(2)}%</span>
                  </div>
                  <div className="flex justify-between text-xs font-headline text-on-surface-variant uppercase">
                    <span>Slippage</span>
                    <span className="text-secondary">{effectiveSlippage}%{isAutoSlippage ? ' ✨' : ''}</span>
                  </div>
                  <div className="flex justify-between text-xs font-headline text-on-surface-variant uppercase">
                    <span>Min. Received</span>
                    <span className="text-white">{minReceived} {buyToken.symbol}</span>
                  </div>
                  <div className="flex justify-between text-xs font-headline text-on-surface-variant uppercase">
                    <span>Network Fee</span>
                    <span className="text-white">~0.05 DOGE <span className="text-on-surface-variant text-[9px]">(est.)</span></span>
                  </div>
                </div>

                {/* MEV risk warning */}
                <div className="flex items-start justify-center gap-2 p-3 bg-surface-container border border-outline-variant/10 text-on-surface-variant text-[10px] font-body text-center">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-yellow-400 mt-0.5" />
                  <span>
                    Your transaction will be visible in the public mempool. Slippage tolerance protects against price changes.
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
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
