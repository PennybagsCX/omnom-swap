import { WagmiProvider, createConfig, http } from 'wagmi'
import { dogechain } from 'wagmi/chains'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import Header from './components/layout/Header'
import Footer from './components/layout/Footer'
import SwapScreen from './screens/SwapScreen'
import PoolsScreen from './screens/PoolsScreen'
import StatsScreen from './screens/StatsScreen'

const config = createConfig({
  chains: [dogechain],
  transports: {
    [dogechain.id]: http(),
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
            <Header />
            <div className="flex-grow pt-24 pb-12 px-6 max-w-[1920px] mx-auto w-full relative z-10 flex flex-col">
              <Routes>
                <Route path="/swap" element={<SwapScreen />} />
                <Route path="/pools" element={<PoolsScreen />} />
                <Route path="/stats" element={<StatsScreen />} />
                <Route path="/" element={<Navigate to="/swap" replace />} />
              </Routes>
            </div>
            <Footer />
          </div>
        </BrowserRouter>
      </QueryClientProvider>
    </WagmiProvider>
  )
}

export default App
