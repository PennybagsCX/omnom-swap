/**
 * Pool Fetcher — fetches pair reserves from all registered DEXes on Dogechain.
 *
 * Uses the UniswapV2Factory `getPair()` to discover pair addresses, then reads
 * reserves via `getReserves()`, `token0()`, and `token1()`.
 *
 * Features:
 *   - Timestamp validation (30s freshness) via `lastFetched` field on PoolReserves
 *   - WWDOGE intermediate routing for low-liquidity direct pairs
 *   - Multi-hop fallback path discovery via hub tokens
 */

import { type PublicClient, createPublicClient, http, parseAbi, getAddress } from 'viem';
import { dogechain } from 'wagmi/chains';
import { CONTRACTS, OMNOMSWAP_AGGREGATOR_ADDRESS, getTokenDecimals } from '../../lib/constants';
import type { PoolReserves, DexInfo, TokenInfo, LiquidityTier } from './types';
import { MAX_RESERVE_STALENESS_MS } from './types';
import { classifyPoolLiquidity } from './index';

// ─── Hub tokens ────────────────────────────────────────────────────────────────
//
// High-liquidity tokens used as intermediate hops for multi-hop routing.
// Instead of querying N^2 pairs, we only query pairs between:
//   user tokenIn  <-> hub tokens
//   user tokenOut <-> hub tokens
//   tokenIn       <-> tokenOut (direct)
//   hub tokens    <-> hub tokens
//
// This reduces RPC calls from ~875,000 (500 tokens) to ~460.

export const HUB_TOKENS: TokenInfo[] = [
  { address: CONTRACTS.WWDOGE, symbol: 'WWDOGE', decimals: 18 },
  { address: CONTRACTS.DC_TOKEN, symbol: 'DC', decimals: 18 },
  { address: CONTRACTS.OMNOM_TOKEN, symbol: 'OMNOM', decimals: 18 },
];

// WWDOGE address on Dogechain — the primary intermediate for Dogechain swaps
export const WWDOGE_ADDRESS = CONTRACTS.WWDOGE.toLowerCase();

// ─── ABI fragments ────────────────────────────────────────────────────────────

const FACTORY_ABI = parseAbi([
  'function getPair(address tokenA, address tokenB) external view returns (address pair)',
]);

const PAIR_ABI = parseAbi([
  'function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
  'function token0() external view returns (address)',
  'function token1() external view returns (address)',
]);

// ─── DEX registry ─────────────────────────────────────────────────────────────

const ALL_DEX_LIST: DexInfo[] = [
  { name: 'DogeSwap', router: CONTRACTS.DOGESWAP_V2_ROUTER, factory: CONTRACTS.DOGESWAP_FACTORY },
  { name: 'DogeShrk', router: CONTRACTS.DOGESHRK_V2_ROUTER, factory: CONTRACTS.DOGESHRK_FACTORY },
  { name: 'WOJAK Finance', router: CONTRACTS.WOJAK_ROUTER, factory: CONTRACTS.WOJAK_FACTORY },
  { name: 'KibbleSwap', router: CONTRACTS.KIBBLESWAP_ROUTER, factory: CONTRACTS.KIBBLESWAP_FACTORY },
  { name: 'YodeSwap', router: CONTRACTS.YODESWAP_ROUTER, factory: CONTRACTS.YODESWAP_FACTORY },
  { name: 'FraxSwap', router: CONTRACTS.FRAXSWAP_ROUTER, factory: CONTRACTS.FRAXSWAP_FACTORY },
  { name: 'ToolSwap', router: CONTRACTS.TOOLSWAP_ROUTER, factory: CONTRACTS.TOOLSWAP_FACTORY },
  // ToolSwap alias — same router as ToolSwap, different factory, 34 pairs
  { name: 'ToolSwap', router: CONTRACTS.TOOLSWAP_ROUTER, factory: CONTRACTS.TOOLSWAP_FACTORY_ALIAS },
  // DMUSK — branded fork, DMUSK token, staking pools, 24 pairs, deprecated
  { name: 'DMUSK', router: CONTRACTS.DMUSK_ROUTER, factory: CONTRACTS.DMUSK_FACTORY },
  { name: 'IceCreamSwap', router: CONTRACTS.ICECREAMSWAP_ROUTER, factory: CONTRACTS.ICECREAMSWAP_FACTORY },
  { name: 'PupSwap', router: CONTRACTS.PUPSWAP_ROUTER, factory: CONTRACTS.PUPSWAP_FACTORY },
  { name: 'Bourbon Defi', router: CONTRACTS.BOURBONSWAP_ROUTER, factory: CONTRACTS.BOURBONSWAP_FACTORY },
];

const AGGREGATOR_ABI = parseAbi([
  'function supportedRouters(address) external view returns (bool)',
]);

