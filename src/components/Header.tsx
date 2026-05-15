import { useState, useEffect, useRef } from 'react';
import { useAccount, useChainId, useSwitchChain } from 'wagmi';
import { dogechain } from 'wagmi/chains';
import { Menu, X, ExternalLink } from 'lucide-react';
import { WalletModal } from './WalletModal';
import { useToast } from './ToastContext';
import { useMetaMaskStatus } from '../hooks/useMetaMaskStatus';
import type { TabType } from '../App';

const DOGECHAIN_ID = dogechain.id;

const TABS: TabType[] = ['SWAP', 'POOLS', 'STATS'];

export function Header({ activeTab, setActiveTab }: { activeTab: TabType, setActiveTab: (tab: TabType) => void }) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const mobileRef = useRef<HTMLDivElement>(null);
  const { isConnected, address } = useAccount();
  const chainId = useChainId();
  const { switchChain } = useSwitchChain();
  const { addToast } = useToast();
  const { isMetaMaskConnected } = useMetaMaskStatus();
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

  const handleTabSelect = (tab: TabType) => {
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
        <div className="flex items-center w-full px-3 md:px-6 py-2.5 md:py-4 max-w-[1920px] mx-auto relative gap-2 md:gap-3">
          {/* Mobile hamburger — left side */}
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="md:hidden text-white hover:text-primary transition-colors cursor-pointer p-2 min-h-[44px] min-w-[44px] flex items-center justify-center shrink-0"
            aria-label="Toggle menu"
          >
            {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>

          {/* Logo */}
          <button aria-label="Go to home page" className="text-xl md:text-3xl font-black [clip-path:polygon(0%_0%,100%_0%,100%_70%,95%_80%,100%_90%,100%_100%,0%_100%)] font-headline tracking-tighter uppercase cursor-pointer shrink-0" onClick={() => handleTabSelect('SWAP')}>
            <h1 className="sr-only">OMNOM Swap - DEX Aggregator on Dogechain</h1>
            <span className="text-primary">OMNOM</span><span className="text-secondary">SWAP</span>
          </button>

          {/* Desktop nav */}
          <nav className="hidden md:flex gap-4 lg:gap-6 font-headline font-bold tracking-tighter uppercase absolute left-1/2 -translate-x-1/2" role="tablist">
            {TABS.map((tab) => (
              <button
                key={tab}
                role="tab"
                aria-selected={activeTab === tab}
                onClick={() => setActiveTab(tab)}
                className={`transition-all duration-150 px-2 py-1 text-sm whitespace-nowrap ${
                  activeTab === tab
                    ? 'text-primary border-b-2 border-primary pb-1'
                    : 'text-white/60 hover:text-white hover:bg-surface-container-high hover:scale-105'
                } cursor-pointer`}
              >
                {tab}
              </button>
            ))}
            <a
              href="https://dive.dogechain.dog/bridge"
              target="_blank"
              rel="noopener noreferrer"
              className="text-white/60 hover:text-primary transition-all duration-150 px-2 py-1 flex items-center gap-1.5 text-sm whitespace-nowrap"
            >
              BRIDGE
              <ExternalLink className="w-3 h-3" />
            </a>
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
              aria-label={isWrongNetwork ? 'Switch to Dogechain network' : isConnected ? 'Disconnect wallet' : 'Connect wallet'}
              className={`font-headline font-black px-3 md:px-6 py-2 md:py-2 text-xs md:text-base transition-all active:scale-95 uppercase tracking-tighter cursor-pointer whitespace-nowrap min-h-[44px] ${
                isWrongNetwork
                  ? 'bg-red-600 text-white shadow-[0_0_20px_rgba(248,113,113,0.3)] hover:bg-red-500'
                  : 'bg-primary text-black shadow-[0_0_20px_rgba(255,215,0,0.3)] hover:bg-white hover:text-black'
              }`}
            >
              {isWrongNetwork
                ? 'SWITCH'
                : isConnected ? (
                  <span className="flex items-center gap-1.5">
                    {isMetaMaskConnected && (
                      <img src="/wallets/metamask.svg" alt="" className="w-4 h-4 md:w-5 md:h-5 shrink-0" aria-hidden="true" />
                    )}
                    {getTruncatedAddress(address!)}
                  </span>
                ) : 'CONNECT'}
            </button>
          </div>

          <div className="bg-gradient-to-r from-primary via-primary-dim to-transparent h-[1px] w-full absolute bottom-0 left-0 opacity-40"></div>
        </div>
      </header>

      {/* Mobile slide-down menu */}
      {mobileMenuOpen && (
        <div ref={mobileRef} className="fixed top-[49px] md:top-[65px] left-0 right-0 z-30 bg-surface-container-lowest border-b border-primary/20 shadow-[0_8px_30px_rgba(0,0,0,0.5)] md:hidden">
          <nav className="flex flex-col">
            {TABS.map((tab) => (
              <button
                key={tab}
                onClick={() => handleTabSelect(tab)}
                className={`font-headline font-bold text-base tracking-tighter uppercase px-6 py-4 border-b border-outline-variant/10 transition-colors cursor-pointer text-center min-h-[48px] ${
                  activeTab === tab
                    ? 'text-primary bg-primary/5 border-b-2 border-b-primary'
                    : 'text-white/70 hover:text-white hover:bg-surface-container-high'
                }`}
              >
                {tab}
              </button>
            ))}
            <a
              href="https://dive.dogechain.dog/bridge"
              target="_blank"
              rel="noopener noreferrer"
              className="font-headline font-bold text-base tracking-tighter uppercase px-6 py-4 border-b border-outline-variant/10 transition-colors text-white/70 hover:text-primary flex items-center justify-center gap-2 min-h-[48px]"
            >
              BRIDGE
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </nav>
        </div>
      )}

      <WalletModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} onToast={addToast} />
    </>
  );
}
