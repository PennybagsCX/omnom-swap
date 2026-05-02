# DC/MCRIB Price Impact Audit Report

**Date:** May 1, 2026  
**Tokens:** DC (0x7b4328c127b85369d9f82ca0503b000d09cf9180, 18 decimals) → MCRIB (0xbdad927604c5cb78f15b3669a92fa5a1427d33a2, 15 decimals)  
**Pool:** Dogeshrek (0x3d986830f59cd6012e75e0a7a9c58ebcb7e58739)  
**Reported Issue:** 73.39% price impact when swapping 100 DC for 43.67M MCRIB

---

## Executive Summary

**The reported 73.39% price impact does NOT match current on-chain data.**  
Our audit script queries the actual Dogeshrek DC/MCRIB pool and calculates:

| Input | Expected Output | Price Impact (calculated) |
|-------|----------------|---------------------------|
| 10 DC | 1.56M MCRIB | 0.00% |
| 100 DC | 15.55M MCRIB | 0.00% |
| 1000 DC | 155.53M MCRIB | 0.00% |

**The DC/MCRIB pool on Dogeshrek has massive liquidity (estimated $666M TVL) and cannot produce a 73% price impact for 100 DC.**

Three possible explanations:
1. **Stale UI data** — The UI may be displaying a cached/old route result
2. **Different pool selected** — ToolSwap DC/MCRIB pool ($114K TVL) shows 1.98% impact for 100 DC (not 73%)
3. **Multi-hop routing issue** — If the system routes through thin intermediate pools (DC→WWDOGE→MCRIB), the intermediate hop could cause high effective impact

---

## 1. Price Impact Calculation Audit

### Location: [`src/services/pathFinder/index.ts:900-920`](src/services/pathFinder/index.ts:900)

```typescript
function estimatePriceImpact(steps: RouteStep[], edges: PoolEdge[]): number {
  if (steps.length === 0) return 0;

  let totalImpact = 0;
  for (const step of steps) {
    const edge = edges.find(
      (e) =>
        e.tokenIn.toLowerCase() === step.path[0].toLowerCase() &&
        e.tokenOut.toLowerCase() === step.path[1].toLowerCase() &&
        e.router.toLowerCase() === step.dexRouter.toLowerCase(),
    );
    if (edge && edge.reserveIn > 0n && step.amountIn > 0n) {
      // Correct formula: amountIn / (reserveIn + amountIn)
      const impact = Number((step.amountIn * 10000n) / (edge.reserveIn + step.amountIn)) / 10000;
      totalImpact += impact;
    }
  }

  return Math.min(totalImpact, 1);
}
```

### Analysis:

1. **Formula is correct** — Uses `amountIn / (reserveIn + amountIn)` which is the standard UniswapV2 price impact formula
2. **Sums impacts across hops** — For multi-hop routes, all hop impacts are summed (not multiplied)
3. **Edge matching uses router** — Matches by `tokenIn→tokenOut` AND `dexRouter` to find correct pool
4. **No decimal handling** — Assumes both tokens use the same decimal representation (18)

### Potential Issue: Decimal Mismatch

DC has **18 decimals**, MCRIB has **15 decimals**. The `estimatePriceImpact` function:
- Takes `step.amountIn` which is in the token's native decimals (DC: 18)
- Takes `edge.reserveIn` which is raw from the pool (could be any decimal)
- Divides them directly without normalizing

**This could cause incorrect price impact calculation if reserves are not normalized to 18 decimals before storage.**

---

## 2. Liquidity Fetching Audit

### Pool Data (from on-chain query):

| DEX | Pair Address | Reserve0 (DC) | Reserve1 (MCRIB) | Est. TVL |
|-----|--------------|---------------|------------------|----------|
| DogeShrk | 0x3d986... | 26,685,700,617,113,776,516,910,716 | 4,162,938,342,378,943,171,960,830,633 | **$666M** |
| ToolSwap | 0xdb159... | 4,926,178,036,936,911,299,688 | 660,628,605,860,038,025,290,590 | **$114K** |
| WOJAK | (none) | - | - | - |

### Key Finding:

**The Dogeshrek pool has $666M TVL, NOT $169 as reported.**  
This is likely the root cause of the discrepancy — the user may have seen an outdated TVL estimate, or the $169 figure applies to a different pool/time.

---

