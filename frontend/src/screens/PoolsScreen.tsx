import { useState } from 'react';
import GlassPanel from '../components/ui/GlassPanel';
import Button from '../components/ui/Button';
import LiquidityModal from '../components/pools/LiquidityModal';

export default function PoolsScreen() {
  const [isModalOpen, setIsModalOpen] = useState(false);

  return (
    <div className="w-full max-w-7xl mx-auto py-8">
      <div className="mb-8 flex justify-between items-end">
        <div>
          <h1 className="text-5xl font-headline font-black uppercase tracking-tighter text-white mb-2">The Feeding Grounds</h1>
          <p className="text-on-surface-variant text-lg">Provide liquidity. Earn fees. Feast on rewards.</p>
        </div>
        <Button onClick={() => setIsModalOpen(true)} className="bg-tertiary text-black border shadow-[0_0_20px_rgba(142,255,113,0.2)] hover:shadow-[0_0_40px_rgba(142,255,113,0.4)]">
          + New Position
        </Button>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <GlassPanel className="p-6 bg-surface-container">
          <div className="flex items-center gap-3 mb-4">
            <div className="flex -space-x-2">
              <div className="w-10 h-10 rounded-full flex items-center justify-center bg-surface-container-highest border border-outline-variant/30 text-xl z-10 shadow-lg">🐺</div>
              <div className="w-10 h-10 rounded-full flex items-center justify-center bg-surface-container-highest border border-outline-variant/30 text-xl shadow-lg">🐕</div>
            </div>
            <h3 className="text-xl font-headline font-bold">OMNOM / DOGE</h3>
          </div>
          <div className="flex justify-between mb-6">
            <div>
              <div className="text-xs text-on-surface-variant uppercase tracking-wider mb-1">APR</div>
              <div className="text-2xl font-mono text-tertiary">420.69%</div>
            </div>
            <div className="text-right">
              <div className="text-xs text-on-surface-variant uppercase tracking-wider mb-1">TVL</div>
              <div className="text-xl font-mono text-white">$1.2M</div>
            </div>
          </div>
          <Button isFullWidth onClick={() => setIsModalOpen(true)} className="bg-surface-container-highest border-tertiary/30 text-tertiary hover:bg-tertiary hover:text-black">
            Manage
          </Button>
        </GlassPanel>
      </div>

      {isModalOpen && <LiquidityModal onClose={() => setIsModalOpen(false)} />}
    </div>
  );
}
