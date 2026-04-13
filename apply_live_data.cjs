const fs = require('fs');

let code = fs.readFileSync('src/components/SwapScreen.tsx', 'utf8');

// 1. imports
code = code.replace(
  "import { useAccount, useBalance, useReadContract, useWriteContract } from 'wagmi';",
  "import { useAccount, useBalance, useReadContract, useWriteContract } from 'wagmi';\nimport { useQuery } from '@tanstack/react-query';"
);

// 2. clear swap history
code = code.replace(
  /const INITIAL_SWAP_HISTORY.*?\n\];/s,
  "const INITIAL_SWAP_HISTORY: any[] = [];"
);

// 3. live queries
const liveQueries = `
  const { data: mktData } = useQuery({
    queryKey: ['dogeStats'],
    queryFn: async () => {
      const res = await fetch(\`https://api.geckoterminal.com/api/v2/networks/dogechain/tokens/\${CONTRACTS.WWDOGE}\`);
      return res.json();
    },
    refetchInterval: 60000
  });

  const dogePrice = mktData?.data?.attributes?.price_usd ? \`$\${Number(mktData.data.attributes.price_usd).toFixed(4)}\` : '$0.0000';
  const dogeVol = mktData?.data?.attributes?.volume_usd?.h24 ? \`$\${(Number(mktData.data.attributes.volume_usd.h24) / 1000000).toFixed(1)}M\` : '$0.0M';
  const dogeFdv = mktData?.data?.attributes?.fdv_usd ? \`$\${(Number(mktData.data.attributes.fdv_usd) / 1000000).toFixed(1)}M\` : '$0.0M';

  const { data: v2AmountsOut } = useReadContract({
    address: CONTRACTS.DOGESWAP_V2_ROUTER as \`0x\${string}\`,
    abi: parseAbi(['function getAmountsOut(uint amountIn, address[] memory path) public view returns (uint[] memory amounts)']),
    functionName: 'getAmountsOut',
    args: parsedSellWei > 0n && sellToken.address && buyToken.address && sellToken.address !== buyToken.address ? 
      [parsedSellWei, [
        (sellToken.symbol === 'DC' || sellToken.symbol === 'DOGE') ? CONTRACTS.WWDOGE as \`0x\${string}\` : sellToken.address as \`0x\${string}\`,
        (buyToken.symbol === 'DC' || buyToken.symbol === 'DOGE') ? CONTRACTS.WWDOGE as \`0x\${string}\` : buyToken.address as \`0x\${string}\`
      ]] : undefined,
    query: { enabled: parsedSellWei > 0n && sellToken.address !== buyToken.address && isConnected }
  } as any);

  useEffect(() => {
    if (v2AmountsOut && (v2AmountsOut as any[]).length === 2 && parsedSellWei > 0n) {
      const outAmount = formatUnits((v2AmountsOut as bigint[])[1], 18);
      setExchangeRate(Number(outAmount) / parsedSell);
    } else if (sellToken.address === buyToken.address) {
      setExchangeRate(1);
    }
  }, [v2AmountsOut, parsedSellWei, parsedSell, sellToken.address, buyToken.address]);
`;

code = code.replace(
  "  const parsedSell = parseFloat(sellAmount) || 0;",
  "  const parsedSell = parseFloat(sellAmount) || 0;\n" + liveQueries
);

// 4. remove simulation interval
const intervalStr = `  // Real-time price updates simulation
  useEffect(() => {
    const interval = setInterval(() => {
      setExchangeRate(prev => {
        const jitter = (Math.random() - 0.5) * 0.001;
        return Math.max(0.00001, prev + jitter);
      });
    }, 3000);
    return () => clearInterval(interval);
  }, []);`;

code = code.replace(intervalStr, "");

// 5. Replace bottom banners
const bottomBannersOld = `
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
`;

const bottomBannersNew = `
        <div className="mt-8 flex gap-4 overflow-x-auto pb-4 no-scrollbar">
          <div className="bg-surface-container-low min-w-[140px] p-4 border-b-2 border-primary shadow-[0_4px_10px_rgba(255,215,0,0.1)]">
            <p className="text-[10px] font-headline uppercase text-on-surface-variant mb-1">WWDOGE Price</p>
            <p className="font-headline font-bold text-white">{dogePrice}</p>
            <p className="text-[10px] font-headline text-primary">LIVE</p>
          </div>
          <div className="bg-surface-container-low min-w-[140px] p-4 border-b-2 border-secondary">
            <p className="text-[10px] font-headline uppercase text-on-surface-variant mb-1">WWDOGE FDV</p>
            <p className="font-headline font-bold text-white">{dogeFdv}</p>
            <p className="text-[10px] font-headline text-secondary">BEAST MODE</p>
          </div>
          <div className="bg-surface-container-low min-w-[140px] p-4 border-b-2 border-outline-variant/50">
            <p className="text-[10px] font-headline uppercase text-on-surface-variant mb-1">Chain 24H Vol</p>
            <p className="font-headline font-bold text-white">{dogeVol}</p>
            <p className="text-[10px] font-headline text-on-surface-variant">GECKOTERMINAL</p>
          </div>
        </div>
`;

code = code.replace(bottomBannersOld.trim(), bottomBannersNew.trim());

fs.writeFileSync('src/components/SwapScreen.tsx', code);
