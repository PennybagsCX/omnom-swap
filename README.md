# OmnomSwap - DEX Aggregator on Dogechain

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Build Status](https://img.shields.io/github/actions/workflow/status/ci.yml/badge.svg)](https://github.com/OMNOM-SWAP/omnom-swap/actions)
[![Dogechain](https://img.shields.io/badge/Network-Dogechain-87V第一名?style=flat-square&logo=coindesk)](https://dogechain.dog)

OmnomSwap is a multi-DEX aggregator that scans all active UniswapV2-fork DEXes on [Dogechain](https://dogechain.dog) to find the optimal swap price. It combines an on-chain aggregator contract, an off-chain pathfinder, and a React frontend into a single integrated system.

**Live Demo:** [https://omnomswap.com](https://omnomswap.com) (or use the Vercel deployment linked to this repository)

## Table of Contents

- [Quick Start](#quick-start)
- [Architecture](#architecture)
- [Smart Contract](#smart-contract)
- [Deployment](#deployment)
- [Testing](#testing)
- [Frontend Development](#frontend-development)
- [Project Structure](#project-structure)
- [Security](#security)
- [Contributing](#contributing)
- [License](#license)

---

## Quick Start

```bash
# Clone the repository
git clone https://github.com/OMNOM-SWAP/omnom-swap.git
cd omnom-swap

# Install frontend dependencies
npm install

# Start development server (runs on http://localhost:3000)
npm run dev

# Run smart contract tests (requires Foundry)
forge install
forge test -vvv
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

The aggregator is an ownable, pausable contract that executes pre-computed swap routes across multiple DEXes. It does **not** perform on-chain pathfinding - all routing logic lives off-chain to save gas and maximize flexibility.

**Deployed Address:** `0x88F81031b258A0Fb789AC8d3A8071533BFADeC14` (Dogechain, Chain ID 2000)

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

**Treasury Address:** `0x628f3F4A82791D1d6dEC2Aebe7d648e53fF4FA88`

---

## Dogechain DEX Ecosystem

OmnomSwap aggregates liquidity across **10 Dogechain DEXes**:

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

Edit `.env` with your values:

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

This deploys the contract and registers all 10 DEX routers in a single transaction.

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
- `NEW_TREASURY` - Update the treasury address
- `NEW_FEE_BPS` - Update the protocol fee

### 4. Verify on Explorer

```bash
forge verify-contract <AGGREGATOR_ADDRESS> \
    contracts/OmnomSwapAggregator.sol:OmnomSwapAggregator \
    --chain-id 2000 \
    --watch
```

---

## Testing

### Smart Contract Tests (Foundry)

**149 tests across 6 test suites** covering all contract functionality:

```bash
# Run all tests with verbose output
forge test -vvv

# Run specific test suites
forge test --match-contract OmnomSwapAggregatorTest -vvv
forge test --match-contract FeeDistributionTest -vvv
forge test --match-contract MultiHopRoutingTest -vvv

# Run with gas reporting
forge test --gas-report
```

**Test Coverage:**

| Test File | Tests | Coverage |
|---|---|---|
| `OmnomSwapAggregator.t.sol` | 49 | Deployment, access control, router management, swap execution |
| `FeeDistribution.t.sol` | 22 | Fee calculations at various bps, treasury updates, edge cases |
| `MultiHopRouting.t.sol` | 16 | Multi-hop swaps, cross-DEX routing, split routing, slippage |
| `SwapResilience.t.sol` | Various | Extreme conditions, resilience testing |
| `PathFinder.test.ts` | Various | Off-chain pathfinding logic |
| `poolFetcher.test.ts` | Various | Pool data fetching |

### Frontend Tests (Vitest + Playwright)

```bash
# Run unit tests
npm test

# Run tests in watch mode
npm run test:watch

# Run E2E tests (requires dev server)
npx playwright test
```

### Frontend Build

```bash
npm install
npm run build
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

- **Swap Interface** - Token swapping with real-time price quotes across all DEXes
- **Route Visualization** - Visual display of the optimal swap route
- **Price Comparison** - Side-by-side price comparison across DEXes
- **Liquidity Pools** - View pool TVL, add/remove liquidity on any supported DEX
- **Market Stats** - Live price, volume, FDV, buy/sell ratios, MEXC CEX data
- **Swap History** - On-chain trade feed with pagination
- **Treasury Dashboard** - Protocol fee collection statistics
- **Testing Dashboard** - Contract integration testing UI
- **Wallet Integration** - MetaMask, Coinbase Wallet, Rabby, Trust Wallet, WalletConnect

---

## Project Structure

```
omnom-swap/
├── contracts/
│   ├── OmnomSwapAggregator.sol    # Main aggregator contract
│   ├── interfaces/                 # IERC20, IUniswapV2 Router/Pair/Factory
│   ├── libraries/                  # ReentrancyGuard, SafeERC20
│   └── mocks/                      # Mock contracts for testing
│
├── script/
│   ├── Deploy.s.sol                # Deployment script (deploy + register routers)
│   └── Setup.s.sol                 # Post-deployment configuration script
│
├── test/
│   ├── OmnomSwapAggregator.t.sol  # Core contract tests (49 tests)
│   ├── FeeDistribution.t.sol       # Fee mechanism tests (22 tests)
│   ├── MultiHopRouting.t.sol       # Multi-hop routing tests (16 tests)
│   ├── SwapResilience.t.sol        # Resilience and edge case tests
│   ├── *.test.ts                   # Frontend unit tests (Vitest)
│   └── *.test.ts                   # E2E tests (Playwright)
│
├── src/
│   ├── components/
│   │   ├── SwapScreen.tsx          # Main swap UI
│   │   ├── PoolsScreen.tsx         # Liquidity pool management
│   │   ├── StatsScreen.tsx         # Market statistics
│   │   ├── Header.tsx              # Navigation header
│   │   ├── Footer.tsx              # Footer with links
│   │   └── aggregator/             # Aggregator-specific components
│   │       ├── AggregatorSwap.tsx  # Aggregator swap interface
│   │       ├── PriceComparison.tsx # Cross-DEX price comparison
│   │       ├── RouteVisualization.tsx
│   │       ├── SwapHistory.tsx
│   │       ├── TreasuryDashboard.tsx
│   │       ├── TokenSelector.tsx
│   │       └── TestingDashboard.tsx
│   │
│   ├── hooks/
│   │   ├── useAggregator/          # Aggregator contract hooks
│   │   │   ├── useAggregatorContract.ts
│   │   │   ├── useRoute.ts
│   │   │   ├── useSwap.ts
│   │   │   └── useTokenBalances.ts
│   │   ├── useLiquidity.ts         # Liquidity management
│   │   ├── useOmnomData.ts         # Market data
│   │   ├── useTokenPrices.ts       # Price fetching
│   │   └── useNewPairMonitor.ts    # New pair detection
│   │
│   ├── services/
│   │   └── pathFinder/             # Off-chain optimal routing engine
│   │       ├── index.ts
│   │       ├── poolFetcher.ts
│   │       └── types.ts
│   │
│   ├── lib/
│   │   ├── constants.ts            # Contract addresses, DEX config, ABIs
│   │   ├── format.ts               # Number formatting utilities
│   │   └── web3/                   # Web3 configuration
│   │
│   ├── data/
│   │   └── dogechain-tokens.json   # 100,000+ token list
│   │
│   └── App.tsx                     # Main application component
│
├── docs/
│   ├── FINAL_AUDIT.md              # Final audit report
│   ├── SECURITY_AUDIT.md           # Security audit
│   ├── MEV_PROTECTION_AUDIT.md     # MEV protection analysis
│   ├── PRODUCTION_AUDIT.md         # Production readiness audit
│   └── NEXT_STEPS.md              # Future improvements
│
└── public/
    ├── tokens/                     # Token logos
    └── wallets/                    # Wallet icons
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

- [`FINAL_AUDIT.md`](docs/FINAL_AUDIT.md) - Final comprehensive audit
- [`SECURITY_AUDIT.md`](docs/SECURITY_AUDIT.md) - Security-focused review
- [`MEV_PROTECTION_AUDIT.md`](docs/MEV_PROTECTION_AUDIT.md) - MEV protection analysis
- [`PRODUCTION_AUDIT.md`](docs/PRODUCTION_AUDIT.md) - Production readiness review

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

Please ensure tests pass and linting is clean before submitting PRs.

---

## Tech Stack

- **Smart Contracts:** Solidity 0.8.19, [Foundry](https://book.getfoundry.sh/)
- **Frontend:** React 19, TypeScript, [Vite](https://vitejs.dev/) 6, [Tailwind CSS](https://tailwindcss.com/) 4
- **Web3:** [wagmi](https://wagmi.sh/), [viem](https://viem.sh/)
- **Testing:** Foundry (smart contracts), [Vitest](https://vitest.dev/) (unit), [Playwright](https://playwright.dev/) (E2E)
- **Data:** GeckoTerminal API

---

## License

MIT License - see [LICENSE](LICENSE) for details.

---

## Links

- **Website:** [https://omnomswap.com](https://omnomswap.com)
- **Dogechain Explorer:** [https://explorer.dogechain.dog](https://explorer.dogechain.dog)
- **Contract:** `0x88F81031b258A0Fb789AC8d3A8071533BFADeC14`
- **Treasury:** `0x628f3F4A82791D1d6dEC2Aebe7d648e53fF4FA88`