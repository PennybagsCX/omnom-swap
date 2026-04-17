# Security Audit Report: OmnomSwap Aggregator

**Contract:** [`OmnomSwapAggregator.sol`](../contracts/OmnomSwapAggregator.sol)
**Date:** 2026-04-15
**Auditor:** Security Review (Automated)
**Solidity Version:** ^0.8.19
**Network:** Dogechain (Chain ID 2000)

---

## Executive Summary

The OmnomSwapAggregator is a multi-hop DEX aggregator that routes swaps across multiple UniswapV2-compatible DEXes on Dogechain. The contract receives pre-computed routing instructions from an off-chain pathfinder and atomically executes swaps with protocol fee deduction and slippage protection.

**Overall Assessment: MODERATE RISK** — The contract demonstrates competent engineering with several strong security patterns (reentrancy guard, safe approvals, deadline enforcement, router whitelisting). However, it has **2 High** and **5 Medium** severity findings that should be addressed before handling significant value. The most critical issues are the lack of ownership transfer capability and the `rescueTokens` function's unrestricted access to all contract balances.

### Finding Summary

| Severity | Count |
|----------|-------|
| Critical | 0 |
| High | 2 |
| Medium | 5 |
| Low | 4 |
| Informational | 5 |

---

## Findings

### HIGH SEVERITY

#### H-01: No Ownership Transfer Mechanism — Permanent Single-Key Risk

**Location:** [`OmnomSwapAggregator.sol`](../contracts/OmnomSwapAggregator.sol:20) (contract-level)

**Description:** The contract stores an [`owner`](../contracts/OmnomSwapAggregator.sol:38) state variable but provides no function to transfer ownership. Once set in the [`constructor`](../contracts/OmnomSwapAggregator.sol:150), the owner is immutable for the contract's entire lifetime.

**Impact:**
- If the owner's private key is compromised, there is no way to rotate control — the attacker has permanent admin access.
- If the owner loses their key, all admin functions (adding/removing routers, updating fees, pausing, rescuing tokens) become permanently inaccessible.
- This creates a single point of failure for the entire protocol.

**Recommendation:** Add a two-step ownership transfer pattern:

```solidity
address public pendingOwner;

function transferOwnership(address newOwner) external onlyOwner {
    require(newOwner != address(0), "Zero address");
    pendingOwner = newOwner;
}

function acceptOwnership() external {
    require(msg.sender == pendingOwner, "Not pending owner");
    owner = pendingOwner;
    pendingOwner = address(0);
}
```

---

#### H-02: `rescueTokens` Can Drain Legitimate User Funds

**Location:** [`rescueTokens()`](../contracts/OmnomSwapAggregator.sol:359)

**Description:** The [`rescueTokens()`](../contracts/OmnomSwapAggregator.sol:359) function allows the owner to transfer **any** ERC20 token from the contract to the owner's address with no restrictions:

```solidity
function rescueTokens(address token, uint256 amount) external onlyOwner {
    token.safeTransfer(owner, amount);
}
```

**Impact:**
- If a swap is in-flight (in a multi-block MEV scenario) or if dust accumulates from rounding, the owner can drain these tokens.
- A compromised or malicious owner can steal any tokens held by the contract, including tokens legitimately belonging to users from partially completed swaps.
- The function accepts any `amount`, enabling a full drain of any token balance.

**Recommendation:** Add accounting to track which tokens belong to the protocol (fees collected) vs. which are user funds in transit. At minimum, add a blockable list of tokens that cannot be rescued, or enforce a balance threshold. Consider using a `withdrawableBalance` accounting pattern:

```solidity
mapping(address => uint256) public accruedFees;

function rescueTokens(address token, uint256 amount) external onlyOwner {
    // Only allow rescuing tokens beyond what's accounted for
    uint256 totalBalance = IERC20(token).balanceOf(address(this));
    uint256 lockedAmount = accruedFees[token]; // or other accounting
    require(amount <= totalBalance - lockedAmount, "Exceeds withdrawable");
    token.safeTransfer(owner, amount);
}
```

---

### MEDIUM SEVERITY

#### M-01: No Validation That `step.amountIn` Matches `swapAmount` for Multi-Step Swaps

