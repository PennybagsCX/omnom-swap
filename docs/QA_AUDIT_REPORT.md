# OmnomSwap Comprehensive QA Audit Report

**Date:** 2025-04-15  
**Auditor:** QA Engineering Team  
**Scope:** UnifiedSwapScreen, AggregatorSwap, Path Finder, Hooks, UI Components, Smart Contract  
**Status:** ⚠️ **NOT PRODUCTION READY** — 4 Critical, 7 High, 10 Medium, 9 Low issues found

---

## Executive Summary

OmnomSwap is a DEX aggregator on Dogechain that routes swaps across 5 UniswapV2-compatible DEXes using an off-chain BFS pathfinder and an on-chain aggregator contract. The codebase demonstrates solid architectural decisions: fee-neutral route selection, proper BFS cycle prevention, constant-product AMM math, and comprehensive SEC disclosure coverage.

However, the audit reveals **4 Critical issues** that would prevent correct production operation:

1. **Aggregator contract address is a placeholder** (`0x...0001`) — all aggregator swaps will fail
2. **Price impact formula is mathematically incorrect** — displays misleading impact percentages
3. **Protocol fee is hardcoded** and not synced with the on-chain contract value
4. **Token balances are not refreshed after swap completion**

Additionally, 7 High-severity issues affect UX accuracy and could lead to user fund loss through misleading information. The codebase needs significant fixes before handling real funds.

---

## Critical Issues

### C-01: Aggregator Contract Address is a Placeholder

| Attribute | Value |
|-----------|-------|
| **File** | [`src/lib/constants.ts`](src/lib/constants.ts:197) |
| **Severity** | 🔴 Critical |
| **Impact** | All aggregator swap operations (route computation, approval, execution, event reading) reference a non-existent contract |

**Description:**  
The `OMNOMSWAP_AGGREGATOR_ADDRESS` is set to `0x0000000000000000000000000000000000000001`, a placeholder that will never be a valid contract. This means:

- `useAggregatorContract.ts` reads (owner, treasury, feeBps, paused) will all fail/revert
- `useSwap.ts` approval and execution will send transactions to a black hole
- `SwapHistory.tsx` event queries will return no results
- `TreasuryDashboard.tsx` will show "Not deployed" for all fields

**Expected:** Address should be the deployed contract address, or the UI should detect the placeholder and disable aggregator mode with a clear message.

**Recommended Fix:**
```typescript
// constants.ts
export const OMNOMSWAP_AGGREGATOR_ADDRESS = '<DEPLOYED_ADDRESS>' as `0x${string}`;

// Or add a detection guard:
export const isAggregatorDeployed = OMNOMSWAP_AGGREGATOR_ADDRESS !== 
  '0x0000000000000000000000000000000000000001' as `0x${string}`;
```

---

### C-02: Price Impact Formula is Mathematically Incorrect

| Attribute | Value |
|-----------|-------|
| **File** | [`src/services/pathFinder/index.ts`](src/services/pathFinder/index.ts:283) — `estimatePriceImpact()` |
| **Severity** | 🔴 Critical |
| **Impact** | Price impact displays are wildly inaccurate, potentially misleading users into executing unfavorable trades |

**Description:**  
The `estimatePriceImpact()` function uses this formula:

```typescript
const impact = Number(
  (step.amountIn * 10000n) / (step.amountIn + step.expectedAmountOut)
) / 10000;
```

This calculates `amountIn / (amountIn + amountOut)`, which is **not a price impact metric**. For example:
- A trade of 100 OMNOM → 200 WWDOGE would show "33.3% impact" (100/300)
- A trade of 100 OMNOM → 50 WWDOGE would show "66.7% impact" (100/150)

Neither value represents actual price impact. The correct formula (used in [`SwapScreen.tsx`](src/components/SwapScreen.tsx:263) via [`calcPriceImpact()`](src/lib/constants.ts:78)) is:

```typescript
// Correct: measures how much the trade moves the price
priceImpact = amountIn / (reserveIn + amountIn)
```

The aggregator's formula also sums impacts across hops (`totalImpact += impact`), which compounds the error for multi-hop routes.

**Expected:** Price impact should reflect the actual price movement caused by the trade relative to the pool's reserves.

