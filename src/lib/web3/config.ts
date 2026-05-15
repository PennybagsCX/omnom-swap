import { createConfig, http } from 'wagmi'
import { injected, walletConnect, coinbaseWallet } from 'wagmi/connectors'
import { dogechain } from 'wagmi/chains'

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
 *  - The generic `injected()` connector handles MetaMask and any other
 *    browser-injected wallet via window.ethereum. Combined with EIP-6963
 *    auto-discovery (handled by wagmi), this covers all major wallets
 *    without requiring the `@metamask/connect-evm` dependency that causes
 *    Vite resolution failures due to its deep CJS-only dependency tree.
 *  - WalletConnect and Coinbase are included as dedicated connectors when
 *    configured.
 *  - Deduplication is handled at render time in WalletModal, which maps
 *    connector IDs to friendly display names and hides duplicates.
 */
const connectors = [
  injected(),
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
