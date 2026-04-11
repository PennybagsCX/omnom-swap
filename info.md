# DogeSwap on Dogechain — Technical Research Document

**Compiled:** April 8, 2026
**Purpose:** Full technical reference for PumpFinder AI DEX integration
**Sources:** DogeSwap Explorer (BlockScout), GeckoTerminal, DeFiLlama, GitHub, Medium

---

## 1. Network Overview

| Property | Value |
|----------|-------|
| Chain ID | 2000 |
| Consensus | IBFT PoS (Polygon Edge framework) |
| Block Time | ~2 seconds |
| Gas | 20–250 Gwei |
| RPC | https://rpc.dogechain.dog |
| Explorer | https://explorer.dogechain.dog (BlockScout) |
| Native Token | $DC (DogeChain token) |
| Wrapped Doge | WWDOGE (WDOGE) |
| Token Standard | DOG-20 (ERC-20 equivalent) |

---

## 2. Key Token Contracts

### WWDOGE (Wrapped WDOGE)
| Property | Value |
|----------|-------|
| Contract | `0xb7ddc6414bf4f5515b52d8bdd69973ae205ff101` |
| Standard | DOG-20 |
| Decimals | 18 |
| Circulating Supply | ~6,290,000 |

### DC (DogeChain Token)
| Property | Value |
|----------|-------|
| Contract | `0x7B4328c127B85369D9f82ca0503B000D09CF9180` |
| Type | TransparentUpgradeableProxy |
| Decimals | 18 |

### DST-V2 (DogeSwap V2 Token)
| Property | Value |
|----------|-------|
| Contract | `0x516f30111b5a65003c5f7cb35426eb608656ce01` |
| Standard | DOG-20 |
| Decimals | 18 |
| Total Supply | ~0.0000023 |

---

## 3. DogeSwap Contracts

### 3.1 V3 / Algebra (Current — Active)

#### SwapRouter
| Property | Value |
|----------|-------|
| Address | `0x4aE2bD0666c76C7f39311b9B3e39b53C8D7C43Ea` |
| Type | SwapRouter (Algebra / Uniswap V3 fork) |
| Compiler | Solidity v0.7.6 |
| Optimization | Enabled, 1,000,000 runs |
| Verification Date | 2024-02-02 |
| Total Transactions | 194,414 |
| Proxy Pattern | TransparentUpgradeableProxy |

**Key Functions:**
- `exactInput(bytes[])` — swap with multicall support
- `exactInputSingle(address)` — single pool swap
- `exactOutput(bytes[])` — reverse swap with multicall
- `exactOutputSingle(address)` — single pool reverse swap
- `multicall(bytes[])` — batch multiple operations
- `algebraSwapCallback(int256,int256,bytes)` — internal callback for Algebra

**Features:**
- Fee-on-transfer token support
- EIP-2612 permit support
- SweepTokenWithFee for configurable withdrawal fees
- TransparentUpgradeableProxy upgradability

**Explorer Link:** https://explorer.dogechain.dog/address/0x4aE2bD0666c76C7f39311b9B3e39b53C8D7C43Ea

#### AlgebraFactory
| Property | Value |
|----------|-------|
| Address | `0xd2480162Aa7F02Ead7BF4C127465446150D58452` |
| Total Transactions | 5 |

**Key Functions:**
- `createPool(address,address)` — create a new liquidity pool
- `createAndInitializePoolIfNecessary(address,address,uint160)` — create or initialize pool
- `setVaultAddress(address)` — set the vault address
- `setFarmingAddress(address)` — set the farming/rewards address

**Explorer Link:** https://explorer.dogechain.dog/address/0xd2480162Aa7F02Ead7BF4C127465446150D58452

#### PoolDeployer
| Property | Value |
|----------|-------|
| Address | `0x56c2162254b0e4417288786ee402c2b41d4e181e` |

Deployed as part of the SwapRouter constructor arguments. Used for deterministic pool deployment.

