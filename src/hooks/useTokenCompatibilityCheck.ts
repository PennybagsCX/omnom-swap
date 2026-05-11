/**
 * useTokenCompatibilityCheck — Pre-flight token compatibility check.
 *
 * Tests whether a token can be transferred to the aggregator contract
 * and/or a DEX router before allowing a swap. This catches tokens with
 * transfer restrictions (blacklists, whitelist-only transfers, etc.)
 * that would cause on-chain reverts.
 *
 * Checks performed (all via staticcall / eth_call):
 *   1. token.decimals() — verify it's a valid ERC20 (returns 0-18)
 *   2. token.balanceOf(user) — verify user has tokens
 *   3. token.allowance(user, aggregator) — check current allowance
 *   4. token.transfer.staticCall(user, aggregator, 1) — aggregator transfer test
 *   5. token.transfer.staticCall(user, router, 1) — router transfer test
 *
 * Results are cached in memory for 5 minutes per token/user/aggregator combo.
 */

import { useState, useCallback, useRef } from 'react';
import { usePublicClient, useAccount } from 'wagmi';
import { erc20Abi, type Address } from 'viem';
import { OMNOMSWAP_AGGREGATOR_ADDRESS } from '../lib/constants';

// ─── Types ──────────────────────────────────────────────────────────────────────

export interface TokenCompatibilityResult {
  /** Can the token be swapped through the aggregator? */
  isCompatible: boolean;
  /** Can the token be swapped directly on a DEX router? */
  isDirectSwapPossible: boolean;
  /** Human-readable reason if incompatible */
  reason?: string;
  /** Token decimals (0-18) */
  decimals?: number;
  /** User's token balance */
  balance?: bigint;
  /** Current allowance to aggregator */
  allowance?: bigint;
  /** transferFrom(user, aggregator, 1) succeeds? */
  transferToAggregatorWorks: boolean;
  /** transferFrom(user, router, 1) succeeds? */
  transferToRouterWorks: boolean;
}

// ─── Cache ──────────────────────────────────────────────────────────────────────

interface CacheEntry {
  result: TokenCompatibilityResult;
  timestamp: number;
}

/** Cache TTL in milliseconds (5 minutes). */
const CACHE_TTL_MS = 5 * 60 * 1000;

/** In-memory cache keyed by `${token}-${user}-${aggregator}-${router}`. */
const compatibilityCache = new Map<string, CacheEntry>();

function getCacheKey(
  tokenAddress: Address,
  userAddress: Address,
  aggregatorAddress: Address,
  routerAddress?: Address,
): string {
  return `${tokenAddress.toLowerCase()}-${userAddress.toLowerCase()}-${aggregatorAddress.toLowerCase()}-${(routerAddress ?? '').toLowerCase()}`;
}

// ─── Minimal ABI for transfer test ─────────────────────────────────────────────

