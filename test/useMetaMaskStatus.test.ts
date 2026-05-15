/**
 * @file useMetaMaskStatus.test.ts
 * @description Tests for the useMetaMaskStatus hook.
 *
 * Coverage:
 *   1. MetaMask installed — isMetaMaskInstalled is true
 *   2. MetaMask not installed — isMetaMaskInstalled is false
 *   3. MetaMask connected — isMetaMaskConnected is true when account + MetaMask
 *   4. Version detection — metaMaskVersion returns version string
 *   5. Provider conflict — hasProviderConflict when multiple providers
 *   6. No window.ethereum — all values return safe defaults
 *
 * Reference: src/hooks/useMetaMaskStatus.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Polyfill globalThis.window for Node.js test environment ────────────────

if (typeof (globalThis as Record<string, unknown>).window === 'undefined') {
  (globalThis as Record<string, unknown>).window = globalThis;
}

// ─── Mock wagmi's useAccount ────────────────────────────────────────────────

const mockUseAccount = vi.fn();

vi.mock('wagmi', () => ({
  useAccount: () => mockUseAccount(),
}));

// ─── Mock walletProviderManager functions ───────────────────────────────────

const mockGetEthereumFromWindow = vi.fn();
const mockDetectAllProviders = vi.fn();

vi.mock('../src/lib/walletProviderManager', () => ({
  getEthereumFromWindow: () => mockGetEthereumFromWindow(),
  detectAllProviders: () => mockDetectAllProviders(),
}));

// ─── Mock React's useSyncExternalStore ──────────────────────────────────────
//
// useMetaMaskStatus calls useSyncExternalStore(subscribe, getSnapshot).
// The real getMetaMaskSnapshot reads window.ethereum via getEthereumFromWindow()
// and detectAllProviders(). Our mock of those functions controls the output.

vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  return {
    ...actual,
    useSyncExternalStore: (_subscribe: unknown, getSnapshot: () => unknown) => {
      return getSnapshot();
    },
  };
});

// ─── Import after mocks ────────────────────────────────────────────────────

import { useMetaMaskStatus } from '../src/hooks/useMetaMaskStatus';
import type { MetaMaskStatus } from '../src/hooks/useMetaMaskStatus';

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Create a mock MetaMask-like provider. */
function createMetaMaskProvider(overrides: Record<string, unknown> = {}) {
  return {
    isMetaMask: true,
    request: vi.fn(),
    ...overrides,
  };
}

/** Default wagmi useAccount return for disconnected state. */
function disconnectedAccount() {
  return { isConnected: false, connector: undefined };
}

/** wagmi useAccount return for connected via injected connector. */
function connectedViaInjected() {
  return {
    isConnected: true,
    connector: { id: 'injected', name: 'Injected', uid: 'injected-1' },
  };
}

/** wagmi useAccount return for connected via MetaMask connector. */
function connectedViaMetaMask() {
  return {
    isConnected: true,
    connector: { id: 'io.metamask', name: 'MetaMask', uid: 'metamask-1' },
  };
}

/** wagmi useAccount return for connected via WalletConnect. */
function connectedViaWalletConnect() {
  return {
    isConnected: true,
    connector: { id: 'walletConnect', name: 'WalletConnect', uid: 'wc-1' },
  };
}

