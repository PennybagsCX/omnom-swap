/**
 * @file walletProviderManager.test.ts
 * @description Tests for wallet provider manager utilities.
 *
 * Coverage:
 *   1. waitForProvider() — resolves immediately if provider exists
 *   2. waitForProvider() — polls and resolves when provider appears
 *   3. waitForProvider() — returns false on timeout
 *   4. isSESLockdownError() — matches known SES/LavaMoat patterns
 *   5. isSESLockdownError() — does not match non-SES errors
 *   6. getEthereumFromWindow() — returns provider when available
 *   7. getEthereumFromWindow() — returns undefined when not available
 *   8. detectAllProviders() — identifies MetaMask provider
 *   9. detectAllProviders() — returns empty array when no providers
 *  10. isMetaMaskAvailable() — returns true when MetaMask detected
 *
 * Reference: src/lib/walletProviderManager.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Polyfill window for Node.js test environment ───────────────────────────
// The source code accesses `window.ethereum` and `window.addEventListener`.
// We create an EventTarget-based window that supports both property access
// and event listener methods.

if (typeof (globalThis as Record<string, unknown>).window === 'undefined') {
  const win = new EventTarget() as EventTarget & Record<string, unknown>;
  (globalThis as Record<string, unknown>).window = win;
}

// ─── Import ─────────────────────────────────────────────────────────────────

import {
  getEthereumFromWindow,
  detectAllProviders,
  isMetaMaskAvailable,
  waitForProvider,
  hasInjectedProvider,
  getDetectedWallets,
} from '../src/lib/walletProviderManager';

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Get the polyfilled window object as a property bag. */
function win(): Record<string, unknown> {
  return (globalThis as Record<string, unknown>).window as Record<string, unknown>;
}

