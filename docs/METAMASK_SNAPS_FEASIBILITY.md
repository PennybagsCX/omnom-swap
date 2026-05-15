# MetaMask Snaps Feasibility Assessment — OMNOM SWAP

> **Date**: 2025-05-14  
> **Status**: Research & Analysis (no source files modified)  
> **Scope**: Technical feasibility of integrating MetaMask Snaps into the OMNOM SWAP DEX aggregator on Dogechain

---

## Table of Contents

1. [What Are MetaMask Snaps?](#1-what-are-metamask-snaps)
2. [Architecture Compatibility Assessment](#2-architecture-compatibility-assessment)
3. [Level of Effort Analysis](#3-level-of-effort-analysis)
4. [Relevant Snaps for a DEX](#4-relevant-snaps-for-a-dex)
5. [Dependency and Configuration Changes](#5-dependency-and-configuration-changes)
6. [Risk Assessment](#6-risk-assessment)
7. [Recommendation](#7-recommendation)

---

## 1. What Are MetaMask Snaps?

### Overview

MetaMask Snaps are third-party JavaScript modules that run inside the MetaMask extension's **secure sandbox** (powered by SES — Secure ECMAScript / LavaMoat). They extend MetaMask's capabilities beyond its built-in EVM wallet functionality without requiring users to install a separate browser extension.

Snaps are isolated programs that MetaMask executes in a compartmentalized environment with limited permissions. Users must explicitly approve each Snap and grant specific permissions before it can operate.

### Snap Capabilities

| Capability | JSON-RPC Method | Description |
|---|---|---|
| **Transaction Insights** | `wallet_snap` (read) | Display custom UI in the MetaMask confirmation window before a transaction is signed. Can decode calldata, show price impact, route visualization. |
| **Custom RPC Methods** | `wallet_snap` (invoke) | Expose new JSON-RPC methods that dApps can call through `window.ethereum.request()`. Enables chain-specific logic. |
| **Key Management** | `snap_getBip32Entropy`, `snap_getBip44Entropy` | Derive and manage keys using BIP-32/BIP-44 HD paths. Can support non-EVM curves (Ed25519, secp256k1, etc.). |
| **Notifications** | `snap_notify` (in-app) | Display in-MetaMask notifications. No push notifications to OS level. |
| **Cron Jobs** | `snap_manageState` + periodic execution | Run background tasks on a schedule (e.g., price monitoring). |
| **Network Access** | `snap_fetch` | Make HTTP requests from within the Snap to external APIs. |
| **Persistent State** | `snap_manageState` | Store encrypted state within MetaMask's local storage. |
| **Dialogs** | `snap_dialog` | Show custom approval/alert dialogs inside MetaMask UI. |

### Snaps APIs Relevant to a DEX

For OMNOM SWAP specifically, the most relevant APIs are:

1. **`onTransaction` handler** — The Transaction Insights API lets a Snap intercept the confirmation flow and display decoded swap parameters (tokens, amounts, route, price impact, slippage, fees) directly in MetaMask's signature dialog.

2. **`snap_notify`** — Show in-wallet notifications for swap completion, price alerts, or liquidity events.

3. **`snap_dialog`** — Custom dialogs for warnings about high-fee tokens, rug-pull indicators, or unusual slippage.

4. **`snap_fetch`** — Fetch off-chain price data, token metadata, or route information from within the Snap.

5. **`snap_manageState`** — Persist user preferences (slippage tolerance, trusted tokens) inside MetaMask.

---

## 2. Architecture Compatibility Assessment

### Current Architecture

The OMNOM SWAP frontend uses:

- **wagmi v3** (`^3.6.1`) with [`createConfig()`](src/lib/web3/config.ts:42) — single chain (Dogechain ID 2000)
- **viem v2** (`^2.47.12`) — ABI encoding, RPC transport
- **Connectors**: [`metaMask()`](src/lib/web3/config.ts:29), [`injected()`](src/lib/web3/config.ts:35), [`walletConnect()`](src/lib/web3/config.ts:37), [`coinbaseWallet()`](src/lib/web3/config.ts:39)
- **Provider management**: Custom [`walletProviderManager.ts`](src/lib/walletProviderManager.ts:1) with SES lockdown handling
- **Web3Provider**: [`WagmiProvider`](src/Web3Provider.tsx:10) wrapping the app

### 2.1 Does integrating Snaps require changes to wagmi v3 connector configuration?

**No changes to the connector configuration are required.** Snaps are invoked through the existing `window.ethereum` provider via the `wallet_requestSnaps` RPC method. The wagmi [`metaMask()`](src/lib/web3/config.ts:29) connector already establishes the provider connection that Snaps need.

However, **Snap invocation itself cannot go through wagmi hooks** — it requires direct `provider.request()` calls. The wagmi connector configuration remains unchanged; Snaps are an orthogonal feature layer.

### 2.2 Does viem v2 support Snaps-specific RPC methods?

**No.** viem v2 does not have built-in support for Snaps RPC methods like `wallet_requestSnaps`, `wallet_invokeSnap`, or `snap_*` methods. These are MetaMask-specific extensions to the EIP-1193 provider interface.

**Workaround**: Access the raw provider via wagmi's `useConnectorClient()` or `useProvider()` and call `.request()` directly:

```typescript
import { useConnectorClient } from 'wagmi'

function useMetaMaskSnaps() {
  const { data: client } = useConnectorClient()

  const requestSnap = async (snapId: string, version: string) => {
    // Access the underlying EIP-1193 provider
    const provider = client?.transport as unknown as EIP1193Provider
    return provider?.request({
      method: 'wallet_requestSnaps',
      params: { [snapId]: { version } },
    })
  }

  return { requestSnap }
}
```

Alternatively, bypass wagmi entirely and use `window.ethereum` directly (the project already does this in [`useAutoAddChain.ts`](src/hooks/useAutoAddChain.ts:69)):

```typescript
const ethereum = (window as any).ethereum
await ethereum.request({
  method: 'wallet_requestSnaps',
  params: { 'npm:@omnom/swap-insights': { version: '1.0.0' } },
})
```

### 2.3 Can Snaps be invoked through wagmi's `useWriteContract` / `useSendTransaction`?

**Partially, depending on the Snap type:**

| Snap Type | Works with wagmi hooks? | Explanation |
|---|---|---|
| Transaction Insights | ✅ Transparently | The `onTransaction` handler fires automatically when MetaMask processes any `eth_sendTransaction` or `personal_sign`. No code changes needed — the Snap intercepts the confirmation UI. |
| Custom RPC Methods | ❌ Direct provider call | Must use `window.ethereum.request({ method: 'wallet_invokeSnap', ... })`. Cannot go through `useWriteContract`. |
| Notifications | ❌ Direct provider call | Must invoke via `wallet_invokeSnap` to trigger `snap_notify`. |
| Key Management | ❌ Direct provider call | BIP-32/44 entropy requests go through `wallet_invokeSnap`. |

**Key insight**: Transaction Insights are the "free" integration — once a user installs the Snap, it automatically enhances every swap confirmation without any frontend code changes. Other Snap types require explicit invocation.

### 2.4 How does Snaps interact with the existing `window.ethereum` provider?

Snaps are entirely **internal to MetaMask**. They do not modify `window.ethereum` or inject additional providers. The interaction model:

```
┌──────────────────────────────────────────────────┐
│  OMNOM SWAP Frontend                             │
│                                                  │
│  wagmi hooks ──→ window.ethereum.request()       │
│       │                    │                     │
│       │                    ▼                     │
│       │           MetaMask Extension             │
│       │            ┌──────────────┐              │
│       │            │  Snap Sandbox │              │
│       │            │  (SES/LavaMoat)│             │
│       │            │              │              │
│       │            │ onTransaction│              │
│       │            │ snap_notify  │              │
│       │            │ snap_dialog  │              │
│       │            └──────────────┘              │
│       │                    │                     │
│  Direct provider ──→ wallet_requestSnaps         │
│  (Snap install)    wallet_invokeSnap             │
└──────────────────────────────────────────────────┘
```

This means:
- **No conflict** with the existing [`walletProviderManager.ts`](src/lib/walletProviderManager.ts:1) provider detection
- **No conflict** with the [`WalletModal.tsx`](src/components/WalletModal.tsx:1) connector UI
- **No new provider** is added to the `window.ethereum.providers` array
- Snaps are **MetaMask-only** — they silently no-op when other wallets (Coinbase, WalletConnect) are active

---

## 3. Level of Effort Analysis

### 3.1 Effort by Feature

| Feature | Effort | Dependencies | Risk |
|---|---|---|---|
| **Transaction Insights Snap** (own Snap) | 5–8 days | Build custom Snap, publish to npm | Medium — requires Snap development expertise |
| **Install existing Snaps** (e.g., Tenderly, Blockaid) | 0.5–1 day | Add install button to UI | Low — just RPC calls |
| **Notification Snap** | 2–3 days | Custom Snap or integrate existing | Low |
| **Custom RPC Snap** (Dogechain-specific) | 3–5 days | Snap development, testing | Medium |
| **Key Management Snap** | 5–10 days | Security-critical, audit needed | High — not recommended for initial integration |

### 3.2 New Dependencies

| Package | Purpose | Size Impact |
|---|---|---|
| `@metamask/snaps-sdk` | Snap UI components (for building custom Snaps) | Dev dependency only (runs in MetaMask) |
| `@metamask/snaps-cli` | Build tooling for Snaps | Dev dependency only |
| `@metamask/providers` | TypeScript types for Snaps RPC methods | ~15KB |

**No runtime dependencies are added to the OMNOM SWAP frontend** — Snap code runs inside MetaMask, not in the dApp. The dApp only needs to make `wallet_requestSnaps` / `wallet_invokeSnap` RPC calls through the existing provider.

### 3.3 Existing Code Modifications

| File | Change Required | Scope |
|---|---|---|
| [`src/lib/web3/config.ts`](src/lib/web3/config.ts) | None | — |
| [`src/lib/walletProviderManager.ts`](src/lib/walletProviderManager.ts) | None | — |
| [`src/Web3Provider.tsx`](src/Web3Provider.tsx) | None | — |
| [`src/components/WalletModal.tsx`](src/components/WalletModal.tsx) | Optional: Add "Install Snap" button | Small |
| [`src/hooks/useMetaMaskStatus.ts`](src/hooks/useMetaMaskStatus.ts) | Optional: Add Snap detection fields | Small |
| New: `src/hooks/useMetaMaskSnaps.ts` | Snap install/invoke logic | New file |
| New: `src/components/SnapInstallPrompt.tsx` | UI for Snap installation | New file |
| New: `snaps/omnom-insights/` | Custom Transaction Insights Snap | New project |

### 3.4 Breaking Changes

**None.** Snaps integration is purely additive:
- No changes to wagmi configuration
- No changes to connector setup
- No changes to existing transaction flows
- Snaps degrade gracefully (no-op) when MetaMask is not installed or Snap is not installed

---

## 4. Relevant Snaps for a DEX

### 4.1 Transaction Insights Snap

**What it does**: When a user confirms a swap in MetaMask, the Snap intercepts the transaction and displays decoded information in the confirmation dialog — token names (not just addresses), amounts with decimals, price impact, route hops, fees, and slippage.

**Current UX problem**: MetaMask's default confirmation shows raw hex calldata like `0x38ed1739...` which is meaningless to users. They must trust the dApp UI.

**Enhanced UX with Snap**:
```
┌─────────────────────────────────┐
│  OMNOM Swap Insights            │
│                                 │
│  🔄 Swap                        │
│  1,000 OMNOM → 5.23 WDOGE      │
│                                 │
│  Route: OMNOM → WDOGE           │
│  Price Impact: 0.3%             │
│  Slippage: 0.5%                 │
│  Min. Received: 5.20 WDOGE      │
│  Network Fee: ~0.002 WDOGE      │
│                                 │
│  ⚠️ Token has 2% transfer tax   │
│                                 │
│  [Approve] [Reject]             │
└─────────────────────────────────┘
```

| Metric | Assessment |
|---|---|
| **Feasibility** | ✅ High — well-documented API, clear integration path |
| **Effort** | 5–8 days (custom Snap) or 0.5 day (integrate existing like Tenderly) |
| **User Value** | 🔴 Critical — addresses the #1 DEX UX problem (blind signing) |
| **Priority** | **P0 — Highest** |

**Implementation notes**:
- The Snap's `onTransaction` handler receives the transaction payload and must decode the aggregator contract calldata
- OMNOM's aggregator contract ([`OmnomSwapAggregator.sol`](contracts/OmnomSwapAggregator.sol)) uses specific function selectors that the Snap would need to decode
- The Snap can call `snap_fetch` to get current token prices from the OMNOM API for real-time price impact
- Token tax detection (already built in [`taxDetection.ts`](src/services/taxDetection.ts)) logic would need to be replicated in the Snap

### 4.2 Notification Snap

**What it does**: Sends in-MetaMask notifications for swap events, price alerts, and liquidity changes.

| Metric | Assessment |
|---|---|
| **Feasibility** | ✅ High — simple `snap_notify` API |
| **Effort** | 2–3 days |
| **User Value** | 🟡 Medium — nice-to-have, not critical for a DEX |
| **Priority** | **P2 — Low** |

**Limitations**:
- Notifications only appear inside MetaMask (no OS-level push notifications)
- Users must have MetaMask open to see them
- Limited value compared to the existing toast system in [`ToastContext.tsx`](src/components/ToastContext.tsx)

### 4.3 Custom RPC Snap (Dogechain-specific)

**What it does**: Exposes custom JSON-RPC methods specific to Dogechain or OMNOM — e.g., `omnom_getRoute`, `omnom_estimatePriceImpact`, `omnom_getTokenInfo`.

| Metric | Assessment |
|---|---|
| **Feasibility** | 🟡 Medium — requires custom Snap development |
| **Effort** | 3–5 days |
| **User Value** | 🟡 Low — this data is already available in the dApp frontend |
| **Priority** | **P3 — Defer** |

**Assessment**: Low priority because the dApp already fetches this data through its existing services ([`pathFinder`](src/services/pathFinder/index.ts), [`tokenPrices`](src/hooks/useTokenPrices.ts), etc.). Duplicating this in a Snap adds maintenance burden with minimal user benefit.

### 4.4 Key Management Snap

**What it does**: Enables different signature schemes (Ed25519 for Solana, BIP-44 multi-chain) inside MetaMask.

| Metric | Assessment |
|---|---|
| **Feasibility** | 🟡 Medium — complex security surface |
| **Effort** | 5–10 days + security audit |
| **User Value** | 🔴 Low — OMNOM is single-chain (Dogechain EVM) |
| **Priority** | **P4 — Not Recommended** |

**Assessment**: OMNOM SWAP operates exclusively on Dogechain (EVM chain ID 2000). Key management Snaps are designed for multi-chain scenarios (e.g., managing Solana keys from MetaMask). There is no use case for this in a single-chain EVM DEX.

### 4.5 Feature Priority Matrix

```
         High Value
            │
            │  ★ Transaction Insights (P0)
            │
            │
            │  ◆ Notification Snap (P2)
            │
 Low Effort ─┼────────────────────────── High Effort
            │
            │  ○ Custom RPC (P3)
            │
            │  ✕ Key Management (P4)
            │
         Low Value
```

---

## 5. Dependency and Configuration Changes

### 5.1 NPM Packages

**For the dApp frontend (installing existing Snaps)**:

```bash
# Only if TypeScript types for Snaps RPC methods are desired
npm install --save-dev @metamask/providers
```

No other packages are needed. The dApp communicates with Snaps through standard `window.ethereum.request()` calls.

**For building a custom Transaction Insights Snap** (separate project/package):

```bash
# In a new snaps/ directory or separate repository
npm install --save-dev @metamask/snaps-cli @metamask/snaps-sdk
npm install @metamask/snaps-jest  # For testing
```

### 5.2 Configuration Files

| File | Change | Details |
|---|---|---|
| [`package.json`](package.json) | Add `@metamask/providers` to devDependencies | Optional — for TypeScript types only |
| [`src/lib/web3/config.ts`](src/lib/web3/config.ts) | **No changes** | — |
| `vite.config.ts` | **No changes** | Snaps run in MetaMask, not in the dApp bundle |
| [`index.html`](index.html) | **No changes** | Existing SES suppression is compatible |
| `tsconfig.json` | Optional: Add `@metamask/providers` to types | For Snaps RPC type safety |

### 5.3 Vite Build Configuration — SES/Lockdown Conflict Analysis

**Critical finding**: The OMNOM SWAP project already has extensive SES lockdown handling:

- [`index.html`](index.html:38) suppresses SES lockdown errors in an inline script
- [`walletProviderManager.ts`](src/lib/walletProviderManager.ts:370) has a dedicated `isSESLockdownError()` function with 13+ error patterns
- [`useMetaMaskStatus.ts`](src/hooks/useMetaMaskStatus.ts:44) catches SES errors during provider detection

**Assessment: No conflict.** Snaps run inside MetaMask's own SES sandbox — they do not affect the dApp's JavaScript environment. The existing SES lockdown handling in OMNOM SWAP is for MetaMask's **inpage.js** script (which modifies `window.ethereum`), not for Snaps. These are separate concerns:

```
┌─────────────────────────────────────────────┐
│  Browser Page (OMNOM SWAP)                  │
│  ┌────────────────────────────────────────┐ │
│  │ SES lockdown errors caught by          │ │
│  │ index.html + walletProviderManager.ts  │ │
│  │ (from MetaMask inpage.js injection)    │ │
│  └────────────────────────────────────────┘ │
│                                             │
│  window.ethereum ← MetaMask inpage.js       │
│       │                                     │
│       ▼                                     │
│  MetaMask Extension Process                 │
│  ┌────────────────────────────────────────┐ │
│  │ Snap Sandbox (SES/LavaMoat)            │ │
│  │ ← Completely isolated from page JS     │ │
│  │ ← No impact on dApp bundle or runtime  │ │
│  └────────────────────────────────────────┘ │
└─────────────────────────────────────────────┘
```

**Vite bundling**: No issues. Snaps are not bundled into the dApp. They are separate JavaScript packages published to npm that MetaMask downloads and executes internally.

### 5.4 New Files to Create

```
src/
├── hooks/
│   └── useMetaMaskSnaps.ts          # Snap install/invoke helpers (~80 lines)
├── components/
│   └── SnapInstallPrompt.tsx        # UI prompt for Snap installation (~60 lines)
└── lib/
    └── snaps.ts                     # Snaps RPC method wrappers (~50 lines)

snaps/                                # Separate project (optional)
├── omnom-insights/
│   ├── package.json
│   ├── snap.config.ts
│   ├── src/
│   │   └── index.ts                 # onTransaction handler
│   └── tests/
└── README.md
```

---

## 6. Risk Assessment

### 6.1 Security Implications

| Risk | Severity | Mitigation |
|---|---|---|
| **Malicious Snaps** | Medium | Only recommend Snaps audited by MetaMask or the OMNOM team. Use `npm:` origin for verified packages. |
| **Snap supply chain attack** | Medium | Pin exact Snap versions. Monitor npm package integrity. |
| **Transaction Insights data leakage** | Low | Insights Snaps receive transaction data but cannot modify or broadcast transactions. They are read-only in the confirmation flow. |
| **Custom RPC Snap permissions** | Medium | Each Snap must declare permissions upfront. Users see exactly what the Snap can access before installation. |
| **Key Management Snap** | High | **Not recommended.** Exposing BIP-32 entropy to third-party code is inherently risky. |

**Overall security posture**: Transaction Insights Snaps are the safest integration point — they are read-only and cannot modify transaction data or access private keys. The risk profile is similar to a browser extension that reads page content.

### 6.2 User Experience Impact

| Aspect | Impact | Details |
|---|---|---|
| **Installation friction** | 🟡 Moderate | Users must approve Snap installation through a MetaMask permission dialog. This adds a one-time step. |
| **Permission prompts** | 🟡 Moderate | Each Snap requires explicit user approval. Users may be confused by additional prompts beyond the wallet connection. |
| **MetaMask-only** | 🔴 Significant | Snaps only work with MetaMask. Coinbase Wallet, WalletConnect, Rabby, and Trust Wallet users get no benefit. |
| **Confirmation enhancement** | 🟢 Positive | Transaction Insights provide immediate, tangible value — users can verify what they're signing. |
| **Graceful degradation** | 🟢 Positive | If MetaMask is not detected or Snap is not installed, the dApp works exactly as before. No broken states. |

### 6.3 Multi-Wallet Compatibility

The OMNOM SWAP project supports four connectors:

| Connector | Snaps Compatible? | Impact |
|---|---|---|
| [`metaMask()`](src/lib/web3/config.ts:29) | ✅ Yes | Full Snap support |
| [`injected()`](src/lib/web3/config.ts:35) | ⚠️ Conditional | Only if the injected provider is MetaMask |
| [`walletConnect()`](src/lib/web3/config.ts:37) | ❌ No | WalletConnect uses a different provider bridge |
| [`coinbaseWallet()`](src/lib/web3/config.ts:39) | ❌ No | Coinbase Wallet has its own extension |

**Mitigation**: All Snap-related UI should be conditionally rendered based on the [`useMetaMaskStatus()`](src/hooks/useMetaMaskStatus.ts:65) hook. The existing `isMetaMaskConnected` field already provides this:

```typescript
const { isMetaMaskConnected } = useMetaMaskStatus()

// Only show Snap prompts to MetaMask users
{isMetaMaskConnected && <SnapInstallPrompt />}
```

### 6.4 Provider Conflict System Impact

**No impact.** The existing provider conflict resolution in [`walletProviderManager.ts`](src/lib/walletProviderManager.ts) is unaffected because:

1. Snaps do not inject a new provider into `window.ethereum`
2. Snaps do not modify the `providers` array
3. Snaps do not set `window.ethereum` as a getter
4. The [`detectAllProviders()`](src/lib/walletProviderManager.ts:149) function will not detect Snaps (they're internal to MetaMask)

The existing SES lockdown suppression in [`index.html`](index.html:38) and [`walletProviderManager.ts`](src/lib/walletProviderManager.ts:376) remains valid and necessary — MetaMask's inpage.js will continue to trigger these errors regardless of whether Snaps are installed.

---

## 7. Recommendation

### 7.1 Should OMNOM SWAP Integrate Snaps?

**Yes, conditionally.** The recommendation is to integrate Transaction Insights as a **Phase 1** effort, with other Snap types deferred.

**Rationale**:

| Factor | Assessment |
|---|---|
| **User value** | Transaction Insights directly address the "blind signing" problem — the single biggest UX/safety gap in DEX interactions. Users currently see raw hex calldata in MetaMask with no context about what the swap will do. |
| **Integration cost** | Low. No changes to wagmi config, no new runtime dependencies, no breaking changes. The dApp only needs to prompt users to install the Snap. |
| **Risk** | Low. Transaction Insights are read-only. They cannot modify transactions, access keys, or exfiltrate data beyond what's already visible in the transaction payload. |
| **Audience reach** | Limited to MetaMask users, but MetaMask remains the dominant wallet on EVM chains. The feature degrades gracefully for non-MetaMask users. |
| **Maintenance** | The Snap is a separate package with its own build pipeline. It does not add complexity to the main dApp bundle. |

### 7.2 Prioritized Implementation Order

#### Phase 1: Transaction Insights (Recommended — 5–8 days)

1. **Build a custom Transaction Insights Snap** (`@omnom/swap-insights`)
   - Decode [`OmnomSwapAggregator.sol`](contracts/OmnomSwapAggregator.sol) calldata (function selectors: `swapExactTokensForTokens`, `swapExactETHForTokens`, etc.)
   - Display token names, amounts, route hops, fees, slippage
   - Integrate token tax warnings (replicate logic from [`taxDetection.ts`](src/services/taxDetection.ts))
   - Show price impact using `snap_fetch` to call OMNOM API

2. **Add Snap installation UI to the dApp**
   - Create `src/hooks/useMetaMaskSnaps.ts` hook with install/invoke helpers
   - Add conditional prompt in swap flow (only for MetaMask users)
   - Use [`useMetaMaskStatus()`](src/hooks/useMetaMaskStatus.ts:65) to gate Snap features

3. **Publish Snap to npm**
   - Required for MetaMask to install it via `wallet_requestSnaps`
   - Submit to MetaMask Snaps directory for discoverability

#### Phase 2: Third-Party Insights Integration (Optional — 0.5–1 day)

- Integrate existing Snaps like **Tenderly Transaction Simulation** or **Blockaid Security Scan**
- These provide transaction simulation and security warnings without custom Snap development
- Add install buttons in the dApp settings or swap confirmation area

#### Phase 3: Notifications (Future — 2–3 days)

- Build a notification Snap for swap completion alerts and price monitoring
- Lower priority because the dApp already has toast notifications via [`ToastContext.tsx`](src/components/ToastContext.tsx)
- Only valuable if users frequently close the dApp tab while waiting for transaction confirmation

#### Not Recommended

- **Custom RPC Snap**: Low value — dApp already provides this data
- **Key Management Snap**: No use case for single-chain EVM DEX

### 7.3 Quick-Start: Minimal Viable Integration

For the fastest path to value, the dApp can integrate an **existing third-party Transaction Insights Snap** without building a custom one:

```typescript
// src/hooks/useMetaMaskSnaps.ts
import { useMetaMaskStatus } from './useMetaMaskStatus'

const TENDERLY_SNAP_ID = 'npm:@tenderly/metamask-snap'

export function useMetaMaskSnaps() {
  const { isMetaMaskConnected } = useMetaMaskStatus()

  const installSnap = async () => {
    if (!isMetaMaskConnected) return

    const ethereum = (window as any).ethereum
    if (!ethereum) return

    try {
      await ethereum.request({
        method: 'wallet_requestSnaps',
        params: { [TENDERLY_SNAP_ID]: {} },
      })
    } catch (err) {
      // User rejected or Snap not available
      console.warn('[OMNOM] Snap installation failed:', err)
    }
  }

  return { installSnap, isSupported: isMetaMaskConnected }
}
```

This provides immediate transaction simulation in MetaMask with **less than 1 day of effort**.

### 7.4 Decision Matrix Summary

| Snap Type | Implement? | Priority | Effort | User Value |
|---|---|---|---|---|
| Transaction Insights (custom) | ✅ Yes | P0 | 5–8 days | Critical |
| Transaction Insights (3rd party) | ✅ Yes | P0 | 0.5–1 day | High |
| Notifications | ⏳ Defer | P2 | 2–3 days | Medium |
| Custom RPC | ⏳ Defer | P3 | 3–5 days | Low |
| Key Management | ❌ No | — | — | None |

---

## Appendix A: Snaps RPC Methods Reference

```typescript
// Install a Snap
await provider.request({
  method: 'wallet_requestSnaps',
  params: {
    'npm:@omnom/swap-insights': { version: '^1.0.0' },
  },
})

// Invoke a Snap method
await provider.request({
  method: 'wallet_invokeSnap',
  params: {
    snapId: 'npm:@omnom/swap-insights',
    request: { method: 'getTokenInfo', params: { address: '0x...' } },
  },
})

// Get installed Snaps
const snaps = await provider.request({ method: 'wallet_getSnaps' })
```

## Appendix B: Transaction Insights Snap Skeleton

```typescript
// snaps/omnom-insights/src/index.ts
import { panel, heading, text, divider, copyable } from '@metamask/snaps-sdk'

export const onTransaction = async ({ transaction, chainId }) => {
  // Only handle Dogechain (chainId 2000 = 0x7d0)
  if (chainId !== '0x7d0') return null

  const decoded = decodeSwapCalldata(transaction.data)
  if (!decoded) return null

  return {
    content: panel([
      heading('OMNOM Swap Insights'),
      text(`**Swap**: ${decoded.amountIn} ${decoded.tokenIn} → ${decoded.amountOut} ${decoded.tokenOut}`),
      text(`**Route**: ${decoded.route.join(' → ')}`),
      text(`**Price Impact**: ${decoded.priceImpact}%`),
      text(`**Slippage**: ${decoded.slippage}%`),
      text(`**Min. Received**: ${decoded.minAmountOut} ${decoded.tokenOut}`),
      decoded.hasTaxWarning ? text('⚠️ Token has transfer tax — actual received amount may differ') : null,
    ].filter(Boolean)),
  }
}
```

---

*This assessment was performed without modifying any source files. All analysis is based on code review of the existing OMNOM SWAP codebase and MetaMask Snaps documentation.*
