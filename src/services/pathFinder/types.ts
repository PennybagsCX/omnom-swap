/**
 * Path Finder Service — Type definitions for the OmnomSwap DEX aggregator.
 *
 * These types model the liquidity graph, pool reserves, swap routes,
 * and the results produced by the off-chain path-finding engine.
 */

// ─── Token ────────────────────────────────────────────────────────────────────

export interface TokenInfo {
  address: string;
  symbol: string;
  decimals: number;
  logoURI?: string;
}

// ─── Pool / Liquidity ─────────────────────────────────────────────────────────

/**
 * Directed edge in the liquidity graph (represents one direction of a pool).
 */
export interface PoolEdge {
  tokenIn: string;
  tokenOut: string;
  reserveIn: bigint;
  reserveOut: bigint;
  factory: string;
  dexName: string;
  router: string;
}

/**
 * Extended PoolReserves with liquidity metadata.
 * Phase 7: Now includes TVL and tier information for all pools.
 */
export interface PoolReserves {
  reserve0: bigint;
  reserve1: bigint;
  token0: string;
  token1: string;
  factory: string;
  dexName: string;
  router: string;
  /** Unix timestamp (ms) when reserves were last fetched from on-chain. */
  lastFetched?: number;
  /** Estimated TVL in USD (geometric mean of reserves × WWDOGE price). */
  tvlUsd?: number;
  /** Liquidity tier classification. */
  liquidityTier?: LiquidityTier;
}

// ─── Route ────────────────────────────────────────────────────────────────────

export interface RouteStep {
  dexRouter: string;
  dexName: string;
  path: string[]; // token addresses for this hop
  amountIn: bigint;
  expectedAmountOut: bigint;
}

/**
 * Extended RouteResult with liquidity analysis for UI display.
 * Phase 7: Now includes routeAnalysis for advisor mode.
 */
export interface RouteResult {
  /** Stable identifier derived from route steps (hash of dex routers + paths). */
  id: string;
  steps: RouteStep[];
  totalAmountIn: bigint;
  totalExpectedOut: bigint;
  priceImpact: number;
  feeAmount: bigint;
  feeBps: number;
  /** Human-readable routing description e.g. "Direct", "Via WWDOGE", "Via OMNOM" */
  routeType?: 'direct' | 'multi_hop';
  /** Intermediate token for multi-hop routes (if applicable) */
  intermediateToken?: string;
  /** Analysis data for UI display */
  routeAnalysis?: {
    isSuboptimal: boolean;
    suboptimalReason?: string;
    directRouteAvailable: boolean;
    directRouteTvlUsd: number;
    directRouteOutput?: bigint;
    multiHopOutput?: bigint;
    savingsPercent?: number;
  };
}

// ─── DEX Registry ─────────────────────────────────────────────────────────────

export interface DexInfo {
  name: string;
  router: string;
  factory: string;
}

// ─── Swap Request (mirrors on-chain struct) ───────────────────────────────────

export interface SwapStepRequest {
  router: `0x${string}`;
  path: `0x${string}`[];
  amountIn: bigint;
  minAmountOut: bigint;
}

export interface SwapRequest {
  tokenIn: `0x${string}`;
  tokenOut: `0x${string}`;
  amountIn: bigint;
  minTotalAmountOut: bigint;
  steps: SwapStepRequest[];
  deadline: bigint;
  recipient: `0x${string}`;
}

// ─── Pathfinding Configuration ────────────────────────────────────────────────

/** Maximum staleness of pool reserves before they must be re-fetched (ms). Default: 30 seconds. */
export const MAX_RESERVE_STALENESS_MS = 30_000;

/**
 * Minimum total value locked (USD) for a pool to be considered viable.
 * Phase 7: Deprecated — now only used for slippage tier calculation.
 * Low-liquidity pools are NO LONGER filtered from the routing graph.
 */
export const MIN_LIQUIDITY_USD = 1_000;

// ─── Phase 6: TVL-based Routing Thresholds ──────────────────────────────────────

/**
 * TVL thresholds for dynamic slippage adjustment and multi-hop routing.
 * These thresholds determine when the system should auto-prefer multi-hop routes.
 */

/** Price impact threshold (>3%) triggers multi-hop routing suggestion. */
export const MULTI_HOP_PRICE_IMPACT_THRESHOLD = 0.03;

/** TVL threshold below which direct routes are considered illiquid ($5,000). */
export const TVL_ILLIQUID_THRESHOLD = 5_000;

/**
 * Slippage tiers based on pool TVL.
 * Used by useDynamicSlippage to recommend appropriate slippage.
 */
