import { useState } from 'react';
import GlassPanel from '../ui/GlassPanel';
import Button from '../ui/Button';
import { useDogeSwap } from '../../hooks/useDogeSwap';
import { TOKENS } from '../../constants/tokens';
import { useAccount, useConnect } from 'wagmi';
import { injected } from 'wagmi/connectors';

export default function LiquidityModal({ onClose }: { onClose: () => void }) {
  const [amountA, setAmountA] = useState('');
  const [amountB, setAmountB] = useState('');
  
  const { isConnected } = useAccount();
  const { connect } = useConnect();
  const { approve, addLiquidity } = useDogeSwap();

  const handleAddLiquidity = async () => {
    if (!isConnected) {
      connect({ connector: injected() });
      return;
    }

    try {
      if (!amountA || !amountB) return;
      
      const tokenA = TOKENS[0].address; // OMNOM
      const tokenB = TOKENS[1].address; // DOGE

      // Approve both
      await approve(tokenA, amountA);
      await approve(tokenB, amountB);

      // Slippage for min outputs
      const minA = (Number(amountA) * 0.95).toFixed(18);
      const minB = (Number(amountB) * 0.95).toFixed(18);

      await addLiquidity(tokenA, tokenB, amountA, amountB, minA, minB);
      onClose(); // close on success
    } catch(e) {
      console.error(e);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <GlassPanel className="w-full max-w-lg bg-surface-container border-tertiary/30 shadow-[0_0_50px_rgba(142,255,113,0.1)]">
        <div className="p-6 border-b border-outline-variant/20 flex justify-between items-center">
          <h2 className="text-2xl font-headline font-black text-tertiary uppercase text-shadow-sm">Feed The Pool</h2>
          <button onClick={onClose} className="text-on-surface-variant hover:text-white text-2xl leading-none">&times;</button>
        </div>
        <div className="p-6">
          <p className="text-on-surface-variant mb-6 text-sm flex items-center gap-2">
            <span className="text-tertiary">ℹ</span>
            Add liquidity to earn fees and rewards. Both tokens are required.
          </p>
          <div className="flex flex-col gap-4">
             <div className="bg-surface-container-high p-4 rounded-xl border border-outline-variant/10 focus-within:border-tertiary/30 transition-colors">
               <label className="text-xs uppercase tracking-widest text-on-surface-variant block mb-2 font-bold">OMNOM Amount</label>
               <input type="text" value={amountA} onChange={e => setAmountA(e.target.value)} placeholder="0.0" className="bg-transparent text-3xl font-mono text-white outline-none w-full" />
             </div>
             <div className="bg-surface-container-high p-4 rounded-xl border border-outline-variant/10 focus-within:border-tertiary/30 transition-colors">
               <label className="text-xs uppercase tracking-widest text-on-surface-variant block mb-2 font-bold">DOGE Amount</label>
               <input type="text" value={amountB} onChange={e => setAmountB(e.target.value)} placeholder="0.0" className="bg-transparent text-3xl font-mono text-white outline-none w-full" />
             </div>
          </div>
          <Button isFullWidth onClick={handleAddLiquidity} className="mt-8 bg-tertiary text-black hover:bg-white border-tertiary">
            {isConnected ? 'Confirm Liquidity' : 'Connect Wallet'}
          </Button>
        </div>
      </GlassPanel>
    </div>
  );
}