// Module-level cache of on-chain router registrations
let registeredRoutersCache: Set<string> | null = null;
let registeredDexCache: DexInfo[] | null = null;

/**
 * Fetch supported routers from the aggregator contract and cache the result.
 * Returns the set of lowercase router addresses that are registered on-chain.
 */
export async function getRegisteredRouters(client: PublicClient): Promise<Set<string>> {
  if (registeredRoutersCache) return registeredRoutersCache;

  const aggregatorAddress = OMNOMSWAP_AGGREGATOR_ADDRESS;
  const checks = await Promise.all(
    ALL_DEX_LIST.map(async (dex) => {
      try {
        const supported = await client.readContract({
          address: aggregatorAddress,
          abi: AGGREGATOR_ABI,
          functionName: 'supportedRouters',
          args: [getAddress(dex.router)],
        });
        return supported as boolean;
      } catch {
        return false;
      }
    }),
  );

  const registered = new Set<string>();
  checks.forEach((isSupported, i) => {
    if (isSupported) registered.add(ALL_DEX_LIST[i].router.toLowerCase());
  });

  registeredRoutersCache = registered;
  registeredDexCache = ALL_DEX_LIST.filter(dex => registered.has(dex.router.toLowerCase()));

  return registered;
}

/**
 * Get DEX list filtered to only routers registered on-chain.
 * Must call getRegisteredRouters() first to populate the cache.
 * Falls back to ALL_DEX_LIST if cache is not yet populated.
 * Falls back to ALL_DEX_LIST if cache is empty (no routers registered yet).
 */
export function getDexList(): DexInfo[] {
  if (registeredDexCache && registeredDexCache.length > 0) return registeredDexCache;
  console.warn('[PoolFetcher] getDexList: cache empty or not populated, falling back to ALL_DEX_LIST');
  return ALL_DEX_LIST;
}

/** Check if a specific router address is registered on-chain (uses cache). */
export function isRouterRegistered(routerAddress: string): boolean {
  if (!registeredRoutersCache) return true; // assume registered until cache loaded
  return registeredRoutersCache.has(routerAddress.toLowerCase());
}

// Legacy export — returns all DEXes until on-chain fetch completes
export const DEX_LIST: DexInfo[] = ALL_DEX_LIST;

// ─── Standalone client ────────────────────────────────────────────────────────

const defaultClient = createPublicClient({ chain: dogechain, transport: http() });

// ─── Timestamp Validation ─────────────────────────────────────────────────────

/**
 * Check if a pool's reserves are stale (fetched more than MAX_RESERVE_STALENESS_MS ago).
 * Returns true if the pool should be re-fetched.
 */
export function isPoolStale(pool: PoolReserves): boolean {
  if (!pool.lastFetched) return true; // Never fetched, consider stale
  const age = Date.now() - pool.lastFetched;
  return age > MAX_RESERVE_STALENESS_MS;
}

/**
 * Mark a pool with the current timestamp as its last-fetched time.
 */
function withTimestamp(pool: PoolReserves): PoolReserves {
  return { ...pool, lastFetched: Date.now() };
}

// ─── Liquidity Assessment ─────────────────────────────────────────────────────

/**
 * Get decimals for each token in a pool.
 * Used for normalizing reserve values before TVL calculation.
 */
function getPoolTokenDecimals(pool: PoolReserves): { decimals0: number; decimals1: number } {
  const decimals0 = getTokenDecimals(pool.token0);
  const decimals1 = getTokenDecimals(pool.token1);
  return { decimals0, decimals1 };
}

/**
 * Normalize a reserve value from its actual decimal representation to 18-decimal equivalent.
 * For example, MCRIB has 15 decimals, so 1 MCRIB token = 1e15 raw.
 * To normalize to 18-decimal equivalent: raw / 10^(15-18) = raw / 10^-3 = raw * 1000.
 * 
 * Wait - let me think more carefully:
 * - If MCRIB has 15 decimals, 1 token = 10^15 raw units
 * - In 18-decimal normalized form, 1 token = 10^18 raw units
 * - So to convert MCRIB raw to 18-decimal normalized: raw * 10^(18-15) = raw * 10^3 = raw * 1000
 * 
 * Actually no, that's the opposite. Let me think again:
 * - MCRIB: 1 token = 10^15 raw
 * - To express "number of tokens" in a normalized way where 1 token = 10^18:
 *   - 10^15 raw / 10^18 = 10^-3 normalized (i.e., 0.001 tokens per MCRIB)
 * - So to normalize MCRIB raw to 18-decimal equivalent: raw / 1000
 * 
 * DC: 1 token = 10^18 raw
 * - Already in 18-decimal form, so normalized = raw
 */
/**
 * Convert a raw reserve value to human-readable token count.
 * For example, MCRIB has 15 decimals, so raw 2.39e24 → 2,394,109 tokens.
 * This is the correct conversion for TVL calculation (not 18-decimal normalization).
 */
