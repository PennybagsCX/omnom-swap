/**
 * useDynamicSlippage — TVL-based dynamic slippage calculation hook.
 *
 * Implements automatic slippage adjustment based on pool liquidity:
 *   - Liquid pools (> $50,000 TVL): 0.5% slippage (current default)
 *   - Medium pools ($10,000 - $50,000 TVL): 1.0% slippage
 *   - Low liquidity pools ($1,000 - $10,000 TVL): 3.0% slippage
 *   - Very low pools (< $1,000 TVL): 5.0% slippage (max reasonable)
 *
 * This ensures users aren't stuck with 0.01% slippage on thin order books.
 * The failed transaction 0xfce6348de797d179c8c209f569a2a649eec926a8cd60b74a2e48afa1676ebed2
 * had DC→MCRIB path with 0.01% slippage — way too low for the thin pool.
 *
 * Phase 6: Routing Strategy Defaults
 */

import { useMemo } from 'react';
import type { PoolReserves } from '../services/pathFinder/types';
import { SLIPPAGE_TIERS, TVL_ILLIQUID_THRESHOLD } from '../services/pathFinder/types';
import { getTokenDecimals } from '../lib/constants';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface DynamicSlippageResult {
  /** The recommended slippage percentage as a string (e.g., "1.00") */
  recommendedSlippage: string;
  /** The recommended slippage in basis points (e.g., 100n) */
  recommendedSlippageBps: bigint;
  /** TVL tier name for display */
  tvlTier: 'liquid' | 'medium' | 'low' | 'very_low';
  /** TVL tier description */
  tvlTierDescription: string;
  /** Estimated TVL of the pool/pair */
  estimatedTVL: number;
  /** Whether the TVL was estimated or calculated */
  isEstimated: boolean;
  /** Warning message if slippage is high */
  warningMessage: string | null;
}

// ─── TVL Estimation ───────────────────────────────────────────────────────────

/**
 * Normalize a reserve value from its actual decimal representation to 18-decimal equivalent.
 * For tokens with < 18 decimals (like MCRIB with 15), we divide by 10^(18-decimals).
 * For tokens with > 18 decimals, we would multiply.
 */
function normalizeReserveTo18Decimals(rawReserve: bigint, decimals: number): number {
  const exponent = 18 - decimals;
  if (exponent >= 0) {
    return Number(rawReserve) / Math.pow(10, exponent);
  } else {
    return Number(rawReserve) * Math.pow(10, -exponent);
  }
}

/**
 * Estimate TVL for a pool using the geometric mean of reserves.
 * This is a simplified calculation assuming $1 per WWDOGE-equivalent token
 * for WWDOGE-based pairs.
 * 
 * IMPORTANT: Now properly normalizes for token decimals.
 * Previously, MCRIB (15 decimals) was treated as 18 decimals, causing 1000x TVL inflation.
 */
export function estimatePoolTVL(pool: PoolReserves, wwdogePrice: number = 1.0): number {
  const r0 = Number(pool.reserve0);
  const r1 = Number(pool.reserve1);
  if (r0 <= 0 || r1 <= 0) return 0;
  
  // Get actual decimals for each token and normalize
  const decimals0 = getTokenDecimals(pool.token0);
  const decimals1 = getTokenDecimals(pool.token1);
  
  const r0Normalized = normalizeReserveTo18Decimals(pool.reserve0, decimals0);
  const r1Normalized = normalizeReserveTo18Decimals(pool.reserve1, decimals1);
  
  const tvl = 2 * Math.sqrt(r0Normalized * r1Normalized) * wwdogePrice;
  return tvl;
}

/**
 * Calculate total TVL for direct pair across all pools.
 */
export function calculateDirectPairTVL(
  tokenIn: string,
  tokenOut: string,
  pools: PoolReserves[],
): number {
  const normalizedIn = tokenIn.toLowerCase();
  const normalizedOut = tokenOut.toLowerCase();

  const directPools = pools.filter(p => {
    const t0 = p.token0.toLowerCase();
    const t1 = p.token1.toLowerCase();
    return (t0 === normalizedIn && t1 === normalizedOut) || (t0 === normalizedOut && t1 === normalizedIn);
  });

  let totalTVL = 0;
  for (const pool of directPools) {
    totalTVL += estimatePoolTVL(pool);
  }

  return totalTVL;
}

/**
 * Get the slippage tier based on TVL.
 */
