# MEV Protection Audit — OmnomSwap

**Date:** 2026-04-16  
**Scope:** Full-stack MEV protection review across smart contracts, frontend transaction flows, RPC configuration, and UI  
**Network:** Dogechain (EVM-compatible, Chain ID 2000)  
**Auditor:** Automated code review  

---

## Executive Summary

OmnomSwap is a multi-hop DEX aggregator on Dogechain that routes swaps through 5 UniswapV2-style DEXes (DogeSwap, DogeShrk, WOJAK Finance, KibbleSwap, YodeSwap). The audit reviewed 9 MEV protection areas across the smart contract, frontend hooks, UI components, and RPC configuration.

**Key Findings:**

| # | Area | Severity | Status |
|---|------|----------|--------|
| 1 | MEV-Protected RPC / Private Mempools | **HIGH** | No protection — all TXs broadcast to public mempool |
| 2 | Slippage Tolerance | **MEDIUM** | Implemented but with gaps |
| 3 | Deadline/Expiry Parameters | **LOW** | Properly enforced on-chain and off-chain |
| 4 | Order Information Leakage | **HIGH** | Two-step approve+swap leaks swap intent |
| 5 | Permit2 / Approval Patterns | **MEDIUM** | Unlimited approvals with no scoping |
| 6 | Routing Logic — Order Splitting | **INFO** | Atomic execution via single TX |
| 7 | Mempool Exposure | **HIGH** | Default public RPC with no private relay |
| 8 | Gas Pricing Strategy | **MEDIUM** | No gas randomization or anti-signal logic |
| 9 | User Warnings | **LOW** | MEV risk disclosed but not in swap flow |

---

## Detailed Findings

---

### 1. MEV-Protected RPC / Private Mempools

**Severity: HIGH**  
**Status: ❌ No protection implemented**

#### Current State

The wagmi configuration in [`src/lib/web3/config.ts`](src/lib/web3/config.ts:1) uses a default public HTTP transport with no explicit RPC URL:

```typescript
export const config = createConfig({
  chains: [dogechain],
  connectors: [metaMask(), injected()],
  transports: {
    [dogechain.id]: http()  // No URL specified — uses wagmi's default for dogechain
  }
})
```

The RPC URL in [`src/lib/constants.ts`](src/lib/constants.ts:4) is configured as:

```typescript
rpcUrl: 'https://rpc.dogechain.dog',
```

This is the default public Dogechain RPC endpoint. All transactions are broadcast to the public mempool via this endpoint or the user's wallet RPC.

[`src/Web3Provider.tsx`](src/Web3Provider.tsx:1) wraps the app with `WagmiProvider` using the above config — no private transaction relay, no Flashbots-style bundle submission, no MEV Blocker integration.

#### Vulnerability

All swap transactions are visible in the public mempool immediately upon submission. MEV bots monitoring the mempool can:
- **Front-run** the swap by submitting the same trade with higher gas
- **Sandwich attack** by placing orders before and after the user's swap
- **Back-run** for arbitrage extraction

#### Dogechain-Specific Context

Dogechain does **not** have Flashbots, MEV-Boost, or any known private mempool infrastructure. There is no native MEV protection layer available on the chain. This is a fundamental infrastructure limitation.

#### Recommended Fix

Since Dogechain lacks Flashbots/mev-boost, the following mitigations should be implemented:

**1. Add MEV Blocker or similar private relay (if available):**

```typescript
// src/lib/web3/config.ts
import { createConfig, http } from 'wagmi'
import { metaMask, injected } from 'wagmi/connectors'
import { dogechain } from 'wagmi/chains'

// Use a private relay if one becomes available for Dogechain
const PRIVATE_RPC = import.meta.env.VITE_PRIVATE_RPC_URL || 'https://rpc.dogechain.dog'

export const config = createConfig({
  chains: [dogechain],
  connectors: [metaMask(), injected()],
  transports: {
    [dogechain.id]: http(PRIVATE_RPC)
  }
})
```

**2. Add a fallback RPC configuration for resilience:**

```typescript
// src/lib/web3/config.ts
const RPC_URLS = [
  import.meta.env.VITE_PRIVATE_RPC_URL,
  'https://rpc.dogechain.dog',
  'https://rpc01.dogechain.dog',
].filter(Boolean) as string[]
```

**3. Document the lack of MEV-protected RPC in the UI (see Area 9).**

