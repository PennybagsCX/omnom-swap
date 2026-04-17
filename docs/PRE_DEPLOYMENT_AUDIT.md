# Pre-Deployment Audit Report — OmnomSwap

**Date:** 2026-04-17  
**Auditor:** Automated comprehensive audit  
**Scope:** Full codebase — contracts, frontend, configuration, deployment scripts  
**Status:** ✅ READY FOR DEPLOYMENT

---

## Executive Summary

All 87 Foundry tests pass. The frontend builds with zero errors. The smart contract includes all required security features. Configuration is consistent across all files. Three minor issues were found and fixed during this audit. **No blockers for deployment.**

---

## Part 1: Test & Build Results

### Foundry Test Suite

```
Ran 3 test suites in 124.44ms: 87 tests passed, 0 failed, 0 skipped (87 total tests)
```

| Suite | Tests | Status |
|-------|-------|--------|
| `OmnomSwapAggregator.t.sol` | 49 | ✅ PASS |
| `FeeDistribution.t.sol` | — | ✅ PASS |
| `MultiHopRouting.t.sol` | — | ✅ PASS |

### Frontend Build

```
vite v6.4.2 building for production...
✓ 3578 modules transformed.
✓ built in 2.25s
```

| Chunk | Size (gzip) |
|-------|-------------|
| `index.js` | 122.34 kB |
| `web3.js` | 107.24 kB |
| `ui.js` | 36.45 kB |
| `vendor.js` | 1.50 kB |
| `index.css` | 9.50 kB |

**Result: ✅ PASS — 0 errors, 0 warnings**

---

## Part 2: WalletModal Audit

### 2.1 Connector Deduplication — ✅ PASS

The `deduplicatedConnectors` memoized filter in [`WalletModal.tsx`](src/components/WalletModal.tsx:111) correctly:

- Hides the dedicated MetaMask connector when `window.ethereum` exists (the generic `injected()` connector already wraps it)
- Hides the dedicated Coinbase Wallet connector when the injected provider is Coinbase
- Preserves WalletConnect and other non-injected connectors

No duplicate entries possible for any wallet provider.

### 2.2 Virtual Trust Wallet Entry — ✅ PASS

The virtual Trust Wallet entry at [`WalletModal.tsx:246`](src/components/WalletModal.tsx:246):

- Shows as a separate button with Trust Wallet branding
- Connects via the WalletConnect connector
- Only appears if WalletConnect is configured AND Trust Wallet is not already the injected provider
- Has distinct `isVirtual: true` flag for separate state tracking

### 2.3 Pending State Tracking — ✅ PASS

Two independent state variables at [`WalletModal.tsx:101-102`](src/components/WalletModal.tsx:101):

- `pendingConnector: string | null` — tracks real connector UIDs
- `pendingVirtual: boolean` — tracks virtual Trust Wallet separately

Both are cleared in success paths (line 134, 270) and error paths (line 138, 274). The `isPending` flag (line 256) disables all buttons when any connection is in progress. No stuck states possible.

### 2.4 Type Safety — ✅ PASS

- No implicit `any` — all catch blocks use `err: unknown`
- `formatConnectionError(err: unknown)` properly type-narrowed with `instanceof Error`
- `displayItems` array has explicit `Array<{...}>` type annotation
- All React event handlers properly typed

### 2.5 Error Handling — ✅ PASS

`connectAsync` is wrapped in try/catch for both regular connectors (line 132-141) and virtual Trust Wallet (line 268-277). The [`formatConnectionError()`](src/components/WalletModal.tsx:53) function handles:

- User rejection ("rejected", "denied")
- Minified runtime errors (regex: `/^\w is not a function$/i`) — Telegram browser
- No provider errors
- Pending request conflicts
- Chain not configured errors
- Long error truncation (>120 chars)

### 2.6 Edge Cases — ✅ PASS

| Edge Case | Handling |
|-----------|----------|
| No `window.ethereum` | `detectInjectedProvider()` returns null → "Browser Wallet" shown |
| Telegram browser | Minified error regex catches broken providers |
| Unknown provider | Falls back to connector name with generic icon |
| WalletConnect not configured | Connector omitted from list, virtual Trust Wallet not shown |

---