function rawReserveToTokenCount(rawReserve: bigint, decimals: number): number {
  return Number(rawReserve) / Math.pow(10, decimals);
}

/**
 * Estimate the USD value of a pool's reserves.
 * Uses a simplified calculation assuming $1 per WWDOGE-equivalent token
 * for WWDOGE-based pairs. More accurate pricing would require token price feeds.
 *
 * For TVL calculation, we use the geometric mean of both reserves as a proxy.
 * 
 * IMPORTANT: This function now properly normalizes for token decimals.
 * Previously, MCRIB (15 decimals) was treated as 18 decimals, causing 1000x TVL inflation.
 */
export function estimatePoolTVL(pool: PoolReserves, wwdogePrice: number = 1.0): number {
  const r0 = Number(pool.reserve0);
  const r1 = Number(pool.reserve1);
  
  // Get actual decimals for each token
  const { decimals0, decimals1 } = getPoolTokenDecimals(pool);
  
  // DEBUG: Log inputs to catch precision issues early
  if (r0 > 1e15 || r1 > 1e15) {
    console.debug(`[estimatePoolTVL] Large reserves detected:`, {
      reserve0: pool.reserve0.toString(),
      reserve1: pool.reserve1.toString(),
      reserve0Num: r0,
      reserve1Num: r1,
      token0: pool.token0,
      token1: pool.token1,
      decimals0,
      decimals1,
      dexName: pool.dexName,
    });
  }
  
  // Sanity check: reject truly corrupted RPC data (raw values > 1e38 indicate garbage)
  // Legitimate raw reserves: even 1 trillion tokens with 18 decimals = 1e30, well below 1e38
  if (r0 > 1e38 || r1 > 1e38) {
    console.warn(`[estimatePoolTVL] Rejecting suspicious reserve data (potential RPC corruption):`, {
      reserve0: pool.reserve0.toString(),
      reserve1: pool.reserve1.toString(),
      token0: pool.token0,
      token1: pool.token1,
      dexName: pool.dexName,
    });
    return 0; // Reject corrupted data
  }
  
  // Convert raw reserves to actual human-readable token counts using per-token decimals.
  // This is the correct approach for TVL: divide by 10^decimals to get token count.
  // Previously used normalizeReserveTo18Decimals() which inflated non-18-decimal tokens
  // (e.g., MCRIB with 15 decimals got 1000x inflated TVL → $21 quintillion).
  const r0Tokens = rawReserveToTokenCount(pool.reserve0, decimals0);
  const r1Tokens = rawReserveToTokenCount(pool.reserve1, decimals1);
  
  // Check for inflated token counts: > 1e15 tokens (1 quadrillion) is unrealistic
  // for any token and indicates corrupted data
  if (r0Tokens > 1e15 || r1Tokens > 1e15) {
    const inflatedTvl = 2 * Math.sqrt(r0Tokens * r1Tokens) * wwdogePrice;
    console.warn(`[estimatePoolTVL] Rejecting pool due to inflated token count: $${inflatedTvl.toLocaleString()}`, {
      reserve0: pool.reserve0.toString(),
      reserve1: pool.reserve1.toString(),
      token0: pool.token0,
      token1: pool.token1,
      dexName: pool.dexName,
      decimals0,
      decimals1,
      r0Tokens,
      r1Tokens,
      rejectionReason: 'Token count > 1e15 indicates RPC corruption',
    });
    return 0; // Hard reject
  }
  
  // Check reserve ratio to detect inflation:
  // For normal pools, the ratio of token counts should be reasonable (< 1e12)
  // Extreme ratios after accounting for decimals indicate corrupted data
  if (r0Tokens > 0 && r1Tokens > 0) {
    const ratio = Math.max(r0Tokens, r1Tokens) / Math.min(r0Tokens, r1Tokens);
    if (ratio > 1e12) {
      const tvl = 2 * Math.sqrt(r0Tokens * r1Tokens) * wwdogePrice;
      console.warn(`[estimatePoolTVL] Rejecting pool due to extreme reserve ratio: ${ratio.toExponential(2)}`, {
        reserve0: pool.reserve0.toString(),
        reserve1: pool.reserve1.toString(),
        token0: pool.token0,
        token1: pool.token1,
        dexName: pool.dexName,
        decimals0,
        decimals1,
        r0Tokens,
        r1Tokens,
        ratio,
        tvl,
        rejectionReason: `Reserve ratio ${ratio.toExponential(2)} > 1e12 indicates inflated/corrupted reserves`,
      });
      return 0; // Hard reject
    }
  }
  
  // Use geometric mean to avoid overweighting either token in the pair
  // Apply WWDOGE price (default $1 if not provided)
  const tvl = 2 * Math.sqrt(r0Tokens * r1Tokens) * wwdogePrice;
  
  // Hard reject: TVL > $1B is inherently suspicious for a single pool
  if (tvl > 1_000_000_000) {
    console.warn(`[estimatePoolTVL] Rejecting pool due to TVL > $1B: $${tvl.toLocaleString()}`, {
      reserve0: pool.reserve0.toString(),
      reserve1: pool.reserve1.toString(),
      token0: pool.token0,
      token1: pool.token1,
      dexName: pool.dexName,
      decimals0,
      decimals1,
      r0Tokens,
      r1Tokens,
      tvl,
      rejectionReason: 'Single pool TVL > $1B is unrealistic',
    });
    return 0; // Hard reject
  }
  
  // DEBUG: Log the decimal correction being applied
  if (decimals0 !== 18 || decimals1 !== 18) {
    console.log(`[estimatePoolTVL] Decimal correction applied:`, {
      token0: pool.token0,
      token1: pool.token1,
      decimals0,
      decimals1,
      r0Tokens,
      r1Tokens,
      tvl,
    });
  }
  
  return tvl;
}