---

### 2. Slippage Tolerance

**Severity: MEDIUM**  
**Status: ⚠️ Implemented with gaps**

#### Current State

**Direct Swap ([`SwapScreen.tsx`](src/components/SwapScreen.tsx:59)):**
- Default slippage: `1.0%` (line 59)
- Configurable presets: `0.1%`, `0.5%`, `1.0%` (line 518)
- Custom input with max `50%` (line 537)
- Auto-calculated slippage based on trade size (lines 508-511)
- Applied to `amountOutMin` in the swap call (line 350):
  ```typescript
  const slippageBps = BigInt(Math.floor((parseFloat(slippage) || 1) * 100));
  const amountOutMin = (buyWeiOut * (10000n - slippageBps)) / 10000n;
  ```
- Displayed in swap details (line 693) and confirmation modal (line 922)
- Warning shown when slippage > 5% (line 543-544)
- Blocked when slippage > 50% (line 227)

**Aggregator Swap ([`AggregatorSwap.tsx`](src/components/aggregator/AggregatorSwap.tsx:82)):**
- Default slippage: `0.5%` (line 82)
- Same configurable presets and custom input
- Applied in [`useSwap.ts`](src/hooks/useAggregator/useSwap.ts:64):
  ```typescript
  const slippageMultiplier = 10000n - BigInt(slippageBps);
  const minTotalAmountOut = (route.totalExpectedOut * slippageMultiplier) / 10000n;
  ```
- Per-step slippage also applied (line 68):
  ```typescript
  const stepSlippage = (step.expectedAmountOut * slippageMultiplier) / 10000n;
  ```
- Min. received displayed with slippage (lines 491-500)

**Smart Contract ([`OmnomSwapAggregator.sol`](contracts/OmnomSwapAggregator.sol:240)):**
- Double slippage protection:
  - Per-step: `minAmountOut` enforced on each `swapExactTokensForTokens` call (line 224)
  - Overall: `minTotalAmountOut` enforced on final output (line 240):
    ```solidity
    require(runningBalance >= request.minTotalAmountOut, "Slippage");
    ```

#### Vulnerabilities

1. **Inconsistent defaults between swap modes:** Direct Swap defaults to `1.0%`, Aggregator defaults to `0.5%`. Users switching between modes may not notice.

2. **Slippage not prominently displayed in confirmation flow:** In the Direct Swap confirmation modal ([`SwapScreen.tsx`](src/components/SwapScreen.tsx:920)), slippage is shown in small text among other details. It's not highlighted as a MEV protection parameter.

3. **No dynamic slippage recommendation based on MEV risk:** The auto-slippage feature (lines 508-511) only considers trade size, not current mempool conditions or MEV bot activity.

#### Recommended Fix

**1. Unify default slippage across both swap modes:**

```typescript
// src/lib/constants.ts — add shared default
export const DEFAULT_SLIPPAGE = '0.5';
export const MAX_SLIPPAGE = 50;
export const WARN_SLIPPAGE = 5;
```

**2. Add MEV-aware slippage warning in the confirmation modal:**

```tsx
// In the confirmation modal, add a prominent warning:
{parseFloat(slippage) < 0.5 && (
  <div className="flex items-center gap-2 p-3 bg-yellow-400/10 border border-yellow-400/30 text-yellow-400 text-xs">
    <ShieldAlert className="w-4 h-4 shrink-0" />
    <span>Low slippage provides MEV protection but may cause failed transactions on volatile pairs.</span>
  </div>
)}
```

**3. Consider adding a "MEV protection" indicator next to slippage:**

```tsx
<div className="flex items-center gap-1">
  <span>Slippage Tolerance</span>
  {parseFloat(slippage) <= 1.0 && <Shield className="w-3 h-3 text-green-400" title="Lower slippage = more MEV protection" />}
</div>
```

---

### 3. Deadline/Expiry Parameters

**Severity: LOW**  
**Status: ✅ Properly enforced**

#### Current State

**Smart Contract ([`OmnomSwapAggregator.sol`](contracts/OmnomSwapAggregator.sol:180)):**
- Deadline is a required field in the `SwapRequest` struct (line 89)
- Enforced at the start of `executeSwap` (line 180):
  ```solidity
  require(block.timestamp <= request.deadline, "Expired");
  ```
