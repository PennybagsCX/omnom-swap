/**
 * @file useAutoAddChain.test.ts
 * @description Tests for the useAutoAddChain hook's core logic.
 *
 * Since the hook cannot be called outside a React component tree,
 * we extract and test the pure logic functions that power it:
 *   - isChainNotAddedError detection
 *   - autoAddAndSwitch behavior through the mock switchChain
 *
 * Coverage:
 *   1. Happy path — switchChain succeeds immediately
 *   2. Chain not configured (4902) — auto-adds Dogechain via wallet_addEthereumChain
 *   3. User rejection on switch — returns "rejected" message
 *   4. User rejection on add — returns "rejected" message
 *   5. Other errors — returns generic failure message
 *   6. No wallet provider — returns "no wallet" message
 *
 * Reference: src/hooks/useAutoAddChain.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Polyfill globalThis.window for Node.js test environment ────────────────

if (typeof (globalThis as Record<string, unknown>).window === 'undefined') {
  (globalThis as Record<string, unknown>).window = globalThis;
}

// ─── Constants (mirrored from useAutoAddChain.ts) ───────────────────────────

const CHAIN_NOT_ADDED_ERROR_CODE = 4902;
const DOGECHAIN_ID = 2000;

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

// ─── Replicated logic from useAutoAddChain.ts ───────────────────────────────
// These functions are replicated for testing since they are file-scoped.

function isChainNotAddedError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;

  const error = err as { code?: number; cause?: { code?: number } };
  if (error.code === CHAIN_NOT_ADDED_ERROR_CODE) return true;
  if (error.cause?.code === CHAIN_NOT_ADDED_ERROR_CODE) return true;

  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    if (msg.includes('chain') && msg.includes('not configured')) return true;
    if (msg.includes('unrecognized chain') || msg.includes('chain not added')) return true;
    if (msg.includes('try adding the chain')) return true;
  }

  return false;
}

/**
 * Replicates the autoAddAndSwitch logic from the hook.
 * Takes a mock switchChain function for testing.
 */