export function getSlippageTier(tvl: number): {
  tier: 'liquid' | 'medium' | 'low' | 'very_low';
  slippage: number;
  description: string;
} {
  if (tvl >= SLIPPAGE_TIERS.LIQUID.minTvl) {
    return { tier: 'liquid', slippage: SLIPPAGE_TIERS.LIQUID.slippage, description: `Liquid pool (>$${SLIPPAGE_TIERS.LIQUID.minTvl.toLocaleString()} TVL)` };
  }
  if (tvl >= SLIPPAGE_TIERS.MEDIUM.minTvl) {
    return { tier: 'medium', slippage: SLIPPAGE_TIERS.MEDIUM.slippage, description: `Medium pool ($${SLIPPAGE_TIERS.MEDIUM.minTvl.toLocaleString()} - $${(SLIPPAGE_TIERS.LIQUID.minTvl - 1).toLocaleString()} TVL)` };
  }
  if (tvl >= SLIPPAGE_TIERS.LOW.minTvl) {
    return { tier: 'low', slippage: SLIPPAGE_TIERS.LOW.slippage, description: `Low liquidity pool ($${SLIPPAGE_TIERS.LOW.minTvl.toLocaleString()} - $${(SLIPPAGE_TIERS.MEDIUM.minTvl - 1).toLocaleString()} TVL)` };
  }
  return { tier: 'very_low', slippage: SLIPPAGE_TIERS.VERY_LOW.slippage, description: `Very low liquidity pool (<$${SLIPPAGE_TIERS.LOW.minTvl.toLocaleString()} TVL)` };
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Calculate dynamic slippage based on pool TVL.
 *
 * This hook analyzes the liquidity of the direct pair and recommends
 * an appropriate slippage tolerance to avoid transaction reverts.
 *
 * @param tokenInAddress - Input token address
 * @param tokenOutAddress - Output token address
 * @param pools - Array of pool reserves for the pair
 * @param manualSlippage - User's manual slippage setting (if they disabled auto)
 */
export function useDynamicSlippage(
  tokenInAddress: string | undefined,
  tokenOutAddress: string | undefined,
  pools: PoolReserves[],
): DynamicSlippageResult {
  return useMemo(() => {
    if (!tokenInAddress || !tokenOutAddress || pools.length === 0) {
      return {
        recommendedSlippage: '0.50',
        recommendedSlippageBps: 50n,
        tvlTier: 'liquid' as const,
        tvlTierDescription: 'Unable to determine TVL',
        estimatedTVL: 0,
        isEstimated: false,
        warningMessage: null,
      };
    }

    const totalTVL = calculateDirectPairTVL(tokenInAddress, tokenOutAddress, pools);
    const { tier, slippage, description } = getSlippageTier(totalTVL);

    // Slippage validation with bounds checking
    const MIN_SLIPPAGE = 0.01; // 0.01%
    const MAX_SLIPPAGE = 49.99; // 50%

    let validatedSlippage = Math.max(MIN_SLIPPAGE, Math.min(MAX_SLIPPAGE, slippage));
    let warningMessage: string | null = null;
    const slippageAdjusted = validatedSlippage !== slippage;

    // Force minimum slippage for very low TVL pools
    if (totalTVL < 1000) {
      const forcedSlippage = Math.max(validatedSlippage, 10); // Force 10% min for very low TVL
      if (forcedSlippage !== validatedSlippage) {
        warningMessage = `CRITICAL: Extremely low liquidity ($${totalTVL.toFixed(2)} TVL). 10% minimum slippage enforced for safety.`;
        validatedSlippage = forcedSlippage;
      }
    } else if (tier === 'very_low') {
      warningMessage = `Very low liquidity detected ($${totalTVL.toFixed(2)} TVL). We recommend ${validatedSlippage}% slippage to avoid transaction revert.`;
    } else if (tier === 'low') {
      warningMessage = `Low liquidity detected ($${totalTVL.toFixed(2)} TVL). Consider using ${validatedSlippage}% slippage for better execution.`;
    } else if (totalTVL < TVL_ILLIQUID_THRESHOLD) {
      warningMessage = `Pair liquidity ($${totalTVL.toFixed(2)}) is below recommended minimum ($${TVL_ILLIQUID_THRESHOLD.toLocaleString()}). Multi-hop routing may be preferable.`;
    }

    if (slippageAdjusted && !warningMessage?.includes('CRITICAL')) {
      const originalMsg = warningMessage || '';
      warningMessage = `Slippage adjusted from ${slippage.toFixed(2)}% to ${validatedSlippage.toFixed(2)}% for safety.${originalMsg ? ' ' + originalMsg : ''}`;
    }

    return {
      recommendedSlippage: validatedSlippage.toFixed(2),
      recommendedSlippageBps: BigInt(Math.round(validatedSlippage * 100)),
      tvlTier: tier,
      tvlTierDescription: description,
      estimatedTVL: totalTVL,
      isEstimated: true,
      warningMessage,
    };
  }, [tokenInAddress, tokenOutAddress, pools]);
}