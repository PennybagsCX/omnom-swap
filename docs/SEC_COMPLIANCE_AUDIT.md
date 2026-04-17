# SEC Compliance Audit Report — OmnomSwap Aggregator Frontend

**Audit Date:** April 15, 2026  
**Audited Against:** SEC Division of Trading and Markets Staff Statement (April 13, 2026) — Broker-Dealer Registration for Covered User Interfaces  
**Auditor:** Automated Compliance Review  
**Scope:** All aggregator-related frontend components, hooks, services, and constants

---

## Executive Summary

This audit identifies **7 CRITICAL violations**, **5 HIGH-priority gaps**, and **4 MODERATE findings** across the OmnomSwap aggregator frontend. The most severe issues are: (1) pervasive use of subjective recommendation language ("best," "optimal," "save"), (2) complete absence of SEC-required disclosures and disclaimers, (3) no route sorting/filtering tools for multi-route display, and (4) no educational materials. The fee structure and self-custody model are compliant.

### Compliance Scorecard

| SEC Requirement | Status | Severity |
|---|---|---|
| No subjective recommendations | ❌ VIOLATED | CRITICAL |
| Route sorting/filtering tools | ❌ MISSING | CRITICAL |
| "See additional routes" option | ❌ MISSING | CRITICAL |
| Pre-disclosed objective parameters | ⚠️ PARTIAL | HIGH |
| No control/discretion over routing | ✅ PASS | — |
| 100% self-custodial | ✅ PASS | — |
| User customization of defaults | ⚠️ PARTIAL | HIGH |
| Educational materials | ❌ MISSING | CRITICAL |
| No solicitation/investment advice | ✅ PASS | — |
| Fixed/neutral fee structure | ✅ PASS | — |
| Venue onboarding policies | ❌ MISSING | HIGH |
| Prominent disclosures | ❌ MISSING | CRITICAL |
| SEC registration disclaimer | ❌ MISSING | CRITICAL |
| MEV risk disclosure | ❌ MISSING | HIGH |
| Cybersecurity disclosure | ❌ MISSING | HIGH |

---

## Finding 1: Subjective Recommendation Language (CRITICAL)

**SEC Requirement:** The interface "may provide users with market data" but CANNOT add commentary like "best price," "most reliable," or any subjective recommendation. Parameters must be "pre-disclosed and objective" and "independently verifiable."

### 1.1 — "FINDING BEST ROUTE..." Button Text

- **File:** `src/components/aggregator/AggregatorSwap.tsx`  
- **Line:** 106  
- **Current:** `buttonText = 'FINDING BEST ROUTE...';`  
- **Issue:** Uses the word "best" which is a subjective recommendation  
- **Fix:** Change to `'FINDING ROUTE...'` or `'COMPUTING ROUTE...'`

### 1.2 — "Finding best route across all DEXes..." Loading Text

- **File:** `src/components/aggregator/AggregatorSwap.tsx`  
- **Line:** 307  
- **Current:** `<span>Finding best route across all DEXes...</span>`  
- **Issue:** Uses "best" — subjective recommendation language  
- **Fix:** Change to `<span>Searching routes across all DEXes...</span>` or `<span>Computing available routes...</span>`

### 1.3 — "Optimal Route" Section Header

- **File:** `src/components/aggregator/RouteVisualization.tsx`  
- **Line:** 48  
- **Current:** `<span className="...">Optimal Route</span>`  
- **Issue:** "Optimal" is a subjective recommendation term  
- **Fix:** Change to `'Selected Route'` or `'Route'`

### 1.4 — "No route found. Enter an amount to see the optimal path." Empty State

- **File:** `src/components/aggregator/RouteVisualization.tsx`  
- **Line:** 33  
- **Current:** `No route found. Enter an amount to see the optimal path.`  
- **Issue:** Uses "optimal" — subjective recommendation  
- **Fix:** Change to `No route found. Enter an amount to see available routes.`

