import { useState } from 'react';
import GlassPanel from '../ui/GlassPanel';
import Button from '../ui/Button';
import TokenSelectModal from '../modals/TokenSelectModal';
import { TOKENS } from '../../constants/tokens';
import { Token } from '../../types';

export default function SwapCard() {
  const [sellToken, setSellToken] = useState<Token>(TOKENS[1]); // DOGE
  const [buyToken, setBuyToken] = useState<Token>(TOKENS[0]); // OMNOM
  const [sellAmount, setSellAmount] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalTarget, setModalTarget] = useState<'sell' | 'buy' | null>(null);

  const handleOpenModal = (target: 'sell' | 'buy') => {
    setModalTarget(target);
    setIsModalOpen(true);
  };

  const handleSelectToken = (token: Token) => {
    if (modalTarget === 'sell') setSellToken(token);
    if (modalTarget === 'buy') setBuyToken(token);
    setIsModalOpen(false);
  };

  return (
    <div className="max-w-lg mx-auto w-full">
      <GlassPanel className="p-[2px] bg-gradient-to-b from-primary/20 via-surface to-surface rounded-2xl relative">
        <div className="bg-surface rounded-[14px] p-6">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-2xl font-headline font-black uppercase tracking-tighter text-primary">Carnage Swap</h2>
            <button className="text-on-surface-variant hover:text-white transition-colors" title="Settings">⚙️</button>
          </div>
          
          <div className="bg-surface-container p-4 rounded-xl border border-outline-variant/10 group focus-within:border-primary/30 transition-colors">
            <div className="flex justify-between mb-2">
              <span className="text-sm font-medium text-on-surface-variant uppercase tracking-wider">You Bleed</span>
              <span className="text-sm font-medium text-on-surface-variant">Balance: {sellToken.balance}</span>
            </div>
            <div className="flex justify-between items-center">
              <input type="text" placeholder="0.0" value={sellAmount} onChange={e => setSellAmount(e.target.value)} className="bg-transparent text-4xl border-none outline-none font-mono text-white placeholder-on-surface-variant/30 flex-1 w-full" />
              <button 
                onClick={() => handleOpenModal('sell')}
                className="flex items-center gap-2 bg-surface-container-highest hover:bg-surface-bright border border-outline-variant/20 rounded-full py-1 px-3 transition-colors shrink-0 font-headline font-bold text-white uppercase"
              >
                <span className="text-xl">{sellToken.icon}</span>
                <span>{sellToken.symbol}</span>
                <span className="text-xs">▼</span>
              </button>
            </div>
          </div>

          <div className="relative h-1 w-full my-3 flex justify-center items-center z-10">
             <button onClick={() => {const t=sellToken; setSellToken(buyToken); setBuyToken(t);}} className="absolute bg-surface-container-highest border-2 border-surface p-2 rounded-xl text-primary hover:text-white hover:scale-110 transition-all hover:border-primary shadow-[0_0_15px_rgba(255,215,0,0.1)]">
               ↓
             </button>
          </div>

          <div className="bg-surface-container p-4 rounded-xl border border-outline-variant/10 group focus-within:border-tertiary/30 transition-colors">
            <div className="flex justify-between mb-2">
              <span className="text-sm font-medium text-on-surface-variant uppercase tracking-wider">You Devour</span>
              <span className="text-sm font-medium text-on-surface-variant">Balance: {buyToken.balance}</span>
            </div>
            <div className="flex justify-between items-center">
              <input type="text" placeholder="0.0" value={sellAmount ? (parseFloat(sellAmount)*1.5).toString() : ''} readOnly className="bg-transparent text-4xl border-none outline-none font-mono text-white placeholder-on-surface-variant/30 flex-1 w-full text-tertiary" />
              <button 
                onClick={() => handleOpenModal('buy')}
                className="flex items-center gap-2 bg-surface-container-highest hover:bg-surface-bright border border-outline-variant/20 rounded-full py-1 px-3 transition-colors shrink-0 font-headline font-bold text-white uppercase"
              >
                <span className="text-xl">{buyToken.icon}</span>
                <span>{buyToken.symbol}</span>
                <span className="text-xs">▼</span>
              </button>
            </div>
          </div>
          
          <Button isFullWidth className="mt-6 text-xl h-16 bg-primary text-black">
            Execute Swap
          </Button>
        </div>
      </GlassPanel>

      {isModalOpen && (
        <TokenSelectModal onClose={() => setIsModalOpen(false)} onSelect={handleSelectToken} />
      )}
    </div>
  );
}