- The same deadline is passed to each individual DEX router call (line 228):
  ```solidity
  IUniswapV2Router02(step.router).swapExactTokensForTokens(
      stepAmountIn, step.minAmountOut, step.path, address(this), request.deadline
  );
  ```

**Aggregator Frontend ([`useSwap.ts`](src/hooks/useAggregator/useSwap.ts:61)):**
- Default deadline: 5 minutes (line 94)
- Computed as current time + deadline minutes (line 61):
  ```typescript
  const deadline = BigInt(Math.floor(Date.now() / 1000) + deadlineMinutes * 60);
  ```

**Direct Swap ([`SwapScreen.tsx`](src/components/SwapScreen.tsx:60)):**
- Default deadline: 5 minutes (line 60)
- Configurable from 1-180 minutes (lines 549-561)
- Applied to swap call (line 320):
  ```typescript
  const txDeadline = Math.floor(Date.now() / 1000) + (parseInt(deadline) || 5) * 60;
  ```

#### Analysis

- **Expired transactions cannot be replayed:** The contract checks `block.timestamp <= request.deadline`, so expired swaps revert. The deadline is absolute, not relative.
- **5-minute default is reasonable:** This is short enough to limit MEV exposure but long enough for block inclusion on Dogechain.
- **Deadline visible in settings:** Users can see and modify the deadline in both swap modes.

#### Minor Recommendations

1. **Display deadline in the confirmation modal** alongside slippage and min. received.
2. **Consider shorter default deadline (2-3 minutes)** for additional MEV protection, since Dogechain block times are ~2 seconds.
3. **Add a maximum deadline cap** (e.g., 30 minutes) to prevent users from setting excessively long deadlines that increase MEV exposure.

---

### 4. Order Information Leakage

**Severity: HIGH**  
**Status: ❌ Two-step approve+swap leaks swap intent**

#### Current State

Both the Direct Swap and Aggregator Swap use a **two-step approve-then-swap pattern**:

**Aggregator Swap ([`useSwap.ts`](src/hooks/useAggregator/useSwap.ts:28)):**
```typescript
const approve = useCallback(
  async (tokenAddress: Address, amount: bigint) => {
    // 1. Check current allowance
    const allowance = await publicClient.readContract({ ... });
    if (allowance >= amount) return;

    // 2. Send approval transaction (VISIBLE IN MEMPOOL)
    const hash = await writeContractAsync({
      address: tokenAddress,
      abi: erc20Abi,
      functionName: 'approve',
      args: [OMNOMSWAP_AGGREGATOR_ADDRESS, MAX_UINT256],
    });

    // 3. Wait for approval confirmation
    await publicClient.waitForTransactionReceipt({ hash });
  }, ...);
```

Then in [`executeSwap`](src/hooks/useAggregator/useSwap.ts:93):
```typescript
// Step 1: Approve (broadcasts to mempool)
await approve(tokenIn, route.totalAmountIn);
// Step 2: Build swap request
const request = buildSwapRequest(route, slippageBps, deadlineMinutes);
// Step 3: Execute swap (also broadcasts to mempool)
const hash = await writeContractAsync({ ... });
```

**Direct Swap ([`SwapScreen.tsx`](src/components/SwapScreen.tsx:356)):**
```typescript
// Approve router if selling ERC-20
if (!isSellingNative && publicClient) {
  const allowance = await publicClient.readContract({ ... });
  if ((allowance as bigint) < parsedSellWei) {
    // APPROVAL TX — visible in mempool
    const approveHash = await writeContract({
      address: sellToken.address,
      abi: erc20Abi,
      functionName: 'approve',
      args: [routerAddress, MAX_UINT256],
    });
    await publicClient.waitForTransactionReceipt({ hash: approveHash });
  }
}
// SWAP TX — also visible in mempool
swapHash = await writeContract({ ... });
```

#### Vulnerability

The approval transaction is a **clear signal** to MEV bots that a swap is about to follow. The pattern is:

1. **Approval TX enters mempool** → MEV bots see: "User X just approved token Y for router Z"
2. **MEV bot prepares** → Calculates the likely swap parameters from the token pair and recent pool state
3. **Swap TX enters mempool** → MEV bot already has a front-run or sandwich transaction prepared and can submit it immediately

