/**
 * useTokenBalances — fetch ERC20 balances for the connected wallet.
 *
 * Supports:
 *   - Token-specific decimals (H-01)
 *   - Manual refresh trigger (C-04)
 */

import { useState, useEffect, useCallback } from 'react';
import { useAccount, usePublicClient } from 'wagmi';
import { erc20Abi, formatUnits, type Address } from 'viem';
import { TOKENS, CONTRACTS, isNativeToken } from '../../lib/constants';
import { formatCompactAmount } from '../../lib/format';

export interface TokenBalance {
  symbol: string;
  address: string;
  balance: bigint;
  formatted: string;
  decimals: number;
}

export function useTokenBalances() {
  const { address, isConnected } = useAccount();
  const publicClient = usePublicClient();
  const [balances, setBalances] = useState<TokenBalance[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // C-04: refresh nonce — incrementing triggers a re-fetch
  const [refreshNonce, setRefreshNonce] = useState(0);

  useEffect(() => {
    if (!isConnected || !address || !publicClient) {
      setBalances([]);
      return;
    }

    let cancelled = false;

    const fetchBalances = async () => {
      setIsLoading(true);
      try {
        const results: TokenBalance[] = [];

        for (const token of TOKENS) {
          if (cancelled) return;

          const tokenAddress = token.address as Address;
          // H-01: use token-specific decimals from TOKENS array
          const decimals = token.decimals ?? 18;

          if (isNativeToken(token)) {
            const bal = await publicClient.getBalance({ address });
            results.push({
              symbol: token.symbol,
              address: tokenAddress,
              balance: bal,
              formatted: formatUnits(bal, decimals),
              decimals,
            });
          } else {
            try {
              const bal = (await publicClient.readContract({
                address: tokenAddress,
                abi: erc20Abi,
                functionName: 'balanceOf',
                args: [address],
              })) as bigint;

              results.push({
                symbol: token.symbol,
                address: tokenAddress,
                balance: bal,
                formatted: formatUnits(bal, decimals),
                decimals,
              });
            } catch {
              results.push({
                symbol: token.symbol,
                address: tokenAddress,
                balance: 0n,
                formatted: '0',
                decimals,
              });
            }
          }
        }

        if (!cancelled) setBalances(results);
      } catch {
        // Silently fail
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    fetchBalances();
    return () => { cancelled = true; };
  }, [isConnected, address, publicClient, refreshNonce]);

  // C-04: expose a refresh function
  const refresh = useCallback(() => setRefreshNonce((n) => n + 1), []);

  const getBalance = (tokenAddress: string): TokenBalance | undefined => {
    return balances.find(
      (b) => b.address.toLowerCase() === tokenAddress.toLowerCase()
    );
  };

  const getFormattedBalance = (tokenAddress: string): string => {
    const bal = getBalance(tokenAddress);
    if (!bal) return '0';
    if (bal.balance === 0n) return '0';
    const num = parseFloat(bal.formatted);
    if (isNaN(num) || num <= 0) return '0';
    return formatCompactAmount(num);
  };

  return { balances, isLoading, getBalance, getFormattedBalance, refresh };
}

// Helper to get token info by address
export function getTokenByAddress(address: string) {
  return TOKENS.find(
    (t) => t.address.toLowerCase() === address.toLowerCase()
  );
}

// Re-export CONTRACTS for convenience
export { CONTRACTS };
