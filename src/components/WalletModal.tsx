import { useState, useCallback, useMemo } from 'react';
import { useConnect, useDisconnect, useAccount, useChainId, useSwitchChain } from 'wagmi';
import { dogechain } from 'wagmi/chains';
import { Ghost, X, AlertTriangle } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

const DOGECHAIN_ID = dogechain.id;

interface WalletModalProps {
  isOpen: boolean;
  onClose: () => void;
  onToast?: (toast: { type: 'success' | 'error' | 'warning'; title: string; message: string }) => void;
}

/** Detect the actual injected provider from window.ethereum */
function detectInjectedProvider(): { name: string; icon: string } | null {
  const ethereum = (window as unknown as { ethereum?: Record<string, unknown> }).ethereum;
  if (!ethereum) return null;

  // Check for specific providers — order matters (most specific first)
  if (ethereum.isRabby) return { name: 'Rabby', icon: '/wallets/rabby.svg' };
  if (ethereum.isTrust || ethereum.isTrustWallet) return { name: 'Trust Wallet', icon: '/wallets/trust.svg' };
  if (ethereum.isCoinbaseWallet) return { name: 'Coinbase Wallet', icon: '/wallets/coinbase.svg' };
  if (ethereum.isMetaMask) return { name: 'MetaMask', icon: '/wallets/metamask.svg' };

  return null; // Unknown provider — will use generic "Browser Wallet"
}

/** Map connector IDs to friendly display info */
function getWalletMeta(connectorId: string, connectorName: string) {
  const id = connectorId.toLowerCase();

  if (id.includes('metamask')) return { name: 'MetaMask', icon: '/wallets/metamask.svg' };
  if (id.includes('walletconnect') || id.includes('wc')) return { name: 'WalletConnect', icon: '/wallets/walletconnect.svg' };
  if (id.includes('coinbase')) return { name: 'Coinbase Wallet', icon: '/wallets/coinbase.svg' };

  // Generic injected connector — auto-detect the actual provider
  if (id.includes('injected')) {
    const detected = detectInjectedProvider();
    if (detected) return detected;
    return { name: 'Browser Wallet', icon: '/wallets/browser.svg' };
  }

  // Fallback: use the connector's own name
  return { name: connectorName, icon: '/wallets/fallback.svg' };
}

/**
 * Translate a raw wagmi/viem error into a human-readable message.
 * Handles the "m is not a function" minified error that occurs when
 * window.ethereum is present but incomplete (common in Telegram browser).
 */
function formatConnectionError(err: unknown): string {
  if (err instanceof Error) {
    const msg = err.message || '';
    const lower = msg.toLowerCase();

    // User rejected the connection prompt
    if (lower.includes('rejected') || lower.includes('denied') || lower.includes('user rejected')) {
      return 'Connection request was rejected';
    }

    // Minified runtime error — "m is not a function", "t is not a function", etc.
    // This happens when the wallet provider object is incomplete/broken.
    if (/^\w is not a function$/i.test(msg)) {
      return 'Wallet provider is not available. Try opening this page in a regular browser (Chrome/Safari) or use WalletConnect instead.';
    }

    // No provider / wallet not installed
    if (lower.includes('no provider') || lower.includes('no ethereum') || lower.includes('not found')) {
      return 'No wallet extension detected. Please install MetaMask or use WalletConnect.';
    }

    // Wallet already processing a request
    if (lower.includes('already processing') || lower.includes('pending')) {
      return 'Wallet is already processing a request. Please check your wallet extension.';
    }

    // Chain / network errors
    if (lower.includes('chain') && lower.includes('not configured')) {
      return 'Dogechain is not configured in your wallet. Please add it manually.';
    }

    // Truncate very long errors
    if (msg.length > 120) {
      return msg.substring(0, 120) + '…';
    }

    return msg;
  }

  return 'An unexpected error occurred while connecting';
}