This is especially damaging because:
- The approval reveals the **exact token pair** the user intends to swap
- The approval reveals the **spender contract** (identifying the DEX/aggregator)
- There is a **time window** between approval confirmation and swap submission where MEV bots can prepare
- The `MAX_UINT256` approval amount reveals no information about trade size, but the token pair alone is enough for sandwich preparation

#### Recommended Fix

**Option A: Permit2 / EIP-2612 Permit signatures (preferred, if supported on Dogechain)**

Replace the separate approve transaction with a permit signature that is verified inside the swap transaction itself:

```solidity
// In OmnomSwapAggregator.sol — add a permit-and-swap function
import {IERC20Permit} from "./interfaces/IERC20Permit.sol";

function executeSwapWithPermit(
    SwapRequest calldata request,
    uint256 deadline,
    uint8 v, bytes32 r, bytes32 s
) external nonReentrant whenNotPaused {
    // Verify the permit signature
    IERC20Permit(request.tokenIn).permit(
        msg.sender,
        address(this),
        request.amountIn,
        deadline,
        v, r, s
    );
    // Then execute the swap as normal
    _executeSwap(request);
}
```

```typescript
// In useSwap.ts — sign permit instead of sending approve TX
const signPermit = async (tokenAddress: Address, amount: bigint) => {
  const domain = {
    name: tokenName,
    version: '1',
    chainId: 2000,
    verifyingContract: tokenAddress,
  };
  const types = {
    Permit: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'nonce', type: 'uint256' },
      { name: 'deadline', type: 'uint256' },
    ],
  };
  // ... sign with wallet, pass to executeSwapWithPermit
};
```

**Option B: If permits are not available, batch approval + swap in a single TX via a helper contract:**

```solidity
// Deploy a batch helper that does approve+swap atomically
contract BatchSwapHelper {
    function approveAndSwap(
        address token,
        address spender,
        uint256 amount,
        OmnomSwapAggregator aggregator,
        SwapRequest calldata request
    ) external {
        IERC20(token).approve(spender, amount);
        aggregator.executeSwap(request);
    }
}
```

**Option C: Pre-approve small amounts to reduce signal (weaker mitigation):**

If the user has already approved the token (from a previous swap), no approval TX is needed. Encourage users to maintain existing approvals rather than revoking them.

---

### 5. Permit2 / Approval Patterns

**Severity: MEDIUM**  
**Status: ⚠️ Unlimited approvals, no Permit2**

#### Current State

**Aggregator Swap ([`useSwap.ts`](src/hooks/useAggregator/useSwap.ts:46)):**
```typescript
const hash = await writeContractAsync({
  address: tokenAddress,
  abi: erc20Abi,
  functionName: 'approve',
  args: [OMNOMSWAP_AGGREGATOR_ADDRESS, MAX_UINT256],  // Unlimited approval
});
```

**Direct Swap ([`SwapScreen.tsx`](src/components/SwapScreen.tsx:368)):**
```typescript
const approveHash = await writeContract({
  address: sellToken.address,
  abi: erc20Abi,
  functionName: 'approve',
  args: [routerAddress, MAX_UINT256],  // Unlimited approval
});
```

Both use `MAX_UINT256` ([`constants.ts`](src/lib/constants.ts:95)):
```typescript
export const MAX_UINT256 = BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff');
```

#### Vulnerability

1. **Unlimited approval:** Users grant `MAX_UINT256` allowance to the aggregator contract and the V2 router. If either contract is compromised, all approved tokens are at risk.

2. **No Permit2 usage:** The app does not use Uniswap's Permit2 contract, which provides:
   - Time-limited approvals (expire after 30 days)
   - Amount-limited approvals (exact swap amount)
   - Gasless approval via off-chain signatures

3. **Approval persistence:** Unlimited approvals remain in effect indefinitely, increasing the attack surface if the aggregator contract is upgraded or compromised.

#### Recommended Fix

**1. Use exact-amount approvals instead of unlimited:**

```typescript
// In useSwap.ts — approve exact amount
const approve = useCallback(
  async (tokenAddress: Address, amount: bigint) => {
    const allowance = await publicClient.readContract({ ... });
    if (allowance >= amount) return;

    const hash = await writeContractAsync({
      address: tokenAddress,
      abi: erc20Abi,
      functionName: 'approve',
      args: [OMNOMSWAP_AGGREGATOR_ADDRESS, amount],  // Exact amount, not MAX_UINT256
    });
    await publicClient.waitForTransactionReceipt({ hash });
  }, ...
);
```

