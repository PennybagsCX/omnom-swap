/**
 * useDirectRouterSwap — hook for executing swaps directly on a DEX router.
 *
 * Used as a fallback when a token has transfer restrictions that prevent
 * aggregator swaps but still allows direct DEX router interaction.
 *
 * Flow:
 *   1. Approve the DEX router (not the aggregator) to spend tokens
 *   2. Call swapExactTokensForTokensSupportingFeeOnTransferTokens on the router
 *   3. Wait for receipt and decode events
 *   4. Return result in the same format as the aggregator swap hook
 *
 * This bypasses the aggregator entirely:
 *   - No 0.25% aggregator fee
 *   - No multi-hop routing
 *   - Only works for single-step, single-DEX routes
 */

import { useState, useCallback } from 'react';
import { useAccount, useWriteContract, usePublicClient } from 'wagmi';
import { erc20Abi, parseAbi, type Address } from 'viem';
import { CONTRACTS, getTokenDecimals } from '../lib/constants';

// ─── Constants ────────────────────────────────────────────────────────────────

const MAX_UINT256 = 2n ** 256n - 1n;

/** Gas buffer multiplier: 30% extra. */
const GAS_BUFFER_NUMERATOR = 130n;
const GAS_BUFFER_DENOMINATOR = 100n;

/** Fallback gas limit when estimation fails. */
const FALLBACK_GAS_LIMIT = 350000n;

/** Maximum gas cap. */
const MAX_GAS_CAP = 1_000_000n;

/** Default deadline in seconds from now (5 minutes). */
const DEFAULT_DEADLINE_SECONDS = 300;

// ─── Router ABI ────────────────────────────────────────────────────────────────

/**
 * Minimal ABI for swapExactTokensForTokensSupportingFeeOnTransferTokens.
 * This is the standard UniswapV2 function that handles fee-on-transfer tokens.
 */
const ROUTER_SWAP_ABI = parseAbi([
  'function swapExactTokensForTokensSupportingFeeOnTransferTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline) external',
  'function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline) external returns (uint256[] amounts)',
]);

// ─── Types ──────────────────────────────────────────────────────────────────────

export interface DirectRouterSwapParams {
  /** Input token address. */
  tokenIn: Address;
  /** Output token address. */
  tokenOut: Address;
  /** Amount of input tokens (raw, in token decimals). */
  amountIn: bigint;
  /** Minimum output amount (raw, in token decimals). */
  minAmountOut: bigint;
  /** DEX router contract address. */
  router: Address;
  /** Recipient address for output tokens. */
  recipient: Address;
  /** Transaction deadline (Unix timestamp). */
  deadline: bigint;
  /** Swap path (token addresses). */
  path: Address[];
}

export interface DirectRouterSwapResult {
  /** Whether the swap was successful. */
  success: boolean;
  /** Transaction hash. */
  txHash: `0x${string}` | null;
  /** Error message if swap failed. */
  error: string | null;
  /** Gas used (from receipt). */
  gasUsed?: bigint;
}

// ─── Hook ───────────────────────────────────────────────────────────────────────

