/**
 * TokenSelector — modal for selecting tokens.
 *
 * Default view: only tokens with balance > 0 ("Your Tokens").
 * Search: finds across all 16,840 tokens regardless of balance.
 * Balances discovered via Multicall3 wallet scan.
 */

import { useState, useEffect, useMemo } from 'react';
import { Search, X, RefreshCw, Plus } from 'lucide-react';
import { useAccount } from 'wagmi';
import { TOKENS, CONTRACTS, resolveDexName, type TokenType } from '../../lib/constants';
import { type TokenWithBalance } from '../../hooks/usePrioritizedTokenLoader';
import { useTokenPrices } from '../../hooks/useTokenPrices';
import { formatCompactPrice } from '../../lib/format';
import {
  getCustomTokens,
  saveCustomToken,
  removeCustomToken,
  isValidAddress,
  fetchTokenMetadata,
  isCustomToken,
  type CustomToken,
} from '../../lib/customTokens';
import { getCachedTaxInfo } from '../../hooks/useTokenTax';
import { TaxBadge } from './TokenWarningBanner';

const DEX_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  dogeswap:     { bg: 'bg-purple-500/20',  text: 'text-purple-400',  label: 'DOGESWAP' },
  dogeshrek:    { bg: 'bg-green-500/20',   text: 'text-green-400',   label: 'DOGESHREK' },
  fraxswap:     { bg: 'bg-blue-500/20',    text: 'text-blue-400',    label: 'FRAXSWAP' },
  kibbleswap:   { bg: 'bg-orange-500/20',  text: 'text-orange-400',  label: 'KIBBLESWAP' },
  quickswap:    { bg: 'bg-cyan-500/20',    text: 'text-cyan-400',    label: 'QUICKSWAP' },
  yodeswap:     { bg: 'bg-yellow-500/20',  text: 'text-yellow-400',  label: 'YODESWAP' },
  bourbondefi:  { bg: 'bg-amber-500/20',   text: 'text-amber-400',   label: 'BOURBON' },
  sushiswap:    { bg: 'bg-pink-500/20',    text: 'text-pink-400',    label: 'SUSHI' },
  uniswap:      { bg: 'bg-pink-500/20',    text: 'text-pink-400',    label: 'UNI' },
};

interface TokenSelectorProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (token: TokenType) => void;
  selectedToken?: TokenType;
  side: 'sell' | 'buy';
  walletScan: {
    balanceMap: Map<string, TokenWithBalance>;
    isScanning: boolean;
    isBackgroundRefresh: boolean;
    scanComplete: boolean;
    progress: { current: number; total: number } | undefined;
    refresh: () => void;
  };
}

const POPULAR_TOKENS = new Set([
  CONTRACTS.WWDOGE.toLowerCase(),
  CONTRACTS.DC_TOKEN.toLowerCase(),
  CONTRACTS.OMNOM_TOKEN.toLowerCase(),
  CONTRACTS.DINU_TOKEN.toLowerCase(),
]);

