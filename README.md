# OmnomSwap - DEX Aggregator on Dogechain

OmnomSwap is a multi-DEX aggregator that scans all active UniswapV2-fork DEXes on Dogechain to find the optimal swap price. It combines an on-chain aggregator contract, an off-chain pathfinder, and a React frontend into a single integrated system.

## Deployment

This project auto-deploys to Vercel on every push to the `main` branch. The production deployment is available at the Vercel project linked to this repository.

## Architecture

OmnomSwap has three layers:

1. **On-chain Aggregator Contract** (`contracts/OmnomSwapAggregator.sol`) - Receives pre-computed routes from the off-chain pathfinder and atomically executes multi-DEX, multi-hop swaps with protocol fee deduction and slippage protection.

2. **Off-chain Path Finder** (`src/services/pathFinder/`) - A TypeScript module that fetches pair reserves via RPC, builds a liquidity graph, and computes optimal routing using modified Dijkstra/Bellman-Ford algorithms.

3. **Frontend Dashboard** (`src/`) - A React 19 UI that presents the swap interface, route visualization, price comparisons across DEXes, swap history, and treasury statistics.

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

## Smart Contract

### OmnomSwapAggregator

The aggregator is an ownable, pausable contract that executes pre-computed swap routes across multiple DEXes. It does **not** perform on-chain pathfinding - all routing logic lives off-chain to save gas and maximize flexibility.

**Key features:**
- Multi-hop, multi-DEX swap execution
- Protocol fee deduction (configurable, max 5%)
- Slippage protection (per-step and overall)
- Deadline protection against pending transactions
- Emergency pause functionality
- ERC20 token rescue for stuck funds
- Reentrancy guard on swap execution

**Contract functions:**

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

**Data structures:**

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

Default fee: **25 basis points (0.25%)**, configurable up to 500 bps (5%).

## Dogechain DEX Ecosystem

OmnomSwap aggregates liquidity across 5 Dogechain DEXes:

| DEX | Router Address | Type |
|---|---|---|
| DogeSwap V2 | `0xa4EE06Ce40cb7e8c04E127c1F7D3dFB7F7039C81` | UniswapV2 (WDOGE) |
| DogeShrk (Chewyswap) | `0x45AFCf57F7e3F3B9cA70335E5E85e4F77DcC5087` | UniswapV2 (ETH) |
| WOJAK Finance | `0x9695906B4502D5397E6D21ff222e2C1a9e5654a9` | UniswapV2 (ETH) |
| KibbleSwap | `0x6258c967337D3faF0C2ba3ADAe5656bA95419d5f` | UniswapV2 (ETH) |
| YodeSwap | `0x72d85Ab47fBfc5E7E04a8bcfCa1601D8f8cE1a50` | UniswapV2 (ETH) |

All DEXes use UniswapV2-compatible contracts. DogeSwap uses WDOGE-specific function names (`swapExactWDOGEForTokens`), while the others use standard ETH naming (`swapExactETHForTokens`).

### Supported Tokens

| Token | Address |
|---|---|
| WWDOGE (Wrapped Doge) | `0xb7ddc6414bf4f5515b52d8bdd69973ae205ff101` |
| OMNOM (DogeEatDoge) | `0xe3fca919883950c5cd468156392a6477ff5d18de` |
| DC (DogeChain Token) | `0x7B4328c127B85369D9f82ca0503B000D09CF9180` |
| DINU (Doge Inu) | `0x8a764cf73438de795c98707b07034e577af54825` |

## Deployment

### Prerequisites

- [Foundry](https://book.getfoundly.sh/) installed (`curl -L https://foundry.paradigm.xyz | bash`)
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

This deploys the contract and registers all 5 DEX routers in a single transaction.

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

## Testing

### Smart Contract Tests (Foundry)

87 tests across 3 test suites covering all contract functionality:

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

**Test coverage:**
- `OmnomSwapAggregator.t.sol` (49 tests) - Deployment, access control, router management, swap execution, pause/unpause, token rescue
- `FeeDistribution.t.sol` (22 tests) - Fee calculations at various bps, treasury updates, edge cases
- `MultiHopRouting.t.sol` (16 tests) - Multi-hop swaps, cross-DEX routing, split routing, slippage protection

### Frontend Build

```bash
npm install
npm run build
```

## Frontend Development

```bash
# Install dependencies
npm install

# Start dev server on http://localhost:5173
npm run dev

# Type checking
npm run lint

# Production build
npm run build
```

### Frontend Features

- **Swap Interface** - Token swapping with real-time price quotes across all DEXes
- **Route Visualization** - Visual display of the optimal swap route
- **Price Comparison** - Side-by-side price comparison across DEXes
- **Liquidity Pools** - View pool TVL, add/remove liquidity on any supported DEX
- **Market Stats** - Live price, volume, FDV, buy/sell ratios, MEXC CEX data
- **Swap History** - On-chain trade feed with pagination
- **Treasury Dashboard** - Protocol fee collection statistics
- **Testing Dashboard** - Contract integration testing UI
- **Wallet Integration** - MetaMask and compatible wallets via wagmi/viem

## Project Structure

```
contracts/
  OmnomSwapAggregator.sol       # Main aggregator contract
  interfaces/                    # IERC20, IUniswapV2 Router/Pair/Factory
  libraries/                     # ReentrancyGuard, SafeERC20
  mocks/                         # Mock contracts for testing

script/
  Deploy.s.sol                   # Deployment script (deploy + register routers)
  Setup.s.sol                    # Post-deployment configuration script

test/
  OmnomSwapAggregator.t.sol      # Core contract tests (49 tests)
  FeeDistribution.t.sol          # Fee mechanism tests (22 tests)
  MultiHopRouting.t.sol          # Multi-hop routing tests (16 tests)

src/
  components/
    SwapScreen.tsx               # Main swap UI
    PoolsScreen.tsx              # Liquidity pool management
    StatsScreen.tsx              # Market statistics
    aggregator/                  # Aggregator-specific components
      AggregatorSwap.tsx         # Aggregator swap interface
      PriceComparison.tsx        # Cross-DEX price comparison
      RouteVisualization.tsx     # Swap route visualization
      SwapHistory.tsx            # Transaction history
      TreasuryDashboard.tsx      # Fee statistics
  hooks/
    useAggregator/               # Aggregator contract hooks
    useLiquidity.ts              # Liquidity management
    useOmnomData.ts              # Market data
  lib/
    constants.ts                 # Contract addresses, DEX config, ABIs
    web3/                        # Web3 configuration
  services/
    pathFinder/                  # Off-chain optimal routing engine

docs/plans/
  architecture.md                # Full architecture document
```

## Security Considerations

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

## Network

The app targets **Dogechain** (Chain ID 2000, RPC: `https://rpc.dogechain.dog`). Make sure your wallet is connected to the Dogechain network.

## Tech Stack

- **Smart Contracts:** Solidity 0.8.19, Foundry
- **Frontend:** React 19, TypeScript, Vite, Tailwind CSS
- **Web3:** wagmi, viem
- **Data:** GeckoTerminal API

## License

MIT
