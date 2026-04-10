# $OMNOM SWAP MVP Design Document

## 1. Overview
The $OMNOM Swap platform is a decentralized exchange (DEX) frontend targeted toward the Dogechain or a compatible EVM network. It features an aggressive, high-energy "Beast Mode" aesthetic with a highly interactive user experience. This document outlines the design for restructuring the single-file React mockup located in `CONCEPT/Google AI Studio/src/App.tsx` into a scalable, production-ready DApp.

## 2. Architecture & Tech Stack
- **Framework**: Vite + React (TypeScript) for a highly interactive, lightweight Single Page Application (SPA).
- **Web3 Integration**: 
  - `wagmi` for reactive React hooks covering wallet connection, contract interaction, and network state.
  - `viem` for robust low-level Ethereum primitives and RPC communication.
- **Styling**: Tailwind CSS, encapsulating the custom neon/industrial design tokens found in the mock UI.
- **Project Structure**: Scaffolded in a separate `/frontend` directory to keep it cleanly isolated from the `.agent` and other CLI tool directories in the root.

## 3. Component Breakdown

The monolithic `App.tsx` mockup will be decomposed into the following modular structure:

### `src/components/`
- **`layout/`**
  - `Header.tsx`: Navigation tabs, Network Status, and Wallet Connect button.
  - `Footer.tsx`: Social links and branding.
- **`ui/`** (Reusable elements)
  - `NeonButton.tsx`: The primary call-to-action button with custom hover shapes.
  - `GlassPanel.tsx`: Translucent backgrounds for swap/pool cards.
  - `TokenSelectModal.tsx`: Searchable list for token selection.

### `src/screens/`
- **`SwapScreen/`**
  - `SwapCard.tsx`: Input amounts, slippage settings, rate display, and swap execution.
- **`PoolsScreen/`**
  - `PoolItem.tsx`: Generic bento box wrapper displaying APY, TVL, and "Feed the Pool".
  - `LiquidityModal.tsx`: Interface to add/remove liquidity.
- **`StatsScreen/`**
  - `DashboardMetrics.tsx`: "Aggregated Combustion" dashboards and analytics.

### `src/hooks/`
- `useSwap.ts`: Encapsulates Wagmi's `useWriteContract` and `useSimulateContract` interactions with the DEX Router.
- `usePricing.ts`: Mock and real-time polling of current liquidity pool reserves and exchange rates.

## 4. Data Flow & State Management
- **Wallet Connection**: Managed globally via Wagmi's `WagmiConfig` and `QueryClientProvider` at the root `<App />` level.
- **App State**: React Context or lightweight Zustand store to manage the globally active tab (Swap vs Pools vs Stats) if not handled entirely via URL routing (e.g. React Router).
- **Smart Contracts**: 
  - During MVP, we define the standard ABIs for an ERC20 (Tokens) and standard AMM Router / Factory inside `src/abis/`.
  - For immediate end-to-end functionality, local Anvil or Testnet addresses are mapped; otherwise, Wagmi's `mock` connectors will be used to simulate wallet signatures.

## 5. Security & Verification
- **Testing (`Vitest`)**: Component tests will verify input formatting, adequate balance validation, and correct rendering of complex UI logic.
- **Contract Verification Check**: The UI MUST prevent transactions when Slippage exceeds standard thresholds or User Balance is insufficient.

## 6. Execution Plan
The next step is to invoke the `writing-plans` skill to expand this into a granular, step-by-step task list for implementation.
