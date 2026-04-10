import GlassPanel from '../ui/GlassPanel';
import Button from '../ui/Button';

export default function LiquidityModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <GlassPanel className="w-full max-w-lg bg-surface-container border-tertiary/30">
        <div className="p-6 border-b border-outline-variant/20 flex justify-between items-center">
          <h2 className="text-2xl font-headline font-black text-tertiary uppercase">Feed The Pool</h2>
          <button onClick={onClose} className="text-on-surface-variant hover:text-white">&times;</button>
        </div>
        <div className="p-6">
          <p className="text-on-surface-variant mb-4">Add liquidity to earn fees and rewards.</p>
          <div className="flex flex-col gap-4">
             <div className="bg-surface-container-high p-4 rounded-xl">
               <label className="text-xs uppercase tracking-widest text-on-surface-variant block mb-2">OMNOM Amount</label>
               <input type="text" placeholder="0.0" className="bg-transparent text-2xl font-mono text-white outline-none w-full" />
             </div>
             <div className="bg-surface-container-high p-4 rounded-xl">
               <label className="text-xs uppercase tracking-widest text-on-surface-variant block mb-2">DOGE Amount</label>
               <input type="text" placeholder="0.0" className="bg-transparent text-2xl font-mono text-white outline-none w-full" />
             </div>
          </div>
          <Button isFullWidth className="mt-8 bg-tertiary text-black hover:bg-white shadow-[0_0_20px_rgba(142,255,113,0.3)] hover:shadow-[0_0_40px_rgba(142,255,113,0.5)] border-tertiary">Provide Liquidity</Button>
        </div>
      </GlassPanel>
    </div>
  );
}
