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
  getTokenDecimals,
} from '../../lib/constants';
import type { RouteResult, SwapRequest } from '../../services/pathFinder/types';
import { isRouterRegistered, getDexList } from '../../services/pathFinder/poolFetcher';
import { trackSwapStart, trackSwapSuccess, trackSwapFailure, trackSwapReverted } from '../../services/monitoring/transactionMonitor';
import { useDirectRouterSwap, type DirectRouterSwapParams } from '../useDirectRouterSwap';

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

/** Maximum single-DEX price impact before warning (>10% = extreme for single DEX). */
const SINGLE_DEX_EXTREME_IMPACT = 0.10;

// ─── Uniswap V2 Router Error Selectors ───────────────────────────────────────

/**
 * Mapping of Uniswap V2 Router02 error selectors to human-readable names.
 * These errors come from external DEX routers, not our aggregator contract.
 *
 * Error selectors are the first 4 bytes of the keccak256 hash of the error
 * signature. We decode these to help users understand why their swap failed.
 */
const UNISWAP_V2_ROUTER_ERRORS: Record<string, string> = {
  // UniswapV2Router02 errors
  '0xe8e33700': 'Expired',
  '0xd4e408d3': 'InsufficientOutputAmount',
  '0x13be252b': 'InsufficientInputAmount',
  '0xfb8f41b2': 'InsufficientLiquidity',
  '0x7939f424': 'TransferFailed',
  '0xa9059cbb': 'TransferFailed',       // standard ERC20 transfer to address failed
  '0x23b872dd': 'TransferFromFailed',   // ERC20 transferFrom failed
  '0xe450d38c': 'ERC20InsufficientBalance',
  '0xbaa760b7': 'Expired',
  // Common Solidity errors
  '0x08c379a0': 'Error',               // standard revert(string)
  '0x4e487b71': 'Panic',               // panic(uint256)
};

/**
 * Decode an error selector to its human-readable name.
 * Returns null if the selector is unknown.
 */
function decodeErrorSelector(selector: string): string | null {
  return UNISWAP_V2_ROUTER_ERRORS[selector.toLowerCase()] ?? null;
}

/**
 * Parse a swap error and extract decoded information.
 *
 * This handles errors that come from external routers (e.g., Uniswap V2 errors)
 * which are wrapped by the aggregator. The raw error data contains the selector
 * that we can decode to give users helpful error messages.
 */
function parseSwapError(err: unknown): { selector: string | null; decodedName: string | null; rawMessage: string } {
  let selector: string | null = null;
  let decodedName: string | null = null;
  let rawMessage = 'Unknown error';

  if (err instanceof Error) {
    rawMessage = err.message;

    // Strategy 1: Try to extract selector from the error's `data` property (viem errors)
    // Viem ContractFunctionExecutionError stores the revert data in err.data
    const errAny = err as unknown as Record<string, unknown>;
    if (errAny.data && typeof errAny.data === 'string' && errAny.data.startsWith('0x') && errAny.data.length >= 10) {
      const dataSelector = errAny.data.slice(0, 10).toLowerCase();
      const decoded = decodeErrorSelector(dataSelector);
      if (decoded) {
        selector = dataSelector;
        decodedName = decoded;
      }
    }

    // Strategy 2: Try to extract selector from the error's `cause.data` (nested viem errors)
    if (!decodedName && errAny.cause && typeof errAny.cause === 'object' && errAny.cause !== null) {
      const cause = errAny.cause as Record<string, unknown>;
      if (cause.data && typeof cause.data === 'string' && (cause.data as string).startsWith('0x') && (cause.data as string).length >= 10) {
        const causeSelector = (cause.data as string).slice(0, 10).toLowerCase();
        const decoded = decodeErrorSelector(causeSelector);
        if (decoded) {
          selector = causeSelector;
          decodedName = decoded;
        }
      }
    }

    // Strategy 3: Look for selector after "execution reverted:" in the message
    // This is the format: "execution reverted: 0xABCDEF01"
    // Use negative lookahead to avoid matching partial addresses (must be exactly 8 hex chars)
    if (!decodedName) {
      const revertSelectorMatch = err.message.match(/(?:execution reverted|reverted with)[:\s]+(0x[a-fA-F0-9]{8})(?![a-fA-F0-9])/i);
      if (revertSelectorMatch) {
        selector = revertSelectorMatch[1].toLowerCase();
        decodedName = decodeErrorSelector(selector);
      }
    }

    // Strategy 4: Look for known error selectors anywhere in the message, but only
    // if they're standalone (not part of a longer hex string like an address)
    if (!decodedName) {
      for (const knownSelector of Object.keys(UNISWAP_V2_ROUTER_ERRORS)) {
        // Match the selector only when it's NOT preceded or followed by more hex chars
        const pattern = new RegExp(`(?<![a-fA-F0-9])${knownSelector}(?![a-fA-F0-9])`, 'i');
        if (pattern.test(err.message)) {
          selector = knownSelector.toLowerCase();
          decodedName = decodeErrorSelector(selector);
          break;
        }
      }
    }

    // Also check for revert reason strings
    const reasonMatch = err.message.match(/reverted with reason string '([^']+)'/);
    if (reasonMatch && !decodedName) {
      return { selector, decodedName: reasonMatch[1], rawMessage };
    }
  }

  return { selector, decodedName, rawMessage };
}

/**
 * Format a swap error for user display, including decoded router errors.
 * Returns a human-readable message that helps users understand what went wrong.
 */
function formatSwapErrorMessage(err: unknown, routeContext?: { dexRouter?: string; stepIndex?: number }): string {
  const { selector, decodedName, rawMessage } = parseSwapError(err);

  // Log the decoded error for debugging
  console.warn('[useSwap] Swap error:', {
    selector,
    decodedName,
    rawMessage,
    routeContext,
  });

  // Provide helpful messages for known router errors
  if (decodedName) {
    switch (decodedName) {
      case 'Expired':
        return `Transaction deadline exceeded. The swap took too long to execute. Try increasing slippage or using a shorter deadline.`;
      case 'InsufficientOutputAmount':
        return `Slippage tolerance exceeded. The output amount was less than your minimum. Try increasing slippage tolerance.`;
      case 'InsufficientInputAmount':
        return `Insufficient input amount for the swap. The pool may have updated. Try refreshing the quote.`;
      case 'InsufficientLiquidity':
        return `Insufficient liquidity in the pool. This token pair may have limited trading.`;
      case 'TransferFailed':
        return `Token transfer failed. The token may have transfer restrictions or taxes.`;
      case 'ERC20InsufficientBalance':
        return `Insufficient token balance for the swap. The token may have transfer restrictions that prevent aggregator swaps. Check your wallet balance or try swapping directly on a DEX.`;
      default:
        return `Swap failed: ${decodedName} (${selector}). Please try again or contact support.`;
    }
  }

  // Fallback to raw message with selector if known
  if (selector) {
    return `Swap failed: ${rawMessage}`;
  }

  return rawMessage;
}