## Part 3: Configuration Validation

### 3.1 wagmi config — [`config.ts`](src/lib/web3/config.ts) — ✅ PASS

| Check | Value | Expected | Status |
|-------|-------|----------|--------|
| Chain | `dogechain` (from wagmi/chains) | Chain ID 2000 | ✅ |
| Transport | `http(RPC_URL)` with env fallback | Dogechain RPC | ✅ |
| WalletConnect | Conditional on `VITE_WALLETCONNECT_PROJECT_ID` | Graceful degradation | ✅ |
| Connectors | metaMask, injected, walletConnect, coinbaseWallet | All present | ✅ |

### 3.2 Constants — [`constants.ts`](src/lib/constants.ts) — ✅ PASS

| Check | Value | Status |
|-------|-------|--------|
| `NETWORK_INFO.chainId` | `2000` | ✅ |
| `NETWORK_INFO.rpcUrl` | `https://rpc.dogechain.dog` | ✅ |
| `NETWORK_INFO.blockExplorer` | `https://explorer.dogechain.dog` | ✅ |
| DEX routers in CONTRACTS | 5 (DogeSwap, DogeShrk, WOJAK, KibbleSwap, YodeSwap) | ✅ |
| DEX entries in DEX_REGISTRY | 5 matching entries | ✅ |
| Aggregator address | `0x...001` (placeholder) | ✅ |
| `isAggregatorDeployed()` | Checks against placeholder | ✅ |

### 3.3 Environment — [`.env.example`](.env.example) — ✅ PASS

All environment variables documented with clear comments:
- `PRIVATE_KEY` — deployer key (never commit real key)
- `TREASURY_ADDRESS` — fee recipient
- `PROTOCOL_FEE_BPS` — 25 bps default
- `DOGCHAIN_RPC_URL` — Dogechain RPC
- `VITE_RPC_URL` — frontend RPC (optional)
- `VITE_WALLETCONNECT_PROJECT_ID` — WalletConnect (optional)
- `AGGREGATOR_ADDRESS` — post-deployment setup
- `NEW_TREASURY`, `NEW_FEE_BPS` — optional updates

### 3.4 Foundry Config — [`foundry.toml`](foundry.toml) — ✅ PASS

| Check | Value | Status |
|-------|-------|--------|
| Solidity version | `0.8.19` | ✅ |
| Optimizer | enabled, 200 runs | ✅ |
| RPC endpoints | `dogechain = "https://rpc.dogechain.dog"` | ✅ |

### 3.5 Deploy Script — [`Deploy.s.sol`](script/Deploy.s.sol) — ✅ PASS

- All 5 DEX routers registered (lines 51-55)
- Router addresses match [`constants.ts`](src/lib/constants.ts) exactly
- Validates `treasury != address(0)` and `feeBps <= 500`
- Reads config from environment variables
- Logs deployment details for verification

### 3.6 Setup Script — [`Setup.s.sol`](script/Setup.s.sol) — ✅ PASS

- Idempotent router registration (checks `supportedRouters` first)
- Optional treasury update via `NEW_TREASURY` env var
- Optional fee update via `NEW_FEE_BPS` env var
- Configuration verification logging

---

## Part 4: Contract Deployment Readiness

### [`OmnomSwapAggregator.sol`](contracts/OmnomSwapAggregator.sol) — ✅ PASS

#### Constructor Parameters
- `_treasury` (address) — validated != zero
- `_protocolFeeBps` (uint256) — validated <= MAX_FEE_BPS (500)

#### Security Features

| Feature | Implementation | Status |
|---------|---------------|--------|
| ReentrancyGuard | `nonReentrant` modifier on `executeSwap` and `rescueTokens` | ✅ |
| Deadline protection | `block.timestamp <= request.deadline` | ✅ |
| Slippage protection | `runningBalance >= request.minTotalAmountOut` | ✅ |
| Router whitelist | `supportedRouters[step.router]` required | ✅ |
| Path validation | `step.path[0] == currentToken` enforced | ✅ |
| Zero-address checks | treasury, recipient, router, newOwner | ✅ |
| Approval reset | Approval set to 0 after each swap step | ✅ |
| SafeERC20 | Handles non-standard tokens (USDT-style) | ✅ |

