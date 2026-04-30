/**
 * Debug script to investigate pool fetching for DOGE→DC swap across all DEXes.
 * Run with: npx tsx scripts/debug-pool-fetcher.ts
 * 
 * Standalone script that does NOT import from src/ (avoids import.meta.env issues)
 */

import { createPublicClient, http, parseAbi, getAddress } from 'viem';
import { dogechain } from 'wagmi/chains';

// ─── Constants (duplicated from src/lib/constants.ts to avoid import issues) ───

const CONTRACTS = {
  WWDOGE: '0xb7ddc6414bf4f5515b52d8bdd69973ae205ff101',
  DC_TOKEN: '0x7B4328c127B85369D9f82ca0503B000D09CF9180',
  OMNOM_TOKEN: '0xe3fca919883950c5cd468156392a6477ff5d18de',
  DOGESWAP_V2_ROUTER: '0xa4ee06ce40cb7e8c04e127c1f7d3dfb7f7039c81',
  DOGESWAP_FACTORY: '0xd27d9d61590874bf9ee2a19b27e265399929c9c3',
  DOGESHRK_V2_ROUTER: '0x45afcf57f7e3f3b9ca70335e5e85e4f77dcc5087',
  DOGESHRK_FACTORY: '0x7c10a3b7ecd42dd7d79c0b9d58ddb812f92b574a',
  WOJAK_ROUTER: '0x9695906B4502D5397E6D21ff222e2C1a9e5654a9',
  WOJAK_FACTORY: '0xc7c86B4f940Ff1C13c736b697e3FbA5a6Bc979F9',
  KIBBLESWAP_ROUTER: '0x6258c967337D3faF0C2ba3ADAe5656bA95419d5f',
  KIBBLESWAP_FACTORY: '0xF4bc79D32A7dEfd87c8A9C100FD83206bbF19Af5',
  YODESWAP_ROUTER: '0x72d85ab47fbfc5e7e04a8bcfca1601d8f8ce1a50',
  YODESWAP_FACTORY: '0xaAa04462e35F3E40d798331657CA015169E005d7',
  FRAXSWAP_ROUTER: '0x0f6A5c5F341791e897eB1FB8fE8B4e30EC4F9bDf',
  FRAXSWAP_FACTORY: '0x67b7DA7c0564c6aC080f0A6D9fB4675e52E6bF1d',
  TOOLSWAP_ROUTER: '0x9BBF70e64fbe8Fc7afE8a5Ae90F2DB1165013F93',
  TOOLSWAP_FACTORY: '0xC3550497E591Ac6ed7a7E03ffC711CfB7412E57F',
  ICECREAMSWAP_ROUTER: '0xBb5e1777A331ED93E07cF043363e48d320eb96c4',
  ICECREAMSWAP_FACTORY: '0x9E6d21E759A7A288b80eef94E4737D313D31c13f',
  PUPSWAP_ROUTER: '0x05F2a20AF837268Be340a3bF82BB87069cF4a8C3',
  PUPSWAP_FACTORY: '0x0EBfEdC4A97D6B761a63Ad7c0a989e384ad59b3d',
  BOURBONSWAP_ROUTER: '0x6B172911a5Af8C9Eb2B7759688204624CcC9b0Ee',
  BOURBONSWAP_FACTORY: '0x6B09Aa7a03d918b08C8924591fc792ce9d80CBb5',
};

