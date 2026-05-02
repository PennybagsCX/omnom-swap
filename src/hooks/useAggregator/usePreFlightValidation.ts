/**
 * usePreFlightValidation — pre-flight test swap hook for swap resilience.
 *
 * Before executing a full swap, executes a small test swap (10% of intended amount)
 * to validate that the route will succeed on-chain. This catches issues like:
 *   - Pool existence (pair might not exist on all DEXs)
 *   - Insufficient liquidity for the full amount
 *   - Router compatibility (router might not support the token pair)
 *   - On-chain reverts (slippage, deadline, etc.)
 *
 * This is similar to "sweep" testing used by professional traders.
 *
 * Phase 6: Routing Strategy Defaults
 */

import { useState, useCallback, useRef } from 'react';
import { formatUnits } from 'viem';
import { usePublicClient, useAccount } from 'wagmi';
import { useWriteContract } from 'wagmi';
import { OMNOMSWAP_AGGREGATOR_ADDRESS, OMNOMSWAP_AGGREGATOR_ABI, getTokenDecimals } from '../../lib/constants';
import type { RouteResult } from '../../services/pathFinder/types';

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * Test swap amount as a fraction of the intended full amount.
 * 10% test swap is the industry standard for pre-flight validation.
 */
const TEST_SWAP_FRACTION = 0.1; // 10%

/**
 * How long to cache validation results (ms).
 * 30 seconds is short enough to catch real changes but long enough to avoid
 * excessive test swaps during rapid user input.
 */
const VALIDATION_CACHE_TTL_MS = 30_000;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ValidationResult {
  success: boolean;
  testAmountIn: string;
  testExpectedOut: string;
  testActualOut: string | null;
  testTxHash: `0x${string}` | null;
  errorMessage: string | null;
  timestamp: number;
  routeId: string;
  recommendedSlippage: string;
}

export interface PreFlightValidationResult {
  /** Whether validation has been performed for the current route/amount */
  isValidated: boolean;
  /** Whether the last validation passed */
  isValid: boolean;
  /** Whether validation is currently running */
  isValidating: boolean;
  /** The cached validation result */
  validationResult: ValidationResult | null;
  /** Run pre-flight validation for the given route */
  runValidation: (route: RouteResult, slippageBps: number) => Promise<ValidationResult | null>;
  /** Clear cached validation (call when amount/route changes) */
  clearValidation: () => void;
  /** Whether to skip pre-flight validation (user preference) */
  skipValidation: boolean;
  /** Set skip validation preference */
  setSkipValidation: (skip: boolean) => void;
}

// ─── Cache Management ─────────────────────────────────────────────────────────

interface CachedValidation {
  routeId: string;
  amountIn: string;
  result: ValidationResult;
}

const VALIDATION_STORAGE_KEY = 'omnom_preflight_validation';

function getCachedValidation(routeId: string, amountIn: string): CachedValidation | null {
  try {
    const raw = localStorage.getItem(VALIDATION_STORAGE_KEY);
    if (!raw) return null;
    const cached: CachedValidation = JSON.parse(raw);
    // Check if cache is still valid (not expired)
    if (Date.now() - cached.result.timestamp > VALIDATION_CACHE_TTL_MS) {
      return null;
    }
    // Check if route/amount matches
    if (cached.routeId !== routeId || cached.amountIn !== amountIn) {
      return null;
    }
    return cached;
  } catch {
    return null;
  }
}