#### Protocol Fee
- Default: **25 bps (0.25%)** — configured via constructor
- Maximum: 500 bps (5%) — enforced by `MAX_FEE_BPS` constant
- Deducted from input before swaps: `feeAmount = (amountIn * protocolFeeBps) / 10000`

#### Administrative Functions

| Function | Purpose | Status |
|----------|---------|--------|
| `transferOwnership(address)` | Transfer contract ownership | ✅ |
| `pause()` | Emergency pause all swaps | ✅ |
| `unpause()` | Resume swaps | ✅ |
| `setTreasury(address)` | Update fee recipient | ✅ |
| `setProtocolFee(uint256)` | Update protocol fee | ✅ |
| `addRouter(address)` | Add DEX router to whitelist | ✅ |
| `removeRouter(address)` | Remove DEX router from whitelist | ✅ |
| `rescueTokens(address, uint256)` | Recover stuck tokens | ✅ |

#### Fee Consistency (25 bps across all layers)

| Layer | Value | Status |
|-------|-------|--------|
| Contract constructor default | 25 bps (via `.env`) | ✅ |
| `.env.example` | `PROTOCOL_FEE_BPS=25` | ✅ |
| `useRoute.ts` default | `feeBps: number = 25` | ✅ |
| `useReverseRoute.ts` default | `feeBps: number = 25` | ✅ |
| `pathFinder/index.ts` default | `feeBps: number = 25` | ✅ |

---

## Part 5: Frontend-to-Contract Integration

### 5.1 [`useSwap.ts`](src/hooks/useAggregator/useSwap.ts) — ✅ PASS

- `executeSwap` builds `SwapRequest` with correct field ordering matching the contract's `SwapRequest` struct
- Approval flow: checks existing allowance, approves with 0.1% buffer (not unlimited — MEV protection)
- Transaction lifecycle: pending → confirming → confirmed, with proper state cleanup
- Error handling: try/catch with user-friendly error messages

### 5.2 [`useAggregatorContract.ts`](src/hooks/useAggregator/useAggregatorContract.ts) — ✅ PASS

- Reads: `owner`, `treasury`, `protocolFeeBps`, `paused`, `getRouterCount`
- `isAggregatorDeployed()` guard: passes `undefined` address when not deployed
- `query: { enabled: deployed }` prevents RPC calls to placeholder address
- Error state tracking distinguishes "not deployed" from "RPC error"

### 5.3 ABI Match — ✅ PASS (fixed during audit)

| Contract Function/Event | Frontend ABI | Status |
|------------------------|-------------|--------|
| `owner()` | ✅ | Present |
| `treasury()` | ✅ | Present |
| `protocolFeeBps()` | ✅ | Present |
| `paused()` | ✅ | Present |
| `supportedRouters(address)` | ✅ | Present |
| `routerList(uint256)` | ✅ | Present |
| `getRouterCount()` | ✅ | Present |
| `executeSwap(SwapRequest)` | ✅ | Present |
| `addRouter(address)` | ✅ | Present |
| `removeRouter(address)` | ✅ | Present |
| `setTreasury(address)` | ✅ | Present |
| `setProtocolFee(uint256)` | ✅ | Present |
| `pause()` | ✅ | Present |
| `unpause()` | ✅ | Present |
| `rescueTokens(address, uint256)` | ✅ | Present |
| `transferOwnership(address)` | ✅ | **Added during audit** |
| `SwapExecuted` event | ✅ | Present |
| `RouterAdded` event | ✅ | Present |
| `RouterRemoved` event | ✅ | Present |
| `TreasuryUpdated` event | ✅ | Present |
| `ProtocolFeeUpdated` event | ✅ | Present |
| `OwnershipTransferred` event | ✅ | **Added during audit** |
| `TokensRescued` event | ✅ | **Added during audit** |
| `Paused` event | ✅ | Present |
| `Unpaused` event | ✅ | Present |

### 5.4 TypeScript Types vs Contract Structs

