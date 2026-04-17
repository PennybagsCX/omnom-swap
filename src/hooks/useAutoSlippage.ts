/**
 * useAutoSlippage — intelligent auto-slippage calculation hook.
 *
 * Computes optimal slippage tolerance dynamically based on trade parameters:
 *   Base: 0.5%
 *   + Price impact buffer: priceImpact * 0.5
 *   + Multi-hop buffer: (hopCount - 1) * 0.3%
 *   + Thin pair buffer: 1.5% if isThinPair
 *   + Variance buffer: tradeSizeVsLiquidity * 2.0%
 *   = Total (clamped between 0.5% and 50%)
 *
 * Used by both Direct Swap (SwapScreen) and Aggregated Swap (AggregatorSwap).
 */

import { useState, useMemo } from 'react';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AutoSlippageBreakdown {
  base: number;
  priceImpactBuffer: number;
  hopBuffer: number;
  thinPairBuffer: number;
  varianceBuffer: number;
  total: number;
}

export interface AutoSlippageResult {
  /** Auto-computed slippage as a percentage string (e.g., "1.23") */
  autoSlippage: string;
  /** Auto-computed slippage in basis points (e.g., 123n) */
  slippageBps: bigint;
  /** Breakdown of the auto-slippage calculation components */
  breakdown: AutoSlippageBreakdown;
  /** Whether auto mode is currently active */
  isAuto: boolean;
  /** Toggle auto mode on/off */
  setAuto: (auto: boolean) => void;
  /** The effective slippage percentage string (auto value if isAuto, else manual) */
  effectiveSlippage: string;
  /** The effective slippage in basis points (auto bps if isAuto, else manual bps) */
  effectiveBps: bigint;
  /** Warning level: 'none' | 'warning' (>5%) | 'danger' (>15%) */
  warningLevel: 'none' | 'warning' | 'danger';
}

// ─── Constants ────────────────────────────────────────────────────────────────

const BASE_SLIPPAGE = 0.5;          // 0.5% minimum safety buffer
const PRICE_IMPACT_FACTOR = 0.5;    // multiplier on price impact percentage
const HOP_BUFFER = 0.3;             // 0.3% per additional hop
const THIN_PAIR_BUFFER = 1.5;       // 1.5% for thin pairs
const VARIANCE_FACTOR = 2.0;        // multiplier on tradeSizeVsLiquidity ratio
const MIN_SLIPPAGE = 0.5;           // never go below 0.5%
const MAX_SLIPPAGE = 50;            // never exceed 50%
const WARNING_THRESHOLD = 5;        // orange warning at 5%
const DANGER_THRESHOLD = 15;        // red danger at 15%

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Compute auto-slippage based on trade parameters.
 *
 * @param priceImpact        Price impact as a fraction (0–1), e.g. 0.02 = 2%
 * @param hopCount           Number of hops in the route (1 = direct)
 * @param tradeSizeVsLiquidity  Ratio of trade amount to pool reserve (0–1)
 * @param isThinPair         Whether the route passes through a low-liquidity intermediate
 * @param manualSlippage     User's manual slippage percentage string (e.g., "0.5")
 */
export function useAutoSlippage(
  priceImpact: number,
  hopCount: number,
  tradeSizeVsLiquidity: number,
  isThinPair: boolean,
  manualSlippage: string,
): AutoSlippageResult {
  const [isAuto, setAuto] = useState(true);

  const breakdown = useMemo<AutoSlippageBreakdown>(() => {
    // Convert priceImpact from fraction (0–1) to percentage (0–100) for the buffer
    const impactPct = Math.abs(priceImpact) * 100;

    const base = BASE_SLIPPAGE;
    const priceImpactBuffer = impactPct * PRICE_IMPACT_FACTOR;
    const hopBuffer = Math.max(0, hopCount - 1) * HOP_BUFFER;
    const thinPairBuffer = isThinPair ? THIN_PAIR_BUFFER : 0;
    const varianceBuffer = Math.min(Math.max(0, tradeSizeVsLiquidity), 1) * VARIANCE_FACTOR;

    const raw = base + priceImpactBuffer + hopBuffer + thinPairBuffer + varianceBuffer;
    const total = Math.round(Math.min(Math.max(raw, MIN_SLIPPAGE), MAX_SLIPPAGE) * 100) / 100;

    return {
      base,
      priceImpactBuffer: Math.round(priceImpactBuffer * 100) / 100,
      hopBuffer: Math.round(hopBuffer * 100) / 100,
      thinPairBuffer: Math.round(thinPairBuffer * 100) / 100,
      varianceBuffer: Math.round(varianceBuffer * 100) / 100,
      total,
    };
  }, [priceImpact, hopCount, tradeSizeVsLiquidity, isThinPair]);

  const autoSlippage = breakdown.total.toFixed(2);
  const slippageBps = BigInt(Math.round(breakdown.total * 100));

  // Manual slippage parsing (same logic as the original components)
  const manualBps = BigInt(Math.round((parseFloat(manualSlippage) || 0) * 100));

  const effectiveSlippage = isAuto ? autoSlippage : manualSlippage;
  const effectiveBps = isAuto ? slippageBps : manualBps;

  // Warning level based on effective slippage
  const effectiveValue = parseFloat(effectiveSlippage) || 0;
  const warningLevel: 'none' | 'warning' | 'danger' =
    effectiveValue > DANGER_THRESHOLD
      ? 'danger'
      : effectiveValue > WARNING_THRESHOLD
        ? 'warning'
        : 'none';

  return {
    autoSlippage,
    slippageBps,
    breakdown,
    isAuto,
    setAuto,
    effectiveSlippage,
    effectiveBps,
    warningLevel,
  };
}