const TRANSFER_ABI = [
  {
    name: 'transfer',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const;

// ─── Hook ───────────────────────────────────────────────────────────────────────

/**
 * Hook to perform a pre-flight token compatibility check.
 *
 * @returns `checkCompatibility` — async function that performs the checks
 * @returns `result` — the latest compatibility result
 * @returns `isChecking` — whether a check is in progress
 */
export function useTokenCompatibilityCheck() {
  const publicClient = usePublicClient();
  const { address: userAddress } = useAccount();
  const [result, setResult] = useState<TokenCompatibilityResult | null>(null);
  const [isChecking, setIsChecking] = useState(false);

  // Track in-flight checks to avoid duplicate concurrent calls
  const inflightRef = useRef<Map<string, Promise<TokenCompatibilityResult>>>(new Map());

  /**
   * Perform the pre-flight compatibility check for a token.
   *
   * @param tokenAddress — The ERC20 token address to check
   * @param aggregatorAddress — The aggregator contract address
   * @param routerAddress — Optional DEX router address to test direct swap compatibility
   * @param overrideUserAddress — Optional override for the user address (for testing)
   */
  const checkCompatibility = useCallback(
    async (
      tokenAddress: Address,
      aggregatorAddress: Address = OMNOMSWAP_AGGREGATOR_ADDRESS,
      routerAddress?: Address,
      overrideUserAddress?: Address,
    ): Promise<TokenCompatibilityResult> => {
      const effectiveUser = (overrideUserAddress ?? userAddress) as Address;
      if (!publicClient || !effectiveUser) {
        return {
          isCompatible: false,
          isDirectSwapPossible: false,
          reason: 'Wallet not connected',
          transferToAggregatorWorks: false,
          transferToRouterWorks: false,
        };
      }

      // Check cache
      const cacheKey = getCacheKey(tokenAddress, effectiveUser, aggregatorAddress, routerAddress);
      const cached = compatibilityCache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
        setResult(cached.result);
        return cached.result;
      }

      // Check in-flight
      const inflight = inflightRef.current.get(cacheKey);
      if (inflight) {
        return inflight;
      }

      const checkPromise = (async (): Promise<TokenCompatibilityResult> => {
        setIsChecking(true);

        const compatibility: TokenCompatibilityResult = {
          isCompatible: false,
          isDirectSwapPossible: false,
          transferToAggregatorWorks: false,
          transferToRouterWorks: false,
        };

        try {
          // ─── Check 1: decimals() — verify it's a valid ERC20 ───────────
          try {
            const decimals = (await publicClient.readContract({
              address: tokenAddress,
              abi: erc20Abi,
              functionName: 'decimals',
            })) as number;

            if (decimals < 0 || decimals > 18) {
              compatibility.reason = `Invalid token: decimals=${decimals} (expected 0-18)`;
              setResult(compatibility);
              return compatibility;
            }
            compatibility.decimals = decimals;
          } catch (err) {
            compatibility.reason = `Not a valid ERC20 token: decimals() failed — ${err instanceof Error ? err.message : String(err)}`;
            setResult(compatibility);
            return compatibility;
          }

          // ─── Check 2: balanceOf(user) — verify user has tokens ─────────
          try {
            const balance = (await publicClient.readContract({
              address: tokenAddress,
              abi: erc20Abi,
              functionName: 'balanceOf',
              args: [effectiveUser],
            })) as bigint;
            compatibility.balance = balance;
          } catch (err) {
            compatibility.reason = `Cannot read token balance — ${err instanceof Error ? err.message : String(err)}`;
            setResult(compatibility);
            return compatibility;
          }

          // ─── Check 3: allowance(user, aggregator) ──────────────────────
          try {
            const allowance = (await publicClient.readContract({
              address: tokenAddress,
              abi: erc20Abi,
              functionName: 'allowance',
              args: [effectiveUser, aggregatorAddress],
            })) as bigint;
            compatibility.allowance = allowance;
          } catch {
            // Non-critical — just skip
          }

          // ─── Check 4: transfer(aggregator, 1) — aggregator transfer test ─
          // We use a staticcall simulation: call transfer from the user's address
          // to the aggregator with 1 wei. This tests if the token's transfer
          // function allows sending to the aggregator.
          //
          // Note: This will fail with "insufficient balance" if user has 0 tokens,
          // but that's OK — we're testing for blacklist/restriction, not balance.
          // We handle the 0-balance case by catching the error and checking if
          // it's a restriction error vs a balance error.
          try {
            // Use eth_call with from=userAddress to simulate transfer from user
            const transferResult = await publicClient.readContract({
              address: tokenAddress,
              abi: TRANSFER_ABI,
              functionName: 'transfer',
              args: [aggregatorAddress, 1n],
              account: effectiveUser,
            });
            compatibility.transferToAggregatorWorks = transferResult === true;
          } catch (err) {
            const errMsg = (err instanceof Error ? err.message : String(err)).toLowerCase();
            // If the error is "insufficient balance" or similar, the token probably
            // allows transfers but the user doesn't have tokens (or has 0 balance).
            // This is NOT a restriction — it's a normal ERC20 error.
            const isBalanceError =
              errMsg.includes('insufficient balance') ||
              errMsg.includes('erc20insufficientbalance') ||
              errMsg.includes('underflow');

            if (isBalanceError && (compatibility.balance ?? 0n) < 1n) {
              // User has 0 balance — can't test transfer, but balance error is expected
              // Assume transfer works (no blacklist) since the only error is balance
              compatibility.transferToAggregatorWorks = true;
            } else if (isBalanceError) {
              // User has balance but still got balance error — unusual, might be fee-on-transfer
              // Still consider it as "works" since the error is balance-related, not restriction
              compatibility.transferToAggregatorWorks = true;
            }
            // If it's NOT a balance error, the transfer is blocked (blacklist/restriction)
            // transferToAggregatorWorks stays false
          }

          // ─── Check 5: transfer(router, 1) — router transfer test ───────
          if (routerAddress) {
            try {
              const transferResult = await publicClient.readContract({
                address: tokenAddress,
                abi: TRANSFER_ABI,
                functionName: 'transfer',
                args: [routerAddress, 1n],
                account: effectiveUser,
              });
              compatibility.transferToRouterWorks = transferResult === true;
            } catch (err) {
              const errMsg = (err instanceof Error ? err.message : String(err)).toLowerCase();
              const isBalanceError =
                errMsg.includes('insufficient balance') ||
                errMsg.includes('erc20insufficientbalance') ||
                errMsg.includes('underflow');

              if (isBalanceError && (compatibility.balance ?? 0n) < 1n) {
                compatibility.transferToRouterWorks = true;
              } else if (isBalanceError) {
                compatibility.transferToRouterWorks = true;
              }
            }
          }

          // ─── Determine compatibility ────────────────────────────────────
          compatibility.isCompatible = compatibility.transferToAggregatorWorks;
          compatibility.isDirectSwapPossible = compatibility.transferToRouterWorks;

          if (!compatibility.isCompatible && !compatibility.isDirectSwapPossible) {
            compatibility.reason =
              'This token has transfer restrictions that prevent DEX swaps. ' +
              'It cannot be traded through any aggregator or DEX router.';
          } else if (!compatibility.isCompatible && compatibility.isDirectSwapPossible) {
            compatibility.reason =
              'This token has transfer restrictions for aggregator contracts. ' +
              'Direct swap mode will be used (no aggregator fee).';
          }

          // Cache the result
          compatibilityCache.set(cacheKey, {
            result: compatibility,
            timestamp: Date.now(),
          });

          setResult(compatibility);
          return compatibility;
        } catch (err) {
          const result: TokenCompatibilityResult = {
            isCompatible: false,
            isDirectSwapPossible: false,
            reason: `Compatibility check failed: ${err instanceof Error ? err.message : String(err)}`,
            transferToAggregatorWorks: false,
            transferToRouterWorks: false,
          };
          setResult(result);
          return result;
        } finally {
          setIsChecking(false);
          inflightRef.current.delete(cacheKey);
        }
      })();

      inflightRef.current.set(cacheKey, checkPromise);
      return checkPromise;
    },
    [publicClient, userAddress],
  );

  /**
   * Clear the cache for a specific token or all tokens.
   */
  const clearCache = useCallback((tokenAddress?: Address) => {
    if (tokenAddress) {
      const prefix = tokenAddress.toLowerCase();
      for (const key of compatibilityCache.keys()) {
        if (key.startsWith(prefix)) {
          compatibilityCache.delete(key);
        }
      }
    } else {
      compatibilityCache.clear();
    }
  }, []);

  return {
    checkCompatibility,
    result,
    isChecking,
    clearCache,
  };
}