**Recommended Fix:**
```typescript
function estimatePriceImpact(steps: RouteStep[], edges: PoolEdge[]): number {
  if (steps.length === 0) return 0;
  let totalImpact = 0;
  for (const step of steps) {
    // Find the edge to get reserve information
    const edge = edges.find(
      (e) => e.tokenIn === step.path[0] && e.tokenOut === step.path[1] && e.dexRouter === step.dexRouter
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

---

### C-03: Protocol Fee Hardcoded — Not Synced with Contract

| Attribute | Value |
|-----------|-------|
| **Files** | [`src/hooks/useAggregator/useRoute.ts`](src/hooks/useAggregator/useRoute.ts:76), [`src/components/aggregator/AggregatorSwap.tsx`](src/components/aggregator/AggregatorSwap.ts:364) |
| **Severity** | 🔴 Critical |
| **Impact** | If the contract owner changes the fee, the frontend displays wrong fee amounts and computes incorrect route outputs |

**Description:**  
The `feeBps` parameter is hardcoded to `10` (0.1%) in the call to `useRoute()`:

```typescript
// useRoute.ts:76 — hardcoded fee
const { route, ... } = useRoute(sellToken.address, buyToken.address, sellAmount, 10);
```

The fee display is also hardcoded:

```typescript
// AggregatorSwap.tsx:364
<span className="text-on-surface-variant">Protocol Fee (0.1%)</span>
```

However, the actual fee is stored on-chain in `OmnomSwapAggregator.protocolFeeBps` and can be changed by the owner up to 5% (MAX_FEE_BPS = 500). The `useAggregatorContract` hook already reads `feeBps` from the contract but it is **never used** by the route computation or display.

**Expected:** The fee should be read from the contract and passed to `useRoute()`. The display should show the actual fee percentage.

**Recommended Fix:**
```typescript
// In AggregatorSwap.tsx:
const { feeBps: contractFeeBps } = useAggregatorContract();
const feeBps = contractFeeBps ? Number(contractFeeBps) : 10; // fallback to 10

const { route, ... } = useRoute(sellToken.address, buyToken.address, sellAmount, feeBps);

// Display:
<span>Protocol Fee ({feeBps / 100}%)</span>
```

---

### C-04: Token Balances Not Refreshed After Swap

| Attribute | Value |
|-----------|-------|
| **Files** | [`src/hooks/useAggregator/useTokenBalances.ts`](src/hooks/useAggregator/useTokenBalances.ts:24), [`src/components/aggregator/AggregatorSwap.tsx`](src/components/aggregator/AggregatorSwap.ts:78) |
| **Severity** | 🔴 Critical |
| **Impact** | After a successful swap, the user sees stale balances. They may attempt another swap based on incorrect balance information. |

**Description:**  
The `useTokenBalances` hook fetches balances in a `useEffect` that depends on `[isConnected, address, publicClient]`. After a swap completes, none of these values change, so the effect does not re-run.

In `AggregatorSwap.tsx`, after `isConfirmed` becomes `true`, there is no mechanism to trigger a balance refresh. The user would need to manually refresh the page or reconnect their wallet.

**Expected:** Balances should refresh after a confirmed swap transaction.

**Recommended Fix:**
```typescript
// useTokenBalances.ts — add a refresh trigger
export function useTokenBalances() {
  const [refreshNonce, setRefreshNonce] = useState(0);
  // ... existing code ...
  
  useEffect(() => {
    // ... existing fetch logic ...
  }, [isConnected, address, publicClient, refreshNonce]);
  
  const refresh = useCallback(() => setRefreshNonce(n => n + 1), []);
  
  return { balances, isLoading, getBalance, getFormattedBalance, refresh };
}

// AggregatorSwap.tsx — refresh after swap confirmation
const { getFormattedBalance, refresh: refreshBalances } = useTokenBalances();

// In the swap confirmation handler or effect:
useEffect(() => {
  if (isConfirmed) refreshBalances();
}, [isConfirmed, refreshBalances]);
```

---

## High Issues

### H-01: Token Decimals Hardcoded to 18

| Attribute | Value |
|-----------|-------|
| **Files** | [`src/hooks/useAggregator/useTokenBalances.ts`](src/hooks/useAggregator/useTokenBalances.ts:41), [`src/hooks/useAggregator/useRoute.ts`](src/hooks/useAggregator/useRoute.ts:43) |
| **Severity** | 🟠 High |
| **Impact** | If any token has non-18 decimals, all balance displays, amount parsing, and route outputs will be incorrect |

**Description:**  
All token decimals are hardcoded to `18`:

```typescript
// useTokenBalances.ts:41
const decimals = 18; // Default, could fetch dynamically