export const SLIPPAGE_TIERS = {
  /** Liquid pools (> $50,000 TVL): 0.5% slippage */
  LIQUID: { minTvl: 50_000, slippage: 0.5 },
  /** Medium pools ($10,000 - $50,000 TVL): 1.0% slippage */
  MEDIUM: { minTvl: 10_000, slippage: 1.0 },
  /** Low liquidity pools ($1,000 - $10,000 TVL): 3.0% slippage */
  LOW: { minTvl: 1_000, slippage: 3.0 },
  /** Very low pools (< $1,000 TVL): 5.0% slippage (max reasonable) */
  VERY_LOW: { minTvl: 0, slippage: 5.0 },
} as const;

/** WWDOGE intermediate token address for Dogechain multi-hop routing. */
export const WWDOGE_INTERMEDIATE = '0x2458FE634F19be3C89b54AB719A2C5B7A383B4C0';

// ─── Hub Token Configuration ──────────────────────────────────────────────────

/**
 * Hub token addresses (lowercase) used as intermediary hops for multi-hop routing.
 * These are high-liquidity tokens that most other tokens have pools against.
 *
 * WWDOGE — wrapped native token, highest liquidity on Dogechain
 * DC     — native platform token
 * OMNOM  — platform governance/utility token
 *
 * Addresses sourced from CONTRACTS in src/lib/constants.ts.
 */
export const HUB_TOKEN_ADDRESSES: readonly string[] = [
  '0xb7ddc6414bf4f5515b52d8bdd69973ae205ff101', // WWDOGE
  '0x7b4328c127b85369d9f82ca0503b000d09cf9180', // DC
  '0xe3fca919883950c5cd468156392a6477ff5d18de', // OMNOM
] as const;

/** Check if a token address (lowercase) is a hub token. */
export function isHubToken(address: string): boolean {
  return HUB_TOKEN_ADDRESSES.includes(address.toLowerCase());
}

// ─── Phase 7: Liquidity Tiers & Advisor Mode ─────────────────────────────────

/**
 * Liquidity tier classification for pools.
 * Used to determine route quality and trigger multi-hop suggestions.
 */
export type LiquidityTier = 'optimal' | 'acceptable' | 'low' | 'very_low';

/**
 * Routing thresholds for triggering multi-hop WWDOGE routing suggestions.
 */
export const ROUTING_THRESHOLDS = {
  /** TVL below which direct routes are considered illiquid ($5,000). */
  TVL_ILLIQUID_THRESHOLD: 5_000,
  /** Price impact threshold (>3%) triggers multi-hop routing suggestion. */
  PRICE_IMPACT_THRESHOLD: 0.03,
  /** Output value below which route is considered suboptimal (e.g., $10). */
  MIN_OUTPUT_USD: 10,
} as const;

/**
 * Configuration for route advisor mode.
 * When enabled, shows suggestions rather than auto-sorting.
 */
export interface RouteAdvisorConfig {
  /** Enable advisory mode (suggest rather than auto-prefer). */
  enabled: boolean;
  /** Show "Recommended via WWDOGE" badge on multi-hop suggestions. */
  showWwdogeBadge: boolean;
  /** Show comparison view (direct vs multi-hop). */
  showComparisonView: boolean;
  /** Show "Low Liquidity" warnings on thin pools. */
  showLowLiquidityWarnings: boolean;
}

export const DEFAULT_ADVISOR_CONFIG: RouteAdvisorConfig = {
  enabled: true,
  showWwdogeBadge: true,
  showComparisonView: true,
  showLowLiquidityWarnings: true,
};

/**
 * Detailed route liquidity analysis returned by analyzeRouteLiquidity().
 */
export interface RouteLiquidityAnalysis {
  shouldPreferMultiHop: boolean;
  directRouteTVL: number;
  directRoutePriceImpact: number;
  directRouteOutput?: bigint;
  multiHopOutput?: bigint;
  savingsPercent?: number;
  reason: string | null;
  suggestedIntermediate: string | null;
  /** Comparison data for UI */
  comparison?: {
    directLabel: string;
    multiHopLabel: string;
    outputDifference: string;
    recommendation: 'direct' | 'multi_hop' | 'either';
  };
}

/**
 * Result of comparing direct vs multi-hop routes.
 */
export interface RouteComparison {
  hasBetterAlternative: boolean;
  betterRoute: 'direct' | 'multi_hop' | null;
  outputDifference: bigint;
  savingsPercent: number;
  message: string;
}