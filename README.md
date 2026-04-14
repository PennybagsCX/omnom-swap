# OMNOM SWAP

A decentralized token swap interface built on Dogechain. Swap OMNOM, WWDOGE, DC, DINU, and other Dogechain tokens through on-chain liquidity pools.

## Features

- **Token Swapping** — Swap tokens via DogeSwap V2 router with real-time pool reserve pricing
- **Liquidity Pools** — View pool TVL, add/remove liquidity
- **Market Stats** — Live price, volume, FDV, buy/sell ratios, MEXC CEX data
- **Transaction History** — On-chain trade feed with pagination
- **Wallet Integration** — MetaMask and compatible wallets via Wagmi/Viem
- **Network Detection** — Auto-prompts to switch to Dogechain if wrong network

## Tech Stack

- React 19 + TypeScript
- Wagmi / Viem for Ethereum-compatible chain interactions
- Vite for build tooling
- Tailwind CSS for styling
- GeckoTerminal API for market data

## Run Locally

**Prerequisites:** Node.js 18+

1. Install dependencies:
   ```bash
   npm install
   ```
2. Start the dev server:
   ```bash
   npm run dev
   ```
3. Open http://localhost:5173

## Network

The app targets **Dogechain** (Chain ID 2000). Make sure your wallet is connected to the Dogechain network.

## Project Structure

```
src/
  components/     UI components (SwapScreen, PoolsScreen, StatsScreen, Header)
  hooks/          Data hooks (useOmnomData, useLiquidity)
  lib/            Constants, contract ABIs, utilities
```

## License

MIT
