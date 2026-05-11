import { createConfig, http } from 'wagmi'
import { metaMask, injected, walletConnect, coinbaseWallet } from 'wagmi/connectors'
import { dogechain } from 'wagmi/chains'
import { isMetaMaskAvailable } from '../walletProviderManager'

// Use VITE_RPC_URL if configured (e.g., private relay for MEV protection),
// otherwise fall back to the default public Dogechain RPC.
const RPC_URL = import.meta.env.VITE_RPC_URL || undefined

// WalletConnect project ID — get one at https://cloud.walletconnect.com
// If not set, WalletConnect connector is skipped (graceful degradation).
const WALLETCONNECT_PROJECT_ID = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID || ''

/**
 * Build connectors list with safe multi-provider handling.
 *
 * Strategy:
 *  - The `metaMask()` connector is always included — it has built-in logic to
 *    detect MetaMask inside `window.ethereum.providers` even when another
 *    extension has set `window.ethereum` as a getter.
 *  - The generic `injected()` connector is included when MetaMask is NOT the
 *    active injected provider, so we don't show a duplicate entry in the
 *    wallet modal for the same underlying provider.
 *  - If no injected provider is detected at all, both connectors are included
 *    so the user sees options regardless of timing.
 */
const metaMaskDetected = isMetaMaskAvailable();

const connectors = [
  metaMask({
    dappMetadata: {
      name: 'OMNOM Swap',
      url: 'https://omnomswap.com',
    },
  }),
  // Skip generic injected() when MetaMask is the active injected provider
  // to avoid duplicate connector entries in the wallet modal.
  ...(!metaMaskDetected ? [injected()] : []),
  ...(WALLETCONNECT_PROJECT_ID
    ? [walletConnect({ projectId: WALLETCONNECT_PROJECT_ID, showQrModal: true })]
    : []),
  coinbaseWallet({ appName: 'OMNOM Swap' }),
]

export const config = createConfig({
  chains: [dogechain],
  connectors,
  transports: {
    [dogechain.id]: http(RPC_URL)
  }
})

/** Whether WalletConnect is available (project ID configured) */
export const hasWalletConnect = WALLETCONNECT_PROJECT_ID !== ''