export function useDirectRouterSwap() {
  const { address } = useAccount();
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient();

  const [isPending, setIsPending] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const [isConfirmed, setIsConfirmed] = useState(false);
  const [txHash, setTxHash] = useState<`0x${string}` | null>(null);
  const [error, setError] = useState<string | null>(null);

  /**
   * Approve the DEX router to spend tokens.
   * Uses unlimited approval (same pattern as aggregator).
   */
  const approveRouter = useCallback(
    async (tokenAddress: Address, routerAddress: Address, amount: bigint) => {
      if (!address || !publicClient) throw new Error('Wallet not connected');

      const allowance = (await publicClient.readContract({
        address: tokenAddress,
        abi: erc20Abi,
        functionName: 'allowance',
        args: [address, routerAddress],
      })) as bigint;

      console.log(`[directSwap:approve] Allowance check:`, {
        token: tokenAddress,
        owner: address,
        spender: routerAddress,
        currentAllowance: allowance.toString(),
        requiredAmount: amount.toString(),
        needsApproval: allowance < amount,
      });

      if (allowance >= amount) {
        console.log(`[directSwap:approve] Skipping approval (sufficient allowance)`);
        return;
      }

      const hash = await writeContractAsync({
        address: tokenAddress,
        abi: erc20Abi,
        functionName: 'approve',
        args: [routerAddress, MAX_UINT256],
      });

      console.log(`[directSwap:approve] Approval sent:`, { txHash: hash });

      await publicClient.waitForTransactionReceipt({ hash });

      console.log(`[directSwap:approve] Approval confirmed`);
    },
    [address, publicClient, writeContractAsync],
  );

  /**
   * Estimate gas for the direct router swap.
   */
  const estimateGasWithBuffer = useCallback(
    async (params: DirectRouterSwapParams): Promise<bigint> => {
      if (!publicClient || !address) return FALLBACK_GAS_LIMIT;

      try {
        const estimatedGas = await publicClient.estimateContractGas({
          address: params.router,
          abi: ROUTER_SWAP_ABI,
          functionName: 'swapExactTokensForTokensSupportingFeeOnTransferTokens',
          args: [
            params.amountIn,
            params.minAmountOut,
            params.path,
            params.recipient,
            params.deadline,
          ],
          account: address,
        });

        const bufferedGas = (estimatedGas * GAS_BUFFER_NUMERATOR) / GAS_BUFFER_DENOMINATOR;
        return bufferedGas > MAX_GAS_CAP ? MAX_GAS_CAP : bufferedGas;
      } catch (err) {
        const errMsg = (err instanceof Error ? err.message : String(err)).toLowerCase();

        // Re-throw contract revert errors
        const REVERT_INDICATORS = [
          'insufficient_output_amount',
          'insufficient_liquidity',
          'expired',
          'revert',
          'transferfailed',
          'transfer_from_failed',
        ];

        if (REVERT_INDICATORS.some((ind) => errMsg.includes(ind))) {
          throw err;
        }

        console.warn('[directSwap:gas] Network error, using fallback:', errMsg);
        return FALLBACK_GAS_LIMIT;
      }
    },
    [publicClient, address],
  );

  /**
   * Execute a direct swap on a DEX router.
   *
   * This bypasses the aggregator entirely — no fee, no multi-hop.
   * Only for single-step, single-DEX routes.
   */
  const executeDirectSwap = useCallback(
    async (params: DirectRouterSwapParams): Promise<DirectRouterSwapResult> => {
      if (!address || !publicClient) {
        const errMsg = 'Wallet not connected';
        setError(errMsg);
        return { success: false, txHash: null, error: errMsg };
      }

      setIsPending(true);
      setIsConfirming(false);
      setIsConfirmed(false);
      setTxHash(null);
      setError(null);

      try {
        // Step 1: Approve the router
        await approveRouter(params.tokenIn, params.router, params.amountIn);

        // Step 2: Estimate gas
        const gasLimit = await estimateGasWithBuffer(params);

        // Step 3: Execute swap
        setIsPending(false);
        setIsConfirming(true);

        console.log(`[directSwap] Executing swap:`, {
          router: params.router,
          tokenIn: params.tokenIn,
          tokenOut: params.tokenOut,
          amountIn: params.amountIn.toString(),
          minAmountOut: params.minAmountOut.toString(),
          path: params.path,
          deadline: params.deadline.toString(),
          gasLimit: gasLimit.toString(),
        });

        const hash = await writeContractAsync({
          address: params.router,
          abi: ROUTER_SWAP_ABI,
          functionName: 'swapExactTokensForTokensSupportingFeeOnTransferTokens',
          args: [
            params.amountIn,
            params.minAmountOut,
            params.path,
            params.recipient,
            params.deadline,
          ],
          gas: gasLimit,
        });

        setTxHash(hash);

        // Step 4: Wait for receipt
        const receipt = await publicClient.waitForTransactionReceipt({ hash });

        if (receipt.status === 'success') {
          setIsConfirmed(true);
          setIsConfirming(false);
          return {
            success: true,
            txHash: hash,
            error: null,
            gasUsed: receipt.gasUsed,
          };
        } else {
          setIsConfirmed(false);
          setIsConfirming(false);
          const errMsg = 'Transaction reverted on-chain. The swap may have failed due to slippage or price movement.';
          setError(errMsg);
          return { success: false, txHash: hash, error: errMsg, gasUsed: receipt.gasUsed };
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);

        // Check for user rejection
        const lower = errMsg.toLowerCase();
        if (
          lower.includes('user rejected') ||
          lower.includes('user denied') ||
          lower.includes('rejected the request') ||
          lower.includes('action_rejected')
        ) {
          setError('Transaction rejected by user.');
        } else {
          setError(`Direct swap failed: ${errMsg}`);
        }

        setIsPending(false);
        setIsConfirming(false);
        return { success: false, txHash: null, error: errMsg };
      }
    },
    [address, publicClient, writeContractAsync, approveRouter, estimateGasWithBuffer],
  );

  /**
   * Build direct swap params from a RouteResult.
   * Only works for single-step routes (direct DEX swap).
   */
  const buildDirectSwapParams = useCallback(
    (
      route: {
        steps: {
          dexRouter: string;
          path: string[];
          amountIn: bigint;
          expectedAmountOut: bigint;
        }[];
        totalAmountIn: bigint;
        totalExpectedOut: bigint;
      },
      slippageBps: number = 50,
      deadlineMinutes: number = 5,
    ): DirectRouterSwapParams | null => {
      if (!address) return null;
      if (route.steps.length !== 1) return null; // Only single-step routes

      const step = route.steps[0];
      const currentTimeSeconds = Math.floor(Date.now() / 1000);
      const deadline = BigInt(currentTimeSeconds + deadlineMinutes * 60);

      const slippageMultiplier = 10000n - BigInt(slippageBps);
      const minAmountOut = (route.totalExpectedOut * slippageMultiplier) / 10000n;

      return {
        tokenIn: step.path[0] as Address,
        tokenOut: step.path[step.path.length - 1] as Address,
        amountIn: route.totalAmountIn,
        minAmountOut,
        router: step.dexRouter as Address,
        recipient: address,
        deadline,
        path: step.path as Address[],
      };
    },
    [address],
  );

  /**
   * Reset state for a new swap.
   */
  const reset = useCallback(() => {
    setIsPending(false);
    setIsConfirming(false);
    setIsConfirmed(false);
    setTxHash(null);
    setError(null);
  }, []);

  return {
    executeDirectSwap,
    buildDirectSwapParams,
    reset,
    isPending,
    isConfirming,
    isConfirmed,
    txHash,
    error,
  };
}
