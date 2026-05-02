# Swap Failure Debug Report

## Transaction
- TX Hash: `0x8fbd842b361650c87e1bea7efccd639b2fb7b2d312c6a48d3f1a8cfdf187e443`
- Block: 58315004
- Status: FAILED
- Error: `ERC20InsufficientBalance` (selector: 0xe450d38c)

## Decoded Error
```
ERC20InsufficientBalance(address account, uint256 balance, uint256 needed)
```

## Swap Parameters
- Token In: `0x7b4328c127b85369d9f82ca0503b000d09cf9180` (DC, 18 decimals)
- Token Out: `0xbdad927604c5cb78f15b3669a92fa5a1427d33a2` (MCRIB, 15 decimals)
- Amount In: 100 DC (100,000,000,000,000,000,000 wei)
- Fee: 0.25% = 0.25 DC
- Swap Amount: 99.75 DC (99,750,000,000,000,000,000 wei)
- Router: `0x45afcf57f7e3f3b9ca70335e5e85e4f77dcc5087` (DogeShrk V2)
- minAmountOut: 15,433,470,277,680,703,703,997 MCRIB (15 decimals)
- Deadline: 1777662365 (Unix timestamp)

## On-Chain State (Current - May 1, 2026)
### Contract State
- Contract DC Balance: 2,592,259,760,351,531,330,722 (~2,592 DC)
- Contract MCRIB Balance: 0
- Contract Allowance for DogeShrk: 0

### Pool State
- Pair Address: `0x3d986830F59CD6012E75E0a7A9c58ebCb7E58739`
- Factory: `0x7C10a3b7EcD42dd7D79C0b9d58dDB812f92B574A`
- Token0: DC (`0x7B4328c127B85369D9f82ca0503B000D09CF9180`)
- Token1: MCRIB (`0xbdaD927604c5cB78F15b3669a92Fa5A1427d33a2`)
- DC Reserve (18 dec): 26,685,700,617,113,776,516,971,076 (~26,685 DC)
- MCRIB Reserve (15 dec): 4,162,938,342,378,943,171,960,830,633 (~4.16T MCRIB)

### User Balances
- User DC Balance: 159,953,028,310,012,548,387,690,764 (~160K DC)
- User MCRIB Balance: Unknown (would need to query)

## Math Verification
Using constant product formula: x * y = k

```
Input: 99,750,000,000,000,000,000 wei (99.75 DC)
DC Reserve: 26,685,700,617,113,776,516,971,076
MCRIB Reserve: 4,162,938,342,378,943,171,960,830,633

Expected MCRIB output = 15,560,826,129,990,704,235,930 (15 dec)
minAmountOut: 15,433,470,277,680,703,703,997

Ratio (actual/expected): 1.008252
Slippage headroom: 0.83%
```

**The swap SHOULD succeed with current pool state.**

## Analysis: Why Did It Fail?

### Hypothesis 1: Race Condition (Stale Quote)
The most likely cause is a "stale quote" race condition:
1. Route was calculated when pool had different reserves
2. By the time tx was submitted, pool state changed
3. Another trader moved the price, exhausting the liquidity

### Hypothesis 2: Misleading Error from External Router
The error `ERC20InsufficientBalance` comes from the DogeShrk router, NOT our contract.
The DogeShrk router might be reporting the error incorrectly.

### Hypothesis 3: Approval Issue
The contract has 0 allowance for the DogeShrk router at current state.
If the approval transaction failed silently, tokens couldn't be transferred.
HOWEVER: The swap was submitted via the aggregator, which should handle approvals internally.

### Hypothesis 4: Pre-existing Contract State
The contract had ~2,592 DC from previous operations (likely the earlier failed swap).
This was enough for the 99.75 DC swap.
But something caused the router to reject the swap.

## Recommendations

1. **Add Pool Freshness Check**: Re-fetch reserves immediately before tx submission, warn user if price moved >X%

2. **Add Detailed Error Decoding**: Decode errors from external routers to surface actual failure point

3. **Improve Pre-flight Validation**: Check contract token balance before submitting swap

4. **Add Transaction Retry with Re-quote**: If gas estimation fails, re-fetch route and retry

5. **Log Contract State at Swap Time**: Add logging for contract balances before/after swap attempts

## Status of Previous Issues
- TVL Calculation Bug: FIXED (decimal normalization added)
- Reserve Rejection Threshold: FIXED (1e18 → 1e30)
- refundUser() Function: Implemented in source, NOT yet deployed
- Price Impact Blocking: REMOVED (user can proceed)
- Swap Button Bug: FIXED