**Explorer Link:** https://explorer.dogechain.dog/address/0x56c2162254b0e4417288786ee402c2b41d4e181e

#### WNativeToken (WWDOGE)
| Property | Value |
|----------|-------|
| Address | `0xb7ddc6414bf4f5515b52d8bdd69973ae205ff101` |

Used as the WETH equivalent on Dogechain — wraps native DOGE into an ERC-20 compatible format for DEX swaps. Passed as a constructor argument to the SwapRouter.

**Explorer Link:** https://explorer.dogechain.dog/address/0xb7ddc6414bf4f5515b52d8bdd69973ae205ff101

---

### 3.2 V2 (Legacy)

#### DogeSwap V2 Router
| Property | Value |
|----------|-------|
| Address | `0x5bf60eA5cF2383F407f09CF38378176298238A6C` |
| Label | DogeSwap V2 (DST-V2) |
| Total Outgoing TXs | 0 |
| Total Incoming Transfers | ~1,100,000 |
| Key Function | `swapExactTokensForWDOGE` |
| Method ID | `0xced88704` |
| Interface | IUniswapV2Pair (verified source) |

**Note:** This is a passive contract — no outgoing transactions but massive incoming transfer volume, indicating it serves as a fallback or archival routing target.

**Explorer Link:** https://explorer.dogechain.dog/address/0x5bf60eA5cF2383F407f09CF38378176298238A6C

#### DogeSwap V2 Token (DST-V2)
| Property | Value |
|----------|-------|
| Address | `0x516f30111b5a65003c5f7cb35426eb608656ce01` |
| Standard | DOG-20 |
| Decimals | 18 |

---

### 3.3 Supporting Contracts

#### TokenLockerManagerV1
| Property | Value |
|----------|-------|
| Address | `0x016c1D8cf86f60A5382BA5c42D4be960CBd1b868` |
| Compiler | Solidity v0.8.10 |
| Verified | 2022-08-20 |
| Total Transactions | 2,787 |
| Purpose | Token vesting and locking |

**Explorer Link:** https://explorer.dogechain.dog/address/0x016c1D8cf86f60A5382BA5c42D4be960CBd1b868

---

## 4. Fee Structure

| Version | Fee Type | Rate |
|---------|----------|------|
| V2 | Fixed swap fee | 0.30% (standard Uniswap V2) |
| V3 / Algebra | Dynamic fee tiers | 0.01% / 0.05% / 0.30% / 1.00% |

**Router Sweep Function:**
- `sweepTokenWithFee(address token, uint256 minAmount, address recipient, uint256 fee)` — supports configurable fees on withdrawal, useful for protocol revenue or liquidity mining incentives.

---

## 5. DogeSwap V69 (Announced — Not Launched)

| Property | Details |
|---------|---------|
| Status | Announced July 2022 on Medium; no confirmed launch |
| Innovation | Off-chain oracle to sign prices |
| Goal | Reduce or eliminate impermanent loss (IL) |
| Mechanism | Oracle-verified pricing to prevent IL from arbitrage |
| Potential Benefits | Lower fees for traders; less LP losses to arbitragers |
| Contracts Found | None — not deployed as of April 2026 |

The DogeSwap team self-described as having "taken large sums of money away from liquidity providers" through arbitrage profit (impermanent loss). V69 was conceived as a fix for this systemic inefficiency.

---

## 6. GitHub Repositories

| Repo | URL | Notes |
|------|-----|-------|
| Official | https://github.com/dogeswap-org/dogeswap | Uniswap V2 fork interface, TypeScript + Solidity, GPL-3.0, last push Aug 2022 |
| Community (HECO) | https://github.com/Dogeswap-Fans/dogeswap-contracts | HECO chain contracts, MIT, last push May 2021 |
| Aggregator Fork | https://github.com/omnomcommunity/swapr-fork-dogechain | Swapr fork aggregating DogeSwap + Frax + Quickswap + Kibbleswap |

