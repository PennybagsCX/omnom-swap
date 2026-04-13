import { useState } from 'react';
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

export function WalletModal({ isOpen, onClose, onToast }: WalletModalProps) {
  const { connectors, connect } = useConnect();
  const { disconnect } = useDisconnect();
  const { isConnected, address } = useAccount();
  const chainId = useChainId();
  const { switchChain } = useSwitchChain();
  const [pendingConnector, setPendingConnector] = useState<string | null>(null);
  const isWrongNetwork = isConnected && chainId !== DOGECHAIN_ID;

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
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-center p-6 border-b border-outline-variant/15">
              <h2 className="font-headline font-black text-2xl uppercase tracking-tighter text-white flex items-center gap-2">
                <Ghost className="w-6 h-6 text-primary" />
                {isWrongNetwork ? 'Wrong Network' : 'Connect Wallet'}
              </h2>
              <button onClick={onClose} className="text-on-surface-variant hover:text-white transition-colors cursor-pointer">
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
                  {connectors.map((connector) => (
                    <button
                      key={connector.uid}
                      onClick={() => {
                        setPendingConnector(connector.uid);
                        connect({ connector, chainId: DOGECHAIN_ID }, {
                          onSuccess: () => {
                            setPendingConnector(null);
                            onToast?.({ type: 'success', title: 'Wallet Connected', message: 'Ready to swap on Dogechain' });
                            setTimeout(() => onClose(), 300);
                          },
                          onError: (err) => {
                            setPendingConnector(null);
                            const msg = err.message || 'Connection failed';
                            onToast?.({ type: 'error', title: 'Connection Failed', message: msg.includes('rejected') ? 'User rejected connection' : msg.substring(0, 80) });
                          },
                        });
                      }}
                      disabled={pendingConnector !== null}
                      className="w-full group flex items-center justify-between p-4 bg-surface text-on-surface border border-outline-variant/30 hover:border-primary hover:bg-surface-container-high transition-all cursor-pointer disabled:opacity-50"
                    >
                      <span className="font-headline font-bold text-lg uppercase tracking-tighter text-white">
                        {pendingConnector === connector.uid ? 'Connecting...' : connector.name}
                      </span>
                      <div className="w-8 h-8 bg-surface-container-highest flex items-center justify-center group-hover:bg-primary/20 transition-colors">
                        {pendingConnector === connector.uid ? (
                          <div className="w-2 h-2 bg-primary animate-pulse" />
                        ) : (
                          <div className="w-2 h-2 bg-primary group-hover:animate-ping" />
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
