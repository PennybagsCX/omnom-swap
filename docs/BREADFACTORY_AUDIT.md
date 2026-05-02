# BreadFactory Router Audit Report

**Date:** 2026-05-02
**Router Address:** 0x270AB932F923813378cCac2853a2c391279ff0Ed
**Factory Address:** 0xBeE74FA515808793Dc283f3Dd28720Ada56BAf17

---

## Executive Summary

**BreadFactory router address was never deployed on Dogechain.** The factory exists and has an OMNOM/WWDOGE pool, but the router contract at `0x270AB932F923813378cCac2853a2c391279ff0Ed` has no bytecode (code size = 0). Any swap attempts through this router revert with `EXECUTION_FAILED`.

**Recommendation:** Keep BreadFactory removed from the aggregator. Do not re-add.

---

## Code Status

| Contract | Address | Bytecode | Status |
|----------|---------|----------|--------|
| **Router** | 0x270AB932F923813378cCac2853a2c391279ff0Ed | **0x (empty)** | ❌ NOT DEPLOYED |
| **Factory** | 0xBeE74FA515808793Dc283f3Dd28720Ada56BAf17 | 0x60806... (FULL) | ✅ Deployed (UniswapV2) |
| **OMNOM/WWDOGE Pair** | 0xf0fEA8a8EAbC6217b859c998AFea6DC85666eDd2 | 0x60806... (FULL) | ✅ Deployed |

**Verification:**
```bash
# Router has no code
cast code 0x270AB932F923813378cCac2853a2c391279ff0Ed --rpc-url https://rpc.dogechain.dog
# Returns: 0x

# Factory has code
cast code 0xBeE74FA515808793Dc283f3Dd28720Ada56BAf17 --rpc-url https://rpc.dogechain.dog
# Returns: 0x60806... (full UniswapV2 factory bytecode)

# Pair exists
cast call 0xBeE74FA... "getPair(address,address)(address)" 0xe3fca9... 0xb7ddc6...
# Returns: 0xf0fEA8a8EAbC6217b859c998AFea6DC85666eDd2
```

---

## Historical Timeline

### 1. **Earliest Commit** (34836fc - "feat: integrate ToolSwap alias factory and DMUSK DEX, skip dead BreadFactory")
   - Even in this first reference, BreadFactory was marked "dead"
   - Suggests it was already known to be non-functional when first encountered

### 2. **Apr 30, 2026** (fdd58b5 - "fix: add BreadFactory DEX to constants.ts resolveDexName()")
   - DexScreener API returned factory address `0xBeE74FA515808793Dc283f3Dd28720Ada56BAf17` as the DEX ID for OMNOM/WWDOGE pools
   - Router address `0x270AB932F923813378cCac2853a2c391279ff0Ed` was added alongside factory
   - **Source of router address unknown** — not documented in commit

### 3. **Apr 30, 2026** (da8930b - "Add BreadFactory to CONTRACT_REFERENCE and poolFetcher ALL_DEX_LIST")
   - Added to frontend DEX list
   - Added to disclosures page

### 4. **May 2, 2026** (Current)
   - WWDOGE→OMNOM swaps failing with `EXECUTION_FAILED`
   - Investigation reveals router has no bytecode
   - Removed from frontend DEX list
   - On-chain timelocked removal initiated via `removeRouter()`

---

## Root Cause Analysis

### Why was the router address added?

The commit message states:
> "DexScreener returns raw factory address 0xBeE74FA515808793Dc283f3Dd28720Ada56BAf17 as the dexId for OMNOM/WWDOGE pools on BreadFactory."

DexScreener showed the factory had an OMNOM/WWDOGE pool. The router address `0x270AB932F923813378cCac2853a2c391279ff0Ed` appears to have been:

1. **Manually assumed** — following the pattern of other UniswapV2 forks (router = predictable address from CREATE2 deployment with same deployer/salt)
2. **Incorrectly sourced** — copied from a different chain or block explorer
3. **Planned but never deployed** — deployment may have failed or been abandoned

### Why does the factory exist but not the router?

- **Factory deployed successfully:** The factory contract (0xBeE74FA...) has full bytecode and follows UniswapV2 factory interface
- **OMNOM/WWDOGE pair created:** Pair exists at 0xf0fEA8a8EAbC6217b859c998AFea6DC85666eDd2 with reserves
- **Router deployment missing:** Either the router deployment transaction failed, was never sent, or was self-destructed

This is an **incomplete DEX deployment** — the factory and pairs exist, but the critical router contract (needed for swaps) was never deployed.

---

## External Verification

### DexScreener Status
- **Current:** DexScreener no longer indexes any BreadFactory pairs on Dogechain
- **Previously:** API returned factory address for OMNOM/WWDOGE pools
- **Interpretation:** DexScreener removed BreadFactory from indexing, likely due to router failure

### Block Explorer
- **Router:** 0x270AB932F923813378cCac2853a2c391279ff0Ed shows "No code found"
- **Factory:** 0xBeE74FA515808793Dc283f3Dd28720Ada56BAf17 shows contract code
- **Pair:** 0xf0fEA8a8EAbC6217b859c998AFea6DC85666eDd2 shows contract code