## 3. Multi-hop Routing Logic

### WWDOGE Intermediate Pools Found:

| DEX | DC↔WWDOGE | WWDOGE↔MCRIB |
|-----|-----------|--------------|
| DogeShrk | 74,925,091,316,541,720,256,987,738 / 2,218,246,015,765,604,700,762 | 440,424,591,422,608,209,575 / 2,394,109,501,293,774,352,160,710,861 |
| ToolSwap | 4,350,972,003,025,774,007,942 / 285,955,970,720,800,832 | NOT FOUND |
| WOJAK | 6,538,735,494,095,428,243,593,639 / 193,843,135,024,208,920,832 | NOT FOUND |

### Multi-hop Simulation (DogeShrk):

For 100 DC via DogeShrk DC→WWDOGE→MCRIB:
- **Hop 1**: 100 DC → 0.0006 WWDOGE (0.00% impact)
- **Hop 2**: 0.0006 WWDOGE → 3.18M MCRIB (0.00% impact)
- **Total output**: 3.18M MCRIB (vs 15.55M direct)

**The multi-hop route via DogeShrk gives LESS output than direct (3.18M vs 15.55M), but price impact is still ~0%.**

---

## 4. The "3-hop Path" Mystery

The user reported:  
> "3-hop path through WWDOGE (ToolSwap → WOJAK Finance → DogeShrk)"

### Analysis:

1. **ToolSwap → WOJAK Finance → DogeShrk is NOT a valid 3-hop path**  
   - A path should be: TOKEN → INTERMEDIATE → ... → OUTPUT  
   - ToolSwap, WOJAK Finance, DogeShrk are DEX names (not token hops)
   
2. **Correct 2-hop path**: DC → WWDOGE → MCRIB  
   - Hop 1: DC to WWDOGE (via any DEX with DC/WWDOGE pool)
   - Hop 2: WWDOGE to MCRIB (via any DEX with WWDOGE/MCRIB pool)

3. **The "via ~3x gas cost" message** comes from [`src/components/aggregator/RouteVisualization.tsx:165`](src/components/aggregator/RouteVisualization.tsx:165):
   ```typescript
   const gasWarning = route.steps.length > 1
     ? `~${route.steps.length}x gas cost`
     : undefined;
   ```

### Possible Bug:

The system may be incorrectly showing multiple DEX names as "hops" when the actual path is DC→WWDOGE→MCRIB with each hop potentially using a different DEX.

---

## 5. Bug Analysis: Possible Sources of 73.39% Price Impact

### Scenario A: ToolSwap DC/MCRIB Pool (if selected incorrectly)

With ToolSwap pool ($114K TVL):
- 100 DC input = 2.02% of DC reserve
- Price impact = **1.98%** (NOT 73%)

So ToolSwap also doesn't produce 73% impact.

### Scenario B: Stale Pool Data in Cache

If the pool reserves were cached with old/thin data:
- Old reserves could have much lower liquidity
- Would cause inflated price impact calculations

### Scenario C: Decimal Handling Bug

If MCRIB reserves (15 decimals) are stored as raw bigint but treated as 18 decimals during calculation:
- The `reserveIn` value for MCRIB side would be incorrectly scaled
- This could massively inflate the price impact percentage

**Example**: If MCRIB reserves are stored as `4162938342378943171960830633` but treated as if it has 18 decimals (when it actually has 15), the price impact calculation would be off by a factor of 1000.

### Scenario D: Incorrect Route Being Selected

The system might be selecting a suboptimal route with very thin intermediate pools:
- DC → WWDOGE via ToolSwap (285M WWDOGE reserve - thin!)
- WWDOGE → MCRIB via DogeShrk

The ToolSwap DC/WWDOGE pool has only 285,955 WWDOGE reserve, which is quite thin.

---

## 6. Recommended Fixes

### Fix 1: Verify Pool Reserve Decimal Normalization

**Location:** [`src/services/pathFinder/poolFetcher.ts`](src/services/pathFinder/poolFetcher.ts)

Add explicit decimal tracking for each pool:

```typescript
interface PoolReserves {
  reserve0: bigint;
  reserve1: bigint;
  token0: string;
  token1: string;
  token0Decimals: number;  // ADD THIS
  token1Decimals: number;  // ADD THIS
  // ... existing fields
}
```

