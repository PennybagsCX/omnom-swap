/**
 * Event Log Scanner — Finds ALL OMNOM pairs from factory creation events.
 *
 * DexScreener only returns active pools with recent activity.
 * Event logs contain EVERY pair ever created, including:
 * - Active pools (has liquidity)
 * - Empty pools (created but no liquidity)
 * - Abandoned pools (created but never used, or rugpulled)
 *
 * Strategy:
 * 1. Scan PairCreated events from each factory contract
 * 2. Filter by OMNOM_TOKEN (token0 or token1)
 * 3. Extract pair addresses and creation block numbers
 * 4. Categorize by age and activity
 * 5. Cache results (event logs are immutable, so cache for 1 hour)
 */

import { createPublicClient, http, parseAbi, getAddress } from 'viem';
import { dogechain } from 'wagmi/chains';
import { CONTRACTS } from '../../lib/constants';

const OMNOM_TOKEN = CONTRACTS.OMNOM_TOKEN.toLowerCase();

// All known DEX factories on Dogechain
const FACTORIES = [
  { name: 'DogeSwap', address: CONTRACTS.DOGESWAP_FACTORY as `0x${string}`, dexId: 'dogeswap', deploymentBlock: 0 },
  { name: 'DogeShrk', address: CONTRACTS.DOGESHRK_FACTORY as `0x${string}`, dexId: 'dogeshrek', deploymentBlock: 0 },
  { name: 'WOJAK', address: CONTRACTS.WOJAK_FACTORY as `0x${string}`, dexId: 'wojak', deploymentBlock: 0 },
  { name: 'KibbleSwap', address: CONTRACTS.KIBBLESWAP_FACTORY as `0x${string}`, dexId: 'kibbleswap', deploymentBlock: 0 },
  { name: 'YodeSwap', address: CONTRACTS.YODESWAP_FACTORY as `0x${string}`, dexId: 'yodeswap', deploymentBlock: 0 },
  { name: 'FraxSwap', address: CONTRACTS.FRAXSWAP_FACTORY as `0x${string}`, dexId: 'fraxswap', deploymentBlock: 0 },
  { name: 'ToolSwap', address: CONTRACTS.TOOLSWAP_FACTORY as `0x${string}`, dexId: 'toolswap', deploymentBlock: 0 },
  { name: 'DMUSK', address: CONTRACTS.DMUSK_FACTORY as `0x${string}`, dexId: 'dmusk', deploymentBlock: 0 },
  { name: 'IceCreamSwap', address: CONTRACTS.ICECREAMSWAP_FACTORY as `0x${string}`, dexId: 'icecreamswap', deploymentBlock: 0 },
  { name: 'PupSwap', address: CONTRACTS.PUPSWAP_FACTORY as `0x${string}`, dexId: 'pupswap', deploymentBlock: 0 },
  { name: 'Bourbon Defi', address: CONTRACTS.BOURBONSWAP_FACTORY as `0x${string}`, dexId: 'bourbondefi', deploymentBlock: 0 },
  { name: 'BreadFactory', address: CONTRACTS.BREADFACTORY_FACTORY as `0x${string}`, dexId: 'breadfactory', deploymentBlock: 0 },
] as const;

const pairCreatedAbi = parseAbi([
  'event PairCreated(address indexed sender, uint256 amount0, uint256 amount1, address token0, address token1, address pair)',
]);

const pairAbi = parseAbi([
  'function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
  'function totalSupply() external view returns (uint256)',
]);

// Cache for scan results
type CachedEventPools = {
  pools: EventPool[];
  timestamp: number;
};
let cachedPools: CachedEventPools | null = null;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour (event logs are immutable)

const STORAGE_KEY = 'omnom_event_pools_v2'; // v2: removed 'empty' category (merged into 'abandoned')

// Serialize: bigint → string
function serializePools(pools: EventPool[]): string {
  return JSON.stringify(pools.map(p => ({
    ...p,
    totalSupply: p.totalSupply.toString(),
  })));
}

// Deserialize: string → bigint
function deserializePools(raw: string): EventPool[] {
  return JSON.parse(raw).map((p: Record<string, unknown>) => ({
    ...p,
    totalSupply: BigInt(p.totalSupply as string),
  }));
}

// Load from localStorage on module init
function loadFromStorage(): CachedEventPools | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const { pools, timestamp } = JSON.parse(raw) as { pools: string; timestamp: number };
    return { pools: deserializePools(pools), timestamp };
  } catch {
    return null;
  }
}

// Save to localStorage
function saveToStorage(cached: CachedEventPools): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      pools: serializePools(cached.pools),
      timestamp: cached.timestamp,
    }));
  } catch {
    // localStorage full — skip
  }
}

