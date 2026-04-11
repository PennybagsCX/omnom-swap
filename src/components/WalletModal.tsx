import React from 'react';
import { useConnect, useDisconnect, useAccount } from 'wagmi';
import { Ghost, X } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

export function WalletModal({ isOpen, onClose }: { isOpen: boolean, onClose: () => void }) {
  const { connectors, connect } = useConnect();
  const { disconnect } = useDisconnect();
  const { isConnected, address } = useAccount();

  return (
    <AnimatePresence>
      {isOpen && (
        <React.Fragment>
          <motion.div 
            initial={{ opacity: 0 }} 
            animate={{ opacity: 1 }} 
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[100] flex flex-col items-center justify-center p-4"
          >
            <motion.div 
              initial={{ scale: 0.95, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 20 }}
              className="w-full max-w-md bg-surface-container-low border border-outline-variant/30 shadow-[0_0_50px_rgba(255,215,0,0.1)] relative"
            >
              <div className="flex justify-between items-center p-6 border-b border-outline-variant/15">
                <h2 className="font-headline font-black text-2xl uppercase tracking-tighter text-white flex items-center gap-2">
                  <Ghost className="w-6 h-6 text-primary" />
                  Connect Wallet
                </h2>
                <button onClick={onClose} className="text-on-surface-variant hover:text-white transition-colors cursor-pointer">
                  <X className="w-6 h-6" />
                </button>
              </div>

              <div className="p-6 flex flex-col gap-4">
                {isConnected ? (
                  <div className="flex flex-col gap-4">
                    <div className="bg-surface-container-high p-4 border-l-4 border-primary">
                      <span className="text-[10px] font-headline uppercase tracking-widest text-on-surface-variant mb-1 block">Connected As</span>
                      <span className="font-mono text-white break-all">{address}</span>
                    </div>
                    <button 
                      onClick={() => { disconnect(); onClose(); }}
                      className="w-full bg-secondary text-white font-headline font-black py-4 uppercase tracking-tighter hover:bg-white hover:text-black transition-colors cursor-pointer"
                    >
                      Disconnect Node
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-col gap-3">
                    <p className="font-body text-sm text-on-surface-variant mb-2">Select a provider to interface with the Dogechain network.</p>
                    {connectors.map((connector) => (
                      <button
                        key={connector.uid}
                        onClick={() => { connect({ connector }); setTimeout(() => onClose(), 100); }}
                        className="w-full group flex items-center justify-between p-4 bg-surface text-on-surface border border-outline-variant/30 hover:border-primary hover:bg-surface-container-high transition-all cursor-pointer"
                      >
                        <span className="font-headline font-bold text-lg uppercase tracking-tighter text-white">{connector.name}</span>
                        <div className="w-8 h-8 bg-surface-container-highest flex items-center justify-center group-hover:bg-primary/20 transition-colors">
                          <div className="w-2 h-2 bg-primary group-hover:animate-ping"></div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </motion.div>
          </motion.div>
        </React.Fragment>
      )}
    </AnimatePresence>
  );
}
