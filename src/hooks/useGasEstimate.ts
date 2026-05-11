/**
 * useGasEstimate — hook for estimating gas costs in liquidity operations.
 *
 * Provides dynamic gas estimation for add/remove liquidity transactions,
 * matching the gas estimation pattern used in the swap feature.
 *
 * Features:
 * - Real-time gas estimation via estimateContractGas()
 * - 30% buffer for network congestion
 * - 2M gas cap to prevent excessive estimates
 * - Gas cost calculation in native token units
 * - Graceful fallback on estimation failure
 * - DEBOUNCING: 600ms delay to prevent request storms
 * - CANCELLATION: In-flight requests cancelled on new input
 * - EXPONENTIAL BACKOFF: 1s → 2s → 4s → 8s on failures
 * - GRACEFUL DEGRADATION: Disable after 3 consecutive failures
 */

import { usePublicClient, useAccount } from 'wagmi';
import { useRef, useState, useCallback } from 'react';
import { parseAbi, type Address } from 'viem';

export interface GasEstimate {
  gasLimit: bigint;
  gasCost: bigint;
  isLoading: boolean;
  error?: string;
}

// Gas estimation constants (matching swap feature)
const GAS_BUFFER_NUMERATOR = 130n; // 30% buffer
const GAS_BUFFER_DENOMINATOR = 100n;
const MAX_GAS_CAP = 2_000_000n; // Cap at 2M gas units

// Debounce and backoff constants
const DEBOUNCE_MS = 600;
const MAX_RETRIES = 3;
const BACKOFF_DELAYS = [1000, 2000, 4000, 8000]; // Exponential backoff
const DISABLE_DURATION_MS = 5 * 60 * 1000; // Disable for 5 minutes after 3 failures

interface RequestState {
  requestId: number;
  abortController: AbortController | null;
}