// Initialize from localStorage
cachedPools = loadFromStorage();

export interface EventPool {
  pairAddress: string;
  dexId: string;
  dexName: string;
  token0: string;
  token1: string;
  creationBlock: number;
  creationTx: string;
  hasReserves: boolean;
  hasLiquidity: boolean;
  totalSupply: bigint;
  category: 'active' | 'abandoned';
}

/**
 * Scan PairCreated events from all factories to find ALL OMNOM pairs.
 * This finds inactive, empty, and abandoned pools that DexScreener misses.
 */
export async function scanEventLogsForOmnomPools(): Promise<EventPool[]> {
  const now = Date.now();

  // Return cached results if fresh
  if (cachedPools && now - cachedPools.timestamp < CACHE_TTL_MS) {
    console.log('[EventLogScanner] Returning cached results');
    return cachedPools.pools;
  }

  console.log('[EventLogScanner] Scanning factory event logs for ALL OMNOM pairs...');

  const publicClient = createPublicClient({
    chain: dogechain,
    transport: http(),
  });

  const allPools: EventPool[] = [];

  for (const factory of FACTORIES) {
    try {
      console.log(`[EventLogScanner] Scanning ${factory.name}...`);

      // Get PairCreated events from factory
      const logs = await publicClient.getLogs({
        address: factory.address,
        event: pairCreatedAbi[0],
        fromBlock: 'earliest',
        toBlock: 'latest',
      });

      console.log(`[EventLogScanner] ${factory.name}: Found ${logs.length} PairCreated events`);

      // Process each event
      for (const log of logs) {
          // Extract event data
          const args = log.args as {
            token0: string;
            token1: string;
            pair: string;
          } | undefined;

          if (!args) continue;

          const { token0, token1, pair: pairAddress } = args;

          const t0Lower = token0.toLowerCase();
          const t1Lower = token1.toLowerCase();
          const omnomLower = OMNOM_TOKEN;

          // Filter: only OMNOM pairs
          if (t0Lower !== omnomLower && t1Lower !== omnomLower) {
            continue;
          }

          const creationBlock = Number(log.blockNumber);
          const creationTx = log.transactionHash;

          // Check pool state by reading reserves and totalSupply
          let hasReserves = false;
          let hasLiquidity = false;
          let totalSupply = 0n;
          let category: EventPool['category'] = 'abandoned';

          try {
            const [reserves, supply] = await Promise.all([
              publicClient.readContract({
                address: getAddress(pairAddress),
                abi: pairAbi,
                functionName: 'getReserves',
              }).catch(() => null),
              publicClient.readContract({
                address: getAddress(pairAddress),
                abi: pairAbi,
                functionName: 'totalSupply',
              }).catch(() => null),
            ]);

            if (reserves && supply) {
              const [reserve0, reserve1] = reserves as [bigint, bigint, number];
              totalSupply = supply as bigint;
              hasReserves = true;
              hasLiquidity = reserve0 > 0n || reserve1 > 0n;

              // Categorize pool (empty pools merged into abandoned)
              category = hasLiquidity ? 'active' : 'abandoned';
            }
          } catch {
            // Contract doesn't exist or failed to read
            category = 'abandoned';
          }

          allPools.push({
            pairAddress: pairAddress.toLowerCase(),
            dexId: factory.dexId,
            dexName: factory.name,
            token0: t0Lower,
            token1: t1Lower,
            creationBlock,
            creationTx: creationTx,
            hasReserves,
            hasLiquidity,
            totalSupply,
            category,
          });

          const statusSymbol = category === 'active' ? '✓' : '✗';
          console.log(`  ${statusSymbol} ${factory.name} OMNOM pair at ${pairAddress.toLowerCase().slice(0, 10)}... [${category.toUpperCase()}]`);
        }
    } catch (e) {
      console.warn(`[EventLogScanner] Failed to scan ${factory.name}:`, e);
    }
  }

  console.log(`[EventLogScanner] Total OMNOM pairs found: ${allPools.length}`);
  console.log(`  Active: ${allPools.filter(p => p.category === 'active').length}`);
  console.log(`  Abandoned: ${allPools.filter(p => p.category === 'abandoned').length}`);

  // Cache results (memory + localStorage)
  cachedPools = { pools: allPools, timestamp: now };
  saveToStorage(cachedPools);

  return allPools;
}

/**
 * Clear the event log scanner cache
 */
export function clearEventLogScannerCache(): void {
  cachedPools = null;
  try { localStorage.removeItem(STORAGE_KEY); } catch {}
  console.log('[EventLogScanner] Cache cleared');
}
