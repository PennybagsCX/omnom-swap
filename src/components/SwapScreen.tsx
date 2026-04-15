import { useState, useEffect, useCallback } from 'react';
import { Settings, ChevronDown, UtensilsCrossed, Zap, Search, Ghost, X, ExternalLink, AlertTriangle } from 'lucide-react';
import { useAccount, useBalance, useReadContract, useWriteContract, useChainId, usePublicClient } from 'wagmi';
import { erc20Abi, parseAbi, parseUnits, formatUnits } from 'viem';
import { TOKENS, CONTRACTS, NETWORK_INFO, isNativeToken, OMNOM_WWDOGE_POOL, V2_ROUTER_ABI, MAX_UINT256, PRICE_IMPACT_WARN, PRICE_IMPACT_BLOCK, calcPriceImpact, impactColor } from '../lib/constants';
import { useOmnomData } from '../hooks/useOmnomData';
import { usePoolReserves, useTokenDecimals } from '../hooks/useLiquidity';
import { useToast } from './ToastContext';

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

// Smart price formatting — drop insignificant trailing zeros, show enough precision for micro-prices
function fmtPrice(n: number | null): string {
  if (n === null) return '\u2014';
  if (n === 0) return '$0';
  if (n >= 1) return `$${n.toFixed(2)}`;
  if (n >= 0.01) return `$${n.toFixed(4)}`;
  // For very small prices, find first significant digit and show 2 digits past it
  const str = n.toFixed(10);
  const match = str.match(/0\.(0+)([1-9])/);
  if (match) {
    const zeros = match[1].length;
    const precision = zeros + 2;
    return `$${n.toFixed(precision)}`;
  }
  return `$${n.toFixed(6)}`;
}

// Round to 2 decimal places for display amounts
function fmtAmt(n: number): string {
  if (n === 0) return '0';
  if (n >= 1) return n.toFixed(2);
  if (n >= 0.01) return n.toFixed(4);
  return n.toFixed(6);
}

