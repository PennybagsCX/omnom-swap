import { useCallback } from 'react';
import { useSwitchChain } from 'wagmi';
import { dogechain } from 'wagmi/chains';

/** Error code returned by wallets when the requested chain is not configured. */
const CHAIN_NOT_ADDED_ERROR_CODE = 4902;

const DOGECHAIN_ID = dogechain.id;

/**
 * Dogechain chain parameters for `wallet_addEthereumChain`.
 * These match the wagmi `dogechain` chain definition.
 */
const DOGECHAIN_CHAIN_PARAMS = {
  chainId: `0x${DOGECHAIN_ID.toString(16)}`,
  chainName: 'Dogechain',
  nativeCurrency: {
    name: 'DOGE',
    symbol: 'DOGE',
    decimals: 18,
  },
  rpcUrls: ['https://rpc.dogechain.dog'],
  blockExplorerUrls: ['https://explorer.dogechain.dog'],
} as const;

/**
 * Check if an error is the "chain not added" error (code 4902).
 * Works with both standard EIP-1193 errors and viem/wagmi wrapped errors.
 */
function isChainNotAddedError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;

  // Check for standard error code property
  const error = err as { code?: number; cause?: { code?: number } };
  if (error.code === CHAIN_NOT_ADDED_ERROR_CODE) return true;

  // viem wraps the original error in a `cause` property
  if (error.cause?.code === CHAIN_NOT_ADDED_ERROR_CODE) return true;

  // Fallback: check error message for known patterns
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    if (msg.includes('chain') && msg.includes('not configured')) return true;
    if (msg.includes('unrecognized chain') || msg.includes('chain not added')) return true;
    if (msg.includes('try adding the chain')) return true;
  }

  return false;
}

/**
 * Hook that attempts to switch to Dogechain, and if the chain is not
 * configured in the user's wallet, automatically adds it via
 * `wallet_addEthereumChain`.
 *
 * Returns an `autoAddAndSwitch` function that can be called imperatively.
 */
export function useAutoAddChain() {
  const { switchChain } = useSwitchChain();

  const autoAddAndSwitch = useCallback(async (): Promise<{ success: boolean; message: string }> => {
    try {
      switchChain({ chainId: DOGECHAIN_ID });
      return { success: true, message: 'Switching to Dogechain...' };
    } catch (err: unknown) {
      if (isChainNotAddedError(err)) {
        // Chain not configured — try to add it automatically
        try {
          const ethereum = (window as unknown as {
            ethereum?: { request: (args: { method: string; params?: unknown[] }) => Promise<unknown> };
          }).ethereum;

          if (!ethereum) {
            return {
              success: false,
              message: 'No wallet provider found. Please install MetaMask or use WalletConnect.',
            };
          }

          await ethereum.request({
            method: 'wallet_addEthereumChain',
            params: [DOGECHAIN_CHAIN_PARAMS],
          });

          return { success: true, message: 'Dogechain added! Switching network...' };
        } catch (addErr: unknown) {
          if (addErr instanceof Error) {
            const msg = addErr.message.toLowerCase();
            if (msg.includes('rejected') || msg.includes('denied') || msg.includes('user rejected')) {
              return { success: false, message: 'Network addition was rejected.' };
            }
          }
          return {
            success: false,
            message: 'Failed to add Dogechain. Please add it manually in your wallet settings.',
          };
        }
      }

      // Other switch errors
      if (err instanceof Error) {
        const msg = err.message.toLowerCase();
        if (msg.includes('rejected') || msg.includes('denied')) {
          return { success: false, message: 'Network switch was rejected.' };
        }
      }

      return {
        success: false,
        message: 'Failed to switch network. Please try switching manually in your wallet.',
      };
    }
  }, [switchChain]);

  return { autoAddAndSwitch };
}
