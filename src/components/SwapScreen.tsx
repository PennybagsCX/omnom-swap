import React, { useState, useEffect } from 'react';
import { Settings, ChevronDown, ArrowDownUp, Info, Zap, Search, Ghost, X } from 'lucide-react';
import { useAccount, useBalance, useReadContract, useWriteContract } from 'wagmi';
import { erc20Abi, parseAbi, parseUnits, formatUnits } from 'viem';
import { TOKENS, CONTRACTS } from '../lib/constants';

const INITIAL_SWAP_HISTORY = [
  { id: 1, sellAmount: 1000, sellSymbol: 'DOGE', buyAmount: 420.69, buySymbol: 'OMNOM', time: '10 mins ago' },
  { id: 2, sellAmount: 50, sellSymbol: 'USDT', buyAmount: 118.2, buySymbol: 'OMNOM', time: '2 hours ago' },
  { id: 3, sellAmount: 0.5, sellSymbol: 'WETH', buyAmount: 15000, buySymbol: 'DOGE', time: '1 day ago' },
];

export function SwapScreen() {
  const [sellAmount, setSellAmount] = useState<string>('1000');
  const [sellToken, setSellToken] = useState(TOKENS[0]);
  const [buyToken, setBuyToken] = useState(TOKENS[1]);
  const [exchangeRate, setExchangeRate] = useState(0.42069);
  const [tokenModalSide, setTokenModalSide] = useState<'sell' | 'buy' | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [showTooltip, setShowTooltip] = useState(false);
  const [slippage, setSlippage] = useState<string>('0.5');
  const [showHistory, setShowHistory] = useState(false);
  const [historySearchQuery, setHistorySearchQuery] = useState('');
  const [buttonHovered, setButtonHovered] = useState(false);
  const [swapHistory, setSwapHistory] = useState(INITIAL_SWAP_HISTORY);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [isSwapping, setIsSwapping] = useState(false);
  const [isApproving, setIsApproving] = useState(false);

  const { address, isConnected } = useAccount();

  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: sellToken.address as `0x${string}`,
    abi: erc20Abi,
    functionName: 'allowance',
    args: address ? [address, CONTRACTS.ALGEBRA_V3_ROUTER as `0x${string}`] : undefined,
    query: { enabled: isConnected && sellToken.symbol !== 'DOGE' && sellToken.address !== CONTRACTS.WWDOGE }
  });

  const { writeContractAsync: writeContract } = useWriteContract();


  const sellBalanceQuery = useBalance({
    address: address,
    token: sellToken.address === CONTRACTS.WWDOGE || sellToken.symbol === 'DOGE' ? undefined : sellToken.address as `0x${string}`,
    query: { enabled: isConnected }
  } as any);

  const buyBalanceQuery = useBalance({
    address: address,
    token: buyToken.address === CONTRACTS.WWDOGE || buyToken.symbol === 'DOGE' ? undefined : buyToken.address as `0x${string}`,
    query: { enabled: isConnected }
  } as any);

  const displaySellBalance = isConnected ? (sellBalanceQuery.data ? Number(formatUnits(sellBalanceQuery.data.value as bigint, sellBalanceQuery.data.decimals as number)) : 0) : sellToken.balance;
  const displayBuyBalance = isConnected ? (buyBalanceQuery.data ? Number(formatUnits(buyBalanceQuery.data.value as bigint, buyBalanceQuery.data.decimals as number)) : 0) : buyToken.balance;

  const filteredTokens = TOKENS.filter(t => 
    t.symbol.toLowerCase().includes(searchQuery.toLowerCase()) || 
    t.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Real-time price updates simulation
  useEffect(() => {
    const interval = setInterval(() => {
      setExchangeRate(prev => {
        const jitter = (Math.random() - 0.5) * 0.001;
        return Math.max(0.00001, prev + jitter);
      });
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  const parsedSell = parseFloat(sellAmount) || 0;
  const parsedSlippage = parseFloat(slippage) || 0;
  const buyAmount = (parsedSell * exchangeRate).toFixed(5);
  const minReceived = (parsedSell * exchangeRate * (1 - parsedSlippage / 100)).toFixed(5);

  let buttonText = "CHOMP THE SWAP";
  let isDisabled = false;
  let needsApproval = false;
  
  const parsedSellWei = parsedSell > 0 ? parseUnits(parsedSell.toString(), 18) : 0n;

  if (!isConnected) {
    buttonText = "CONNECT WALLET";
    isDisabled = true;
  } else if (!sellAmount || parsedSell <= 0) {
    buttonText = "ENTER AMOUNT";
    isDisabled = true;
  } else if (parsedSell > displaySellBalance) {
    buttonText = "INSUFFICIENT BALANCE";
    isDisabled = true;
  } else if (sellToken.symbol !== 'DOGE' && sellToken.address !== CONTRACTS.WWDOGE && allowance !== undefined && allowance < parsedSellWei) {
    needsApproval = true;
    buttonText = isApproving ? "APPROVING..." : "APPROVE ROUTER";
    isDisabled = isApproving;
  }

  const handleExecuteAction = async () => {
    if (needsApproval) {
      setIsApproving(true);
      try {
        await writeContract({
          address: sellToken.address as `0x${string}`,
          abi: erc20Abi,
          functionName: 'approve',
          args: [CONTRACTS.ALGEBRA_V3_ROUTER as `0x${string}`, parsedSellWei],
        } as any);
        setTimeout(() => refetchAllowance(), 2000);
      } catch (error) {
        console.error("Approval failed", error);
      } finally {
        setIsApproving(false);
      }
    } else {
      setShowConfirmModal(true);
    }
  };

  const handleSwapTokens = () => {
    const temp = sellToken;
    setSellToken(buyToken);
    setBuyToken(temp);
    setSellAmount(parsedSell > 0 ? buyAmount : '');
    setExchangeRate(1 / exchangeRate);
  };

  const handleTokenSelect = (token: typeof TOKENS[0]) => {
    if (tokenModalSide === 'sell') {
      if (token.symbol === buyToken.symbol) {
        handleSwapTokens();
      } else {
        setSellToken(token);
      }
    } else if (tokenModalSide === 'buy') {
      if (token.symbol === sellToken.symbol) {
        handleSwapTokens();
      } else {
        setBuyToken(token);
      }
    }
    setTokenModalSide(null);
  };

  const handleSellAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    if (val === '' || /^\d*\.?\d*$/.test(val)) {
      setSellAmount(val);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-[80vh] relative">
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-primary/10 blur-[120px] rounded-none pointer-events-none"></div>
      
      <div className="w-full max-w-[480px] relative z-10">
        <div className="flex justify-center mb-6">
          <div className="border border-secondary/50 px-4 py-1 flex items-center gap-2 bg-secondary/10">
            <Zap className="text-secondary w-4 h-4" fill="currentColor" />
            <span className="font-headline font-bold text-secondary text-xs uppercase tracking-widest">Savage Mode</span>
          </div>
        </div>

        <div className="glass-panel p-1 shadow-[0_0_40px_rgba(255,215,0,0.08)] border border-primary/20">
          <div className="bg-surface p-6 flex flex-col gap-4">
            <div className="flex justify-between items-center mb-2">
              <h2 className="font-headline font-bold text-xl uppercase tracking-tight text-white">Swap Assets</h2>
              <div className="relative group">
                <button className="text-on-surface-variant hover:text-primary transition-colors cursor-pointer">
                  <Settings className="w-5 h-5" />
                </button>
                <div className="absolute bottom-full right-0 mb-2 w-max px-3 py-2 bg-surface-container-highest border border-outline-variant/30 text-[10px] text-white normal-case tracking-normal shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50">
                  Transaction Settings
                </div>
              </div>
            </div>

            <div className="bg-surface-container-low p-5 border-l-4 border-primary">
              <div className="flex justify-between text-xs font-headline uppercase text-on-surface-variant mb-2">
                <span>You Sell</span>
                <div className="flex items-center gap-2">
                  <span>Balance: {displaySellBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 5 })}</span>
                  <button 
                    onClick={() => setSellAmount(displaySellBalance.toString())}
                    className="text-primary hover:text-white transition-colors px-1.5 py-0.5 bg-primary/10 border border-primary/20 text-[10px] active:scale-95 cursor-pointer"
                  >
                    MAX
                  </button>
                </div>
              </div>
              <div className="flex justify-between items-center">
                <input 
                  type="text" 
                  value={sellAmount}
                  onChange={handleSellAmountChange}
                  className="bg-transparent border-none p-0 text-3xl font-headline font-bold text-white focus:ring-0 w-2/3 outline-none" 
                  placeholder="0.00" 
                />
                <button 
                  onClick={() => setTokenModalSide('sell')}
                  className="bg-surface-container-high px-3 py-2 flex items-center gap-2 border border-outline-variant/15 hover:border-primary/50 transition-colors cursor-pointer"
                >
                  <div className="w-6 h-6 bg-surface-container-highest flex items-center justify-center">
                    {sellToken.isImage ? (
                      <img className="w-5 h-5 grayscale-[0.5]" alt={sellToken.symbol} src={sellToken.icon as string} />
                    ) : (
                      <sellToken.icon className="w-4 h-4 text-white" />
                    )}
                  </div>
                  <span className="font-headline font-bold">{sellToken.symbol}</span>
                  <ChevronDown className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="flex justify-center -my-6 relative z-20">
              <button 
                onClick={handleSwapTokens}
                className="bg-primary text-on-primary p-2 hover:rotate-180 transition-transform duration-500 shadow-[0_0_15px_rgba(255,215,0,0.5)] cursor-pointer"
              >
                <ArrowDownUp className="w-6 h-6" />
              </button>
            </div>

            <div className="bg-surface-container-low p-5 border-l-4 border-outline-variant/30">
              <div className="flex justify-between text-xs font-headline uppercase text-on-surface-variant mb-2">
                <span>You Buy</span>
                <span>Balance: {displayBuyBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 5 })}</span>
              </div>
              <div className="flex justify-between items-center">
                <input 
                  type="text" 
                  value={parsedSell > 0 ? buyAmount : ''}
                  readOnly
                  className="bg-transparent border-none p-0 text-3xl font-headline font-bold text-white focus:ring-0 w-2/3 outline-none opacity-80" 
                  placeholder="0.00" 
                />
                <button 
                  onClick={() => setTokenModalSide('buy')}
                  className="bg-surface-container-high px-3 py-2 flex items-center gap-2 border border-outline-variant/15 hover:border-primary/50 transition-colors cursor-pointer"
                >
                  <div className="w-6 h-6 bg-primary flex items-center justify-center">
                    {buyToken.isImage ? (
                      <img className="w-5 h-5" alt={buyToken.symbol} src={buyToken.icon as string} />
                    ) : (
                      <buyToken.icon className="w-4 h-4 text-on-primary" />
                    )}
                  </div>
                  <span className="font-headline font-bold">{buyToken.symbol}</span>
                  <ChevronDown className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="space-y-2 mt-2">
              <div className="flex justify-between text-xs font-headline text-on-surface-variant uppercase">
                <span>Exchange Rate</span>
                <span className="text-white">1 {sellToken.symbol} = {exchangeRate.toFixed(5)} {buyToken.symbol}</span>
              </div>
              <div className="flex justify-between items-center text-xs font-headline text-on-surface-variant uppercase relative">
                <span className="flex items-center gap-1">
                  Slippage Tolerance
                  <div 
                    className="relative flex items-center flex-col justify-center"
                    onMouseEnter={() => setShowTooltip(true)}
                    onMouseLeave={() => setShowTooltip(false)}
                  >
                    <Info className="w-3 h-3 cursor-help hover:text-primary transition-colors" />
                    {showTooltip && (
                      <div className="absolute bottom-full mb-2 w-64 p-4 bg-surface-container-highest border border-primary/30 text-[10px] text-white normal-case tracking-normal shadow-[0_0_20px_rgba(255,215,0,0.15)] z-20">
                        <div className="flex items-center gap-3 mb-3 pb-2 border-b border-outline-variant/30">
                          <div className="flex gap-1 items-end h-4">
                            <div className="w-1.5 bg-primary h-full animate-pulse"></div>
                            <div className="w-1.5 bg-secondary h-2/3 animate-pulse delay-75"></div>
                            <div className="w-1.5 bg-primary h-1/3 animate-pulse delay-150"></div>
                          </div>
                          <span className="font-bold uppercase tracking-widest text-primary">Market Volatility</span>
                        </div>
                        Slippage is the difference between the expected price of a trade and the price at which the trade is executed due to market movement.
                      </div>
                    )}
                  </div>
                </span>
                <div className="flex items-center gap-1">
                  <button 
                    onClick={() => {
                      const base = 0.1;
                      const sizeFactor = parsedSell > 1000 ? 0.4 : 0.1;
                      const volatility = Math.random() * 0.3;
                      setSlippage((base + sizeFactor + volatility).toFixed(2));
                    }}
                    className="text-[10px] font-bold uppercase tracking-widest text-primary bg-primary/10 border border-primary/20 px-1.5 py-0.5 hover:bg-primary hover:text-on-primary transition-colors mr-1 cursor-pointer"
                  >
                    Auto
                  </button>
                  <input
                    type="number"
                    value={slippage}
                    onChange={(e) => setSlippage(e.target.value)}
                    className="bg-surface-container-highest border border-outline-variant/30 text-secondary text-right w-16 px-1 py-0.5 focus:border-secondary outline-none"
                  />
                  <span className="text-secondary">%</span>
                </div>
              </div>
              <div className="flex justify-between text-xs font-headline text-on-surface-variant uppercase">
                <span>Min. Received</span>
                <span className="text-white">{minReceived} {buyToken.symbol}</span>
              </div>
              <div className="flex justify-between text-xs font-headline text-on-surface-variant uppercase">
                <span>Network Fee</span>
                <span className="text-white">~$4.20</span>
              </div>
            </div>

            <div 
              className="relative w-full mt-4"
              onMouseEnter={() => setButtonHovered(true)}
              onMouseLeave={() => setButtonHovered(false)}
            >
              <button 
                disabled={isDisabled}
                onClick={handleExecuteAction}
                className={`w-full font-headline font-black text-xl py-5 uppercase tracking-tighter transition-all relative overflow-hidden cursor-pointer ${
                  isDisabled 
                    ? 'bg-surface-container-highest text-on-surface-variant cursor-not-allowed border border-outline-variant/30' 
                    : 'bg-primary text-on-primary shadow-[0_0_30px_rgba(255,215,0,0.3)] hover:bg-white hover:text-black hover:shadow-[0_0_50px_rgba(255,215,0,0.5)] active:scale-[0.98]'
                }`}
              >
                {slippage === '0.5' && !isDisabled && (
                  <div className="absolute top-0 right-0 bg-white text-black text-[8px] px-2 py-1 font-bold tracking-widest animate-pulse pointer-events-none">
                    AUTO SLIPPAGE
                  </div>
                )}
                {buttonText}
              </button>
              {isDisabled && buttonHovered && (
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-max px-3 py-2 bg-surface-container-highest border border-outline-variant/50 text-xs text-white shadow-lg z-20 pointer-events-none">
                  {parsedSell <= 0 ? "Please enter an amount greater than 0 to proceed." : "You do not have enough balance for this transaction."}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="mt-4 w-full relative z-10">
          <button 
            onClick={() => setShowHistory(!showHistory)}
            className="w-full flex items-center justify-between p-4 glass-panel shadow-[0_0_20px_rgba(0,0,0,0.2)] border border-outline-variant/15 hover:border-primary/30 transition-colors cursor-pointer"
          >
            <span className="font-headline font-bold uppercase text-sm text-white">Recent Swaps</span>
            <ChevronDown className={`w-4 h-4 text-on-surface-variant transition-transform ${showHistory ? 'rotate-180' : ''}`} />
          </button>
          
          {showHistory && (
            <div className="mt-2 glass-panel border border-outline-variant/15 p-4 space-y-3">
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
                tx.buySymbol.toLowerCase().includes(historySearchQuery.toLowerCase()) ||
                tx.sellAmount.toString().includes(historySearchQuery) ||
                tx.buyAmount.toString().includes(historySearchQuery)
              ).length > 0 ? (
                <>
                  {swapHistory.filter(tx => 
                    tx.sellSymbol.toLowerCase().includes(historySearchQuery.toLowerCase()) ||
                    tx.buySymbol.toLowerCase().includes(historySearchQuery.toLowerCase()) ||
                    tx.sellAmount.toString().includes(historySearchQuery) ||
                    tx.buyAmount.toString().includes(historySearchQuery)
                  ).map(tx => (
                    <div key={tx.id} className="flex justify-between items-center text-sm border-b border-outline-variant/10 pb-2 last:border-0 last:pb-0">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-white">{tx.sellAmount} {tx.sellSymbol}</span>
                        <ArrowDownUp className="w-3 h-3 text-on-surface-variant rotate-90" />
                        <span className="font-bold text-primary">{tx.buyAmount} {tx.buySymbol}</span>
                      </div>
                      <div className="text-xs text-on-surface-variant">{tx.time}</div>
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
                  <Ghost className="w-12 h-12 mb-3 opacity-20 animate-bounce" />
                  <div className="text-sm font-headline uppercase tracking-widest text-white mb-1">No Swaps Found</div>
                  <div className="text-[10px] uppercase tracking-wider opacity-60">The void remains empty</div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="mt-8 flex gap-4 overflow-x-auto pb-4 no-scrollbar">
          <div className="bg-surface-container-low min-w-[140px] p-4 border-b-2 border-primary shadow-[0_4px_10px_rgba(255,215,0,0.1)]">
            <p className="text-[10px] font-headline uppercase text-on-surface-variant mb-1">DOGE Price</p>
            <p className="font-headline font-bold text-white">$0.1842</p>
            <p className="text-[10px] font-headline text-primary">+4.2%</p>
          </div>
          <div className="bg-surface-container-low min-w-[140px] p-4 border-b-2 border-secondary">
            <p className="text-[10px] font-headline uppercase text-on-surface-variant mb-1">OMNOM Market Cap</p>
            <p className="font-headline font-bold text-white">$8.2M</p>
            <p className="text-[10px] font-headline text-secondary">BEAST MODE</p>
          </div>
          <div className="bg-surface-container-low min-w-[140px] p-4 border-b-2 border-outline-variant/50">
            <p className="text-[10px] font-headline uppercase text-on-surface-variant mb-1">24h Vol</p>
            <p className="font-headline font-bold text-white">$1.4M</p>
            <p className="text-[10px] font-headline text-on-surface-variant">NORMAL</p>
          </div>
        </div>
      </div>

      {tokenModalSide && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-surface-container-low border border-primary/30 w-full max-w-md shadow-[0_0_50px_rgba(255,215,0,0.15)] flex flex-col max-h-[80vh]">
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
                    <div className="w-10 h-10 bg-surface-container-highest flex items-center justify-center border border-outline-variant/30 group-hover:border-primary/50 transition-colors">
                      {token.isImage ? (
                        <img src={token.icon as string} alt={token.symbol} className="w-6 h-6 grayscale-[0.5] group-hover:grayscale-0" />
                      ) : (
                        <token.icon className="w-5 h-5 text-white group-hover:text-primary transition-colors" />
                      )}
                    </div>
                    <div className="text-left">
                      <div className="font-headline font-bold text-white uppercase">{token.symbol}</div>
                      <div className="text-xs text-on-surface-variant">{token.name}</div>
                    </div>
                  </div>
                  <div className="text-right flex flex-col items-end">
                    <div className="font-headline font-bold text-white">{token.balance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 5 })}</div>
                    <div className="text-[10px] text-on-surface-variant uppercase">Balance</div>
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

      {showConfirmModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-surface-container-low border border-primary/30 w-full max-w-md shadow-[0_0_50px_rgba(255,215,0,0.15)] p-6">
            {isSwapping ? (
              <div className="flex flex-col items-center justify-center py-12">
                <div className="relative w-24 h-24 mb-6">
                  <div className="absolute inset-0 border-4 border-outline-variant/30 rounded-full"></div>
                  <div className="absolute inset-0 border-4 border-primary rounded-full border-t-transparent animate-spin"></div>
                  <ArrowDownUp className="absolute inset-0 m-auto w-8 h-8 text-primary animate-pulse" />
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
                      <ArrowDownUp className="w-4 h-4 text-primary" />
                    </div>
                  </div>
                  <div className="flex justify-between items-center bg-surface-container p-4">
                    <span className="text-xs font-headline uppercase text-on-surface-variant">You Buy</span>
                    <span className="font-headline font-bold text-xl text-primary">{buyAmount} {buyToken.symbol}</span>
                  </div>
                </div>

                <div className="space-y-2 mb-8 p-4 border border-outline-variant/15 bg-surface-container-highest/50">
                  <div className="flex justify-between text-xs font-headline text-on-surface-variant uppercase">
                    <span>Rate</span>
                    <span className="text-white">1 {sellToken.symbol} = {exchangeRate.toFixed(5)} {buyToken.symbol}</span>
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
                    <span className="text-white">~$4.20</span>
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
                    onClick={async () => {
                      setIsSwapping(true);
                      try {
                        const routerAbi = parseAbi(['function exactInputSingle((address tokenIn, address tokenOut, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 limitSqrtPrice) params) external payable returns (uint256 amountOut)']);
                        
                        const isSellingNative = sellToken.symbol === 'DOGE' || sellToken.address === CONTRACTS.WWDOGE;
                        const wDoge = CONTRACTS.WWDOGE as `0x${string}`;
                        
                        await writeContract({
                          address: CONTRACTS.ALGEBRA_V3_ROUTER as `0x${string}`,
                          abi: routerAbi,
                          functionName: 'exactInputSingle',
                          args: [{
                            tokenIn: isSellingNative ? wDoge : sellToken.address as `0x${string}`,
                            tokenOut: buyToken.symbol === 'DOGE' ? wDoge : buyToken.address as `0x${string}`,
                            recipient: address!,
                            deadline: BigInt(Math.floor(Date.now() / 1000) + 1200),
                            amountIn: parsedSellWei,
                            amountOutMinimum: parseUnits(minReceived.toString(), 18),
                            limitSqrtPrice: 0n,
                          }],
                          value: isSellingNative ? parsedSellWei : 0n,
                        } as any);
                        
                        setShowConfirmModal(false);
                        setSwapHistory([{
                          id: Date.now(),
                          sellAmount: parsedSell,
                          sellSymbol: sellToken.symbol,
                          buyAmount: parseFloat(buyAmount),
                          buySymbol: buyToken.symbol,
                          time: 'Just now'
                        }, ...swapHistory]);
                        setSellAmount('');
                      } catch (error) {
                        console.error('Swap failed:', error);
                      } finally {
                        setIsSwapping(false);
                      }
                    }}
                    className="flex-1 py-3 font-headline font-black uppercase tracking-widest bg-primary text-on-primary hover:bg-white hover:text-black transition-colors shadow-[0_0_20px_rgba(255,215,0,0.2)] cursor-pointer"
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