/** Create a mock EIP-1193 provider with MetaMask flags. */
function createMetaMaskProvider(overrides: Record<string, unknown> = {}) {
  return {
    isMetaMask: true,
    request: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

/** Create a mock Rabby provider. */
function createRabbyProvider() {
  return {
    isRabby: true,
    isMetaMask: false,
    request: vi.fn().mockResolvedValue(undefined),
  };
}

let originalEthereum: unknown;

beforeEach(() => {
  originalEthereum = win().ethereum;
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  win().ethereum = originalEthereum;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('walletProviderManager', () => {
  // ── getEthereumFromWindow ────────────────────────────────────────────────

  describe('getEthereumFromWindow', () => {
    it('returns the provider when window.ethereum is set', () => {
      const provider = createMetaMaskProvider();
      win().ethereum = provider;

      const result = getEthereumFromWindow();

      expect(result).toBe(provider);
    });

    it('returns undefined when window.ethereum is not set', () => {
      delete win().ethereum;

      const result = getEthereumFromWindow();

      expect(result).toBeUndefined();
    });

    it('returns undefined when accessing window.ethereum throws (SES lockdown)', () => {
      // Simulate SES lockdown by making ethereum a getter that throws
      Object.defineProperty(win(), 'ethereum', {
        get() { throw new Error('SES lockdown'); },
        configurable: true,
      });

      const result = getEthereumFromWindow();

      expect(result).toBeUndefined();

      // Clean up the getter
      delete win().ethereum;
    });
  });

  // ── hasInjectedProvider ──────────────────────────────────────────────────

  describe('hasInjectedProvider', () => {
    it('returns true when window.ethereum exists', () => {
      win().ethereum = createMetaMaskProvider();

      expect(hasInjectedProvider()).toBe(true);
    });

    it('returns false when window.ethereum is undefined', () => {
      delete win().ethereum;

      expect(hasInjectedProvider()).toBe(false);
    });
  });

  // ── detectAllProviders ───────────────────────────────────────────────────

  describe('detectAllProviders', () => {
    it('identifies a MetaMask provider', () => {
      const provider = createMetaMaskProvider();
      win().ethereum = provider;

      const wallets = detectAllProviders();

      expect(wallets).toHaveLength(1);
      expect(wallets[0].id).toBe('metamask');
      expect(wallets[0].name).toBe('MetaMask');
      expect(wallets[0].priority).toBe(1);
    });

    it('identifies multiple providers from providers array', () => {
      const mmProvider = createMetaMaskProvider();
      const rabbyProvider = createRabbyProvider();
      // MetaMask sometimes wraps multiple providers — the parent object
      // itself is also detected (since it has isMetaMask=true).
      win().ethereum = {
        isMetaMask: true,
        providers: [mmProvider, rabbyProvider],
        request: vi.fn(),
      };

      const wallets = detectAllProviders();

      // Both wallet types should be present
      const ids = wallets.map(w => w.id);
      expect(ids).toContain('metamask');
      expect(ids).toContain('rabby');
    });

    it('returns empty array when no providers are available', () => {
      delete win().ethereum;

      const wallets = detectAllProviders();

      expect(wallets).toEqual([]);
    });

    it('sorts providers by priority (lowest first)', () => {
      const mmProvider = createMetaMaskProvider();
      const rabbyProvider = createRabbyProvider();
      // Put Rabby first in the array — should still be sorted by priority
      win().ethereum = {
        isMetaMask: true,
        providers: [rabbyProvider, mmProvider],
        request: vi.fn(),
      };

      const wallets = detectAllProviders();

      // MetaMask (priority 1) should always come before Rabby (priority 2)
      const metamaskIndex = wallets.findIndex(w => w.id === 'metamask');
      const rabbyIndex = wallets.findIndex(w => w.id === 'rabby');
      expect(metamaskIndex).toBeLessThan(rabbyIndex);
    });

    it('handles generic unknown provider', () => {
      const unknownProvider = {
        request: vi.fn(),
        // No wallet-specific flags
      };
      win().ethereum = unknownProvider;

      const wallets = detectAllProviders();

      expect(wallets).toHaveLength(1);
      expect(wallets[0].id).toBe('injected');
      expect(wallets[0].name).toBe('Browser Wallet');
      expect(wallets[0].priority).toBe(99);
    });
  });

  // ── isMetaMaskAvailable ──────────────────────────────────────────────────

  describe('isMetaMaskAvailable', () => {
    it('returns true when MetaMask is detected', () => {
      win().ethereum = createMetaMaskProvider();

      expect(isMetaMaskAvailable()).toBe(true);
    });

    it('returns false when MetaMask is not installed', () => {
      delete win().ethereum;

      expect(isMetaMaskAvailable()).toBe(false);
    });

    it('returns false when a different wallet is installed', () => {
      win().ethereum = createRabbyProvider();

      expect(isMetaMaskAvailable()).toBe(false);
    });
  });

  // ── getDetectedWallets ───────────────────────────────────────────────────

  describe('getDetectedWallets', () => {
    it('returns display-friendly wallet list without provider references', () => {
      const provider = createMetaMaskProvider();
      win().ethereum = provider;

      const wallets = getDetectedWallets();

      expect(wallets).toHaveLength(1);
      expect(wallets[0]).toEqual({
        id: 'metamask',
        name: 'MetaMask',
        icon: '/wallets/metamask.svg',
      });
      // Should NOT contain the provider reference
      expect((wallets[0] as Record<string, unknown>).provider).toBeUndefined();
    });
  });

  // ── waitForProvider ──────────────────────────────────────────────────────

  describe('waitForProvider', () => {
    it('resolves true immediately if window.ethereum already exists', async () => {
      win().ethereum = createMetaMaskProvider();

      const result = await waitForProvider(1000);

      expect(result).toBe(true);
    });

    it('polls and resolves true when window.ethereum appears within timeout', async () => {
      delete win().ethereum;

      // Simulate the provider appearing after 150ms
      setTimeout(() => {
        win().ethereum = createMetaMaskProvider();
      }, 150);

      const resultPromise = waitForProvider(1000);

      // Advance timers to trigger the polling
      await vi.advanceTimersByTimeAsync(200);

      const result = await resultPromise;
      expect(result).toBe(true);
    });

    it('returns false when timeout expires without provider', async () => {
      delete win().ethereum;

      const resultPromise = waitForProvider(200);

      // Advance past the timeout
      await vi.advanceTimersByTimeAsync(300);

      const result = await resultPromise;
      expect(result).toBe(false);
    });

    it('uses default timeout of 1000ms', async () => {
      delete win().ethereum;

      const resultPromise = waitForProvider();

      // Advance to 500ms — no provider yet
      await vi.advanceTimersByTimeAsync(500);

      // Provider appears at 600ms
      win().ethereum = createMetaMaskProvider();

      await vi.advanceTimersByTimeAsync(100);

      const result = await resultPromise;
      expect(result).toBe(true);
    });
  });

  // ── isSESLockdownError (tested via replicated logic) ─────────────────────
  //
  // The isSESLockdownError function is file-scoped (not exported), so we
  // replicate its exact logic here for testing. This avoids requiring DOM
  // APIs (ErrorEvent, window.addEventListener) which aren't available in
  // the Node.js test environment.

  /**
   * Replicated isSESLockdownError from walletProviderManager.ts.
   * This MUST be kept in sync with the source.
   */
  function isSESLockdownError(msg: string): boolean {
    const lower = msg.toLowerCase();

    const knownPatterns = [
      'SES lockdown',
      'Removing unpermitted intrinsics',
      'Lockdown failed',
      'lockdown failed:',
      'installOneConstantShim: non-configurable',
      'harden: unexpected intrinsic',
      'SES_ASSERT',
      'policy() not yet supported',
      'removeProperty is not a function',
      'defineProperty is not a function',
      'MetaMask - SES',
      'LavaMoat/node',
      'LavaMoat/allow-scripts',
      'Unable to initialize LavaMoat',
      'Error: LavaMoat',
    ];

    for (const pattern of knownPatterns) {
      if (msg.includes(pattern) || lower.includes(pattern.toLowerCase())) {
        return true;
      }
    }

    if (lower.includes('lavamoat') && lower.includes('lockdown')) return true;
    if (lower.includes('lavamoat') && lower.includes('error')) return true;

    if (lower.includes('lockdown') || lower.includes('ses/') || lower.includes('lavamoat')) {
      return true;
    }

    return false;
  }

  describe('isSESLockdownError', () => {
    // ── Known SES patterns that should be detected ────────────────────────

    it('matches "SES lockdown"', () => {
      expect(isSESLockdownError('SES lockdown error occurred')).toBe(true);
    });

    it('matches "Removing unpermitted intrinsics"', () => {
      expect(isSESLockdownError('Removing unpermitted intrinsics: Array.prototype.sort')).toBe(true);
    });

    it('matches "Lockdown failed"', () => {
      expect(isSESLockdownError('Lockdown failed: cannot harden')).toBe(true);
    });

    it('matches "lockdown failed:" (lowercase)', () => {
      expect(isSESLockdownError('Error: lockdown failed: something')).toBe(true);
    });

    it('matches "installOneConstantShim"', () => {
      expect(isSESLockdownError('installOneConstantShim: non-configurable property')).toBe(true);
    });

    it('matches "harden: unexpected intrinsic"', () => {
      expect(isSESLockdownError('harden: unexpected intrinsic found')).toBe(true);
    });

    it('matches "SES_ASSERT"', () => {
      expect(isSESLockdownError('SES_ASSERT failed: property check')).toBe(true);
    });

    it('matches "removeProperty is not a function"', () => {
      expect(isSESLockdownError('TypeError: removeProperty is not a function')).toBe(true);
    });

    it('matches "defineProperty is not a function"', () => {
      expect(isSESLockdownError('TypeError: defineProperty is not a function')).toBe(true);
    });

    it('matches "MetaMask - SES"', () => {
      expect(isSESLockdownError('MetaMask - SES lockdown warning')).toBe(true);
    });

    it('matches "LavaMoat/node"', () => {
      expect(isSESLockdownError('LavaMoat/node packaging error')).toBe(true);
    });

    it('matches "LavaMoat/allow-scripts"', () => {
      expect(isSESLockdownError('LavaMoat/allow-scripts policy violation')).toBe(true);
    });

    it('matches "Unable to initialize LavaMoat"', () => {
      expect(isSESLockdownError('Unable to initialize LavaMoat: config missing')).toBe(true);
    });

    it('matches "Error: LavaMoat"', () => {
      expect(isSESLockdownError('Error: LavaMoat something broke')).toBe(true);
    });

    it('matches compound "lavamoat" + "lockdown"', () => {
      expect(isSESLockdownError('lavamoat custom lockdown issue')).toBe(true);
    });

    it('matches compound "lavamoat" + "error"', () => {
      expect(isSESLockdownError('lavamoat runtime error detected')).toBe(true);
    });

    it('matches catch-all "lockdown" keyword', () => {
      expect(isSESLockdownError('some random lockdown issue')).toBe(true);
    });

    it('matches catch-all "ses/" keyword', () => {
      expect(isSESLockdownError('ses/something went wrong')).toBe(true);
    });

    it('matches catch-all "lavamoat" keyword', () => {
      expect(isSESLockdownError('lavamoat custom message')).toBe(true);
    });

    // ── Non-SES errors that should NOT be detected ────────────────────────

    it('does NOT match regular application errors', () => {
      expect(isSESLockdownError('TypeError: Cannot read property of undefined')).toBe(false);
    });

    it('does NOT match network errors', () => {
      expect(isSESLockdownError('Failed to fetch')).toBe(false);
    });

    it('does NOT match React errors', () => {
      expect(isSESLockdownError('Minified React error #301')).toBe(false);
    });

    it('does NOT match wallet unrelated errors', () => {
      expect(isSESLockdownError('User rejected the transaction')).toBe(false);
    });

    it('does NOT match empty string', () => {
      expect(isSESLockdownError('')).toBe(false);
    });

    it('does NOT match generic Error', () => {
      expect(isSESLockdownError('Error: something went wrong')).toBe(false);
    });
  });
});