| Contract Struct | TypeScript Interface | Match |
|----------------|---------------------|-------|
| `SwapStep { router, path, amountIn, minAmountOut }` | `SwapStepRequest { router, path, amountIn, minAmountOut }` | ✅ Exact |
| `SwapRequest { tokenIn, tokenOut, amountIn, minTotalAmountOut, steps, deadline, recipient }` | `SwapRequest { tokenIn, tokenOut, amountIn, minTotalAmountOut, steps, deadline, recipient }` | ✅ Exact |

---

## Part 6: Issues Found

### Fixed During Audit

| # | Severity | Description | Fix |
|---|----------|-------------|-----|
| 1 | LOW | `transferOwnership(address)` missing from frontend ABI | Added to `OMNOMSWAP_AGGREGATOR_ABI` |
| 2 | LOW | `OwnershipTransferred` event missing from frontend ABI | Added to `OMNOMSWAP_AGGREGATOR_ABI` |
| 3 | LOW | `TokensRescued` event missing from frontend ABI | Added to `OMNOMSWAP_AGGREGATOR_ABI` |

### No Issues Found (Informational)

| Area | Notes |
|------|-------|
| `.env` contains WalletConnect project ID | Not a secret — it's a public project ID embedded in frontend builds. `.env` is gitignored. |
| Aggregator address is placeholder | By design — will be updated after contract deployment |
| `DOGCHAIN_RPC_URL` env var name | Cosmetic only — not used by any script directly (forge uses foundry.toml RPC endpoints) |

---

## Deployment Readiness Checklist

| # | Check | Status |
|---|-------|--------|
| 1 | All 87 Foundry tests pass | ✅ PASS |
| 2 | Frontend builds with 0 errors | ✅ PASS |
| 3 | WalletModal: no duplicate connectors | ✅ PASS |
| 4 | WalletModal: virtual Trust Wallet works | ✅ PASS |
| 5 | WalletModal: pending states correct | ✅ PASS |
| 6 | WalletModal: type-safe, no implicit any | ✅ PASS |
| 7 | WalletModal: error handling complete | ✅ PASS |
| 8 | Chain ID 2000 everywhere | ✅ PASS |
| 9 | RPC URLs point to Dogechain | ✅ PASS |
| 10 | Aggregator address consistent (placeholder) | ✅ PASS |
| 11 | All 5 DEX routers in deploy script | ✅ PASS |
| 12 | All 5 DEX routers in DEX_REGISTRY | ✅ PASS |
| 13 | Protocol fee 25 bps in contract | ✅ PASS |
| 14 | Protocol fee 25 bps in frontend | ✅ PASS |
| 15 | ReentrancyGuard on swap + rescue | ✅ PASS |
| 16 | Deadline protection | ✅ PASS |
| 17 | Slippage protection | ✅ PASS |
| 18 | Router whitelist | ✅ PASS |
| 19 | Ownership transfer function | ✅ PASS |
| 20 | Pause/unpause mechanism | ✅ PASS |
| 21 | Token rescue function | ✅ PASS |
| 22 | ABI matches contract interface | ✅ PASS |
| 23 | `isAggregatorDeployed()` guard works | ✅ PASS |
| 24 | `.env.example` documents all vars | ✅ PASS |
| 25 | `.gitignore` covers `.env` | ✅ PASS |
| 26 | Solidity 0.8.19, optimizer on | ✅ PASS |

---

## Deployment Instructions

### Step 1: Deploy Contract
```bash
# Set real values in .env
source .env
forge script script/Deploy.s.sol:DeployAggregator --rpc-url dogechain --broadcast
```

### Step 2: Update Frontend
1. Copy deployed aggregator address from forge output
2. Update `OMNOMSWAP_AGGREGATOR_ADDRESS` in `src/lib/constants.ts`
3. Verify `isAggregatorDeployed()` returns `true`

### Step 3: Post-Deployment Setup (optional)
```bash
# Update AGGREGATOR_ADDRESS in .env
source .env
forge script script/Setup.s.sol:SetupAggregator --rpc-url dogechain --broadcast
```

### Step 4: Deploy Frontend
```bash
npm run build
# Deploy to Vercel
```

---

## Conclusion

**The OmnomSwap codebase is READY FOR DEPLOYMENT.** All tests pass, the build succeeds, security features are complete, configuration is consistent, and the frontend correctly integrates with the contract. The three minor ABI gaps found during audit have been fixed. No blockers remain.