// ─── Setup / Teardown ───────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('useMetaMaskStatus', () => {
  // ── isMetaMaskInstalled ──────────────────────────────────────────────────

  describe('isMetaMaskInstalled', () => {
    it('returns true when window.ethereum has isMetaMask=true', () => {
      mockGetEthereumFromWindow.mockReturnValue(createMetaMaskProvider());
      mockDetectAllProviders.mockReturnValue([
        { id: 'metamask', name: 'MetaMask', icon: '/wallets/metamask.svg', provider: createMetaMaskProvider(), priority: 1 },
      ]);
      mockUseAccount.mockReturnValue(disconnectedAccount());

      const status: MetaMaskStatus = useMetaMaskStatus();

      expect(status.isMetaMaskInstalled).toBe(true);
    });

    it('returns false when window.ethereum is undefined', () => {
      mockGetEthereumFromWindow.mockReturnValue(undefined);
      mockDetectAllProviders.mockReturnValue([]);
      mockUseAccount.mockReturnValue(disconnectedAccount());

      const status: MetaMaskStatus = useMetaMaskStatus();

      expect(status.isMetaMaskInstalled).toBe(false);
    });

    it('returns false when window.ethereum exists but isMetaMask is false', () => {
      mockGetEthereumFromWindow.mockReturnValue({
        isMetaMask: false,
        isRabby: true,
        request: vi.fn(),
      });
      mockDetectAllProviders.mockReturnValue([
        { id: 'rabby', name: 'Rabby', icon: '/wallets/rabby.svg', provider: {}, priority: 2 },
      ]);
      mockUseAccount.mockReturnValue(disconnectedAccount());

      const status: MetaMaskStatus = useMetaMaskStatus();

      expect(status.isMetaMaskInstalled).toBe(false);
    });
  });

  // ── isMetaMaskConnected ──────────────────────────────────────────────────

  describe('isMetaMaskConnected', () => {
    it('returns true when connected via injected connector and MetaMask is installed', () => {
      mockGetEthereumFromWindow.mockReturnValue(createMetaMaskProvider());
      mockDetectAllProviders.mockReturnValue([
        { id: 'metamask', name: 'MetaMask', icon: '/wallets/metamask.svg', provider: createMetaMaskProvider(), priority: 1 },
      ]);
      mockUseAccount.mockReturnValue(connectedViaInjected());

      const status: MetaMaskStatus = useMetaMaskStatus();

      expect(status.isMetaMaskConnected).toBe(true);
    });

    it('returns true when connected via MetaMask connector', () => {
      mockGetEthereumFromWindow.mockReturnValue(createMetaMaskProvider());
      mockDetectAllProviders.mockReturnValue([
        { id: 'metamask', name: 'MetaMask', icon: '/wallets/metamask.svg', provider: createMetaMaskProvider(), priority: 1 },
      ]);
      mockUseAccount.mockReturnValue(connectedViaMetaMask());

      const status: MetaMaskStatus = useMetaMaskStatus();

      expect(status.isMetaMaskConnected).toBe(true);
    });

    it('returns false when connected via WalletConnect (not MetaMask)', () => {
      mockGetEthereumFromWindow.mockReturnValue(createMetaMaskProvider());
      mockDetectAllProviders.mockReturnValue([
        { id: 'metamask', name: 'MetaMask', icon: '/wallets/metamask.svg', provider: createMetaMaskProvider(), priority: 1 },
      ]);
      mockUseAccount.mockReturnValue(connectedViaWalletConnect());

      const status: MetaMaskStatus = useMetaMaskStatus();

      expect(status.isMetaMaskConnected).toBe(false);
    });

    it('returns false when not connected', () => {
      mockGetEthereumFromWindow.mockReturnValue(createMetaMaskProvider());
      mockDetectAllProviders.mockReturnValue([
        { id: 'metamask', name: 'MetaMask', icon: '/wallets/metamask.svg', provider: createMetaMaskProvider(), priority: 1 },
      ]);
      mockUseAccount.mockReturnValue(disconnectedAccount());

      const status: MetaMaskStatus = useMetaMaskStatus();

      expect(status.isMetaMaskConnected).toBe(false);
    });

    it('returns false when connected but MetaMask is not installed', () => {
      mockGetEthereumFromWindow.mockReturnValue(undefined);
      mockDetectAllProviders.mockReturnValue([]);
      mockUseAccount.mockReturnValue(connectedViaInjected());

      const status: MetaMaskStatus = useMetaMaskStatus();

      expect(status.isMetaMaskConnected).toBe(false);
    });
  });

  // ── metaMaskVersion ──────────────────────────────────────────────────────

  describe('metaMaskVersion', () => {
    it('returns version string when provider exposes version', () => {
      mockGetEthereumFromWindow.mockReturnValue(createMetaMaskProvider({ version: '11.16.5' }));
      mockDetectAllProviders.mockReturnValue([
        { id: 'metamask', name: 'MetaMask', icon: '/wallets/metamask.svg', provider: createMetaMaskProvider({ version: '11.16.5' }), priority: 1 },
      ]);
      mockUseAccount.mockReturnValue(disconnectedAccount());

      const status: MetaMaskStatus = useMetaMaskStatus();

      expect(status.metaMaskVersion).toBe('11.16.5');
    });

    it('returns null when version is not exposed', () => {
      mockGetEthereumFromWindow.mockReturnValue(createMetaMaskProvider());
      mockDetectAllProviders.mockReturnValue([
        { id: 'metamask', name: 'MetaMask', icon: '/wallets/metamask.svg', provider: createMetaMaskProvider(), priority: 1 },
      ]);
      mockUseAccount.mockReturnValue(disconnectedAccount());

      const status: MetaMaskStatus = useMetaMaskStatus();

      expect(status.metaMaskVersion).toBeNull();
    });

    it('returns null when MetaMask is not installed', () => {
      mockGetEthereumFromWindow.mockReturnValue(undefined);
      mockDetectAllProviders.mockReturnValue([]);
      mockUseAccount.mockReturnValue(disconnectedAccount());

      const status: MetaMaskStatus = useMetaMaskStatus();

      expect(status.metaMaskVersion).toBeNull();
    });
  });

  // ── hasProviderConflict ──────────────────────────────────────────────────

  describe('hasProviderConflict', () => {
    it('returns true when multiple providers are detected', () => {
      const mmProvider = createMetaMaskProvider();
      const rabbyProvider = { isRabby: true, request: vi.fn() };

      mockGetEthereumFromWindow.mockReturnValue(mmProvider);
      mockDetectAllProviders.mockReturnValue([
        { id: 'metamask', name: 'MetaMask', icon: '/wallets/metamask.svg', provider: mmProvider, priority: 1 },
        { id: 'rabby', name: 'Rabby', icon: '/wallets/rabby.svg', provider: rabbyProvider, priority: 2 },
      ]);
      mockUseAccount.mockReturnValue(disconnectedAccount());

      const status: MetaMaskStatus = useMetaMaskStatus();

      expect(status.hasProviderConflict).toBe(true);
    });

    it('returns false when only one provider is detected', () => {
      const mmProvider = createMetaMaskProvider();

      mockGetEthereumFromWindow.mockReturnValue(mmProvider);
      mockDetectAllProviders.mockReturnValue([
        { id: 'metamask', name: 'MetaMask', icon: '/wallets/metamask.svg', provider: mmProvider, priority: 1 },
      ]);
      mockUseAccount.mockReturnValue(disconnectedAccount());

      const status: MetaMaskStatus = useMetaMaskStatus();

      expect(status.hasProviderConflict).toBe(false);
    });

    it('returns false when no providers are detected', () => {
      mockGetEthereumFromWindow.mockReturnValue(undefined);
      mockDetectAllProviders.mockReturnValue([]);
      mockUseAccount.mockReturnValue(disconnectedAccount());

      const status: MetaMaskStatus = useMetaMaskStatus();

      expect(status.hasProviderConflict).toBe(false);
    });
  });

  // ── Safe defaults when no window.ethereum ────────────────────────────────

  describe('safe defaults (no window.ethereum)', () => {
    it('returns all-safe defaults when getEthereumFromWindow throws', () => {
      mockGetEthereumFromWindow.mockImplementation(() => {
        throw new Error('SES lockdown prevented access');
      });
      mockDetectAllProviders.mockReturnValue([]);
      mockUseAccount.mockReturnValue(disconnectedAccount());

      const status: MetaMaskStatus = useMetaMaskStatus();

      expect(status.isMetaMaskInstalled).toBe(false);
      expect(status.isMetaMaskConnected).toBe(false);
      expect(status.metaMaskVersion).toBeNull();
      expect(status.hasProviderConflict).toBe(false);
    });
  });
});
