/**
 * Pool Scanner — Fast pool loading with Multicall3 reserves + delta scanning.
 *
 * Architecture:
 * 1. Instant: Load 172 hardcoded pools from knownPools.ts
 * 2. Fast (~2s): Batch-fetch reserves via Multicall3 for all pools
 * 3. Delta scan: Check factories for any NEW pools not in hardcoded list
 * 4. Dead pool filter: Remove pools with 0 reserves from display
 * 5. Token symbol resolution via tokenDiscovery for unknown tokens
 *
 * Cache: 5 minutes (reserves data), 1 hour (delta scan for new pools)
 */

import { createPublicClient, http, parseAbi, getAddress } from 'viem';
import { dogechain } from 'wagmi/chains';
import { CONTRACTS } from '../../lib/constants';
import { KNOWN_POOLS } from './knownPools';
import { fetchAllReserves, type PoolReserves } from './multicallReserves';
import { discoverOmnomTokens, getTokenSymbol } from './tokenDiscovery';

const OMNOM_TOKEN = CONTRACTS.OMNOM_TOKEN;

const FACTORIES = [
  { name: 'DogeSwap', address: CONTRACTS.DOGESWAP_FACTORY as `0x${string}`, dexId: 'dogeswap' },
  { name: 'DogeShrk', address: CONTRACTS.DOGESHRK_FACTORY as `0x${string}`, dexId: 'dogeshrek' },
  { name: 'WOJAK', address: CONTRACTS.WOJAK_FACTORY as `0x${string}`, dexId: 'wojak' },
  { name: 'KibbleSwap', address: CONTRACTS.KIBBLESWAP_FACTORY as `0x${string}`, dexId: 'kibbleswap' },
  { name: 'YodeSwap', address: CONTRACTS.YODESWAP_FACTORY as `0x${string}`, dexId: 'yodeswap' },
  { name: 'FraxSwap', address: CONTRACTS.FRAXSWAP_FACTORY as `0x${string}`, dexId: 'fraxswap' },
  { name: 'ToolSwap', address: CONTRACTS.TOOLSWAP_FACTORY as `0x${string}`, dexId: 'toolswap' },
  { name: 'DMUSK', address: CONTRACTS.DMUSK_FACTORY as `0x${string}`, dexId: 'dmusk' },
  { name: 'IceCreamSwap', address: CONTRACTS.ICECREAMSWAP_FACTORY as `0x${string}`, dexId: 'icecreamswap' },
  { name: 'PupSwap', address: CONTRACTS.PUPSWAP_FACTORY as `0x${string}`, dexId: 'pupswap' },
  { name: 'Bourbon Defi', address: CONTRACTS.BOURBONSWAP_FACTORY as `0x${string}`, dexId: 'bourbondefi' },
  { name: 'BreadFactory', address: CONTRACTS.BREADFACTORY_FACTORY as `0x${string}`, dexId: 'breadfactory' },
] as const;

const factoryAbi = parseAbi([
  'function allPairsLength() external view returns (uint256)',
  'function allPairs(uint256) external view returns (address)',
]);

const pairAbi = parseAbi([
  'function token0() external view returns (address)',
  'function token1() external view returns (address)',
]);

// Cache
type CachedPools = { pools: FactoryPool[]; timestamp: number };
let cachedPools: CachedPools | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

const STORAGE_KEY = 'omnom_factory_pools_v4';

function serializePools(pools: FactoryPool[]): string {
  return JSON.stringify(pools.map(p => ({
    ...p,
    reserve0: p.reserve0.toString(),
    reserve1: p.reserve1.toString(),
    totalSupply: p.totalSupply.toString(),
  })));
}

function deserializePools(raw: string): FactoryPool[] {
  return JSON.parse(raw).map((p: Record<string, unknown>) => ({
    ...p,
    reserve0: BigInt(p.reserve0 as string),
    reserve1: BigInt(p.reserve1 as string),
    totalSupply: BigInt(p.totalSupply as string),
  }));
}

