import { useState } from 'react';
import { TOKENS } from '../../constants/tokens';
import GlassPanel from '../ui/GlassPanel';
import { Token } from '../../types';

interface TokenSelectModalProps {
  onClose: () => void;
  onSelect: (token: Token) => void;
}

export default function TokenSelectModal({ onClose, onSelect }: TokenSelectModalProps) {
  const [search, setSearch] = useState('');
  
  const filteredTokens = TOKENS.filter(t => 
    t.symbol.toLowerCase().includes(search.toLowerCase()) || 
    t.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <GlassPanel className="w-full max-w-md bg-surface-container-highest border-outline-variant/30 flex flex-col max-h-[80vh]">
        <div className="p-4 border-b border-outline-variant/20 flex justify-between items-center">
          <h2 className="text-xl font-headline font-bold">Select a Token</h2>
          <button onClick={onClose} className="text-on-surface-variant hover:text-white">&times;</button>
        </div>
        <div className="p-4 border-b border-outline-variant/20">
          <input 
            type="text" 
            placeholder="Search name or paste address" 
            className="w-full bg-surface-container-high border border-outline-variant/30 rounded-lg p-3 text-white placeholder-on-surface-variant/50 focus:outline-none focus:border-primary/50"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="overflow-y-auto p-2">
          {filteredTokens.map(token => (
            <button 
              key={token.symbol} 
              onClick={() => onSelect(token)}
              className="w-full flex items-center justify-between p-3 hover:bg-surface-container-high rounded-lg transition-colors text-left"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full flex items-center justify-center bg-surface-container-highest border border-outline-variant/30 text-xl shadow-[0_0_10px_rgba(255,255,255,0.05)]">
                  {token.icon}
                </div>
                <div>
                  <div className="font-headline font-bold text-lg leading-tight">{token.symbol}</div>
                  <div className="text-sm text-on-surface-variant">{token.name}</div>
                </div>
              </div>
              <div className="text-right">
                <div className="font-mono text-sm">{token.balance}</div>
              </div>
            </button>
          ))}
        </div>
      </GlassPanel>
    </div>
  );
}
