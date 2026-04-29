/**
 * Pool Fetcher — fetches pair reserves from all registered DEXes on Dogechain.
 *
 * Uses the UniswapV2Factory `getPair()` to discover pair addresses, then reads
 * reserves via `getReserves()`, `token0()`, and `token1()`.
 */

import { type PublicClient, createPublicClient, http, parseAbi, getAddress } from 'viem';
import { dogechain } from 'wagmi/chains';
import { CONTRACTS, OMNOMSWAP_AGGREGATOR_ADDRESS } from '../../lib/constants';
import type { PoolReserves, DexInfo, TokenInfo } from './types';

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
 */
export function getDexList(): DexInfo[] {
  if (registeredDexCache) return registeredDexCache;
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

// ─── Fetch helpers ────────────────────────────────────────────────────────────

/**
 * Fetch reserves for a single pair on a single DEX.
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

    return {
      reserve0: r0,
      reserve1: r1,
      token0: (token0 as string).toLowerCase(),
      token1: (token1 as string).toLowerCase(),
      factory: factoryAddress.toLowerCase(),
      dexName: '',
      router: '',
    };
  } catch {
    return null;
  }
}

/**
 * Fallback on-chain pool discovery via factory.getPair() calls.
 * Used when external API calls (GeckoTerminal/DexScreener) fail.
 *
 * This is slower than API-based discovery but more reliable since it
 * queries the blockchain directly.
 */
export async function fallbackGetPairs(
  tokenA: string,
  tokenB: string,
  client: PublicClient = defaultClient,
): Promise<PoolReserves[]> {
  console.warn('[PoolFetcher] Using on-chain fallback for pool discovery:', tokenA, '->', tokenB);
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

  const results = await Promise.allSettled(promises);
  for (const r of results) {
    if (r.status === 'fulfilled' && r.value) pools.push(r.value);
  }

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
 */
export async function fetchPoolsForSwap(
  tokenIn: string,
  tokenOut: string,
  client: PublicClient = defaultClient,
): Promise<PoolReserves[]> {
  await getRegisteredRouters(client);
  const dexList = getDexList();
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

  return pools;
}
