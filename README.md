# OmnomSwap — DEX Aggregator on Dogechain

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Tests: 573 passing](https://img.shields.io/badge/Tests-573%20passing-brightgreen)]()
[![Coverage: 98.41%](https://img.shields.io/badge/Coverage-98.41%25-brightgreen)]()
[![Dogechain](https://img.shields.io/badge/Network-Dogechain-87CEEB?style=flat-square)](https://dogechain.dog)

OmnomSwap is a multi-DEX aggregator on [Dogechain](https://dogechain.dog) (Chain ID 2000) that routes swaps across **12 DEXes** for optimal pricing. It combines an on-chain aggregator contract, an off-chain pathfinder, and a React frontend into a single integrated system.

**Live Demo:** [https://omnom-swap.vercel.app](https://omnom-swap.vercel.app)

## Table of Contents

- [Quick Start](#quick-start)
- [Architecture](#architecture)
- [Smart Contract](#smart-contract)
- [Test Suite](#test-suite)
- [Gas Benchmarks](#gas-benchmarks)
- [Dogechain DEX Ecosystem](#dogechain-dex-ecosystem)
- [Deployment](#deployment)
- [Frontend Development](#frontend-development)
- [Project Structure](#project-structure)
- [Security](#security)
- [Contributing](#contributing)
- [Tech Stack](#tech-stack)
- [License](#license)
- [Links](#links)

---

## Quick Start

```bash
# Clone the repository
git clone https://github.com/PennybagsCX/omnom-swap.git
cd omnom-swap

# Install frontend dependencies
npm install

# Start development server (http://localhost:3000)
npm run dev
```

### Smart Contract Development

```bash
forge install                    # Install Foundry dependencies
forge build                      # Compile contracts
forge test -vv                   # Run all 573 tests
forge test --summary             # Summary view
forge coverage --ir-minimum      # Coverage report (98.41%)
forge snapshot                   # Gas snapshots
```

**Prerequisites:**
- [Foundry](https://foundry.paradigm.xyz/) for smart contract development
- Node.js 18+ for the frontend
- A wallet with DOGE on Dogechain for gas

---

## Architecture

OmnomSwap has three layers:

### 1. On-chain Aggregator Contract ([`contracts/OmnomSwapAggregator.sol`](contracts/OmnomSwapAggregator.sol))
Receives pre-computed routes from the off-chain pathfinder and atomically executes multi-DEX, multi-hop swaps with protocol fee deduction and slippage protection.

### 2. Off-chain Path Finder ([`src/services/pathFinder/`](src/services/pathFinder/))
A TypeScript module that fetches pair reserves via RPC, builds a liquidity graph, and computes optimal routing using modified Dijkstra/Bellman-Ford algorithms.

### 3. Frontend Dashboard ([`src/`](src/))
A React 19 UI that presents the swap interface, route visualization, price comparisons across DEXes, swap history, and treasury statistics.

### Data Flow

```
User -> Frontend -> Path Finder -> Reserve Fetcher -> DEX Pools
                                              |
                              Optimal Route <- Path Finder Engine
                                              |
                     Encoded Calldata <- Calldata Encoder
                                              |
                     Frontend -> OmnomSwapAggregator -> Fee -> Treasury
                                                        |
                                                   DEX Routers
                                                        |
                                                   User receives tokens
```

---

## Smart Contract

### OmnomSwapAggregator

The aggregator is an ownable, pausable contract that executes pre-computed swap routes across multiple DEXes. It does **not** perform on-chain pathfinding — all routing logic lives off-chain to save gas and maximize flexibility.

**Deployed Address:** [`0xb6eae524325cc31bb0f3d9af7bb63b4dc991b58a`](https://explorer.dogechain.dog/address/0xb6eae524325cc31bb0f3d9af7bb63b4dc991b58a) (Dogechain, Chain ID 2000)

**Key Features:**
- Multi-hop, multi-DEX swap execution
- Protocol fee deduction (configurable, max 5%)
- Slippage protection (per-step and overall)
- Deadline protection against pending transactions
- Emergency pause functionality
- ERC20 token rescue for stuck funds
- Reentrancy guard on swap execution

**Contract Functions:**

| Function | Access | Description |
|---|---|---|
| `executeSwap(SwapRequest)` | User | Execute a multi-step swap |
| `addRouter(address)` | Owner | Register a DEX router |
| `removeRouter(address)` | Owner | Deregister a DEX router |
| `setTreasury(address)` | Owner | Update fee recipient |
| `setProtocolFee(uint256)` | Owner | Update fee (max 500 bps) |
| `pause()` | Owner | Emergency pause |
| `unpause()` | Owner | Resume operations |
| `rescueTokens(address, uint256)` | Owner | Recover stuck tokens |

**Data Structures:**

```solidity
struct SwapStep {
    address router;       // DEX router to call
    address[] path;       // Token path (e.g., [WWDOGE, OMNOM])
    uint256 amountIn;     // Input amount
    uint256 minAmountOut; // Slippage protection
}

struct SwapRequest {
    address tokenIn;
    address tokenOut;
    uint256 amountIn;
    uint256 minTotalAmountOut;
    SwapStep[] steps;
    uint256 deadline;
    address recipient;
}
```

### Fee Distribution

Protocol fees are deducted from the input token before swap execution:

1. User sends `amountIn` tokens to the aggregator
2. Fee = `amountIn * protocolFeeBps / 10000` is sent to the treasury
3. Remaining `amountIn - fee` is used for the swap route
4. Output tokens are sent directly to the user

**Default fee:** 25 basis points (0.25%), configurable up to 500 bps (5%)

---

## Test Suite

The smart contract test suite provides comprehensive coverage across all swap mechanics, edge cases, and attack vectors.

### Statistics

| Metric | Value |
|---|---|
| **Total Tests** | 573 |
| **Test Suites** | 33 |
| **Pass Rate** | 100% (all passing) |
| **Line Coverage** | 98.41% (124/126 lines) |
| **Function Coverage** | 100% (16/16 functions) |
| **Determinism** | Verified across multiple runs |

> **Note:** The 2 uncovered lines are IR source mapping artifacts, not reachable code paths.

### Test Categories

| Category | Description |
|---|---|
| **Core Swap Mechanics** | Standard swaps, multi-step execution, balance assertions |
| **Multi-hop Routing** | Routing through WWDOGE, DC, and OMNOM intermediaries |
| **Fee Distribution** | Fee calculations at various bps, treasury updates, edge cases |
| **Slippage Boundaries** | Per-step and overall slippage enforcement |
| **MEV Protection** | Front-running resistance and sandwich attack mitigation |
| **Flash Loan Attack Simulation** | Flash loan-based price manipulation resistance |
| **Network Congestion** | Behavior under simulated high-latency conditions |
| **Liquidity Drain** | Graceful handling of depleted pool scenarios |
| **Gas Optimization** | Regression guards preventing gas cost increases |
| **Fuzz Testing** | Property-based testing with random inputs |
| **Invariant Verification** | Protocol invariants hold across all operations |
| **Admin Functions** | Refund, rescue, ownership transfer, timelock, pause |
| **Cross-chain Bridge** | Bridge adapter simulation and failure handling |
| **RPC Failure Handling** | Graceful degradation on RPC errors |
| **Router Failure Handling** | Swap continuation when individual routers fail |
| **Mainnet Fork E2E** | End-to-end tests against forked mainnet state |

### Token Types Tested (20)

The test suite validates swap behavior across 20 distinct token types to ensure robust handling of real-world ERC20 variations:

| # | Token Type | Edge Case Covered |
|---|---|---|
| 1 | Standard ERC20 | Baseline swap behavior |
| 2 | Fee-on-transfer | Balance diff accounting for transfer fees |
| 3 | Dynamic fee | Variable fee rates between transfers |
| 4 | Rebasing | Balance changes independent of transfers |
| 5 | Deflationary (burn-on-transfer) | Supply reduction during swap |
| 6 | Inflationary (mint-on-transfer) | Supply increase during swap |
| 7 | WWDOGE / Wrapped native | Native token wrapping/unwrapping |
| 8 | Native DOGE | Direct DOGE send with ETH-style routers |
| 9 | Bridged tokens | Cross-chain bridge adapter integration |
| 10 | LP tokens | Liquidity provider token handling |
| 11 | Permit2-enabled (EIP-2612) | Gasless approval via permits |
| 12 | DOG20 (Dogechain standard) | Dogechain-specific token standard |
| 13 | USDT-style (non-standard approve) | Zero-then-approve pattern requirement |
| 14 | 0-decimal | Tokens with no decimal precision |
| 15 | 6-decimal | Stablecoin-style decimal precision |
| 16 | Empty return bytes | Missing return data from transfer |
| 17 | Reverting transfers | Transfer calls that revert |
| 18 | Blocklist tokens | Tokens with transfer restrictions |
| 19 | Pausable tokens | Tokens with pause functionality |
| 20 | Upgradeable tokens | Proxy-pattern token contracts |

### Mock Contracts (17 test-only)

All mock contracts are located in [`contracts/mocks/`](contracts/mocks/) and are used exclusively for testing:

| Mock Contract | Simulates |
|---|---|
| [`MockERC20`](contracts/mocks/MockERC20.sol) | Standard ERC20 token |
| [`MockFeeOnTransferToken`](contracts/mocks/MockFeeOnTransferToken.sol) | Fee-on-transfer token |
| [`MockRebasingToken`](contracts/mocks/MockRebasingToken.sol) | Rebasing balance token |
| [`MockDynamicFeeToken`](contracts/mocks/MockDynamicFeeToken.sol) | Variable transfer fee token |
| [`MockWWDOGE`](contracts/mocks/MockWWDOGE.sol) | Wrapped native token |
| [`MockUniswapV2Router`](contracts/mocks/MockUniswapV2Router.sol) | DEX router |
| [`MockFailingRouter`](contracts/mocks/MockFailingRouter.sol) | Router that reverts on swap |
| [`MockBridgeAdapter`](contracts/mocks/MockBridgeAdapter.sol) | Cross-chain bridge adapter |
| [`MockBurnOnTransferToken`](contracts/mocks/MockBurnOnTransferToken.sol) | Deflationary token |
| [`MockUSDTStyleToken`](contracts/mocks/MockUSDTStyleToken.sol) | Non-standard approve token |
| [`MockEmptyReturnToken`](contracts/mocks/MockEmptyReturnToken.sol) | Token with no return data |
| [`MockBlocklistToken`](contracts/mocks/MockBlocklistToken.sol) | Blocklist-restricted token |
| [`MockInflationaryToken`](contracts/mocks/MockInflationaryToken.sol) | Mint-on-transfer token |
| [`MockPermit2Token`](contracts/mocks/MockPermit2Token.sol) | EIP-2612 permit token |
| [`MockPausableToken`](contracts/mocks/MockPausableToken.sol) | Pausable token |
| [`MockDOG20Token`](contracts/mocks/MockDOG20Token.sol) | Dogechain standard token |
| [`MockUpgradeableToken`](contracts/mocks/MockUpgradeableToken.sol) | Upgradeable proxy token |

### Test Commands

```bash
# Run all 573 tests with verbose output
forge test -vv

# Summary view
forge test --summary

# Run specific test suites
forge test --match-contract OmnomSwapAggregatorTest -vvv
forge test --match-contract ComprehensiveRoutesTest -vvv
forge test --match-contract ExtremeConditionsTest -vvv

# Coverage report
forge coverage --ir-minimum

# Gas snapshots
forge snapshot

# Gas report
forge test --gas-report
```

### Frontend Tests (Vitest + Playwright)

```bash
# Run unit tests
npm test

# Run tests in watch mode
npm run test:watch

# Run E2E tests (requires dev server)
npx playwright test
```

---

## Gas Benchmarks

Gas costs scale linearly with the number of hops, enabling predictable cost estimation for any route length.

| Route | Gas Cost |
|---|---|
| 1-hop | ~211,799 gas |
| 2-hop | ~294,347 gas |
| 3-hop | ~377,479 gas |
| 4-hop | ~460,064 gas |

| Metric | Value |
|---|---|
| **Per-hop scaling** | ~82,500 gas (linear) |
| **Native DOGE overhead** | +2,877 gas |
| **Fee-on-transfer overhead** | +19% |

---

## Dogechain DEX Ecosystem

OmnomSwap aggregates liquidity across **12 Dogechain DEXes**:

| DEX | Router Address | Type |
|---|---|---|
| DogeSwap V2 | `0xa4EE06Ce40cb7e8c04E127c1F7D3dFB7F7039C81` | UniswapV2 (WDOGE) |
| DogeShrk (Chewyswap) | `0x45AFCf57F7e3F3B9cA70335E5E85e4F77DcC5087` | UniswapV2 (ETH) |
| WOJAK Finance | `0x9695906B4502D5397E6D21ff222e2C1a9e5654a9` | UniswapV2 (ETH) |
| KibbleSwap | `0x6258c967337D3faF0C2ba3ADAe5656bA95419d5f` | UniswapV2 (ETH) |
| YodeSwap | `0x72d85Ab47fBfc5E7E04a8bcfCa1601D8f8cE1a50` | UniswapV2 (ETH) |
| FraxSwap | `0x0f6A5c5F341791e897eB1FB8fE8B4e30EC4F9bDf` | UniswapV2 (ETH) |
| ToolSwap | `0x9BBF70e64fbe8Fc7afE8a5Ae90F2DB1165013F93` | UniswapV2 (ETH) |
| IceCreamSwap | `0xBb5e1777A331ED93E07cF043363e48d320eb96c4` | UniswapV2 (ETH) |
| PupSwap | `0x05F2a20AF837268Be340a3bF82BB87069cF4a8C3` | UniswapV2 (ETH) |
| Bourbon Defi | `0x6B172911a5Af8C9Eb2B7759688204624CcC9b0Ee` | UniswapV2 (ETH) |
| BreadFactory | — | UniswapV2 |
| SwapX | — | UniswapV2 |

All DEXes use UniswapV2-compatible contracts. DogeSwap uses WDOGE-specific function names (`swapExactWDOGEForTokens`), while the others use standard ETH naming (`swapExactETHForTokens`).

### Supported Tokens

The protocol supports **100,000+ tokens** on Dogechain. The full token list is maintained in [`src/data/dogechain-tokens.json`](src/data/dogechain-tokens.json).

**Key Tokens:**

| Token | Symbol | Address |
|---|---|---|
| Wrapped Doge | WWDOGE | `0xb7ddc6414bf4f5515b52d8bdd69973ae205ff101` |
| DogeEatDoge | OMNOM | `0xe3fca919883950c5cd468156392a6477ff5d18de` |
| DogeChain Token | DC | `0x7B4328c127B85369D9f82ca0503B000D09CF9180` |
| Doge Inu | DINU | `0x8a764cf73438de795c98707b07034e577af54825` |

---

## Deployment

### Prerequisites

- [Foundry](https://foundry.paradigm.xyz/) installed (`curl -L https://foundry.paradigm.xyz | bash`)
- Node.js 18+
- A wallet with DOGE on Dogechain for gas

### 1. Configure Environment

```bash
cp .env.example .env
```

Edit `.env` with your values (see [`.env.example`](.env.example) for reference):

```bash
PRIVATE_KEY=your_private_key_here          # Deployer wallet private key
TREASURY_ADDRESS=0x...                     # Address to receive protocol fees
PROTOCOL_FEE_BPS=25                        # Fee in basis points (25 = 0.25%)
DOGCHAIN_RPC_URL=https://rpc.dogechain.dog # Dogechain RPC endpoint
```

### 2. Deploy the Aggregator

```bash
source .env
forge script script/Deploy.s.sol:DeployAggregator \
    --rpc-url dogechain \
    --broadcast \
    -vvvv
```

This deploys the contract and registers all DEX routers in a single transaction.

### 3. Post-Deployment Setup (Optional)

To update configuration on an already-deployed aggregator:

```bash
# In .env, set AGGREGATOR_ADDRESS to the deployed address
source .env
forge script script/Setup.s.sol:SetupAggregator \
    --rpc-url dogechain \
    --broadcast \
    -vvvv
```

Optional environment variables for setup:
- `NEW_TREASURY` — Update the treasury address
- `NEW_FEE_BPS` — Update the protocol fee

### 4. Verify on Explorer

```bash
forge verify-contract <AGGREGATOR_ADDRESS> \
    contracts/OmnomSwapAggregator.sol:OmnomSwapAggregator \
    --chain-id 2000 \
    --watch
```

---

## Frontend Development

```bash
# Install dependencies
npm install

# Start dev server on http://localhost:3000
npm run dev

# Type checking
npm run lint

# Production build
npm run build
```

### Features

- **Swap Interface** — Token swapping with real-time price quotes across all DEXes
- **Route Visualization** — Visual display of the optimal swap route with hop-by-hop breakdown
- **Price Comparison** — Side-by-side price comparison across DEXes
- **Liquidity Pools** — View pool TVL, add/remove liquidity on any supported DEX
- **Market Stats** — Live price, volume, FDV, buy/sell ratios, MEXC CEX data
- **Swap History** — On-chain trade feed with pagination
- **Treasury Dashboard** — Protocol fee collection statistics
- **Token Safety** — Honeypot detection, tax analysis, warning banners for risky tokens
- **Auto Slippage** — Dynamic slippage calculation based on price impact, hops, pool depth, and token taxes
- **Monitoring** — Real-time swap monitoring overlay with alerts
- **Wallet Integration** — MetaMask, Coinbase Wallet, Rabby, Trust Wallet, WalletConnect

---

## Project Structure

```
omnom-swap/
├── contracts/
│   ├── OmnomSwapAggregator.sol       # Main aggregator contract
│   ├── interfaces/                    # IERC20, IUniswapV2 Router/Pair/Factory
│   ├── libraries/                     # ReentrancyGuard, SafeERC20
│   └── mocks/                         # 17 mock contracts for testing
│
├── script/
│   ├── Deploy.s.sol                   # Deployment script (deploy + register routers)
│   ├── Setup.s.sol                    # Post-deployment configuration script
│   └── AddBreadFactory.s.sol          # Add BreadFactory as token source
│
├── test/                              # 573 tests across 33 suites
│   ├── OmnomSwapAggregator.t.sol      # Core contract tests
│   ├── ComprehensiveRoutes.t.sol      # Route coverage tests
│   ├── ExtremeConditions.t.sol        # Stress & security tests
│   ├── FeeDistribution.t.sol          # Fee mechanism tests
│   ├── FlipSwapConsistency.t.sol      # Flip/swap consistency tests
│   ├── MultihopIntermediary.t.sol     # Multi-hop intermediary routing
│   ├── NativeDogeSwap.t.sol           # Native DOGE swap tests
│   ├── FeeOnTransferStep0.t.sol       # Fee-on-transfer tests
│   ├── AdvancedFeeOnTransfer.t.sol    # Advanced fee-on-transfer scenarios
│   ├── AdminFunctions.t.sol           # Admin/refund/rescue tests
│   ├── CoverageGap.t.sol              # Coverage gap closure tests
│   ├── FlashLoanAttack.t.sol          # Flash loan attack simulation
│   ├── FuzzTesting.t.sol              # Property-based fuzz tests
│   ├── GasOptimization.t.sol          # Gas regression guards
│   ├── InflationaryToken.t.sol        # Inflationary token tests
│   ├── LiquidityDrain.t.sol           # Liquidity drain scenarios
│   ├── MainnetForkE2E.t.sol           # Mainnet fork end-to-end tests
│   ├── MEVProtection.t.sol            # MEV protection tests
│   ├── NetworkCongestion.t.sol        # Network congestion simulation
│   ├── Permit2Token.t.sol             # EIP-2612 permit token tests
│   ├── RebasingToken.t.sol            # Rebasing token tests
│   ├── RPCFailure.t.sol               # RPC failure handling tests
│   ├── SlippageBoundaries.t.sol       # Slippage boundary tests
│   └── *.test.ts                      # Frontend unit tests (Vitest)
│
├── src/
│   ├── components/
│   │   ├── SwapScreen.tsx             # Main swap UI
│   │   ├── PoolsScreen.tsx            # Liquidity pool management
│   │   ├── LiquidityModal.tsx         # Add/remove liquidity modal
│   │   ├── MonitorOverlay.tsx         # Real-time swap monitoring
│   │   └── aggregator/                # Aggregator-specific components
│   │       ├── AggregatorSwap.tsx     # Aggregator swap interface
│   │       ├── PriceComparison.tsx    # Cross-DEX price comparison
│   │       ├── RouteVisualization.tsx
│   │       ├── RouteComparisonCard.tsx
│   │       ├── TokenSelector.tsx
│   │       ├── TokenWarningBanner.tsx
│   │       ├── EducationPanel.tsx
│   │       ├── SwapHistory.tsx
│   │       └── TreasuryDashboard.tsx
│   │
│   ├── hooks/
│   │   ├── useAggregator/             # Aggregator contract hooks
│   │   │   ├── useAggregatorContract.ts
│   │   │   ├── useRoute.ts
│   │   │   ├── useSwap.ts
│   │   │   ├── usePreFlightValidation.ts
│   │   │   ├── useReverseRoute.ts
│   │   │   └── useTokenBalances.ts
│   │   ├── useAutoSlippage.ts         # Dynamic slippage calculation
│   │   ├── useDynamicSlippage.ts      # TVL-aware slippage
│   │   ├── useGasEstimate.ts          # Gas estimation with debouncing
│   │   ├── useLiquidity.ts            # Liquidity management
│   │   ├── useOmnomData.ts            # Market data
│   │   ├── useTokenPrices.ts          # Price fetching
│   │   └── useTokenTax.ts             # Token tax/honeypot detection
│   │
│   ├── services/
│   │   ├── pathFinder/                # Off-chain optimal routing engine
│   │   │   ├── index.ts
│   │   │   ├── poolFetcher.ts
│   │   │   └── types.ts
│   │   ├── monitoring/                # Real-time swap monitoring
│   │   ├── poolScanner/               # Pool discovery & indexing
│   │   ├── taxDetection.ts            # Token tax detection
│   │   └── liquidityFilter.ts         # Pool liquidity filtering
│   │
│   ├── utils/
│   │   ├── addressValidation.ts       # Address checksumming & validation
│   │   ├── errors.ts                  # Typed error classes (SwapError, etc.)
│   │   ├── logger.ts                  # Environment-aware logging
│   │   └── rateLimiter.ts             # Rate limiting for API/RPC calls
│   │
│   ├── lib/
│   │   ├── constants.ts               # Contract addresses, DEX config, ABIs
│   │   ├── format.ts                  # Number formatting utilities
│   │   └── web3/                      # Web3 configuration
│   │
│   ├── data/
│   │   └── dogechain-tokens.json      # 100,000+ token list
│   │
│   └── App.tsx                        # Main application component
│
├── docs/
│   ├── FINAL_AUDIT.md                 # Final comprehensive audit
│   ├── SECURITY_AUDIT.md              # Security-focused review
│   ├── MEV_PROTECTION_AUDIT.md        # MEV protection analysis
│   ├── PRODUCTION_AUDIT.md            # Production readiness review
│   ├── PRE_DEPLOYMENT_AUDIT.md        # Pre-deployment checklist
│   ├── BREADFACTORY_AUDIT.md          # BreadFactory integration audit
│   ├── PRICE_IMPACT_AUDIT.md          # Price impact calculation audit
│   ├── SEC_COMPLIANCE_AUDIT.md        # SEC compliance review
│   ├── REFUND_USER_DEPLOYMENT.md      # Refund mechanism documentation
│   ├── SWAP_FAILURE_ANALYSIS.md       # Swap failure analysis
│   ├── TEST_COVERAGE_REPORT.md        # Detailed test coverage report
│   └── NEXT_STEPS.md                  # Future improvements
│
└── public/
    ├── tokens/                        # Token logos
    └── wallets/                       # Wallet icons
```

---

## Security

### Security Considerations

| Concern | Mitigation |
|---|---|
| Reentrancy | `ReentrancyGuard` modifier on `executeSwap` |
| Slippage | Two layers: per-step `minAmountOut` and overall `minTotalAmountOut` |
| Deadline | `block.timestamp <= deadline` prevents stale execution |
| Unauthorized routers | Only whitelisted routers can be called |
| Fee manipulation | Hard cap of 500 bps (5%) enforced in contract |
| Fund recovery | `rescueTokens` for recovering stuck ERC20s |
| Emergency stop | Owner can pause/unpause all swaps |
| Approval safety | Approvals reset to 0 after each swap step |

### Audits

The project has undergone multiple security audits. See [`docs/`](docs/) for detailed reports:

- [`FINAL_AUDIT.md`](docs/FINAL_AUDIT.md) — Final comprehensive audit
- [`SECURITY_AUDIT.md`](docs/SECURITY_AUDIT.md) — Security-focused review
- [`MEV_PROTECTION_AUDIT.md`](docs/MEV_PROTECTION_AUDIT.md) — MEV protection analysis
- [`PRODUCTION_AUDIT.md`](docs/PRODUCTION_AUDIT.md) — Production readiness review
- [`PRE_DEPLOYMENT_AUDIT.md`](docs/PRE_DEPLOYMENT_AUDIT.md) — Pre-deployment checklist
- [`SEC_COMPLIANCE_AUDIT.md`](docs/SEC_COMPLIANCE_AUDIT.md) — SEC compliance review

### Network

The app targets **Dogechain** (Chain ID 2000, RPC: `https://rpc.dogechain.dog`). Make sure your wallet is connected to the Dogechain network.

---

## Contributing

Contributions are welcome! Please follow these steps:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

Please ensure all 573 tests pass and linting is clean before submitting PRs:

```bash
forge test -vv          # All smart contract tests
npm test                # Frontend tests
npm run lint            # Linting
```

---

## Tech Stack

- **Smart Contracts:** Solidity 0.8.19, [Foundry](https://book.getfoundry.sh/)
- **Frontend:** React 19, TypeScript, [Vite](https://vitejs.dev/) 6, [Tailwind CSS](https://tailwindcss.com/) 4
- **Web3:** [wagmi](https://wagmi.sh/), [viem](https://viem.sh/)
- **Testing:** Foundry (smart contracts), [Vitest](https://vitest.dev/) (unit), [Playwright](https://playwright.dev/) (E2E)
- **Data:** GeckoTerminal API

---

## License

MIT License — see [LICENSE](LICENSE) for details.

---

## Links

- **Website:** [https://omnom-swap.vercel.app](https://omnom-swap.vercel.app)
- **Dogechain Explorer:** [https://explorer.dogechain.dog](https://explorer.dogechain.dog)
- **Contract:** [`0xb6eae524325cc31bb0f3d9af7bb63b4dc991b58a`](https://explorer.dogechain.dog/address/0xb6eae524325cc31bb0f3d9af7bb63b4dc991b58a)