### 1.5 — "OmnomSwap (Best Route)" Label in Price Comparison

- **File:** `src/components/aggregator/PriceComparison.tsx`  
- **Line:** 32  
- **Current:** `{ name: 'OmnomSwap (Best Route)', output: aggregatorOutput, isAggregator: true }`  
- **Issue:** "Best Route" is a subjective recommendation and self-promotional label  
- **Fix:** Change to `'OmnomSwap (Aggregated)'` or `'OmnomSwap Route'`

### 1.6 — "Save up to X%" Savings Display

- **File:** `src/components/aggregator/PriceComparison.tsx`  
- **Lines:** 53–57  
- **Current:**
  ```tsx
  <TrendingUp className="w-3 h-3" />
  <span>Save up to {savingsVsWorst}%</span>
  ```
- **Issue:** "Save up to" is promotional/solicitation language that implies the user should act to save money  
- **Fix:** Remove entirely, or change to a neutral label like `<span>Output range: {minOutput} – {maxOutput}</span>`. The `TrendingUp` icon also implies a positive recommendation and should be removed.

### 1.7 — "vs Best" Column Header

- **File:** `src/components/aggregator/PriceComparison.tsx`  
- **Line:** 67  
- **Current:** `<th>vs Best</th>`  
- **Issue:** "Best" is subjective  
- **Fix:** Change to `<th>Difference</th>` or `<th>vs Highest</th>`

### 1.8 — "Best" Cell Value in Comparison Table

- **File:** `src/components/aggregator/PriceComparison.tsx`  
- **Line:** 101  
- **Current:** `{parseFloat(diffFromBest) === 0 ? 'Best' : \`-${diffFromBest}%\`}`  
- **Issue:** Labels the highest-output route as "Best"  
- **Fix:** Change to `{parseFloat(diffFromBest) === 0 ? 'Highest' : \`-${diffFromBest}%\`}`

### 1.9 — ★ Star Icon Highlighting "Best" Route

- **File:** `src/components/aggregator/PriceComparison.tsx`  
- **Line:** 87  
- **Current:** `{isBest && <span className="text-primary text-xs">★</span>}`  
- **Issue:** A star icon is a visual recommendation that draws the user's attention to one route over others  
- **Fix:** Remove the star icon entirely. All routes should be presented neutrally. If sorting is by output, the position in the table already conveys the information.

### 1.10 — "Optimal Route" in TestingDashboard Description

- **File:** `src/components/aggregator/TestingDashboard.tsx`  
- **Line:** 85  
- **Current:** `Simulate a swap without executing. Uses live pool reserves to compute the optimal route.`  
- **Issue:** Uses "optimal"  
- **Fix:** Change to `...compute available routes.`

### 1.11 — "Multi-hop paths are optimal" Verification Checklist

- **File:** `src/components/aggregator/TestingDashboard.tsx`  
- **Line:** 328  
- **Current:** `{ label: 'Multi-hop paths are optimal', description: 'BFS explores up to 4 hops, selects best output', passed: true }`  
- **Issue:** Uses "optimal" and "best"  
- **Fix:** Change label to `'Multi-hop paths computed correctly'` and description to `'BFS explores up to 4 hops, selects highest output'`

### 1.12 — "findBestRoute" Function Name (Code-Level)

- **File:** `src/services/pathFinder/index.ts`  
- **Line:** 196  
- **Current:** `export function findBestRoute(...)`  
- **Issue:** While internal naming doesn't directly affect users, it reflects a design philosophy of "recommending" rather than "displaying." The function only returns ONE route (the highest-output one) instead of returning ALL routes for user selection.  
- **Fix:** Rename to `findRoutes()` and return ALL viable routes, not just the highest-output one. The UI should present all routes and let the user choose.

### 1.13 — "optimal route" in useRoute Hook Comment

- **File:** `src/hooks/useAggregator/useRoute.ts`  
- **Line:** 4  
- **Current:** `Takes tokenIn, tokenOut, amountIn and returns the optimal route`  
- **Issue:** Comment uses "optimal"  
- **Fix:** Change to `...returns available routes`