/**
 * Check if a direct pair has low liquidity — triggers WWDOGE intermediate routing.
 * Returns true if all pools for the direct pair have TVL below ROUTING_THRESHOLDS.TVL_ILLIQUID_THRESHOLD.
 * Phase 7: Now uses ROUTING_THRESHOLDS.TVL_ILLIQUID_THRESHOLD instead of hardcoded MIN_LIQUIDITY_USD.
 */
export function hasLowLiquidity(pools: PoolReserves[], tokenA: string, tokenB: string): boolean {
  const normalizedA = tokenA.toLowerCase();
  const normalizedB = tokenB.toLowerCase();

  const directPools = pools.filter(p => {
    const t0 = p.token0.toLowerCase();
    const t1 = p.token1.toLowerCase();
    return (t0 === normalizedA && t1 === normalizedB) || (t0 === normalizedB && t1 === normalizedA);
  });

  if (directPools.length === 0) return true; // No pools = effectively zero liquidity

  // Check if ALL pools have TVL below illiquid threshold
  const allHaveLowLiquidity = directPools.every(pool => {
    const tvl = estimatePoolTVL(pool);
    return tvl < 5_000; // ROUTING_THRESHOLDS.TVL_ILLIQUID_THRESHOLD
  });

  return allHaveLowLiquidity;
}

// ─── Fetch helpers ────────────────────────────────────────────────────────────

/**
 * Fetch reserves for a single pair on a single DEX.
 * Records the timestamp when reserves were fetched for staleness checking.
 */
export async function fetchPoolReserves(
  factoryAddress: string,
  tokenA: string,
  tokenB: string,
  client: PublicClient = defaultClient,
): Promise<PoolReserves | null> {
  try {
    const factory = getAddress(factoryAddress);
    const tA = getAddress(tokenA);
    const tB = getAddress(tokenB);

    const pairAddress = (await client.readContract({
      address: factory,
      abi: FACTORY_ABI,
      functionName: 'getPair',
      args: [tA, tB],
    })) as `0x${string}`;

    // getPair returns zero address if pair doesn't exist
    if (!pairAddress || pairAddress === '0x0000000000000000000000000000000000000000') {
      return null;
    }

    const [reserves, token0, token1] = await Promise.all([
      client.readContract({ address: pairAddress, abi: PAIR_ABI, functionName: 'getReserves' }),
      client.readContract({ address: pairAddress, abi: PAIR_ABI, functionName: 'token0' }),
      client.readContract({ address: pairAddress, abi: PAIR_ABI, functionName: 'token1' }),
    ]);

    const [r0, r1] = reserves as [bigint, bigint, number];
    const t0 = token0 as string | undefined;
    const t1 = token1 as string | undefined;

    // If token0 or token1 returned undefined, the pair contract may be malformed
    // Return null to skip this pair
    if (!t0 || !t1) {
      console.warn(`[fetchPoolReserves] Pair ${pairAddress} returned invalid token0/token1: ${t0}, ${t1}`);
      return null;
    }

    const token0Lower = t0.toLowerCase();
    const token1Lower = t1.toLowerCase();

    // DEBUG: Log pool data being fetched
    console.debug(`[PoolFetcher] fetchPoolReserves:`, {
      factory: factoryAddress.toLowerCase(),
      tokenA: tA,
      tokenB: tB,
      pairAddress: pairAddress.toLowerCase(),
      reserve0: r0.toString(),
      reserve1: r1.toString(),
      token0: token0Lower,
      token1: token1Lower,
      reserve0Formatted: Number(r0) / 1e18,
      reserve1Formatted: Number(r1) / 1e18,
      lastFetched: Date.now(),
    });

    // Phase 7: Calculate TVL and assign liquidity tier to each pool
    // Include token0 and token1 for TVL calculation which needs decimals
    const poolTvl = estimatePoolTVL({ 
      reserve0: r0, 
      reserve1: r1,
      token0: token0Lower,
      token1: token1Lower,
    } as PoolReserves);
    const poolTier: LiquidityTier = classifyPoolLiquidity(poolTvl);

    return withTimestamp({
      reserve0: r0,
      reserve1: r1,
      token0: token0Lower,
      token1: token1Lower,
      factory: factoryAddress.toLowerCase(),
      dexName: '',
      router: '',
      tvlUsd: poolTvl,
      liquidityTier: poolTier,
    });
  } catch (err) {
    // DEBUG: Log the actual error for diagnostic purposes
    console.error(`[fetchPoolReserves] Error fetching reserves for pair ${factoryAddress}/${tokenA}/${tokenB}:`, err);
    return null;
  }
}

