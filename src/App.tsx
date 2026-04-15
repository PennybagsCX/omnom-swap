import { useState } from 'react';
import { Header } from './components/Header';
import { SwapScreen } from './components/SwapScreen';
import { PoolsScreen } from './components/PoolsScreen';
import { StatsScreen } from './components/StatsScreen';
import { ToastProvider } from './components/ToastContext';
import { Construction, Lock } from 'lucide-react';

// SHA-256 hash of the admin PIN — avoids storing the plaintext secret in source code
const ADMIN_PIN_HASH = 'da27aaafac63500f67045ee72fe62f96cb814a00801460539a902d80dbb98b6a';

/** Verify a PIN input against the stored SHA-256 hash using Web Crypto API. */
async function verifyPin(input: string): Promise<boolean> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  const hashHex = Array.from(new Uint8Array(hashBuffer)).map(x => x.toString(16).padStart(2, '0')).join('');
  return hashHex === ADMIN_PIN_HASH;
}

export default function App() {
  const [activeTab, setActiveTab] = useState<'SWAP' | 'POOLS' | 'STATS'>('SWAP');

  return (
    <ToastProvider>
      <div className="min-h-screen flex flex-col font-body text-on-surface selection:bg-primary selection:text-on-primary">
        <div className="grain-overlay"></div>

        <Header activeTab={activeTab} setActiveTab={setActiveTab} />

        <main className="flex-grow pt-24 pb-12 px-6 max-w-[1920px] mx-auto w-full relative z-10">
          {activeTab === 'SWAP' && <SwapScreen />}
          {activeTab === 'POOLS' && <PoolsScreen />}
          {activeTab === 'STATS' && <StatsScreen />}
        </main>

        <footer className="bg-surface-container-lowest border-t border-outline-variant/15 relative z-10">
          <div className="flex flex-col md:flex-row justify-between items-center px-8 py-6 w-full max-w-[1920px] mx-auto">
            <div className="font-body text-[10px] uppercase tracking-[0.2em] font-medium text-on-surface-variant">
              $OMNOM: Unleash the Beast. Defend the Doge. <span className="text-primary">Devour the Rest.</span>
            </div>
            <div className="flex gap-8 mt-4 md:mt-0 font-body text-[10px] uppercase tracking-[0.2em] font-medium">
              <a href="https://x.com/omnomtoken" target="_blank" rel="noopener noreferrer" className="text-on-surface-variant hover:text-primary transition-colors">X (Twitter)</a>
              <a href="https://t.me/omnomtoken_dc" target="_blank" rel="noopener noreferrer" className="text-on-surface-variant hover:text-primary transition-colors">Telegram</a>
              <a href="https://github.com/PennybagsCX/omnom-swap" target="_blank" rel="noopener noreferrer" className="text-on-surface-variant hover:text-primary transition-colors">Docs</a>
            </div>
          </div>
          <div className="h-1 bg-primary w-full opacity-10"></div>
        </footer>
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
      <div className="bg-surface-container-low p-12 border border-outline-variant/15 max-w-lg w-full flex flex-col items-center">
        <div className="text-primary opacity-40 mb-6">{icon}</div>
        <div className="flex items-center gap-2 mb-4">
          <Construction className="w-5 h-5 text-secondary" />
          <span className="font-headline text-xs uppercase tracking-[0.3em] text-secondary font-bold">Under Construction</span>
        </div>
        <h2 className="font-headline font-black text-4xl md:text-5xl tracking-tighter uppercase text-white mb-4">{title}</h2>
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
            <p className="text-red-400 text-xs font-headline uppercase tracking-widest animate-pulse">Incorrect PIN</p>
          )}
          <button
            type="submit"
            disabled={verifying}
            className="px-8 py-2 font-headline font-black uppercase tracking-widest text-sm bg-primary text-black hover:bg-white hover:text-black transition-colors cursor-pointer disabled:opacity-50"
          >
            {verifying ? 'Verifying...' : 'Unlock'}
          </button>
        </form>
      </div>
    </div>
  );
}