### 1.14 — PriceComparison File Comment

- **File:** `src/components/aggregator/PriceComparison.tsx`  
- **Lines:** 3–5  
- **Current:** `Highlights the best route and shows savings percentage vs worst DEX.`  
- **Issue:** Uses "best" and "savings" — subjective/promotional  
- **Fix:** Change to `Displays output amounts across DEXes for comparison.`

---

## Finding 2: No Route Sorting/Filtering Tools (CRITICAL)

**SEC Requirement:** If more than one route is displayed, the interface must provide "filtering or sorting tools based on objective factors (alphabetically, lowest/highest price, or speed)."

### 2.1 — Only One Route Displayed; No Multi-Route UI

- **File:** `src/components/aggregator/AggregatorSwap.tsx`  
- **Line:** 386 — `<RouteVisualization route={route} />`  
- **Issue:** The `route` prop is a single `RouteResult | null`. The path finder (`findBestRoute`) returns only ONE route. There is no mechanism to show multiple routes.  
- **Fix:** 
  1. Modify `findBestRoute()` to return ALL viable routes (e.g., `RouteResult[]`), not just the highest-output one
  2. Add UI to display multiple routes with sorting controls
  3. Add sorting buttons: "Sort by: Output (High→Low) | Output (Low→High) | Hops (Fewest) | DEX Name (A-Z)"
  4. All sort criteria must be objective and independently verifiable

### 2.2 — Price Comparison Sorts by Output Only, No User Controls

- **File:** `src/components/aggregator/PriceComparison.tsx`  
- **Line:** 72  
- **Current:** `.sort((a, b) => Number(b.output - a.output))`  
- **Issue:** The table is hard-coded to sort by output descending. There are no user-accessible sorting controls.  
- **Fix:** Add clickable column headers that allow users to sort by: Output (ascending/descending), Source Name (alphabetical), or Difference. Each sort must use objective, verifiable criteria.

### 2.3 — No "See Additional Routes" Mechanism

- **SEC Requirement:** If showing only one route by default, must let user "see additional routes."  
- **File:** `src/components/aggregator/AggregatorSwap.tsx`  
- **Issue:** Only one route is ever computed and displayed. There is no "Show more routes" or "View all routes" button.  
- **Fix:** Add a "View All Routes" expandable section below the primary route display that shows all viable routes with their outputs, hops, and DEXes used.

---

## Finding 3: No SEC-Required Disclosures or Disclaimers (CRITICAL)

**SEC Requirement:** The interface must "prominently disclose: role, fees, conflicts, parameters, cybersecurity, MEV risks, default logic." Must include a "clear disclaimer that the service is NOT SEC-registered."

### 3.1 — No SEC Registration Disclaimer

- **Issue:** Nowhere in the application is there a disclaimer stating that OmnomSwap is not registered with the SEC, not a broker-dealer, and not an exchange.  
- **Fix:** Add a prominent disclaimer to the Aggregator swap page (e.g., below the swap card or as a persistent footer on the aggregator tab):
  > "OmnomSwap is a decentralized, self-custodial token swap interface. It is NOT registered with the U.S. Securities and Exchange Commission as a broker-dealer, exchange, or alternative trading system. Use of this service does not constitute investment advice or solicitation."

### 3.2 — No Role Disclosure

- **Issue:** The interface does not explain OmnomSwap's role — that it is an off-chain pathfinder that computes routes and submits them to a smart contract for execution.  
- **Fix:** Add a disclosure section:
  > "OmnomSwap's role is limited to computing potential swap routes using publicly available on-chain data (pool reserves). Route computation is performed off-chain; execution is handled by a smart contract. OmnomSwap does not custody funds, execute trades, or act as a counterparty."

### 3.3 — No Fee Disclosure (Beyond Inline Display)