export function TokenSelector({ isOpen, onClose, onSelect, selectedToken, side, walletScan }: TokenSelectorProps) {
  const { isConnected } = useAccount();
  const [searchQuery, setSearchQuery] = useState('');

  // Custom token import state
  const [importLoading, setImportLoading] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [customTokens, setCustomTokens] = useState<CustomToken[]>([]);
  const [previewMeta, setPreviewMeta] = useState<{ symbol: string; name: string; decimals: number } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  // Load custom tokens on mount
  useEffect(() => {
    setCustomTokens(getCustomTokens());
  }, []);

  // Wallet scan — provided by parent, runs on wallet connect
  const { balanceMap, isScanning, isBackgroundRefresh, scanComplete, progress, refresh: refreshBalances } = walletScan;

  // Price fetching — fetch prices for held tokens only
  const heldTokenAddresses = useMemo(() => {
    const addrs: string[] = [];
    for (const [addr, twb] of balanceMap) {
      if (twb.balance && twb.balance > 0n) {
        addrs.push(addr);
      }
    }
    return addrs;
  }, [balanceMap]);

  const { priceMap, dexMap } = useTokenPrices(heldTokenAddresses);

  const getFormattedBalance = (address: string): string => {
    return balanceMap.get(address.toLowerCase())?.formattedBalance || '0';
  };

  // Tokens with balance > 0, sorted: popular first, then by balance
  const heldTokens = useMemo(() => {
    const held: TokenType[] = [];
    for (const [addr, twb] of balanceMap) {
      if (twb.balance && twb.balance > 0n) {
        const token = TOKENS.find(t => t.address.toLowerCase() === addr);
        if (token) held.push(token);
      }
    }
    // Sort: popular first, then alphabetically
    held.sort((a, b) => {
      const aPop = POPULAR_TOKENS.has(a.address.toLowerCase()) ? 0 : 1;
      const bPop = POPULAR_TOKENS.has(b.address.toLowerCase()) ? 0 : 1;
      if (aPop !== bPop) return aPop - bPop;
      return a.symbol.localeCompare(b.symbol);
    });
    return held;
  }, [balanceMap]);

  // All tokens shown in default view: popular tokens (always visible) + held tokens + custom tokens
  const displayTokensDefault = useMemo(() => {
    const heldAddrs = new Set(heldTokens.map(t => t.address.toLowerCase()));

    // Popular tokens always visible so users can select buy-side tokens they don't hold
    const popularNotHeld = TOKENS.filter(
      t => POPULAR_TOKENS.has(t.address.toLowerCase()) && !heldAddrs.has(t.address.toLowerCase())
    );

    const customNotHeld: TokenType[] = customTokens
      .filter(ct => !heldAddrs.has(ct.address.toLowerCase()) && !POPULAR_TOKENS.has(ct.address.toLowerCase()))
      .map(ct => ({
        symbol: ct.symbol,
        name: ct.name,
        decimals: ct.decimals,
        address: ct.address,
        balance: ct.balance,
        icon: ct.icon || '',
        isImage: ct.isImage || false,
        isNative: ct.isNative || false,
      }));
    return [...heldTokens, ...popularNotHeld, ...customNotHeld];
  }, [heldTokens, customTokens]);

  // Search results across ALL tokens (including custom tokens)
  const searchResults = useMemo(() => {
    if (!searchQuery) return [];
    const q = searchQuery.replace(/^\$+/, '').toLowerCase();
    const results: TokenType[] = [];
    const seenAddresses = new Set<string>();

    const addToken = (t: TokenType) => {
      const addr = t.address.toLowerCase();
      if (seenAddresses.has(addr)) return;
      seenAddresses.add(addr);
      results.push(t);
    };

    // Search in main token list (by symbol, name, or address)
    for (const t of TOKENS) {
      if (t.symbol.toLowerCase().includes(q) || t.name.toLowerCase().includes(q) || t.address.toLowerCase().includes(q)) {
        addToken(t);
      }
    }

    // IMPORTANT: Also search in POPULAR_TOKENS to ensure DC, DINU, etc. are always searchable
    // even if they're not in the main TOKENS array
    for (const addr of POPULAR_TOKENS) {
      const token = TOKENS.find(t => t.address.toLowerCase() === addr);
      if (token && (token.symbol.toLowerCase().includes(q) || token.name.toLowerCase().includes(q) || addr.includes(q))) {
        addToken(token);
      }
    }

    // Search in custom tokens
    for (const t of customTokens) {
      if (t.symbol.toLowerCase().includes(q) || t.name.toLowerCase().includes(q) || t.address.toLowerCase().includes(q)) {
        addToken({
          symbol: t.symbol,
          name: t.name,
          decimals: t.decimals,
          address: t.address,
          balance: t.balance,
          icon: t.icon || '',
          isImage: t.isImage || false,
          isNative: t.isNative || false,
        });
      }
    }

    return results.slice(0, 100);
  }, [searchQuery, customTokens]);

  const refresh = () => {
    refreshBalances();
  };

  const handleAddCustomToken = async () => {
    const address = searchQuery.trim();
    if (!address || !isValidAddress(address)) return;
    if (isCustomToken(address)) {
      setImportError('Token already added');
      return;
    }

    setImportError(null);
    setImportLoading(true);

    try {
      const metadata = await fetchTokenMetadata(address);
      if (!metadata) {
        setImportError('Failed to fetch token metadata. Check if this is a valid ERC-20 token.');
        return;
      }

      const customToken: CustomToken = {
        address,
        symbol: metadata.symbol,
        name: metadata.name,
        decimals: metadata.decimals,
        balance: 0,
        isCustom: true,
        addedAt: Date.now(),
      };

      saveCustomToken(customToken);
      setCustomTokens(getCustomTokens());
      setSearchQuery('');
    } catch {
      setImportError('Failed to add token. Please try again.');
    } finally {
      setImportLoading(false);
    }
  };

  const handleRemoveCustomToken = (address: string) => {
    removeCustomToken(address);
    setCustomTokens(getCustomTokens());
  };

  // Auto-fetch metadata when search is a valid contract address
  useEffect(() => {
    const address = searchQuery.trim();
    if (!isValidAddress(address)) {
      setPreviewMeta(null);
      return;
    }
    // Already a custom token
    if (isCustomToken(address)) {
      setPreviewMeta(null);
      return;
    }
    // Already in TOKENS list
    if (TOKENS.some(t => t.address.toLowerCase() === address.toLowerCase())) {
      setPreviewMeta(null);
      return;
    }
    setPreviewLoading(true);
    let cancelled = false;
    fetchTokenMetadata(address).then(meta => {
      if (!cancelled) {
        setPreviewMeta(meta);
        setPreviewLoading(false);
      }
    }).catch(() => {
      if (!cancelled) {
        setPreviewMeta(null);
        setPreviewLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, [searchQuery, customTokens]);

  useEffect(() => {
    if (!isOpen) {
      setSearchQuery('');
      setImportError(null);
      setPreviewMeta(null);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const showSearch = searchQuery.length > 0;
  const displayTokens = showSearch ? searchResults : displayTokensDefault;
  const hasHeldTokens = displayTokensDefault.length > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose} role="dialog" aria-modal="true">
      <div
        className="bg-surface-container-low border border-outline-variant/20 w-full max-w-md mx-0 sm:mx-4 shadow-2xl max-h-[85vh] sm:max-h-[80vh] sm:rounded-2xl rounded-t-none overflow-hidden overflow-x-hidden"
        style={{ position: 'fixed', left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-outline-variant/15">
          <div className="flex items-center gap-2">
            <h3 className="font-headline font-bold text-lg uppercase tracking-tighter text-white">
              Select {side === 'sell' ? 'Sell' : 'Buy'} Token
            </h3>
            {isScanning && !isBackgroundRefresh && (
              <RefreshCw className="w-4 h-4 text-primary animate-spin" />
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={refresh}
              aria-label="Refresh token balances"
              className="text-on-surface-variant hover:text-white transition-colors cursor-pointer p-1"
            >
              <RefreshCw className={`w-5 h-5 ${isScanning ? 'animate-spin' : ''}`} />
            </button>
            <button
              onClick={onClose}
              aria-label="Close token selector"
              className="text-on-surface-variant hover:text-white transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Search */}
        <div className="p-4 border-b border-outline-variant/10">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-on-surface-variant" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => { setSearchQuery(e.target.value); setImportError(null); }}
              placeholder="Search by name, symbol, or paste contract address..."
              aria-label="Search tokens"
              className="w-full bg-surface-container-highest border border-outline-variant/20 text-white pl-10 pr-4 py-2.5 font-body text-sm focus:border-primary outline-none transition-colors"
              autoFocus
            />
          </div>
          {!showSearch && (
            <div className="mt-1 text-xs text-on-surface-variant font-body">
              {isScanning && !isBackgroundRefresh ? 'Scanning wallet...' : scanComplete ? `${heldTokens.length} token${heldTokens.length !== 1 ? 's' : ''} found` : ''}
              {!isScanning && !scanComplete && hasHeldTokens ? `${heldTokens.length} tokens found` : ''}
            </div>
          )}
          {showSearch && (
            <div className="mt-1 text-xs text-on-surface-variant font-body">
              {searchResults.length} result{searchResults.length !== 1 ? 's' : ''}
              {searchResults.length === 0 && !isValidAddress(searchQuery.trim()) && ' — paste a contract address to import'}
            </div>
          )}
        </div>

        {/* Scanning progress */}
        {isScanning && !isBackgroundRefresh && progress && !showSearch && (
          <div className="px-4 py-2 bg-primary/10 border-b border-primary/20">
            <p className="text-xs text-primary font-body">
              Scanning wallet... batch {progress.current}/{progress.total}
            </p>
          </div>
        )}

        {/* Token list */}
        <div className="max-h-80 overflow-y-auto custom-scrollbar">
          {displayTokens.length === 0 && !showSearch && (
            <div className="p-8 text-center text-on-surface-variant font-body text-sm">
              {!isConnected ? 'Connect wallet to see your tokens' : isScanning ? 'Scanning for tokens...' : scanComplete ? 'No tokens found in wallet' : 'Loading...'}
            </div>
          )}
          {showSearch && searchResults.length === 0 && !isValidAddress(searchQuery.trim()) && (
            <div className="p-8 text-center text-on-surface-variant font-body text-sm">
              No tokens found — paste a contract address to import
            </div>
          )}
          {showSearch && searchResults.length === 0 && isValidAddress(searchQuery.trim()) && (
            <div className="p-6">
              <div className="flex items-center gap-3 p-4 bg-primary/10 border border-primary/20">
                <div className="w-9 h-9 rounded-full overflow-hidden bg-surface-container-highest flex items-center justify-center shrink-0">
                  <Plus className="w-4 h-4 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  {previewLoading ? (
                    <p className="font-headline font-bold text-sm text-white">Loading metadata...</p>
                  ) : previewMeta ? (
                    <>
                      <p className="font-headline font-bold text-sm text-white">{previewMeta.symbol}</p>
                      <p className="text-xs text-on-surface-variant font-body truncate">{previewMeta.name}</p>
                    </>
                  ) : (
                    <p className="font-headline font-bold text-sm text-white">Unknown Token</p>
                  )}
                  <p className="text-xs text-on-surface-variant font-body truncate">{searchQuery.trim().slice(0, 10)}...{searchQuery.trim().slice(-6)}</p>
                  {importError && <p className="text-xs text-red-400 font-body mt-1">{importError}</p>}
                </div>
                <button
                  onClick={handleAddCustomToken}
                  disabled={importLoading || previewLoading || !previewMeta}
                  className="px-4 py-2 text-xs font-headline font-bold uppercase text-black bg-primary hover:bg-primary-dim disabled:bg-primary/30 disabled:cursor-not-allowed transition-colors cursor-pointer rounded"
                >
                  {importLoading ? 'Adding...' : 'Add'}
                </button>
              </div>
            </div>
          )}
          {displayTokens.length > 0 && (
            <>
              {!showSearch && hasHeldTokens && (
                <div className="px-4 pt-3 pb-1 text-xs font-headline uppercase tracking-wider text-on-surface-variant">
                  Your Tokens
                </div>
              )}
              {showSearch && (
                <div className="px-4 pt-3 pb-1 text-xs font-headline uppercase tracking-wider text-on-surface-variant">
                  Search Results
                </div>
              )}
              {displayTokens.map((token: TokenType) => renderTokenRow(token, selectedToken, getFormattedBalance, balanceMap, priceMap, dexMap, onSelect, onClose, customTokens, handleRemoveCustomToken))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function renderTokenRow(
  token: TokenType,
  selectedToken: TokenType | undefined,
  getFormattedBalance: (address: string) => string,
  balanceMap: Map<string, { balance?: bigint; decimals: number }>,
  priceMap: Map<string, number>,
  dexMap: Map<string, Set<string>>,
  onSelect: (token: TokenType) => void,
  onClose: () => void,
  customTokens: CustomToken[],
  onRemoveCustom: (address: string) => void,
): React.ReactElement {
  const isSelected = selectedToken?.symbol === token.symbol;
  const balance = getFormattedBalance(token.address);
  const hasBalance = balance !== '0';

  const price = priceMap.get(token.address.toLowerCase());
  const tokenDexes = dexMap.get(token.address.toLowerCase());

  let usdValue: number | null = null;
  const twb = balanceMap.get(token.address.toLowerCase());
  if (price !== undefined && price > 0 && twb?.balance && twb.balance > 0n) {
    const decimals = twb.decimals ?? 18;
    const balanceValue = Number(twb.balance) / Math.pow(10, decimals);
    usdValue = balanceValue * price;
  }

  return (
    <button
      key={token.address}
      onClick={() => {
        onSelect(token);
        onClose();
      }}
      disabled={isSelected}
      className={`w-full flex items-center gap-3 px-4 py-3 transition-colors cursor-pointer ${
        isSelected
          ? 'bg-primary/5 border-l-2 border-l-primary'
          : hasBalance
          ? 'bg-primary/5 border-l-2 border-l-primary/30 hover:bg-surface-container-high'
          : 'hover:bg-surface-container-high border-l-2 border-l-transparent'
      }`}
    >
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

      <div className="flex-1 text-left min-w-0">
        <div className="font-headline font-bold text-sm text-white flex items-center gap-1.5 flex-wrap">
          {token.symbol}
          {/* Custom token badge */}
          {customTokens.some(ct => ct.address.toLowerCase() === token.address.toLowerCase()) && (
            <span className="text-[9px] px-1.5 py-0.5 bg-purple-500/20 text-purple-400 rounded font-body">
              CUSTOM
            </span>
          )}
          {tokenDexes && [...tokenDexes].map(dexId => {
            const style = DEX_COLORS[dexId];
            const displayName = style?.label ?? resolveDexName(dexId);
            // Unknown DEX — show resolved name (may be address or proper name)
            if (!style) {
              const isAddress = dexId.startsWith('0x') && dexId.length === 42;
              return (
                <span key={dexId} className="text-[9px] px-1 py-0.5 bg-gray-500/20 text-gray-400 rounded font-body">
                  {isAddress ? `${dexId.slice(0, 6)}...` : displayName}
                </span>
              );
            }
            return (
              <span key={dexId} className={`text-[9px] px-1.5 py-0.5 ${style.bg} ${style.text} rounded font-body`}>
                {style.label}
              </span>
            );
          })}
          <TaxBadge taxInfo={getCachedTaxInfo(token.address)} />
        </div>
        <div className="text-xs text-on-surface-variant font-body truncate">{token.name}</div>
      </div>

      <div className="text-right overflow-hidden">
        <div className="text-sm font-body text-white truncate whitespace-nowrap">
          {balance}
        </div>
        {usdValue !== null && usdValue > 0 && (
          <div className="text-xs text-on-surface-variant font-body truncate whitespace-nowrap">
            {formatCompactPrice(usdValue)}
          </div>
        )}
        {/* Remove button for custom tokens */}
        {customTokens.some(ct => ct.address.toLowerCase() === token.address.toLowerCase()) && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onRemoveCustom(token.address);
            }}
            className="text-xs text-red-400 hover:text-red-300 cursor-pointer font-body mt-1"
          >
            Remove
          </button>
        )}
      </div>
    </button>
  );
}
