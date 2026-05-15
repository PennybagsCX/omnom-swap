import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { useConnect, useDisconnect, useAccount, useChainId } from 'wagmi';
import type { Connector } from 'wagmi';
import { dogechain } from 'wagmi/chains';
import { Ghost, X, AlertTriangle, Check } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import {
  detectProviderConflict,
  setPreferredWallet,
  waitForProvider,
  type ProviderConflictInfo,
} from '../lib/walletProviderManager';
import { useAutoAddChain } from '../hooks/useAutoAddChain';
import { useMetaMaskStatus } from '../hooks/useMetaMaskStatus';

const DOGECHAIN_ID = dogechain.id;

interface WalletModalProps {
  isOpen: boolean;
  onClose: () => void;
  onToast?: (toast: { type: 'success' | 'error' | 'warning'; title: string; message: string }) => void;
}

/** Known EIP-6963 RDNS-to-display mappings */
const EIP6963_WALLET_MAP: Record<string, { name: string; icon: string }> = {
  'io.rabby': { name: 'Rabby', icon: '/wallets/rabby.svg' },
  'com.trustwallet': { name: 'Trust Wallet', icon: '/wallets/trust.svg' },
  'io.metamask': { name: 'MetaMask', icon: '/wallets/metamask.svg' },
  'com.coinbase': { name: 'Coinbase Wallet', icon: '/wallets/coinbase.svg' },
  'com.brave': { name: 'Brave Wallet', icon: '/wallets/browser.svg' },
  'com.frame': { name: 'Frame', icon: '/wallets/browser.svg' },
  'me.rainbow': { name: 'Rainbow', icon: '/wallets/browser.svg' },
  'com.okex': { name: 'OKX Wallet', icon: '/wallets/browser.svg' },
};

/** Map connector IDs to friendly display info */
function getWalletMeta(connectorId: string, connectorName: string) {
  const id = connectorId.toLowerCase();

  // Config-provided connectors
  if (id.includes('walletconnect') || id.includes('wc')) return { name: 'WalletConnect', icon: '/wallets/walletconnect.svg' };
  if (id.includes('coinbase')) return { name: 'Coinbase Wallet', icon: '/wallets/coinbase.svg' };

  // EIP-6963 auto-discovered connectors (RDNS-style IDs like io.rabby, com.trustwallet)
  const eip6963Match = EIP6963_WALLET_MAP[id];
  if (eip6963Match) return eip6963Match;

  // Partial match fallback for EIP-6963 IDs
  if (id.includes('rabby')) return { name: 'Rabby', icon: '/wallets/rabby.svg' };
  if (id.includes('trust')) return { name: 'Trust Wallet', icon: '/wallets/trust.svg' };
  if (id.includes('metamask')) return { name: 'MetaMask', icon: '/wallets/metamask.svg' };

  // Generic injected connector
  if (id.includes('injected')) {
    return { name: 'Browser Wallet', icon: '/wallets/browser.svg' };
  }

  // Unknown EIP-6963 connector — use the connector's own name if available
  if (id.includes('.')) {
    const cleanName = connectorName?.trim();
    if (cleanName && cleanName !== id) {
      return { name: cleanName, icon: '/wallets/browser.svg' };
    }
    return { name: 'Browser Wallet', icon: '/wallets/browser.svg' };
  }

  // Fallback: use the connector's own name
  return { name: connectorName || 'Browser Wallet', icon: '/wallets/fallback.svg' };
}

/**
 * Detect whether an error represents a user rejection (EIP-1193 code 4001,
 * or common rejection messages from wallets). Used to prevent the EIP-6963
 * fallback from opening a second connection attempt when the user intentionally
 * cancelled the first one.
 */