- **Issue:** While the fee amount is shown inline (AggregatorSwap.tsx line 328: "Protocol Fee (0.1%)"), there is no comprehensive fee disclosure explaining: what the fee is for, how it's calculated, who receives it, and that it's applied uniformly regardless of route.  
- **Fix:** Add a fee disclosure panel:
  > "Protocol Fee: A flat fee of 0.1% (10 basis points) is deducted from the input amount before swap execution. This fee is sent to the protocol treasury and is identical regardless of which DEX route is used. The fee amount is displayed before you confirm the transaction."

### 3.4 — No Conflict of Interest Disclosure

- **Issue:** No disclosure about potential conflicts (e.g., if the OmnomSwap team holds OMNOM tokens, or if the treasury benefits from volume).  
- **Fix:** Add a conflicts disclosure:
  > "The OmnomSwap protocol treasury receives a percentage of each swap. The development team may hold OMNOM tokens. This creates a potential conflict of interest as higher volume benefits token holders and the treasury."

### 3.5 — No MEV Risk Disclosure

- **Issue:** No mention of MEV (Maximal Extractable Value), sandwich attacks, or front-running risks anywhere in the codebase.  
- **Fix:** Add an MEV risk disclosure:
  > "MEV Risk: Transactions submitted to the blockchain may be subject to Maximal Extractable Value (MEV) extraction, including sandwich attacks and front-running. This can result in less favorable execution prices. Consider using MEV-protected transaction submission if available."

### 3.6 — No Cybersecurity Disclosure

- **Issue:** No disclosure about cybersecurity risks (smart contract risk, frontend compromise, phishing).  
- **Fix:** Add a cybersecurity disclosure:
  > "Cybersecurity Risks: Using decentralized protocols involves risks including smart contract vulnerabilities, frontend manipulation, and phishing attacks. Always verify the contract address and use bookmarks to access this interface. No warranty is provided regarding the security of the system."

### 3.7 — No Default Logic/Parameter Disclosure

- **Issue:** The default parameters (slippage 0.5%, deadline 5 minutes, fee 0.1%) are not disclosed as defaults with an explanation of how they were chosen.  
- **Fix:** Add a parameters disclosure:
  > "Default Parameters: The interface uses the following default values: Slippage Tolerance: 0.5%, Transaction Deadline: 5 minutes, Protocol Fee: 0.1% (10 bps). Route selection uses a BFS algorithm that evaluates all paths up to 4 hops and selects the path with the highest expected output. These defaults can be customized in the settings panel."

---

## Finding 4: No Educational Materials (CRITICAL)

**SEC Requirement:** The interface must "provide educational material."

### 4.1 — No Educational Content Anywhere

- **Issue:** The entire frontend contains no educational content about: how DEX aggregation works, what slippage is, what price impact means, how AMMs determine prices, what the risks of DeFi trading are, or how to interpret route information.  
- **Fix:** Create an educational section (accessible via a "Learn" or "?" button on the aggregator page) covering:
  1. **What is a DEX aggregator?** — Explains off-chain route computation, on-chain execution
  2. **How routes are computed** — BFS algorithm, objective criteria (highest output)
  3. **Understanding slippage** — What it is, how to set it, trade-offs
  4. **Price impact** — How large trades affect the price relative to pool reserves
  5. **Understanding fees** — Protocol fee, pool fee (0.3%), how they're calculated
  6. **Risks of DeFi trading** — Smart contract risk, impermanent loss (for LPs), MEV, price volatility
  7. **Self-custody** — How your wallet controls your funds at all times

---

## Finding 5: No Venue Onboarding/Audit Policies (HIGH)

**SEC Requirement:** Have "policies to onboard/audit venues based on objective factors (liquidity, latency, security)."

### 5.1 — DEX Registry Has No Published Onboarding Criteria

