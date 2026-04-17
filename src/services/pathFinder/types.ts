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

export interface PoolReserves {
  reserve0: bigint;
  reserve1: bigint;
  token0: string;
  token1: string;
  factory: string;
  dexName: string;
  router: string;
}

/** Edge in the liquidity graph — one directional pool between two tokens. */
export interface PoolEdge {
  tokenIn: string;
  tokenOut: string;
  reserveIn: bigint;
  reserveOut: bigint;
  factory: string;
  dexName: string;
  router: string;
}

// ─── Route ────────────────────────────────────────────────────────────────────

export interface RouteStep {
  dexRouter: string;
  dexName: string;
  path: string[]; // token addresses for this hop
  amountIn: bigint;
  expectedAmountOut: bigint;
}

export interface RouteResult {
  /** Stable identifier derived from route steps (hash of dex routers + paths). */
  id: string;
  steps: RouteStep[];
  totalAmountIn: bigint;
  totalExpectedOut: bigint;
  priceImpact: number;
  feeAmount: bigint;
  feeBps: number;
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