const DEX_REGISTRY = [
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

// Hub tokens (from poolFetcher.ts)
const HUB_TOKENS = [
  { address: CONTRACTS.WWDOGE, symbol: 'WWDOGE', decimals: 18 },
  { address: CONTRACTS.DC_TOKEN, symbol: 'DC', decimals: 18 },
  { address: CONTRACTS.OMNOM_TOKEN, symbol: 'OMNOM', decimals: 18 },
];

// MIN_RESERVE_OUT from pathFinder/index.ts
const MIN_RESERVE_OUT = BigInt('1000000000000000000'); // 1e18

// ─── ABI ──────────────────────────────────────────────────────────────────────

const FACTORY_ABI = parseAbi([
  'function getPair(address tokenA, address tokenB) external view returns (address pair)',
]);

const PAIR_ABI = parseAbi([
  'function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
  'function token0() external view returns (address)',
  'function token1() external view returns (address)',
]);

// ─── Client ───────────────────────────────────────────────────────────────────

const client = createPublicClient({ chain: dogechain, transport: http() });

// ─── Addresses ─────────────────────────────────────────────────────────────────

const WWDOGE = CONTRACTS.WWDOGE.toLowerCase();
const DC = CONTRACTS.DC_TOKEN.toLowerCase();
const OMNOM = CONTRACTS.OMNOM_TOKEN.toLowerCase();

// ─── Pool Discovery ─────────────────────────────────────────────────────────────

interface PoolInfo {
  dex: string;
  factory: string;
  pairAddress: string;
  reserve0: bigint;
  reserve1: bigint;
  reserve0Formatted: string;
  reserve1Formatted: string;
  token0: string;
  token1: string;
  belowThreshold: boolean;
}

async function getPoolInfo(factory: string, tokenA: string, tokenB: string, dexName: string): Promise<PoolInfo | null> {
  try {
    const pairAddress = await client.readContract({
      address: getAddress(factory),
      abi: FACTORY_ABI,
      functionName: 'getPair',
      args: [getAddress(tokenA), getAddress(tokenB)],
    }) as `0x${string}`;

    if (!pairAddress || pairAddress === '0x0000000000000000000000000000000000000000') {
      return null;
    }

    const [reserves, token0] = await Promise.all([
      client.readContract({ address: pairAddress, abi: PAIR_ABI, functionName: 'getReserves' }),
      client.readContract({ address: pairAddress, abi: PAIR_ABI, functionName: 'token0' }),
    ]);

    const [r0, r1] = reserves as [bigint, bigint, number];
    const t0 = (token0 as string).toLowerCase();
    
    // Determine token1 from reserves
    const t1 = t0 === tokenA.toLowerCase() 
      ? tokenB.toLowerCase() 
      : tokenA.toLowerCase();

    return {
      dex: dexName,
      factory: factory.toLowerCase(),
      pairAddress: pairAddress.toLowerCase(),
      reserve0: r0,
      reserve1: r1,
      reserve0Formatted: (Number(r0) / 1e18).toFixed(4),
      reserve1Formatted: (Number(r1) / 1e18).toFixed(4),
      token0: t0,
      token1: t1,
      belowThreshold: r0 < MIN_RESERVE_OUT || r1 < MIN_RESERVE_OUT,
    };
  } catch (e) {
    console.error(`Error fetching pool for ${dexName}:`, e);
    return null;
  }
}

async function checkAllDexesForPair(tokenA: string, tokenB: string, pairName: string) {
  console.log(`\n${'─'.repeat(80)}`);
  console.log(`CHECKING ${pairName} (${tokenA.slice(0, 10)}... → ${tokenB.slice(0, 10)}...)`);
  console.log(`─`.repeat(80));

  const results = await Promise.all(
    DEX_REGISTRY.map(dex => getPoolInfo(dex.factory, tokenA, tokenB, dex.name))
  );

  for (let i = 0; i < results.length; i++) {
    const pool = results[i];
    const dexName = DEX_REGISTRY[i]?.name || 'Unknown';
    if (pool) {
      const status = pool.belowThreshold ? '⚠️ FILTERED' : '✓ OK';
      console.log(`\n${status} ${pool.dex.padEnd(15)} | Pair: ${pool.pairAddress}`);
      console.log(`   Reserves: ${pool.reserve0Formatted} / ${pool.reserve1Formatted}`);
      console.log(`   Raw:      ${pool.reserve0.toString().padStart(30)} / ${pool.reserve1.toString()}`);
      if (pool.belowThreshold) {
        console.log(`   !! reserve0 (${pool.reserve0 < MIN_RESERVE_OUT ? 'LOW' : 'OK'}) / reserve1 (${pool.reserve1 < MIN_RESERVE_OUT ? 'LOW' : 'OK'}) below 1e18 threshold`);
      }
    } else {
      console.log(`\n✗ ${dexName.padEnd(15)} | No pool found`);
    }
  }
}

function simulateFetchPoolsForSwap(tokenIn: string, tokenOut: string) {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`SIMULATING fetchPoolsForSwap(${tokenIn.slice(0, 10)}..., ${tokenOut.slice(0, 10)}...)`);
  console.log(`HUB_TOKENS: ${HUB_TOKENS.map(h => h.symbol).join(', ')}`);
  console.log(`${'='.repeat(80)}`);

  const inLower = tokenIn.toLowerCase();
  const outLower = tokenOut.toLowerCase();
  const hubAddresses = HUB_TOKENS.map(h => h.address.toLowerCase());

  const isHub = (addr: string) => hubAddresses.includes(addr.toLowerCase());

  console.log(`\ntokenIn: ${tokenIn.slice(0, 10)}... isHub: ${isHub(inLower)}`);
  console.log(`tokenOut: ${tokenOut.slice(0, 10)}... isHub: ${isHub(outLower)}`);

  // Relevant hubs (excluding input/output tokens)
  const relevantHubs = HUB_TOKENS.filter(
    h => h.address.toLowerCase() !== inLower && h.address.toLowerCase() !== outLower,
  );
  console.log(`Relevant hubs: ${relevantHubs.map(h => h.symbol).join(', ')}`);

  // Build pairs that would be queried
  const pairs: { tA: string; tB: string; desc: string }[] = [];

  // 1. Direct pair
  pairs.push({ tA: tokenIn, tB: tokenOut, desc: 'Direct' });
  console.log(`\nPairs to query:`);
  console.log(`  1. Direct: ${tokenIn.slice(0, 10)}... ↔ ${tokenOut.slice(0, 10)}...`);

  // 2. Input leg via hubs (skip if input IS a hub)
  if (!isHub(inLower)) {
    for (const hub of relevantHubs) {
      pairs.push({ tA: tokenIn, tB: hub.address, desc: `Input leg (→${hub.symbol})` });
      console.log(`  2. Input leg: ${tokenIn.slice(0, 10)}... ↔ ${hub.symbol}`);
    }
  } else {
    console.log(`  2. Input leg: SKIPPED (tokenIn is a hub)`);
  }

  // 3. Output leg via hubs (skip if output IS a hub)
  if (!isHub(outLower)) {
    for (const hub of relevantHubs) {
      pairs.push({ tA: tokenOut, tB: hub.address, desc: `Output leg (←${hub.symbol})` });
      console.log(`  3. Output leg: ${tokenOut.slice(0, 10)}... ↔ ${hub.symbol}`);
    }
  } else {
    console.log(`  3. Output leg: SKIPPED (tokenOut is a hub)`);
  }

  // 4. Hub-to-hub
  if (relevantHubs.length >= 2) {
    for (let i = 0; i < relevantHubs.length; i++) {
      for (let j = i + 1; j < relevantHubs.length; j++) {
        pairs.push({ tA: relevantHubs[i].address, tB: relevantHubs[j].address, desc: 'Hub-to-hub' });
        console.log(`  4. Hub-to-hub: ${relevantHubs[i].symbol} ↔ ${relevantHubs[j].symbol}`);
      }
    }
  } else {
    console.log(`  4. Hub-to-hub: SKIPPED (fewer than 2 relevant hubs)`);
  }

  console.log(`\nTotal unique pairs: ${pairs.length}`);
  console.log(`Total queries (pairs × 10 DEXes): ${pairs.length * DEX_REGISTRY.length}`);

  return pairs;
}