export function WalletModal({ isOpen, onClose, onToast }: WalletModalProps) {
  const { connectors, connectAsync } = useConnect();
  const { disconnect } = useDisconnect();
  const { isConnected, address } = useAccount();
  const chainId = useChainId();
  const { switchChain } = useSwitchChain();
  const [pendingConnector, setPendingConnector] = useState<string | null>(null);
  const [pendingVirtual, setPendingVirtual] = useState(false);
  const isWrongNetwork = isConnected && chainId !== DOGECHAIN_ID;

  // Deduplicate connectors: when an injected provider is present, the generic
  // injected() connector already covers any injected wallet (MetaMask, Rabby,
  // Coinbase, etc.), so we skip dedicated connectors that would connect to the
  // same underlying provider to avoid showing duplicate entries.
  const detectedProvider = detectInjectedProvider();
  const hasInjectedProvider = !!(window as unknown as { ethereum?: unknown }).ethereum;
  const deduplicatedConnectors = useMemo(() => {
    if (!hasInjectedProvider) return connectors;

    return connectors.filter(c => {
      const id = c.id.toLowerCase();
      // Always hide the dedicated MetaMask connector — the injected()
      // connector already wraps whatever provider window.ethereum points to.
      if (id.includes('metamask')) return false;

      // If the injected provider is Coinbase Wallet, also hide the dedicated
      // coinbaseWallet() connector to avoid a duplicate "Coinbase Wallet" entry.
      if (id.includes('coinbase') && detectedProvider?.name === 'Coinbase Wallet') {
        return false;
      }

      return true;
    });
  }, [connectors, hasInjectedProvider, detectedProvider?.name]);

  const handleConnect = useCallback(async (connector: typeof connectors[number]) => {
    setPendingConnector(connector.uid);
    try {
      await connectAsync({ connector, chainId: DOGECHAIN_ID });
      setPendingConnector(null);
      onToast?.({ type: 'success', title: 'Wallet Connected', message: 'Ready to swap on Dogechain' });
      setTimeout(() => onClose(), 300);
    } catch (err: unknown) {
      setPendingConnector(null);
      const message = formatConnectionError(err);
      onToast?.({ type: 'error', title: 'Connection Failed', message });
    }
  }, [connectAsync, onToast, onClose]);

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[100] flex flex-col items-center justify-center p-4"
          onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.95, opacity: 0, y: 20 }}
            className="w-full max-w-md bg-surface-container-low border border-outline-variant/30 shadow-[0_0_50px_rgba(255,215,0,0.1)] relative"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-center p-6 border-b border-outline-variant/15">
              <h2 className="font-headline font-black text-2xl uppercase tracking-tighter text-white flex items-center gap-2">
                <Ghost className="w-6 h-6 text-primary" />
                {isWrongNetwork ? 'Wrong Network' : 'Connect Wallet'}
              </h2>
              <button onClick={onClose} aria-label="Close wallet modal" className="text-on-surface-variant hover:text-white transition-colors cursor-pointer">
                <X className="w-6 h-6" />
              </button>
            </div>

            <div className="p-6 flex flex-col gap-4">
              {isWrongNetwork ? (
                <div className="flex flex-col gap-4">
                  <div className="flex items-center gap-3 bg-red-900/20 border border-red-500/30 p-4">
                    <AlertTriangle className="w-6 h-6 text-red-400 shrink-0" />
                    <div>
                      <p className="text-sm font-headline font-bold text-white uppercase">Wrong Network Detected</p>
                      <p className="text-xs text-on-surface-variant mt-1">Switch to Dogechain (Chain ID: 2000) to use OMNOM Swap.</p>
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      switchChain({ chainId: DOGECHAIN_ID });
                      onToast?.({ type: 'success', title: 'Switching Network', message: 'Switching to Dogechain...' });
                      onClose();
                    }}
                    aria-label="Switch to Dogechain network"
                    className="w-full bg-primary text-black font-headline font-black py-4 uppercase tracking-tighter hover:bg-white hover:text-black transition-colors cursor-pointer"
                  >
                    Switch to Dogechain
                  </button>
                  <button
                    onClick={() => { disconnect(); onClose(); }}
                    className="w-full border border-outline-variant/30 text-on-surface-variant font-headline font-bold py-3 uppercase tracking-widest text-sm hover:text-white hover:border-primary/50 transition-colors cursor-pointer"
                  >
                    Disconnect
                  </button>
                </div>
              ) : isConnected ? (
                <div className="flex flex-col gap-4">
                  <div className="bg-surface-container-high p-4 border-l-4 border-primary">
                    <span className="text-[10px] font-headline uppercase tracking-widest text-on-surface-variant mb-1 block">Connected As</span>
                    <span className="font-mono text-white break-all">{address}</span>
                  </div>
                  <a
                    href={`https://explorer.dogechain.dog/address/${address}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-full text-center py-2 text-xs font-headline uppercase tracking-widest text-primary hover:text-white border border-primary/30 hover:border-primary transition-colors"
                  >
                    View on Explorer
                  </a>
                  <button
                    onClick={() => {
                      disconnect();
                      onToast?.({ type: 'warning', title: 'Wallet Disconnected', message: 'You have been disconnected' });
                      onClose();
                    }}
                    className="w-full bg-secondary text-white font-headline font-black py-4 uppercase tracking-tighter hover:bg-white hover:text-black transition-colors cursor-pointer"
                  >
                    Disconnect Wallet
                  </button>
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  <p className="font-body text-sm text-on-surface-variant mb-2">Select a provider to interface with the Dogechain network.</p>
                  {(() => {
                    // Find the WalletConnect connector for virtual wallets
                    const wcConnector = deduplicatedConnectors.find(c =>
                      c.id.toLowerCase().includes('walletconnect') || c.id.toLowerCase().includes('wc')
                    );

                    // Build the display list: real connectors + virtual Trust Wallet
                    const displayItems: Array<{
                      key: string;
                      name: string;
                      icon: string;
                      connector: typeof connectors[number];
                      isVirtual?: boolean;
                    }> = deduplicatedConnectors.map(c => {
                      const meta = getWalletMeta(c.id, c.name);
                      return { key: c.uid, name: meta.name, icon: meta.icon, connector: c };
                    });

                    // Add Trust Wallet as a virtual entry (connects via WalletConnect)
                    // Only show if Trust Wallet is NOT already detected as the injected provider
                    if (wcConnector && detectedProvider?.name !== 'Trust Wallet') {
                      displayItems.splice(1, 0, {
                        key: 'trust-virtual',
                        name: 'Trust Wallet',
                        icon: '/wallets/trust.svg',
                        connector: wcConnector,
                        isVirtual: true,
                      });
                    }

                    const isPending = pendingConnector !== null || pendingVirtual;

                    return displayItems.map(item => {
                      const isThisPending = item.isVirtual
                        ? pendingVirtual
                        : pendingConnector === item.connector.uid;
                      return (
                        <button
                          key={item.key}
                          onClick={async () => {
                            if (item.isVirtual) {
                              setPendingVirtual(true);
                              try {
                                await connectAsync({ connector: item.connector, chainId: DOGECHAIN_ID });
                                setPendingVirtual(false);
                                onToast?.({ type: 'success', title: 'Wallet Connected', message: 'Ready to swap on Dogechain' });
                                setTimeout(() => onClose(), 300);
                              } catch (err: unknown) {
                                setPendingVirtual(false);
                                const message = formatConnectionError(err);
                                onToast?.({ type: 'error', title: 'Connection Failed', message });
                              }
                            } else {
                              handleConnect(item.connector);
                            }
                          }}
                          disabled={isPending}
                          className="w-full group flex items-center justify-between p-4 bg-surface text-on-surface border border-outline-variant/30 hover:border-primary hover:bg-surface-container-high transition-all cursor-pointer disabled:opacity-50"
                        >
                          <span className="font-headline font-bold text-lg uppercase tracking-tighter text-white flex items-center gap-3">
                            <img src={item.icon} alt={item.name} className="w-8 h-8 rounded-sm" />
                            {isThisPending ? 'Connecting...' : item.name}
                          </span>
                          <div className="w-8 h-8 bg-surface-container-highest flex items-center justify-center group-hover:bg-primary/20 transition-colors">
                            {isThisPending ? (
                              <div className="w-2 h-2 bg-primary animate-pulse" />
                            ) : (
                              <div className="w-2 h-2 bg-primary group-hover:animate-ping" />
                            )}
                          </div>
                        </button>
                      );
                    });
                  })()}
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