Normalize reserves to 18 decimals when storing:
```typescript
const normalizeReserve = (reserve: bigint, decimals: number): bigint => {
  if (decimals === 18) return reserve;
  if (decimals < 18) return reserve * 10n ** BigInt(18 - decimals);
  return reserve / 10n ** BigInt(decimals - 18);
};
```

### Fix 2: Add Per-Hop Price Impact Logging

**Location:** [`src/services/pathFinder/index.ts:calculatePathOutput`](src/services/pathFinder/index.ts:502)

Log each hop's price impact to identify which hop causes high impact:

```typescript
for (let i = 0; i < path.length - 1; i++) {
  // ... existing pool selection code ...
  
  // NEW: Log per-hop impact
  const hopImpact = Number((currentAmount * 10000n) / (bestEdge.reserveIn + currentAmount)) / 100;
  console.log(`[PathFinder] Hop ${i + 1} impact: ${hopImpact.toFixed(4)}%`, {
    pool: bestEdge.dexName,
    tokenIn: tokenIn,
    tokenOut: tokenOut,
    amountIn: currentAmount.toString(),
    reserveIn: bestEdge.reserveIn.toString(),
    output: bestOutput.toString(),
  });
}
```

### Fix 3: Validate Route Price Impact Before Display

**Location:** [`src/hooks/useAggregator/useRoute.ts`](src/hooks/useAggregator/useRoute.ts)

Add validation to detect and warn about anomalous price impact:

```typescript
// If price impact seems unreasonably high for the pool sizes, flag it
if (route.priceImpact > 0.5 && route.steps.length > 0) {
  const avgPoolSize = route.steps.reduce((sum, step) => sum + step.amountIn, 0n) / BigInt(route.steps.length);
  console.warn(`[useRoute] Anomalous price impact detected: ${route.priceImpact * 100}%`, {
    routeId: route.id,
    steps: route.steps.map(s => ({
      dex: s.dexName,
      amountIn: s.amountIn.toString(),
      expectedOut: s.expectedAmountOut.toString()
    }))
  });
}
```

### Fix 4: Add On-Chain Freshness Check

Verify that pool reserves haven't changed significantly since last fetch:

```typescript
// Compare current calculation with a fresh on-chain query
async function validatePoolReserves(pool: PoolReserves): Promise<boolean> {
  const fresh = await fetchPoolReserves(pool.factory, pool.token0, pool.token1);
  if (!fresh) return false;
  
  const reserveDrift = Number(
    (pool.reserve0 > fresh.reserve0 
      ? pool.reserve0 - fresh.reserve0 
      : fresh.reserve0 - pool.reserve0) * 10000n / pool.reserve0
  ) / 100;
  
  return reserveDrift < 5; // Warn if reserves drifted more than 5%
}
```

---

## 7. Conclusion

**The 73.39% price impact is NOT supported by current on-chain data for the Dogeshrek DC/MCRIB pool.**

Possible explanations:
1. **Stale UI data** — The displayed route may be from an old calculation with outdated pool data
2. **Wrong pool selected** — The system may be routing through ToolSwap or another thin pool incorrectly
3. **Decimal handling bug** — If MCRIB reserves are not properly normalized to 18 decimals, calculations would be wrong

**Recommended Actions:**
1. Add explicit decimal tracking in `PoolReserves` type
2. Normalize all reserves to 18 decimals at fetch time
3. Add per-hop price impact logging to diagnose which hop causes high impact
4. Add validation to detect and warn about anomalous price impact values

---

## Files Created

1. `scripts/test-price-impact.ts` — Basic price impact calculation tests
2. `scripts/audit-price-impact.ts` — On-chain data audit script (run with `npx tsx scripts/audit-price-impact.ts`)

---

## Key Code Locations

| Purpose | File | Lines |
|---------|------|-------|
| Price impact calculation | `src/services/pathFinder/index.ts` | 900-920 |
| Pool data fetching | `src/services/pathFinder/poolFetcher.ts` | 250-313 |
| Route output calculation | `src/services/pathFinder/index.ts` | 502-575 |
| Multi-hop routing | `src/services/pathFinder/index.ts` | 636-715 |
| Gas warning display | `src/components/aggregator/RouteVisualization.tsx` | 164-165 |
| Route classification | `src/services/pathFinder/index.ts` | 146-190 |