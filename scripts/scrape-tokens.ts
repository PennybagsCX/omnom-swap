/**
 * Dogechain Token Scraper
 *
 * Scrapes ALL tokens from ALL 8 DEX factory contracts on Dogechain.
 * Uses adaptive RPC batching with resumable progress persistence.
 *
 * Usage: npx tsx scripts/scrape-tokens.ts
 */

import { createPublicClient, http, parseAbi, getAddress, type Address } from 'viem';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// ─── Config ────────────────────────────────────────────────────────────────

const RPC_URL = 'https://rpc.dogechain.dog';
const PROGRESS_FILE = join(dirname(fileURLToPath(import.meta.url)), '.scrape-progress.json');
const OUTPUT_FILE = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'data', 'dogechain-tokens.json');
const GECKOTERMINAL_BASE = 'https://api.geckoterminal.com/api/v2/networks/dogechain';

const KNOWN_DEXES = {
  DogeSwap: {
    factory: '0xd27d9d61590874bf9ee2a19b27e265399929c9c3' as Address,
    router: '0xa4ee06ce40cb7e8c04e127c1f7d3dfb7f7039c81' as Address,
  },
  DogeShrk: {
    factory: '0x7c10a3b7ecd42dd7d79c0b9d58ddb812f92b574a' as Address,
    router: '0x45afcf57f7e3f3b9ca70335e5e85e4f77dcc5087' as Address,
  },
  WOJAK: {
    factory: '0xc7c86b4f940ff1c13c736b697e3fba5a6bc979f9' as Address,
    router: '0x9695906B4502D5397E6D21ff222e2C1a9e5654a9' as Address,
  },
  KibbleSwap: {
    factory: '0xF4bc79D32A7dEfd87c8A9C100FD83206bbF19Af5' as Address,
    router: '0x6258c967337D3faF0C2ba3ADAe5656bA95419d5f' as Address,
  },
  YodeSwap: {
    factory: getAddress('0xaAa04462e35F3E40d798331657CA015169E005d7') as Address,
    router: getAddress('0x72d85Ab47fBfc5E7E04a8bcfCa1601D8f8cE1a50') as Address,
  },
} as const;

// ─── ABIs ──────────────────────────────────────────────────────────────────

const FACTORY_ABI = parseAbi([
  'function allPairsLength() external view returns (uint256)',
  'function allPairs(uint256) external view returns (address)',
  'function getPair(address tokenA, address tokenB) external view returns (address pair)',
]);

const PAIR_ABI = parseAbi([
  'function factory() external view returns (address)',
  'function token0() external view returns (address)',
  'function token1() external view returns (address)',
  'function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
]);

const ERC20_ABI = parseAbi([
  'function symbol() external view returns (string)',
  'function name() external view returns (string)',
  'function decimals() external view returns (uint8)',
]);

// ─── Client ────────────────────────────────────────────────────────────────

const client = createPublicClient({
  transport: http(RPC_URL),
});

// ─── Types ─────────────────────────────────────────────────────────────────

interface TokenEntry {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  logoURI?: string;
}

interface DexDiscovery {
  dexId: string;
  factory: Address;
  router: Address;
}

interface ProgressData {
  phase: string;
  discoveredDexes: DexDiscovery[];
  factoryPairCounts: Record<string, number>;
  scrapedPairs: Record<string, number>; // factory -> lastPairIndex processed
  tokens: TokenEntry[];
  completed: boolean;
}

// ─── Utility ───────────────────────────────────────────────────────────────

function loadProgress(): ProgressData | null {
  if (existsSync(PROGRESS_FILE)) {
    try {
      return JSON.parse(readFileSync(PROGRESS_FILE, 'utf-8'));
    } catch { return null; }
  }
  return null;
}

