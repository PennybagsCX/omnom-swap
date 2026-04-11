# Web3 Integration Implementation Plan

> **For Antigravity:** REQUIRED WORKFLOW: Use `.agent/workflows/execute-plan.md` to execute this plan in single-flow mode.

**Goal:** Provide an end-to-end integration for the OMNOM Swap DEX UI using Dogechain, custom components, and Wagmi/Viem to permit token trading on the DogeSwap V3 Router.

**Architecture:** We will implement Wagmi and Viem paired with a custom Wallet Connection UI to maintain the aggressive neon visual aesthetic. The large `App.tsx` file will be refactored into modular components, and live Web3 interactions will replace the mocked data for balances and swaps.

**Tech Stack:** React 19, Vite, TailwindCSS, Framer Motion, Wagmi, Viem.

---

### Task 1: Setup Web3 Dependencies & Provider

**Files:**
- Modify: `package.json`
- Create: `src/lib/web3/config.ts`
- Create: `src/Web3Provider.tsx`
- Modify: `src/main.tsx`

**Step 1: Install Dependencies**
Run: `npm install wagmi viem @tanstack/react-query`
Expected: Dependencies installed successfully.

**Step 2: Create Web3 Configuration**
Create `src/lib/web3/config.ts`:
```typescript
import { createConfig, http } from 'wagmi'
import { dogechain } from 'wagmi/chains'

export const config = createConfig({
  chains: [dogechain],
  transports: {
    [dogechain.id]: http()
  }
})
```

**Step 3: Create the Web3 Provider Wrapper**
Create `src/Web3Provider.tsx`:
```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { WagmiProvider } from 'wagmi'
import { config } from './lib/web3/config'
import React from 'react'

const queryClient = new QueryClient()

export function Web3Provider({ children }: { children: React.ReactNode }) {
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    </WagmiProvider>
  )
}
```

**Step 4: Wrap Application in Provider**
Modify `src/main.tsx` to wrap `<App />` inside `<Web3Provider>`.

**Step 5: Verify build**
Run: `npm run lint` and `npm run build`
Expected: Passes without typescript errors.

**Step 6: Commit**
Run: `git add . && git commit -m "feat: setup wagmi and viem web3 provider context"`

---

### Task 2: Token Constants & Wallet Modal UI

**Files:**
- Create: `src/lib/constants.ts`
- Create: `src/components/WalletModal.tsx`

**Step 1: Extract Token & Contract Constants**
Create `src/lib/constants.ts` to export network info from `info.md`: WWDOGE address, Algebra Router V3 Address, RPC info. Also move the `TOKENS` array from `App.tsx` to here minus the hardcoded balance properties.

**Step 2: Build Wallet Modal**
Create `src/components/WalletModal.tsx`. Use `useConnect` and `useDisconnect` from `wagmi` to build a glassmorphism/neon styled modal that mimics the existing style of `App.tsx` and maps through available wagmi connectors (e.g. Injected / MetaMask).

**Step 3: Verify aesthetics in Dev Server**
Run: `npm run dev` and visually verify the WalletModal renders correctly and allows a connection to a locally injected MetaMask wallet.

**Step 4: Commit**
`git add . && git commit -m "feat: custom wallet modal connection UI"`

---

### Task 3: Refactor Swap Screen and Header

**Files:**
- Create: `src/components/Header.tsx`
- Create: `src/components/SwapScreen.tsx`
- Modify: `src/App.tsx`

**Step 1: Extract Header & Integrate WalletModal**
Create `src/components/Header.tsx`, importing the `<header>` block from `App.tsx`. Update the "JOIN THE PACK" button to use `useAccount` and trigger the `WalletModal`. Display a truncated connected address if `isConnected` is true.

**Step 2: Extract Swap Screen**
Create `src/components/SwapScreen.tsx`. Move `SwapScreen` functional component logic and state from `App.tsx` to the new file. Update state to use the new token constants.

**Step 3: Replace mocked balance with live data**
In `SwapScreen.tsx`, use `useReadContracts` (or `useBalance`) from `wagmi` to fetch the real ERC20 token balances for WWDOGE for the connected user address and display it instead of hardcoded numbers.

**Step 4: Verify**
Run: `npm run lint` and `npm run build` to verify the refactor hasn't caused broken imports. Open Dev server and ensure live balance reflects wallet properties.

**Step 5: Commit**
`git add . && git commit -m "refactor: extract Header and SwapScreen, link live balances"`

---

### Task 4: Execute Swap Logic & Error Handling

**Files:**
- Modify: `src/components/SwapScreen.tsx`

**Step 1: Integrate Allowance Checks**
In `SwapScreen.tsx`, run `useReadContract` to check ERC20 `allowance()` matching the V3 Router address against the current sell token. 

**Step 2: Implement Approval & Swap flow**
If allowance < sellAmount, button text should be "APPROVE ROUTER", firing `useWriteContract` to `approve`. 
If allowance >= sellAmount, button text should be "CHOMP THE SWAP", firing `exactInputSingle` on the V3 router with the constructed path.

**Step 3: Test and Polish**
Run dev server and test wallet transactions. Add framer-motion notifications for revert logic or rejected popups. Visually resize screen to ensure everything is fluid.

**Step 4: Final Commit**
`git add . && git commit -m "feat: complete end-to-end swap execution logic"`