function isUserRejectionError(err: unknown): boolean {
  if (!err) return false;

  // EIP-1193 provider error with code 4001 (user rejected)
  if (typeof err === 'object' && err !== null) {
    const code = (err as { code?: number }).code;
    if (code === 4001) return true;
  }

  if (err instanceof Error) {
    const lower = err.message.toLowerCase();
    if (lower.includes('rejected') || lower.includes('denied') || lower.includes('user rejected')) {
      return true;
    }
  }

  // Wagmi/viem wraps errors — check the nested `cause` (ProviderError / RpcError)
  if (typeof err === 'object' && err !== null) {
    const cause = (err as { cause?: unknown }).cause;
    if (cause) return isUserRejectionError(cause);
  }

  return false;
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

    // Provider getter conflict (TypeError from inpage.js)
    if (lower.includes('cannot set property ethereum') || lower.includes('only a getter')) {
      return 'Wallet provider conflict detected. Try disabling other wallet extensions or refresh the page.';
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
  const [pendingConnector, setPendingConnector] = useState<string | null>(null);
  const [pendingVirtual, setPendingVirtual] = useState(false);
  const [connectionSuccess, setConnectionSuccess] = useState(false);
  const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isWrongNetwork = isConnected && chainId !== DOGECHAIN_ID;
  const { isMetaMaskInstalled } = useMetaMaskStatus();

  // Auto-add chain hook — handles wallet_addEthereumChain when chain not configured
  const { autoAddAndSwitch } = useAutoAddChain();

  // Wait for window.ethereum to be injected by wallet extensions.
  // This handles the race condition where the modal mounts before the
  // extension has finished injecting the provider. The providerReady
  // state triggers a re-render so deduplication logic can re-evaluate.
  const [providerReady, setProviderReady] = useState(false);
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    waitForProvider(1000).then((found) => {
      if (!cancelled) setProviderReady(found);
    });
    return () => { cancelled = true; };
  }, [isOpen]);

  // Detect provider conflicts using the wallet provider manager
  const conflictInfo: ProviderConflictInfo = useMemo(() => detectProviderConflict(), []);

  // ---------------------------------------------------------------------------
  // Connector deduplication
  // ---------------------------------------------------------------------------
  //
  // wagmi provides connectors from two sources:
  //   1. Config-provided: injected(), walletConnect(), coinbaseWallet()
  //   2. EIP-6963 auto-discovered: io.rabby, com.coinbase, io.metamask, etc.
  //
  // Rules (simple and predictable):
  //   - EIP-6963 connectors are ALWAYS shown — they represent specific wallets
  //   - Generic injected() is HIDDEN when any EIP-6963 connector exists
  //   - coinbaseWallet() is HIDDEN when EIP-6963 com.coinbase exists
  //   - walletConnect() is ALWAYS shown
  //   - A final name-based dedup pass catches remaining collisions
  //
  const deduplicatedConnectors = useMemo(() => {
    // When provider isn't ready yet (still waiting for extension injection),
    // show all connectors to avoid hiding something the user needs.
    if (!providerReady && !(window as unknown as { ethereum?: unknown }).ethereum) {
      return connectors;
    }

    // Identify EIP-6963 auto-discovered connectors (RDNS-style IDs containing dots)
    const eip6963Ids = new Set(
      connectors
        .filter(c => {
          const id = c.id.toLowerCase();
          return id.includes('.') &&
            !id.includes('walletconnect') &&
            !id.includes('wc');
        })
        .map(c => c.id.toLowerCase())
    );

    const hasEip6963 = eip6963Ids.size > 0;
    const hasCoinbaseEip6963 = eip6963Ids.has('com.coinbase');

    const filtered = connectors.filter(c => {
      const id = c.id.toLowerCase();

      // Hide generic injected() when any EIP-6963 connector exists.
      // EIP-6963 connectors are preferred — they target specific wallets.
      // The injected() connector is only useful when NO EIP-6963 connectors
      // are present (e.g. unknown wallet extension without EIP-6963 support).
      if (id === 'injected' && hasEip6963) {
        return false;
      }

      // Hide coinbaseWallet() when EIP-6963 com.coinbase exists
      if (id.includes('coinbase') && !id.includes('.') && hasCoinbaseEip6963) {
        return false;
      }

      return true;
    });

    return filtered;
  }, [connectors, providerReady]);

  // ---------------------------------------------------------------------------
  // Connection logic
  // ---------------------------------------------------------------------------

  /**
   * Race connectAsync against a timeout. EIP-6963 providers can hang
   * indefinitely when the wallet's background process is unreachable
   * (e.g. MetaMask's inpage.js can't connect to its extension background
   * when another wallet like Rabby controls window.ethereum).
   */
  const EIP6963_TIMEOUT_MS = 3_000;

  const handleConnect = useCallback(async (connector: typeof connectors[number]) => {
    // Determine the actual connector to use for connection.
    // When io.metamask EIP-6963 is selected but another wallet (Rabby, Trust,
    // Coinbase, Brave) controls window.ethereum, the EIP-6963 provider can't
    // open a popup — it silently hangs. Routing through the generic injected()
    // connector (which uses window.ethereum) lets the controlling wallet's
    // wrapped provider handle the request correctly.
    let activeConnector = connector;
    const isMetaMaskEip6963 = connector.id === 'io.metamask';

    if (isMetaMaskEip6963) {
      const eth = (window as unknown as Record<string, unknown>).ethereum as
        | Record<string, unknown>
        | undefined;
      const otherWalletDetected =
        eth?.isRabby || eth?.isTrust || eth?.isCoinbaseWallet || eth?.isBraveWallet;
      if (otherWalletDetected) {
        const injectedConn = connectors.find(c => c.id === 'injected');
        if (injectedConn) {
          console.warn(
            '[WalletModal] Another wallet controls window.ethereum — routing MetaMask through injected() connector'
          );
          activeConnector = injectedConn;
        }
      }
    }

    setPendingConnector(activeConnector.uid);

    const isEip6963 = activeConnector.id.includes('.') &&
      !activeConnector.id.toLowerCase().includes('walletconnect') &&
      !activeConnector.id.toLowerCase().includes('wc');

    // Find the generic injected() connector as a fallback for EIP-6963 failures.
    // When an EIP-6963 connector (e.g. io.metamask) fails because another wallet
    // controls window.ethereum, injected() can route through the controlling wallet's
    // wrapped provider to reach the target wallet.
    const injectedFallback = isEip6963
      ? connectors.find(c => c.id === 'injected')
      : undefined;

    try {
      if (isEip6963) {
        // Race connectAsync against a timeout for EIP-6963 connectors.
        // The provider may hang if the wallet background is unreachable.
        const result = await Promise.race([
          connectAsync({ connector: activeConnector, chainId: DOGECHAIN_ID }),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Connection timed out — wallet may be unreachable via EIP-6963')), EIP6963_TIMEOUT_MS)
          ),
        ]);
        void result;
      } else {
        await connectAsync({ connector: activeConnector, chainId: DOGECHAIN_ID });
      }

      setPendingConnector(null);

      // Show brief success animation before closing
      setConnectionSuccess(true);
      if (successTimerRef.current) clearTimeout(successTimerRef.current);
      successTimerRef.current = setTimeout(() => {
        setConnectionSuccess(false);
      }, 800);

      // Store the user's wallet preference for future provider resolution
      const meta = getWalletMeta(connector.id, connector.name);
      if (meta) {
        const walletId = connector.id.toLowerCase().includes('metamask') ? 'metamask'
          : connector.id.toLowerCase().includes('coinbase') ? 'coinbase'
          : connector.id.toLowerCase().includes('walletconnect') ? 'walletconnect'
          : connector.id.toLowerCase().includes('rabby') ? 'rabby'
          : connector.id.toLowerCase().includes('trust') ? 'trust'
          : 'injected';
        setPreferredWallet(walletId);
      }

      onToast?.({ type: 'success', title: 'Wallet Connected', message: 'Ready to swap on Dogechain' });
      setTimeout(() => onClose(), 300);
    } catch (err: unknown) {
      // If the user intentionally rejected the connection prompt (clicked
      // "Cancel" in the wallet extension), do NOT fall back to injected().
      if (isUserRejectionError(err)) {
        setPendingConnector(null);
        onToast?.({ type: 'error', title: 'Connection Rejected', message: 'Connection request was rejected' });
        return;
      }

      // For non-rejection errors (broken EIP-6963 provider, timeout, etc.),
      // fall back to the generic injected() connector which uses
      // window.ethereum directly and is more reliable when another wallet
      // wraps the target wallet's provider.
      if (injectedFallback) {
        try {
          setPendingConnector(injectedFallback.uid);
          await connectAsync({ connector: injectedFallback, chainId: DOGECHAIN_ID });
          setPendingConnector(null);

          setConnectionSuccess(true);
          if (successTimerRef.current) clearTimeout(successTimerRef.current);
          successTimerRef.current = setTimeout(() => setConnectionSuccess(false), 800);

          setPreferredWallet('injected');
          onToast?.({ type: 'success', title: 'Wallet Connected', message: 'Ready to swap on Dogechain' });
          setTimeout(() => onClose(), 300);
          return; // connected via fallback — don't show error
        } catch {
          // Fallback also failed — fall through to error display
        }
      }

      setPendingConnector(null);
      const message = formatConnectionError(err);
      onToast?.({ type: 'error', title: 'Connection Failed', message });
    }
  }, [connectAsync, connectors, onToast, onClose]);

  // Cleanup success timer on unmount
  useEffect(() => {
    return () => {
      if (successTimerRef.current) clearTimeout(successTimerRef.current);
    };
  }, []);

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
              {/* Provider conflict warning */}
              {conflictInfo.hasConflict && !isWrongNetwork && !isConnected && (
                <div className="flex items-start gap-3 bg-yellow-900/20 border border-yellow-500/30 p-3">
                  <AlertTriangle className="w-5 h-5 text-yellow-400 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-xs font-headline font-bold text-yellow-300 uppercase">
                      Multiple Wallets Detected
                    </p>
                    <p className="text-[11px] text-on-surface-variant mt-1">
                      {conflictInfo.ethereumIsGetter
                        ? 'Another extension has locked the provider. Connection should still work — if it fails, try disabling other wallet extensions.'
                        : `${conflictInfo.providers.length} wallet extensions detected. Select the one you want to use.`
                      }
                    </p>
                  </div>
                </div>
              )}

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
                    onClick={async () => {
                      const result = await autoAddAndSwitch();
                      onToast?.({
                        type: result.success ? 'success' : 'error',
                        title: result.success ? 'Switching Network' : 'Network Error',
                        message: result.message,
                      });
                      if (result.success) onClose();
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
                    // Find the WalletConnect connector for virtual wallet entries
                    const wcConnector = deduplicatedConnectors.find(c =>
                      c.id.toLowerCase().includes('walletconnect') || c.id.toLowerCase().includes('wc')
                    );

                    // Build the display list: real connectors first
                    const displayItems: Array<{
                      key: string;
                      name: string;
                      icon: string;
                      connector: Connector;
                      isVirtual?: boolean;
                    }> = deduplicatedConnectors.map(c => {
                      const meta = getWalletMeta(c.id, c.name);
                      return { key: c.uid, name: meta.name, icon: meta.icon, connector: c };
                    });

                    // Add "Trust Wallet" as a virtual entry that connects
                    // via WalletConnect QR / deep link. Only show when:
                    //   - WalletConnect connector is available
                    //   - No Trust Wallet EIP-6963 connector exists
                    //   - No Trust Wallet entry already in the display list
                    const existingNames = new Set(displayItems.map(d => d.name));
                    const trustAlreadyPresent = existingNames.has('Trust Wallet');
                    if (wcConnector && !trustAlreadyPresent) {
                      displayItems.push({
                        key: 'trust-virtual',
                        name: 'Trust Wallet',
                        icon: '/wallets/trust.svg',
                        connector: wcConnector,
                        isVirtual: true,
                      });
                    }

                    // Final name-based deduplication: if two entries share the same
                    // display name, keep only the first. This catches edge cases like
                    // both injected() and an EIP-6963 connector resolving to the same name.
                    const seenNames = new Set<string>();
                    const finalDisplayItems = displayItems.filter(item => {
                      if (seenNames.has(item.name)) return false;
                      seenNames.add(item.name);
                      return true;
                    });

                    const isPending = pendingConnector !== null || pendingVirtual;

                    return finalDisplayItems.map((item, index) => {
                      const isThisPending = item.isVirtual
                        ? pendingVirtual
                        : pendingConnector === item.connector.uid;
                      const isMetaMaskEntry = item.name === 'MetaMask';
                      const showMetaMaskAccent = isMetaMaskEntry && isMetaMaskInstalled;
                      const showSuccess = connectionSuccess && isThisPending;

                      return (
                        <motion.button
                          key={item.key}
                          initial={{ opacity: 0, y: 8 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ duration: 0.2, delay: index * 0.06, ease: 'easeOut' }}
                          onClick={async () => {
                            if (item.isVirtual) {
                              setPendingVirtual(true);
                              try {
                                await connectAsync({ connector: item.connector, chainId: DOGECHAIN_ID });
                                setPendingVirtual(false);
                                setConnectionSuccess(true);
                                if (successTimerRef.current) clearTimeout(successTimerRef.current);
                                successTimerRef.current = setTimeout(() => setConnectionSuccess(false), 800);
                                setPreferredWallet('trust');
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
                          className={`w-full group flex items-center justify-between p-4 min-h-[52px] bg-surface text-on-surface border transition-all cursor-pointer disabled:opacity-50 ${
                            showSuccess
                              ? 'border-green-400/60 bg-green-900/10'
                              : showMetaMaskAccent
                                ? 'border-l-2 border-l-orange-500 border-t border-r border-b border-t-outline-variant/30 border-r-outline-variant/30 border-b-outline-variant/30 hover:border-l-orange-400 hover:border-t-primary hover:border-r-primary hover:border-b-primary hover:bg-surface-container-high'
                                : 'border-outline-variant/30 hover:border-primary hover:bg-surface-container-high'
                          }`}
                        >
                          <span className="font-headline font-bold text-lg uppercase tracking-tighter text-white flex items-center gap-3 min-w-0">
                            <img src={item.icon} alt={item.name} className="w-8 h-8 rounded-sm shrink-0" />
                            <span className="truncate">{isThisPending && !showSuccess ? 'Connecting...' : item.name}</span>
                            {showMetaMaskAccent && !isThisPending && (
                              <span className="flex items-center gap-1.5 shrink-0">
                                <span className="w-1.5 h-1.5 bg-green-400 rounded-full shadow-[0_0_4px_rgba(74,222,128,0.6)]" />
                                <span className="text-[10px] font-body font-medium text-green-400/90 uppercase tracking-wider">Detected</span>
                              </span>
                            )}
                          </span>
                          <div className="w-8 h-8 bg-surface-container-highest flex items-center justify-center group-hover:bg-primary/20 transition-colors shrink-0">
                            {showSuccess ? (
                              <Check className="w-4 h-4 text-green-400" />
                            ) : isThisPending ? (
                              <div className="w-2 h-2 bg-primary animate-pulse" />
                            ) : (
                              <div className="w-2 h-2 bg-primary group-hover:animate-ping" />
                            )}
                          </div>
                        </motion.button>
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