- **File:** `src/lib/constants.ts`  
- **Lines:** 242–249 (`DEX_REGISTRY`)  
- **Issue:** Six DEXes are hardcoded in the registry with no documentation of the criteria used to select them. There are no published policies about how DEXes are evaluated, onboarded, or audited.  
- **Fix:** 
  1. Create a published document/page explaining the objective criteria for DEX inclusion: minimum liquidity thresholds, audit status, uptime requirements, smart contract security review
  2. Add a link to this policy from the aggregator UI
  3. Consider adding a "Venue Information" panel showing each DEX's objective metrics (liquidity, latency, security score)

---

## Finding 6: Incomplete User Customization (HIGH)

**SEC Requirement:** Let users "customize any default parameters."

### 6.1 — Slippage and Deadline Are Customizable (PASS)

- **File:** `src/components/aggregator/AggregatorSwap.tsx`  
- **Lines:** 184–226 (Settings Panel)  
- **Status:** ✅ Users can customize slippage tolerance (0.1%, 0.5%, 1.0%, or custom) and transaction deadline. This is compliant.

### 6.2 — Route Selection Is NOT Customizable (FAIL)

- **Issue:** The user cannot choose which route to execute. The path finder returns only one route (highest output), and the swap button executes that single route. The user has no ability to select an alternative route even if they prefer fewer hops or a specific DEX.  
- **Fix:** Display all viable routes and allow the user to select which one to execute. The default can be the highest-output route, but the user must be able to choose differently.

### 6.3 — Fee Rate Is NOT User-Customizable (INFORMATIONAL)

- **Issue:** The protocol fee (0.1%) is set by the contract owner and cannot be customized by users. This is acceptable as it's a protocol-level parameter, not a UI default. However, it should be clearly disclosed as non-negotiable.

---

## Finding 7: Route Finder — Discretionary Logic Analysis (MODERATE)

**SEC Requirement:** The interface must "not exercise any control or discretion over the market data or the transaction itself" and must use "only pre-disclosed and objective parameters that are independently verifiable."

### 7.1 — Route Selection Algorithm Is Objective (PASS with Caveat)

- **File:** `src/services/pathFinder/index.ts`  
- **Function:** `findBestRoute()` (line 196)  
- **Analysis:** The algorithm uses BFS to enumerate all paths up to 4 hops, calculates output using the constant-product AMM formula, and selects the route with the highest output. This is an **objective, verifiable criterion** (highest numerical output).  
- **Caveat:** While the selection criterion is objective, the fact that only ONE route is returned (instead of all routes) means the interface is exercising discretion by choosing FOR the user. The SEC staff statement implies users should be able to see and choose among routes.  
- **Fix:** Return all viable routes, not just one. Let the user make the final selection.

### 7.2 — Per-Hop DEX Selection Is Objective (PASS)

- **File:** `src/services/pathFinder/index.ts`  
- **Function:** `calculatePathOutput()` (line 72)  
- **Analysis:** For each hop, if multiple DEXes offer the same token pair, the algorithm selects the one with the highest output (line 93–101). This is objective and verifiable.

### 7.3 — MAX_HOPS = 4 Is an Undisclosed Parameter

- **File:** `src/services/pathFinder/index.ts`  
- **Line:** 13  
- **Current:** `const MAX_HOPS = 4;`  
- **Issue:** The maximum hop count is a parameter that affects route results but is not disclosed to users.  
- **Fix:** Disclose in the parameters section: "Routes are limited to a maximum of 4 hops to balance gas costs with output optimization."

---

## Finding 8: Fee Structure Analysis (PASS)

**SEC Requirement:** Charge only "fixed/neutral fees (flat or percentage, applied consistently, agnostic to route/venue)."

### 8.1 — Protocol Fee Is Fixed and Route-Agnostic (PASS)

- **File:** `src/services/pathFinder/index.ts`  
- **Lines:** 218–219  
- **Code:**
  ```ts
  const feeAmount = (amountIn * BigInt(feeBps)) / FEE_DENOMINATOR;
  const swapAmount = amountIn - feeAmount;
  ```