// useRoute.ts:43
return { address: t.address, symbol: t.symbol, decimals: 18, logoURI: t.icon };
```

If DC, DINU, or any future token uses different decimals (e.g., 6 for USDC-like tokens), `parseUnits` and `formatUnits` would produce wildly incorrect values. A token with 6 decimals would show balances 10^12 times larger than actual.

**Recommended Fix:** Fetch `decimals()` from each token contract, or store decimals in the `TOKENS` array in constants.ts.

---

### H-02: BigInt → Number Precision Loss in Output Display

| Attribute | Value |
|-----------|-------|
| **Files** | [`src/hooks/useAggregator/useRoute.ts`](src/hooks/useAggregator/useRoute.ts:138), [`src/components/aggregator/AggregatorSwap.tsx`](src/components/aggregator/AggregatorSwap.ts:83) |
| **Severity** | 🟠 High |
| **Impact** | For large swap amounts (>2^53), the displayed buy amount could be inaccurate |

**Description:**  
The `priceQuote` calculation converts BigInt to Number:

```typescript
// useRoute.ts:138
return Number(route.totalExpectedOut) / Number(route.totalAmountIn);

// AggregatorSwap.tsx:83
const buyAmount = priceQuote && priceQuote > 0 ? fmtAmt(parsedSell * priceQuote) : '0';
```

`Number()` loses precision for values exceeding `Number.MAX_SAFE_INTEGER` (2^53 - 1 ≈ 9 × 10^15). For tokens with 18 decimals, this means amounts above ~9,000,000 tokens lose precision.

**Recommended Fix:** Use `formatUnits` directly on `route.totalExpectedOut` instead of converting through Number:

```typescript
const buyAmount = route && route.totalExpectedOut > 0n
  ? formatUnits(route.totalExpectedOut, 18)
  : '0';
```

---

### H-03: No Gas Estimation for Aggregator Swaps

| Attribute | Value |
|-----------|-------|
| **Files** | [`src/components/aggregator/AggregatorSwap.tsx`](src/components/aggregator/AggregatorSwap.ts) |
| **Severity** | 🟠 High |
| **Impact** | Users cannot estimate total transaction cost. Multi-hop swaps through the aggregator contract can be significantly more expensive than direct swaps. |

**Description:**  
The direct swap screen shows a hardcoded "~0.05 DOGE" network fee ([`SwapScreen.tsx`](src/components/SwapScreen.tsx:730)), but the aggregator swap shows no gas estimate at all. Multi-hop aggregator swaps involve multiple contract calls (approve + executeSwap with N hops), which could cost significantly more gas than a single-DEX swap.

**Recommended Fix:** Use `publicClient.estimateContractGas()` to estimate gas before the swap, or at minimum show a warning that aggregator swaps may have higher gas costs.

---

### H-04: Route Selection Uses Fragile Identity Check

| Attribute | Value |
|-----------|-------|
| **File** | [`src/components/aggregator/AggregatorSwap.tsx`](src/components/aggregator/AggregatorSwap.ts:429) |
| **Severity** | 🟠 High |
| **Impact** | Multiple routes can appear selected simultaneously, confusing the user |

**Description:**  
```typescript
const isSelected = route === r || 
  (route && r.totalExpectedOut === route.totalExpectedOut && r.steps.length === route.steps.length);
