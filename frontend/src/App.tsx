import { WagmiProvider, createConfig, http } from 'wagmi'
import { mainnet } from 'wagmi/chains'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Routes, Route } from 'react-router-dom'

const config = createConfig({
  chains: [mainnet],
  transports: {
    [mainnet.id]: http(),
  },
})

const queryClient = new QueryClient()

function App() {
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <div className="min-h-screen flex flex-col font-body text-on-surface selection:bg-primary selection:text-on-primary">
            <div className="grain-overlay"></div>
            <div className="flex-grow pt-24 pb-12 px-6 max-w-[1920px] mx-auto w-full relative z-10">
              <h1 className="text-white text-3xl font-headline neon-text-glow font-bold uppercase tracking-tighter">OMNOM SWAP MVP Scaffolding Active</h1>
            </div>
          </div>
        </BrowserRouter>
      </QueryClientProvider>
    </WagmiProvider>
  )
}

export default App
