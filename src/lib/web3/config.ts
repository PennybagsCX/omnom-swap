import { createConfig, http } from 'wagmi'
import { metaMask, injected } from 'wagmi/connectors'
import { dogechain } from 'wagmi/chains'

export const config = createConfig({
  chains: [dogechain],
  connectors: [metaMask(), injected()],
  transports: {
    [dogechain.id]: http()
  }
})