**2. If unlimited approvals are kept for UX (avoiding repeated approval TXs), add a "Revoke Approvals" feature:**

```typescript
// New hook: useRevokeApproval
const revokeApproval = async (tokenAddress: Address, spender: Address) => {
  const hash = await writeContractAsync({
    address: tokenAddress,
    abi: erc20Abi,
    functionName: 'approve',
    args: [spender, 0n],
  });
  await publicClient.waitForTransactionReceipt({ hash });
};
```

**3. Investigate Permit2 deployment on Dogechain:** If tokens on Dogechain support EIP-2612 permits (DAI-style `permit()` function), use permit-based approvals to eliminate the separate approval transaction entirely.

---

### 6. Routing Logic — Order Splitting / Atomic Batch

**Severity: INFO**  
**Status: ✅ Atomic execution via single transaction**

#### Current State

**Smart Contract ([`OmnomSwapAggregator.sol`](contracts/OmnomSwapAggregator.sol:178)):**
- The `executeSwap` function executes all steps atomically in a single transaction (lines 202-237)
- Each step is executed sequentially in a `for` loop
- The entire transaction reverts if any step fails (Solidity default behavior)
- Protocol fee is deducted before any swaps (lines 191-196)
- Final output is checked against `minTotalAmountOut` (line 240)

**Path Finder ([`src/services/pathFinder/index.ts`](src/services/pathFinder/index.ts:215)):**
- Routes are computed off-chain using BFS up to 4 hops (line 27)
- Cross-DEX routing is supported — different DEX per hop
- Routes are sorted by output amount descending (line 255)
- Maximum 10 routes returned (line 221)

**Frontend ([`useSwap.ts`](src/hooks/useAggregator/useSwap.ts:93)):**
- Single `executeSwap` call submits the entire route as one transaction
- The `SwapRequest` struct contains all steps, so the contract executes them atomically

#### Analysis

The atomic execution model is a **strong MEV protection** feature:
- No partial execution risk — the swap either completes entirely or reverts
- No multi-TX sequence that MEV bots could exploit between steps
- Per-step slippage (`minAmountOut`) provides granular protection at each hop
- Overall slippage (`minTotalAmountOut`) provides a backstop for the entire route

#### Recommendation (Enhancement)

**Consider adding order splitting for large trades:**

For very large trades that move the price significantly on a single DEX, splitting the order across multiple DEXes in a single atomic TX can reduce price impact. The current implementation already supports this via multi-step routes, but the path finder could be enhanced to:

1. Split a large trade into parallel paths across different DEXes
2. Execute them atomically in a single transaction
3. This would require modifying the contract to support parallel execution (currently sequential only)

```solidity
// Future enhancement: parallel step execution
struct SwapRequestV2 {
    address tokenIn;
    address tokenOut;
    uint256 amountIn;
    uint256 minTotalAmountOut;
    SwapStep[][] parallelSteps;  // Multiple paths executed in parallel
    uint256 deadline;
    address recipient;
}
```

This is a future enhancement, not a current vulnerability.

---

### 7. Mempool Exposure

**Severity: HIGH**  
**Status: ❌ Full public mempool exposure**

#### Current State

**RPC Configuration ([`src/lib/web3/config.ts`](src/lib/web3/config.ts:9)):**
```typescript
transports: {
  [dogechain.id]: http()  // Default public RPC
}
```

**RPC URL ([`src/lib/constants.ts`](src/lib/constants.ts:4)):**
```typescript
rpcUrl: 'https://rpc.dogechain.dog',
```

**Wallet Connection ([`src/lib/web3/config.ts`](src/lib/web3/config.ts:6)):**
```typescript
connectors: [metaMask(), injected()],
```

Transactions are submitted through the user's wallet (MetaMask or injected provider), which broadcasts to whatever RPC the wallet is configured to use. For most users, this will be the default Dogechain RPC.

#### Vulnerability

1. **No private transaction submission:** All transactions are broadcast to the public mempool via the default RPC or the user's wallet RPC.

2. **No transaction encryption or batching:** Transactions are submitted individually and are immediately visible to mempool watchers.

3. **Approval TX + Swap TX sequence:** As documented in Area 4, the two-step pattern gives MEV bots two opportunities to observe and exploit the user's intent.

4. **No RPC diversity:** The app uses a single RPC endpoint with no fallback or load balancing.