- **Analysis:** The fee is calculated as a flat percentage (0.1% = 10 bps) of the input amount, BEFORE route computation. It does not vary by route, DEX, token pair, or any other factor. ✅ COMPLIANT.

### 8.2 — On-Chain Fee Is Also Fixed (PASS)

- **File:** `contracts/OmnomSwapAggregator.sol`  
- **Lines:** 191–192  
- **Code:**
  ```solidity
  uint256 feeAmount = (request.amountIn * protocolFeeBps) / _BPS_DENOMINATOR;
  uint256 swapAmount = request.amountIn - feeAmount;
  ```
- **Analysis:** The smart contract applies the same flat percentage fee regardless of route. ✅ COMPLIANT.

---

## Finding 9: Self-Custody Analysis (PASS)

**SEC Requirement:** 100% self-custodial (no custody of user funds).

### 9.1 — Contract Never Holds User Funds Between Transactions (PASS)

- **File:** `contracts/OmnomSwapAggregator.sol`  
- **Lines:** 178–254 (`executeSwap`)  
- **Analysis:** The contract transfers tokens from the user, deducts the fee, executes swaps, and transfers the final output to the user — all in a single atomic transaction. The contract never retains user funds. The `rescueTokens()` function (line 369) exists only for recovering tokens sent by mistake. ✅ COMPLIANT.

### 9.2 — Frontend Never Has Access to Private Keys (PASS)

- **Analysis:** The frontend uses wagmi/viem for wallet interaction. All transactions must be signed by the user's wallet. The frontend never has access to private keys or seed phrases. ✅ COMPLIANT.

---

## Finding 10: No Solicitation Analysis (PASS)

**SEC Requirement:** Cannot "solicit specific transactions or give investment advice."

### 10.1 — No Investment Advice (PASS)

- **Analysis:** The frontend does not contain investment advice, profit projections, or recommendations to buy/sell specific tokens. The token selector presents all available tokens equally without promoting any particular one. ✅ COMPLIANT.

### 10.2 — Borderline: "Save up to X%" (VIOLATION — covered in Finding 1.6)

- The "Save up to X%" display in PriceComparison could be interpreted as solicitation. This is covered in Finding 1.6 above.

---

## Finding 11: Additional Issues in Non-Aggregator Components

These findings are in components outside the aggregator but are relevant if the entire frontend is considered part of the Covered User Interface.

### 11.1 — "best available on Dogechain" Comment in SwapScreen

- **File:** `src/components/SwapScreen.tsx`  
- **Line:** 169  
- **Current:** `// Price quoting via V2 router (best available on Dogechain)`  
- **Issue:** Code comment (not user-visible). Low priority but should be changed for consistency.  
- **Fix:** Change to `// Price quoting via V2 router (primary source on Dogechain)`

### 11.2 — "Most reliable" Comment in SwapScreen

- **File:** `src/components/SwapScreen.tsx`  
- **Line:** 212  
- **Current:** `// Most reliable for the main OMNOM/WWDOGE pool`  
- **Issue:** Code comment uses "most reliable" — subjective. Not user-visible.  
- **Fix:** Change to `// Primary source for the main OMNOM/WWDOGE pool`

### 11.3 — "high slippage recommended" in LiquidityModal

- **File:** `src/components/LiquidityModal.tsx`  
- **Line:** 356  
- **Current:** `Low-liquidity pool — high slippage recommended (3%+).`  
- **Issue:** Uses "recommended" — could be seen as advice. This is in the LP modal, not the aggregator, but is still part of the interface.  
- **Fix:** Change to `Low-liquidity pool — consider using higher slippage (3%+) to avoid transaction failure.`

---

## Prioritized Implementation Task List

### Priority 1: CRITICAL — Must Fix Before Any Public Launch