**Location:** [`executeSwap()`](../contracts/OmnomSwapAggregator.sol:206) — Step amount validation logic

**Description:** The contract validates that the first step's `amountIn` does not exceed `swapAmount`:

```solidity
if (i == 0) {
    require(stepAmountIn <= swapAmount, "Step exceeds swap amount");
}
```

However:
1. For step 0, it uses `<=` instead of `==`, allowing the first step to use **less** than the full `swapAmount`. Any remainder is silently abandoned in the contract.
2. For subsequent steps (i > 0), there is **no validation** that `step.amountIn` matches the previous step's output. The caller can pass arbitrary amounts.

**Impact:**
- Tokens can be permanently lost if `step.amountIn < swapAmount` for the first step, since the remainder stays in the contract with no way to return it (only `rescueTokens` can recover it, which requires owner intervention).
- A buggy off-chain pathfinder could construct steps where intermediate amounts don't chain correctly, leading to swap failures or fund loss.

**Recommendation:** For single-path swaps (the common case), enforce strict equality:

```solidity
if (i == 0) {
    require(stepAmountIn == swapAmount, "Step must use full swap amount");
}
```

For multi-path (split) swaps, consider adding explicit validation that the sum of all first-step amounts equals `swapAmount`.

---

#### M-02: Incompatibility with Fee-on-Transfer Tokens

**Location:** [`executeSwap()`](../contracts/OmnomSwapAggregator.sol:181) — Token transfer and fee logic

**Description:** The contract assumes `transferFrom` moves exactly `request.amountIn` tokens:

```solidity
request.tokenIn.safeTransferFrom(msg.sender, address(this), request.amountIn);
uint256 feeAmount = (request.amountIn * protocolFeeBps) / _BPS_DENOMINATOR;
uint256 swapAmount = request.amountIn - feeAmount;
```

For fee-on-transfer tokens (e.g., rebasing tokens, deflationary tokens), the actual received amount will be less than `request.amountIn`. The fee and swap calculations will be based on the nominal amount, not the actual received amount, potentially causing the swap to fail or the contract to attempt transferring tokens it doesn't hold.

**Impact:**
- Swaps involving fee-on-transfer tokens will revert when the contract tries to transfer `feeAmount + swapAmount` that exceeds its actual balance.
- In edge cases, the fee transfer could succeed but leave insufficient tokens for the swap.

**Recommendation:** Measure actual balance changes:

```solidity
uint256 balBefore = IERC20(request.tokenIn).balanceOf(address(this));
request.tokenIn.safeTransferFrom(msg.sender, address(this), request.amountIn);
uint256 received = IERC20(request.tokenIn).balanceOf(address(this)) - balBefore;

uint256 feeAmount = (received * protocolFeeBps) / _BPS_DENOMINATOR;
uint256 swapAmount = received - feeAmount;
```

---

#### M-03: Deadline Not Enforced as Absolute Timestamp

**Location:** [`executeSwap()`](../contracts/OmnomSwapAggregator.sol:174) — Deadline check

**Description:** The deadline check uses `<=`:

```solidity
require(block.timestamp <= request.deadline, "Expired");
```

This means the swap is valid **at** the deadline timestamp but not after. While this is technically correct, the more common and safer pattern in DeFi is to use `<` to provide a strict cutoff. More importantly, there is no validation that `request.deadline` is set to a reasonable future timestamp. A user could set `deadline = type(uint256).max`, effectively disabling deadline protection entirely.

**Impact:**
- Miners/validators can delay inclusion of a transaction with a far-future deadline, potentially executing it at an unfavorable time.
- Pending transactions in the mempool with large deadlines remain exploitable for extended periods.

**Recommendation:** Consider adding a maximum deadline window:

```solidity
require(block.timestamp <= request.deadline, "Expired");
require(request.deadline <= block.timestamp + MAX_DEADLINE, "Deadline too far");
```

Where `MAX_DEADLINE` could be, e.g., 1 hour (`3600`).

---

#### M-04: Router Removal Does Not Prevent In-Flight Swaps

**Location:** [`removeRouter()`](../contracts/OmnomSwapAggregator.sol:271)

