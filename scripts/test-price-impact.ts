// @ts-nocheck
/**
 * Price Impact Calculation Test Script
 * 
 * Tests the price impact calculation for DC/MCRIB swap on Dogeshrek pool
 * with varying input amounts to validate the 73.39% price impact report.
 * 
 * Run with: npx tsx scripts/test-price-impact.ts
 */

import { calculateOutput, buildGraph } from '../src/services/pathFinder/index';
import type { PoolReserves, PoolEdge } from '../src/services/pathFinder/types';

// Token addresses
const DC_ADDRESS = '0x7b4328c127b85369d9f82ca0503b000d09cf9180';
const MCRIB_ADDRESS = '0xbdad927604c5cb78f15b3669a92fa5a1427d33a2';
const WWDOGE_ADDRESS = '0x2458fe634f19be3c89b54ab719a2c5b7a383b4c0';

// Simulated pool data for Dogeshrek DC/MCRIB pool with $169 TVL
// TVL = 2 * sqrt(r0 * r1) => sqrt(r0 * r1) = TVL/2 = 84.5
// Assuming 50/50 split, r0 ≈ r1, and using approximate values
// For $169 TVL with both tokens roughly equal value:
// reserve0 = reserve1 ≈ 84.5^2 = 7140 (in raw units with 18 decimals applied)
// Actually let's be more realistic - with 18 decimal tokens and ~$0.01-0.1 value per token

interface PoolScenario {
  name: string;
  reserve0: bigint;
  reserve1: bigint;
  token0: string;
  token1: string;
  tvlUsd: number;
}

// Scenarios to test - realistic pool sizes
const scenarios: PoolScenario[] = [
  {
    name: 'Dogeshrek DC/MCRIB - $169 TVL (reported)',
    // $169 TVL means roughly $84.50 per side
    // Assuming DC ≈ $0.01 and MCRIB ≈ very small value
    // These are raw bigint values (already have decimals applied)
    reserve0: 84500000000000000n,  // ~0.0845 ETH equivalent (~$85 at $1000/ETH)
    reserve1: 84500000000000000000n, // 84.5 ETH equivalent for MCRIB
    token0: DC_ADDRESS.toLowerCase(),
    token1: MCRIB_ADDRESS.toLowerCase(),
    tvlUsd: 169,
  },
  {
    name: 'Dogeshrek DC/MCRIB - $500 TVL',
    reserve0: 250000000000000n,
    reserve1: 250000000000000000n,
    token0: DC_ADDRESS.toLowerCase(),
    token1: MCRIB_ADDRESS.toLowerCase(),
    tvlUsd: 500,
  },
  {
    name: 'Dogeshrek DC/MCRIB - $1000 TVL',
    reserve0: 500000000000000n,
    reserve1: 500000000000000000n,
    token0: DC_ADDRESS.toLowerCase(),
    token1: MCRIB_ADDRESS.toLowerCase(),
    tvlUsd: 1000,
  },
];

// Test amounts in DC (with 18 decimals)
const testAmounts = [
  { name: '10 DC', amount: 10n * 10n ** 18n },
  { name: '100 DC', amount: 100n * 10n ** 18n },
  { name: '500 DC', amount: 500n * 10n ** 18n },
  { name: '1000 DC', amount: 1000n * 10n ** 18n },
];

function formatTokenAmount(amount: bigint, decimals: number): string {
  const num = Number(amount) / Number(10n ** BigInt(decimals));
  return num.toLocaleString('en-US', { maximumFractionDigits: 4 });
}

function calculateExpectedOutput(amountIn: bigint, reserveIn: bigint, reserveOut: bigint): bigint {
  // Using constant product AMM formula with 0.3% fee
  const FEE_DENOMINATOR = 10000n;
  const POOL_FEE_BPS = 30n;
  
  if (amountIn <= 0n || reserveIn <= 0n || reserveOut <= 0n) return 0n;
  
  const amountInWithFee = amountIn * (FEE_DENOMINATOR - POOL_FEE_BPS);
  const numerator = amountInWithFee * reserveOut;
  const denominator = reserveIn * FEE_DENOMINATOR + amountInWithFee;
  
  return numerator / denominator;
}

function simulatePriceImpactCalc(
  amountIn: bigint,
  reserveIn: bigint,
  reserveOut: bigint,
  poolName: string
): void {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`Testing: ${poolName}`);
  console.log(`Input: ${formatTokenAmount(amountIn, 18)} DC`);
  console.log(`Reserve In: ${formatTokenAmount(reserveIn, 18)}`);
  console.log(`Reserve Out: ${formatTokenAmount(reserveOut, 18)}`);
  
  const output = calculateExpectedOutput(amountIn, reserveIn, reserveOut);
  
  // Calculate price impact using the formula: amountIn / (reserveIn + amountIn)
  const priceImpactRaw = (amountIn * 10000n) / (reserveIn + amountIn);
  const priceImpactPct = Number(priceImpactRaw) / 100;
  
  console.log(`Expected Output: ${formatTokenAmount(output, 15)} MCRIB`);
  console.log(`Price Impact: ${priceImpactPct.toFixed(4)}%`);
  
  // Also show what fraction of the pool this trade represents
  const tradeFraction = Number(amountIn * 100n / reserveIn) / 100;
  console.log(`Trade size as % of reserve: ${tradeFraction.toFixed(4)}%`);
}

// Main test execution
console.log('Price Impact Calculation Test - DC/MCRIB on Dogeshrek');
console.log('Token addresses:');
console.log(`  DC:    ${DC_ADDRESS}`);
console.log(`  MCRIB: ${MCRIB_ADDRESS}`);
console.log(`  WWDOGE: ${WWDOGE_ADDRESS}`);

