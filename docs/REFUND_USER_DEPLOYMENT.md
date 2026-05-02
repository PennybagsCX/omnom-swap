# refundUser() Deployment Guide

## Status: Function NOT in Deployed Contract

The `refundUser()` function exists in the source code at [`contracts/OmnomSwapAggregator.sol:486-498`](contracts/OmnomSwapAggregator.sol:486) but is **NOT present in the deployed contract** at `0x88F81031b258A0Fb789AC8d3A8071533BFADeC14`.

### Verification Results

| Check | Result |
|-------|--------|
| Function signature `0xbbe6f90b` in deployed bytecode | **NOT FOUND** |
| `executeSwap` signature `0x2163ab66` in deployed bytecode | Found (function exists) |
| Direct `refundUser()` call to deployed contract | Reverted (function not available) |

The deployed contract is an older version that predates the `refundUser()` function addition.

---

## Source Code Implementation

The function in [`contracts/OmnomSwapAggregator.sol:486-498`](contracts/OmnomSwapAggregator.sol:486):

```solidity
/**
 * @notice Refunds ERC20 tokens to a user from failed swap transactions.
 * @dev Only callable by the owner and protected against reentrancy.
 *      Used to refund users whose swap transactions failed and tokens
 *      are held in the protocol's balance tracking.
 * @param user   The user address to refund.
 * @param token  The token address to refund.
 * @param amount The amount to refund.
 */
function refundUser(
    address user,
    address token,
    uint256 amount
) external onlyOwner nonReentrant {
    require(amount > 0, "Amount must be greater than zero");
    require(protocolBalance[token] >= amount, "Insufficient balance");

    protocolBalance[token] -= amount;
    token.safeTransfer(user, amount);

    emit UserRefunded(user, token, amount, user);
}
```

### Function Components Verification

| Requirement | Status | Line |
|-------------|--------|------|
| `onlyOwner` modifier | ✅ | 490 |
| `nonReentrant` modifier | ✅ | 490 |
| Amount validation (`amount > 0`) | ✅ | 491 |
| Balance validation (`protocolBalance >= amount`) | ✅ | 492 |
| `safeTransfer` for token transfer | ✅ | 495 |
| `UserRefunded` event emission | ✅ | 497 |
| Event with indexed fields | ✅ | 160-165 |

---

## Required Deployment: New Contract Version

Since the `refundUser()` function was added after initial deployment, a **new contract must be deployed** to have this functionality.

### Deployment Steps

#### 1. Environment Setup

```bash
# Ensure environment variables are set
source .env

# Required variables:
# - PRIVATE_KEY: Deployer private key with funds for gas
# - TREASURY_ADDRESS: Protocol treasury address
# - PROTOCOL_FEE_BPS: Protocol fee in basis points (e.g., 25 = 0.25%)
```

#### 2. Compile the Contract

```bash
forge build
```

#### 3. Deploy to Dogechain

```bash
source .env
forge script script/Deploy.s.sol:DeployAggregator \
  --rpc-url https://rpc.dogechain.dog \
  --broadcast \
  --private-key $PRIVATE_KEY
```

#### 4. Update Frontend Configuration

After deployment, update [`src/lib/constants.ts`](src/lib/constants.ts:476):

```typescript
export const OMNOMSWAP_AGGREGATOR_ADDRESS = 'YOUR_NEW_DEPLOYED_ADDRESS' as `0x${string}`;
```

---

## Fund Recovery Call

Once the new contract is deployed with `refundUser()`:

### Affected User Details

| Field | Value |
|-------|-------|
| User Address | `0x22F4194F6706E70aBaA14AB352D0baA6C7ceD24a` |
| Token Address | `0x7B4328c127B85369D9f82ca0503B000D09CF9180` ($DC) |
| Amount | `10000000000000000000000` (10,000 $DC with 18 decimals) |

### Transaction Call

```bash
cast send YOUR_NEW_DEPLOYED_ADDRESS \
  "refundUser(address,address,uint256)" \
  0x22F4194F6706E70aBaA14AB352D0baA6C7ceD24a \
  0x7B4328c127B85369D9f82ca0503B000D09CF9180 \
  10000000000000000000000 \
  --rpc-url https://rpc.dogechain.dog \
  --private-key $YOUR_PRIVATE_KEY
```

### Equivalent via Hardhat/Ethers

```javascript
const contract = await ethers.getContractAt(
  "OmnomSwapAggregator", 
  "YOUR_NEW_DEPLOYED_ADDRESS"
);

await contract.refundUser(
  "0x22F4194F6706E70aBaA14AB352D0baA6C7ceD24a",
  "0x7B4328c127B85369D9f82ca0503B000D09CF9180",
  "10000000000000000000000"
);
```

---

## Event Verification

### Event Signature

```
UserRefunded(address indexed user, address indexed token, uint256 amount, address indexed refundRecipient)
```

### Topic Hashes

- `UserRefunded(address,address,uint256,address)` = `0x...` (to be computed from deployment)

### Parsing Events

After calling `refundUser()`, verify on explorer:

```javascript
// Event data structure
{
  "user": "0x22F4194F6706E70aBaA14AB352D0baA6C7ceD24a",
  "token": "0x7B4328c127B85369D9f82ca0503B000D09CF9180",
  "amount": "10000000000000000000000",
  "refundRecipient": "0x22F4194F6706E70aBaA14AB352D0baA6C7ceD24a"
}
```

---

## Important Notes

1. **Owner-only**: The `refundUser()` function can only be called by the contract owner
2. **Balance check**: The function checks `protocolBalance[token] >= amount` before transferring
3. **Non-reentrant**: Protected against reentrancy attacks
4. **Tokens must be present**: The contract must hold sufficient tokens for the refund

---

## Contract Addresses

| Environment | Address |
|-------------|---------|
| **Production** (current, missing refundUser) | `0x88F81031b258A0Fb789AC8d3A8071533BFADeC14` |
| **Treasury** | `0x628f3F4A82791D1d6dEC2Aebe7d648e53fF4FA88` |
| **WWDOGE** | `0xB7ddC6414bf4F5515b52D8BdD69973Ae205ff101` |

---

## Quick Reference

### Function Selector
```
refundUser(address,address,uint256) = 0xbbe6f90b
```

### Required Imports in Contract
- [`SafeERC20`](contracts/libraries/SafeERC20.sol) for safe transfer
- [`ReentrancyGuard`](contracts/libraries/ReentrancyGuard.sol) for non-reentrant protection

### Related State
- [`protocolBalance`](contracts/OmnomSwapAggregator.sol:78) mapping tracks token balances
- [`UserRefunded`](contracts/OmnomSwapAggregator.sol:160) event for event logging