**Description:** A router can be removed from the whitelist while transactions using that router are pending in the mempool. The [`supportedRouters`](../contracts/OmnomSwapAggregator.sol:199) check happens at execution time, so a pending swap will revert if the router is removed before it's included in a block.

**Impact:**
- Users who submitted valid swaps may have their transactions revert if the owner removes a router at the same time.
- While this doesn't directly cause fund loss (the `transferFrom` happens before the router check, but the entire transaction reverts atomically), it creates a griefing vector and poor user experience.
- In a multi-step swap, if step N uses a router that gets removed between step N-1 and step N, the entire swap reverts.

**Recommendation:** Implement a timelocked router removal:

```solidity
uint256 public constant ROUTER_REMOVAL_DELAY = 2 days;
mapping(address => uint256) public pendingRouterRemoval;

function proposeRouterRemoval(address router) external onlyOwner {
    pendingRouterRemoval[router] = block.timestamp + ROUTER_REMOVAL_DELAY;
}

function executeRouterRemoval(address router) external onlyOwner {
    require(pendingRouterRemoval[router] > 0, "Not proposed");
    require(block.timestamp >= pendingRouterRemoval[router], "Delay not met");
    // ... remove router
}
```

---

#### M-05: Missing Zero-Amount Validation on `amountIn`

**Location:** [`executeSwap()`](../contracts/OmnomSwapAggregator.sol:172)

**Description:** There is no validation that `request.amountIn > 0`. If `amountIn = 0`:
- `feeAmount = 0` (no issue)
- `swapAmount = 0` (no issue)
- The swap proceeds with zero amounts, which will either revert at the router level or succeed with zero output.

**Impact:**
- Wastes gas on pointless transactions.
- Could interact unexpectedly with downstream protocols that don't handle zero-amount swaps.
- If the router doesn't revert on zero input, the user receives zero output tokens, and the event logs a swap with zero amounts — potentially confusing off-chain monitoring.

**Recommendation:**
```solidity
require(request.amountIn > 0, "Zero amount");
```

---

### LOW SEVERITY

#### L-01: `SafeERC20` Library Doesn't Handle Non-Standard Return Values

**Location:** [`SafeERC20.sol`](../contracts/libraries/SafeERC20.sol:36) — `safeTransferFrom` and `safeTransfer`

**Description:** The [`safeTransferFrom()`](../contracts/libraries/SafeERC20.sol:36) and [`safeTransfer()`](../contracts/libraries/SafeERC20.sol:49) functions check the boolean return value:

```solidity
bool success = IERC20(token).transferFrom(from, to, amount);
if (!success) { revert ... }
```

However, some tokens (e.g., USDT, BNB) don't return a boolean on `transfer`/`transferFrom`. When called against the IERC20 interface, the ABI decoder will interpret missing return data as `false`, causing the check to revert even on successful transfers.

**Impact:**
- The contract is incompatible with tokens that don't return bool on transfer operations.
- On Dogechain, most tokens are standard UniswapV2-compatible ERC20s, so this is a low practical risk but limits future token compatibility.

**Recommendation:** Use OpenZeppelin's `SafeERC20` library which wraps calls in `abi.decode` with size checks, or implement a low-level call pattern:

```solidity
function safeTransfer(address token, address to, uint256 amount) internal {
    (bool success, bytes memory data) = token.call(
        abi.encodeWithSelector(IERC20.transfer.selector, to, amount)
    );
    require(success && (data.length == 0 || abi.decode(data, (bool))), "Transfer failed");
}
```

---

#### L-02: `recipient = address(this)` Allows Token Locking

**Location:** [`executeSwap()`](../contracts/OmnomSwapAggregator.sol:236)

**Description:** There is no check preventing `request.recipient == address(this)`. If set, the swap output tokens are sent back to the aggregator contract itself, where they can only be recovered via [`rescueTokens()`](../contracts/OmnomSwapAggregator.sol:359).

**Impact:**
- User funds locked in the contract, requiring owner intervention to recover.
- Could be used maliciously to accumulate tokens in the contract for later draining via `rescueTokens`.

**Recommendation:**
```solidity
require(request.recipient != address(this), "Cannot send to self");
```

---

#### L-03: `routerList` Array Reordering on Removal

