/**
 * TreasuryDashboard — shows treasury wallet, protocol fee, and token balances.
 *
 * Scans a curated list of known tokens via Multicall3, shows only non-zero balances.
 * Uses a small list to avoid overwhelming the public RPC (16,840 tokens would time out).
 */

import { Wallet, Percent, Building2, ExternalLink, Shield, Coins, RefreshCw } from 'lucide-react';
import { erc20Abi, formatUnits } from 'viem';
import { NETWORK_INFO, CONTRACTS } from '../../lib/constants';
import { formatCompactAmount } from '../../lib/format';
import { useAggregatorContract } from '../../hooks/useAggregator/useAggregatorContract';
import { usePublicClient } from 'wagmi';
import { useState, useEffect } from 'react';

const TREASURY_ADDRESS = '0x628f3F4A82791D1d6dEC2Aebe7d648e53fF4FA88' as const;

const TREASURY_TOKENS = [
  { address: CONTRACTS.WWDOGE as string, symbol: 'WWDOGE', decimals: 18 },
  { address: CONTRACTS.OMNOM_TOKEN as string, symbol: 'OMNOM', decimals: 18 },
  { address: '0x7b4328c127b85369d9f82ca0503b000d09cf9180', symbol: 'DC', decimals: 18 },
];

interface TokenWithBalance {
  symbol: string;
  address: string;
  decimals: number;
  balance: string;
  balanceRaw: bigint;
}