function fmtUsd(n: number | null): string {
  if (n === null) return '\u2014';
  if (n === 0) return '$0';
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  if (n >= 1) return `$${n.toFixed(2)}`;
  if (n >= 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(6)}`;
}

export function SwapScreen() {
  const [sellAmount, setSellAmount] = useState<string>('');
  const [sellToken, setSellToken] = useState(TOKENS[1]); // OMNOM
  const [buyToken, setBuyToken] = useState(TOKENS[0]); // WWDOGE
  const [exchangeRate, setExchangeRate] = useState(0);
  const [tokenModalSide, setTokenModalSide] = useState<'sell' | 'buy' | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [slippage, setSlippage] = useState<string>('1.0');
  const [deadline, setDeadline] = useState<string>('5');
  const [showHistory, setShowHistory] = useState(false);
  const [historySearchQuery, setHistorySearchQuery] = useState('');
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

  const filteredTokens = TOKENS.filter(t =>
    t.symbol.toLowerCase().includes(searchQuery.toLowerCase()) ||
    t.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const parsedSell = parseFloat(sellAmount) || 0;

  // Pool reserves for quoting and price impact
  const { reserve0: poolRes0, reserve1: poolRes1, token0: poolT0, token1: poolT1 } = usePoolReserves(OMNOM_WWDOGE_POOL);

  // Live $OMNOM market data — shared across all components via centralized hook
  const { priceUsd: omnomPriceUsd, totalVol24: omnomVol24, fdvUsd: omnomFdvUsd, mexcPrice, mexcVol24 } = useOmnomData();
  const omnomPrice = fmtPrice(omnomPriceUsd);
  const omnomVol = fmtUsd(omnomVol24);
  const omnomFdv = fmtUsd(omnomFdvUsd);
  const mexcPriceStr = fmtPrice(mexcPrice);
  const mexcVolStr = fmtUsd(mexcVol24);

  // Price quoting via V2 router (best available on Dogechain)
  const parsedSellWei = parsedSell > 0 ? parseUnits(parsedSell.toString(), sellDecimals) : 0n;

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
  // Most reliable for the main OMNOM/WWDOGE pool — avoids V3 tiny-pool misquotes
  const poolBasedRate = (() => {
    if (parsedSell <= 0 || parsedSellWei <= 0n || !poolT0 || !poolT1) return 0;
    const sellAddr = (isNativeToken(sellToken) ? CONTRACTS.WWDOGE : sellToken.address).toLowerCase();
    const buyAddr = (isNativeToken(buyToken) ? CONTRACTS.WWDOGE : buyToken.address).toLowerCase();
    const sellIsT0 = sellAddr === poolT0.toLowerCase();
    const sellIsT1 = sellAddr === poolT1.toLowerCase();
    const buyIsT0 = buyAddr === poolT0.toLowerCase();
    const buyIsT1 = buyAddr === poolT1.toLowerCase();
    if (!((sellIsT0 && buyIsT1) || (sellIsT1 && buyIsT0))) return 0;
    const reserveSell = sellIsT0 ? poolRes0 : poolRes1;
    const reserveBuy = sellIsT0 ? poolRes1 : poolRes0;
    if (reserveSell <= 0n || reserveBuy <= 0n) return 0;
    // V2 AMM with 0.3% fee: amountOut = reserveBuy * amountIn * 997 / (reserveSell * 1000 + amountIn * 997)
    const buyWei = (reserveBuy * parsedSellWei * 997n) / (reserveSell * 1000n + parsedSellWei * 997n);
    return Number(formatUnits(buyWei, buyDecimals)) / parsedSell;
  })();

  useEffect(() => {
    // Primary: direct V2 pool math (reliable, uses main pool with real liquidity)
    // Fallback: V3 Quoter → V2 Router (may quote against thin liquidity pools)
    if (poolBasedRate > 0) {
      setExchangeRate(poolBasedRate);
    } else if (v3Quote !== undefined && v3Quote !== null && parsedSellWei > 0n) {
      const outAmount = formatUnits(v3Quote as bigint, buyDecimals);
      const rate = Number(outAmount) / parsedSell;
      setExchangeRate(rate);
    } else if (v2AmountsOut && (v2AmountsOut as bigint[]).length === 2 && parsedSellWei > 0n) {
      const outAmount = formatUnits((v2AmountsOut as bigint[])[1], buyDecimals);
      const rate = Number(outAmount) / parsedSell;
      setExchangeRate(rate);
    } else if (sellToken.address === buyToken.address || sellToken.symbol === buyToken.symbol) {
      setExchangeRate(1);
    } else if (parsedSell === 0) {
      setExchangeRate(0);
    }
  }, [poolBasedRate, v3Quote, v2AmountsOut, parsedSellWei, parsedSell, sellToken, buyToken]);

  // Calculations
  const parsedSlippage = parseFloat(slippage) || 0;
  const slippageTooHigh = parsedSlippage > 50; // Fix 2: upper-bound validation
  const buyAmount = exchangeRate > 0 ? fmtAmt(parsedSell * exchangeRate) : '0';
  const minReceived = exchangeRate > 0 ? fmtAmt(parsedSell * exchangeRate * (1 - parsedSlippage / 100)) : '0';

  // Price impact (estimated from pool reserves)
  const priceImpact = (() => {
    if (parsedSell <= 0 || !poolT0) return 0;
    const sellAddr = (isNativeToken(sellToken) ? CONTRACTS.WWDOGE : sellToken.address).toLowerCase();
    const reserveSell = sellAddr === poolT0.toLowerCase()
      ? Number(formatUnits(poolRes0, sellDecimals))
      : Number(formatUnits(poolRes1, buyDecimals));
    return calcPriceImpact(parsedSell, reserveSell);
  })();

  // Input validation
  const inputError = (() => {
    if (!isConnected) return null;
    if (!sellAmount || parsedSell <= 0) return null;
    if (isNaN(parsedSell) || !isFinite(parsedSell)) return 'Invalid amount';
    if (parsedSell > 1e18) return 'Amount too large';
    if (parsedSell > displaySellBalance) return 'Insufficient balance';
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
  } else if (!sellAmount || parsedSell <= 0) {
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
  }

  const handleExecuteAction = () => {
    setShowConfirmModal(true);
  };

  const handleSwapTokens = () => {
    const temp = sellToken;
    setSellToken(buyToken);
    setBuyToken(temp);
    setSellAmount('');
    setExchangeRate(0);
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
    }
  };

  const publicClient = usePublicClient();

  const parsedRouterAbi = parseAbi(V2_ROUTER_ABI);

  // Swap via V2 router — atomic single transaction (correct WDOGE function names)
  const handleConfirmSwap = async () => {
    if (!address || parsedSellWei <= 0n) return;
    setIsSwapping(true);

    const routerAddress = CONTRACTS.DOGESWAP_V2_ROUTER as `0x${string}`;
    const isSellingNative = isNativeToken(sellToken);
    const isBuyingNative = isNativeToken(buyToken);
    const txDeadline = Math.floor(Date.now() / 1000) + (parseInt(deadline) || 5) * 60;

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

      const slippageBps = BigInt(Math.floor((parseFloat(slippage) || 1) * 100));
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
          const approveHash = await writeContract({
            address: sellToken.address as `0x${string}`,
            abi: erc20Abi,
            functionName: 'approve',
            args: [routerAddress, MAX_UINT256],
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
            id: Date.now(), sellAmount: parsedSell, sellSymbol: sellToken.symbol,
            buyAmount: buyAmountActual, buySymbol: buyToken.symbol,
            hash: swapHash as string, time: 'Just now', status: 'success',
            priceImpact: priceImpact * 100,
          }, ...prev]);
          setSellAmount('');
          addToast({
            type: 'success', title: 'Swap Complete',
            message: `${parsedSell} ${sellToken.symbol} → ${fmtAmt(buyAmountActual)} ${buyToken.symbol}`,
            link: `${NETWORK_INFO.blockExplorer}/tx/${swapHash}`,
          });
        } else {
          setSwapHistory(prev => [{
            id: Date.now(), sellAmount: parsedSell, sellSymbol: sellToken.symbol,
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
          id: Date.now(), sellAmount: parsedSell, sellSymbol: sellToken.symbol,
          buyAmount: buyAmountActual, buySymbol: buyToken.symbol,
          hash: swapHash as string, time: 'Just now', status: 'success',
            priceImpact: priceImpact * 100,
        }, ...prev]);
        setSellAmount('');
        addToast({
          type: 'success', title: 'Transaction Sent',
          message: `${parsedSell} ${sellToken.symbol} → ${fmtAmt(buyAmountActual)} ${buyToken.symbol}`,
          link: `${NETWORK_INFO.blockExplorer}/tx/${swapHash}`,
        });
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Swap failed';
      setShowConfirmModal(false);
      const isRejected = msg.includes('UserRejected') || msg.includes('denied') || msg.includes('rejected');
      addToast({
        type: 'error', title: isRejected ? 'Swap Cancelled' : 'Swap Failed',
        message: isRejected ? 'Transaction was rejected' : msg.substring(0, 80),
      });
    } finally {
      setIsSwapping(false);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-[80vh] relative">
      {/* Background glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 max-w-[500px] w-full h-[500px] bg-primary/10 blur-[120px] rounded-none pointer-events-none"></div>

      <div className="w-full max-w-[480px] relative z-10 px-4 md:px-0">
        {/* Mode badge */}
        <div className="flex justify-center mb-6">
          <div className="border border-secondary/50 px-4 py-1 flex items-center gap-2 bg-secondary/10">
            <Zap className="text-secondary w-4 h-4 animate-pulse" fill="currentColor" />
            <span className="font-headline font-bold text-secondary text-xs uppercase tracking-widest animate-pulse">Savage Mode</span>
          </div>
        </div>

        {/* Swap card */}
        <div className="glass-panel p-1 shadow-[0_0_40px_rgba(255,215,0,0.08)] border border-primary/20">
          <div className="bg-surface p-6 flex flex-col gap-4">
            <div className="flex justify-between items-center mb-2">
              <h2 className="font-headline font-bold text-xl uppercase tracking-tight text-white">Swap Assets</h2>
              <button
                onClick={() => setShowSettings(!showSettings)}
                className={`transition-colors cursor-pointer ${showSettings ? 'text-primary' : 'text-on-surface-variant hover:text-primary'}`}
              >
                <Settings className={`w-5 h-5 transition-transform duration-300 ${showSettings ? 'rotate-90' : ''}`} />
              </button>
            </div>

            {/* Settings panel — smooth expand/collapse */}
            <div className={`overflow-hidden transition-all duration-300 ease-in-out ${showSettings ? 'max-h-60 opacity-100 mb-4' : 'max-h-0 opacity-0'}`}>
              <div className="bg-surface-container-low border border-primary/30 p-4">
                <h3 className="font-headline font-bold text-xs uppercase tracking-widest text-primary mb-4">Transaction Settings</h3>

                <div className="space-y-4">
                  <div>
                    <div className="flex justify-between items-center mb-2">
                      <span className="text-[10px] font-headline uppercase text-on-surface-variant">Slippage Tolerance</span>
                      <button
                        onClick={() => {
                          const base = 0.5;
                          const sizeFactor = parsedSell > 1000 ? 0.5 : 0.2;
                          setSlippage((base + sizeFactor).toFixed(1));
                        }}
                        className="text-[9px] font-bold uppercase tracking-widest text-primary bg-primary/10 border border-primary/20 px-1.5 py-0.5 hover:bg-primary hover:text-on-primary transition-colors cursor-pointer"
                      >
                        Auto
                      </button>
                    </div>
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
                    {slippageTooHigh ? (
                      <p className="text-[9px] text-red-400 mt-1 uppercase">Slippage tolerance too high. Maximum is 50%.</p>
                    ) : parseFloat(slippage) > 5 ? (
                      <p className="text-[9px] text-yellow-400 mt-1 uppercase">High slippage may result in unfavorable trades</p>
                    ) : null}
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
            <div className="bg-surface-container-low p-5 border-l-4 border-primary">
              <div className="flex justify-between text-xs font-headline uppercase text-on-surface-variant mb-2">
                <span>You Sell</span>
                <div className="flex items-center gap-2">
                  <span>Balance: {displaySellBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 5 })}</span>
                  <button
                    onClick={() => {
                      const max = displaySellBalance * 0.99; // Reserve for gas
                      setSellAmount(max > 0 ? max.toString() : '0');
                    }}
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
                    className="bg-transparent border-none p-0 text-2xl sm:text-3xl font-headline font-bold text-white focus:ring-0 w-full sm:w-2/3 outline-none"
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
                className={`bg-primary text-black p-2 hover:bg-white transition-transform duration-300 cursor-pointer ${swapFlip ? 'rotate-180' : 'rotate-0'}`}
              >
                <UtensilsCrossed className="w-6 h-6" />
              </button>
            </div>

            {/* Buy output */}
            <div className="bg-surface-container-low p-5 border-l-4 border-outline-variant/30">
              <div className="flex justify-between text-xs font-headline uppercase text-on-surface-variant mb-2">
                <span>You Buy (Estimated)</span>
                <span>Balance: {displayBuyBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 5 })}</span>
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
                    value={parsedSell > 0 && exchangeRate > 0 ? buyAmount : ''}
                    readOnly
                    className="bg-transparent border-none p-0 text-2xl sm:text-3xl font-headline font-bold text-white focus:ring-0 w-full sm:w-2/3 outline-none opacity-80"
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
                <span className="text-white">{exchangeRate > 0 ? `1 ${sellToken.symbol} = ${exchangeRate.toFixed(6)} ${buyToken.symbol}` : '—'}</span>
              </div>
              <div className="flex justify-between items-center text-xs font-headline text-on-surface-variant uppercase">
                <span>Price Impact</span>
                <span className={`font-bold ${parsedSell > 0 ? impactColor(priceImpact) : 'text-on-surface-variant'}`}>
                  {parsedSell > 0
                    ? `~${(priceImpact * 100).toFixed(2)}%`
                    : '—'}
                </span>
              </div>
              {parsedSell > 0 && priceImpact >= PRICE_IMPACT_WARN && (
                <div className={`flex items-center gap-2 p-2 text-xs font-headline ${
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
                <span className="text-secondary">{slippage}%</span>
              </div>
              <div className="flex justify-between items-center text-xs font-headline text-on-surface-variant uppercase">
                <span>Transaction Deadline</span>
                <span className="text-white">{deadline} min</span>
              </div>
              <div className="flex justify-between text-xs font-headline text-on-surface-variant uppercase">
                <span>Min. Received</span>
                <span className="text-white">{parsedSell > 0 && exchangeRate > 0 ? `${minReceived} ${buyToken.symbol}` : '—'}</span>
              </div>
              <div className="flex justify-between text-xs font-headline text-on-surface-variant uppercase">
                <span>Network Fee</span>
                <span className="text-white">~0.05 DOGE</span>
              </div>
            </div>

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

        {/* Swap history */}
        <div className="mt-4 w-full relative z-10">
          <button
            onClick={() => setShowHistory(!showHistory)}
            className="w-full flex items-center justify-between p-4 glass-panel shadow-[0_0_20px_rgba(0,0,0,0.2)] border border-outline-variant/15 hover:border-primary/30 transition-colors cursor-pointer"
          >
            <span className="font-headline font-bold uppercase text-sm text-white">Recent Swaps</span>
            <ChevronDown className={`w-4 h-4 text-on-surface-variant transition-transform ${showHistory ? 'rotate-180' : ''}`} />
          </button>

          <div className={`overflow-hidden transition-all duration-300 ease-in-out ${showHistory ? 'max-h-[600px] opacity-100 mt-2' : 'max-h-0 opacity-0'}`}>
            <div className="glass-panel border border-outline-variant/15 p-4 space-y-3">
              <div className="relative mb-3">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-on-surface-variant" />
                <input
                  type="text"
                  placeholder="Search history..."
                  value={historySearchQuery}
                  onChange={(e) => setHistorySearchQuery(e.target.value)}
                  className="w-full bg-surface-container-highest border border-outline-variant/30 text-white pl-7 pr-3 py-2 focus:border-primary outline-none font-body text-xs"
                />
              </div>
              {swapHistory.filter(tx =>
                tx.sellSymbol.toLowerCase().includes(historySearchQuery.toLowerCase()) ||
                tx.buySymbol.toLowerCase().includes(historySearchQuery.toLowerCase())
              ).length > 0 ? (
                <>
                  {swapHistory.filter(tx =>
                    tx.sellSymbol.toLowerCase().includes(historySearchQuery.toLowerCase()) ||
                    tx.buySymbol.toLowerCase().includes(historySearchQuery.toLowerCase())
                  ).map(tx => (
                    <div key={tx.id} className="border-b border-outline-variant/10 pb-2 last:border-0 last:pb-0">
                      <div className="flex items-center gap-1.5 text-xs flex-wrap">
                        <span className="font-bold text-white">{tx.sellAmount} {tx.sellSymbol}</span>
                        <UtensilsCrossed className="w-2.5 h-2.5 text-on-surface-variant rotate-90 shrink-0" />
                        <span className="font-bold text-primary">{tx.buyAmount} {tx.buySymbol}</span>
                        <span className={`text-[9px] font-headline font-bold shrink-0 ${(tx.priceImpact ?? 0) >= PRICE_IMPACT_WARN * 100 ? 'text-yellow-400' : 'text-green-400'}`}>{(tx.priceImpact ?? 0).toFixed(1)}%</span>
                      </div>
                      <div className="flex items-center justify-between mt-0.5">
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] text-on-surface-variant">{tx.time}</span>
                          {tx.hash && (
                            <a href={`${NETWORK_INFO.blockExplorer}/tx/${tx.hash}`} target="_blank" rel="noopener noreferrer" className="text-on-surface-variant hover:text-primary">
                              <ExternalLink className="w-2.5 h-2.5" />
                            </a>
                          )}
                        </div>
                        <span className={`text-[9px] font-bold uppercase ${tx.status === 'success' ? 'text-green-400' : tx.status === 'failed' ? 'text-red-400' : 'text-yellow-400'}`}>{tx.status}</span>
                      </div>
                    </div>
                  ))}
                  <button
                    onClick={() => setSwapHistory([])}
                    className="w-full mt-2 py-2 text-xs font-headline uppercase tracking-widest text-on-surface-variant hover:text-secondary border border-outline-variant/15 hover:border-secondary/30 transition-colors cursor-pointer"
                  >
                    Clear History
                  </button>
                </>
              ) : (
                <div className="flex flex-col items-center justify-center py-8 text-on-surface-variant">
                  <Ghost className="w-12 h-12 mb-3 opacity-20" />
                  <div className="text-sm font-headline uppercase tracking-widest text-white mb-1">No Swaps Found</div>
                  <div className="text-[10px] uppercase tracking-wider opacity-60">The void remains empty</div>
                </div>
              )}
            </div>
          </div>
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
            <p className="font-headline font-bold text-white whitespace-nowrap">{omnomFdv}</p>
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
        <div className="fixed inset-0 z-[100] flex items-center justify-center pt-20 pb-4 px-4 bg-black/60 backdrop-blur-sm overflow-y-auto" onClick={(e) => { if (e.target === e.currentTarget) { setTokenModalSide(null); setSearchQuery(''); }}}>
          <div className="bg-surface-container-low border border-primary/30 w-full max-w-md shadow-[0_0_50px_rgba(255,215,0,0.15)] flex flex-col max-h-[80vh]" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center p-4 border-b border-outline-variant/15 shrink-0">
              <h3 className="font-headline font-bold text-xl uppercase tracking-tight text-white">Select Token</h3>
              <button onClick={() => { setTokenModalSide(null); setSearchQuery(''); }} className="text-on-surface-variant hover:text-primary transition-colors cursor-pointer">
                <X className="w-6 h-6" />
              </button>
            </div>

            <div className="p-4 border-b border-outline-variant/15 shrink-0">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-on-surface-variant" />
                <input
                  type="text"
                  placeholder="Search by name or symbol"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-surface-container-highest border border-outline-variant/30 text-white pl-10 pr-4 py-3 focus:border-primary outline-none font-body text-sm"
                />
              </div>
            </div>

            <div className="p-2 overflow-y-auto flex-1">
              {filteredTokens.length > 0 ? filteredTokens.map((token) => (
                <button
                  key={token.symbol}
                  onClick={() => { handleTokenSelect(token); setSearchQuery(''); }}
                  className="w-full flex items-center justify-between p-4 hover:bg-surface-container-high transition-colors border-b border-outline-variant/5 last:border-0 group cursor-pointer"
                >
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 flex items-center justify-center">
                      <img src={token.icon as string} alt="" className="w-6 h-6" />
                    </div>
                    <div className="text-left">
                      <div className="font-headline font-bold text-white uppercase">{token.symbol}</div>
                      <div className="text-xs text-on-surface-variant">{token.name}</div>
                    </div>
                  </div>
                </button>
              )) : (
                <div className="text-center py-8 text-on-surface-variant text-sm font-headline uppercase tracking-widest">
                  No tokens found
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Confirmation modal */}
      {showConfirmModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center pt-20 pb-4 px-4 bg-black/60 backdrop-blur-sm overflow-y-auto" onClick={(e) => { if (e.target === e.currentTarget && !isSwapping) setShowConfirmModal(false); }}>
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
                    <span className="font-headline font-bold text-xl text-white">{sellAmount} {sellToken.symbol}</span>
                  </div>
                  <div className="flex justify-center -my-6 relative z-10">
                    <div className="bg-surface-container-highest p-2 rounded-full border border-outline-variant/15">
                      <UtensilsCrossed className="w-4 h-4 text-primary" />
                    </div>
                  </div>
                  <div className="flex justify-between items-center bg-surface-container p-4">
                    <span className="text-xs font-headline uppercase text-on-surface-variant">You Buy (Est.)</span>
                    <span className="font-headline font-bold text-xl text-primary">{buyAmount} {buyToken.symbol}</span>
                  </div>
                </div>

                <div className="space-y-2 mb-8 p-4 border border-outline-variant/15 bg-surface-container-highest/50">
                  <div className="flex justify-between text-xs font-headline text-on-surface-variant uppercase">
                    <span>Rate</span>
                    <span className="text-white">1 {sellToken.symbol} = {exchangeRate.toFixed(6)} {buyToken.symbol}</span>
                  </div>
                  <div className="flex justify-between text-xs font-headline text-on-surface-variant uppercase">
                    <span>Price Impact</span>
                    <span className={`font-bold ${impactColor(priceImpact)}`}>~{(priceImpact * 100).toFixed(2)}%</span>
                  </div>
                  <div className="flex justify-between text-xs font-headline text-on-surface-variant uppercase">
                    <span>Slippage</span>
                    <span className="text-secondary">{slippage}%</span>
                  </div>
                  <div className="flex justify-between text-xs font-headline text-on-surface-variant uppercase">
                    <span>Min. Received</span>
                    <span className="text-white">{minReceived} {buyToken.symbol}</span>
                  </div>
                  <div className="flex justify-between text-xs font-headline text-on-surface-variant uppercase">
                    <span>Network Fee</span>
                    <span className="text-white">~0.05 DOGE</span>
                  </div>
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