#### Recommended Fix

**1. Add environment variable for RPC configuration:**

```typescript
// src/lib/web3/config.ts
const RPC_URL = import.meta.env.VITE_RPC_URL || 'https://rpc.dogechain.dog';

export const config = createConfig({
  chains: [dogechain],
  connectors: [metaMask(), injected()],
  transports: {
    [dogechain.id]: http(RPC_URL)
  }
})
```

**2. Document RPC configuration for users:**

Add a settings panel or info tooltip that shows which RPC is being used and recommends users configure their wallet to use a private RPC if available.

**3. Add `.env.example` documentation:**

```bash
# .env.example
# RPC endpoint for Dogechain. Default: public RPC (no MEV protection).
# If a private relay becomes available, set it here.
VITE_RPC_URL=https://rpc.dogechain.dog
```

**4. Monitor for Dogechain MEV protection solutions:** As the Dogechain ecosystem matures, private mempool solutions may become available. The codebase should be structured to easily integrate them when they do.

---

### 8. Gas Pricing Strategy

**Severity: MEDIUM**  
**Status: ⚠️ No anti-MEV gas strategy**

#### Current State

The codebase does not implement any custom gas pricing logic. Gas prices are determined by:
1. The wallet's default gas estimation (MetaMask/injected provider)
2. wagmi's `writeContractAsync` which uses the wallet's gas estimation

**Direct Swap ([`SwapScreen.tsx`](src/components/SwapScreen.tsx:313)):**
```typescript
const handleConfirmSwap = async () => {
  // No gas price configuration — relies on wallet defaults
  swapHash = await writeContract({
    address: routerAddress,
    abi: parsedRouterAbi,
    functionName: 'swapExactWDOGEForTokens',
    args: [amountOutMin, path, address, BigInt(txDeadline)],
    value: parsedSellWei,
    // No gasPrice, maxFeePerGas, or maxPriorityFeePerGas specified
  });
};
```

**Aggregator Swap ([`useSwap.ts`](src/hooks/useAggregator/useSwap.ts:124)):**
```typescript
const hash = await writeContractAsync({
  address: OMNOMSWAP_AGGREGATOR_ADDRESS,
  abi: OMNOMSWAP_AGGREGATOR_ABI,
  functionName: 'executeSwap',
  args: [request],
  // No gas price configuration
});
```

**Gas estimation in Aggregator ([`AggregatorSwap.tsx`](src/components/aggregator/AggregatorSwap.tsx:127)):**
```typescript
const gasEstimateQuery = useEstimateGas({
  // ...
  query: {
    enabled: false, // Disabled until contract is deployed
  },
});
```

Gas estimation is disabled and the displayed fee is hardcoded:
```typescript
<span className="text-white">~0.05 DOGE <span className="text-on-surface-variant text-[9px]">(est.)</span></span>
```

#### Vulnerability

1. **Predictable gas pricing signals intent:** MEV bots can identify swap transactions by their gas price patterns. A swap submitted with standard gas estimation is easily identifiable.

2. **No gas price randomization:** Using exact gas estimation makes the transaction pattern predictable and easy to front-run.

3. **Hardcoded gas estimate:** The `~0.05 DOGE` estimate is not dynamic and may not reflect actual network conditions, misleading users about true costs.

#### Recommended Fix

**1. Add gas price configuration to swap transactions:**

```typescript
// In useSwap.ts — add gas price parameters
const hash = await writeContractAsync({
  address: OMNOMSWAP_AGGREGATOR_ADDRESS,
  abi: OMNOMSWAP_AGGREGATOR_ABI,
  functionName: 'executeSwap',
  args: [request],
  // Add slight gas price premium for faster inclusion (reduces MEV window)
  maxPriorityFeePerGas: estimatedGas * 110n / 100n,  // 10% premium
});
```

**2. Implement dynamic gas estimation:**

```typescript
// Replace hardcoded gas estimate with actual estimation
const { data: gasEstimate } = useEstimateGas({
  to: OMNOMSWAP_AGGREGATOR_ADDRESS,
  data: encodeFunctionData({
    abi: OMNOMSWAP_AGGREGATOR_ABI,
    functionName: 'executeSwap',
    args: [request],
  }),
  value: 0n,
});
```

**3. Consider gas price randomization (advanced):**

