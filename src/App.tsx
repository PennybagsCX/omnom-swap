import { useState, useCallback, useEffect } from 'react';
import { Header } from './components/Header';
import { Footer } from './components/Footer';
import { UnifiedSwapScreen } from './components/UnifiedSwapScreen';
import { PoolsScreen } from './components/PoolsScreen';
import { StatsScreen } from './components/StatsScreen';
import { TestingDashboard } from './components/aggregator/TestingDashboard';
import { Disclosures } from './components/aggregator/Disclosures';
import { TelegramBanner } from './components/TelegramBanner';
import { ToastProvider } from './components/ToastContext';
import { MonitorOverlay } from './components/MonitorOverlay';
import { Construction, Lock } from 'lucide-react';
import { usePrioritizedTokenLoader } from './hooks/usePrioritizedTokenLoader';
import { TOKENS } from './lib/constants';

// SHA-256 hash of the admin PIN — avoids storing the plaintext secret in source code
const ADMIN_PIN_HASH = 'da27aaafac63500f67045ee72fe62f96cb814a00801460539a902d80dbb98b6a';

/** Verify a PIN input against the stored SHA-256 hash using Web Crypto API. */
async function verifyPin(input: string): Promise<boolean> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  const hashHex = Array.from(new Uint8Array(hashBuffer)).map(x => x.toString(16).padStart(2, '0')).join('');
  return hashHex === ADMIN_PIN_HASH;
}

export type TabType = 'SWAP' | 'POOLS' | 'STATS' | 'DASHBOARD' | 'DISCLOSURES';

const VALID_TABS: TabType[] = ['SWAP', 'POOLS', 'STATS', 'DISCLOSURES'];

/** Map tab to a URL hash fragment */
function tabToHash(tab: TabType): string {
  return tab === 'SWAP' ? '' : `#${tab.toLowerCase()}`;
}

/** Map a URL hash fragment back to a TabType, defaulting to SWAP */
function hashToTab(hash: string): TabType {
  const clean = hash.replace('#', '').toUpperCase();
  if (VALID_TABS.includes(clean as TabType)) return clean as TabType;
  return 'SWAP';
}

export default function App() {
  const [activeTab, setActiveTab] = useState<TabType>(() => hashToTab(window.location.hash));

  // Wallet scan — runs at app root so it survives tab navigation
  const walletScan = usePrioritizedTokenLoader({ tokens: TOKENS });

  /** Navigate to a tab — pushes browser history so back button works */
  const navigateToTab = useCallback((tab: TabType) => {
    setActiveTab(tab);
    const newHash = tabToHash(tab);
    if (window.location.hash !== newHash) {
      window.history.pushState({ tab }, '', newHash || window.location.pathname);
    }
  }, []);

  /** Listen for browser back/forward buttons */
  useEffect(() => {
    const handlePopState = (e: PopStateEvent) => {
      const tab = (e.state?.tab as TabType) || hashToTab(window.location.hash);
      if (VALID_TABS.includes(tab)) {
        setActiveTab(tab);
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  // Set initial history state so back button works from the first navigation
  useEffect(() => {
    window.history.replaceState({ tab: activeTab }, '', tabToHash(activeTab) || window.location.pathname);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const [dashboardUnlocked, setDashboardUnlocked] = useState(false);

  return (
    <ToastProvider>
      <div className="min-h-screen flex flex-col font-body text-on-surface selection:bg-primary selection:text-on-primary">
        <div className="grain-overlay"></div>
        <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:px-4 focus:py-2 focus:bg-primary focus:text-on-primary focus:rounded">
          Skip to content
        </a>

        <Header activeTab={activeTab} setActiveTab={navigateToTab} />
        <TelegramBanner />

        <main id="main-content" className="flex-grow pt-20 md:pt-24 pb-8 md:pb-12 px-4 md:px-6 max-w-[1920px] mx-auto w-full relative z-10">
          {activeTab === 'SWAP' && <UnifiedSwapScreen onTabChange={navigateToTab} walletScan={walletScan} />}
          {activeTab === 'POOLS' && <PoolsScreen />}
          {activeTab === 'STATS' && <StatsScreen />}
          {activeTab === 'DASHBOARD' && (
            dashboardUnlocked
              ? <TestingDashboard />
              : <LockedScreen
                  title="Testing Dashboard"
                  subtitle="Admin access required to view simulation tools and contract diagnostics."
                  icon={<Lock className="w-12 h-12" />}
                  onUnlock={() => setDashboardUnlocked(true)}
                />
          )}
          {activeTab === 'DISCLOSURES' && <Disclosures />}
        </main>

        <Footer activeTab={activeTab} setActiveTab={navigateToTab} />
        <MonitorOverlay />
      </div>
    </ToastProvider>
  );
}


export function LockedScreen({ title, subtitle, icon, onUnlock }: { title: string, subtitle: string, icon: React.ReactNode, onUnlock: () => void }) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState(false);
  const [verifying, setVerifying] = useState(false);

  const handlePinSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setVerifying(true);
    const valid = await verifyPin(pin);
    setVerifying(false);
    if (valid) {
      onUnlock();
    } else {
      setError(true);
      setPin('');
      setTimeout(() => setError(false), 2000);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-4">
      <div className="bg-surface-container-low p-8 md:p-12 border border-outline-variant/15 max-w-lg w-full flex flex-col items-center">
        <div className="text-primary opacity-40 mb-6">{icon}</div>
        <div className="flex items-center gap-2 mb-4">
          <Construction className="w-5 h-5 text-secondary" />
          <span className="font-headline text-xs uppercase tracking-[0.3em] text-secondary font-bold">Under Construction</span>
        </div>
        <h2 className="font-headline font-black text-3xl md:text-4xl tracking-tighter uppercase text-white mb-4">{title}</h2>
        <p className="text-on-surface-variant font-body max-w-md">{subtitle}</p>
        <div className="mt-8 h-1 w-20 bg-primary opacity-30"></div>

        <div className="mt-8 flex items-center gap-2 mb-4">
          <Lock className="w-4 h-4 text-on-surface-variant" />
          <span className="font-headline text-xs uppercase tracking-[0.2em] text-on-surface-variant">Admin Access Required</span>
        </div>
        <form onSubmit={handlePinSubmit} className="w-full flex flex-col items-center gap-3">
          <input
            type="password"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            maxLength={6}
            className={`w-48 bg-surface-container-highest border ${error ? 'border-red-500/50' : 'border-outline-variant/30'} text-white text-center text-xl font-headline font-bold tracking-[0.5em] px-4 py-3 focus:border-primary outline-none transition-colors`}
            placeholder="------"
          />
          {error && (
            <p className="text-red-400 text-xs font-headline uppercase tracking-widest animate-pulse text-center">Incorrect PIN</p>
          )}
          <button
            type="submit"
            disabled={verifying}
            className="px-8 py-2 font-headline font-black uppercase tracking-widest text-sm bg-primary text-black hover:bg-white hover:text-black transition-colors cursor-pointer disabled:opacity-50 min-h-[44px]"
          >
            {verifying ? 'Verifying...' : 'Unlock'}
          </button>
        </form>
      </div>
    </div>
  );
}