| # | Task | Files to Modify | Effort |
|---|---|---|---|
| P1.1 | Remove all "best" language from UI strings | `AggregatorSwap.tsx`, `PriceComparison.tsx` | Small |
| P1.2 | Remove all "optimal" language from UI strings | `RouteVisualization.tsx`, `TestingDashboard.tsx` | Small |
| P1.3 | Remove "Save up to X%" display and TrendingUp icon | `PriceComparison.tsx` | Small |
| P1.4 | Remove ★ star icon from price comparison table | `PriceComparison.tsx` | Small |
| P1.5 | Change "vs Best" column header to "vs Highest" | `PriceComparison.tsx` | Small |
| P1.6 | Change "Best" cell value to "Highest" | `PriceComparison.tsx` | Small |
| P1.7 | Add SEC registration disclaimer to aggregator page | `AggregatorSwap.tsx` or new component | Medium |
| P1.8 | Add comprehensive disclosures panel (role, fees, conflicts, MEV, cybersecurity, parameters) | New component `Disclosures.tsx` | Medium |
| P1.9 | Modify path finder to return ALL routes, not just one | `pathFinder/index.ts`, `useRoute.ts` | Medium |
| P1.10 | Add multi-route display UI with user route selection | `AggregatorSwap.tsx`, `RouteVisualization.tsx` | Large |
| P1.11 | Add route sorting/filtering controls (by output, hops, DEX name) | `RouteVisualization.tsx` or new component | Medium |
| P1.12 | Add "View All Routes" expandable section | `AggregatorSwap.tsx` | Medium |
| P1.13 | Create educational materials section | New component `EducationalContent.tsx` | Large |

### Priority 2: HIGH — Must Fix Before Claiming Compliance

| # | Task | Files to Modify | Effort |
|---|---|---|---|
| P2.1 | Publish DEX venue onboarding/audit policy | New doc + link in UI | Medium |
| P2.2 | Add venue information panel with objective metrics | New component | Medium |
| P2.3 | Disclose MAX_HOPS parameter and default logic | `AggregatorSwap.tsx` disclosures | Small |
| P2.4 | Add MEV risk disclosure | `Disclosures.tsx` | Small |
| P2.5 | Add cybersecurity risk disclosure | `Disclosures.tsx` | Small |

### Priority 3: MODERATE — Should Fix for Full Compliance

| # | Task | Files to Modify | Effort |
|---|---|---|---|
| P3.1 | Update file-level comments to remove subjective language | Multiple files | Small |
| P3.2 | Rename `findBestRoute` to `findRoutes` (return all) | `pathFinder/index.ts`, all callers | Medium |
| P3.3 | Add user controls for price comparison table sorting | `PriceComparison.tsx` | Small |
| P3.4 | Fix "recommended" language in LiquidityModal | `LiquidityModal.tsx` | Small |

---

## Detailed String Replacement Reference

### Exact String Changes Required

| File | Line | Current String | Replacement String |
|---|---|---|---|
| `AggregatorSwap.tsx` | 106 | `'FINDING BEST ROUTE...'` | `'COMPUTING ROUTE...'` |
| `AggregatorSwap.tsx` | 307 | `Finding best route across all DEXes...` | `Computing available routes across all DEXes...` |
| `RouteVisualization.tsx` | 33 | `No route found. Enter an amount to see the optimal path.` | `No route found. Enter an amount to see available routes.` |
| `RouteVisualization.tsx` | 48 | `Optimal Route` | `Selected Route` |
| `PriceComparison.tsx` | 4 | `Highlights the best route and shows savings percentage vs worst DEX.` | `Displays output amounts across DEXes for comparison.` |
| `PriceComparison.tsx` | 32 | `'OmnomSwap (Best Route)'` | `'OmnomSwap (Aggregated)'` |
| `PriceComparison.tsx` | 56 | `Save up to {savingsVsWorst}%` | *(remove entire block)* |
| `PriceComparison.tsx` | 67 | `vs Best` | `vs Highest` |
| `PriceComparison.tsx` | 87 | `{isBest && <span>★</span>}` | *(remove)* |
| `PriceComparison.tsx` | 101 | `'Best'` | `'Highest'` |
| `TestingDashboard.tsx` | 85 | `compute the optimal route` | `compute available routes` |
| `TestingDashboard.tsx` | 328 | `Multi-hop paths are optimal` / `selects best output` | `Multi-hop paths computed correctly` / `selects highest output` |
| `LiquidityModal.tsx` | 356 | `high slippage recommended` | `consider using higher slippage` |