/** Default timeout for waitForTransactionReceipt (milliseconds). */
const DEFAULT_RECEIPT_TIMEOUT_MS = 30_000;

/** Pool freshness check: price movement threshold to trigger warning (2%). */
const FRESHNESS_PRICE_MOVE_THRESHOLD = 0.02;

/**
 * Result of pool freshness check.
 */
export interface FreshnessResult {
  /** True if pools are fresh (price moved less than threshold). */
  isFresh: boolean;
  /** Maximum price impact detected across all steps (0.02 = 2%). */
  maxPriceImpact: number;
  /** Human-readable message describing the freshness status. */
  message: string;
  /** Step index where the largest price move was detected. */
  worstStepIndex: number;
  /** Quote output vs current output for the worst step. */
  worstStepDetails?: {
    quotedOutput: bigint;
    currentOutput: bigint;
    priceMovePercent: number;
  };
}

/**
 * Check if an error is a transient network error that is safe to retry.
 * On-chain reverts and user rejections are NOT retried.
 *
 * IMPORTANT: "execution reverted" errors are on-chain failures that will
 * always fail with the same parameters — retrying is pointless and wastes
 * ~10 seconds per retry. Only genuine network/transport errors are retried.
 */
function isTransientNetworkError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const lower = err.message.toLowerCase();

  // On-chain execution reverts are NEVER transient — fail fast
  if (lower.includes('execution reverted') || lower.includes('execution failed')) {
    return false;
  }

  return (
    lower.includes('timeout') ||
    lower.includes('timed out') ||
    lower.includes('connection reset') ||
    lower.includes('network error') ||
    lower.includes('fetch failed') ||
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

/**
 * Validate output ratio: reject swaps where minAmountOut represents
 * less than 0.1% of the input token value.
 *
 * This prevents broadcasting transactions that have no chance of succeeding
 * due to extreme slippage or stale/missing pool data.
 *
 * Returns null if valid, or an error message string if rejected.
 */

/**
 * Fetch current reserves for a single pool on a specific DEX.
 * Returns { reserveIn, reserveOut } or null if pool doesn't exist.
 */
async function fetchFreshReservesForStep(
  factoryAddress: string,
  tokenIn: string,
  tokenOut: string,
  publicClient: ReturnType<typeof usePublicClient>,
): Promise<{ reserveIn: bigint; reserveOut: bigint } | null> {
  if (!publicClient) return null;

  const FACTORY_GET_PAIR_ABI = ['function getPair(address tokenA, address tokenB) external view returns (address pair)'];
  const PAIR_ABI = [
    'function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
    'function token0() external view returns (address)',
  ];

  try {
    const factory = factoryAddress as `0x${string}`;
    const tA = tokenIn as `0x${string}`;
    const tB = tokenOut as `0x${string}`;

    const pairAddress = (await publicClient.readContract({
      address: factory,
      abi: FACTORY_GET_PAIR_ABI,
      functionName: 'getPair',
      args: [tA, tB],
    })) as `0x${string}`;

    if (!pairAddress || pairAddress === '0x0000000000000000000000000000000000000000') {
      return null;
    }

    const [reserves, token0] = await Promise.all([
      publicClient.readContract({ address: pairAddress, abi: PAIR_ABI, functionName: 'getReserves' }),
      publicClient.readContract({ address: pairAddress, abi: PAIR_ABI, functionName: 'token0' }),
    ]);

    const [r0, r1] = reserves as [bigint, bigint, number];
    const t0 = token0 as string;
    const t0Lower = t0.toLowerCase();
    const tInLower = tokenIn.toLowerCase();

    // Determine which reserve is tokenIn and which is tokenOut based on token0
    if (t0Lower === tInLower) {
      return { reserveIn: r0, reserveOut: r1 };
    } else {
      // tokenIn is token1
      return { reserveIn: r1, reserveOut: r0 };
    }
  } catch {
    return null;
  }
}

/**
 * Calculate output amount using constant product formula: x * y = k
 * amountOut = (amountIn * reserveOut) / (reserveIn + amountIn)
 */
function calculateOutput(amountIn: bigint, reserveIn: bigint, reserveOut: bigint): bigint {
  if (reserveIn === 0n || reserveOut === 0n) return 0n;
  const amountInWithFee = amountIn * 997n;
  const numerator = amountInWithFee * reserveOut;
  const denominator = reserveIn * 1000n + amountInWithFee;
  return numerator / denominator;
}

/**
 * Check if the route's pools are still fresh (reserves haven't changed significantly).
 *
 * Re-fetches reserves for each pool in the route and compares the output amounts
 * against the originally quoted expectedAmountOut. If price moved > FRESHNESS_PRICE_MOVE_THRESHOLD,
 * returns isFresh=false with details.
 *
 * This prevents the "stale quote" race condition where route was calculated when pool
 * had different reserves, but by the time the transaction was mined, pool state changed.
 *
 * @param route - The route result with steps containing quoted reserves
 * @param publicClient - Wagmi public client for RPC calls
 * @returns FreshnessResult with isFresh=true if all pools are fresh, false otherwise
 */
async function checkPoolFreshness(
  route: RouteResult,
  publicClient: ReturnType<typeof usePublicClient>,
): Promise<FreshnessResult> {
  if (!publicClient || route.steps.length === 0) {
    return { isFresh: true, maxPriceImpact: 0, message: 'No route or client', worstStepIndex: -1 };
  }

  let maxPriceImpact = 0;
  let worstStepIndex = -1;
  let worstStepDetails: FreshnessResult['worstStepDetails'] | undefined;
  const allDexes = getDexList();

  for (let i = 0; i < route.steps.length; i++) {
    const step = route.steps[i];
    const tokenIn = step.path[0].toLowerCase();
    const tokenOut = step.path[step.path.length - 1].toLowerCase();

    // Find the DEX factory for this step's router
    const dexInfo = allDexes.find(
      (d) => d.router.toLowerCase() === step.dexRouter.toLowerCase(),
    );
    if (!dexInfo) continue;

    // Fetch fresh reserves
    const freshReserves = await fetchFreshReservesForStep(
      dexInfo.factory,
      tokenIn,
      tokenOut,
      publicClient,
    );

    if (!freshReserves) {
      // Pool might have been created/removed - can't determine freshness
      continue;
    }

    // Calculate what the current output would be
    const currentOutput = calculateOutput(step.amountIn, freshReserves.reserveIn, freshReserves.reserveOut);
    const quotedOutput = step.expectedAmountOut;

    // Calculate price move percentage
    // Price move = (quotedOutput - currentOutput) / quotedOutput
    // If currentOutput < quotedOutput, price moved against us (positive price impact)
    const priceMoveRaw = Number(quotedOutput) === 0
      ? 0
      : (Number(quotedOutput) - Number(currentOutput)) / Number(quotedOutput);
    const priceMovePercent = Math.abs(priceMoveRaw);

    if (priceMovePercent > maxPriceImpact) {
      maxPriceImpact = priceMovePercent;
      worstStepIndex = i;
      worstStepDetails = {
        quotedOutput,
        currentOutput,
        priceMovePercent,
      };
    }

    console.debug(`[PoolFreshness] Step ${i} (${step.dexName}):`, {
      quotedOutput: quotedOutput.toString(),
      currentOutput: currentOutput.toString(),
      priceMovePercent: (priceMovePercent * 100).toFixed(4),
      freshReserveIn: freshReserves.reserveIn.toString(),
      freshReserveOut: freshReserves.reserveOut.toString(),
    });
  }

  const isFresh = maxPriceImpact <= FRESHNESS_PRICE_MOVE_THRESHOLD;

  let message: string;
  if (isFresh) {
    message = 'Route is fresh - pools unchanged since quote';
  } else {
    message = `Pool price moved ${(maxPriceImpact * 100).toFixed(2)}% since quote (threshold: ${(FRESHNESS_PRICE_MOVE_THRESHOLD * 100).toFixed(0)}%). Consider increasing slippage or waiting.`;
  }

  return {
    isFresh,
    maxPriceImpact,
    message,
    worstStepIndex,
    worstStepDetails,
  };
}

// ─── Swap Mode ────────────────────────────────────────────────────────────────

/** Swap execution mode — aggregator (default) or direct DEX router fallback. */
export type SwapMode = 'aggregator' | 'direct';

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

  /** Current swap mode — set by compatibility check before execution. */
  const [swapMode, setSwapMode] = useState<SwapMode>('aggregator');

  /** Direct router swap hook — used when aggregator is incompatible. */
  const directSwap = useDirectRouterSwap();

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

      console.log(`[approve] Allowance check:`, {
        token: tokenAddress,
        owner: address,
        spender: OMNOMSWAP_AGGREGATOR_ADDRESS,
        currentAllowance: allowance.toString(),
        requiredAmount: amount.toString(),
        needsApproval: allowance < amount,
      });

      if (allowance >= amount) {
        console.log(`[approve] Skipping approval (sufficient allowance)`);
        return; // Already approved (unlimited or sufficient)
      }

      // Unlimited approval — standard DEX pattern.
      // After this, all future swaps of this token skip the approval step.
      const approvalAmount = MAX_UINT256;

      console.log(`[approve] Sending approval TX:`, {
        token: tokenAddress,
        spender: OMNOMSWAP_AGGREGATOR_ADDRESS,
        approvalAmount: approvalAmount.toString(),
      });

      const hash = await writeContractAsync({
        address: tokenAddress,
        abi: erc20Abi,
        functionName: 'approve',
        args: [OMNOMSWAP_AGGREGATOR_ADDRESS, approvalAmount],
      });

      console.log(`[approve] Approval sent:`, {
        token: tokenAddress,
        approvalAmount: approvalAmount.toString(),
        txHash: hash,
      });

      await publicClient.waitForTransactionReceipt({ hash });

      console.log(`[approve] Approval confirmed:`, {
        token: tokenAddress,
        txHash: hash,
      });
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
      // This prevents sending transactions with corrupted/invalid deadlines
      const minAcceptableDeadline = BigInt(currentTimeSeconds + 60); // At least 60 seconds
      const maxAcceptableDeadline = BigInt(currentTimeSeconds + 7200); // At most 2 hours
      
      // Check for specifically corrupted deadline values (e.g., 0xe0000 = 917504)
      // This value looks like a hex pattern that should never appear in a Unix timestamp
      // 917504 is from 1970-01-11 — clearly invalid; modern valid timestamps are > 1 billion
      const isDeadlineSuspiciouslyLow = deadline < BigInt(1_000_000_000); // Reject anything from 1970 to ~2001
      
      if (deadline < minAcceptableDeadline || deadline > maxAcceptableDeadline || isDeadlineSuspiciouslyLow) {
        const errorMsg = `[useSwap] INVALID DEADLINE REJECTED — deadline: ${deadline.toString()} (0x${deadline.toString(16)}), currentTime: ${currentTimeSeconds}, valid range: [${minAcceptableDeadline.toString()}, ${maxAcceptableDeadline.toString()}], safeDeadlineMinutes: ${safeDeadlineMinutes}, hopCount: ${hopCount}`;
        console.error(errorMsg);
        // Throw to prevent sending a transaction that would fail on-chain
        throw new Error(`Invalid deadline: ${deadline.toString()}. Please refresh and try again.`);
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

      // Slippage protection is handled by minTotalAmountOut in the contract.
      // The user sees expected output, price impact, and confirms explicitly.

      // ── Final Output Decimal Correction ─────────────────────────────────────────
      // The route calculation produces amounts in raw token units, but we must
      // ensure minTotalAmountOut is in the correct decimal representation for the
      // output token. This fix addresses the case where tokens have non-18 decimals
      // (e.g., MCRIB has 15 decimals, DC has 18 decimals).
      //
      // The route.totalExpectedOut is already in the token's native decimals, so
      // minTotalAmountOut derived from it should also be correct. However, if any
      // future changes introduce a scaling issue, this ensures the output is
      // properly aligned with the output token's decimal representation.
      const tokenOutAddress = route.steps[route.steps.length - 1].path[route.steps[route.steps.length - 1].path.length - 1];
      const tokenOutDecimals = getTokenDecimals(tokenOutAddress);
      const DECIMAL_CORRECTION_SCALE = 18 - tokenOutDecimals;

      // If output token has non-18 decimals, verify minTotalAmountOut is in correct form
      // by checking its approximate magnitude (this is a sanity check, not a fix)
      if (DECIMAL_CORRECTION_SCALE !== 0) {
        console.debug(`[useSwap] Output token decimal check:`, {
          tokenOut: tokenOutAddress,
          tokenOutDecimals,
          decimalCorrectionScale: DECIMAL_CORRECTION_SCALE,
          minTotalAmountOut: minTotalAmountOut.toString(),
        });
      }

      // ── Single DEX Extreme Price Impact Warning ───────────────────────────────
      // For single-DEX routes, warn if price impact is extreme (>10%).
      // Multi-hop routes have natural price impact from intermediate conversions.
      if (route.steps.length === 1 && route.priceImpact > SINGLE_DEX_EXTREME_IMPACT) {
        console.warn(
          `[useSwap] WARNING: Single-DEX route has extreme price impact: ${(route.priceImpact * 100).toFixed(2)}%`,
          {
            dexName: route.steps[0].dexName,
            amountIn: route.totalAmountIn.toString(),
            expectedOut: route.totalExpectedOut.toString(),
          },
        );
      }

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

      // DEBUG: Log each step's expectedAmountOut for tracing
      console.debug(`[useSwap] Step expectedAmountOut values (before normalization):`, {
        stepsCount: route.steps.length,
        steps: route.steps.map((s, idx) => ({
          idx,
          path: s.path,
          amountIn: s.amountIn.toString(),
          expectedAmountOut: s.expectedAmountOut.toString(),
          expectedAmountOutFormatted: Number(s.expectedAmountOut) / 1e18,
        })),
      });

      // Calculate per-step minAmountOut for slippage protection
      // IMPORTANT: expectedAmountOut is in the output token's native decimals
      // For multi-hop, we need to properly chain the normalized amounts
      //
      // NOTE on tax handling: The pathfinder's calculateRouteOutput() already applies
      // the buy tax deduction per-hop for ALL taxed tokens (dex-only and transfer).
      // So expectedAmountOut already reflects the post-tax amount. We should NOT
      // deduct tax again here — that would be double-counting and make minAmountOut
      // too low, causing the swap to fail or accept unfavorable rates.
      const stepMinAmounts: bigint[] = route.steps.map((step) => {
        const minOut = (step.expectedAmountOut * slippageMultiplier) / 10000n;
        return minOut;
      });

      // Calculate normalized expected outputs for proper multi-hop chaining
      // The pathfinder stores expectedAmountOut in native token decimals,
      // but for multi-hop routing, we need to track what the actual output
      // will be in 18-decimal equivalent form for proper amount chaining
      const stepExpectedNormalized: bigint[] = route.steps.map((step) => {
        const tokenOut = step.path[step.path.length - 1];
        const tokenOutDecimals = getTokenDecimals(tokenOut);
        const expectedOut = step.expectedAmountOut;
        // Normalize to 18-decimal equivalent for proper multi-hop chaining
        if (tokenOutDecimals < 18) {
          return expectedOut * 10n ** BigInt(18 - tokenOutDecimals);
        } else if (tokenOutDecimals > 18) {
          return expectedOut / 10n ** BigInt(tokenOutDecimals - 18);
        }
        return expectedOut;
      });

      // DEBUG: Log normalized step amounts for debugging multi-hop issues
      console.debug(`[useSwap] Step normalized amounts for chaining:`, {
        stepMinAmounts: stepMinAmounts.map((v, i) => ({
          step: i,
          minAmountOut: v.toString(),
          minAmountOutFormatted: Number(v) / 1e18,
        })),
        stepExpectedNormalized: stepExpectedNormalized.map((v, i) => ({
          step: i,
          normalizedOutput: v.toString(),
          normalizedOutputFormatted: Number(v) / 1e18,
        })),
      });

      // Validate intermediate amounts form a valid chain — detect broken links
      // where step N's output doesn't match step N+1's input.
      // The aggregator contract passes each step's output as the next step's input,
      // so a mismatch > 10x means the swap will fail with INSUFFICIENT_OUTPUT_AMOUNT.
      for (let i = 1; i < route.steps.length; i++) {
        const prevOutput = stepExpectedNormalized[i - 1];
        // Use the actual amountIn for this step (already normalized to 18-decimal
        // equivalent by the pathFinder). Do NOT use stepExpectedNormalized[i] —
        // that is this step's OUTPUT (a different token), not its INPUT.
        const nextInput = route.steps[i].amountIn;
        // The next hop's input should be close to the previous hop's output
        // Allow 10x tolerance for tax/fee adjustments
        if (prevOutput > 0n && nextInput > 0n) {
          const ratio = nextInput > prevOutput
            ? Number(nextInput * 10000n / prevOutput) / 100
            : Number(prevOutput * 10000n / nextInput) / 100;
          // If amounts differ by more than 10x, the chain is broken
          if (ratio > 10) {
            console.error(
              `[buildSwapRequest] BROKEN CHAIN: step ${i-1} output ${prevOutput.toString()} → step ${i} input ${nextInput.toString()} (${ratio.toFixed(1)}x mismatch)`,
              {
                stepIndex: i,
                prevOutput: prevOutput.toString(),
                prevOutputFormatted: Number(prevOutput) / 1e18,
                nextInput: nextInput.toString(),
                nextInputFormatted: Number(nextInput) / 1e18,
                ratio,
                prevStepPath: route.steps[i-1].path,
                currStepPath: route.steps[i].path,
              },
            );
            throw new Error(
              `Route has broken intermediate amounts between step ${i-1} and step ${i}: ` +
              `${ratio.toFixed(1)}x mismatch. The swap would fail on-chain.`
            );
          }
        }
      }
      
      // Log the step chain for debugging
      console.log(`[buildSwapRequest] Step chain:`);
      for (let i = 0; i < route.steps.length; i++) {
        console.log(`  Step ${i}: amountIn=${route.steps[i].amountIn.toString()}, minAmountOut=${stepMinAmounts[i].toString()}, expectedOut=${route.steps[i].expectedAmountOut.toString()}`);
      }

      const steps = route.steps.map((step, i) => {
        let stepAmountIn: bigint;
        let stepMinOut: bigint;

        if (i === 0) {
          // Contract uses swapAmount directly for step 0 (computed from balance diff),
          // so step.amountIn is ignored. Pass totalAmountIn as a placeholder.
          stepAmountIn = route.totalAmountIn;
          stepMinOut = stepMinAmounts[0];
        } else {
          // Subsequent steps: use previous step's NORMALIZED expected output as amountIn.
          //
          // CRITICAL FIX: The amountIn for step N must be in 18-decimal equivalent form
          // (matching the normalized form used by the pathfinder). Using the raw
          // expectedAmountOut would cause decimal mismatches for tokens with non-18 decimals.
          //
          // The pathfinder calculates output amounts in 18-decimal equivalent to properly
          // chain multi-hop routes. The actual on-chain output will be the actual token amount
          // (in native decimals), which will be >= this normalized amountIn.
          //
          // Using expected (normalized) instead of min ensures maximum token utilization
          // across hops. The contract's minTotalAmountOut check protects against slippage.
          stepAmountIn = stepExpectedNormalized[i - 1];

          if (i < route.steps.length - 1) {
            // Intermediate step: use MIN_INTERMEDIATE_OUT instead of 1n for better MEV protection
            // The final minTotalAmountOut check handles overall slippage
            stepMinOut = MIN_INTERMEDIATE_OUT;
          } else {
            // Last step: apply slippage normally
            stepMinOut = stepMinAmounts[i];
          }

          console.debug(`[useSwap] Step ${i} (intermediate hop):`, {
            stepAmountIn: stepAmountIn.toString(),
            stepAmountInFormatted: Number(stepAmountIn) / 1e18,
            stepMinOut: stepMinOut.toString(),
            prevStepNormalizedOutput: stepExpectedNormalized[i - 1].toString(),
            prevStepExpectedOutput: route.steps[i - 1].expectedAmountOut.toString(),
            prevStepTokenOut: route.steps[i - 1].path[route.steps[i - 1].path.length - 1],
          });
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
        // Before gas estimation, verify allowance is still sufficient.
        // Some ERC20 implementations throw ERC20InsufficientBalance instead of
        // ERC20InsufficientAllowance when transferFrom fails due to insufficient allowance.
        // This pre-check gives a clear error message instead of a confusing "insufficient balance".
        const isNativeSwap = value !== undefined && value > 0n;
        if (!isNativeSwap) {
          const currentAllowance = await publicClient.readContract({
            address: request.tokenIn as Address,
            abi: erc20Abi,
            functionName: 'allowance',
            args: [address as Address, OMNOMSWAP_AGGREGATOR_ADDRESS as Address],
          }) as bigint;

          console.log(`[estimateGasWithBuffer] Pre-check allowance:`, {
            tokenIn: request.tokenIn,
            owner: address,
            spender: OMNOMSWAP_AGGREGATOR_ADDRESS,
            allowance: currentAllowance.toString(),
            amountIn: request.amountIn.toString(),
            sufficient: currentAllowance >= request.amountIn,
          });

          if (currentAllowance < request.amountIn) {
            throw new Error(
              `Insufficient allowance: ${currentAllowance.toString()} < ${request.amountIn.toString()}. ` +
              `The approve() call may not have completed or been reverted. Token: ${request.tokenIn}`,
            );
          }

        }

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
        const errMsg = (err instanceof Error ? err.message : String(err)).toLowerCase();

        // Re-throw contract revert errors — these will fail on-chain too
        const REVERT_INDICATORS = [
          'insufficient_output_amount',
          'insufficient_input_amount',
          'insufficient_liquidity',
          'expired',
          'slippage',
          'revert',
          'erc20insufficientbalance',
          'transferfailed',
          'path mismatch',
          'step amount mismatch',
          'unsupported router',
          'deadline expired',
          'zero recipient',
          'erc20insufficientallowance',
        ];

        const isContractRevert = REVERT_INDICATORS.some(indicator =>
          errMsg.includes(indicator),
        );

        if (isContractRevert) {
          // Don't send doomed transactions — propagate the error
          throw err;
        }

        // Only use fallback for genuine network/timeout errors
        console.warn('[GasEstimation] Network error, using fallback:', errMsg);
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
        return `Route uses unregistered DEX router(s). The swap may fail on-chain. Try refreshing the page or selecting a different route.`;
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

        // Diagnostic logging: exact balance vs required amount
        console.log(`[validateSwap] Balance check:`, {
          tokenIn,
          requiredAmount: requiredAmount.toString(),
          requiredAmountFormatted: (Number(requiredAmount) / 1e18).toFixed(6),
          tokenBalance: tokenBalance.toString(),
          tokenBalanceFormatted: (Number(tokenBalance) / 1e18).toFixed(6),
          difference: (tokenBalance - requiredAmount).toString(),
          passes: tokenBalance >= requiredAmount,
        });

        if (tokenBalance < requiredAmount) {
          const need = (Number(requiredAmount) / 1e18).toFixed(4);
          const have = (Number(tokenBalance) / 1e18).toFixed(4);
          console.warn(`[validateSwap] INSUFFICIENT: need ${need} DC, have ${have} DC`);
          return `Insufficient balance. Need ~${need} tokens, have ${have}`;
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
      onFreshnessWarning?: (freshness: FreshnessResult) => void,
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

      // ─── Pre-Flight Compatibility Check ────────────────────────────────────
      // Test if the token can be transferred to the aggregator.
      // If not, check if direct router swap is possible.
      // This catches tokens with transfer restrictions (blacklists, etc.)
      const tokenInForCheck = route.steps[0].path[0] as Address;
      const routerForCheck = route.steps[0].dexRouter as Address;
      const isSingleStepRoute = route.steps.length === 1;

      let useDirectSwap = false;

      if (publicClient && address && isSingleStepRoute) {
        try {
          // Simulate transfer(tokenIn, aggregator, 1) from user's address
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

          let aggregatorTransferWorks = false;
          try {
            const result = await publicClient.readContract({
              address: tokenInForCheck,
              abi: TRANSFER_ABI,
              functionName: 'transfer',
              args: [OMNOMSWAP_AGGREGATOR_ADDRESS, 1n],
              account: address,
            });
            aggregatorTransferWorks = result === true;
          } catch {
            // Transfer to aggregator failed — might be a restriction
          }

          if (!aggregatorTransferWorks) {
            // Check if direct router transfer works
            let routerTransferWorks = false;
            try {
              const result = await publicClient.readContract({
                address: tokenInForCheck,
                abi: TRANSFER_ABI,
                functionName: 'transfer',
                args: [routerForCheck, 1n],
                account: address,
              });
              routerTransferWorks = result === true;
            } catch {
              // Transfer to router also failed
            }

            if (routerTransferWorks) {
              // Token blocks aggregator but allows router — use direct swap
              console.log(`[useSwap] Token ${tokenInForCheck} blocks aggregator transfers. Using direct router swap.`);
              useDirectSwap = true;
              setSwapMode('direct');
            } else {
              // Token blocks all contract transfers — cannot swap
              const errMsg = 'This token has transfer restrictions that prevent DEX swaps. It cannot be traded through any aggregator or DEX router.';
              setError(errMsg);
              setIsPending(false);
              return;
            }
          } else {
            setSwapMode('aggregator');
          }
        } catch (err) {
          // Compatibility check failed — proceed with aggregator (best effort)
          console.warn('[useSwap] Compatibility check failed, proceeding with aggregator:', err);
          setSwapMode('aggregator');
        }
      } else {
        // Multi-hop routes must use aggregator
        setSwapMode('aggregator');
      }

      // ─── Direct Router Swap Path ───────────────────────────────────────────
      if (useDirectSwap && isSingleStepRoute) {
        const step = route.steps[0];
        const currentTimeSeconds = Math.floor(Date.now() / 1000);
        const deadline = BigInt(currentTimeSeconds + (deadlineMinutes || 5) * 60);
        const slippageMultiplier = 10000n - BigInt(slippageBps);
        const minAmountOut = (route.totalExpectedOut * slippageMultiplier) / 10000n;

        const directParams: DirectRouterSwapParams = {
          tokenIn: step.path[0] as Address,
          tokenOut: step.path[step.path.length - 1] as Address,
          amountIn: route.totalAmountIn,
          minAmountOut,
          router: step.dexRouter as Address,
          recipient: address!,
          deadline,
          path: step.path as Address[],
        };

        setIsPending(false);

        const directResult = await directSwap.executeDirectSwap(directParams);

        if (directResult.success) {
          setIsConfirmed(true);
          setTxHash(directResult.txHash);
        } else {
          setError(directResult.error);
        }
        setIsConfirming(false);
        return;
      }

      // Track swap start (Phase 8 monitoring) - attemptId valid after buildSwapRequest
      let attemptId = '';
      const tokenInAddr = route.steps[0].path[0] as Address;
      const lastStep = route.steps[route.steps.length - 1];
      const tokenOutAddr = lastStep.path[lastStep.path.length - 1] as Address;

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
            const nativeBalance = await publicClient.getBalance({ address });
            if (nativeBalance >= route.totalAmountIn) {
              isNativeDogeSwap = true;
            }
          }

          // ─── Pre-Swap Validation ─────────────────────────────────────────
          // Always validate balance (can change between retries due to pending txs).
          // Only check allowance on first attempt (doesn't change between retries).
          {
            const tokenInAddr = route.steps[0].path[0] as Address;
            const requiredAmount = route.totalAmountIn;
            const isWWDOGE = tokenInAddr.toLowerCase() === CONTRACTS.WWDOGE.toLowerCase();

            if (isWWDOGE) {
              const wwdogeBal = (await publicClient.readContract({
                address: CONTRACTS.WWDOGE as Address,
                abi: erc20Abi,
                functionName: 'balanceOf',
                args: [address],
              })) as bigint;
              const nativeBal = await publicClient.getBalance({ address });
              const totalAvail = wwdogeBal + nativeBal;
              if (totalAvail < requiredAmount) {
                const need = (Number(requiredAmount) / 1e18).toFixed(4);
                const have = (Number(totalAvail) / 1e18).toFixed(4);
                console.warn(`[executeSwap] Retry ${attempt}: INSUFFICIENT WWDOGE+DOGE: need ${need}, have ${have}`);
                setError(`Insufficient balance. Need ~${need} WWDOGE/DOGE, have ${have}`);
                setIsPending(false);
                return;
              }
            } else {
              const tokenBal = (await publicClient.readContract({
                address: tokenInAddr,
                abi: erc20Abi,
                functionName: 'balanceOf',
                args: [address],
              })) as bigint;
              console.log(`[executeSwap] Retry ${attempt} balance re-check:`, {
                tokenIn: tokenInAddr,
                requiredAmount: requiredAmount.toString(),
                requiredAmountFormatted: (Number(requiredAmount) / 1e18).toFixed(6),
                tokenBalance: tokenBal.toString(),
                tokenBalanceFormatted: (Number(tokenBal) / 1e18).toFixed(6),
                difference: (tokenBal - requiredAmount).toString(),
                passes: tokenBal >= requiredAmount,
              });
              if (tokenBal < requiredAmount) {
                const need = (Number(requiredAmount) / 1e18).toFixed(4);
                const have = (Number(tokenBal) / 1e18).toFixed(4);
                console.warn(`[executeSwap] Retry ${attempt}: INSUFFICIENT: need ${need}, have ${have}`);
                setError(`Insufficient balance. Need ~${need} tokens, have ${have}`);
                setIsPending(false);
                return;
              }
            }

            // Only run full validation (allowance, router registration) on first attempt
            if (attempt === 0) {
              const validationError = await validateSwap(route);
              if (validationError) {
                setError(validationError);
                setIsPending(false);
                return;
              }
            }
          }

          // Capture current time for debug logging (used after buildSwapRequest)
          const currentTimeSeconds = Math.floor(Date.now() / 1000);

          // Build swap request (includes dynamic deadline)
          const request = buildSwapRequest(route, slippageBps, deadlineMinutes);

          // ─── Pool Freshness Check ────────────────────────────────────────────
          // Re-fetch reserves for each pool immediately before submission.
          // If price moved >2% since route was calculated, warn the user.
          // This prevents the "stale quote" race condition where pool reserves
          // changed between route calculation and tx mining.
          const freshness = await checkPoolFreshness(route, publicClient);
          
          if (!freshness.isFresh) {
            // Log price movement for monitoring
            console.warn(`[PoolFreshness] WARNING: Price moved ${(freshness.maxPriceImpact * 100).toFixed(2)}% since quote`, {
              routeId: route.id,
              maxPriceImpact: freshness.maxPriceImpact,
              worstStepIndex: freshness.worstStepIndex,
              worstStepDetails: freshness.worstStepDetails,
            });
            // Warning only — do NOT block the swap, just warn
            // The UI should show a toast via onFreshnessWarning callback
            if (onFreshnessWarning) {
              onFreshnessWarning(freshness);
            }
          } else {
            console.debug(`[PoolFreshness] Route is fresh (${(freshness.maxPriceImpact * 100).toFixed(4)}% max price impact)`);
          }

          // Track swap start after buildSwapRequest (Phase 8 monitoring)
          // Need minTotalAmountOut which is computed inside buildSwapRequest
          const minTotalAmountOut = request.minTotalAmountOut;
          attemptId = trackSwapStart({
            userAddress: address,
            tokenIn: tokenInAddr,
            tokenOut: tokenOutAddr,
            amountIn: route.totalAmountIn,
            amountOutMin: minTotalAmountOut,
            route,
          });

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
              trackSwapSuccess(attemptId, hash, Number(receipt.blockNumber), gasLimit.toString());
            } else {
              setIsConfirmed(false);
              trackSwapReverted(attemptId, hash, 'Transaction reverted on-chain', Number(receipt.blockNumber));
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

          // ─── Step 1.5: Fresh On-Chain Quote Validation ──────────────────
          // The pathFinder uses pool reserves fetched at page load time.
          // By the time the user confirms the swap, reserves may have changed
          // (other swaps, liquidity changes). This validation calls the DEX
          // router's getAmountsOut() to get a FRESH quote and adjusts
          // minTotalAmountOut if the pool's actual output differs significantly
          // from the pathFinder's prediction.
          //
          // This prevents swaps from failing with "execution reverted" when
          // the pathFinder's expected output is higher than what the pool can
          // actually deliver.
          try {
            const UNISWAP_V2_ROUTER_QUOTE_ABI = [
              {
                inputs: [
                  { name: 'amountIn', type: 'uint256' },
                  { name: 'path', type: 'address[]' },
                ],
                name: 'getAmountsOut',
                outputs: [{ name: 'amounts', type: 'uint256[]' }],
                stateMutability: 'view',
                type: 'function',
              },
            ] as const;

            // For single-step routes, validate the quote directly
            if (request.steps.length === 1) {
              const step = request.steps[0];
              const freshAmounts = await publicClient.readContract({
                address: step.router,
                abi: UNISWAP_V2_ROUTER_QUOTE_ABI,
                functionName: 'getAmountsOut',
                args: [request.amountIn, step.path],
              });
              const freshOutput = freshAmounts[freshAmounts.length - 1];

              console.log(`[useSwap] Fresh on-chain quote validation:`, {
                pathFinderExpected: route.totalExpectedOut.toString(),
                pathFinderExpectedFormatted: (Number(route.totalExpectedOut) / 1e18).toFixed(6),
                freshQuote: freshOutput.toString(),
                freshQuoteFormatted: (Number(freshOutput) / 1e18).toFixed(6),
                currentMinOut: request.minTotalAmountOut.toString(),
                ratio: route.totalExpectedOut > 0n
                  ? `${(Number(freshOutput * 10000n / route.totalExpectedOut) / 100).toFixed(2)}%`
                  : 'N/A',
              });

              // If the fresh quote is less than our minTotalAmountOut, the swap WILL fail.
              // Adjust minTotalAmountOut to be based on the fresh quote instead.
              if (freshOutput < request.minTotalAmountOut) {
                const discrepancy = route.totalExpectedOut > 0n
                  ? Number(route.totalExpectedOut - freshOutput) / Number(route.totalExpectedOut) * 100
                  : 100;

                console.warn(
                  `[useSwap] Fresh quote (${(Number(freshOutput) / 1e18).toFixed(4)}) is LOWER than minTotalAmountOut (${(Number(request.minTotalAmountOut) / 1e18).toFixed(4)}). ` +
                  `PathFinder was ${discrepancy.toFixed(1)}% too optimistic. Adjusting minTotalAmountOut.`
                );

                // Use the fresh quote with slippage applied
                const freshSlippageMultiplier = 10000n - BigInt(slippageBps);
                const adjustedMinOut = (freshOutput * freshSlippageMultiplier) / 10000n;

                // Safety: don't accept quotes below 0.1% of input value
                const minAcceptableOut = (request.amountIn * 1n) / 1000n;
                if (adjustedMinOut < minAcceptableOut) {
                  throw new Error(
                    `The pool's current output (${(Number(freshOutput) / 1e18).toFixed(4)}) is far below the expected amount. ` +
                    `The pool may have insufficient liquidity. Please try a smaller amount or a different route.`
                  );
                }

                // Update the request with the adjusted minTotalAmountOut
                (request as { minTotalAmountOut: bigint }).minTotalAmountOut = adjustedMinOut;

                // Also update the step's minAmountOut to match
                if (request.steps.length > 0) {
                  (request.steps[0] as { minAmountOut: bigint }).minAmountOut = adjustedMinOut;
                }

                console.log(`[useSwap] Adjusted minTotalAmountOut to: ${adjustedMinOut.toString()} (${(Number(adjustedMinOut) / 1e18).toFixed(4)})`);
              }
            }
          } catch (quoteErr) {
            const quoteErrMsg = quoteErr instanceof Error ? quoteErr.message : String(quoteErr);

            // Re-throw our own thrown errors (pool insufficient liquidity)
            if (quoteErrMsg.includes('far below the expected amount') || quoteErrMsg.includes('insufficient liquidity')) {
              throw quoteErr;
            }

            // If getAmountsOut itself reverted, this may be due to:
            // - Fee-on-transfer tokens that cause getAmountsOut to miscalculate
            // - Custom router implementations that don't support getAmountsOut for all pairs
            // - Transfer tax mechanics
            // The route was already computed by the pathFinder using pool reserves, so it may
            // still be valid. Log a warning and continue with the original parameters.
            // The on-chain swap will either succeed or fail with a clear revert reason.
            if (quoteErrMsg.includes('reverted') || quoteErrMsg.includes('revert')) {
              console.warn(`[useSwap] Fresh quote validation: getAmountsOut reverted — continuing with original route params. The route was computed from pool reserves and may still be valid.`, quoteErrMsg);
            }

            // For non-revert errors (network timeout, RPC issues), log and continue
            // since these may be transient and the swap might still succeed.
            console.warn(`[useSwap] Fresh quote validation failed (continuing with original params):`, quoteErrMsg);
          }

          // Step 2: Estimate gas with buffer for resilience
          const gasLimit = await estimateGasWithBuffer(request);

          // Step 3: Execute swap
          setIsPending(false);
          setIsConfirming(true);

          // DEBUG: Log deadline and transaction parameters immediately before contract call
          console.debug(`[useSwap] Submitting ERC20 swap with deadline:`, {
            deadline: request.deadline.toString(),
            deadlineHex: '0x' + request.deadline.toString(16),
            currentTimeSeconds,
            routeId: route.id,
          });
          console.log(`[executeSwap] Sending transaction:`, {
            amountIn: request.amountIn.toString(),
            amountInFormatted: (Number(request.amountIn) / 1e18).toFixed(6),
            minTotalAmountOut: request.minTotalAmountOut.toString(),
            steps: request.steps.length,
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
            trackSwapSuccess(attemptId, hash, Number(receipt.blockNumber), gasLimit.toString());
          } else {
            setIsConfirmed(false);
            trackSwapReverted(attemptId, hash, 'Transaction reverted on-chain', Number(receipt.blockNumber));
            setError(
              `Transaction reverted on-chain. The swap may have failed due to slippage or price movement.`,
            );
          }
          setIsConfirming(false);

          // Success or on-chain revert — do NOT retry
          return;
        } catch (err: unknown) {
          lastError = err instanceof Error ? err : new Error('Swap failed due to an unknown error.');

          // Track swap failure with decoded error info (Phase 8 monitoring)
          const { decodedName, selector } = parseSwapError(err);
          trackSwapFailure(
            attemptId,
            {
              code: isUserRejection(err) ? 'USER_REJECTED' : decodedName ?? 'EXECUTION_FAILED',
              message: err instanceof Error ? err.message : String(err),
              revertReason: selector ? `${decodedName ?? 'Unknown'} (${selector})` : undefined,
            },
            { routesConsidered: 0, selectedRouteId: route.id, selectedRouteSteps: route.steps, availableRoutes: [], priceImpact: route.priceImpact, outputAmount: route.totalExpectedOut.toString(), outputAmountFormatted: '', routingTimeMs: 0 }
          );

          // Don't retry user rejections or on-chain reverts
          if (isUserRejection(err)) {
            setError('Transaction rejected by user.');
            setIsPending(false);
            setIsConfirming(false);
            return;
          }

          // Check for ERC20InsufficientBalance — the aggregator contract ran out of
          // intermediate tokens during a multi-step swap. This is a contract-level issue
          // (e.g., fee-on-transfer token not handled correctly by the deployed version),
          // not a user-side approval problem.
          const errorStr = String(err);
          if (
            errorStr.includes('e450d38c') ||
            errorStr.includes('InsufficientBalance') ||
            errorStr.includes('INSUFFICIENT_BALANCE') ||
            errorStr.includes('erc20insufficientbalance')
          ) {
            console.warn(`[executeSwap] ERC20InsufficientBalance — aggregator intermediate balance issue`, {
              attempt,
              tokenIn: route.steps[0].path[0],
              amountIn: route.totalAmountIn.toString(),
              errorSnippet: errorStr.substring(0, 200),
            });

            // If allowance is insufficient, try re-approving before giving up
            try {
              const tokenIn = route.steps[0].path[0] as Address;
              const currentAllowance = await publicClient.readContract({
                address: tokenIn,
                abi: [{ name: 'allowance', type: 'function', stateMutability: 'view', inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] }] as const,
                functionName: 'allowance',
                args: [address as Address, OMNOMSWAP_AGGREGATOR_ADDRESS as Address],
              }) as bigint;

              if (currentAllowance < route.totalAmountIn) {
                await approve(tokenIn, route.totalAmountIn);
                console.log(`[executeSwap] Re-approval completed, retrying...`);
              } else {
                // Allowance is fine — the aggregator contract's intermediate balance is zero.
                // This happens when the deployed contract doesn't handle fee-on-transfer tokens.
                setError(
                  `Swap failed: the aggregator contract could not complete the swap. ` +
                  `This may be due to fee-on-transfer token handling. ` +
                  `Please try again or use a different route.`,
                );
                setIsPending(false);
                setIsConfirming(false);
                return;
              }
            } catch (approveErr) {
              console.error(`[executeSwap] Re-approval failed:`, approveErr);
            }
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

          // ─── Aggregator Fallback: Try Direct Router Swap ─────────────────
          // When the aggregator gas estimation fails with a contract revert
          // (e.g., fee-on-transfer tokens that don't work through the aggregator),
          // fall back to a direct DEX router swap. This bypasses the aggregator
          // entirely, avoiding the double-tax issue and contract interaction problems.
          const fallbackErrorStr = String(err);
          const isContractRevert =
            fallbackErrorStr.toLowerCase().includes('revert') ||
            fallbackErrorStr.toLowerCase().includes('execution reverted');

          if (isContractRevert && route.steps.length === 1) {
            console.warn('[useSwap] Aggregator swap reverted — falling back to direct router swap');
            try {
              const step = route.steps[0];
              const currentTimeSeconds = Math.floor(Date.now() / 1000);
              const fallbackDeadline = BigInt(currentTimeSeconds + (deadlineMinutes || 5) * 60);
              const slippageMultiplier = 10000n - BigInt(slippageBps);
              const fallbackMinAmountOut = (route.totalExpectedOut * slippageMultiplier) / 10000n;

              const directParams: DirectRouterSwapParams = {
                tokenIn: step.path[0] as Address,
                tokenOut: step.path[step.path.length - 1] as Address,
                amountIn: route.totalAmountIn,
                minAmountOut: fallbackMinAmountOut,
                router: step.dexRouter as Address,
                recipient: address!,
                deadline: fallbackDeadline,
                path: step.path as Address[],
              };

              setSwapMode('direct');
              setIsPending(false);

              const directResult = await directSwap.executeDirectSwap(directParams);

              if (directResult.success) {
                setIsConfirmed(true);
                setTxHash(directResult.txHash);
                setIsConfirming(false);
                console.log('[useSwap] Direct router swap succeeded (fallback)');
                return;
              } else {
                console.warn('[useSwap] Direct router swap also failed:', directResult.error);
                // Both aggregator and direct router failed — token has transfer restrictions
                const tokenRestrictionMsg =
                  `This token cannot be swapped. ` +
                  `Both the aggregator and direct DEX router paths failed, which indicates ` +
                  `the token has transfer restrictions (e.g., anti-contract mechanics, whitelist-only trading, ` +
                  `or blocked transferFrom) that prevent DEX swaps entirely. ` +
                  `Please contact the token team to whitelist the DEX contracts, or try swapping on the token's official platform.`;
                setError(tokenRestrictionMsg);
                setIsPending(false);
                setIsConfirming(false);
                trackSwapFailure(attemptId, {
                  code: 'TOKEN_TRANSFER_RESTRICTED',
                  message: tokenRestrictionMsg,
                  revertReason: 'transferFrom blocked by token contract',
                }, { routesConsidered: 0, selectedRouteId: route.id, selectedRouteSteps: route.steps, availableRoutes: [], priceImpact: route.priceImpact, outputAmount: route.totalExpectedOut.toString(), outputAmountFormatted: '', routingTimeMs: 0 });
                return;
              }
            } catch (fallbackErr) {
              console.warn('[useSwap] Direct router swap fallback error:', fallbackErr);
              // Both paths failed — token has transfer restrictions
              const tokenRestrictionMsg =
                `This token cannot be swapped. ` +
                `Both the aggregator and direct DEX router paths failed, which indicates ` +
                `the token has transfer restrictions that prevent DEX swaps entirely. ` +
                `Please contact the token team to whitelist the DEX contracts, or try swapping on the token's official platform.`;
              setError(tokenRestrictionMsg);
              setIsPending(false);
              setIsConfirming(false);
              return;
            }
          }

          // Non-retriable error or exhausted retries — classify and set error
          // Use enhanced error decoding for better debugging info
          const routeContext = {
            dexRouter: route.steps[0]?.dexRouter,
            stepIndex: 0,
          };
          const decodedErrorMsg = formatSwapErrorMessage(err, routeContext);
          console.error('[useSwap] Non-retriable error:', {
            decodedErrorMsg,
            originalError: err instanceof Error ? err.message : String(err),
            routeId: route.id,
            routeContext,
          });

          setError(decodedErrorMsg);
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
    [address, publicClient, writeContractAsync, approve, buildSwapRequest, wrapDogeIfNeeded, estimateGasWithBuffer, validateSwap, directSwap],
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
    isPending: isPending || directSwap.isPending,
    isConfirming: isConfirming || directSwap.isConfirming,
    isConfirmed: isConfirmed || directSwap.isConfirmed,
    txHash: txHash ?? directSwap.txHash,
    error: error ?? directSwap.error,
    swapMode,
  };
}
