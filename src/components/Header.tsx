import React, { useState } from 'react';
import { useAccount } from 'wagmi';
import { WalletModal } from './WalletModal';

export function Header({ activeTab, setActiveTab }: { activeTab: string, setActiveTab: (tab: any) => void }) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const { isConnected, address } = useAccount();

  const getTruncatedAddress = (addr: string) => {
    if (!addr) return '';
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  }

  return (
    <>
      <header className="bg-surface/90 backdrop-blur-md fixed top-0 left-0 right-0 z-40 border-b border-outline-variant/15 shadow-[0_4px_30px_rgba(255,215,0,0.05)]">
        <div className="flex justify-between items-center w-full px-6 py-4 max-w-[1920px] mx-auto relative">
          <div className="text-3xl font-black text-primary neon-text-glow [clip-path:polygon(0%_0%,100%_0%,100%_70%,95%_80%,100%_90%,100%_100%,0%_100%)] font-headline tracking-tighter uppercase cursor-pointer">
            $OMNOM
          </div>
          <nav className="hidden md:flex gap-8 font-headline font-bold tracking-tighter uppercase">
            {['SWAP', 'POOLS', 'STATS'].map((tab) => (
              <div key={tab} className="relative group">
                <button
                  onClick={() => setActiveTab(tab as any)}
                  className={`transition-all duration-150 px-2 py-1 ${
                    activeTab === tab 
                      ? 'text-primary border-b-2 border-primary pb-1' 
                      : 'text-white/60 hover:text-white hover:bg-surface-container-high hover:scale-105'
                  } cursor-pointer`}
                >
                  {tab}
                </button>
                {tab === 'POOLS' && (
                  <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 w-max px-3 py-2 bg-surface-container-highest border border-primary/30 text-[10px] text-white normal-case tracking-normal shadow-[0_0_20px_rgba(255,215,0,0.15)] opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50">
                    Learn about liquidity pools in our <a href="#" className="text-primary hover:underline">Documentation</a>.
                  </div>
                )}
              </div>
            ))}
          </nav>
          <button 
            onClick={() => setIsModalOpen(true)}
            className="bg-primary text-on-primary font-headline font-black px-6 py-2 hover:bg-white hover:text-black transition-all active:scale-95 uppercase tracking-tighter shadow-[0_0_20px_rgba(255,215,0,0.3)] cursor-pointer"
          >
            {isConnected ? getTruncatedAddress(address as string) : 'JOIN THE PACK'}
          </button>
          <div className="bg-gradient-to-r from-primary via-primary-dim to-transparent h-[1px] w-full absolute bottom-0 left-0 opacity-40"></div>
        </div>
      </header>

      <WalletModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} />
    </>
  );
}