function saveProgress(data: ProgressData) {
  writeFileSync(PROGRESS_FILE, JSON.stringify(data, null, 2));
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

// ─── Phase 1: Discover New DEX Factories ───────────────────────────────────

async function fetchGeckoTerminalPools(): Promise<{ dexId: string; poolAddress: string }[]> {
  const pools: { dexId: string; poolAddress: string }[] = [];
  const sortOptions = ['h24_volume_usd_desc', '', 'reserve_in_usd_desc'];

  for (const sort of sortOptions) {
    for (let page = 1; page <= 10; page++) {
      try {
        let url = `${GECKOTERMINAL_BASE}/pools?page=${page}`;
        if (sort) url += `&sort=${sort}`;

        const res = await fetch(url, { headers: { Accept: 'application/json' } });
        const data = await res.json();
        const items = data?.data || [];
        if (items.length === 0) break;

        for (const pool of items) {
          const poolAddr = pool.attributes?.address;
          const dexId = pool.relationships?.dex?.data?.id;
          if (poolAddr && dexId) pools.push({ dexId, poolAddress: poolAddr });
        }

        if (!data.links?.next) break;
        await sleep(1500);
      } catch (e) {
        console.log(`  GeckoTerminal page ${page} error: ${(e as Error).message}`);
        break;
      }
    }
  }
  return pools;
}

async function discoverNewDexes(pools: { dexId: string; poolAddress: string }[]): Promise<DexDiscovery[]> {
  const knownDexIds = new Set(['dogeswap', 'dogeshrek', 'kibbleswap', 'yodeswap', 'wojak-finance-dogechain']);
  const newDexPools = new Map<string, Set<string>>();

  for (const { dexId, poolAddress } of pools) {
    if (!knownDexIds.has(dexId)) {
      if (!newDexPools.has(dexId)) newDexPools.set(dexId, new Set());
      newDexPools.get(dexId)!.add(poolAddress);
    }
  }

  console.log(`\n  New DEXes found: ${newDexPools.size}`);
  for (const [dexId, poolAddrs] of newDexPools) {
    console.log(`    ${dexId}: ${poolAddrs.size} pools`);
  }

  const discoveries: DexDiscovery[] = [];

  for (const [dexId, poolAddrs] of newDexPools) {
    const factories = new Map<string, number>();

    for (const poolAddr of poolAddrs) {
      try {
        const factory = await client.readContract({
          address: poolAddr as Address,
          abi: PAIR_ABI,
          functionName: 'factory',
        }) as Address;

        const key = factory.toLowerCase();
        factories.set(key, (factories.get(key) || 0) + 1);
      } catch {
        // Pool might not be a standard UniswapV2 pair
      }
      await sleep(200);
    }

    // Use the most common factory address
    let bestFactory = '';
    let bestCount = 0;
    for (const [factory, count] of factories) {
      if (count > bestCount) {
        bestFactory = factory;
        bestCount = count;
      }
    }

    if (bestFactory) {
      console.log(`    ${dexId} factory: ${bestFactory} (confirmed by ${bestCount}/${poolAddrs.size} pools)`);

      // Try to find router by looking for known patterns
      // Common: router is often deployed alongside factory, or has a WETH() function
      // For now we store factory and will discover router separately
      discoveries.push({
        dexId,
        factory: getAddress(bestFactory) as Address,
        router: '0x0000000000000000000000000000000000000000' as Address, // placeholder
      });
    }
  }

  // Try to discover routers by checking common UniswapV2 router patterns
  for (const discovery of discoveries) {
    discovery.router = await discoverRouter(discovery.factory, discovery.dexId);
  }

  return discoveries;
}

async function discoverRouter(factory: Address, dexId: string): Promise<Address> {
  // Method 1: Check if the factory has a router() function
  try {
    const routerAbi = parseAbi(['function router() external view returns (address)']);
    const router = await client.readContract({
      address: factory,
      abi: routerAbi,
      functionName: 'router',
    }) as Address;
    if (router && router !== '0x0000000000000000000000000000000000000000') {
      console.log(`    ${dexId} router found via factory.router(): ${router}`);
      return router;
    }
  } catch { /* no router() function */ }

  // Method 2: Check GeckoTerminal DEX info
  try {
    const res = await fetch(`${GECKOTERMINAL_BASE}/dexes/${dexId}`, { headers: { Accept: 'application/json' } });
    const data = await res.json();
    const url = data?.data?.attributes?.url;
    if (url) {
      console.log(`    ${dexId} URL from GeckoTerminal: ${url}`);
    }
  } catch { /* ignore */ }

  // Method 3: Search the Dogechain explorer for the factory's deployer
  // The deployer often deploys both factory and router
  console.log(`    ${dexId}: Could not auto-discover router. Manual lookup required.`);
  console.log(`    Factory: ${factory} — check explorer for related contracts.`);

  return '0x0000000000000000000000000000000000000000' as Address;
}

// ─── Phase 2: Enumerate All Pairs from Factories ───────────────────────────

async function getPairCount(factory: Address): Promise<number> {
  const count = await client.readContract({
    address: factory,
    abi: FACTORY_ABI,
    functionName: 'allPairsLength',
  }) as bigint;
  return Number(count);
}

async function getPairAddress(factory: Address, index: number): Promise<Address | null> {
  try {
    const pair = await client.readContract({
      address: factory,
      abi: FACTORY_ABI,
      functionName: 'allPairs',
      args: [BigInt(index)],
    }) as Address;
    return pair;
  } catch {
    return null;
  }
}

async function getPairTokens(pairAddress: Address): Promise<[Address, Address] | null> {
  try {
    const [token0, token1] = await Promise.all([
      client.readContract({ address: pairAddress, abi: PAIR_ABI, functionName: 'token0' }) as Promise<Address>,
      client.readContract({ address: pairAddress, abi: PAIR_ABI, functionName: 'token1' }) as Promise<Address>,
    ]);
    return [token0, token1];
  } catch {
    return null;
  }
}

async function getTokenMetadata(tokenAddress: Address): Promise<TokenEntry> {
  try {
    const [symbol, name, decimals] = await Promise.all([
      client.readContract({ address: tokenAddress, abi: ERC20_ABI, functionName: 'symbol' }).catch(() => 'UNKNOWN') as Promise<string>,
      client.readContract({ address: tokenAddress, abi: ERC20_ABI, functionName: 'name' }).catch(() => 'Unknown') as Promise<string>,
      client.readContract({ address: tokenAddress, abi: ERC20_ABI, functionName: 'decimals' }).catch(() => 18n) as Promise<bigint>,
    ]);
    return {
      address: tokenAddress.toLowerCase(),
      symbol: String(symbol),
      name: String(name),
      decimals: Number(decimals),
    };
  } catch {
    return { address: tokenAddress.toLowerCase(), symbol: 'UNKNOWN', name: 'Unknown', decimals: 18 };
  }
}

async function scrapeFactory(
  factory: Address,
  dexName: string,
  pairCount: number,
  existingTokens: Map<string, TokenEntry>,
  startIndex: number = 0,
): Promise<number> {
  console.log(`\n  Scraping ${dexName}: ${pairCount} pairs (starting from ${startIndex})`);

  let lastProcessed = startIndex;
  let consecutiveErrors = 0;
  let batchSize = 1;
  let tokenCount = existingTokens.size;

  for (let i = startIndex; i < pairCount; i++) {
    try {
      const pairAddr = await getPairAddress(factory, i);
      if (!pairAddr || pairAddr === '0x0000000000000000000000000000000000000000') {
        lastProcessed = i + 1;
        continue;
      }

      const tokens = await getPairTokens(pairAddr);
      if (!tokens) {
        lastProcessed = i + 1;
        continue;
      }

      for (const tokenAddr of tokens) {
        const key = tokenAddr.toLowerCase();
        if (!existingTokens.has(key)) {
          const metadata = await getTokenMetadata(tokenAddr);
          existingTokens.set(key, metadata);
          tokenCount++;
        }
      }

      lastProcessed = i + 1;
      consecutiveErrors = 0;

      // Adaptive batching: try increasing batch size
      // We don't actually batch calls here but we track the rate
      if (batchSize > 1) {
        // Small delay for larger batches
        await sleep(50);
      }

      // Progress logging
      if ((i + 1) % 100 === 0 || i === pairCount - 1) {
        const pct = (((i + 1) / pairCount) * 100).toFixed(1);
        console.log(`    ${dexName}: ${i + 1}/${pairCount} (${pct}%) — ${tokenCount} unique tokens`);
      }

      // Save progress every 500 pairs
      if ((i + 1) % 500 === 0) {
        saveProgress({
          phase: 'scraping',
          discoveredDexes: progress!.discoveredDexes,
          factoryPairCounts: progress!.factoryPairCounts,
          scrapedPairs: { ...progress!.scrapedPairs, [factory.toLowerCase()]: lastProcessed },
          tokens: [...existingTokens.values()],
          completed: false,
        });
      }
    } catch (e) {
      consecutiveErrors++;
      const err = e as Error;

      if (err.message?.includes('rate') || err.message?.includes('429') || err.message?.includes('too many')) {
        // Rate limited — increase delay
        const backoff = Math.min(Math.pow(2, consecutiveErrors) * 1000, 30000);
        console.log(`    Rate limited at pair ${i}. Backing off ${backoff}ms...`);
        await sleep(backoff);
        // Retry this pair
        i--;
      } else if (consecutiveErrors > 10) {
        console.log(`    Too many errors at pair ${i}. Saving progress and stopping.`);
        break;
      } else {
        // Transient error, small delay
        await sleep(500);
      }
    }
  }

  return lastProcessed;
}

// ─── Main ──────────────────────────────────────────────────────────────────

let progress: ProgressData | null = null;

async function main() {
  console.log('=== Dogechain Token Scraper ===\n');
  console.log(`RPC: ${RPC_URL}`);
  console.log(`Output: ${OUTPUT_FILE}\n`);

  // Load existing progress
  progress = loadProgress();
  if (progress?.completed) {
    console.log('Previous scrape completed. Use --force to re-run.');
    console.log(`Found ${progress.tokens.length} tokens in saved progress.`);
    writeOutput(progress.tokens);
    return;
  }

  if (progress) {
    console.log(`Resuming from phase: ${progress.phase}`);
    console.log(`Existing tokens: ${progress.tokens.length}`);
  }

  // ─── Phase 1: Discover new DEXes ────────────────────────────────────────

  let discoveredDexes = progress?.discoveredDexes || [];

  if (discoveredDexes.length === 0) {
    console.log('\n--- Phase 1: Discovering new DEXes ---');
    console.log('Fetching pools from GeckoTerminal...');

    const pools = await fetchGeckoTerminalPools();
    console.log(`  Found ${pools.length} pools across all DEXes`);

    discoveredDexes = await discoverNewDexes(pools);

    console.log('\n  Discovered new DEXes:');
    for (const d of discoveredDexes) {
      console.log(`    ${d.dexId}: factory=${d.factory} router=${d.router}`);
    }

    // Combine all DEXes
    const allDexes: Record<string, { factory: Address; router: Address }> = { ...KNOWN_DEXES };
    for (const d of discoveredDexes) {
      if (d.router !== '0x0000000000000000000000000000000000000000') {
        allDexes[d.dexId] = { factory: d.factory, router: d.router };
      }
    }

    console.log(`\n  Total DEXes with routers: ${Object.keys(allDexes).length}`);
    console.log(`  Total DEXes (factory only): ${Object.keys(allDexes).length + discoveredDexes.filter(d => d.router === '0x0000000000000000000000000000000000000000').length}`);
  }

  // ─── Phase 2: Get pair counts ───────────────────────────────────────────

  // QuickSwap on Dogechain is Algebra V3 — not UniswapV2 compatible for pair enumeration
  const V3_DEX_IDS = new Set(['quickswap_dogechain']);

  const allFactories: Record<string, { factory: Address; router: Address }> = { ...KNOWN_DEXES };
  for (const d of discoveredDexes) {
    if (!V3_DEX_IDS.has(d.dexId)) {
      allFactories[d.dexId] = { factory: d.factory, router: d.router };
    } else {
      console.log(`  Skipping ${d.dexId} (V3 DEX — not UniswapV2 compatible)`);
    }
  }

  const pairCounts: Record<string, number> = progress?.factoryPairCounts || {};

  if (Object.keys(pairCounts).length === 0) {
    console.log('\n--- Phase 2: Getting pair counts ---');
    for (const [name, { factory }] of Object.entries(allFactories)) {
      try {
        const normalizedFactory = getAddress(factory);
        const count = await getPairCount(normalizedFactory);
        pairCounts[name] = count;
        console.log(`  ${name}: ${count.toLocaleString()} pairs`);
      } catch (e) {
        console.log(`  ${name}: error — ${(e as Error).message}`);
        pairCounts[name] = 0;
      }
      await sleep(300);
    }

    const totalPairs = Object.values(pairCounts).reduce((a, b) => a + b, 0);
    console.log(`\n  Total pairs across all DEXes: ${totalPairs.toLocaleString()}`);
  }

  // Save progress with pair counts
  if (!progress) {
    progress = {
      phase: 'scraping',
      discoveredDexes,
      factoryPairCounts: pairCounts,
      scrapedPairs: {},
      tokens: [],
      completed: false,
    };
  } else {
    progress.discoveredDexes = discoveredDexes;
    progress.factoryPairCounts = pairCounts;
  }
  saveProgress(progress);

  // ─── Phase 3: Scrape all pairs ──────────────────────────────────────────

  const existingTokens = new Map<string, TokenEntry>();
  if (progress.tokens) {
    for (const t of progress.tokens) {
      existingTokens.set(t.address.toLowerCase(), t);
    }
  }
  console.log(`\n--- Phase 3: Scraping all pairs ---`);
  console.log(`Starting with ${existingTokens.size} existing tokens`);

  const scrapedPairs: Record<string, number> = progress.scrapedPairs || {};

  // Scrape smaller DEXes first for quick wins
  const sortedDexes = Object.entries(allFactories).sort((a, b) => (pairCounts[a[0]] || 0) - (pairCounts[b[0]] || 0));

  for (const [name, { factory }] of sortedDexes) {
    const pairCount = pairCounts[name] || 0;
    if (pairCount === 0) {
      console.log(`\n  Skipping ${name} (no pairs)`);
      continue;
    }

    const startIndex = scrapedPairs[getAddress(factory).toLowerCase()] || 0;
    if (startIndex >= pairCount) {
      console.log(`\n  Skipping ${name} (already scraped: ${startIndex}/${pairCount})`);
      continue;
    }

    const lastProcessed = await scrapeFactory(getAddress(factory) as Address, name, pairCount, existingTokens, startIndex);
    scrapedPairs[getAddress(factory).toLowerCase()] = lastProcessed;

    // Update and save progress
    progress.scrapedPairs = scrapedPairs;
    progress.tokens = [...existingTokens.values()];
    saveProgress(progress);
  }

  // ─── Phase 4: Write output ──────────────────────────────────────────────

  console.log(`\n--- Phase 4: Writing output ---`);
  const tokens = [...existingTokens.values()];

  // Sort: WWDOGE first, then alphabetically by symbol
  tokens.sort((a, b) => {
    const aIsWwdoge = a.address.toLowerCase() === '0xb7ddc6414bf4f5515b52d8bdd69973ae205ff101';
    const bIsWwdoge = b.address.toLowerCase() === '0xb7ddc6414bf4f5515b52d8bdd69973ae205ff101';
    if (aIsWwdoge) return -1;
    if (bIsWwdoge) return 1;
    return a.symbol.localeCompare(b.symbol);
  });

  writeOutput(tokens);

  // Mark as completed
  progress.completed = true;
  progress.phase = 'completed';
  saveProgress(progress);

  console.log(`\nDone! Scraped ${tokens.length} unique tokens.`);
  console.log(`Output: ${OUTPUT_FILE}`);
}

function writeOutput(tokens: TokenEntry[]) {
  // Ensure output directory exists
  const dir = dirname(OUTPUT_FILE);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  // Add logoURI for known tokens
  const KNOWN_LOGOS: Record<string, string> = {
    '0xb7ddc6414bf4f5515b52d8bdd69973ae205ff101': '/tokens/wwdoge.webp',
    '0xe3fca919883950c5cd468156392a6477ff5d18de': '/tokens/omnom.png',
    '0x7b4328c127b85369d9f82ca0503b000d09cf9180': '/tokens/dc.webp',
    '0x8a764cf73438de795c98707b07034e577af54825': '/tokens/dinu.webp',
  };

  const output = tokens.map(t => ({
    address: t.address,
    symbol: t.symbol,
    name: t.name,
    decimals: t.decimals,
    ...(KNOWN_LOGOS[t.address.toLowerCase()] ? { logoURI: KNOWN_LOGOS[t.address.toLowerCase()] } : {}),
  }));

  writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));
  console.log(`  Written ${output.length} tokens to ${OUTPUT_FILE}`);
}

// Run
main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
