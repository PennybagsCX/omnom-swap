/**
 * Price Impact Audit - DC/MCRIB on Dogeshrek
 * 
 * Run with: npx tsx scripts/audit-price-impact.ts
 * 
 * This script directly queries on-chain data to verify the reported 73.39% price impact
 * when swapping 100 DC for MCRIB on Dogeshrek pool.
 */

import { createPublicClient, http, parseAbi, getAddress } from 'viem';
import { dogechain } from 'wagmi/chains';

// ─── Constants ────────────────────────────────────────────────────────────────

const CONTRACTS = {
  // Token addresses
  WWDOGE: '0xb7ddc6414bf4f5515b52d8bdd69973ae205ff101',
  DC_TOKEN: '0x7B4328c127B85369D9f82ca0503B000D09CF9180',
  MCRIB_TOKEN: '0xbdad927604c5cb78f15b3669a92fa5a1427d33a2',
  
  // DEX factories
  DOGESHRK_FACTORY: '0x7c10a3b7ecd42dd7d79c0b9d58ddb812f92b574a',
  TOOLSWAP_FACTORY: '0xC3550497E591Ac6ed7a7E03ffC711CfB7412E57F',
  WOJAK_FACTORY: '0xc7c86B4f940Ff1C13c736b697e3FbA5a6Bc979F9',
};

// ─── ABI ──────────────────────────────────────────────────────────────────────

const FACTORY_ABI = parseAbi([
  'function getPair(address tokenA, address tokenB) external view returns (address pair)',
]);

const PAIR_ABI = parseAbi([
  'function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
  'function token0() external view returns (address)',
]);

// ─── Client ───────────────────────────────────────────────────────────────────

const client = createPublicClient({ chain: dogechain, transport: http() });

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatTokenAmount(amount: bigint, decimals: number): string {
  const num = Number(amount) / Number(10n ** BigInt(decimals));
  if (num >= 1e9) return `${(num / 1e9).toFixed(2)}B`;
  if (num >= 1e6) return `${(num / 1e6).toFixed(2)}M`;
  if (num >= 1e3) return `${(num / 1e3).toFixed(2)}K`;
  return num.toLocaleString('en-US', { maximumFractionDigits: 4 });
}

interface PoolData {
  dex: string;
  pairAddress: string;
  reserve0: bigint;
  reserve1: bigint;
  token0: string;
  token1: string;
  tvlEstimate: number;
}

async function getPoolData(factory: string, tokenA: string, tokenB: string, dexName: string): Promise<PoolData | null> {
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
    const t1 = t0 === tokenA.toLowerCase() ? tokenB.toLowerCase() : tokenA.toLowerCase();

    // TVL estimate using geometric mean (treating both as 18 decimal tokens for simplicity)
    // Real TVL would need actual price feeds
    const r0Num = Number(r0);
    const r1Num = Number(r1);
    const tvl = r0Num > 0 && r1Num > 0 ? 2 * Math.sqrt(r0Num * r1Num) / 1e18 : 0;

    return {
      dex: dexName,
      pairAddress: pairAddress.toLowerCase(),
      reserve0: r0,
      reserve1: r1,
      token0: t0,
      token1: t1,
      tvlEstimate: tvl,
    };
  } catch (e) {
    return null;
  }
}

// AMM math - same as pathFinder/index.ts
function calculateOutput(amountIn: bigint, reserveIn: bigint, reserveOut: bigint): bigint {
  if (amountIn <= 0n || reserveIn <= 0n || reserveOut <= 0n) return 0n;
  
  const FEE_DENOMINATOR = 10000n;
  const POOL_FEE_BPS = 30n;
  
  const amountInWithFee = amountIn * (FEE_DENOMINATOR - POOL_FEE_BPS);
  const numerator = amountInWithFee * reserveOut;
  const denominator = reserveIn * FEE_DENOMINATOR + amountInWithFee;
  
  return numerator / denominator;
}