scenarios.forEach(scenario => {
  testAmounts.forEach(testCase => {
    simulatePriceImpactCalc(
      testCase.amount,
      scenario.reserve0,  // Using reserve0 as reserveIn
      scenario.reserve1,  // Using reserve1 as reserveOut
      scenario.name
    );
  });
});

// Now test the multi-hop scenario
console.log(`\n${'='.repeat(80)}`);
console.log('MULTI-HOP ROUTING TEST');
console.log(`${'='.repeat(80)}`);

// Simulate a 3-hop path: DC -> WWDOGE -> MCRIB
// With actual intermediate pool sizes

interface HopInfo {
  name: string;
  reserveIn: bigint;
  reserveOut: bigint;
  amountIn: bigint;
}

function _calculateMultiHopPriceImpact(hops: HopInfo[]): number {
  let totalImpact = 0;
  
  for (const hop of hops) {
    const impact = Number((hop.amountIn * 10000n) / (hop.reserveIn + hop.amountIn)) / 100;
    totalImpact += impact;
    console.log(`  ${hop.name}: ${impact.toFixed(4)}% price impact`);
  }
  
  return totalImpact;
}

// Simulate DC -> WWDOGE (ToolSwap pool)
console.log('\nHop 1: DC -> WWDOGE (via ToolSwap)');
const dcToWwdogeAmount = 100n * 10n ** 18n; // 100 DC
const toolSwapReserveIn = 1000000000000000000n; // 1 WWDOGE equivalent
const toolSwapReserveOut = 1000000000000000000n; // 1 WWDOGE

const _hop1: HopInfo = {
  name: 'DC -> WWDOGE (ToolSwap)',
  reserveIn: toolSwapReserveIn,
  reserveOut: toolSwapReserveOut,
  amountIn: dcToWwdogeAmount,
};

// This is likely where the problem is - intermediate pools might be very thin
console.log(`  Input: ${formatTokenAmount(dcToWwdogeAmount, 18)} DC`);
console.log(`  Reserve In: ${formatTokenAmount(toolSwapReserveIn, 18)} WWDOGE equivalent`);
console.log(`  Amount/Reserve ratio: ${Number(dcToWwdogeAmount * 100n / toolSwapReserveIn) / 100}%`);

// Check what the output would be
const hop1Output = calculateExpectedOutput(dcToWwdogeAmount, toolSwapReserveIn, toolSwapReserveOut);
console.log(`  Output: ${formatTokenAmount(hop1Output, 18)} WWDOGE`);

// Calculate actual price impact for hop 1
const hop1Impact = Number((dcToWwdogeAmount * 10000n) / (toolSwapReserveIn + dcToWwdogeAmount)) / 100;
console.log(`  Price Impact for hop 1: ${hop1Impact.toFixed(4)}%`);

console.log('\nHop 2: WWDOGE -> MCRIB (via Dogeshrek)');
// After hop 1, we have hop1Output WWDOGE to swap for MCRIB
// But if the WWDOGE -> MCRIB pool is also thin...
const wwdogeToMcribAmount = hop1Output; // All WWDOGE from previous hop
const dogeshrekReserveIn = 1000000000000000000n; // 1 WWDOGE
const dogeshrekReserveOut = 100000000000000n; // Small MCRIB reserve

const hop2Output = calculateExpectedOutput(wwdogeToMcribAmount, dogeshrekReserveIn, dogeshrekReserveOut);
console.log(`  Input: ${formatTokenAmount(wwdogeToMcribAmount, 18)} WWDOGE`);
console.log(`  Reserve In: ${formatTokenAmount(dogeshrekReserveIn, 18)} WWDOGE`);
console.log(`  Reserve Out: ${formatTokenAmount(dogeshrekReserveOut, 15)} MCRIB`);
console.log(`  Output: ${formatTokenAmount(hop2Output, 15)} MCRIB`);

const hop2Impact = Number((wwdogeToMcribAmount * 10000n) / (dogeshrekReserveIn + wwdogeToMcribAmount)) / 100;
console.log(`  Price Impact for hop 2: ${hop2Impact.toFixed(4)}%`);

console.log('\nTotal estimated price impact (sum of hops):');
const totalImpact = hop1Impact + hop2Impact;
console.log(`  ${totalImpact.toFixed(4)}%`);

console.log(`\n${'='.repeat(80)}`);
console.log('ANALYSIS SUMMARY');
console.log(`${'='.repeat(80)}`);
console.log(`
The 73.39% price impact for 100 DC -> MCRIB is likely caused by:

1. THIN INTERMEDIATE POOLS
   - The path mentions "ToolSwap → WOJAK Finance → DogeShrk"
   - If either ToolSwap or WOJAK Finance DC/WWDOGE pool is very thin,
     the first hop incurs massive slippage
   
2. CUMULATIVE SLIPPAGE
   - Each hop in a multi-hop route adds price impact
   - With very thin intermediate pools, this compounds quickly
   
3. POSSIBLE ROUTING BUG
   - The user reports "3-hop path through WWDOGE (ToolSwap → WOJAK Finance → DogeShrk)"
   - This seems incorrect - it should be DC → WWDOGE (1 pool) → MCRIB (1 pool)
   - The extra "WOJAK Finance" hop suggests the BFS might be finding sub-optimal paths

4. RESERVE DATA STALENESS
   - If pool reserves haven't been refreshed recently, the price impact
     calculation could be based on stale data

RECOMMENDED FIXES:
1. Verify the pool data for ToolSwap DC/WWDOGE and WOJAK Finance pools
2. Add logging to track which pools are being selected for each hop
3. Add validation to reject routes where any single hop has >10% price impact
4. Ensure the BFS is correctly prioritizing WWDOGE as the direct intermediate
`);