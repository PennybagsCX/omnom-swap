/**
 * Pool Fetcher — fetches pair reserves from all registered DEXes on Dogechain.
 *
 * Uses the UniswapV2Factory `getPair()` to discover pair addresses, then reads
 * reserves via `getReserves()`, `token0()`, and `token1()`.
 */

import { type PublicClient, createPublicClient, http, parseAbi, getAddress } from 'viem';
import { dogechain } from 'wagmi/chains';
import { CONTRACTS } from '../../lib/constants';
import type { PoolReserves, DexInfo, TokenInfo } from './types';

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

export const DEX_LIST: DexInfo[] = [
  { name: 'DogeSwap', router: CONTRACTS.DOGESWAP_V2_ROUTER, factory: CONTRACTS.DOGESWAP_FACTORY },
  { name: 'DogeShrk', router: CONTRACTS.DOGESHRK_V2_ROUTER, factory: CONTRACTS.DOGESHRK_FACTORY },
  { name: 'WOJAK Finance', router: CONTRACTS.WOJAK_ROUTER, factory: CONTRACTS.WOJAK_FACTORY },
  { name: 'KibbleSwap', router: CONTRACTS.KIBBLESWAP_ROUTER, factory: CONTRACTS.KIBBLESWAP_FACTORY },
  { name: 'YodeSwap', router: CONTRACTS.YODESWAP_ROUTER, factory: CONTRACTS.YODESWAP_FACTORY },
];

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
  const promises = DEX_LIST.flatMap((dex) =>
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
  const pools: PoolReserves[] = [];

  const promises = DEX_LIST.map(async (dex) => {
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