function estimatePriceImpact(amountIn: bigint, reserveIn: bigint): number {
  if (reserveIn <= 0n || amountIn <= 0n) return 0;
  const impact = Number((amountIn * 10000n) / (reserveIn + amountIn)) / 100;
  return Math.min(impact, 100);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('╔' + '═'.repeat(78) + '╗');
  console.log('║' + ' PRICE IMPACT AUDIT: DC → MCRIB on Dogeshrek '.padStart(50).padEnd(79) + '║');
  console.log('╚' + '═'.repeat(78) + '╝');

  const DC = CONTRACTS.DC_TOKEN.toLowerCase();
  const MCRIB = CONTRACTS.MCRIB_TOKEN.toLowerCase();
  const WWDOGE = CONTRACTS.WWDOGE.toLowerCase();

  console.log(`\nToken Addresses:`);
  console.log(`  DC:    ${DC}`);
  console.log(`  MCRIB: ${MCRIB}`);
  console.log(`  WWDOGE: ${WWDOGE}`);

  // Test amounts
  const testAmounts = [
    { name: '10 DC', amount: 10n * 10n ** 18n, decimals: 18 },
    { name: '100 DC', amount: 100n * 10n ** 18n, decimals: 18 },
    { name: '1000 DC', amount: 1000n * 10n ** 18n, decimals: 18 },
  ];

  // ─── Check Direct DC/MCRIB Pools ───────────────────────────────────────────
  
  console.log(`\n\n${'═'.repeat(80)}`);
  console.log('CHECKING DIRECT DC/MCRIB POOLS');
  console.log('═'.repeat(80));

  const dexes = [
    { name: 'DogeShrk', factory: CONTRACTS.DOGESHRK_FACTORY },
    { name: 'ToolSwap', factory: CONTRACTS.TOOLSWAP_FACTORY },
    { name: 'WOJAK Finance', factory: CONTRACTS.WOJAK_FACTORY },
  ];

  const dcMcribPools: PoolData[] = [];
  
  for (const dex of dexes) {
    const pool = await getPoolData(dex.factory, DC, MCRIB, dex.name);
    if (pool) {
      dcMcribPools.push(pool);
      console.log(`\n✓ ${pool.dex}`);
      console.log(`  Pair: ${pool.pairAddress}`);
      console.log(`  Reserve0: ${pool.reserve0.toString()}`);
      console.log(`  Reserve1: ${pool.reserve1.toString()}`);
      console.log(`  Token0: ${pool.token0}`);
      console.log(`  Token1: ${pool.token1}`);
      console.log(`  TVL Estimate: $${pool.tvlEstimate.toFixed(2)}`);
    } else {
      console.log(`\n✗ ${dex.name}: No DC/MCRIB pool found`);
    }
  }

  // ─── Check WWDOGE Intermediate Pools ──────────────────────────────────────
  
  console.log(`\n\n${'═'.repeat(80)}`);
  console.log('CHECKING WWDOGE INTERMEDIATE POOLS (for multi-hop routing)');
  console.log('═'.repeat(80));

  const wwdogePools: { dex: string; pair: string; pools: PoolData[] }[] = [];

  for (const dex of dexes) {
    const dcWwdogePool = await getPoolData(dex.factory, DC, WWDOGE, dex.name);
    const wwdogeMcribPool = await getPoolData(dex.factory, WWDOGE, MCRIB, dex.name);
    
    if (dcWwdogePool || wwdogeMcribPool) {
      wwdogePools.push({
        dex: dex.name,
        pair: `${DC.slice(0,8)}... → ${WWDOGE.slice(0,8)}... → ${MCRIB.slice(0,8)}...`,
        pools: [dcWwdogePool, wwdogeMcribPool].filter(Boolean) as PoolData[],
      });
      
      console.log(`\n${dex.name} intermediate pools:`);
      if (dcWwdogePool) {
        console.log(`  DC ↔ WWDOGE: ${dcWwdogePool.reserve0.toString()} / ${dcWwdogePool.reserve1.toString()}`);
      } else {
        console.log(`  DC ↔ WWDOGE: NOT FOUND`);
      }
      if (wwdogeMcribPool) {
        console.log(`  WWDOGE ↔ MCRIB: ${wwdogeMcribPool.reserve0.toString()} / ${wwdogeMcribPool.reserve1.toString()}`);
      } else {
        console.log(`  WWDOGE ↔ MCRIB: NOT FOUND`);
      }
    }
  }

  // ─── Calculate Price Impact ─────────────────────────────────────────────────
  
  console.log(`\n\n${'═'.repeat(80)}`);
  console.log('PRICE IMPACT CALCULATIONS');
  console.log('═'.repeat(80));

  for (const pool of dcMcribPools) {
    console.log(`\n${pool.dex} DC/MCRIB Pool:`);
    console.log(`  Reserves: ${pool.reserve0.toString()} / ${pool.reserve1.toString()}`);
    
    // Determine which token is DC and which is MCRIB
    const isToken0DC = pool.token0 === DC;
    const reserveDC = isToken0DC ? pool.reserve0 : pool.reserve1;
    const reserveMCRIB = isToken0DC ? pool.reserve1 : pool.reserve0;
    
    console.log(`  DC Reserve: ${reserveDC.toString()} (${formatTokenAmount(reserveDC, 18)})`);
    console.log(`  MCRIB Reserve: ${reserveMCRIB.toString()} (${formatTokenAmount(reserveMCRIB, 15)})`);
    
    for (const test of testAmounts) {
      const output = calculateOutput(test.amount, reserveDC, reserveMCRIB);
      const impact = estimatePriceImpact(test.amount, reserveDC);
      
      console.log(`\n  ${test.name}:`);
      console.log(`    Expected Output: ${formatTokenAmount(output, 15)} MCRIB`);
      console.log(`    Price Impact: ${impact.toFixed(4)}%`);
      
      // What percentage of pool are we taking?
      const poolPct = Number(test.amount * 10000n / reserveDC) / 100;
      console.log(`    Trade as % of pool: ${poolPct.toFixed(4)}%`);
    }
  }

  // ─── Simulate Multi-hop via WWDOGE ─────────────────────────────────────────
  
  console.log(`\n\n${'═'.repeat(80)}`);
  console.log('MULTI-HOP SIMULATION: DC → WWDOGE → MCRIB');
  console.log('═'.repeat(80));

  // Find best WWDOGE intermediate route
  for (const entry of wwdogePools) {
    const dcWwdoge = entry.pools.find(p => 
      (p.token0 === DC && p.token1 === WWDOGE) || 
      (p.token1 === DC && p.token0 === WWDOGE)
    );
    const wwdogeMcrib = entry.pools.find(p => 
      (p.token0 === WWDOGE && p.token1 === MCRIB) || 
      (p.token1 === WWDOGE && p.token0 === MCRIB)
    );

    if (!dcWwdoge || !wwdogeMcrib) continue;

    console.log(`\n${entry.dex} path:`);
    
    // Get reserves in correct direction
    const dcToWwdoge = dcWwdoge.token0 === DC ? dcWwdoge.reserve0 : dcWwdoge.reserve1;
    const wwdogeToMcrib = wwdogeMcrib.token0 === WWDOGE ? wwdogeMcrib.reserve0 : wwdogeMcrib.reserve1;
    const wwdogeReserveMcrib = wwdogeMcrib.token0 === MCRIB ? wwdogeMcrib.reserve0 : wwdogeMcrib.reserve1;

    console.log(`  Hop 1 (DC→WWDOGE): ${dcToWwdoge.toString()} DC-side, WWDOGE reserve: ${(wwdogeMcrib.token0 === WWDOGE ? wwdogeMcrib.reserve0 : wwdogeMcrib.reserve1).toString()}`);
    console.log(`  Hop 2 (WWDOGE→MCRIB): WWDOGE in: ${wwdogeToMcrib.toString()}, MCRIB out: ${wwdogeReserveMcrib.toString()}`);

    for (const test of testAmounts) {
      // Hop 1
      const hop1Output = calculateOutput(test.amount, dcToWwdoge, wwdogeToMcrib);
      const hop1Impact = estimatePriceImpact(test.amount, dcToWwdoge);
      
      // Hop 2
      const hop2Output = calculateOutput(hop1Output, wwdogeToMcrib, wwdogeReserveMcrib);
      const hop2Impact = estimatePriceImpact(hop1Output, wwdogeToMcrib);
      
      const totalImpact = hop1Impact + hop2Impact;
      
      console.log(`\n  ${test.name} via ${entry.dex}:`);
      console.log(`    Hop 1 output: ${formatTokenAmount(hop1Output, 18)} WWDOGE (impact: ${hop1Impact.toFixed(4)}%)`);
      console.log(`    Hop 2 output: ${formatTokenAmount(hop2Output, 15)} MCRIB (impact: ${hop2Impact.toFixed(4)}%)`);
      console.log(`    Total price impact: ${totalImpact.toFixed(4)}%`);
    }
  }

  // ─── Final Summary ─────────────────────────────────────────────────────────
  
  console.log(`\n\n${'═'.repeat(80)}`);
  console.log('AUDIT SUMMARY');
  console.log('═'.repeat(80));
  
  console.log(`
KEY FINDINGS:

1. DIRECT DC/MCRIB POOLS:
   - ${dcMcribPools.length} pool(s) found across Dogeshrek, ToolSwap, WOJAK
   
2. WWDOGE INTERMEDIATE ROUTES:
   - ${wwdogePools.length} DEX(es) have both DC/WWDOGE and WWDOGE/MCRIB pools

3. PRICE IMPACT ANALYSIS:
   - The reported 73.39% price impact is likely from thin direct pools
   - Multi-hop via WWDOGE might provide better rates if intermediate pools are liquid

4. POTENTIAL ISSUES:
   - If DC/MCRIB direct pool has only ~$169 TVL, even 10 DC could cause >50% impact
   - The 3-hop path mentioned (ToolSwap → WOJAK → Dogeshrk) seems incorrect
     - Should be 2-hop: DC → WWDOGE → MCRIB
     - ToolSwap and WOJAK might be different pools on same DEX, not separate hops
   
5. RECOMMENDED FIXES:
   - Verify WWDOGE intermediate pools are being used correctly
   - Add per-hop price impact logging to identify which hop causes high impact
   - Consider rejecting routes where ANY single hop has >10% price impact
  `);
}

main().catch(console.error);