---

## 7. DEX Aggregators on Dogechain

| Aggregator | URL |
|------------|-----|
| ChewySwap | https://app.chewyswap.dog/swap |
| Swapr Fork | https://swapr-fork-dogechain.netlify.app/#/swap?chainId=2000 |

---

## 8. Protocol Statistics (April 2026)

| Metric | Value |
|--------|-------|
| DogeSwap TVL | $707,846 |
| Share of Chain TVL | 71.5% |
| Total Dogechain TVL | $989,000 |
| 24h DEX Volume | ~$2,000 |
| Stablecoin Supply | $435,000 USDC |

---

## 9. Top Pools

| Pool | Liquidity | DEX | Notes |
|------|-----------|-----|-------|
| OMNOM / WWDOGE | $145,400 | DogeSwap | Pool address ends `0x5bf60e...8a6c` |
| DC / WWDOGE | $97,500 | DogeSwap | — |
| DINU / WWDOGE | $43,900 | DogeSwap | — |
| DC / WETH | $897 | Ethereum | Uniswap V3, 1% fee tier, $45 24h vol |

---

## 10. DeFi Landscape — Dogechain

| Protocol | TVL | Share |
|----------|-----|-------|
| DogeSwap | $707,846 | 71.5% |
| KibbleSwap | $84,000 | 8.5% |
| YodeSwap | $65,000 | 6.5% |
| ChewySwap | $30,000 | 3.1% |
| FraxSwap | $29,000 | 2.9% |
| Clever Protocol | $25,000 | 2.5% |

---

## 11. Quick Reference — All Contract Addresses

| Contract | Address |
|----------|---------|
| Chain ID | 2000 |
| WWDOGE | `0xb7ddc6414bf4f5515b52d8bdd69973ae205ff101` |
| DC Token | `0x7B4328c127B85369D9f82ca0503B000D09CF9180` |
| DST-V2 Token | `0x516f30111b5a65003c5f7cb35426eb608656ce01` |
| SwapRouter (V3) | `0x4aE2bD0666c76C7f39311b9B3e39b53C8D7C43Ea` |
| AlgebraFactory | `0xd2480162Aa7F02Ead7BF4C127465446150D58452` |
| PoolDeployer | `0x56c2162254b0e4417288786ee402c2b41d4e181e` |
| DogeSwap V2 Router | `0x5bf60eA5cF2383F407f09CF38378176298238A6C` |
| TokenLockerManagerV1 | `0x016c1D8cf86f60A5382BA5c42D4be960CBd1b868` |
| RPC | https://rpc.dogechain.dog |
| Explorer | https://explorer.dogechain.dog |

---

## 12. Integration Considerations for PumpFinder AI

1. **Primary Router for Integration:** `0x4aE2bD0666c76C7f39311b9B3e39b53C8D7C43Ea` (V3/Algebra) — the active, high-traffic router with 194K+ TXs
2. **Fallback Router:** `0x5bf60eA5cF2383F407f09CF38378176298238A6C` (V2) — legacy, passive but with massive transfer history
3. **Native Gas Token:** WWDOGE at `0xb7ddc6414bf4f5515b52d8bdd69973ae205ff101` is the de-facto Wrapped ETH equivalent
4. **Fee Tiers:** V3 supports 0.01%, 0.05%, 0.30%, 1.00% — check pool fee tier before quoting
5. **Permit Support:** EIP-2612 enabled — can use permit signatures for gasless approvals
6. **Multicall:** Router supports batching via `multicall(bytes[])` — useful for complex swap sequences
7. **V69 Watch:** No contracts found — likely not launched; do not attempt to integrate
8. **Low Volume Caution:** $2K/day 24h volume across the entire chain is extremely thin — integration should include robust slippage and liquidity checks
9. **Explorer API:** BlockScout at https://explorer.dogechain.dog provides indexed contract data and logs for ABI extraction and event monitoring