function storeValidation(routeId: string, amountIn: string, result: ValidationResult): void {
  try {
    const cached: CachedValidation = { routeId, amountIn, result };
    localStorage.setItem(VALIDATION_STORAGE_KEY, JSON.stringify(cached));
  } catch {
    // Ignore storage errors (quota exceeded, private browsing, etc.)
  }
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function usePreFlightValidation(): PreFlightValidationResult {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();

  const [isValidating, setIsValidating] = useState(false);
  const [validationResult, setValidationResult] = useState<ValidationResult | null>(null);
  const [skipValidation, setSkipValidation] = useState(false);

  // Track current route/amount for cache invalidation
  const currentRouteIdRef = useRef<string | null>(null);
  const currentAmountRef = useRef<string | null>(null);

  /**
   * Run a test swap (10% of full amount) to validate the route.
   *
   * This function:
   * 1. Creates a test route with 10% of the input amount
   * 2. Executes the test swap with a short deadline (2 minutes)
   * 3. On success: caches result and proceeds with full swap
   * 4. On failure: caches result and shows warning with alternatives
   */
  const runValidation = useCallback(async (
    route: RouteResult,
    slippageBps: number,
  ): Promise<ValidationResult | null> => {
    if (!address || !publicClient) {
      console.warn('[usePreFlightValidation] Cannot validate: wallet not connected');
      return null;
    }

    if (skipValidation) {
      console.log('[usePreFlightValidation] Skipping validation (user preference)');
      return null;
    }

    const amountIn = route.totalAmountIn.toString();
    const tokenIn = route.steps[0].path[0];
    const tokenOut = route.steps[route.steps.length - 1].path[route.steps[route.steps.length - 1].path.length - 1];

    // Check cache first
    const cached = getCachedValidation(route.id, amountIn);
    if (cached) {
      console.log('[usePreFlightValidation] Using cached validation result');
      setValidationResult(cached.result);
      return cached.result;
    }

    setIsValidating(true);
    currentRouteIdRef.current = route.id;
    currentAmountRef.current = amountIn;

    try {
      // Calculate test amount (10% of full amount)
      const testAmountIn = (route.totalAmountIn * BigInt(Math.round(TEST_SWAP_FRACTION * 10000))) / 10000n;

      if (testAmountIn === 0n) {
        console.warn('[usePreFlightValidation] Test amount is 0, skipping validation');
        const result: ValidationResult = {
          success: true,
          testAmountIn: '0',
          testExpectedOut: '0',
          testActualOut: null,
          testTxHash: null,
          errorMessage: null,
          timestamp: Date.now(),
          routeId: route.id,
          recommendedSlippage: '0.5',
        };
        setValidationResult(result);
        setIsValidating(false);
        return result;
      }

      // Get token decimals for formatting
      const inDecimals = getTokenDecimals(tokenIn);
      const outDecimals = getTokenDecimals(tokenOut);

      console.log('[usePreFlightValidation] Running test swap:', {
        fullAmount: formatUnits(route.totalAmountIn, inDecimals),
        testAmount: formatUnits(testAmountIn, inDecimals),
        routeId: route.id,
        routeType: route.routeType,
        intermediateToken: route.intermediateToken,
      });

      // Create a test route with the reduced amount
      // Recalculate expected output for test amount (proportional)
      const testExpectedOut = (route.totalExpectedOut * testAmountIn) / route.totalAmountIn;

      // Build the test swap request
      const slippageMultiplier = 10000n - BigInt(slippageBps);
      const testMinTotalOut = (testExpectedOut * slippageMultiplier) / 10000n;
      const currentTimeSeconds = Math.floor(Date.now() / 1000);
      const testDeadline = BigInt(currentTimeSeconds + 2 * 60); // 2 minute deadline for test

      // Build per-step amounts
      const stepMinAmounts: bigint[] = route.steps.map((step) => {
        return (step.expectedAmountOut * slippageMultiplier) / 10000n;
      });

      const steps = route.steps.map((step, i) => {
        let stepAmountIn: bigint;
        let stepMinOut: bigint;

        if (i === 0) {
          const feeAmount = (testAmountIn * BigInt(route.feeBps)) / 10000n;
          stepAmountIn = testAmountIn - feeAmount;
          stepMinOut = stepMinAmounts[0];
        } else {
          stepAmountIn = stepMinAmounts[i - 1];
          stepMinOut = i < route.steps.length - 1
            ? BigInt('1000000000000') // MIN_INTERMEDIATE_OUT
            : stepMinAmounts[i];
        }

        return {
          router: step.dexRouter as `0x${string}`,
          path: step.path as `0x${string}`[],
          amountIn: stepAmountIn,
          minAmountOut: stepMinOut,
        };
      });

      const request = {
        tokenIn: tokenIn as `0x${string}`,
        tokenOut: tokenOut as `0x${string}`,
        amountIn: testAmountIn,
        minTotalAmountOut: testMinTotalOut,
        steps,
        deadline: testDeadline,
        recipient: address,
      };

      // Execute the test swap
      let testTxHash: `0x${string}` | null = null;
      let success = false;
      let errorMessage: string | null = null;

      try {
        const hash = await writeContractAsync({
          address: OMNOMSWAP_AGGREGATOR_ADDRESS,
          abi: OMNOMSWAP_AGGREGATOR_ABI,
          functionName: 'executeSwap',
          args: [request],
        });

        testTxHash = hash as `0x${string}`;

        // Wait for receipt with a reasonable timeout
        const receipt = await publicClient.waitForTransactionReceipt({
          hash: testTxHash,
          timeout: 45_000, // 45 seconds for test swap
        });

        if (receipt.status === 'success') {
          success = true;
          console.log('[usePreFlightValidation] Test swap succeeded:', testTxHash);
        } else {
          errorMessage = 'Test swap reverted on-chain. The route may be invalid or pools have changed since the quote.';
        }
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        console.error('[usePreFlightValidation] Test swap failed:', error);
        errorMessage = `Test swap execution failed: ${error}`;

        // Provide more helpful error messages based on common failure modes
        if (error.includes('ds-token-insufficient-balance') || error.includes('insufficient balance')) {
          errorMessage = 'Insufficient token balance for the test swap. Check your wallet balance.';
        } else if (error.includes('transfer amount exceeds balance')) {
          errorMessage = 'Token transfer failed mid-swap. The route may have a compatibility issue.';
        } else if (error.toLowerCase().includes('revert')) {
          errorMessage = 'The route was rejected by the blockchain. The pair may not exist on one of the DEXs.';
        } else if (error.toLowerCase().includes('deadline')) {
          errorMessage = 'Transaction deadline exceeded. The swap took too long to execute.';
        }
      }

      // Determine recommended slippage based on result
      let recommendedSlippage = '0.5';
      if (!success) {
        if (route.routeType === 'multi_hop' || (route.priceImpact && route.priceImpact > 0.05)) {
          recommendedSlippage = '3.0';
        } else {
          recommendedSlippage = '1.0';
        }
      }

      const result: ValidationResult = {
        success,
        testAmountIn: formatUnits(testAmountIn, inDecimals),
        testExpectedOut: formatUnits(testExpectedOut, outDecimals),
        testActualOut: null, // Would need to parse events to get actual output
        testTxHash,
        errorMessage,
        timestamp: Date.now(),
        routeId: route.id,
        recommendedSlippage,
      };

      // Cache the result
      storeValidation(route.id, amountIn, result);
      setValidationResult(result);
      setIsValidating(false);

      return result;
    } catch (err) {
      console.error('[usePreFlightValidation] Validation error:', err);
      const result: ValidationResult = {
        success: false,
        testAmountIn: '0',
        testExpectedOut: '0',
        testActualOut: null,
        testTxHash: null,
        errorMessage: err instanceof Error ? err.message : 'Validation failed',
        timestamp: Date.now(),
        routeId: route.id,
        recommendedSlippage: '5.0', // Max reasonable on failure
      };
      setValidationResult(result);
      setIsValidating(false);
      return result;
    }
  }, [address, publicClient, skipValidation, writeContractAsync]);

  /**
   * Clear the validation cache and result.
   * Call this when the user changes the input amount or route selection.
   */
  const clearValidation = useCallback(() => {
    setValidationResult(null);
    currentRouteIdRef.current = null;
    currentAmountRef.current = null;
    try {
      localStorage.removeItem(VALIDATION_STORAGE_KEY);
    } catch {
      // Ignore
    }
  }, []);

  return {
    isValidated: validationResult !== null,
    isValid: validationResult?.success ?? false,
    isValidating,
    validationResult,
    runValidation,
    clearValidation,
    skipValidation,
    setSkipValidation,
  };
}