**Location:** [`removeRouter()`](../contracts/OmnomSwapAggregator.sol:277)

**Description:** The swap-and-pop removal pattern changes the order of [`routerList`](../contracts/OmnomSwapAggregator.sol:53):

```solidity
routerList[i] = routerList[routerList.length - 1];
routerList.pop();
```

**Impact:**
- Off-chain systems that enumerate `routerList` by index may be affected by the reordering.
- Not a direct security vulnerability but can cause confusion for monitoring/indexing systems.

**Recommendation:** Document that the array order is not stable, or use a gap-based removal pattern if stable ordering is needed.

---

#### L-04: No Event Emitted for Ownership-Related Actions

**Location:** Contract-level

**Description:** While events are emitted for router changes, treasury updates, fee updates, and pause/unpause, there is no event for ownership changes — because ownership transfer doesn't exist (see H-01). Even if ownership transfer is added, the current contract doesn't log who the owner is via events.

**Impact:** Off-chain monitoring systems cannot track ownership state changes without polling.

**Recommendation:** When implementing ownership transfer (H-01), ensure events are emitted for both `transferOwnership` and `acceptOwnership` calls.

---

### INFORMATIONAL

#### I-01: Custom `ReentrancyGuard` Instead of OpenZeppelin

**Location:** [`ReentrancyGuard.sol`](../contracts/libraries/ReentrancyGuard.sol:13)

**Description:** The contract uses a custom [`ReentrancyGuard`](../contracts/libraries/ReentrancyGuard.sol:13) implementation rather than the well-audited OpenZeppelin version. The implementation is functionally correct and follows the same pattern (status flag with `_NOT_ENTERED`/`_ENTERED` states).

**Impact:** Minimal — the implementation is correct. However, using a battle-tested library reduces audit surface area.

**Recommendation:** Consider using OpenZeppelin's `ReentrancyGuard` from `@openzeppelin/contracts/security/ReentrancyGuard.sol` for maximum confidence.

---

#### I-02: Custom `SafeERC20` Instead of OpenZeppelin

**Location:** [`SafeERC20.sol`](../contracts/libraries/SafeERC20.sol:11)

**Description:** Similar to I-01, the contract uses a custom [`SafeERC20`](../contracts/libraries/SafeERC20.sol:11) implementation. The `safeApprove` function correctly handles the USDT-style approve-to-zero-first pattern.

**Impact:** See L-01 for a specific limitation. The approve pattern is correctly implemented.

**Recommendation:** Consider using OpenZeppelin's `SafeERC20` for broader token compatibility.

---

#### I-03: Approval Reset Pattern Is Gas-Intensive

**Location:** [`executeSwap()`](../contracts/OmnomSwapAggregator.sol:212) — `safeApprove` calls

**Description:** Each swap step performs two `approve` calls via [`safeApprove()`](../contracts/libraries/SafeERC20.sol:63): one to set the allowance and one to reset it to zero. The [`safeApprove()`](../contracts/libraries/SafeERC20.sol:63) function itself may also perform a reset-to-zero before setting the desired amount if the current allowance is non-zero.

This means in the worst case, each swap step triggers **3-4 `approve` calls**: reset-before-set, set, reset-after-swap. For a multi-step swap, this adds significant gas overhead.

**Impact:** Higher gas costs for users. Not a security issue but affects usability.

**Recommendation:** Consider using `safeIncreaseAllowance` / `safeDecreaseAllowance` or the Permit2 pattern for more gas-efficient approvals.

---

#### I-04: Deploy Script Reads Private Key from Environment

**Location:** [`Deploy.s.sol`](../script/Deploy.s.sol:42)

**Description:** The deploy script reads `PRIVATE_KEY` from environment variables:

```solidity
uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
```

**Impact:** This is standard Foundry practice and the [`.env`](../.env.example) file is properly gitignored. The `.env.example` file contains only placeholder values. No secrets were found in the repository.

**Recommendation:** Ensure `.env` is never committed. Consider using Foundry's `--keystore` or hardware wallet signing for production deployments.

---

#### I-05: Contract Size and Complexity

**Location:** [`OmnomSwapAggregator.sol`](../contracts/OmnomSwapAggregator.sol)