```typescript
// Add small random variation to gas price to avoid pattern detection
const baseGas = await publicClient.estimateGas({ ... });
const gasPrice = await publicClient.getGasPrice();
const randomFactor = 1n + BigInt(Math.floor(Math.random() * 5)) / 100n; // 0-5% random premium
const adjustedGasPrice = gasPrice * randomFactor;
```

**Note:** Gas price randomization is a weak mitigation. The primary defense should be slippage protection and (if available) private mempool submission.

---

### 9. User Warnings

**Severity: LOW**  
**Status: ⚠️ MEV disclosed but not prominent in swap flow**

#### Current State

**Disclosures Page ([`Disclosures.tsx`](src/components/aggregator/Disclosures.tsx:173)):**
- Contains a dedicated "MEV Risk Disclosure" section (id: `mev`, lines 173-196)
- Explains front-running, sandwich attacks, and MEV extraction
- Recommends "using MEV-protected transaction submission methods if available"
- Mentions slippage tolerance as a mitigation
- **But:** This is a separate page that users must navigate to — not visible during the swap flow

**Education Panel ([`EducationPanel.tsx`](src/components/aggregator/EducationPanel.tsx:188)):**
- Contains a "What is MEV and front-running?" topic (id: `mev`, lines 188-210)
- Explains front-running and sandwich attacks
- Recommends slippage tolerance as mitigation
- **But:** Hidden behind a "?" button that users may not click

**Swap Confirmation Flow:**
- **Direct Swap ([`SwapScreen.tsx`](src/components/SwapScreen.tsx:878)):** Confirmation modal shows rate, price impact, slippage, min. received, and network fee — but **no MEV warning**
- **Aggregator Swap ([`AggregatorSwap.tsx`](src/components/aggregator/AggregatorSwap.tsx:534)):** No confirmation modal — swap executes directly on button click with **no MEV warning**

#### Vulnerability

Users are not warned about MEV risks at the point of transaction confirmation. The disclosures and education content exist but are not surfaced in the swap flow where they matter most.

#### Recommended Fix

**1. Add MEV warning to the Direct Swap confirmation modal:**

```tsx
// In SwapScreen.tsx confirmation modal, after the swap details:
<div className="flex items-start gap-2 p-3 bg-surface-container border border-outline-variant/10 text-on-surface-variant text-[10px] font-body">
  <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-yellow-400 mt-0.5" />
  <span>
    Your transaction will be visible in the public mempool. Setting a lower slippage tolerance 
    can help limit potential losses from MEV extraction (front-running, sandwich attacks).
    <a href="/disclosures" className="text-primary underline">Learn more</a>
  </span>
</div>
```

**2. Add a confirmation modal to the Aggregator Swap:**

The Aggregator Swap currently has no confirmation modal — the swap executes immediately on button click. This is a significant UX and safety gap:

```tsx
// In AggregatorSwap.tsx — add confirmation modal (similar to SwapScreen.tsx)
const [showConfirmModal, setShowConfirmModal] = useState(false);

const handleExecuteSwap = async () => {
  if (!route || route.steps.length === 0) return;
  setShowConfirmModal(true);  // Show confirmation first
};

// In the confirmation modal's "Confirm" button:
const handleConfirmSwap = async () => {
  setShowConfirmModal(false);
  await executeSwap(route, slippageBps, deadlineMin);
};
```

**3. Add a persistent MEV status indicator:**

```tsx
// Add to both swap screens — a small indicator showing MEV protection status
<div className="flex items-center gap-1 text-[9px] text-on-surface-variant">
  <ShieldAlert className="w-3 h-3 text-yellow-400" />
  <span>No MEV protection available on Dogechain</span>
</div>
```

**4. Enhance the Education Panel MEV section with Dogechain-specific context:**

```tsx
// In EducationPanel.tsx — update the MEV topic
<p className="text-yellow-400 border-t border-outline-variant/10 pt-2 mt-2">
  ⚠️ Dogechain currently does not have Flashbots or private mempool infrastructure. 
  All transactions are broadcast to the public mempool. Use conservative slippage 
  settings (0.5% or lower) to minimize MEV exposure.
</p>
```

---

## Priority-Ordered Fix Recommendations

### Priority 1 — Critical (Implement First)