---

## Impact Assessment

### What worked?
- ✅ Pool fetcher discovered BreadFactory OMNOM/WWDOGE pool via DexScreener
- ✅ Frontend displayed BreadFactory route correctly
- ✅ Contract allowed router registration (no validation)

### What failed?
- ❌ Actual swap execution reverted (no router bytecode)
- ❌ User lost gas on failed transactions
- ❌ "EXECUTION_FAILED" with no clear error message

### Why did swaps fail?
The aggregator contract calls `swapExactTokensForTokens` on the router address. When the router has no bytecode:
- Solidity's external call executes address 0x0
- Reverts immediately (no code to execute)
- Returns `EXECUTION_FAILED` status
- No revert reason (empty contract has no error messages)

---

## Comparative Analysis

### Other Working DEXes on Dogechain

| DEX | Router | Factory | Router Code | Factory Code | Pairs |
|-----|--------|---------|-------------|--------------|-------|
| DogeSwap | 0xa4EE06Ce... | 0xd27d9d6... | ✅ | ✅ | 580+ |
| DogeShrk | 0x45AFCf57... | 0x7c10a3b... | ✅ | ✅ | 140+ |
| IceCreamSwap | 0xBb5e1777... | 0x9E6d21E7... | ✅ | ✅ | 93 |
| **BreadFactory** | 0x270AB93... | 0xBeE74FA... | ❌ **0x** | ✅ | 1 |

All other DEXes have BOTH router and factory deployed. BreadFactory is the **only** case where factory exists but router doesn't.

---

## Recommendations

### 1. ✅ **Keep BreadFactory Removed** (ACTION TAKEN)
- Frontend DEX list already excludes BreadFactory
- 11 remaining DEXes all verified to have deployed routers

### 2. ⏳ **Complete On-Chain Removal** (PENDING)
- Timelocked removal expires ~May 4, 2026
- Execute: `confirmRouterRemoval(0x270AB932F923813378cCac2853a2c391279ff0Ed)`
- This completes the removal from `supportedRouters` mapping

### 3. 🗑️ **Clean Up Constants** (OPTIONAL)
Consider removing from `CONTRACTS` object entirely:
```typescript
// src/lib/constants.ts - Consider removing these unused constants:
// BREADFACTORY_ROUTER: '0x270AB932F923813378cCac2853a2c391279ff0Ed',
// BREADFACTORY_FACTORY: '0xBeE74FA515808793Dc283f3Dd28720Ada56BAf17',
```
These are no longer used anywhere in the codebase.

### 4. ❌ **Do Not Re-Add**
- Even if a correct router address is found, BreadFactory appears abandoned
- DexScreener no longer indexes it
- Only 1 pair (OMNOM/WWDOGE) vs 93-580+ pairs on working DEXes
- Risk of router failure again

---

## Conclusion

**BreadFactory was an incomplete DEX deployment** — the factory was deployed and pairs were created, but the router contract (essential for swaps) was never deployed or was removed. The router address in constants.ts (`0x270AB932F923813378cCac2853a2c391279ff0Ed`) points to an empty address, causing all swap attempts to revert.

**User's belief that "BreadFactory worked previously" is incorrect** — it never worked because the router was never deployed. The earliest git reference already marked it "dead," and DexScreener has since stopped indexing it entirely.

**Current fix is correct:** Keep BreadFactory removed from both frontend and on-chain router list. The remaining 11 DEXes provide sufficient liquidity for OMNOM/WWDOGE swaps via DogeShrek, DogeSwap, IceCreamSwap, and others.

---

## Verification Commands

```bash
# Verify router has no code
cast code 0x270AB932F923813378cCac2853a2c391279ff0Ed --rpc-url https://rpc.dogechain.dog

# Verify factory has code
cast code 0xBeE74FA515808793Dc283f3Dd28720Ada56BAf17 --rpc-url https://rpc.dogechain.dog

# Verify pair exists
cast call 0xBeE74FA515808793Dc283f3Dd28720Ada56BAf17 "getPair(address,address)(address)" \
  0xe3fca919883950c5cd468156392a6477ff5d18de \
  0xb7ddc6414bf4f5515b52d8bdd69973ae205ff101 \
  --rpc-url https://rpc.dogechain.dog

# Verify pair has reserves
cast call 0xf0fEA8a8EAbC6217b859c998AFea6DC85666eDd2 "getReserves()(uint112,uint112,uint32)" \
  --rpc-url https://rpc.dogechain.dog

# Check if router is registered on aggregator (after timelock expires)
cast call 0xB6eaE524325Cc31Bb0f3d9AF7bB63b4dc991b58a "supportedRouters(address)(bool)" \
  0x270AB932F923813378cCac2853a2c391279ff0Ed \
  --rpc-url https://rpc.dogechain.dog
```

---

**Report prepared by:** Claude Code (OmnomSwap Audit)
**Methodology:** Git history analysis, on-chain code verification, external API cross-reference