export function useGasEstimate() {
  const publicClient = usePublicClient();
  const { address } = useAccount();

  // Track request state for cancellation
  const requestRef = useRef<RequestState>({ requestId: 0, abortController: null });
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const backoffTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Failure tracking
  const [consecutiveFailures, setConsecutiveFailures] = useState(0);
  const [disabledUntil, setDisabledUntil] = useState<number>(0);

  const estimateLiquidityGas = useCallback(async (
    contractAddress: Address,
    functionName: string,
    args: unknown[],
    abi: unknown[],
  ): Promise<GasEstimate> => {
    // Check if gas estimation is temporarily disabled
    if (Date.now() < disabledUntil) {
      return {
        gasLimit: 0n,
        gasCost: 0n,
        isLoading: false,
        error: 'Gas estimation temporarily disabled due to repeated failures',
      };
    }

    if (!publicClient || !address) {
      return { gasLimit: 0n, gasCost: 0n, isLoading: false };
    }

    // Cancel any in-flight request and clear timers
    if (requestRef.current.abortController) {
      requestRef.current.abortController.abort();
    }
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    if (backoffTimerRef.current) {
      clearTimeout(backoffTimerRef.current);
    }

    // Return a promise that resolves with the estimate (or error)
    return new Promise<GasEstimate>((resolve) => {
      const requestId = ++requestRef.current.requestId;
      const abortController = new AbortController();
      requestRef.current.abortController = abortController;

      const attemptEstimate = async (attempt: number): Promise<GasEstimate> => {
        if (abortController.signal.aborted) {
          throw new Error('Cancelled');
        }

        try {
          // viem doesn't directly support AbortSignal in estimateContractGas,
          // but we can check for abort before the call
          if (abortController.signal.aborted) {
            throw new Error('Cancelled');
          }

          const estimatedGas = await publicClient.estimateContractGas({
            address: contractAddress,
            abi: abi as readonly unknown[],
            functionName,
            args,
            account: address,
          });

          // Add 30% buffer for network congestion (same as swap feature)
          const bufferedGas = (estimatedGas * GAS_BUFFER_NUMERATOR) / GAS_BUFFER_DENOMINATOR;

          // Cap at 2M to prevent excessive estimates
          const gasLimit = bufferedGas > MAX_GAS_CAP ? MAX_GAS_CAP : bufferedGas;

          // Get current gas price
          const gasPrice = await publicClient.getGasPrice();

          // Calculate gas cost in native token (wei)
          const gasCost = gasLimit * gasPrice;

          console.log('[useGasEstimate] Gas estimation complete:', {
            functionName,
            attempt,
            estimatedGas: estimatedGas.toString(),
            gasLimit: gasLimit.toString(),
            gasPrice: gasPrice.toString(),
            gasCost: gasCost.toString(),
          });

          // Reset failure counter on success
          setConsecutiveFailures(0);

          return {
            gasLimit,
            gasCost,
            isLoading: false,
          };
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : String(err);

          // Check if this was a cancellation
          if (errorMessage === 'Cancelled' || abortController.signal.aborted) {
            const cancelErr = new Error('Cancelled');
            cancelErr.cause = err;
            throw cancelErr;
          }

          console.error('[useGasEstimate] Estimation failed (attempt ' + attempt + '):', errorMessage);

          // Check if we should retry
          if (attempt < MAX_RETRIES && !errorMessage.includes('UserRejected')) {
            const backoffDelay = BACKOFF_DELAYS[Math.min(attempt, BACKOFF_DELAYS.length - 1)];

            console.log('[useGasEstimate] Retrying in ' + backoffDelay + 'ms...');

            // Wait for backoff delay
            await new Promise(resolveDelay => {
              backoffTimerRef.current = setTimeout(resolveDelay, backoffDelay);
            });

            // Check if we were cancelled during backoff
            if (abortController.signal.aborted) {
              const backoffErr = new Error('Cancelled');
              backoffErr.cause = err;
              throw backoffErr;
            }

            return attemptEstimate(attempt + 1);
          }

          // Max retries reached — return error but don't disable immediately
          // This allows transient failures to recover
          return {
            gasLimit: 0n,
            gasCost: 0n,
            isLoading: false,
            error: errorMessage,
          };
        }
      };

      // Wrap in debounce
      debounceTimerRef.current = setTimeout(async () => {
        try {
          const result = await attemptEstimate(1);

          // Check if this is still the latest request
          if (requestRef.current.requestId === requestId && !abortController.signal.aborted) {
            // Increment failure counter if this was an error
            if (result.error) {
              const newFailureCount = consecutiveFailures + 1;
              setConsecutiveFailures(newFailureCount);

              // After 3 consecutive failures, disable gas estimation temporarily
              if (newFailureCount >= MAX_RETRIES) {
                const disableUntil = Date.now() + DISABLE_DURATION_MS;
                setDisabledUntil(disableUntil);
                console.warn('[useGasEstimate] Disabled for 5 minutes due to repeated failures');

                // Re-enable after disable period
                backoffTimerRef.current = setTimeout(() => {
                  setConsecutiveFailures(0);
                  setDisabledUntil(0);
                }, DISABLE_DURATION_MS);
              }
            }

            resolve(result);
          }
        } catch (err) {
          // Request was cancelled
          if ((err as Error).message !== 'Cancelled') {
            console.error('[useGasEstimate] Unexpected error:', err);
          }
          // For cancelled requests, resolve with loading=false to prevent UI stuck state
          resolve({
            gasLimit: 0n,
            gasCost: 0n,
            isLoading: false,
            error: undefined,
          });
        }
      }, DEBOUNCE_MS);
    });
  }, [publicClient, address, consecutiveFailures, disabledUntil]);

  /**
   * Estimate gas for a direct DEX router swap.
   *
   * Uses the router contract address instead of the aggregator.
   * Estimates swapExactTokensForTokensSupportingFeeOnTransferTokens gas.
   */
  const estimateDirectSwapGas = useCallback(async (
    routerAddress: Address,
    amountIn: bigint,
    amountOutMin: bigint,
    path: Address[],
    recipient: Address,
    deadline: bigint,
  ): Promise<GasEstimate> => {
    if (!publicClient || !address) {
      return { gasLimit: 0n, gasCost: 0n, isLoading: false };
    }

    const ROUTER_ABI = parseAbi([
      'function swapExactTokensForTokensSupportingFeeOnTransferTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline) external',
    ]);

    try {
      const estimatedGas = await publicClient.estimateContractGas({
        address: routerAddress,
        abi: ROUTER_ABI,
        functionName: 'swapExactTokensForTokensSupportingFeeOnTransferTokens',
        args: [amountIn, amountOutMin, path, recipient, deadline],
        account: address,
      });

      const bufferedGas = (estimatedGas * GAS_BUFFER_NUMERATOR) / GAS_BUFFER_DENOMINATOR;
      const gasLimit = bufferedGas > MAX_GAS_CAP ? MAX_GAS_CAP : bufferedGas;
      const gasPrice = await publicClient.getGasPrice();
      const gasCost = gasLimit * gasPrice;

      return { gasLimit, gasCost, isLoading: false };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      return { gasLimit: 0n, gasCost: 0n, isLoading: false, error: errorMessage };
    }
  }, [publicClient, address]);

  return { estimateLiquidityGas, estimateDirectSwapGas };
}
