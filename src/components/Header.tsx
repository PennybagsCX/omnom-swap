import { useState, useEffect, useRef } from 'react';
import { useAccount, useChainId, useSwitchChain } from 'wagmi';
import { dogechain } from 'wagmi/chains';
import { Menu, X } from 'lucide-react';
import { WalletModal } from './WalletModal';
import { useToast } from './ToastContext';

const DOGECHAIN_ID = dogechain.id;

export function Header({ activeTab, setActiveTab }: { activeTab: string, setActiveTab: (tab: 'SWAP' | 'POOLS' | 'STATS') => void }) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const mobileRef = useRef<HTMLDivElement>(null);
  const { isConnected, address } = useAccount();
  const chainId = useChainId();
  const { switchChain } = useSwitchChain();
  const { addToast } = useToast();
  const isWrongNetwork = isConnected && chainId !== DOGECHAIN_ID;

  // Close mobile menu on outside click
  useEffect(() => {
    if (!mobileMenuOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (mobileRef.current && !mobileRef.current.contains(e.target as Node)) {
        setMobileMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [mobileMenuOpen]);

  const handleTabSelect = (tab: 'SWAP' | 'POOLS' | 'STATS') => {
    setActiveTab(tab);
    setMobileMenuOpen(false);
  };

  const getTruncatedAddress = (addr: string) => {
    if (!addr) return '';
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  }

  const handleWalletClick = () => {
    if (isWrongNetwork) {
      switchChain({ chainId: DOGECHAIN_ID });
      addToast({ type: 'success', title: 'Switching Network', message: 'Switching to Dogechain...' });
      return;
    }
    setIsModalOpen(true);
  }

  return (
    <>
      <header className="bg-surface/90 backdrop-blur-md fixed top-0 left-0 right-0 z-40 border-b border-outline-variant/15 shadow-[0_4px_30px_rgba(255,215,0,0.05)]">
        <div className="flex items-center w-full px-4 md:px-6 py-3 md:py-4 max-w-[1920px] mx-auto relative gap-3">
          {/* Mobile hamburger — left side */}
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="md:hidden text-white hover:text-primary transition-colors cursor-pointer p-1 shrink-0"
            aria-label="Toggle menu"
          >
            {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>

          {/* Logo */}
          <div className="text-2xl md:text-3xl font-black [clip-path:polygon(0%_0%,100%_0%,100%_70%,95%_80%,100%_90%,100%_100%,0%_100%)] font-headline tracking-tighter uppercase cursor-pointer shrink-0">
            <span className="text-primary">OMNOM</span><span className="text-secondary">SWAP</span>
          </div>

          {/* Desktop nav */}
          <nav className="hidden md:flex gap-8 font-headline font-bold tracking-tighter uppercase ml-8">
            {(['SWAP', 'POOLS', 'STATS'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`transition-all duration-150 px-2 py-1 ${
                  activeTab === tab
                    ? 'text-primary border-b-2 border-primary pb-1'
                    : 'text-white/60 hover:text-white hover:bg-surface-container-high hover:scale-105'
                } cursor-pointer`}
              >
                {tab}
              </button>
            ))}
          </nav>

          {/* Spacer */}
          <div className="flex-1" />

          {/* Wallet button */}
          <div className="flex items-center gap-2 shrink-0">
            {isConnected && !isWrongNetwork && (
              <div className="w-2 h-2 bg-green-400 shadow-[0_0_6px_rgba(74,222,128,0.6)]" title="Connected to Dogechain" />
            )}
            {isWrongNetwork && (
              <div className="w-2 h-2 bg-red-400 shadow-[0_0_6px_rgba(248,113,113,0.6)]" title="Wrong network" />
            )}
            <button
              onClick={handleWalletClick}
              className={`font-headline font-black px-3 md:px-6 py-1.5 md:py-2 text-xs md:text-base transition-all active:scale-95 uppercase tracking-tighter cursor-pointer whitespace-nowrap ${
                isWrongNetwork
                  ? 'bg-red-600 text-white shadow-[0_0_20px_rgba(248,113,113,0.3)] hover:bg-red-500'
                  : 'bg-primary text-black shadow-[0_0_20px_rgba(255,215,0,0.3)] hover:bg-white hover:text-black'
              }`}
            >
              {isWrongNetwork
                ? 'SWITCH TO DOGECHAIN'
                : isConnected ? getTruncatedAddress(address!) : 'JOIN THE PACK'}
            </button>
          </div>

          <div className="bg-gradient-to-r from-primary via-primary-dim to-transparent h-[1px] w-full absolute bottom-0 left-0 opacity-40"></div>
        </div>
      </header>

      {/* Mobile slide-down menu */}
      {mobileMenuOpen && (
        <div ref={mobileRef} className="fixed top-[57px] md:top-[65px] left-0 right-0 z-30 bg-surface-container-lowest border-b border-primary/20 shadow-[0_8px_30px_rgba(0,0,0,0.5)] md:hidden">
          <nav className="flex flex-col">
            {(['SWAP', 'POOLS', 'STATS'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => handleTabSelect(tab)}
                className={`font-headline font-bold text-lg tracking-tighter uppercase px-6 py-4 border-b border-outline-variant/10 transition-colors cursor-pointer text-left ${
                  activeTab === tab
                    ? 'text-primary bg-primary/5 border-l-4 border-l-primary'
                    : 'text-white/70 hover:text-white hover:bg-surface-container-high'
                }`}
              >
                {tab}
              </button>
            ))}
          </nav>
        </div>
      )}

      <WalletModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} onToast={addToast} />
    </>
  );
}