**Description:** The main contract is 362 lines, which is well within the 500-line threshold. The contract has clear section organization and good documentation. The single-contract architecture is appropriate for this use case.

**Impact:** None — the contract is well-structured and maintainable.

---

## Security Checklist Results

| Check | Status | Notes |
|-------|--------|-------|
| Reentrancy protection | ✅ PASS | [`nonReentrant`](../contracts/OmnomSwapAggregator.sol:172) applied to [`executeSwap()`](../contracts/OmnomSwapAggregator.sol:172) |
| Fee calculation overflow | ✅ PASS | Solidity 0.8.x has built-in overflow checks |
| Fee cap enforcement | ✅ PASS | [`MAX_FEE_BPS`](../contracts/OmnomSwapAggregator.sol:28) = 500 enforced in constructor and [`setProtocolFee()`](../contracts/OmnomSwapAggregator.sol:317) |
| Fee taken before swap | ✅ PASS | Fee deducted at [line 184](../contracts/OmnomSwapAggregator.sol:184), before swap loop |
| Token return value checks | ⚠️ PARTIAL | Custom [`SafeERC20`](../contracts/libraries/SafeERC20.sol) doesn't handle non-standard tokens (L-01) |
| Approval management | ✅ PASS | Reset-to-zero pattern used correctly |
| Admin access control | ✅ PASS | [`onlyOwner`](../contracts/OmnomSwapAggregator.sol:130) on all admin functions |
| Ownership transfer | ❌ FAIL | No transfer mechanism exists (H-01) |
| Zero address guards | ✅ PASS | Checked in constructor and setters |
| Slippage protection | ✅ PASS | [`minTotalAmountOut`](../contracts/OmnomSwapAggregator.sol:233) enforced after all steps |
| Deadline enforcement | ✅ PASS | Deadline checked at [line 174](../contracts/OmnomSwapAggregator.sol:174) |
| Router whitelist | ✅ PASS | [`supportedRouters`](../contracts/OmnomSwapAggregator.sol:199) checked per step |
| Pause mechanism | ✅ PASS | [`whenNotPaused`](../contracts/OmnomSwapAggregator.sol:136) modifier on [`executeSwap()`](../contracts/OmnomSwapAggregator.sol:172) |
| Fund locking risk | ⚠️ PARTIAL | Tokens can be locked via `recipient = address(this)` (L-02) or step amount mismatch (M-01) |
| Secret exposure | ✅ PASS | No secrets in repository; `.env` properly gitignored |

---

## Recommended Fixes (Priority Order)

1. **[H-01]** Add two-step ownership transfer with `pendingOwner` pattern.
2. **[H-02]** Add balance accounting to `rescueTokens` to prevent draining user funds.
3. **[M-01]** Validate step amounts match expected balances (use `==` for single-path, sum validation for split paths).
4. **[M-02]** Support fee-on-transfer tokens by measuring actual balance changes.
5. **[M-03]** Add a maximum deadline window to prevent indefinitely pending swaps.
6. **[M-04]** Consider timelocked router removal for production use.
7. **[M-05]** Add `require(request.amountIn > 0)` validation.
8. **[L-01]** Upgrade `SafeERC20` to handle non-standard return values.
9. **[L-02]** Add `require(request.recipient != address(this))` guard.

---

## Positive Security Observations

The following patterns demonstrate security-conscious engineering:

- **ReentrancyGuard** properly applied to the only external entry point that handles funds.
- **Checks-Effects-Interactions** pattern followed — all validations happen before external calls.
- **Safe approval management** — approvals are set to exact amounts and reset to zero after use.
- **Fee calculation** is correct and capped at 500 bps (5%).
- **Deadline enforcement** prevents stale transaction execution.
- **Emergency pause** provides a circuit breaker for critical situations.
- **Router whitelist** prevents routing through arbitrary/untrusted contracts.
- **Path continuity validation** ensures swap steps chain correctly.
- **Solidity 0.8.x** provides built-in overflow/underflow protection.
- **No secrets exposed** in the repository.

---

*This audit was performed using static analysis of the source code. A complete security assessment should also include dynamic testing, formal verification of mathematical invariants, and economic modeling of attack vectors.*