function loadFromStorage(): CachedPools | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const { pools, timestamp } = JSON.parse(raw) as { pools: string; timestamp: number };
    return { pools: deserializePools(pools), timestamp };
  } catch { return null; }
}

function saveToStorage(cached: CachedPools): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      pools: serializePools(cached.pools),
      timestamp: cached.timestamp,
    }));
  } catch { /* localStorage full */ }
}

cachedPools = loadFromStorage();

export interface FactoryPool {
  pairAddress: string;
  dexId: string;
  dexName: string;
  token0: string;
  token1: string;
  token0Symbol: string;
  token1Symbol: string;
  reserve0: bigint;
  reserve1: bigint;
  totalSupply: bigint;
  category: 'active' | 'abandoned';
  isNew?: boolean; // Discovered by delta scan, not in hardcoded list
}

/**
 * Delta scan: Check factories for pools NOT in the hardcoded list.
 * Runs after initial load, discovers newly created pools.
 */
async function deltaScanNewPools(
  knownAddresses: Set<string>,
  tokenRegistry: Map<string, { symbol: string }>,
): Promise<FactoryPool[]> {
  const publicClient = createPublicClient({ chain: dogechain, transport: http() });
  const newPools: FactoryPool[] = [];

  for (const factory of FACTORIES) {
    try {
      const pairCount = await publicClient.readContract({
        address: factory.address,
        abi: factoryAbi,
        functionName: 'allPairsLength',
      }) as bigint;

      // Only check the most recent 50 pairs per factory for new OMNOM pools
      // Older pairs are already in the hardcoded list
      const startIdx = pairCount > 50n ? pairCount - 50n : 0n;

      for (let i = startIdx; i < pairCount; i++) {
        try {
          const pairAddr = await publicClient.readContract({
            address: factory.address,
            abi: factoryAbi,
            functionName: 'allPairs',
            args: [i],
          }) as string;

          const pairLower = pairAddr.toLowerCase();
          if (knownAddresses.has(pairLower)) continue;

          // Check if this pair involves OMNOM
          let token0 = '', token1 = '';
          try {
            token0 = (await publicClient.readContract({
              address: getAddress(pairAddr) as `0x${string}`,
              abi: pairAbi,
              functionName: 'token0',
            }) as string).toLowerCase();
            token1 = (await publicClient.readContract({
              address: getAddress(pairAddr) as `0x${string}`,
              abi: pairAbi,
              functionName: 'token1',
            }) as string).toLowerCase();
          } catch { continue; }

          const omnomLower = OMNOM_TOKEN.toLowerCase();
          if (token0 !== omnomLower && token1 !== omnomLower) continue;

          // Found a new OMNOM pool!
          const t0info = tokenRegistry.get(token0);
          const t1info = tokenRegistry.get(token1);

          newPools.push({
            pairAddress: pairLower,
            dexId: factory.dexId,
            dexName: factory.name,
            token0,
            token1,
            token0Symbol: t0info?.symbol || getTokenSymbol(tokenRegistry as Map<string, { symbol: string; name: string; address: string; decimals?: number }>, token0),
            token1Symbol: t1info?.symbol || getTokenSymbol(tokenRegistry as Map<string, { symbol: string; name: string; address: string; decimals?: number }>, token1),
            reserve0: 0n,
            reserve1: 0n,
            totalSupply: 0n,
            category: 'abandoned' as const,
            isNew: true,
          });

          knownAddresses.add(pairLower);
          console.log(`[PoolScanner] NEW pool: ${factory.name} ${pairLower.slice(0, 10)}...`);
        } catch { /* skip individual pair errors */ }
      }
    } catch (e) {
      console.warn(`[PoolScanner] Delta scan failed for ${factory.name}:`, e);
    }
  }

  return newPools;
}

/**
 * Main entry: Load pools instantly, then enrich with live reserves.
 */
