import { useState, useEffect, useCallback } from 'react';
import { useAccount, useReadContract, useWriteContract, usePublicClient } from 'wagmi';
import { createPublicClient, http, erc20Abi, getAddress, parseAbi } from 'viem';
import { dogechain } from 'wagmi/chains';
import { CONTRACTS, PAIR_ABI, MAX_UINT256, NETWORK_INFO, V2_ROUTER_ABI } from '../lib/constants';
import { useToast } from '../components/ToastContext';

// Standalone public client — works without wallet connection
const publicReader = createPublicClient({ chain: dogechain, transport: http() });

// Parsed ABI for direct viem contract reads
const parsedPairAbi = parseAbi(PAIR_ABI);
const parsedRouterAbi = parseAbi(V2_ROUTER_ABI);

// Read pool reserves and token addresses — direct viem client reads (no wallet needed)
export function usePoolReserves(pairAddress: string | undefined) {
  const [data, setData] = useState<{
    reserve0: bigint;
    reserve1: bigint;
    token0: `0x${string}` | undefined;
    token1: `0x${string}` | undefined;
    symbol0: string;
    symbol1: string;
    totalSupply: bigint;
    isLoading: boolean;
  }>({ reserve0: 0n, reserve1: 0n, token0: undefined, token1: undefined, symbol0: '', symbol1: '', totalSupply: 0n, isLoading: false });

  useEffect(() => {
    if (!pairAddress) return;
    let cancelled = false;
    let addr: `0x${string}`;
    try {
      addr = getAddress(pairAddress);
    } catch {
      return;
    }

    const fetchAll = async () => {
      setData(prev => ({ ...prev, isLoading: true }));
      try {
        const [reserves, t0, t1, supply] = await Promise.all([
          publicReader.readContract({ address: addr, abi: parsedPairAbi, functionName: 'getReserves' }),
          publicReader.readContract({ address: addr, abi: parsedPairAbi, functionName: 'token0' }),
          publicReader.readContract({ address: addr, abi: parsedPairAbi, functionName: 'token1' }),
          publicReader.readContract({ address: addr, abi: parsedPairAbi, functionName: 'totalSupply' }),
        ]);

        if (!cancelled) {
          const [r0, r1] = reserves as [bigint, bigint, number];
          const t0Addr = t0 as `0x${string}`;
          const t1Addr = t1 as `0x${string}`;
          const [sym0, sym1] = await Promise.all([
            publicReader.readContract({ address: t0Addr, abi: erc20Abi, functionName: 'symbol' }).catch(() => ''),
            publicReader.readContract({ address: t1Addr, abi: erc20Abi, functionName: 'symbol' }).catch(() => ''),
          ]);
          if (!cancelled) {
            setData({
              reserve0: r0,
              reserve1: r1,
              token0: t0Addr,
              token1: t1Addr,
              symbol0: sym0 as string,
              symbol1: sym1 as string,
              totalSupply: supply as bigint,
              isLoading: false,
            });
          }
        }
      } catch {
        if (!cancelled) setData(prev => ({ ...prev, isLoading: false }));
      }
    };

    fetchAll();
    const interval = setInterval(fetchAll, 30_000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [pairAddress]);

  return data;
}

// Read user's LP token balance for a pool — uses standalone reader (works without wallet)
export function useLpBalance(pairAddress: string | undefined) {
  const { address, isConnected } = useAccount();
  const [lpBalance, setLpBalance] = useState<bigint>(0n);
  const [refetchCounter, setRefetchCounter] = useState(0);

  useEffect(() => {
    if (!pairAddress || !isConnected || !address) return;
    let cancelled = false;
    let addr: `0x${string}`;
    try { addr = getAddress(pairAddress); } catch { return; }

    const fetchBalance = async () => {
      try {
        const bal = await publicReader.readContract({
          address: addr,
          abi: parsedPairAbi,
          functionName: 'balanceOf',
          args: [address],
        });
        if (!cancelled) setLpBalance(bal as bigint);
      } catch { /* ignore */ }
    };

    fetchBalance();
    const interval = setInterval(fetchBalance, 15_000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [pairAddress, address, isConnected, refetchCounter]);

  return {
    lpBalance,
    refetch: () => setRefetchCounter(c => c + 1),
  };
}

// Read ERC-20 token balances — also reads native DOGE balance if token is WWDOGE
export function useErc20Balances(tokenA: string | undefined, tokenB: string | undefined) {
  const { address, isConnected } = useAccount();
  const publicClient = usePublicClient();
  const [balances, setBalances] = useState<{
    balanceA: bigint; balanceB: bigint; nativeBalance: bigint; isLoading: boolean;
  }>({
    balanceA: 0n, balanceB: 0n, nativeBalance: 0n, isLoading: false,
  });

  const isTokenAWWDOGE = tokenA?.toLowerCase() === CONTRACTS.WWDOGE.toLowerCase();
  const isTokenBWWDOGE = tokenB?.toLowerCase() === CONTRACTS.WWDOGE.toLowerCase();

  useEffect(() => {
    if (!tokenA || !tokenB || !isConnected || !address || !publicClient) return;
    let cancelled = false;

    const fetchBalances = async () => {
      setBalances(prev => ({ ...prev, isLoading: true }));
      try {
        const addrA = getAddress(tokenA);
        const addrB = getAddress(tokenB);

        const reads: Promise<unknown>[] = [
          publicClient.readContract({ address: addrA, abi: erc20Abi, functionName: 'balanceOf', args: [address] }),
          publicClient.readContract({ address: addrB, abi: erc20Abi, functionName: 'balanceOf', args: [address] }),
        ];
        // Also read native DOGE balance if either token is WWDOGE
        if (isTokenAWWDOGE || isTokenBWWDOGE) {
          reads.push(publicClient.getBalance({ address }));
        }

        const results = await Promise.all(reads);
        const balA = results[0] as bigint;
        const balB = results[1] as bigint;
        const nativeBal = results[2] as bigint ?? 0n;

        if (!cancelled) {
          setBalances({ balanceA: balA, balanceB: balB, nativeBalance: nativeBal, isLoading: false });
        }
      } catch (err) {
        console.error('[useErc20Balances] Error:', err);
        if (!cancelled) setBalances(prev => ({ ...prev, isLoading: false }));
      }
    };

    fetchBalances();
    const interval = setInterval(fetchBalances, 15_000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [tokenA, tokenB, address, isConnected, publicClient, isTokenAWWDOGE, isTokenBWWDOGE]);

  return balances;
}

// Read LP token allowance to V2 router
export function useLpAllowance(pairAddress: string | undefined) {
  const { address, isConnected } = useAccount();

  const { data, refetch } = useReadContract({
    address: pairAddress as `0x${string}`,
    abi: PAIR_ABI,
    functionName: 'allowance',
    args: address ? [address, CONTRACTS.DOGESWAP_V2_ROUTER as `0x${string}`] : undefined,
    query: { enabled: !!pairAddress && isConnected },
  });

  return {
    allowance: data as bigint ?? 0n,
    refetch,
  };
}

// Read ERC-20 token allowances to the V2 router
export function useTokenAllowances(tokenA: string | undefined, tokenB: string | undefined) {
  const { address, isConnected } = useAccount();
  const router = CONTRACTS.DOGESWAP_V2_ROUTER as `0x${string}`;

  const { data: aA, refetch: rA } = useReadContract({
    address: tokenA ? getAddress(tokenA) : undefined,
    abi: erc20Abi,
    functionName: 'allowance',
    args: address ? [address, router] : undefined,
    query: { enabled: !!tokenA && isConnected },
  });

  const { data: aB, refetch: rB } = useReadContract({
    address: tokenB ? getAddress(tokenB) : undefined,
    abi: erc20Abi,
    functionName: 'allowance',
    args: address ? [address, router] : undefined,
    query: { enabled: !!tokenB && isConnected },
  });

  return {
    allowanceA: (aA as bigint) ?? 0n,
    allowanceB: (aB as bigint) ?? 0n,
    refetch: () => { rA(); rB(); },
  };
}

// Add liquidity via V2 router (atomic — avoids MEV issues of multi-tx direct pair interaction)
export function useAddLiquidity() {
  const { writeContractAsync } = useWriteContract();
  const { addToast } = useToast();
  const publicClient = usePublicClient();

  const addLiquidity = useCallback(async (params: {
    token0: `0x${string}`;
    token1: `0x${string}`;
    amountADesired: bigint;
    amountBDesired: bigint;
    amountAMin: bigint;
    amountBMin: bigint;
    slippageBps: number;
    deadlineMinutes: number;
    recipient: `0x${string}`;
  }) => {
    const routerAddress = CONTRACTS.DOGESWAP_V2_ROUTER as `0x${string}`;
    const txDeadline = Math.floor(Date.now() / 1000) + params.deadlineMinutes * 60;

    const t0IsWWDOGE = params.token0.toLowerCase() === CONTRACTS.WWDOGE.toLowerCase();
    const t1IsWWDOGE = params.token1.toLowerCase() === CONTRACTS.WWDOGE.toLowerCase();
    const hasWWDOGE = t0IsWWDOGE || t1IsWWDOGE;

    try {
      // Determine which tokens need router approval (WWDOGE sent via msg.value doesn't need approval)
      const tokensToApprove: { address: `0x${string}`; amount: bigint }[] = [];
      if (hasWWDOGE) {
        const token = t0IsWWDOGE ? params.token1 : params.token0;
        const amount = t0IsWWDOGE ? params.amountBDesired : params.amountADesired;
        tokensToApprove.push({ address: token, amount });
      } else {
        tokensToApprove.push({ address: params.token0, amount: params.amountADesired });
        tokensToApprove.push({ address: params.token1, amount: params.amountBDesired });
      }

      // Approve tokens if needed
      for (const token of tokensToApprove) {
        if (!publicClient) continue;
        const allowance = await publicClient.readContract({
          address: token.address,
          abi: erc20Abi,
          functionName: 'allowance',
          args: [params.recipient, routerAddress],
        }) as bigint;
        if (allowance < token.amount) {
          addToast({ type: 'warning', title: 'Approving', message: 'Approving token spend...' });
          const approveHash = await writeContractAsync({
            address: token.address,
            abi: erc20Abi,
            functionName: 'approve',
            args: [routerAddress, MAX_UINT256],
          });
          const r = await publicClient.waitForTransactionReceipt({ hash: approveHash });
          if (r.status !== 'success') {
            addToast({ type: 'error', title: 'Approval Failed', message: 'Token approval reverted' });
            throw new Error('Approval failed');
          }
        }
      }

      // Execute LP via router
      addToast({ type: 'warning', title: 'Adding Liquidity', message: 'Submitting transaction...' });

      let txHash: `0x${string}`;
      if (hasWWDOGE) {
        const token = t0IsWWDOGE ? params.token1 : params.token0;
        const amountTokenDesired = t0IsWWDOGE ? params.amountBDesired : params.amountADesired;
        const amountTokenMin = t0IsWWDOGE ? params.amountBMin : params.amountAMin;
        const amountWDOGEMin = t0IsWWDOGE ? params.amountAMin : params.amountBMin;
        const value = t0IsWWDOGE ? params.amountADesired : params.amountBDesired;
        txHash = await writeContractAsync({
          address: routerAddress,
          abi: parsedRouterAbi,
          functionName: 'addLiquidityWDOGE',
          args: [token, amountTokenDesired, amountTokenMin, amountWDOGEMin, params.recipient, BigInt(txDeadline)],
          value,
        });
      } else {
        txHash = await writeContractAsync({
          address: routerAddress,
          abi: parsedRouterAbi,
          functionName: 'addLiquidity',
          args: [params.token0, params.token1, params.amountADesired, params.amountBDesired, params.amountAMin, params.amountBMin, params.recipient, BigInt(txDeadline)],
        });
      }

      console.log('[addLiquidity] TX:', txHash);

      if (publicClient) {
        const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
        if (receipt.status === 'success') {
          addToast({
            type: 'success',
            title: 'Liquidity Added',
            message: 'Your liquidity has been added to the pool',
            link: `${NETWORK_INFO.blockExplorer}/tx/${txHash}`,
          });
        } else {
          addToast({ type: 'error', title: 'Add LP Failed', message: 'Transaction reverted on-chain', link: `${NETWORK_INFO.blockExplorer}/tx/${txHash}` });
        }
      }

      return txHash;
    } catch (error) {
      console.error('[addLiquidity] Error:', error);
      const msg = error instanceof Error ? error.message : 'Add liquidity failed';
      const isRejected = msg.includes('UserRejected') || msg.includes('denied') || msg.includes('rejected');
      addToast({
        type: 'error',
        title: isRejected ? 'Cancelled' : 'Add Liquidity Failed',
        message: isRejected ? 'Transaction was rejected' : msg.substring(0, 200),
      });
      throw error;
    }
  }, [writeContractAsync, addToast, publicClient]);

  return { addLiquidity };
}

// Remove liquidity via V2 router (atomic — avoids MEV issues of multi-tx direct pair interaction)
export function useRemoveLiquidity() {
  const { writeContractAsync } = useWriteContract();
  const { addToast } = useToast();
  const publicClient = usePublicClient();

  const removeLiquidity = useCallback(async (params: {
    lpTokenAddress: `0x${string}`; // Pair contract = LP token
    tokenA: `0x${string}`;
    tokenB: `0x${string}`;
    liquidity: bigint;
    amountAMin: bigint;
    amountBMin: bigint;
    deadlineMinutes: number;
    recipient: `0x${string}`;
  }) => {
    const routerAddress = CONTRACTS.DOGESWAP_V2_ROUTER as `0x${string}`;
    const txDeadline = Math.floor(Date.now() / 1000) + params.deadlineMinutes * 60;

    const aIsWWDOGE = params.tokenA.toLowerCase() === CONTRACTS.WWDOGE.toLowerCase();
    const bIsWWDOGE = params.tokenB.toLowerCase() === CONTRACTS.WWDOGE.toLowerCase();
    const hasWWDOGE = aIsWWDOGE || bIsWWDOGE;

    try {
      // Approve LP tokens for router
      if (publicClient) {
        const allowance = await publicClient.readContract({
          address: params.lpTokenAddress,
          abi: erc20Abi,
          functionName: 'allowance',
          args: [params.recipient, routerAddress],
        }) as bigint;
        if (allowance < params.liquidity) {
          addToast({ type: 'warning', title: 'Approving', message: 'Approving LP tokens...' });
          const approveHash = await writeContractAsync({
            address: params.lpTokenAddress,
            abi: erc20Abi,
            functionName: 'approve',
            args: [routerAddress, MAX_UINT256],
          });
          const r = await publicClient.waitForTransactionReceipt({ hash: approveHash });
          if (r.status !== 'success') {
            addToast({ type: 'error', title: 'Approval Failed', message: 'LP approval reverted' });
            throw new Error('Approval failed');
          }
        }
      }

      // Execute removal via router
      addToast({ type: 'warning', title: 'Removing Liquidity', message: 'Submitting transaction...' });

      let txHash: `0x${string}`;
      if (hasWWDOGE) {
        const token = aIsWWDOGE ? params.tokenB : params.tokenA;
        const amountTokenMin = aIsWWDOGE ? params.amountBMin : params.amountAMin;
        const amountWDOGEMin = aIsWWDOGE ? params.amountAMin : params.amountBMin;
        txHash = await writeContractAsync({
          address: routerAddress,
          abi: parsedRouterAbi,
          functionName: 'removeLiquidityWDOGE',
          args: [token, params.liquidity, amountTokenMin, amountWDOGEMin, params.recipient, BigInt(txDeadline)],
        });
      } else {
        txHash = await writeContractAsync({
          address: routerAddress,
          abi: parsedRouterAbi,
          functionName: 'removeLiquidity',
          args: [params.tokenA, params.tokenB, params.liquidity, params.amountAMin, params.amountBMin, params.recipient, BigInt(txDeadline)],
        });
      }

      console.log('[removeLiquidity] TX:', txHash);

      if (publicClient) {
        const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
        if (receipt.status === 'success') {
          addToast({
            type: 'success',
            title: 'Liquidity Removed',
            message: 'Your liquidity has been withdrawn from the pool',
            link: `${NETWORK_INFO.blockExplorer}/tx/${txHash}`,
          });
        } else {
          addToast({ type: 'error', title: 'Remove LP Failed', message: 'Transaction reverted on-chain', link: `${NETWORK_INFO.blockExplorer}/tx/${txHash}` });
        }
      }

      return txHash;
    } catch (error) {
      console.error('[removeLiquidity] Error:', error);
      const msg = error instanceof Error ? error.message : 'Remove liquidity failed';
      const isRejected = msg.includes('UserRejected') || msg.includes('denied') || msg.includes('rejected');
      addToast({
        type: 'error',
        title: isRejected ? 'Cancelled' : 'Remove Liquidity Failed',
        message: isRejected ? 'Transaction was rejected' : msg.substring(0, 200),
      });
      throw error;
    }
  }, [writeContractAsync, addToast, publicClient]);

  return { removeLiquidity };
}

// Approve ERC-20 token for the V2 router
export function useApproveToken() {
  const { writeContractAsync } = useWriteContract();
  const { addToast } = useToast();

  const approve = useCallback(async (tokenAddress: `0x${string}`, spender?: `0x${string}`) => {
    const target = spender ?? CONTRACTS.DOGESWAP_V2_ROUTER as `0x${string}`;
    try {
      const hash = await writeContractAsync({
        address: tokenAddress,
        abi: erc20Abi,
        functionName: 'approve',
        args: [target, MAX_UINT256],
      });
      addToast({ type: 'success', title: 'Approved', message: 'Token approved for router' });
      return hash;
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Approval failed';
      const isRejected = msg.includes('UserRejected') || msg.includes('denied') || msg.includes('rejected');
      addToast({
        type: 'error',
        title: isRejected ? 'Cancelled' : 'Approval Failed',
        message: isRejected ? 'Transaction was rejected' : msg.substring(0, 80),
      });
      throw error;
    }
  }, [writeContractAsync, addToast]);

  return { approve };
}

// Approve LP token for the V2 router (needed before removeLiquidity)
export function useApproveLp() {
  const { writeContractAsync } = useWriteContract();
  const { addToast } = useToast();

  const approveLp = useCallback(async (pairAddress: `0x${string}`, amount?: bigint) => {
    try {
      const hash = await writeContractAsync({
        address: pairAddress,
        abi: PAIR_ABI,
        functionName: 'approve',
        args: [CONTRACTS.DOGESWAP_V2_ROUTER as `0x${string}`, amount ?? MAX_UINT256],
      });
      addToast({ type: 'success', title: 'Approved', message: 'LP token approved for withdrawal' });
      return hash;
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Approval failed';
      const isRejected = msg.includes('UserRejected') || msg.includes('denied') || msg.includes('rejected');
      addToast({
        type: 'error',
        title: isRejected ? 'Cancelled' : 'Approval Failed',
        message: isRejected ? 'Transaction was rejected' : msg.substring(0, 80),
      });
      throw error;
    }
  }, [writeContractAsync, addToast]);

  return { approveLp };
}

// Helper: compute amounts to withdraw given LP share percentage
export function computeWithdrawAmounts(
  liquidity: bigint,
  totalSupply: bigint,
  reserve0: bigint,
  reserve1: bigint,
  sharePercent: number, // 0-100
): { amount0: bigint; amount1: bigint; liquidityToWithdraw: bigint } {
  if (totalSupply === 0n) return { amount0: 0n, amount1: 0n, liquidityToWithdraw: 0n };
  const liquidityToWithdraw = (liquidity * BigInt(Math.floor(sharePercent * 100))) / 10000n;
  const amount0 = (reserve0 * liquidityToWithdraw) / totalSupply;
  const amount1 = (reserve1 * liquidityToWithdraw) / totalSupply;
  return { amount0, amount1, liquidityToWithdraw };
}