```

This checks reference equality OR matching output + step count. If two different routes produce the same output (e.g., Route 1: OMNOM→WWDOGE via DogeSwap, Route 2: OMNOM→WWDOGE via DogeShrk with identical output), both would appear selected.

**Recommended Fix:** Add a unique `id` field to `RouteResult` (e.g., hash of steps) and compare by ID.

---

### H-05: SwapHistory Fetches from Placeholder Address

| Attribute | Value |
|-----------|-------|
| **File** | [`src/components/aggregator/SwapHistory.tsx`](src/components/aggregator/SwapHistory.ts:47) |
| **Severity** | 🟠 High |
| **Impact** | Swap history will always show "No swaps recorded" since it queries the placeholder contract address |

**Description:**  
`SwapHistory` queries `OMNOMSWAP_AGGREGATOR_ADDRESS` (the placeholder `0x...0001`) for `SwapExecuted` events. This will never return results. Combined with C-01, the entire swap history feature is non-functional.

**Recommended Fix:** Same as C-01 — update the address after deployment. Additionally, add a graceful fallback when the contract is not deployed.

---

### H-06: No Error Boundary Around Aggregator Components

| Attribute | Value |
|-----------|-------|
| **Files** | [`src/App.tsx`](src/App.tsx:34), [`src/components/UnifiedSwapScreen.tsx`](src/components/UnifiedSwapScreen.tsx:56) |
| **Severity** | 🟠 High |
| **Impact** | A render error in any aggregator component crashes the entire page |

**Description:**  
The `AggregatorSwap` component and its children (`RouteVisualization`, `PriceComparison`, `TokenSelector`, etc.) are rendered without an error boundary. If any component throws during render (e.g., accessing a property on `undefined` route data), the entire app crashes with a white screen.

While `ErrorBoundary.tsx` exists in the project, it is not wrapping the aggregator components.

**Recommended Fix:** Wrap aggregator components in an error boundary:
```tsx
<ErrorBoundary fallback={<div>Aggregator unavailable. Please try Direct Swap.</div>}>
  <AggregatorSwap />