async function autoAddAndSwitch(
  switchChain: () => void,
): Promise<{ success: boolean; message: string }> {
  try {
    switchChain();
    return { success: true, message: 'Switching to Dogechain...' };
  } catch (err: unknown) {
    if (isChainNotAddedError(err)) {
      try {
        const ethereum = (globalThis as unknown as {
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
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function createMockEthereum(overrides: Record<string, unknown> = {}) {
  return {
    isMetaMask: true,
    request: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

let originalEthereum: unknown;

beforeEach(() => {
  originalEthereum = (globalThis as Record<string, unknown>).ethereum;
});

afterEach(() => {
  (globalThis as Record<string, unknown>).ethereum = originalEthereum;
  vi.restoreAllMocks();
});

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('useAutoAddChain', () => {
  // ── isChainNotAddedError ─────────────────────────────────────────────────

  describe('isChainNotAddedError', () => {
    it('detects error code 4902', () => {
      const err = new Error('Unrecognized chain');
      (err as unknown as { code: number }).code = 4902;
      expect(isChainNotAddedError(err)).toBe(true);
    });

    it('detects 4902 in cause chain', () => {
      const err = new Error('Switch chain failed');
      (err as unknown as { cause: { code: number } }).cause = { code: 4902 };
      expect(isChainNotAddedError(err)).toBe(true);
    });

    it('detects "chain" + "not configured" message', () => {
      expect(isChainNotAddedError(new Error('Chain is not configured in your wallet'))).toBe(true);
    });

    it('detects "unrecognized chain" message', () => {
      expect(isChainNotAddedError(new Error('Unrecognized chain ID'))).toBe(true);
    });

    it('detects "chain not added" message', () => {
      expect(isChainNotAddedError(new Error('Chain not added to wallet'))).toBe(true);
    });

    it('detects "try adding the chain" message', () => {
      expect(isChainNotAddedError(new Error('Try adding the chain first'))).toBe(true);
    });

    it('returns false for non-chain errors', () => {
      expect(isChainNotAddedError(new Error('User rejected'))).toBe(false);
    });

    it('returns false for null', () => {
      expect(isChainNotAddedError(null)).toBe(false);
    });

    it('returns false for undefined', () => {
      expect(isChainNotAddedError(undefined)).toBe(false);
    });

    it('returns false for string throws', () => {
      expect(isChainNotAddedError('some error')).toBe(false);
    });
  });

  // ── autoAddAndSwitch logic ───────────────────────────────────────────────

  describe('autoAddAndSwitch', () => {
    it('returns success when switchChain succeeds', async () => {
      const mockSwitchChain = vi.fn();

      const result = await autoAddAndSwitch(mockSwitchChain);

      expect(result.success).toBe(true);
      expect(result.message).toBe('Switching to Dogechain...');
      expect(mockSwitchChain).toHaveBeenCalled();
    });

    it('auto-adds Dogechain when switchChain throws 4902', async () => {
      const mockSwitchChain = vi.fn(() => {
        const err = new Error('Unrecognized chain');
        (err as unknown as { code: number }).code = 4902;
        throw err;
      });
      const mockRequest = vi.fn().mockResolvedValue(undefined);
      (globalThis as Record<string, unknown>).ethereum = createMockEthereum({
        request: mockRequest,
      });

      const result = await autoAddAndSwitch(mockSwitchChain);

      expect(result.success).toBe(true);
      expect(result.message).toBe('Dogechain added! Switching network...');
      expect(mockRequest).toHaveBeenCalledWith({
        method: 'wallet_addEthereumChain',
        params: [
          expect.objectContaining({
            chainId: '0x7d0',
            chainName: 'Dogechain',
          }),
        ],
      });
    });

    it('detects 4902 error via cause chain', async () => {
      const mockSwitchChain = vi.fn(() => {
        const err = new Error('Switch chain failed');
        (err as unknown as { cause: { code: number } }).cause = { code: 4902 };
        throw err;
      });
      const mockRequest = vi.fn().mockResolvedValue(undefined);
      (globalThis as Record<string, unknown>).ethereum = createMockEthereum({
        request: mockRequest,
      });

      const result = await autoAddAndSwitch(mockSwitchChain);

      expect(result.success).toBe(true);
      expect(result.message).toBe('Dogechain added! Switching network...');
    });

    it('detects chain-not-added via error message patterns', async () => {
      const mockSwitchChain = vi.fn(() => {
        throw new Error('Chain is not configured in your wallet');
      });
      const mockRequest = vi.fn().mockResolvedValue(undefined);
      (globalThis as Record<string, unknown>).ethereum = createMockEthereum({
        request: mockRequest,
      });

      const result = await autoAddAndSwitch(mockSwitchChain);

      expect(result.success).toBe(true);
      expect(mockRequest).toHaveBeenCalled();
    });

    it('returns error when user rejects the network switch', async () => {
      const mockSwitchChain = vi.fn(() => {
        throw new Error('User rejected the request');
      });

      const result = await autoAddAndSwitch(mockSwitchChain);

      expect(result.success).toBe(false);
      expect(result.message).toBe('Network switch was rejected.');
    });

    it('returns error when user rejects the network addition', async () => {
      const mockSwitchChain = vi.fn(() => {
        const err = new Error();
        (err as unknown as { code: number }).code = 4902;
        throw err;
      });
      const mockRequest = vi.fn().mockRejectedValue(new Error('User rejected the request'));
      (globalThis as Record<string, unknown>).ethereum = createMockEthereum({
        request: mockRequest,
      });

      const result = await autoAddAndSwitch(mockSwitchChain);

      expect(result.success).toBe(false);
      expect(result.message).toBe('Network addition was rejected.');
    });

    it('returns error when wallet_addEthereumChain fails for other reasons', async () => {
      const mockSwitchChain = vi.fn(() => {
        const err = new Error();
        (err as unknown as { code: number }).code = 4902;
        throw err;
      });
      const mockRequest = vi.fn().mockRejectedValue(new Error('Internal error'));
      (globalThis as Record<string, unknown>).ethereum = createMockEthereum({
        request: mockRequest,
      });

      const result = await autoAddAndSwitch(mockSwitchChain);

      expect(result.success).toBe(false);
      expect(result.message).toBe('Failed to add Dogechain. Please add it manually in your wallet settings.');
    });

    it('returns error when no wallet provider is available (4902 path)', async () => {
      (globalThis as Record<string, unknown>).ethereum = undefined;
      const mockSwitchChain = vi.fn(() => {
        const err = new Error();
        (err as unknown as { code: number }).code = 4902;
        throw err;
      });

      const result = await autoAddAndSwitch(mockSwitchChain);

      expect(result.success).toBe(false);
      expect(result.message).toBe('No wallet provider found. Please install MetaMask or use WalletConnect.');
    });

    it('returns generic error for other switch failures', async () => {
      const mockSwitchChain = vi.fn(() => {
        throw new Error('Something unexpected happened');
      });

      const result = await autoAddAndSwitch(mockSwitchChain);

      expect(result.success).toBe(false);
      expect(result.message).toBe('Failed to switch network. Please try switching manually in your wallet.');
    });

    it('handles non-Error throws gracefully', async () => {
      const mockSwitchChain = vi.fn(() => {
        throw 'string error';
      });

      const result = await autoAddAndSwitch(mockSwitchChain);

      expect(result.success).toBe(false);
      expect(result.message).toBe('Failed to switch network. Please try switching manually in your wallet.');
    });

    it('handles null/undefined errors gracefully', async () => {
      const mockSwitchChain = vi.fn(() => {
        throw null;
      });

      const result = await autoAddAndSwitch(mockSwitchChain);

      expect(result.success).toBe(false);
    });
  });
});