/**
 * Fallback on-chain pool discovery via factory.getPair() calls.
 * Used when external API calls (GeckoTerminal/DexScreener) fail.
 *
 * This is slower than API-based discovery but more reliable since it
 * queries the blockchain directly.
 *
 * @param tokenA - First token address
 * @param tokenB - Second token address
 * @param client - Public client for RPC calls
 * @param useAllDex - If true, queries ALL_DEX_LIST regardless of on-chain router registration.
 *                    Use this when the registered router cache is incomplete/stale.
 */
export async function fallbackGetPairs(
  tokenA: string,
  tokenB: string,
  client: PublicClient = defaultClient,
  useAllDex: boolean = false,
): Promise<PoolReserves[]> {
  console.warn('[PoolFetcher] Using on-chain fallback for pool discovery:', tokenA, '->', tokenB, { useAllDex });

  // Determine which DEX list to use
  let dexList: DexInfo[];
  if (useAllDex) {
    // Bypass registered router filter — use ALL_DEX_LIST for comprehensive pool discovery
    dexList = ALL_DEX_LIST;
    console.log('[PoolFetcher] fallbackGetPairs: using ALL_DEX_LIST (', ALL_DEX_LIST.length, ' DEXs)');
  } else {
    // Standard behavior: only query routers registered on-chain
    await getRegisteredRouters(client);
    dexList = getDexList();
  }

  const pools: PoolReserves[] = [];

  const promises = dexList.map(async (dex) => {
    const pool = await fetchPoolReserves(dex.factory, tokenA, tokenB, client);
    if (pool) {
      pool.dexName = dex.name;
      pool.router = dex.router.toLowerCase();
      pool.factory = dex.factory.toLowerCase();
    }
    return pool;
  });

  const results = await Promise.allSettled(promises);
  for (const r of results) {
    if (r.status === 'fulfilled' && r.value) pools.push(r.value);
  }

  console.log('[PoolFetcher] fallbackGetPairs: found', pools.length, 'pools across', dexList.length, 'DEXes');
  return pools;
}

/**
 * Fetch all known pool reserves across all DEXes for the given token list.
 * Returns a flat array of PoolReserves (one per discovered pair per DEX).
 *
 * M-02: Includes a 10-second timeout. If the timeout fires before all pools
 * are fetched, partial results are returned (whatever resolved in time).
 */
export async function fetchAllPools(
  tokens: TokenInfo[],
  client: PublicClient = defaultClient,
  timeoutMs: number = 10_000,
): Promise<PoolReserves[]> {
  await getRegisteredRouters(client);
  const dexList = getDexList();
  const pools: PoolReserves[] = [];
  const seen = new Set<string>(); // "factory:tokenA:tokenB" normalized

  // Generate all unique token pairs
  const pairs: [TokenInfo, TokenInfo][] = [];
  for (let i = 0; i < tokens.length; i++) {
    for (let j = i + 1; j < tokens.length; j++) {
      pairs.push([tokens[i], tokens[j]]);
    }
  }

  // For each DEX, for each pair, try to fetch reserves
  const promises = dexList.flatMap((dex) =>
    pairs.map(async ([tA, tB]) => {
      const key = `${dex.factory.toLowerCase()}:${tA.address.toLowerCase()}:${tB.address.toLowerCase()}`;
      if (seen.has(key)) return null;
      seen.add(key);

      const pool = await fetchPoolReserves(dex.factory, tA.address, tB.address, client);
      if (pool) {
        pool.dexName = dex.name;
        pool.router = dex.router.toLowerCase();
        pool.factory = dex.factory.toLowerCase();
      }
      return pool;
    }),
  );

  // M-02: Race against timeout — return partial results on timeout
  const allResults = await Promise.race([
    Promise.allSettled(promises),
    new Promise<PromiseSettledResult<PoolReserves | null>[]>((resolve) =>
      setTimeout(
        () => resolve(promises.map(() => ({ status: 'rejected' as const, reason: 'timeout' }))),
        timeoutMs,
      ),
    ),
  ]);

  for (const r of allResults) {
    if (r.status === 'fulfilled' && r.value) pools.push(r.value);
  }

  return pools;
}

