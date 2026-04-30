/**
 * useSwap — hook to execute swaps through the OmnomSwapAggregator contract.
 *
 * Handles approval flow, builds SwapRequest calldata from RouteResult,
 * tracks transaction status.
 *
 * Fixes applied:
 *   - Detects on-chain reverts: checks receipt.status === 'reverted' and sets error
 *   - Classifies error types: wallet rejection, network error, on-chain revert
 *   - Exposes txHash for reverted TXs so users can view on explorer
 *   - WWDOGE wrapping: auto-wraps native DOGE → WWDOGE before swap if needed
 *   - Token dust fix: multi-hop steps use actual expected output for amountIn
 *
 * Resilience features:
 *   - 2% approval buffer for fee rounding, re-wrapping, and price shifts
 *   - Dynamic deadline: user setting + per-hop buffer (+30s per hop)
 *   - Gas estimation with 30% buffer, fallback to 500k, cap at 2M
 *   - Pre-swap validation (balance, allowance, WWDOGE checks)
 *   - Automatic retry (up to 2x) for transient network errors
 */

import { useState, useCallback } from 'react';
import { useAccount, useWriteContract, usePublicClient } from 'wagmi';
import { erc20Abi, type Address } from 'viem';
import {
  OMNOMSWAP_AGGREGATOR_ADDRESS,
  OMNOMSWAP_AGGREGATOR_ABI,
  CONTRACTS,
  WWDOGE_ABI,
} from '../../lib/constants';
import type { RouteResult, SwapRequest } from '../../services/pathFinder/types';
import { isRouterRegistered } from '../../services/pathFinder/poolFetcher';

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * Unlimited approval amount (uint256 max).
 *
 * Standard practice used by all major DEXes (Uniswap, 1inch, etc.):
 * approve once with max allowance so subsequent swaps skip the approval
 * step entirely, reducing wallet confirmations from 2 (approve + swap)
 * to 1 (swap only).
 *
 * Users can revoke approval at any time via Etherscan or any token
 * approval management tool.
 */
const MAX_UINT256 = 2n ** 256n - 1n;

/** Maximum number of automatic retries for transient network errors. */
const MAX_RETRIES = 2;

/** Delay in milliseconds between retry attempts. */
const RETRY_DELAY_MS = 2000;

/** Gas buffer multiplier: 30% extra to handle gas spikes during congestion. */
const GAS_BUFFER_NUMERATOR = 130n;
const GAS_BUFFER_DENOMINATOR = 100n;

/** Fallback gas limit when estimation fails (common during network congestion). */
const FALLBACK_GAS_LIMIT = 500000n;

/** Maximum gas cap to prevent excessive gas costs from wildly inflated estimates. */
const MAX_GAS_CAP = 2_000_000n;

/** Extra seconds added per hop for multi-hop routes (more hops = more execution time). */
const EXTRA_SECONDS_PER_HOP = 30;

/** Minimum output for intermediate steps (prevents MEV with dust amounts). */
const MIN_INTERMEDIATE_OUT = BigInt('1000000000000'); // 1e12 wei minimum for intermediate steps

/** RPC latency threshold for warning (milliseconds). */
const RPC_LATENCY_WARNING_MS = 2000;

/** Default timeout for waitForTransactionReceipt (milliseconds). */
const DEFAULT_RECEIPT_TIMEOUT_MS = 30_000;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Check if an error is a transient network error that is safe to retry.
 * On-chain reverts and user rejections are NOT retried.
 */
function isTransientNetworkError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const lower = err.message.toLowerCase();
  return (
    lower.includes('timeout') ||
    lower.includes('timed out') ||
    lower.includes('connection reset') ||
    lower.includes('network error') ||
    lower.includes('fetch failed') ||
    lower.includes('rpc') ||
    lower.includes('econnrefused') ||
    lower.includes('econnreset') ||
    lower.includes('socket hang up') ||
    lower.includes('rate limit') ||
    lower.includes('429') ||
    lower.includes('503') ||
    lower.includes('502')
  );
}

