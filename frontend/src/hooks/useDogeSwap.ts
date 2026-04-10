import { useReadContract, useWriteContract, useAccount } from 'wagmi'
import { UniswapV2RouterABI, ERC20ABI } from '../abis'
import { parseUnits } from 'viem'

const ROUTER_ADDRESS = import.meta.env.VITE_DOGESWAP_ROUTER_ADDRESS as `0x${string}`;

export function useTokenBalance(tokenAddress: `0x${string}`) {
  const { address } = useAccount();

  const { data: balance, refetch } = useReadContract({
    address: tokenAddress,
    abi: ERC20ABI,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: {
      enabled: !!address && !!tokenAddress && tokenAddress !== '0x0000000000000000000000000000000000000000',
      refetchInterval: 10000,
    }
  });

  return { balance, refetch };
}

export function useGetAmountsOut(amountIn: string, tokenIn: `0x${string}`, tokenOut: `0x${string}`, decimalsIn: number = 18) {
  const parsedAmountIn = (() => {
    try {
      return amountIn && Number(amountIn) > 0 ? parseUnits(amountIn, decimalsIn) : 0n;
    } catch {
      return 0n;
    }
  })();

  const isValidPath = tokenIn && tokenOut && tokenIn !== tokenOut;

  return useReadContract({
    address: ROUTER_ADDRESS,
    abi: UniswapV2RouterABI,
    functionName: 'getAmountsOut',
    args: isValidPath ? [parsedAmountIn, [tokenIn, tokenOut]] : undefined,
    query: {
      enabled: Boolean(parsedAmountIn > 0n && isValidPath && ROUTER_ADDRESS && ROUTER_ADDRESS !== '0x0000000000000000000000000000000000000000'),
    }
  });
}

export function useDogeSwap() {
  const { address } = useAccount();
  const { writeContractAsync } = useWriteContract();

  const approve = async (tokenAddress: `0x${string}`, amount: string, decimals: number = 18) => {
    return writeContractAsync({
      address: tokenAddress,
      abi: ERC20ABI,
      functionName: 'approve',
      args: [ROUTER_ADDRESS, parseUnits(amount, decimals)]
    });
  }

  const swap = async (tokenIn: `0x${string}`, tokenOut: `0x${string}`, amountIn: string, amountOutMin: string, decimalsIn: number = 18, decimalsOut: number = 18) => {
    if (!address) throw new Error("Wallet not connected");
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 60 * 20); // 20 mins
    
    return writeContractAsync({
      address: ROUTER_ADDRESS,
      abi: UniswapV2RouterABI,
      functionName: 'swapExactTokensForTokens',
      args: [
        parseUnits(amountIn, decimalsIn),
        parseUnits(amountOutMin, decimalsOut),
        [tokenIn, tokenOut],
        address,
        deadline
      ]
    });
  };

  const addLiquidity = async (tokenA: `0x${string}`, tokenB: `0x${string}`, amountADesired: string, amountBDesired: string, amountAMin: string, amountBMin: string, decimalsA: number = 18, decimalsB: number = 18) => {
    if (!address) throw new Error("Wallet not connected");
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 60 * 20);
    
    return writeContractAsync({
      address: ROUTER_ADDRESS,
      abi: UniswapV2RouterABI,
      functionName: 'addLiquidity',
      args: [
        tokenA,
        tokenB,
        parseUnits(amountADesired, decimalsA),
        parseUnits(amountBDesired, decimalsB),
        parseUnits(amountAMin, decimalsA),
        parseUnits(amountBMin, decimalsB),
        address,
        deadline
      ]
    });
  };

  return { approve, swap, addLiquidity };
}