export async function scanFactoriesForOmnomPools(): Promise<FactoryPool[]> {
  const now = Date.now();

  if (cachedPools && now - cachedPools.timestamp < CACHE_TTL_MS) {
    console.log('[PoolScanner] Returning cached results');
    return cachedPools.pools;
  }

  console.log('[PoolScanner] Loading pools...');

  // Step 1: Discover token metadata (for symbol resolution)
  const tokenRegistry = await discoverOmnomTokens();

  // Step 2: Start with hardcoded pools
  const knownAddresses = new Set(KNOWN_POOLS.map(p => p.pairAddress.toLowerCase()));
  const poolsByAddress = new Map<string, FactoryPool>();

  for (const known of KNOWN_POOLS) {
    const key = known.pairAddress.toLowerCase();
    poolsByAddress.set(key, {
      pairAddress: known.pairAddress,
      dexId: known.dexId,
      dexName: known.dexName,
      token0: known.token0Address,
      token1: known.token1Address,
      token0Symbol: known.token0Symbol || getTokenSymbol(tokenRegistry, known.token0Address),
      token1Symbol: known.token1Symbol || getTokenSymbol(tokenRegistry, known.token1Address),
      reserve0: 0n,
      reserve1: 0n,
      totalSupply: 0n,
      category: 'active',
    });
  }

  console.log(`[PoolScanner] ${KNOWN_POOLS.length} hardcoded pools loaded`);

  // Step 3: Fetch reserves for ALL pools via Multicall3 (~2 seconds)
  const allAddresses = Array.from(poolsByAddress.keys());
  console.log(`[PoolScanner] Fetching reserves for ${allAddresses.length} pools via Multicall3...`);

  let reserves: PoolReserves[] = [];
  try {
    reserves = await fetchAllReserves(allAddresses);
    console.log(`[PoolScanner] Got reserves for ${reserves.length} pools`);
  } catch (e) {
    console.warn('[PoolScanner] Multicall3 reserves fetch failed:', e);
  }

  // Step 4: Merge reserves into pool data + filter dead pools
  for (const r of reserves) {
    const pool = poolsByAddress.get(r.pairAddress.toLowerCase());
    if (pool) {
      pool.reserve0 = r.reserve0;
      pool.reserve1 = r.reserve1;
      pool.totalSupply = r.totalSupply;
      pool.category = r.hasLiquidity ? 'active' : 'abandoned';
    }
  }

  // Step 5: Delta scan for new pools (async, doesn't block initial display)
  console.log('[PoolScanner] Running delta scan for new pools...');
  try {
    const newPools = await deltaScanNewPools(knownAddresses, tokenRegistry);
    if (newPools.length > 0) {
      // Fetch reserves for newly discovered pools too
      const newReserves = await fetchAllReserves(newPools.map(p => p.pairAddress));
      for (let i = 0; i < newPools.length; i++) {
        const nr = newReserves[i];
        if (nr) {
          newPools[i].reserve0 = nr.reserve0;
          newPools[i].reserve1 = nr.reserve1;
          newPools[i].totalSupply = nr.totalSupply;
          newPools[i].category = nr.hasLiquidity ? 'active' : 'abandoned';
        }
        poolsByAddress.set(newPools[i].pairAddress.toLowerCase(), newPools[i]);
      }
      console.log(`[PoolScanner] Delta scan found ${newPools.length} new pools`);
    } else {
      console.log('[PoolScanner] No new pools found');
    }
  } catch (e) {
    console.warn('[PoolScanner] Delta scan failed:', e);
  }

  const allPools = Array.from(poolsByAddress.values());
  const active = allPools.filter(p => p.category === 'active').length;
  const abandoned = allPools.filter(p => p.category === 'abandoned').length;

  console.log(`[PoolScanner] Total: ${allPools.length} pools (${active} active, ${abandoned} abandoned)`);

  cachedPools = { pools: allPools, timestamp: now };
  saveToStorage(cachedPools);

  return allPools;
}

export function clearPoolScannerCache(): void {
  cachedPools = null;
  try { localStorage.removeItem(STORAGE_KEY); } catch {}
  console.log('[PoolScanner] Cache cleared');
}