| # | Finding | Fix | Effort |
|---|---------|-----|--------|
| 1 | **Order Information Leakage** (Area 4) | Implement EIP-2612 permit signatures or batch approve+swap | High |
| 2 | **Mempool Exposure** (Area 7) | Add configurable RPC with env var, document for users | Low |
| 3 | **Unlimited Approvals** (Area 5) | Switch to exact-amount approvals | Low |

### Priority 2 — Important (Implement Next)

| # | Finding | Fix | Effort |
|---|---------|-----|--------|
| 4 | **No Confirmation Modal in Aggregator** (Area 9) | Add confirmation modal with MEV warning | Medium |
| 5 | **Gas Pricing** (Area 8) | Add dynamic gas estimation and slight premium | Medium |
| 6 | **Inconsistent Slippage Defaults** (Area 2) | Unify defaults across swap modes | Low |

### Priority 3 — Enhancement (Implement When Possible)

| # | Finding | Fix | Effort |
|---|---------|-----|--------|
| 7 | **MEV Warning in Swap Flow** (Area 9) | Add MEV status indicator and warnings | Low |
| 8 | **Dogechain MEV Infrastructure** (Area 1) | Monitor for private relay availability | Ongoing |
| 9 | **Parallel Order Splitting** (Area 6) | Enhance path finder for parallel execution | High |

---

## Dogechain-Specific MEV Landscape

### Current State

Dogechain is an EVM-compatible chain (Chain ID 2000) with the following MEV-relevant characteristics:

1. **No Flashbots/mev-boost:** Dogechain does not have a Flashbots-style MEV relay or block builder infrastructure.
2. **No private mempool:** All transactions are broadcast to the public mempool via standard RPC endpoints.
3. **Low validator count:** Dogechain has a smaller validator set compared to Ethereum mainnet, which may reduce MEV extraction opportunities but does not eliminate them.
4. **Low transaction volume:** The relatively low transaction volume on Dogechain means MEV bots may be less active, but they are not absent.
5. **Block time:** ~2 seconds, which means the MEV window is shorter than on Ethereum (~12 seconds) but still exploitable.

### Recommended Monitoring

- Watch for Dogechain-specific MEV protection solutions (private relays, batch submission services)
- Monitor the Dogechain validator ecosystem for mev-boost adoption
- Track MEV bot activity on Dogechain via tools like Eigenphi or Flashbots transparency dashboards (if they add Dogechain support)

---

## Appendix: Files Reviewed

| File | Lines | Areas Covered |
|------|-------|---------------|
| [`contracts/OmnomSwapAggregator.sol`](contracts/OmnomSwapAggregator.sol) | 391 | Deadline, slippage, atomic execution, router validation |
| [`src/hooks/useAggregator/useSwap.ts`](src/hooks/useAggregator/useSwap.ts) | 167 | Approval flow, slippage application, deadline, swap execution |
| [`src/hooks/useAggregator/useRoute.ts`](src/hooks/useAggregator/useRoute.ts) | 183 | Route computation, pool fetching |
| [`src/components/SwapScreen.tsx`](src/components/SwapScreen.tsx) | 955 | Direct swap UI, slippage settings, confirmation modal |
| [`src/components/aggregator/AggregatorSwap.tsx`](src/components/aggregator/AggregatorSwap.tsx) | 608 | Aggregator UI, slippage settings, gas estimation |
| [`src/lib/web3/config.ts`](src/lib/web3/config.ts) | 11 | RPC configuration, wallet connectors |
| [`src/Web3Provider.tsx`](src/Web3Provider.tsx) | 16 | Provider setup |
| [`src/lib/constants.ts`](src/lib/constants.ts) | 251 | RPC URL, contract addresses, slippage thresholds, approvals |
| [`src/services/pathFinder/index.ts`](src/services/pathFinder/index.ts) | 377 | Route finding, AMM math, order splitting |
| [`src/services/pathFinder/types.ts`](src/services/pathFinder/types.ts) | 86 | Type definitions |
| [`src/hooks/useAggregator/useAggregatorContract.ts`](src/hooks/useAggregator/useAggregatorContract.ts) | 69 | Contract state reads |
| [`src/components/aggregator/Disclosures.tsx`](src/components/aggregator/Disclosures.tsx) | 352 | MEV risk disclosure content |
| [`src/components/aggregator/EducationPanel.tsx`](src/components/aggregator/EducationPanel.tsx) | 293 | MEV education content |

---

*This audit was performed by automated code review. It is not a substitute for a professional security audit by a qualified smart contract security firm.*