---

## Architectural Changes Required

### 1. Multi-Route Architecture

The current architecture computes a single "best" route:

```
findBestRoute() → RouteResult (single route)
```

It must be changed to:

```
findAllViableRoutes() → RouteResult[] (all routes with output > 0)
```

The UI must then:
1. Display all routes (not just one)
2. Default to sorting by highest output (objective criterion)
3. Allow user to re-sort by other objective criteria
4. Allow user to select which route to execute
5. Clearly indicate which route is selected

### 2. Disclosures Architecture

Create a new `Disclosures` component that is always visible on the aggregator tab, containing:
- SEC registration disclaimer (persistent, not behind a click)
- Expandable sections for: Role, Fees, Conflicts, Parameters, MEV, Cybersecurity
- Link to educational materials
- Link to venue onboarding policy

### 3. Educational Content Architecture

Create a new `EducationalContent` component (or separate page) with structured articles about:
- DEX aggregation mechanics
- Slippage and price impact
- AMM pricing (constant-product formula)
- Self-custody and wallet security
- Risk factors in DeFi trading

---

## Files Audited

| File | Lines | Status |
|---|---|---|
| `src/components/aggregator/AggregatorSwap.tsx` | 405 | ❌ Issues found |
| `src/components/aggregator/RouteVisualization.tsx` | 123 | ❌ Issues found |
| `src/components/aggregator/PriceComparison.tsx` | 111 | ❌ Issues found |
| `src/components/aggregator/TokenSelector.tsx` | 126 | ✅ Compliant |
| `src/components/aggregator/TreasuryDashboard.tsx` | 92 | ✅ Compliant |
| `src/components/aggregator/SwapHistory.tsx` | 171 | ✅ Compliant |
| `src/components/aggregator/TestingDashboard.tsx` | 460 | ❌ Issues found |
| `src/hooks/useAggregator/useSwap.ts` | 167 | ✅ Compliant |
| `src/hooks/useAggregator/useRoute.ts` | 133 | ⚠️ Minor issues (comments) |
| `src/services/pathFinder/index.ts` | 327 | ❌ Architectural issue |
| `src/services/pathFinder/types.ts` | 85 | ✅ Compliant |
| `src/services/pathFinder/poolFetcher.ts` | 161 | ✅ Compliant |
| `src/lib/constants.ts` | 250 | ⚠️ Missing policy docs |
| `src/App.tsx` | 129 | ⚠️ Missing disclaimers |
| `src/components/Header.tsx` | 160 | ✅ Compliant |
| `contracts/OmnomSwapAggregator.sol` | 390 | ✅ Compliant (fees, custody) |

---

## Conclusion

The OmnomSwap aggregator frontend has a solid technical foundation for SEC compliance in areas of self-custody, fee neutrality, and non-solicitation. However, it has significant gaps in three areas that the SEC staff statement specifically requires:

1. **Subjective language** — The UI repeatedly uses "best," "optimal," and "save" which the SEC explicitly prohibits as recommendation language
2. **Missing disclosures** — No SEC disclaimer, no role disclosure, no MEV/cybersecurity risk warnings, no conflict of interest disclosure
3. **Single-route display** — The path finder returns only one route instead of presenting all options with sorting tools for user selection

The highest-priority fixes are string replacements (P1.1–P1.6) which can be completed quickly. The architectural change to multi-route display (P1.9–P1.12) requires more engineering effort but is essential for compliance. The disclosures (P1.7–P1.8) and educational materials (P1.13) should be developed in parallel.
