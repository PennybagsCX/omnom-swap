/**
 * TokenSelector — modal/dropdown for selecting tokens.
 *
 * Shows token logo, symbol, balance. Supports search/filter.
 */

import { useState, useEffect } from 'react';
import { Search, X } from 'lucide-react';
import { TOKENS, type TokenType } from '../../lib/constants';
import { useTokenBalances } from '../../hooks/useAggregator/useTokenBalances';

interface TokenSelectorProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (token: TokenType) => void;
  selectedToken?: TokenType;
  side: 'sell' | 'buy';
}

export function TokenSelector({ isOpen, onClose, onSelect, selectedToken, side }: TokenSelectorProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const { getFormattedBalance } = useTokenBalances();

  // L-05: Reset search query when modal closes
  useEffect(() => {
    if (!isOpen) setSearchQuery('');
  }, [isOpen]);

  if (!isOpen) return null;

  const filtered = TOKENS.filter(
    (t) =>
      t.symbol.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.name.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose} role="dialog" aria-modal="true">
      <div className="bg-surface-container-low border border-outline-variant/20 w-full max-w-md mx-0 sm:mx-4 shadow-2xl max-h-[85vh] sm:max-h-[80vh] sm:rounded-none rounded-t-none" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-outline-variant/15">
          <h3 className="font-headline font-bold text-lg uppercase tracking-tighter text-white">
            Select {side === 'sell' ? 'Sell' : 'Buy'} Token
          </h3>
          <button
            onClick={onClose}
            aria-label="Close token selector"
            className="text-on-surface-variant hover:text-white transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Search */}
        <div className="p-4 border-b border-outline-variant/10">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-on-surface-variant" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by name or symbol..."
              aria-label="Search tokens"
              className="w-full bg-surface-container-highest border border-outline-variant/20 text-white pl-10 pr-4 py-2.5 font-body text-sm focus:border-primary outline-none transition-colors"
              autoFocus
            />
          </div>
        </div>

        {/* Token list */}
        <div className="max-h-80 overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="p-8 text-center text-on-surface-variant font-body text-sm">
              No tokens found
            </div>
          ) : (
            filtered.map((token) => {
              const isSelected = selectedToken?.symbol === token.symbol;
              const balance = getFormattedBalance(token.address);

              return (
                <button
                  key={token.symbol}
                  onClick={() => {
                    onSelect(token);
                    onClose();
                  }}
                  disabled={isSelected}
                  className={`w-full flex items-center gap-3 px-4 py-3 transition-colors cursor-pointer ${
                    isSelected
                      ? 'bg-primary/5 border-l-2 border-l-primary'
                      : 'hover:bg-surface-container-high border-l-2 border-l-transparent'
                  }`}
                >
                  {/* Token icon */}
                  <div className="w-9 h-9 rounded-full overflow-hidden bg-surface-container-highest flex items-center justify-center shrink-0">
                    {token.icon && token.isImage ? (
                      <img
                        src={token.icon}
                        alt={token.symbol}
                        className="w-full h-full object-cover"
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = 'none';
                        }}
                      />
                    ) : (
                      <span className="text-xs font-headline font-bold text-primary">
                        {token.symbol.slice(0, 2)}
                      </span>
                    )}
                  </div>

                  {/* Token info */}
                  <div className="flex-1 text-left">
                    <div className="font-headline font-bold text-sm text-white">{token.symbol}</div>
                    <div className="text-xs text-on-surface-variant font-body">{token.name}</div>
                  </div>

                  {/* Balance */}
                  <div className="text-right overflow-hidden">
                    <div className="text-sm font-body text-white truncate whitespace-nowrap">
                      {balance}
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
