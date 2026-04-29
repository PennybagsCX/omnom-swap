/**
 * usePrioritizedTokenLoader — scans wallet for token balances using Multicall3.
 *
 * Uses Multicall3 aggregate3 to batch 100 balanceOf calls into a single RPC request.
 * Results are cached for 5 minutes so reopening the modal doesn't rescan.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useAccount, usePublicClient } from 'wagmi';
import { erc20Abi, formatUnits } from 'viem';
import { isNativeToken, type TokenType } from '../lib/constants';
import { formatCompactAmount } from '../lib/format';
import { getGlobalCache, setGlobalCache, clearGlobalCache, createCacheEntry } from '../lib/tokenCache';

export interface TokenWithBalance {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  balance?: bigint;
  formattedBalance?: string;
  metadata?: {
    logoUrl?: string;
    isNative?: boolean;
  };
}

interface UsePrioritizedTokenLoaderProps {
  tokens: TokenType[];
}

const MULTICALL3_ADDRESS = '0xcA11bde05977b3631167028862bE2a173976CA11' as const;
const MULTICALL3_ABI = [
  {
    inputs: [
      {
        components: [
          { name: 'target', type: 'address' },
          { name: 'allowFailure', type: 'bool' },
          { name: 'callData', type: 'bytes' },
        ],
        name: 'calls',
        type: 'tuple[]',
      },
    ],
    name: 'aggregate3',
    outputs: [
      {
        components: [
          { name: 'success', type: 'bool' },
          { name: 'returnData', type: 'bytes' },
        ],
        name: 'returnData',
        type: 'tuple[]',
      },
    ],
    stateMutability: 'payable',
    type: 'function',
  },
] as const;

const BATCH_SIZE = 100;

export function usePrioritizedTokenLoader({ tokens }: UsePrioritizedTokenLoaderProps) {
  const { address, isConnected } = useAccount();
  const publicClient = usePublicClient();

  const publicClientRef = useRef(publicClient);
  publicClientRef.current = publicClient;

  const [balanceMap, setBalanceMap] = useState<Map<string, TokenWithBalance>>(new Map());
  const [isScanning, setIsScanning] = useState(false);
  const [isBackgroundRefresh, setIsBackgroundRefresh] = useState(false);
  const [progress, setProgress] = useState<{ current: number; total: number } | undefined>();
  const [scanComplete, setScanComplete] = useState(false);

  const isMountedRef = useRef(true);
  const fetchIdRef = useRef(0);
  const hadConnectionRef = useRef(false);

  useEffect(() => {
    if (!isConnected || !address || tokens.length === 0) {
      // Only clear cache when wallet explicitly disconnects (not during wagmi hydration)
      if ((!isConnected || !address) && hadConnectionRef.current) {
        clearGlobalCache();
        setBalanceMap(new Map());
        setProgress(undefined);
        setScanComplete(false);
        setIsScanning(false);
        setIsBackgroundRefresh(false);
        hadConnectionRef.current = false;
      }
      return;
    }

    hadConnectionRef.current = true;

    // Load cached data immediately for this wallet (if available)
    const cached = getGlobalCache();
    const hasCachedData = cached && cached.walletAddress.toLowerCase() === address.toLowerCase();

    if (hasCachedData && cached.balanceMap.size > 0) {
      // Show cached data instantly
      setBalanceMap(new Map(cached.balanceMap));
      setScanComplete(true);
      setIsBackgroundRefresh(true); // This is a background refresh
    } else {
      // No cache — starting fresh scan
      setIsBackgroundRefresh(false);
    }

    const fetchId = ++fetchIdRef.current;

    setIsScanning(true);
    setScanComplete(false);
    setProgress({ current: 0, total: Math.ceil(tokens.length / BATCH_SIZE) });

    (async () => {
      // Wait for publicClient to become available (wagmi may initialize asynchronously)
      let client = publicClientRef.current;
      if (!client) {
        for (let wait = 0; wait < 20; wait++) {
          await new Promise(r => setTimeout(r, 100));
          if (fetchId !== fetchIdRef.current || !isMountedRef.current) return;
          client = publicClientRef.current;
          if (client) break;
        }
        if (!client) {
          setIsScanning(false);
          setProgress(undefined);
          return;
        }
      }

      const cached = getGlobalCache();
      const results: Map<string, TokenWithBalance> = new Map(cached?.balanceMap || new Map());
      let batchIndex = 0;
      const totalBatches = Math.ceil(tokens.length / BATCH_SIZE);

      for (let i = 0; i < tokens.length; i += BATCH_SIZE) {
        if (fetchId !== fetchIdRef.current || !isMountedRef.current) return;

        const batch = tokens.slice(i, i + BATCH_SIZE);

        const calls = batch.map((token) => {
          if (isNativeToken(token)) {
            return {
              target: MULTICALL3_ADDRESS,
              allowFailure: true,
              callData: '0x' as `0x${string}`,
            };
          }
          const tokenAddress = token.address as `0x${string}`;
          const encodedBalanceOf = encodeBalanceOf(tokenAddress, address);
          return {
            target: tokenAddress,
            allowFailure: true,
            callData: encodedBalanceOf,
          };
        });

        try {
          const multicallResults = await client.readContract({
            address: MULTICALL3_ADDRESS,
            abi: MULTICALL3_ABI,
            functionName: 'aggregate3',
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            args: [calls as any],
          });

          if (fetchId !== fetchIdRef.current || !isMountedRef.current) return;

          for (let j = 0; j < batch.length; j++) {
            const token = batch[j];
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const result = (multicallResults as any)[j];

            if (isNativeToken(token)) {
              try {
                const nativeBalance = await client.getBalance({ address });
                if (nativeBalance > 0n) {
                  const formatted = formatUnits(nativeBalance, token.decimals ?? 18);
                  const num = parseFloat(formatted);
                  results.set(token.address.toLowerCase(), {
                    address: token.address,
                    symbol: token.symbol,
                    name: token.name,
                    decimals: token.decimals ?? 18,
                    balance: nativeBalance,
                    formattedBalance: num > 0 ? formatCompactAmount(num) : '0',
                    metadata: { logoUrl: token.icon, isNative: true },
                  });
                }
              } catch {
                // Native balance failed
              }
              continue;
            }

            if (result?.success && result?.returnData && result.returnData.length >= 32) {
              const balance = BigInt(result.returnData);
              const decimals = token.decimals ?? 18;
              const formatted = formatUnits(balance, decimals);
              const num = parseFloat(formatted);

              results.set(token.address.toLowerCase(), {
                address: token.address,
                symbol: token.symbol,
                name: token.name,
                decimals,
                balance,
                formattedBalance: num > 0 ? formatCompactAmount(num) : '0',
                metadata: { logoUrl: token.icon, isNative: token.isNative },
              });
            }
          }
        } catch {
          for (const token of batch) {
            if (fetchId !== fetchIdRef.current || !isMountedRef.current) return;
            try {
              let balance: bigint;
              if (isNativeToken(token)) {
                balance = await client.getBalance({ address });
              } else {
                balance = (await client.readContract({
                  address: token.address as `0x${string}`,
                  abi: erc20Abi,
                  functionName: 'balanceOf',
                  args: [address],
                })) as bigint;
              }
              const decimals = token.decimals ?? 18;
              const formatted = formatUnits(balance, decimals);
              const num = parseFloat(formatted);
              results.set(token.address.toLowerCase(), {
                address: token.address,
                symbol: token.symbol,
                name: token.name,
                decimals,
                balance,
                formattedBalance: num > 0 ? formatCompactAmount(num) : '0',
                metadata: { logoUrl: token.icon, isNative: token.isNative },
              });
            } catch {
              // Token call failed — skip
            }
          }
        }

        batchIndex++;

        if (fetchId !== fetchIdRef.current || !isMountedRef.current) return;

        const heldMap = new Map<string, TokenWithBalance>();
        for (const [addr, twb] of results) {
          if (twb.balance && twb.balance > 0n) {
            heldMap.set(addr, twb);
          }
        }

        setBalanceMap(new Map(heldMap));
        setProgress({ current: batchIndex, total: totalBatches });
      }

      if (fetchId !== fetchIdRef.current || !isMountedRef.current) return;

      // Cache the results globally for next modal open (survives unmount)
      setGlobalCache(createCacheEntry(results, address));

      setIsScanning(false);
      setScanComplete(true);
      setProgress(undefined);
    })();
  }, [isConnected, address, tokens]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => { isMountedRef.current = false; };
  }, []);

  const refresh = useCallback(() => {
    clearGlobalCache();
    setBalanceMap(new Map());
    setScanComplete(false);
  }, []);

  return {
    balanceMap,
    isScanning,
    isBackgroundRefresh,
    scanComplete,
    progress,
    refresh,
  };
}

export type WalletScanResult = ReturnType<typeof usePrioritizedTokenLoader>;

function encodeBalanceOf(_tokenAddress: `0x${string}`, walletAddress: `0x${string}`): `0x${string}` {
  return `0x70a08231${walletAddress.slice(2).padStart(64, '0')}` as `0x${string}`;
}