</ErrorBoundary>
```

---

### H-07: Pool Fetcher Uses Standalone RPC Client

| Attribute | Value |
|-----------|-------|
| **File** | [`src/services/pathFinder/poolFetcher.ts`](src/services/pathFinder/poolFetcher.ts:37) |
| **Severity** | 🟠 High |
| **Impact** | Pool data may come from a different RPC endpoint than the user's wallet connection, causing stale or inconsistent data |

**Description:**  
```typescript
const defaultClient = createPublicClient({ chain: dogechain, transport: http() });
```

The pool fetcher creates its own standalone `PublicClient` using the default RPC URL, bypassing the wagmi config. This means:
- If the user's wallet uses a different RPC (e.g., a private endpoint), pool data could differ
- Rate limiting on the default RPC could cause failures
- No retry/fallback logic for RPC failures

**Recommended Fix:** Pass the wagmi `publicClient` from the component layer down to the pool fetcher, or use the wagmi config's transport.

---

## Medium Issues

### M-01: `formatUnits` Truncation with `.slice(0, N)` is Fragile

| Attribute | Value |
|-----------|-------|
| **Files** | [`AggregatorSwap.tsx`](src/components/aggregator/AggregatorSwap.tsx:366), [`PriceComparison.tsx`](src/components/aggregator/PriceComparison.tsx:131), [`RouteVisualization.tsx`](src/components/aggregator/RouteVisualization.tsx:57) |
| **Severity** | 🟡 Medium |

**Description:**  
Multiple locations use `formatUnits(value, 18).slice(0, 10)` to truncate display. This can produce misleading results:
- Very small amounts: `"0.00000000"` (all zeros, actual value hidden)
- Very large amounts: `"1000000000"` (no decimal point visible)
- Cutting mid-number: `"1234.56789"` becomes `"1234.56789"` (OK), but `"0.0000000001"` becomes `"0.00000000"` (wrong — shows 0 when value is non-zero)

**Recommended Fix:** Use a proper formatting function that respects significant digits:
```typescript
function formatTokenAmount(value: bigint, decimals: number, maxSignificantDigits: number = 6): string {
  const formatted = formatUnits(value, decimals);
  const num = parseFloat(formatted);
  if (num === 0) return '0';
  return num.toPrecision(maxSignificantDigits);
}
```

---

### M-02: No Timeout on Pool Fetching

| Attribute | Value |
|-----------|-------|
| **File** | [`src/services/pathFinder/poolFetcher.ts`](src/services/pathFinder/poolFetcher.ts:109) |
| **Severity** | 🟡 Medium |

**Description:**  
`fetchAllPools()` makes `5 × C(n,2)` concurrent RPC calls (where n = number of tokens). With 4 tokens, that's 30 calls. There's no timeout — if the RPC is slow or down, the UI hangs indefinitely in "Computing available routes..." state.

**Recommended Fix:** Add an `AbortController` with a timeout (e.g., 10 seconds) and show a timeout error to the user.

---

### M-03: Slippage NaN Propagation

| Attribute | Value |
|-----------|-------|
| **File** | [`src/components/aggregator/AggregatorSwap.tsx`](src/components/aggregator/AggregatorSwap.ts:84) |
| **Severity** | 🟡 Medium |

**Description:**  
```typescript
const slippageBps = Math.round(parseFloat(slippage) * 100);
```
If the user clears the slippage input (empty string), `parseFloat("")` returns `NaN`, and `Math.round(NaN)` returns `NaN`. This NaN propagates into:
- `buildSwapRequest()` where `BigInt(NaN)` throws a `TypeError`
- The min received display shows "NaN"

**Recommended Fix:**
```typescript
const slippageBps = Math.round((parseFloat(slippage) || 0) * 100);
```

---

### M-04: DST Token Not Included in TOKENS Array

| Attribute | Value |
|-----------|-------|
| **File** | [`src/lib/constants.ts`](src/lib/constants.ts:59) |
| **Severity** | 🟡 Medium |

**Description:**  
`CONTRACTS.DST_V2_TOKEN` is defined (line 16) but not included in the `TOKENS` array (line 59). Users cannot trade this token through the UI even though it has a contract address defined.

---

### M-05: RouteVisualization Shows Unformatted Fee Amount

| Attribute | Value |
|-----------|-------|
| **File** | [`src/components/aggregator/RouteVisualization.tsx`](src/components/aggregator/RouteVisualization.tsx:57) |
| **Severity** | 🟡 Medium |

**Description:**  
```typescript
{formatUnits(route.feeAmount, 18)} {getTokenSymbol(firstToken)}
```
Unlike other locations that use `.slice(0, 10)`, this displays the full `formatUnits` output, which could be a very long decimal string like `"0.000000000000000001"`, causing layout overflow.

---

### M-06: `getPerDexQuotes` Only Uses First Pool Per DEX

| Attribute | Value |
|-----------|-------|
| **File** | [`src/services/pathFinder/index.ts`](src/services/pathFinder/index.ts:320) |
| **Severity** | 🟡 Medium |

**Description:**  
```typescript
const seen = new Set<string>();
for (const pool of pools) {
  if (seen.has(pool.dexName)) continue;
  seen.add(pool.dexName);
```
This skips all pools after the first one for each DEX. If a DEX has multiple pools for the same pair (e.g., different fee tiers), only the first is quoted. The price comparison table may not show the best available price for each DEX.

---

### M-07: No Split-Route Aggregation Support

| Attribute | Value |
|-----------|-------|
| **Files** | [`src/services/pathFinder/index.ts`](src/services/pathFinder/index.ts), [`src/components/aggregator/EducationPanel.tsx`](src/components/aggregator/EducationPanel.ts:69) |
| **Severity** | 🟡 Medium |

**Description:**  
The system does not support split routes (dividing input across multiple parallel DEXes). Each route is a single sequential path. The Education Panel states the aggregator "splits or routes trades across multiple venues" but splitting is not implemented. This is a design limitation that should be accurately disclosed.

**Recommended Fix:** Update the Education Panel to accurately describe the current behavior: "routes trades across multiple venues" (remove "splits").

---

### M-08: Contract Uses Only `swapExactTokensForTokens`

| Attribute | Value |
|-----------|-------|
| **File** | [`contracts/OmnomSwapAggregator.sol`](contracts/OmnomSwapAggregator.sol:222) |
| **Severity** | 🟡 Medium |

**Description:**  
The aggregator contract always calls `swapExactTokensForTokens()`, even when swapping native tokens (WWDOGE/DOGE). This means:
- Users must have WWDOGE (wrapped DOGE) to sell native tokens
- The contract cannot call `swapExactETHForTokens` or `swapExactWDOGEForTokens`
- Routes involving native token selling require the user to wrap first

The frontend does not handle wrapping or warn about this limitation.

---

### M-09: `findAllViableRoutes` Double-Computes Routes

| Attribute | Value |
|-----------|-------|
| **File** | [`src/hooks/useAggregator/useRoute.ts`](src/hooks/useAggregator/useRoute.ts:85) |
| **Severity** | 🟡 Medium |

**Description:**  
`useRoute` calls both `findAllViableRoutes()` and `findBestRoute()`, which internally calls `findAllViableRoutes()` again. This doubles the computation for every route update. Since `findAllViableRoutes` involves BFS + AMM math for all paths, this is wasteful.

**Recommended Fix:**
```typescript
const routes = findAllViableRoutes(tokenInAddress, tokenOutAddress, amountInWei, allPools, feeBps);
setAllRoutes(routes);
setRoute(routes.length > 0 ? routes[0] : null); // best route is first (sorted desc)
```

---

### M-10: `useAggregatorContract` Reads May Fail Silently

| Attribute | Value |
|-----------|-------|
| **File** | [`src/hooks/useAggregator/useAggregatorContract.ts`](src/hooks/useAggregator/useAggregatorContract.ts:11) |
| **Severity** | 🟡 Medium |

**Description:**  
All `useReadContract` calls target the placeholder address. Wagmi's `useReadContract` will set `error` state but the hook doesn't expose error states. Components consuming this hook (TreasuryDashboard, TestingDashboard) show "Not deployed" without explaining whether it's an actual deployment issue or an RPC error.

---

## Low Issues

### L-01: BigInt Sorting Precision Loss

| Attribute | Value |
|-----------|-------|
| **File** | [`src/services/pathFinder/index.ts`](src/services/pathFinder/index.ts:244) |
| **Severity** | 🔵 Low |

**Description:**  
```typescript
results.sort((a, b) => Number(b.totalExpectedOut - a.totalExpectedOut));
```
For very large BigInt values, `Number()` conversion loses precision. In practice, with 18-decimal tokens and typical trade sizes, this is unlikely to cause issues.

---

### L-02: `DOGEWAP_FACTORY` Typo in Contract Reference

| Attribute | Value |
|-----------|-------|
| **File** | [`src/lib/constants.ts`](src/lib/constants.ts:12) |
| **Severity** | 🔵 Low |

**Description:**  
The constant is named `DOGEWAP_FACTORY` (missing 'S' — should be `DOGESWAP_FACTORY`). This is a naming inconsistency but doesn't affect functionality since it's used consistently by reference.

---

### L-03: Hardcoded Network Fee in Direct Swap

| Attribute | Value |
|-----------|-------|
| **File** | [`src/components/SwapScreen.tsx`](src/components/SwapScreen.tsx:730) |
| **Severity** | 🔵 Low |

**Description:**  
```typescript
<span className="text-white">~0.05 DOGEGE</span>
```
The network fee is hardcoded to "~0.05 DOGE" and never changes regardless of transaction complexity. This is inaccurate but not dangerous since it's labeled as an estimate.

---

### L-04: Swap History Search Filters Twice

| Attribute | Value |
|-----------|-------|
| **File** | [`src/components/SwapScreen.tsx`](src/components/SwapScreen.tsx:771) |
| **Severity** | 🔵 Low |

**Description:**  
The swap history filters the array twice — once to check `length > 0` and once to `.map()`. This is a minor performance issue:
```typescript
swapHistory.filter(tx => ...).length > 0 ? (
  swapHistory.filter(tx => ...).map(tx => ...)
```

**Recommended Fix:** Store filtered result in a variable.

---

### L-05: TokenSelector Doesn't Reset Search on Close

| Attribute | Value |
|-----------|-------|
| **File** | [`src/components/aggregator/TokenSelector.tsx`](src/components/aggregator/TokenSelector.tsx:21) |
| **Severity** | 🔵 Low |

**Description:**  
The `searchQuery` state is local to `TokenSelector` and persists across open/close cycles. If a user searches for "DINU", closes the modal, and reopens it, the search filter is still active. This differs from the direct swap's token selector which resets search on close.

---

### L-06: No Loading State for Pool Discovery

| Attribute | Value |
|-----------|-------|
| **File** | [`src/components/aggregator/AggregatorSwap.tsx`](src/components/aggregator/AggregatorSwap.ts:340) |
| **Severity** | 🔵 Low |

**Description:**  
The loading indicator shows "Computing available routes..." but doesn't distinguish between "fetching pools" and "computing routes". The pool fetching step (network calls) can take several seconds and the user has no visibility into progress.

---

### L-07: `DisclaimerFooter` Referenced but Not Used in Aggregator

| Attribute | Value |
|-----------|-------|
| **File** | [`src/components/aggregator/DisclaimerFooter.tsx`](src/components/aggregator/DisclaimerFooter.tsx) |
| **Severity** | 🔵 Low |

**Description:**  
`DisclaimerFooter.tsx` exists in the aggregator directory but is not imported or rendered by any component. The legal notice has been moved to `Disclosures.tsx`. This is dead code.

---

### L-08: `OMNOM_WWDOGE_POOL` Hardcoded for Direct Swap

| Attribute | Value |
|-----------|-------|
| **File** | [`src/lib/constants.ts`](src/lib/constants.ts:57), [`src/components/SwapScreen.tsx`](src/components/SwapScreen.tsx:159) |
| **Severity** | 🔵 Low |

**Description:**  
The direct swap screen hardcodes `OMNOM_WWDOGE_POOL` for price quoting. This means:
- Only the OMNOM/WWDOGE pair gets pool-based quotes
- Other pairs (DC/WWDOGE, DINU/WWDOGE) fall through to V3/V2 router quotes which may be less accurate

---

### L-09: Verification Checklist is Static

| Attribute | Value |
|-----------|-------|
| **File** | [`src/components/aggregator/TestingDashboard.tsx`](src/components/aggregator/TestingDashboard.tsx:324) |
| **Severity** | 🔵 Low |

**Description:**  
The Verification Checklist has all items hardcoded as `passed: true`. These are not actual runtime tests — they're static claims. This could mislead users into thinking the system has been verified at runtime.

---

## Positive Observations

### ✅ Well-Implemented Items

1. **BFS Cycle Prevention** ([`findAllRoutes()`](src/services/pathFinder/index.ts:169)): The visited set is correctly derived from the current path, preventing infinite loops and token revisits.

2. **Fee-Neutral Route Selection** ([`findAllViableRoutes()`](src/services/pathFinder/index.ts:221)): The protocol fee is calculated identically for all routes and applied before route computation. This ensures the fee does not influence route ordering.

3. **AMM Math Correctness** ([`calculateOutput()`](src/services/pathFinder/index.ts:66)): The constant-product formula with 0.3% pool fee is correctly implemented: `amountOut = (reserveOut × amountIn × 9970) / (reserveIn × 10000 + amountIn × 9970)`.

4. **Stale Request Protection** ([`useRoute.ts`](src/hooks/useAggregator/useRoute.ts:66)): The `seqRef` counter correctly discards stale async results when inputs change rapidly.

5. **Debounced Input** ([`useRoute.ts`](src/hooks/useAggregator/useRoute.ts:122)): 500ms debounce prevents excessive route recomputation on rapid input changes.

6. **Comprehensive SEC Disclosures** ([`Disclosures.tsx`](src/components/aggregator/Disclosures.tsx:64)): 9 disclosure sections covering role, fees, parameters, defaults, MEV, cybersecurity, conflicts, venue criteria, and registration status. Well-structured and thorough.

7. **Smart Contract Security** ([`OmnomSwapAggregator.sol`](contracts/OmnomSwapAggregator.sol)):
   - ReentrancyGuard on `executeSwap` and `rescueTokens`
   - Slippage protection via `minTotalAmountOut`
   - Deadline enforcement
   - Router whitelist validation
   - Path continuity validation (`step.path[0] == currentToken`)
   - SafeERC20 for all token transfers

8. **Token Selector Same-Token Prevention** ([`AggregatorSwap.tsx`](src/components/aggregator/AggregatorSwap.tsx:147)): Selecting the opposite side's token triggers a swap instead of allowing duplicate selection.

9. **Wrong Network Detection** ([`AggregatorSwap.tsx`](src/components/aggregator/AggregatorSwap.tsx:55)): Correctly detects when the wallet is on the wrong chain and disables the swap button.

10. **Input Validation** ([`AggregatorSwap.tsx`](src/components/aggregator/AggregatorSwap.tsx:94)): Validates for NaN, Infinity, excessive amounts (>10^18), and insufficient balance.

11. **Swap History Persistence** ([`SwapScreen.tsx`](src/components/SwapScreen.tsx:89)): Direct swap history is persisted to localStorage with proper type validation (`isValidSwapTx`).

12. **Multi-DEX Route Comparison** ([`PriceComparison.tsx`](src/components/aggregator/PriceComparison.tsx:34)): Clean sortable table showing per-DEX output with difference from highest.

---

## Detailed Findings Summary

| ID | Severity | File | Line | Description |
|----|----------|------|------|-------------|
| C-01 | 🔴 Critical | `constants.ts` | 197 | Aggregator address is placeholder `0x...0001` |
| C-02 | 🔴 Critical | `pathFinder/index.ts` | 283 | Price impact formula is mathematically wrong |
| C-03 | 🔴 Critical | `useRoute.ts` | 76 | Protocol fee hardcoded to 10 bps, not synced with contract |
| C-04 | 🔴 Critical | `useTokenBalances.ts` | 24 | Balances not refreshed after swap completion |
| H-01 | 🟠 High | `useTokenBalances.ts` | 41 | Token decimals hardcoded to 18 |
| H-02 | 🟠 High | `useRoute.ts` | 138 | BigInt→Number precision loss in output display |
| H-03 | 🟠 High | `AggregatorSwap.tsx` | — | No gas estimation for aggregator swaps |
| H-04 | 🟠 High | `AggregatorSwap.tsx` | 429 | Route selection uses fragile identity check |
| H-05 | 🟠 High | `SwapHistory.tsx` | 47 | Queries placeholder address for events |
| H-06 | 🟠 High | `UnifiedSwapScreen.tsx` | 56 | No error boundary around aggregator components |
| H-07 | 🟠 High | `poolFetcher.ts` | 37 | Standalone RPC client bypasses wagmi config |
| M-01 | 🟡 Medium | Multiple | — | `formatUnits().slice(0, N)` truncation is fragile |
| M-02 | 🟡 Medium | `poolFetcher.ts` | 109 | No timeout on pool fetching |
| M-03 | 🟡 Medium | `AggregatorSwap.tsx` | 84 | Slippage NaN propagation when input is empty |
| M-04 | 🟡 Medium | `constants.ts` | 16 | DST token not in TOKENS array |
| M-05 | 🟡 Medium | `RouteVisualization.tsx` | 57 | Unformatted fee amount may overflow layout |
| M-06 | 🟡 Medium | `pathFinder/index.ts` | 320 | `getPerDexQuotes` only uses first pool per DEX |
| M-07 | 🟡 Medium | `EducationPanel.tsx` | 69 | Claims split routing but only sequential routing exists |
| M-08 | 🟡 Medium | `OmnomSwapAggregator.sol` | 222 | Contract only supports `swapExactTokensForTokens` |
| M-09 | 🟡 Medium | `useRoute.ts` | 85 | Double route computation (findAllViableRoutes + findBestRoute) |
| M-10 | 🟡 Medium | `useAggregatorContract.ts` | 11 | Contract reads fail silently for placeholder address |
| L-01 | 🔵 Low | `pathFinder/index.ts` | 244 | BigInt sorting via Number() precision loss |
| L-02 | 🔵 Low | `constants.ts` | 12 | `DOGEWAP_FACTORY` typo (missing 'S') |
| L-03 | 🔵 Low | `SwapScreen.tsx` | 730 | Hardcoded "~0.05 DOGE" network fee |
| L-04 | 🔵 Low | `SwapScreen.tsx` | 771 | Swap history filter runs twice |
| L-05 | 🔵 Low | `TokenSelector.tsx` | 21 | Search query not reset on modal close |
| L-06 | 🔵 Low | `AggregatorSwap.tsx` | 340 | No granular loading state for pool discovery |
| L-07 | 🔵 Low | `DisclaimerFooter.tsx` | — | Dead code — not imported anywhere |
| L-08 | 🔵 Low | `SwapScreen.tsx` | 159 | Hardcoded OMNOM/WWDOGE pool for quotes |
| L-09 | 🔵 Low | `TestingDashboard.tsx` | 324 | Verification checklist is static, not runtime |

---

## Remediation Priority

### Must Fix Before Any Deployment (Critical + High)
1. Deploy aggregator contract and update `OMNOMSWAP_AGGREGATOR_ADDRESS` (C-01)
2. Fix price impact formula (C-02)
3. Sync protocol fee with contract value (C-03)
4. Add balance refresh after swap (C-04)
5. Handle token decimals dynamically (H-01)
6. Fix BigInt precision in output display (H-02)
7. Add error boundary around aggregator (H-06)

### Should Fix Before Production (Medium)
8. Add gas estimation (H-03)
9. Fix route selection identity (H-04)
10. Add pool fetch timeout (M-02)
11. Fix slippage NaN propagation (M-03)
12. Improve number formatting (M-01)

### Nice to Have (Low)
13. Clean up dead code (L-07)
14. Fix minor display issues (L-03, L-05, L-06)
15. Fix typos (L-02)

---

*End of QA Audit Report*
