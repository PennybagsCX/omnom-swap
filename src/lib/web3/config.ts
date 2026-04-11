import { createConfig, http } from 'wagmi'
import { dogechain } from 'wagmi/chains'

export const config = createConfig({
  chains: [dogechain],
  transports: {
    [dogechain.id]: http()
  }
})