async function main() {
  console.log('╔' + '═'.repeat(78) + '╗');
  console.log('║' + ' POOL FETCHER DEBUG SCRIPT '.padStart(40).padEnd(79) + '║');
  console.log('╚' + '═'.repeat(78) + '╝');
  
  console.log(`\nWWDOGE: ${WWDOGE}`);
  console.log(`DC:     ${DC}`);
  console.log(`OMNOM:  ${OMNOM}`);
  console.log(`MIN_RESERVE_OUT threshold: ${MIN_RESERVE_OUT.toString()} (${Number(MIN_RESERVE_OUT) / 1e18} tokens)`);

  // Scenario 1: DOGE → DC (both are HUB tokens)
  console.log('\n\n' + '╔'.padEnd(79, '═') + '╗');
  console.log('║ SCENARIO 1: WWDOGE → DC (BOTH ARE HUBS) '.padEnd(79) + '║');
  console.log('╚'.padEnd(79, '═') + '╝');
  
  const pairs1 = simulateFetchPoolsForSwap(WWDOGE, DC);
  
  console.log(`\n${'─'.repeat(80)}`);
  console.log('ACTUAL POOL DATA FOR SCENARIO 1:');
  console.log(`${'─'.repeat(80)}`);
  
  for (const { tA, tB, desc } of pairs1) {
    await checkAllDexesForPair(tA, tB, desc);
  }

  // Scenario 2: FRAX → DC (FRAX is NOT a hub)
  console.log('\n\n' + '╔'.padEnd(79, '═') + '╗');
  console.log('║ SCENARIO 2: Non-hub token → DC '.padEnd(79) + '║');
  console.log('╚'.padEnd(79, '═') + '╝');
  
  // Simulate with a non-existent but realistic token address
  const fakeNonHub = '0x1234567890123456789012345678901234567890';
  const pairs2 = simulateFetchPoolsForSwap(fakeNonHub, DC);
  
  console.log(`\n${'─'.repeat(80)}`);
  console.log('ACTUAL POOL DATA FOR SCENARIO 2 (non-hub → DC):');
  console.log(`${'─'.repeat(80)}`);
  
  for (const { tA, tB, desc } of pairs2) {
    await checkAllDexesForPair(tA, tB, desc);
  }

  // Scenario 3: Direct DC ↔ WWDOGE on all DEXes
  console.log('\n\n' + '╔'.padEnd(79, '═') + '╗');
  console.log('║ SCENARIO 3: Direct WWDOGE ↔ DC check '.padEnd(79) + '║');
  console.log('╚'.padEnd(79, '═') + '╝');
  
  await checkAllDexesForPair(WWDOGE, DC, 'WWDOGE ↔ DC (Direct)');

  // Scenario 4: Check if FRAX pools exist directly
  console.log('\n\n' + '╔'.padEnd(79, '═') + '╗');
  console.log('║ SCENARIO 4: FraxSwap DC/WWDOGE pools '.padEnd(79) + '║');
  console.log('╚'.padEnd(79, '═') + '╝');
  
  // Check FraxSwap for WWDOGE↔DC directly  
  const fraxswapFactory = CONTRACTS.FRAXSWAP_FACTORY;
  console.log(`\nChecking FraxSwap factory: ${fraxswapFactory}`);
  
  const dcWwdogeFrax = await getPoolInfo(fraxswapFactory, WWDOGE, DC, 'FraxSwap');
  if (dcWwdogeFrax) {
    console.log(`\n✓ FraxSwap has WWDOGE↔DC pool!`);
    console.log(`  Pair: ${dcWwdogeFrax.pairAddress}`);
    console.log(`  Reserves: ${dcWwdogeFrax.reserve0Formatted} / ${dcWwdogeFrax.reserve1Formatted}`);
    console.log(`  Below threshold: ${dcWwdogeFrax.belowThreshold}`);
  } else {
    console.log(`\n✗ FraxSwap does NOT have WWDOGE↔DC pool`);
  }

  // Check all DEXes for WWDOGE↔DC direct
  console.log(`\n${'─'.repeat(80)}`);
  console.log('All DEXes for WWDOGE↔DC:');
  console.log(`${'─'.repeat(80)}`);
  await checkAllDexesForPair(WWDOGE, DC, 'WWDOGE ↔ DC');

  // Summary
  console.log('\n\n' + '╔'.padEnd(79, '═') + '╗');
  console.log('║ SUMMARY '.padEnd(79) + '║');
  console.log('╚'.padEnd(79, '═') + '╝');
  console.log(`
Key findings:
1. HUB_TOKENS are: ${HUB_TOKENS.map(h => h.symbol).join(', ')}
2. MIN_RESERVE_OUT = 1e18 (1 token with 18 decimals)

When BOTH tokenIn and tokenOut are hubs:
  - fetchPoolsForSwap() only queries the DIRECT pair
  - If direct pool exists and passes MIN_RESERVE_OUT, it's found
  - FraxSwap WWDOGE↔DC pool would only be found if it passes threshold

When tokenIn is NOT a hub but tokenOut IS:
  - Direct pair + Input legs + Hub-to-hub pairs are queried
  - If FRAX had a pool with WWDOGE or DC, it would be found via input leg

ROOT CAUSE ANALYSIS:
  The MIN_RESERVE_OUT threshold of 1e18 might be filtering out valid pools
  that have lower reserves but still meaningful liquidity.
  
  Additionally, the hub token strategy means non-hub tokens can only be
  reached via their direct pair or input/output legs - there is NO 
  "expand to all pairs" mechanism for discovering pools on non-hub DEXes
  that aren't connected to the hub tokens.
  `);
}

main().catch(console.error);