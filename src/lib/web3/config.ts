import { createConfig, http } from 'wagmi'
import { injected } from 'wagmi/connectors'
import { dogechain } from 'wagmi/chains'

export const config = createConfig({
  chains: [dogechain],
  connectors: [injected()],
  transports: {
    [dogechain.id]: http()
  }
})