export function TreasuryDashboard() {
  const { owner, treasury, feeBps, isLoading } = useAggregatorContract();
  const publicClient = usePublicClient();
  const [refreshKey, setRefreshKey] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [tokenBalances, setTokenBalances] = useState<TokenWithBalance[]>([]);

  // Auto-refresh every 60 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      setRefreshKey(prev => prev + 1);
    }, 60000);
    return () => clearInterval(interval);
  }, []);

  // Fetch all token balances via Multicall3
  useEffect(() => {
    const fetchBalances = async () => {
      if (!publicClient) return;

      try {
        // Build multicall batch for curated treasury tokens only
        const calls = TREASURY_TOKENS.map(token => ({
          address: token.address as `0x${string}`,
          abi: erc20Abi,
          functionName: 'balanceOf' as const,
          args: [TREASURY_ADDRESS],
        }));

        const results = await publicClient.multicall({
          contracts: calls,
          allowFailure: true,
        });

        const tokensWithBalance: TokenWithBalance[] = [];

        // Process ERC-20 results
        results.forEach((result, index) => {
          if (result.status === 'success' && result.result && result.result > 0n) {
            const token = TREASURY_TOKENS[index];
            tokensWithBalance.push({
              symbol: token.symbol,
              address: token.address,
              decimals: token.decimals,
              balance: formatUnits(result.result, token.decimals),
              balanceRaw: result.result,
            });
          }
        });

        // Fetch native DOGE balance separately
        const nativeBalance = await publicClient.getBalance({
          address: TREASURY_ADDRESS,
        });

        if (nativeBalance > 0n) {
          tokensWithBalance.push({
            symbol: 'DOGE',
            address: '0x0',
            decimals: 18,
            balance: formatUnits(nativeBalance, 18),
            balanceRaw: nativeBalance,
          });
        }

        setTokenBalances(tokensWithBalance);
      } catch (error) {
        console.error('Failed to fetch treasury balances:', error);
      }
    };

    fetchBalances();
  }, [publicClient, refreshKey]);

  const handleRefresh = () => {
    setIsRefreshing(true);
    setRefreshKey(prev => prev + 1);
    setTimeout(() => setIsRefreshing(false), 1000);
  };

  const explorerUrl = (address: string) => `${NETWORK_INFO.blockExplorer}/address/${address}`;

  const sameAddress = owner && treasury && owner.toLowerCase() === treasury.toLowerCase();
  const displayAddress = treasury || owner;

  return (
    <div className="bg-surface-container-low border border-outline-variant/15 p-4 md:p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Building2 className="w-5 h-5 text-primary" />
          <h3 className="font-headline font-bold text-lg uppercase tracking-tighter text-white">
            Treasury & Protocol
          </h3>
        </div>
        <button
          onClick={handleRefresh}
          disabled={isRefreshing}
          className="text-primary hover:text-primary-dim disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          title="Refresh balances"
        >
          <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {isLoading ? (
        <div className="text-on-surface-variant font-body text-sm animate-pulse">
          Loading contract state...
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Treasury Wallet — prominent display */}
          <div className="bg-surface-container p-4 border border-primary/20 flex flex-col items-center justify-center text-center sm:col-span-2">
            <div className="flex items-center justify-center gap-2 mb-2">
              <Wallet className="w-4 h-4 text-primary" />
              <span className="font-headline text-xs uppercase tracking-wider text-primary">
                {sameAddress ? 'Treasury & Admin' : 'Treasury Wallet'}
              </span>
            </div>
            <div className="text-white font-body text-sm break-all">
              {displayAddress ? (
                <a
                  href={explorerUrl(displayAddress)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline inline-flex items-center gap-1"
                >
                  {displayAddress.slice(0, 10)}...{displayAddress.slice(-8)}
                  <ExternalLink className="w-3 h-3" />
                </a>
              ) : (
                <span className="text-on-surface-variant">Not deployed</span>
              )}
            </div>
            {sameAddress && displayAddress && (
              <div className="text-on-surface-variant text-[10px] font-body mt-1 uppercase tracking-wider">
                Fee collection & contract administration
              </div>
            )}

            {/* Dynamic token balance tiles */}
            {tokenBalances.length > 0 && (
              <div className="grid grid-cols-3 gap-3 mt-3 pt-3 border-t border-outline-variant/10 w-full">
                {tokenBalances.map(token => (
                  <div key={token.address} className="flex flex-col items-center gap-1">
                    <div className="flex items-center gap-1">
                      <Coins className="w-3 h-3 text-primary" />
                      <span className="font-headline text-[10px] uppercase tracking-wider text-on-surface-variant">
                        {token.symbol}
                      </span>
                    </div>
                    <span className="text-white font-semibold font-body text-xs">
                      {formatCompactAmount(Number(token.balance))}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {tokenBalances.length === 0 && !isLoading && (
              <div className="text-on-surface-variant text-xs font-body mt-2">
                No tokens found
              </div>
            )}
          </div>

          {/* Protocol Fee */}
          <div className="bg-surface-container p-4 border border-outline-variant/10 flex flex-col items-center justify-center text-center">
            <div className="flex items-center justify-center gap-2 mb-2">
              <Percent className="w-4 h-4 text-primary" />
              <span className="font-headline text-xs uppercase tracking-wider text-on-surface-variant">Protocol Fee</span>
            </div>
            <div className="text-white font-body text-2xl font-bold">
              {feeBps !== undefined ? `${Number(feeBps) / 100}%` : '—'}
            </div>
            <div className="text-on-surface-variant text-xs font-body mt-1">
              {feeBps !== undefined ? `${feeBps} basis points` : 'Not deployed'}
            </div>
          </div>

          {/* Contract Owner — secondary info, only shown if different from treasury */}
          {!sameAddress && owner && (
            <div className="bg-surface-container p-3 border border-outline-variant/10 flex flex-col items-center justify-center text-center">
              <div className="flex items-center justify-center gap-2 mb-1">
                <Shield className="w-3 h-3 text-on-surface-variant" />
                <span className="font-headline text-[10px] uppercase tracking-wider text-on-surface-variant">Contract Owner</span>
              </div>
              <div className="font-body text-xs break-all">
                <a
                  href={explorerUrl(owner)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-on-surface-variant hover:text-primary inline-flex items-center gap-1"
                >
                  {owner.slice(0, 10)}...{owner.slice(-8)}
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