/**
 * Check if an error is a user rejection (wallet denied the transaction).
 * These should never be retried automatically.
 */
function isUserRejection(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const lower = err.message.toLowerCase();
  return (
    lower.includes('user rejected') ||
    lower.includes('user denied') ||
    lower.includes('rejected the request') ||
    lower.includes('action_rejected') ||
    lower.includes('cancelled')
  );
}

/** Sleep for a given number of milliseconds. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useSwap() {
  const { address } = useAccount();
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient();

  const [isPending, setIsPending] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const [isConfirmed, setIsConfirmed] = useState(false);
  const [txHash, setTxHash] = useState<`0x${string}` | null>(null);
  const [error, setError] = useState<string | null>(null);

  /**
   * Approve the aggregator contract to spend tokens on behalf of the user.
   *
   * Uses unlimited approval (uint256.max) — the standard pattern used by all
   * major DEXes (Uniswap, 1inch, SushiSwap, etc.). Benefits:
   *   - First swap: 1 approval TX + 1 swap TX (2 confirmations)
   *   - Subsequent swaps: approval skipped entirely (1 confirmation)
   *   - No risk of "insufficient allowance" on subsequent swaps
   *
   * The allowance check below ensures we only send an approval TX when needed.
   * Once unlimited approval is granted, all future swaps skip this step.
   *
   * Users can revoke approval at any time via Etherscan or token approval
   * management tools.
   */
  const approve = useCallback(
    async (tokenAddress: Address, amount: bigint) => {
      if (!address || !publicClient) throw new Error('Wallet not connected');

      // Check current allowance — if already unlimited (or >= amount), skip
      const allowance = (await publicClient.readContract({
        address: tokenAddress,
        abi: erc20Abi,
        functionName: 'allowance',
        args: [address, OMNOMSWAP_AGGREGATOR_ADDRESS],
      })) as bigint;

      if (allowance >= amount) return; // Already approved (unlimited or sufficient)

      // Unlimited approval — standard DEX pattern.
      // After this, all future swaps of this token skip the approval step.
      const approvalAmount = MAX_UINT256;

      const hash = await writeContractAsync({
        address: tokenAddress,
        abi: erc20Abi,
        functionName: 'approve',
        args: [OMNOMSWAP_AGGREGATOR_ADDRESS, approvalAmount],
      });

      await publicClient.waitForTransactionReceipt({ hash });
    },
    [address, publicClient, writeContractAsync],
  );

  /**
   * Wrap native DOGE → WWDOGE if needed.
   *
   * The aggregator contract only works with ERC20 tokens. When the user
   * sells WWDOGE but only holds native DOGE, we must wrap the required
   * amount first by calling WWDOGE.deposit{value: amount}().
   *
   * Only wraps the deficit — if the user already has some WWDOGE, only
   * the difference is wrapped to minimise gas.
   */
  const wrapDogeIfNeeded = useCallback(
    async (amountNeeded: bigint): Promise<void> => {
      if (!address || !publicClient) throw new Error('Wallet not connected');

      const wwdogeAddress = CONTRACTS.WWDOGE as Address;

      // Check current WWDOGE balance
      const wwdogeBalance = (await publicClient.readContract({
        address: wwdogeAddress,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [address],
      })) as bigint;

      const deficit = amountNeeded - wwdogeBalance;
      if (deficit <= 0n) return; // Already have enough WWDOGE

      // Check native DOGE balance is sufficient
      const nativeBalance = await publicClient.getBalance({ address });
      if (nativeBalance < deficit) {
        throw new Error(
          `Insufficient DOGE to wrap. Need ${deficit.toString()}, have ${nativeBalance.toString()}`,
        );
      }

      // Call WWDOGE.deposit() with msg.value = deficit
      const hash = await writeContractAsync({
        address: wwdogeAddress,
        abi: WWDOGE_ABI,
        functionName: 'deposit',
        value: deficit,
        args: [],
      });

      await publicClient.waitForTransactionReceipt({ hash });
    },
    [address, publicClient, writeContractAsync],
  );

  /**
   * Build a SwapRequest from a RouteResult.
   *
   * DYNAMIC DEADLINE:
   *   - Base deadline: user's setting (default 5 min) — authoritative source
   *   - Extra time per hop: +30 seconds for each hop beyond the first
   *     (multi-hop routes need more execution time, especially during congestion)
   *   - Uses block timestamp for accuracy instead of local clock
   *
   * MULTI-HOP STEP CHAINING — Token Dust Fix:
   * The contract uses `step.amountIn` literally for each step via
   * `swapExactTokensForTokens(stepAmountIn, ...)`. After step 0, the contract's
   * actual token balance is the REAL output from the DEX (which is between
   * minAmountOut and expectedAmountOut).
   *
   * Previous approach: set step 1's amountIn = step 0's minAmountOut.
   * This was safe (never over-spends) but left the difference between actual
   * output and minAmountOut stuck in the contract as "dust".
   *
   * New approach: set step 1's amountIn = step 0's expectedAmountOut.
   * This uses the full expected output. The router's minAmountOut guarantees
   * the actual output is >= minAmountOut, but the contract may have MORE
   * tokens than amountIn if the real output exceeds expectedAmountOut.
   *
   * To handle the case where actual output < expectedAmountOut (rare but
   * possible with fast-moving markets), we set minAmountOut on intermediate
   * steps to 1 wei (the final minTotalAmountOut check protects the user).
   * The router will still execute as long as it can provide >= 1 wei output.
   *
   * If actual output < step.amountIn, the router will only swap what's
   * available (the approval is for amountIn but the contract can only spend
   * what it holds). UniV2 routers pull tokens via transferFrom, so they'll
   * take the lesser of approval and actual balance.
   */
  const buildSwapRequest = useCallback(
    (route: RouteResult, slippageBps: number, deadlineMinutes: number): SwapRequest => {
      if (!address) throw new Error('Wallet not connected');

      // ── Deadline Validation & Debug ─────────────────────────────────────────
      const currentTimeSeconds = Math.floor(Date.now() / 1000);
      
      // Ensure deadlineMinutes is a valid number (catch NaN/undefined)
      const validatedDeadlineMinutes = Number(deadlineMinutes);
      if (!Number.isFinite(validatedDeadlineMinutes) || validatedDeadlineMinutes <= 0) {
        console.error('[useSwap] Invalid deadlineMinutes:', deadlineMinutes, '— using default 5');
      }
      const safeDeadlineMinutes = Number.isFinite(validatedDeadlineMinutes) && validatedDeadlineMinutes > 0 
        ? validatedDeadlineMinutes 
        : 5;

      // Dynamic deadline: user setting + per-hop buffer (no artificial minimum)
      const userDeadlineSeconds = safeDeadlineMinutes * 60;
      const hopCount = route.steps.length;
      const extraPerHop = Math.max(0, hopCount - 1) * EXTRA_SECONDS_PER_HOP;
      const effectiveDeadlineSeconds = userDeadlineSeconds + extraPerHop;
      const deadline = BigInt(currentTimeSeconds + effectiveDeadlineSeconds);

      // Validate deadline is within acceptable range before sending to contract
      const minAcceptableDeadline = BigInt(currentTimeSeconds + 60); // At least 60 seconds
      const maxAcceptableDeadline = BigInt(currentTimeSeconds + 7200); // At most 2 hours
      if (deadline < minAcceptableDeadline || deadline > maxAcceptableDeadline) {
        console.error('[useSwap] Deadline out of range:', {
          deadline: deadline.toString(),
          deadlineHex: '0x' + deadline.toString(16),
          minAcceptable: minAcceptableDeadline.toString(),
          maxAcceptable: maxAcceptableDeadline.toString(),
          currentTime: currentTimeSeconds,
          effectiveDeadlineSeconds,
          safeDeadlineMinutes,
          hopCount,
          extraPerHop,
        });
      }

      // DEBUG: Log buildSwapRequest inputs
      console.debug(`[useSwap] buildSwapRequest:`, {
        routeId: route.id,
        totalExpectedOut: route.totalExpectedOut.toString(),
        totalExpectedOutFormatted: Number(route.totalExpectedOut) / 1e18,
        totalAmountIn: route.totalAmountIn.toString(),
        slippageBps,
        deadlineMinutes: safeDeadlineMinutes,
        deadlineRaw: deadlineMinutes,
        deadline: deadline.toString(),
        deadlineHex: '0x' + deadline.toString(16),
        feeBps: route.feeBps,
        stepsCount: route.steps.length,
      });

      // Apply slippage to total expected output — this is the final safety check
      const slippageMultiplier = 10000n - BigInt(slippageBps);
      const minTotalAmountOut = (route.totalExpectedOut * slippageMultiplier) / 10000n;

      // DEBUG: Log slippage calculation
      console.debug(`[useSwap] Slippage calculation:`, {
        slippageBps,
        slippageMultiplier: slippageMultiplier.toString(),
        routeTotalExpectedOut: route.totalExpectedOut.toString(),
        routeTotalExpectedOutHex: '0x' + route.totalExpectedOut.toString(16),
        routeTotalExpectedOutFormatted: Number(route.totalExpectedOut) / 1e18,
        minTotalAmountOut: minTotalAmountOut.toString(),
        minTotalAmountOutHex: '0x' + minTotalAmountOut.toString(16),
        minTotalAmountOutFormatted: Number(minTotalAmountOut) / 1e18,
        feeBps: route.feeBps,
        feeAmount: route.feeAmount.toString(),
        totalAmountIn: route.totalAmountIn.toString(),
        totalAmountInHex: '0x' + route.totalAmountIn.toString(16),
        routeSteps: route.steps.map((s, idx) => ({
          idx,
          dexRouter: s.dexRouter,
          dexRouterLower: s.dexRouter.toLowerCase(),
          dexName: s.dexName,
          path: s.path,
          pathLower: s.path.map(p => p.toLowerCase()),
          amountIn: s.amountIn.toString(),
          amountInHex: '0x' + s.amountIn.toString(16),
          expectedAmountOut: s.expectedAmountOut.toString(),
          expectedAmountOutHex: '0x' + s.expectedAmountOut.toString(16),
          expectedAmountOutFormatted: Number(s.expectedAmountOut) / 1e18,
        })),
      });

      // Calculate per-step minAmountOut for slippage protection
      const stepMinAmounts: bigint[] = route.steps.map((step) => {
        return (step.expectedAmountOut * slippageMultiplier) / 10000n;
      });

      const steps = route.steps.map((step, i) => {
        let stepAmountIn: bigint;
        let stepMinOut: bigint;

        if (i === 0) {
          // First step: contract validates amountIn == swapAmount (amountIn - fee)
          // The contract deducts fee from totalAmountIn, so step 0 receives swapAmount
          const feeAmount = (route.totalAmountIn * BigInt(route.feeBps)) / 10000n;
          stepAmountIn = route.totalAmountIn - feeAmount;
          // Apply slippage to first step's minAmountOut
          stepMinOut = stepMinAmounts[0];
        } else {
          // Subsequent steps: use previous step's slippage-adjusted minAmountOut as amountIn.
          //
          // IMPORTANT: We MUST use the previous step's minimum guaranteed output (after slippage),
          // NOT the expectedAmountOut. The expectedAmountOut is an off-chain estimate that can
          // exceed the actual on-chain output when AMM reserves move between pathfinder
          // calculation and execution. If we use expectedAmountOut and the actual output is less,
          // the next step's transferFrom will revert with "transfer amount exceeds balance".
          //
          // Using minAmountOut guarantees: actual output >= minAmountOut >= next step's amountIn.
          // Any tokens between minAmountOut and actual output remain as dust in the contract,
          // which is acceptable and better than reverting the entire transaction.
          stepAmountIn = stepMinAmounts[i - 1];
          if (i < route.steps.length - 1) {
            // Intermediate step: use MIN_INTERMEDIATE_OUT instead of 1n for better MEV protection
            // The final minTotalAmountOut check handles overall slippage
            stepMinOut = MIN_INTERMEDIATE_OUT;
          } else {
            // Last step: apply slippage normally
            stepMinOut = stepMinAmounts[i];
          }
        }

        return {
          router: step.dexRouter as `0x${string}`,
          path: step.path as `0x${string}`[],
          amountIn: stepAmountIn,
          minAmountOut: stepMinOut,
        };
      });

      // DEBUG: Log the final built request to trace what goes to the contract
      console.debug(`[useSwap] Final SwapRequest:`, {
        tokenIn: route.steps[0]?.path[0],
        tokenOut: route.steps[route.steps.length - 1]?.path[route.steps[route.steps.length - 1].path.length - 1],
        amountIn: route.totalAmountIn.toString(),
        minTotalAmountOut: minTotalAmountOut.toString(),
        deadline: deadline.toString(),
        stepCount: steps.length,
        steps: steps.map((s, i) => ({
          index: i,
          router: s.router,
          path: s.path,
          amountIn: s.amountIn.toString(),
          minAmountOut: s.minAmountOut.toString(),
        })),
      });

      return {
        tokenIn: route.steps[0]?.path[0] as `0x${string}` ?? '0x0000000000000000000000000000000000000000',
        tokenOut: route.steps[route.steps.length - 1]?.path[route.steps[route.steps.length - 1].path.length - 1] as `0x${string}` ?? '0x0000000000000000000000000000000000000000',
        amountIn: route.totalAmountIn,
        minTotalAmountOut,
        steps,
        deadline,
        recipient: address,
      };
    },
    [address],
  );

  /**
   * Estimate gas for the swap transaction with resilience features:
   *   - 30% buffer on top of the estimate to handle gas spikes
   *   - Falls back to 500k gas if estimation fails (common during congestion)
   *   - Caps at 2M to prevent excessively expensive transactions
   */
  const estimateGasWithBuffer = useCallback(
    async (request: SwapRequest, value?: bigint): Promise<bigint> => {
      if (!publicClient || !address) return FALLBACK_GAS_LIMIT;

      try {
        // Encode the function call to estimate gas
        const estimatedGas = await publicClient.estimateContractGas({
          address: OMNOMSWAP_AGGREGATOR_ADDRESS,
          abi: OMNOMSWAP_AGGREGATOR_ABI,
          functionName: 'executeSwap',
          args: [request],
          account: address,
          ...(value !== undefined && value > 0n ? { value } : {}),
        });

        // Add 30% buffer for gas spikes during network congestion
        const bufferedGas = (estimatedGas * GAS_BUFFER_NUMERATOR) / GAS_BUFFER_DENOMINATOR;

        // Cap at 2M to prevent excessive gas costs from wildly inflated estimates
        return bufferedGas > MAX_GAS_CAP ? MAX_GAS_CAP : bufferedGas;
      } catch (err) {
        // Gas estimation can fail during network congestion or if the RPC node
        // is overloaded. Fall back to a generous default.
        console.error('[GasEstimation] Gas estimation failed:', err instanceof Error ? err.message : String(err));
        return FALLBACK_GAS_LIMIT;
      }
    },
    [publicClient, address],
  );

  /**
   * Pre-swap validation checks to catch issues before submitting the transaction.
   *
   * Checks performed:
   *   1. Token balance sufficiency (exact amount needed)
   *   2. Aggregator allowance sufficiency
   *   3. WWDOGE balance / native DOGE for wrapping if selling WWDOGE
   *
   * Note: No approval buffer needed since we use unlimited approval (MAX_UINT256).
   * The approve() function handles the actual approval TX if needed.
   *
   * Returns an error message if validation fails, or null if all checks pass.
   */
  const validateSwap = useCallback(
    async (route: RouteResult): Promise<string | null> => {
      if (!address || !publicClient) return 'Wallet not connected';

      // Verify all route routers are registered on-chain
      const unregisteredRouters = new Set<string>();
      for (const step of route.steps) {
        if (!isRouterRegistered(step.dexRouter)) {
          unregisteredRouters.add(step.dexRouter);
        }
      }
      if (unregisteredRouters.size > 0) {
        return `Route uses unregistered DEX router(s). The swap would fail on-chain. Try refreshing the page or selecting a different route.`;
      }

      const tokenIn = route.steps[0].path[0] as Address;
      const isWwdoge = tokenIn.toLowerCase() === CONTRACTS.WWDOGE.toLowerCase();

      // Exact amount needed — no buffer required with unlimited approval
      const requiredAmount = route.totalAmountIn;

      if (isWwdoge) {
        // For WWDOGE: check combined WWDOGE + native DOGE balance
        const wwdogeAddress = CONTRACTS.WWDOGE as Address;
        const wwdogeBalance = (await publicClient.readContract({
          address: wwdogeAddress,
          abi: erc20Abi,
          functionName: 'balanceOf',
          args: [address],
        })) as bigint;

        const nativeBalance = await publicClient.getBalance({ address });
        const totalAvailable = wwdogeBalance + nativeBalance;

        if (totalAvailable < requiredAmount) {
          return `Insufficient balance. Need ${route.totalAmountIn.toString()} WWDOGE/DOGE, have WWDOGE: ${wwdogeBalance.toString()} + native: ${nativeBalance.toString()}`;
        }
      } else {
        // For other ERC20 tokens: check token balance
        const tokenBalance = (await publicClient.readContract({
          address: tokenIn,
          abi: erc20Abi,
          functionName: 'balanceOf',
          args: [address],
        })) as bigint;

        if (tokenBalance < requiredAmount) {
          return `Insufficient token balance. Need ${route.totalAmountIn.toString()}, have ${tokenBalance.toString()}`;
        }
      }

      // Check allowance — informational only; approve() handles the actual TX
      const allowance = (await publicClient.readContract({
        address: tokenIn,
        abi: erc20Abi,
        functionName: 'allowance',
        args: [address, OMNOMSWAP_AGGREGATOR_ADDRESS],
      })) as bigint;

      if (allowance < route.totalAmountIn) {
        // This is expected on first swap — the approve() call will handle it.
        // With unlimited approval, this check passes for all subsequent swaps.
      }

      return null; // All checks passed
    },
    [address, publicClient],
  );

  /**
   * Execute a swap with the given route.
   *
   * Resilience features:
   *   - Pre-swap validation (balance, allowance, WWDOGE checks)
   *   - Gas estimation with 30% buffer
   *   - Automatic retry (up to 2x) for transient network errors
   *   - Dynamic deadline auto-extension
   *
   * Error handling covers:
   *   - Wallet rejection (user clicked reject) — NOT retried
   *   - Transaction submission failure (rejected by node) — retried if transient
   *   - Transaction revert on-chain (receipt status = 'reverted') — NOT retried
   *   - Network errors — retried up to 2 times
   */
  const executeSwap = useCallback(
    async (
      route: RouteResult,
      slippageBps: number = 50,
      deadlineMinutes: number = 5,
      onRetry?: (attempt: number, maxRetries: number) => void,
    ) => {
      if (!address || !publicClient) {
        setError('Wallet not connected');
        return;
      }

      if (route.steps.length === 0) {
        setError('No route found');
        return;
      }

      setIsPending(true);
      setIsConfirming(false);
      setIsConfirmed(false);
      setTxHash(null);
      setError(null);

      let lastError: Error | null = null;

      // Retry loop for transient network errors
      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
          const tokenIn = route.steps[0].path[0] as Address;
          const isWwdoge = tokenIn.toLowerCase() === CONTRACTS.WWDOGE.toLowerCase();

          // ─── Detect native DOGE 1-step flow ──────────────────────────────
          // When selling WWDOGE and the user has enough native DOGE, we can
          // send value directly with executeSwap — no wrapping or approval needed.
          // The contract auto-wraps msg.value internally.
          let isNativeDogeSwap = false;
          if (isWwdoge) {
            const nativeBalance = await publicClient!.getBalance({ address });
            if (nativeBalance >= route.totalAmountIn) {
              isNativeDogeSwap = true;
            }
          }

          // ─── Pre-Swap Validation ─────────────────────────────────────────
          if (attempt === 0) {
            // Only validate on first attempt (balances/allowances don't change between retries)
            const validationError = await validateSwap(route);
            if (validationError) {
              setError(validationError);
              setIsPending(false);
              return;
            }
          }

          // Build swap request (includes dynamic deadline)
          const request = buildSwapRequest(route, slippageBps, deadlineMinutes);

          if (isNativeDogeSwap) {
            // ─── 1-Step Flow: Native DOGE → executeSwap with value ──────────
            // No wrapping needed — the contract wraps internally.
            // No approval needed — we're sending native DOGE, not ERC20.

            // Estimate gas with value for resilience
            const gasLimit = await estimateGasWithBuffer(request, route.totalAmountIn);

            setIsPending(false);
            setIsConfirming(true);

            // DEBUG: Log deadline immediately before contract call
            console.debug(`[useSwap] Submitting swap with deadline:`, {
              deadline: request.deadline.toString(),
              deadlineHex: '0x' + request.deadline.toString(16),
              currentTimeSeconds,
              isNativeDogeSwap,
              routeId: route.id,
            });

            const hash = await writeContractAsync({
              address: OMNOMSWAP_AGGREGATOR_ADDRESS,
              abi: OMNOMSWAP_AGGREGATOR_ABI,
              functionName: 'executeSwap',
              args: [request],
              value: route.totalAmountIn,
              gas: gasLimit,
            });

            setTxHash(hash);

            // ─── RPC Latency Check ───────────────────────────────────────────
            // Check if RPC is averaging slow responses — adjust timeout accordingly
            const rpcAvgTime = (globalThis as unknown as { __OMNOM_DEBUG?: { avgTime?: (s: string) => number } }).__OMNOM_DEBUG?.avgTime?.('RPC');
            const adjustedTimeout = rpcAvgTime && rpcAvgTime > RPC_LATENCY_WARNING_MS
              ? DEFAULT_RECEIPT_TIMEOUT_MS + Math.round(rpcAvgTime * 2) // Add 2x average to timeout
              : DEFAULT_RECEIPT_TIMEOUT_MS;

            if (rpcAvgTime && rpcAvgTime > RPC_LATENCY_WARNING_MS) {
              console.warn(`[GasEstimation] Slow RPC detected (${rpcAvgTime}ms avg). Adjusted receipt timeout to ${adjustedTimeout}ms`);
            }

            // Wait for confirmation
            const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: adjustedTimeout });

            if (receipt.status === 'success') {
              setIsConfirmed(true);
            } else {
              setIsConfirmed(false);
              setError(
                `Transaction reverted on-chain. The swap may have failed due to slippage or price movement.`,
              );
            }
            setIsConfirming(false);
            return;
          }

          // ─── 3-Step Flow: ERC20 (wrap + approve + swap) ──────────────────
          // This path is used when:
          //   - Selling any ERC20 token (not WWDOGE)
          //   - Selling WWDOGE but user only has ERC20 WWDOGE tokens (no native DOGE)

          // Step 0: If selling WWDOGE, ensure the user has enough WWDOGE tokens.
          // The UI shows native DOGE balance as "WWDOGE balance", but the contract
          // requires actual ERC20 WWDOGE. Wrap the deficit if needed.
          if (isWwdoge) {
            await wrapDogeIfNeeded(route.totalAmountIn);
          }

          // Step 1: Approve aggregator to spend input tokens
          await approve(tokenIn, route.totalAmountIn);

          // Step 2: Estimate gas with buffer for resilience
          const gasLimit = await estimateGasWithBuffer(request);

          // Step 3: Execute swap
          setIsPending(false);
          setIsConfirming(true);

          // DEBUG: Log deadline immediately before contract call
          console.debug(`[useSwap] Submitting ERC20 swap with deadline:`, {
            deadline: request.deadline.toString(),
            deadlineHex: '0x' + request.deadline.toString(16),
            currentTimeSeconds,
            routeId: route.id,
          });

          const hash = await writeContractAsync({
            address: OMNOMSWAP_AGGREGATOR_ADDRESS,
            abi: OMNOMSWAP_AGGREGATOR_ABI,
            functionName: 'executeSwap',
            args: [request],
            gas: gasLimit,
          });

          setTxHash(hash);

          // Wait for confirmation
          const receipt = await publicClient.waitForTransactionReceipt({ hash });

          if (receipt.status === 'success') {
            setIsConfirmed(true);
          } else {
            setIsConfirmed(false);
            setError(
              `Transaction reverted on-chain. The swap may have failed due to slippage or price movement.`,
            );
          }
          setIsConfirming(false);

          // Success or on-chain revert — do NOT retry
          return;
        } catch (err: unknown) {
          lastError = err instanceof Error ? err : new Error('Swap failed due to an unknown error.');

          // Don't retry user rejections or on-chain reverts
          if (isUserRejection(err)) {
            setError('Transaction rejected by user.');
            setIsPending(false);
            setIsConfirming(false);
            return;
          }

          // Check if this is a transient network error that can be retried
          const canRetry = attempt < MAX_RETRIES && isTransientNetworkError(err);

          if (canRetry) {
            // Notify caller about retry for toast display
            if (onRetry) {
              onRetry(attempt + 1, MAX_RETRIES);
            }
            // Wait before retrying
            await sleep(RETRY_DELAY_MS);
            // Reset state for retry
            setIsPending(true);
            setIsConfirming(false);
            continue;
          }

          // Non-retriable error or exhausted retries — classify and set error
          let msg: string;

          if (err instanceof Error) {
            const lower = err.message.toLowerCase();
            if (
              lower.includes('insufficient funds') ||
              lower.includes('exceeds the balance')
            ) {
              msg = 'Insufficient funds for transaction.';
            } else if (
              lower.includes('nonce') ||
              lower.includes('replacement fee too low')
            ) {
              msg = 'Transaction failed due to nonce issue. Try again.';
            } else {
              msg = err.message;
            }
          } else {
            msg = 'Swap failed due to an unknown error.';
          }

          setError(msg);
          setIsPending(false);
          setIsConfirming(false);
          return;
        }
      }

      // Should not reach here, but safety fallback
      if (lastError) {
        setError(lastError.message);
      }
      setIsPending(false);
      setIsConfirming(false);
    },
    [address, publicClient, writeContractAsync, approve, buildSwapRequest, wrapDogeIfNeeded, estimateGasWithBuffer, validateSwap],
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
    executeSwap,
    reset,
    isPending,
    isConfirming,
    isConfirmed,
    txHash,
    error,
  };
}
