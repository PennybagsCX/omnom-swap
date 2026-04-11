# Web3 Integration Design for OMNOM SWAP

## Architecture Strategy
- **Core Libraries:** `wagmi`, `viem`, and `@tanstack/react-query`
- **Connection Strategy:** Custom-built modal logic directly interfacing with `wagmi` hooks to maximize our ability to match the intense dark-mode/neon "Beast Mode" visual aesthetic. We avoid RainbowKit/Web3Modal to prevent styling conflicts.

## Component Breakouts
We will modularize the currently 1300+ line `App.tsx` file into:
- `src/components/Header.tsx` (Contains the Connect Wallet trigger)
- `src/components/SwapScreen.tsx`
- `src/components/PoolsScreen.tsx`
- `src/components/StatsScreen.tsx`
- `src/components/WalletModal.tsx` (Custom styling matching the glassmorphism/neon vibes)
- `src/Web3Provider.tsx` (Wraps the app with Dogechain specifications)

## Smart Contracts & Real Data Flow
- **Network Required**: Dogechain (Chain ID: 2000, RPC: `https://rpc.dogechain.dog`)
- **Primary AMM Router**: DogeSwap V3 / Algebra (`0x4aE2bD0666c76C7f39311b9B3e39b53C8D7C43Ea`)
- **Native Context**: WWDOGE (`0xb7ddc6414bf4f5515b52d8bdd69973ae205ff101`)

**Swap Mechanics**:
- Use `viem` to fetch live token balances.
- Validate allowance using the standard ERC20 `allowance` mapping.
- Execute `approve()` via `wagmi`'s `useWriteContract` if lacking allowance.
- Leverage the V3 Router's `exactInputSingle` / `multicall` with proper slippage tolerance checks to execute logic.

**Error Feedback & Visuals**:
- Transactions reverting or failing will trigger bespoke framer-motion notifications replicating an industrial "system alert" failure look.