/**
 * Fetch pools for a specific token pair across all DEXes.
 * Useful for price comparison.
 */
export async function fetchPoolsForPair(
  tokenA: string,
  tokenB: string,
  client: PublicClient = defaultClient,
): Promise<PoolReserves[]> {
  await getRegisteredRouters(client);
  const dexList = getDexList();
  const pools: PoolReserves[] = [];

  const promises = dexList.map(async (dex) => {
    const pool = await fetchPoolReserves(dex.factory, tokenA, tokenB, client);
    if (pool) {
      pool.dexName = dex.name;
      pool.router = dex.router.toLowerCase();
      pool.factory = dex.factory.toLowerCase();
    }
    return pool;
  });

  const results = await Promise.all(promises);
  for (const r of results) {
    if (r) pools.push(r);
  }

  return pools;
}

/**
 * Fetch hub-token intermediate pairs needed for multi-hop routing.
 * This specifically queries pairs between hub tokens and other hub tokens
 * to enable the BFS to discover multi-hop paths when direct pairs are thin.
 *
 * @param tokenIn - User's input token
 * @param tokenOut - User's output token
 * @param client - Public client for RPC calls
 * @param useAllDex - If true, queries ALL_DEX_LIST regardless of on-chain router registration.
 */
export async function fetchHubTokenPairs(
  _tokenIn: string,
  _tokenOut: string,
  client: PublicClient = defaultClient,
  useAllDex: boolean = false,
): Promise<PoolReserves[]> {
  let dexList: DexInfo[];
  if (useAllDex) {
    dexList = ALL_DEX_LIST;
  } else {
    await getRegisteredRouters(client);
    dexList = getDexList();
  }

  const hubAddresses = HUB_TOKENS.map(h => h.address.toLowerCase());
  void hubAddresses; // hubAddresses used for documentation purposes

  // Collect all hub pairs needed for multi-hop routing
  const hubPairs: [string, string][] = [];

  for (const hub of HUB_TOKENS) {
    const hubLower = hub.address.toLowerCase();

    // WWDOGE ↔ OMNOM (the key liquidity pair)
    hubPairs.push([CONTRACTS.WWDOGE, CONTRACTS.OMNOM_TOKEN]);

    // WWDOGE ↔ DC (if DC isn't one of our tokens)
    if (hubLower !== CONTRACTS.DC_TOKEN.toLowerCase()) {
      hubPairs.push([CONTRACTS.WWDOGE, CONTRACTS.DC_TOKEN]);
    }

    // OMNOM ↔ DC (if both aren't the same)
    const omnomLower = CONTRACTS.OMNOM_TOKEN.toLowerCase();
    const dcLower = CONTRACTS.DC_TOKEN.toLowerCase();
    if (hubLower !== omnomLower && hubLower !== dcLower) {
      hubPairs.push([CONTRACTS.OMNOM_TOKEN, CONTRACTS.DC_TOKEN]);
    }
  }

  // Deduplicate
  const seen = new Set<string>();
  const uniquePairs = hubPairs.filter(([a, b]) => {
    const key = `${a.toLowerCase()}:${b.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const pools: PoolReserves[] = [];

  const promises = uniquePairs.flatMap(([tA, tB]) =>
    dexList.map(async (dex) => {
      const pool = await fetchPoolReserves(dex.factory, tA, tB, client);
      if (pool) {
        pool.dexName = dex.name;
        pool.router = dex.router.toLowerCase();
        pool.factory = dex.factory.toLowerCase();
      }
      return pool;
    }),
  );

  const results = await Promise.allSettled(promises);
  for (const r of results) {
    if (r.status === 'fulfilled' && r.value) pools.push(r.value);
  }

  return pools;
}

/**
 * Fetch pools needed to route between two tokens using hub-token strategy.
 *
 * Queries only:
 *   1. Direct pair:      tokenIn ↔ tokenOut
 *   2. Input leg:        tokenIn ↔ each hub token
 *   3. Output leg:       tokenOut ↔ each hub token
 *   4. Hub-to-hub:       between hub tokens (for 3+ hop routes)
 *
 * Total calls ≈ DEX_COUNT × (1 + 2×HUBS + HUBS×(HUBS-1)/2)
 * With 7 DEXes and 3 hubs: 7 × (1 + 6 + 3) = 70 calls — vs ~875k for brute force.
 *
 * ENHANCED: When direct pair has low liquidity (< MIN_LIQUIDITY_USD TVL),
 * automatically adds WWDOGE intermediate routing pools (DC → WWDOGE → MCRIB pattern).
 *
 * @param useAllDex - If true, queries ALL_DEX_LIST regardless of on-chain router registration.
 *                   Use this for fallback when primary route has extreme price impact.
 */
export async function fetchPoolsForSwap(
  tokenIn: string,
  tokenOut: string,
  client: PublicClient = defaultClient,
  useAllDex: boolean = false,
): Promise<PoolReserves[]> {
  // Determine which DEX list to use
  let dexList: DexInfo[];
  if (useAllDex) {
    // Bypass registered router filter — use ALL_DEX_LIST for comprehensive pool discovery
    dexList = ALL_DEX_LIST;
    console.log('[fetchPoolsForSwap] Using ALL_DEX_LIST (', ALL_DEX_LIST.length, ' DEXs) for fallback');
  } else {
    await getRegisteredRouters(client);
    dexList = getDexList();
  }

  const pools: PoolReserves[] = [];
  const seen = new Set<string>();

  const inLower = tokenIn.toLowerCase();
  const outLower = tokenOut.toLowerCase();
  const hubAddresses = HUB_TOKENS.map(h => h.address.toLowerCase());

  const isHub = (addr: string) => hubAddresses.includes(addr.toLowerCase());

  // Skip hub tokens that are the user's selected tokens
  const relevantHubs = HUB_TOKENS.filter(
    h => h.address.toLowerCase() !== inLower && h.address.toLowerCase() !== outLower,
  );

  // Build the set of unique pairs to query
  const pairs: [string, string][] = [];

  // 1. Direct pair
  pairs.push([tokenIn, tokenOut]);

  // 2. tokenIn ↔ each hub token (skip if tokenIn IS a hub — hub-to-hub covers it)
  if (!isHub(inLower)) {
    for (const hub of relevantHubs) {
      pairs.push([tokenIn, hub.address]);
    }
  }

  // 3. tokenOut ↔ each hub token (skip if tokenOut IS a hub)
  if (!isHub(outLower)) {
    for (const hub of relevantHubs) {
      pairs.push([tokenOut, hub.address]);
    }
  }

  // 4. Hub-to-hub pairs
  for (let i = 0; i < relevantHubs.length; i++) {
    for (let j = i + 1; j < relevantHubs.length; j++) {
      pairs.push([relevantHubs[i].address, relevantHubs[j].address]);
    }
  }

  // Deduplicate pairs
  const uniquePairs = pairs.filter(([a, b]) => {
    const key = `${a.toLowerCase()}:${b.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Fetch all unique pairs across all DEXes
  const promises = uniquePairs.flatMap(([tA, tB]) =>
    dexList.map(async (dex) => {
      const pool = await fetchPoolReserves(dex.factory, tA, tB, client);
      if (pool) {
        pool.dexName = dex.name;
        pool.router = dex.router.toLowerCase();
        pool.factory = dex.factory.toLowerCase();
      }
      return pool;
    }),
  );

  const results = await Promise.allSettled(promises);
  for (const r of results) {
    if (r.status === 'fulfilled' && r.value) pools.push(r.value);
  }

  // ─── Phase 4.2: Low-liquidity detection & WWDOGE intermediate routing ─────────
  // If the direct pair has very low TVL, try to add WWDOGE intermediate pools
  // This enables DC → WWDOGE → MCRIB style multi-hop routes

  // Fetch direct pair pools separately to check liquidity
  const directPools = pools.filter(p => {
    const t0 = p.token0.toLowerCase();
    const t1 = p.token1.toLowerCase();
    return (t0 === inLower && t1 === outLower) || (t0 === outLower && t1 === inLower);
  });

  const directTVL = directPools.reduce((sum, p) => sum + estimatePoolTVL(p), 0);

  // DEBUG: Log TVL calculation for WWDOGE fallback decision
  console.debug(`[fetchPoolsForSwap] TVL Analysis for ${tokenIn} -> ${tokenOut}:`, {
    directPoolsFound: directPools.length,
    directTVL,
    directTVLFormatted: directTVL.toFixed(2),
    tvlThreshold: 5_000,
    shouldTriggerFallback: directTVL < 5_000,
    tokenIn,
    tokenOut,
    poolsCount: pools.length,
    poolDetails: directPools.map(p => ({
      dexName: p.dexName,
      reserve0: p.reserve0.toString(),
      reserve1: p.reserve1.toString(),
      tvlUsd: p.tvlUsd,
      router: p.router,
    })),
  });

  // Phase 7: Use 5000 as the illiquid threshold (ROUTING_THRESHOLDS.TVL_ILLIQUID_THRESHOLD)
  // If direct pair TVL is below this, try to add WWDOGE intermediate pools
  if (directTVL < 5_000) {
    console.warn(`[fetchPoolsForSwap] Direct pair ${tokenIn} -> ${tokenOut} has low TVL ($${directTVL.toFixed(2)}). Adding WWDOGE intermediate pools.`);

    // Try to fetch pools for WWDOGE intermediate routing:
    // DC → WWDOGE and WWDOGE → MCRIB
    // This covers the DC→MCRIB via WWDOGE case

    // tokenIn → WWDOGE
    const inToWwdogePairs: [string, string][] = [[tokenIn, CONTRACTS.WWDOGE]];
    // WWDOGE → tokenOut
    const wwdogeToOutPairs: [string, string][] = [[CONTRACTS.WWDOGE, tokenOut]];

    const additionalPairs = [...inToWwdogePairs, ...wwdogeToOutPairs];

    console.debug(`[fetchPoolsForSwap] Fetching WWDOGE intermediate pools:`, {
      inToWwdogePairs,
      wwdogeToOutPairs,
      dexListSize: dexList.length,
      dexNames: dexList.map(d => d.name),
    });

    // DEBUG: Log each WWDOGE intermediate query before executing
    console.log(`[fetchPoolsForSwap] WWDOGE fallback: querying ${additionalPairs.length * dexList.length} factory pairs...`);
    
    // Manually check getPair for each combination to diagnose why pools aren't found
    for (const [tA, tB] of additionalPairs) {
      for (const dex of dexList) {
        try {
          const factoryAddr = getAddress(dex.factory);
          const pairAddr = await client.readContract({
            address: factoryAddr,
            abi: FACTORY_ABI,
            functionName: 'getPair',
            args: [getAddress(tA), getAddress(tB)],
          }) as `0x${string}`;
          
          console.log(`[fetchPoolsForSwap] WWDOGE fallback check: ${dex.name} ${tA.slice(0,8)}.../${tB.slice(0,8)}... => pair: ${pairAddr.slice(0,10)}...`);
          
          if (!pairAddr || pairAddr === '0x0000000000000000000000000000000000000000') {
            console.log(`[fetchPoolsForSwap]   -> Pair does NOT exist on ${dex.name}`);
          }
        } catch (err) {
          console.log(`[fetchPoolsForSwap]   -> ${dex.name} ERROR: ${(err as Error).message.slice(0, 100)}`);
        }
      }
    }
    
    const additionalPromises = additionalPairs.flatMap(([tA, tB]) =>
      dexList.map(async (dex) => {
        const pool = await fetchPoolReserves(dex.factory, tA, tB, client);
        if (pool) {
          pool.dexName = dex.name;
          pool.router = dex.router.toLowerCase();
          pool.factory = dex.factory.toLowerCase();
        }
        return pool;
      }),
    );

    const additionalResults = await Promise.allSettled(additionalPromises);
    let addedCount = 0;
    for (const r of additionalResults) {
      if (r.status === 'fulfilled' && r.value) {
        // DEBUG: Log the actual pool data returned from fetchPoolReserves
        console.log(`[fetchPoolsForSwap] fetchPoolReserves returned pool:`, {
          factory: r.value.factory,
          dexName: r.value.dexName,
          token0: r.value.token0,
          token1: r.value.token1,
          reserve0: r.value.reserve0.toString(),
          reserve1: r.value.reserve1.toString(),
          reserve0IsZero: r.value.reserve0 === 0n,
          reserve1IsZero: r.value.reserve1 === 0n,
          tvlUsd: estimatePoolTVL(r.value),
        });
        
        const key = `${r.value.factory}:${r.value.token0}:${r.value.token1}`;
        if (!seen.has(key)) {
          seen.add(key);
          pools.push(r.value);
          addedCount++;
          console.debug(`[fetchPoolsForSwap] Added WWDOGE intermediate pool:`, {
            factory: r.value.factory,
            dexName: r.value.dexName,
            token0: r.value.token0,
            token1: r.value.token1,
            reserve0: r.value.reserve0.toString(),
            reserve1: r.value.reserve1.toString(),
            tvlUsd: estimatePoolTVL(r.value),
          });
        } else {
          console.log(`[fetchPoolsForSwap] Pool filtered as duplicate: ${key}`);
        }
      } else if (r.status === 'rejected') {
        console.log(`[fetchPoolsForSwap] Promise rejected: ${r.reason}`);
      } else if (r.status === 'fulfilled' && !r.value) {
        console.log(`[fetchPoolsForSwap] fetchPoolReserves returned null (pair doesn't exist or error)`);
      }
    }

    console.log(`[fetchPoolsForSwap] After WWDOGE intermediate fallback: ${pools.length} total pools (+${addedCount} new)`);
  } else {
    console.debug(`[fetchPoolsForSwap] Direct pair TVL ($${directTVL.toFixed(2)}) above threshold - WWDOGE fallback not needed`);
  }

  return pools;
}
