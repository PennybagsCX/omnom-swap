import { ReactNode } from 'react';

export default function Header() {
  return (
    <header className="bg-surface/90 backdrop-blur-md fixed top-0 left-0 right-0 z-40 border-b border-outline-variant/15 shadow-[0_4px_30px_rgba(255,215,0,0.05)]">
      <div className="flex justify-between items-center w-full px-6 py-4 max-w-[1920px] mx-auto relative">
        <div className="text-3xl font-black text-primary neon-text-glow font-headline tracking-tighter uppercase cursor-pointer" style={{clipPath: "polygon(0% 0%, 100% 0%, 100% 70%, 95% 80%, 100% 90%, 100% 100%, 0% 100%)"}}>
          $OMNOM
        </div>
        <nav className="hidden md:flex gap-8 font-headline font-bold tracking-tighter uppercase">
          <div className="relative group">
            <button className="text-white/60 hover:text-white hover:bg-surface-container-high hover:scale-105 transition-all duration-150 px-2 py-1">SWAP</button>
          </div>
          <div className="relative group">
            <button className="text-white/60 hover:text-white hover:bg-surface-container-high hover:scale-105 transition-all duration-150 px-2 py-1">POOLS</button>
          </div>
          <div className="relative group">
            <button className="text-white/60 hover:text-white hover:bg-surface-container-high hover:scale-105 transition-all duration-150 px-2 py-1">STATS</button>
          </div>
        </nav>
        <button className="bg-primary text-on-primary font-headline font-black px-6 py-2 hover:bg-primary-dim transition-all active:scale-95 uppercase tracking-tighter shadow-[0_0_20px_rgba(255,215,0,0.3)]">
          JOIN THE PACK
        </button>
        <div className="bg-gradient-to-r from-primary via-primary-dim to-transparent h-[1px] w-full absolute bottom-0 left-0 opacity-40"></div>
      </div>
    </header>
  );
}
