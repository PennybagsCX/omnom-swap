/**
 * @file walletConnector.edge-cases.test.ts
 * @description Comprehensive edge-case tests for wallet connector logic.
 *
 * Coverage:
 *   1. EIP-6963 Wallet Map — RDNS-to-display mappings for all known wallets
 *   2. Deduplication Logic — 5 connector combination scenarios (A–E)
 *   3. Connection Fallback — EIP-6963 timeout, fallback, user rejection (F–K)
 *   4. Virtual Trust Wallet Entry — conditional virtual entry logic (L–N)
 *   5. Error Formatting — formatConnectionError() for all error types
 *   6. isUserRejectionError — rejection detection with nested causes
 *
 * Reference: src/components/WalletModal.tsx (rewritten version)
 *
 * Note: Pure functions are replicated from the source for unit testing since
 * they are file-scoped and not exported. The logic matches the current
 * WalletModal.tsx implementation exactly.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Polyfill globalThis.window for Node.js test environment ────────────────

if (typeof (globalThis as Record<string, unknown>).window === 'undefined') {
  (globalThis as Record<string, unknown>).window = globalThis;
}

// ─── Replicated pure functions from WalletModal.tsx ─────────────────────────
// These are replicated here for unit testing since they are file-scoped.
// KEEP IN SYNC with src/components/WalletModal.tsx

/** Known EIP-6963 RDNS-to-display mappings (mirrors WalletModal.tsx) */
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

/**
 * Map connector IDs to friendly display info.
 * Mirrors getWalletMeta() from WalletModal.tsx.
 */
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
 * Detect whether an error represents a user rejection.
 * Mirrors isUserRejectionError() from WalletModal.tsx.
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
 * Mirrors formatConnectionError() from WalletModal.tsx.
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

// ─── Deduplication logic (replicated from WalletModal.tsx) ──────────────────

interface MockConnector {
  id: string;
  uid: string;
  name: string;
}

/**
 * Replicates the deduplicatedConnectors useMemo logic from WalletModal.tsx.
 * Filters connectors based on EIP-6963 presence rules.
 */
function deduplicateConnectors(
  connectors: MockConnector[],
  providerReady: boolean,
  hasWindowEthereum: boolean,
): MockConnector[] {
  // When provider isn't ready yet (still waiting for extension injection),
  // show all connectors to avoid hiding something the user needs.
  if (!providerReady && !hasWindowEthereum) {
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
}

/**
 * Replicates the virtual Trust Wallet entry logic from WalletModal.tsx.
 * Returns the display items including the optional virtual Trust Wallet entry.
 */
function buildDisplayItems(
  deduplicatedConnectors: MockConnector[],
): Array<{ key: string; name: string; icon: string; connector: MockConnector; isVirtual?: boolean }> {
  // Find the WalletConnect connector for virtual wallet entries
  const wcConnector = deduplicatedConnectors.find(c =>
    c.id.toLowerCase().includes('walletconnect') || c.id.toLowerCase().includes('wc')
  );

  // Build the display list: real connectors first
  const displayItems: Array<{
    key: string;
    name: string;
    icon: string;
    connector: MockConnector;
    isVirtual?: boolean;
  }> = deduplicatedConnectors.map(c => {
    const meta = getWalletMeta(c.id, c.name);
    return { key: c.uid, name: meta.name, icon: meta.icon, connector: c };
  });

  // Add "Trust Wallet" as a virtual entry that connects via WalletConnect.
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

  // Final name-based deduplication
  const seenNames = new Set<string>();
  const finalDisplayItems = displayItems.filter(item => {
    if (seenNames.has(item.name)) return false;
    seenNames.add(item.name);
    return true;
  });

  return finalDisplayItems;
}

/**
 * Replicates the handleConnect fallback logic from WalletModal.tsx.
 * Returns the outcome of a connection attempt.
 */
async function simulateConnection(
  connector: MockConnector,
  allConnectors: MockConnector[],
  connectAsync: (args: { connector: MockConnector; chainId: number }) => Promise<unknown>,
  timeoutMs: number = 8_000,
): Promise<{ success: boolean; method: 'direct' | 'fallback' | 'failed'; errorMessage?: string }> {
  const DOGECHAIN_ID = 2000;
  const isEip6963 = connector.id.includes('.') &&
    !connector.id.toLowerCase().includes('walletconnect') &&
    !connector.id.toLowerCase().includes('wc');

  const injectedFallback = isEip6963
    ? allConnectors.find(c => c.id === 'injected')
    : undefined;

  try {
    if (isEip6963) {
      // Race connectAsync against a timeout
      const result = await Promise.race([
        connectAsync({ connector, chainId: DOGECHAIN_ID }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Connection timed out — wallet may be unreachable via EIP-6963')), timeoutMs)
        ),
      ]);
      void result;
    } else {
      await connectAsync({ connector, chainId: DOGECHAIN_ID });
    }

    return { success: true, method: 'direct' };
  } catch (err: unknown) {
    // If the user intentionally rejected, do NOT fall back
    if (isUserRejectionError(err)) {
      return { success: false, method: 'failed', errorMessage: 'Connection Rejected' };
    }

    // For non-rejection errors, fall back to injected()
    if (injectedFallback) {
      try {
        await connectAsync({ connector: injectedFallback, chainId: DOGECHAIN_ID });
        return { success: true, method: 'fallback' };
      } catch {
        // Fallback also failed — fall through to error display
      }
    }

    return { success: false, method: 'failed', errorMessage: formatConnectionError(err) };
  }
}

// ─── Test lifecycle ─────────────────────────────────────────────────────────

let originalEthereum: unknown;

beforeEach(() => {
  originalEthereum = (globalThis as Record<string, unknown>).ethereum;
  vi.clearAllMocks();
});

afterEach(() => {
  (globalThis as Record<string, unknown>).ethereum = originalEthereum;
  vi.restoreAllMocks();
});

// ─── Tests ──────────────────────────────────────────────────────────────────

// ===========================================================================
// 1. EIP-6963 WALLET MAP TESTS
// ===========================================================================

describe('EIP-6963 Wallet Map', () => {
  describe('getWalletMeta — EIP-6963 RDNS mappings', () => {
    it('maps io.metamask → "MetaMask" with metamask.svg', () => {
      const meta = getWalletMeta('io.metamask', 'MetaMask');
      expect(meta).toEqual({ name: 'MetaMask', icon: '/wallets/metamask.svg' });
    });

    it('maps io.rabby → "Rabby" with rabby.svg', () => {
      const meta = getWalletMeta('io.rabby', 'Rabby');
      expect(meta).toEqual({ name: 'Rabby', icon: '/wallets/rabby.svg' });
    });

    it('maps com.trustwallet → "Trust Wallet" with trust.svg', () => {
      const meta = getWalletMeta('com.trustwallet', 'Trust Wallet');
      expect(meta).toEqual({ name: 'Trust Wallet', icon: '/wallets/trust.svg' });
    });

    it('maps com.coinbase → "Coinbase Wallet" with coinbase.svg', () => {
      const meta = getWalletMeta('com.coinbase', 'Coinbase Wallet');
      expect(meta).toEqual({ name: 'Coinbase Wallet', icon: '/wallets/coinbase.svg' });
    });

    it('maps com.brave → "Brave Wallet" with browser.svg', () => {
      const meta = getWalletMeta('com.brave', 'Brave');
      expect(meta).toEqual({ name: 'Brave Wallet', icon: '/wallets/browser.svg' });
    });

    it('maps me.rainbow → "Rainbow" with browser.svg (fallback icon)', () => {
      const meta = getWalletMeta('me.rainbow', 'Rainbow');
      expect(meta).toEqual({ name: 'Rainbow', icon: '/wallets/browser.svg' });
    });

    it('maps com.okex → "OKX Wallet" with browser.svg (fallback icon)', () => {
      const meta = getWalletMeta('com.okex', 'OKX Wallet');
      expect(meta).toEqual({ name: 'OKX Wallet', icon: '/wallets/browser.svg' });
    });

    it('maps com.frame → "Frame" with browser.svg', () => {
      const meta = getWalletMeta('com.frame', 'Frame');
      expect(meta).toEqual({ name: 'Frame', icon: '/wallets/browser.svg' });
    });
  });

  describe('getWalletMeta — unknown EIP-6963 connectors', () => {
    it('uses connector name for unknown EIP-6963 RDNS (io.unknown)', () => {
      const meta = getWalletMeta('io.unknown', 'CoolWallet');
      expect(meta).toEqual({ name: 'CoolWallet', icon: '/wallets/browser.svg' });
    });

    it('falls back to "Browser Wallet" when connector name matches RDNS ID', () => {
      const meta = getWalletMeta('io.unknown', 'io.unknown');
      expect(meta).toEqual({ name: 'Browser Wallet', icon: '/wallets/browser.svg' });
    });

    it('falls back to "Browser Wallet" when connector name is empty', () => {
      const meta = getWalletMeta('io.unknown', '');
      expect(meta).toEqual({ name: 'Browser Wallet', icon: '/wallets/browser.svg' });
    });

    it('falls back to "Browser Wallet" when connector name is whitespace', () => {
      const meta = getWalletMeta('io.unknown', '   ');
      expect(meta).toEqual({ name: 'Browser Wallet', icon: '/wallets/browser.svg' });
    });
  });

  describe('getWalletMeta — non-EIP-6963 connectors', () => {
    it('maps walletConnect → "WalletConnect" with walletconnect.svg', () => {
      const meta = getWalletMeta('walletConnect', 'WalletConnect');
      expect(meta).toEqual({ name: 'WalletConnect', icon: '/wallets/walletconnect.svg' });
    });

    it('maps wc (short form) → "WalletConnect" with walletconnect.svg', () => {
      const meta = getWalletMeta('wc', 'WalletConnect');
      expect(meta).toEqual({ name: 'WalletConnect', icon: '/wallets/walletconnect.svg' });
    });

    it('maps coinbaseWallet → "Coinbase Wallet" with coinbase.svg', () => {
      const meta = getWalletMeta('coinbaseWallet', 'Coinbase Wallet');
      expect(meta).toEqual({ name: 'Coinbase Wallet', icon: '/wallets/coinbase.svg' });
    });

    it('maps injected → "Browser Wallet" with browser.svg', () => {
      const meta = getWalletMeta('injected', 'Injected');
      expect(meta).toEqual({ name: 'Browser Wallet', icon: '/wallets/browser.svg' });
    });
  });

  describe('getWalletMeta — partial match fallbacks', () => {
    it('partial matches "rabby" in a longer ID', () => {
      const meta = getWalletMeta('io.rabby-beta', 'Rabby Beta');
      expect(meta).toEqual({ name: 'Rabby', icon: '/wallets/rabby.svg' });
    });

    it('partial matches "trust" in a longer ID', () => {
      const meta = getWalletMeta('com.trustwallet-v2', 'Trust v2');
      expect(meta).toEqual({ name: 'Trust Wallet', icon: '/wallets/trust.svg' });
    });

    it('partial matches "metamask" in a longer ID', () => {
      const meta = getWalletMeta('io.metamask-flask', 'MetaMask Flask');
      expect(meta).toEqual({ name: 'MetaMask', icon: '/wallets/metamask.svg' });
    });
  });

  describe('getWalletMeta — generic fallback', () => {
    it('uses connector name for unknown non-EIP-6963, non-injected connectors', () => {
      const meta = getWalletMeta('phantom', 'Phantom');
      expect(meta).toEqual({ name: 'Phantom', icon: '/wallets/fallback.svg' });
    });

    it('uses "Browser Wallet" when connector name is empty for unknown connector', () => {
      const meta = getWalletMeta('someconnector', '');
      expect(meta).toEqual({ name: 'Browser Wallet', icon: '/wallets/fallback.svg' });
    });
  });

  describe('getWalletMeta — case insensitivity', () => {
    it('handles uppercase EIP-6963 IDs (IO.METAMASK)', () => {
      const meta = getWalletMeta('IO.METAMASK', 'MetaMask');
      expect(meta).toEqual({ name: 'MetaMask', icon: '/wallets/metamask.svg' });
    });

    it('handles mixed-case connector IDs (WalletConnect)', () => {
      const meta = getWalletMeta('WalletConnect', 'WalletConnect');
      expect(meta).toEqual({ name: 'WalletConnect', icon: '/wallets/walletconnect.svg' });
    });

    it('handles uppercase INJECTED', () => {
      const meta = getWalletMeta('INJECTED', 'Injected');
      expect(meta).toEqual({ name: 'Browser Wallet', icon: '/wallets/browser.svg' });
    });
  });
});

// ===========================================================================
// 2. DEDUPLICATION LOGIC TESTS
// ===========================================================================

describe('Deduplication Logic', () => {
  /**
   * Scenario A: MetaMask + Rabby installed (EIP-6963)
   * Connectors: io.metamask, io.rabby, injected, walletConnect, coinbaseWallet
   * Expected: MetaMask, Rabby, WalletConnect, Coinbase Wallet
   * injected should be hidden (EIP-6963 connectors exist)
   */
  it('Scenario A: hides injected when multiple EIP-6963 wallets exist', () => {
    const connectors: MockConnector[] = [
      { id: 'io.metamask', uid: 'mm-1', name: 'MetaMask' },
      { id: 'io.rabby', uid: 'rb-1', name: 'Rabby' },
      { id: 'injected', uid: 'inj-1', name: 'Injected' },
      { id: 'walletConnect', uid: 'wc-1', name: 'WalletConnect' },
      { id: 'coinbaseWallet', uid: 'cb-1', name: 'Coinbase Wallet' },
    ];

    const result = deduplicateConnectors(connectors, true, true);

    expect(result.map(c => c.id)).toEqual(
      expect.arrayContaining(['io.metamask', 'io.rabby', 'walletConnect', 'coinbaseWallet']),
    );
    expect(result.find(c => c.id === 'injected')).toBeUndefined();
    expect(result).toHaveLength(4);
  });

  /**
   * Scenario B: Only MetaMask installed
   * Connectors: io.metamask, injected, walletConnect, coinbaseWallet
   * Expected: MetaMask, WalletConnect, Coinbase Wallet
   * injected hidden (EIP-6963 exists)
   */
  it('Scenario B: hides injected when single EIP-6963 wallet exists', () => {
    const connectors: MockConnector[] = [
      { id: 'io.metamask', uid: 'mm-1', name: 'MetaMask' },
      { id: 'injected', uid: 'inj-1', name: 'Injected' },
      { id: 'walletConnect', uid: 'wc-1', name: 'WalletConnect' },
      { id: 'coinbaseWallet', uid: 'cb-1', name: 'Coinbase Wallet' },
    ];

    const result = deduplicateConnectors(connectors, true, true);

    expect(result.map(c => c.id)).toEqual(
      expect.arrayContaining(['io.metamask', 'walletConnect', 'coinbaseWallet']),
    );
    expect(result.find(c => c.id === 'injected')).toBeUndefined();
    expect(result).toHaveLength(3);
  });

  /**
   * Scenario C: No extensions (no EIP-6963)
   * Connectors: injected, walletConnect, coinbaseWallet
   * Expected: Browser Wallet (injected), WalletConnect, Coinbase Wallet
   * injected shown (no EIP-6963)
   */
  it('Scenario C: shows injected when no EIP-6963 connectors exist', () => {
    const connectors: MockConnector[] = [
      { id: 'injected', uid: 'inj-1', name: 'Injected' },
      { id: 'walletConnect', uid: 'wc-1', name: 'WalletConnect' },
      { id: 'coinbaseWallet', uid: 'cb-1', name: 'Coinbase Wallet' },
    ];

    const result = deduplicateConnectors(connectors, true, true);

    expect(result.map(c => c.id)).toEqual(
      expect.arrayContaining(['injected', 'walletConnect', 'coinbaseWallet']),
    );
    expect(result).toHaveLength(3);
    // Verify injected shows as "Browser Wallet"
    const injectedMeta = getWalletMeta('injected', 'Injected');
    expect(injectedMeta.name).toBe('Browser Wallet');
  });

  /**
   * Scenario D: Coinbase EIP-6963 + coinbaseWallet connector
   * Connectors: com.coinbase, coinbaseWallet, injected, walletConnect
   * Expected: Coinbase Wallet (EIP-6963), WalletConnect
   * Both injected and coinbaseWallet hidden
   */
  it('Scenario D: hides both injected and coinbaseWallet when com.coinbase EIP-6963 exists', () => {
    const connectors: MockConnector[] = [
      { id: 'com.coinbase', uid: 'cb-eip-1', name: 'Coinbase Wallet' },
      { id: 'coinbaseWallet', uid: 'cb-1', name: 'Coinbase Wallet' },
      { id: 'injected', uid: 'inj-1', name: 'Injected' },
      { id: 'walletConnect', uid: 'wc-1', name: 'WalletConnect' },
    ];

    const result = deduplicateConnectors(connectors, true, true);

    expect(result.find(c => c.id === 'injected')).toBeUndefined();
    expect(result.find(c => c.id === 'coinbaseWallet')).toBeUndefined();
    expect(result.map(c => c.id)).toEqual(
      expect.arrayContaining(['com.coinbase', 'walletConnect']),
    );
    expect(result).toHaveLength(2);
  });

  /**
   * Scenario E: Multiple EIP-6963 wallets
   * Connectors: io.metamask, io.rabby, com.trustwallet, injected, walletConnect, coinbaseWallet
   * Expected: MetaMask, Rabby, Trust Wallet, WalletConnect, Coinbase Wallet
   */
  it('Scenario E: shows all EIP-6963 wallets and hides injected', () => {
    const connectors: MockConnector[] = [
      { id: 'io.metamask', uid: 'mm-1', name: 'MetaMask' },
      { id: 'io.rabby', uid: 'rb-1', name: 'Rabby' },
      { id: 'com.trustwallet', uid: 'tw-1', name: 'Trust Wallet' },
      { id: 'injected', uid: 'inj-1', name: 'Injected' },
      { id: 'walletConnect', uid: 'wc-1', name: 'WalletConnect' },
      { id: 'coinbaseWallet', uid: 'cb-1', name: 'Coinbase Wallet' },
    ];

    const result = deduplicateConnectors(connectors, true, true);

    expect(result.find(c => c.id === 'injected')).toBeUndefined();
    expect(result.map(c => c.id)).toEqual(
      expect.arrayContaining(['io.metamask', 'io.rabby', 'com.trustwallet', 'walletConnect', 'coinbaseWallet']),
    );
    expect(result).toHaveLength(5);
  });

  it('returns all connectors when provider is not ready and no window.ethereum', () => {
    const connectors: MockConnector[] = [
      { id: 'io.metamask', uid: 'mm-1', name: 'MetaMask' },
      { id: 'injected', uid: 'inj-1', name: 'Injected' },
    ];

    const result = deduplicateConnectors(connectors, false, false);

    expect(result).toHaveLength(2);
    expect(result).toEqual(connectors);
  });

  it('still deduplicates when provider is ready but no window.ethereum', () => {
    const connectors: MockConnector[] = [
      { id: 'io.metamask', uid: 'mm-1', name: 'MetaMask' },
      { id: 'injected', uid: 'inj-1', name: 'Injected' },
    ];

    // providerReady=true, hasWindowEthereum=false → still runs dedup logic
    const result = deduplicateConnectors(connectors, true, false);

    expect(result.find(c => c.id === 'injected')).toBeUndefined();
    expect(result).toHaveLength(1);
  });

  it('does not hide coinbaseWallet when no com.coinbase EIP-6963 exists', () => {
    const connectors: MockConnector[] = [
      { id: 'io.metamask', uid: 'mm-1', name: 'MetaMask' },
      { id: 'coinbaseWallet', uid: 'cb-1', name: 'Coinbase Wallet' },
      { id: 'injected', uid: 'inj-1', name: 'Injected' },
      { id: 'walletConnect', uid: 'wc-1', name: 'WalletConnect' },
    ];

    const result = deduplicateConnectors(connectors, true, true);

    // coinbaseWallet should remain (no com.coinbase EIP-6963)
    expect(result.find(c => c.id === 'coinbaseWallet')).toBeDefined();
    // injected should be hidden (io.metamask EIP-6963 exists)
    expect(result.find(c => c.id === 'injected')).toBeUndefined();
    expect(result).toHaveLength(3);
  });

  it('handles empty connectors array', () => {
    const result = deduplicateConnectors([], true, true);
    expect(result).toEqual([]);
  });

  it('handles connectors with only walletConnect (no EIP-6963, no injected)', () => {
    const connectors: MockConnector[] = [
      { id: 'walletConnect', uid: 'wc-1', name: 'WalletConnect' },
    ];

    const result = deduplicateConnectors(connectors, true, true);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('walletConnect');
  });
});

// ===========================================================================
// 3. CONNECTION FALLBACK TESTS
// ===========================================================================

describe('Connection Fallback Logic', () => {
  const ALL_CONNECTORS: MockConnector[] = [
    { id: 'io.metamask', uid: 'mm-1', name: 'MetaMask' },
    { id: 'io.rabby', uid: 'rb-1', name: 'Rabby' },
    { id: 'injected', uid: 'inj-1', name: 'Injected' },
    { id: 'walletConnect', uid: 'wc-1', name: 'WalletConnect' },
    { id: 'coinbaseWallet', uid: 'cb-1', name: 'Coinbase Wallet' },
  ];

  /**
   * Scenario F: EIP-6963 connector succeeds
   * io.rabby connects directly → success, no fallback
   */
  it('Scenario F: EIP-6963 connector connects directly without fallback', async () => {
    const connectAsync = vi.fn().mockResolvedValue({ accounts: ['0x123'] });

    const result = await simulateConnection(
      { id: 'io.rabby', uid: 'rb-1', name: 'Rabby' },
      ALL_CONNECTORS,
      connectAsync,
    );

    expect(result.success).toBe(true);
    expect(result.method).toBe('direct');
    expect(connectAsync).toHaveBeenCalledTimes(1);
    // Should have been called with the rabby connector
    expect(connectAsync).toHaveBeenCalledWith(
      expect.objectContaining({ connector: expect.objectContaining({ id: 'io.rabby' }) }),
    );
  });

  /**
   * Scenario G: EIP-6963 connector fails (non-rejection)
   * io.metamask fails with "extension not found" → falls back to injected() → success
   */
  it('Scenario G: EIP-6963 failure falls back to injected() on non-rejection error', async () => {
    const connectAsync = vi.fn()
      .mockRejectedValueOnce(new Error('Extension not found'))
      .mockResolvedValueOnce({ accounts: ['0x456'] });

    const result = await simulateConnection(
      { id: 'io.metamask', uid: 'mm-1', name: 'MetaMask' },
      ALL_CONNECTORS,
      connectAsync,
    );

    expect(result.success).toBe(true);
    expect(result.method).toBe('fallback');
    expect(connectAsync).toHaveBeenCalledTimes(2);
    // Second call should be with injected connector
    expect(connectAsync).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ connector: expect.objectContaining({ id: 'injected' }) }),
    );
  });

  /**
   * Scenario H: EIP-6963 connector times out
   * io.metamask hangs → timeout → falls back to injected()
   */
  it('Scenario H: EIP-6963 timeout falls back to injected()', async () => {
    // Use a very short timeout to simulate the 8s timeout in tests
    const connectAsync = vi.fn()
      .mockImplementationOnce(() => new Promise(() => { /* never resolves — simulates hang */ }))
      .mockResolvedValueOnce({ accounts: ['0x789'] });

    const result = await simulateConnection(
      { id: 'io.metamask', uid: 'mm-1', name: 'MetaMask' },
      ALL_CONNECTORS,
      connectAsync,
      50, // 50ms timeout for fast test
    );

    expect(result.success).toBe(true);
    expect(result.method).toBe('fallback');
    expect(connectAsync).toHaveBeenCalledTimes(2);
  });

  /**
   * Scenario I: User rejection (code 4001)
   * io.metamask user rejects → NO fallback → shows "Connection Rejected"
   */
  it('Scenario I: user rejection (code 4001) does NOT fall back', async () => {
    const connectAsync = vi.fn().mockRejectedValue(
      Object.assign(new Error('User rejected'), { code: 4001 }),
    );

    const result = await simulateConnection(
      { id: 'io.metamask', uid: 'mm-1', name: 'MetaMask' },
      ALL_CONNECTORS,
      connectAsync,
    );

    expect(result.success).toBe(false);
    expect(result.method).toBe('failed');
    expect(result.errorMessage).toBe('Connection Rejected');
    // Should only have been called once — no fallback attempt
    expect(connectAsync).toHaveBeenCalledTimes(1);
  });

  /**
   * Scenario J: User rejection message variants
   * Various rejection messages should all prevent fallback
   */
  describe('Scenario J: user rejection message variants', () => {
    it('"User rejected the request" → NO fallback', async () => {
      const connectAsync = vi.fn().mockRejectedValue(
        new Error('User rejected the request'),
      );

      const result = await simulateConnection(
        { id: 'io.metamask', uid: 'mm-1', name: 'MetaMask' },
        ALL_CONNECTORS,
        connectAsync,
      );

      expect(result.success).toBe(false);
      expect(result.method).toBe('failed');
      expect(connectAsync).toHaveBeenCalledTimes(1);
    });

    it('"rejected" → NO fallback', async () => {
      const connectAsync = vi.fn().mockRejectedValue(
        new Error('The request was rejected'),
      );

      const result = await simulateConnection(
        { id: 'io.rabby', uid: 'rb-1', name: 'Rabby' },
        ALL_CONNECTORS,
        connectAsync,
      );

      expect(result.success).toBe(false);
      expect(result.method).toBe('failed');
      expect(connectAsync).toHaveBeenCalledTimes(1);
    });

    it('"denied" → NO fallback', async () => {
      const connectAsync = vi.fn().mockRejectedValue(
        new Error('Request denied'),
      );

      const result = await simulateConnection(
        { id: 'io.metamask', uid: 'mm-1', name: 'MetaMask' },
        ALL_CONNECTORS,
        connectAsync,
      );

      expect(result.success).toBe(false);
      expect(result.method).toBe('failed');
      expect(connectAsync).toHaveBeenCalledTimes(1);
    });
  });

  /**
   * Scenario K: Non-EIP-6963 connector fails
   * walletConnect fails → NO fallback (only EIP-6963 gets fallback)
   */
  it('Scenario K: non-EIP-6963 connector failure does NOT trigger fallback', async () => {
    const connectAsync = vi.fn().mockRejectedValue(
      new Error('QR code scan failed'),
    );

    const result = await simulateConnection(
      { id: 'walletConnect', uid: 'wc-1', name: 'WalletConnect' },
      ALL_CONNECTORS,
      connectAsync,
    );

    expect(result.success).toBe(false);
    expect(result.method).toBe('failed');
    expect(result.errorMessage).toBe('QR code scan failed');
    // Should only have been called once — no fallback for non-EIP-6963
    expect(connectAsync).toHaveBeenCalledTimes(1);
  });

  it('EIP-6963 failure with no injected connector available → direct failure', async () => {
    const connectorsWithoutInjected: MockConnector[] = [
      { id: 'io.metamask', uid: 'mm-1', name: 'MetaMask' },
      { id: 'walletConnect', uid: 'wc-1', name: 'WalletConnect' },
    ];

    const connectAsync = vi.fn().mockRejectedValue(
      new Error('Extension not found'),
    );

    const result = await simulateConnection(
      { id: 'io.metamask', uid: 'mm-1', name: 'MetaMask' },
      connectorsWithoutInjected,
      connectAsync,
    );

    expect(result.success).toBe(false);
    expect(result.method).toBe('failed');
    expect(result.errorMessage).toContain('No wallet extension detected');
  });

  it('EIP-6963 failure AND fallback also fails → shows fallback error', async () => {
    const connectAsync = vi.fn()
      .mockRejectedValueOnce(new Error('Extension not found'))
      .mockRejectedValueOnce(new Error('No provider was found'));

    const result = await simulateConnection(
      { id: 'io.metamask', uid: 'mm-1', name: 'MetaMask' },
      ALL_CONNECTORS,
      connectAsync,
    );

    expect(result.success).toBe(false);
    expect(result.method).toBe('failed');
    // Error message should be from the original error, not the fallback
    expect(result.errorMessage).toContain('No wallet extension detected');
  });

  it('coinbaseWallet connector (non-EIP-6963) connects directly without timeout race', async () => {
    // Simulates a slow connection that would timeout if it were EIP-6963
    const connectAsync = vi.fn().mockImplementation(
      () => new Promise(resolve => setTimeout(() => resolve({ accounts: ['0xabc'] }), 100)),
    );

    const result = await simulateConnection(
      { id: 'coinbaseWallet', uid: 'cb-1', name: 'Coinbase Wallet' },
      ALL_CONNECTORS,
      connectAsync,
      50, // 50ms timeout — but shouldn't apply to non-EIP-6963
    );

    expect(result.success).toBe(true);
    expect(result.method).toBe('direct');
  });
});

// ===========================================================================
// 4. VIRTUAL TRUST WALLET ENTRY TESTS
// ===========================================================================

describe('Virtual Trust Wallet Entry', () => {
  /**
   * Scenario L: Trust Wallet NOT in display + WalletConnect available
   * Virtual "Trust Wallet" entry added via WalletConnect
   */
  it('Scenario L: adds virtual Trust Wallet when WalletConnect available and no Trust in display', () => {
    const connectors: MockConnector[] = [
      { id: 'io.metamask', uid: 'mm-1', name: 'MetaMask' },
      { id: 'walletConnect', uid: 'wc-1', name: 'WalletConnect' },
    ];

    const displayItems = buildDisplayItems(connectors);

    const trustEntry = displayItems.find(d => d.name === 'Trust Wallet');
    expect(trustEntry).toBeDefined();
    expect(trustEntry?.isVirtual).toBe(true);
    expect(trustEntry?.key).toBe('trust-virtual');
    expect(trustEntry?.icon).toBe('/wallets/trust.svg');
    // Should use the WalletConnect connector
    expect(trustEntry?.connector.id).toBe('walletConnect');
  });

  /**
   * Scenario M: Trust Wallet already in display (EIP-6963)
   * No virtual entry added (already covered by EIP-6963)
   */
  it('Scenario M: does NOT add virtual Trust Wallet when EIP-6963 Trust Wallet exists', () => {
    const connectors: MockConnector[] = [
      { id: 'com.trustwallet', uid: 'tw-1', name: 'Trust Wallet' },
      { id: 'walletConnect', uid: 'wc-1', name: 'WalletConnect' },
    ];

    const displayItems = buildDisplayItems(connectors);

    const trustEntries = displayItems.filter(d => d.name === 'Trust Wallet');
    expect(trustEntries).toHaveLength(1);
    expect(trustEntries[0].isVirtual).toBeUndefined(); // real connector, not virtual
    expect(trustEntries[0].connector.id).toBe('com.trustwallet');
  });

  /**
   * Scenario N: No WalletConnect connector
   * No virtual Trust Wallet entry
   */
  it('Scenario N: does NOT add virtual Trust Wallet when no WalletConnect connector', () => {
    const connectors: MockConnector[] = [
      { id: 'io.metamask', uid: 'mm-1', name: 'MetaMask' },
      { id: 'injected', uid: 'inj-1', name: 'Injected' },
    ];

    const displayItems = buildDisplayItems(connectors);

    const trustEntry = displayItems.find(d => d.name === 'Trust Wallet');
    expect(trustEntry).toBeUndefined();
  });

  it('adds virtual Trust Wallet even when other wallets are present', () => {
    const connectors: MockConnector[] = [
      { id: 'io.metamask', uid: 'mm-1', name: 'MetaMask' },
      { id: 'io.rabby', uid: 'rb-1', name: 'Rabby' },
      { id: 'walletConnect', uid: 'wc-1', name: 'WalletConnect' },
    ];

    const displayItems = buildDisplayItems(connectors);

    const trustEntry = displayItems.find(d => d.name === 'Trust Wallet');
    expect(trustEntry).toBeDefined();
    expect(trustEntry?.isVirtual).toBe(true);
    // Should have MetaMask, Rabby, WalletConnect, and virtual Trust Wallet
    expect(displayItems).toHaveLength(4);
  });

  it('does not duplicate Trust Wallet name in final dedup (EIP-6963 + virtual)', () => {
    // This tests the name-based dedup pass
    const connectors: MockConnector[] = [
      { id: 'com.trustwallet', uid: 'tw-1', name: 'Trust Wallet' },
      { id: 'walletConnect', uid: 'wc-1', name: 'WalletConnect' },
    ];

    const displayItems = buildDisplayItems(connectors);

    const trustEntries = displayItems.filter(d => d.name === 'Trust Wallet');
    // Name-based dedup should keep only the first (real EIP-6963)
    expect(trustEntries).toHaveLength(1);
  });

  it('handles empty connectors array', () => {
    const displayItems = buildDisplayItems([]);

    expect(displayItems).toEqual([]);
  });

  it('handles connectors with only WalletConnect', () => {
    const connectors: MockConnector[] = [
      { id: 'walletConnect', uid: 'wc-1', name: 'WalletConnect' },
    ];

    const displayItems = buildDisplayItems(connectors);

    // Should have WalletConnect + virtual Trust Wallet
    expect(displayItems).toHaveLength(2);
    expect(displayItems.find(d => d.name === 'WalletConnect')).toBeDefined();
    expect(displayItems.find(d => d.name === 'Trust Wallet')).toBeDefined();
  });
});

// ===========================================================================
// 5. ERROR FORMATTING TESTS
// ===========================================================================

describe('formatConnectionError', () => {
  it('handles user rejection message', () => {
    const msg = formatConnectionError(new Error('User rejected the request'));
    expect(msg).toBe('Connection request was rejected');
  });

  it('handles "denied" errors', () => {
    const msg = formatConnectionError(new Error('Request denied by user'));
    expect(msg).toBe('Connection request was rejected');
  });

  it('handles "user rejected" in lowercase', () => {
    const msg = formatConnectionError(new Error('user rejected the connection'));
    expect(msg).toBe('Connection request was rejected');
  });

  it('handles minified "is not a function" errors (Telegram browser)', () => {
    const msg = formatConnectionError(new Error('m is not a function'));
    expect(msg).toContain('Wallet provider is not available');
    expect(msg).toContain('WalletConnect');
  });

  it('handles "t is not a function" variant', () => {
    const msg = formatConnectionError(new Error('t is not a function'));
    expect(msg).toContain('Wallet provider is not available');
  });

  it('does NOT match "this is not a function" (two words before "is not")', () => {
    // The regex /^\w is not a function$/i should only match single-char prefix
    const msg = formatConnectionError(new Error('this is not a function'));
    // "this is not a function" doesn't match /^\w is not a function$/i
    // so it should return the raw message
    expect(msg).toBe('this is not a function');
  });

  it('handles "no provider" errors', () => {
    const msg = formatConnectionError(new Error('No provider was found'));
    expect(msg).toContain('No wallet extension detected');
  });

  it('handles "no ethereum" errors', () => {
    const msg = formatConnectionError(new Error('No ethereum provider available'));
    expect(msg).toContain('No wallet extension detected');
  });

  it('handles "not found" errors', () => {
    const msg = formatConnectionError(new Error('Provider not found'));
    expect(msg).toContain('No wallet extension detected');
  });

  it('handles "already processing" errors', () => {
    const msg = formatConnectionError(new Error('Already processing a request'));
    expect(msg).toContain('already processing a request');
  });

  it('handles "pending" errors', () => {
    const msg = formatConnectionError(new Error('Request pending'));
    expect(msg).toContain('already processing a request');
  });

  it('handles "chain not configured" errors', () => {
    const msg = formatConnectionError(new Error('Chain not configured for this network'));
    expect(msg).toContain('Dogechain is not configured');
  });

  it('handles "cannot set property ethereum" errors', () => {
    const msg = formatConnectionError(new Error('Cannot set property ethereum'));
    expect(msg).toContain('provider conflict');
  });

  it('handles "only a getter" errors', () => {
    const msg = formatConnectionError(new Error('only a getter'));
    expect(msg).toContain('provider conflict');
  });

  it('truncates very long error messages (>120 chars)', () => {
    const longMsg = 'a'.repeat(200);
    const msg = formatConnectionError(new Error(longMsg));
    expect(msg.length).toBe(121); // 120 chars + '…'
    expect(msg.endsWith('…')).toBe(true);
  });

  it('returns the raw message for short unknown errors', () => {
    const msg = formatConnectionError(new Error('Something went wrong'));
    expect(msg).toBe('Something went wrong');
  });

  it('handles non-Error throws (string)', () => {
    const msg = formatConnectionError('string error');
    expect(msg).toBe('An unexpected error occurred while connecting');
  });

  it('handles null errors', () => {
    const msg = formatConnectionError(null);
    expect(msg).toBe('An unexpected error occurred while connecting');
  });

  it('handles undefined errors', () => {
    const msg = formatConnectionError(undefined);
    expect(msg).toBe('An unexpected error occurred while connecting');
  });

  it('handles number throws', () => {
    const msg = formatConnectionError(42);
    expect(msg).toBe('An unexpected error occurred while connecting');
  });

  it('handles Error with empty message', () => {
    const msg = formatConnectionError(new Error(''));
    expect(msg).toBe('');
  });

  it('handles error message at exactly 120 characters (no truncation)', () => {
    const exactMsg = 'a'.repeat(120);
    const msg = formatConnectionError(new Error(exactMsg));
    expect(msg).toBe(exactMsg);
    expect(msg.length).toBe(120);
  });

  it('handles error message at 121 characters (truncated)', () => {
    const longMsg = 'a'.repeat(121);
    const msg = formatConnectionError(new Error(longMsg));
    expect(msg.length).toBe(121); // 120 + '…'
    expect(msg.endsWith('…')).toBe(true);
  });
});

// ===========================================================================
// 6. IS USER REJECTION ERROR TESTS
// ===========================================================================

describe('isUserRejectionError', () => {
  it('returns true for EIP-1193 code 4001', () => {
    const err = { code: 4001, message: 'User rejected' };
    expect(isUserRejectionError(err)).toBe(true);
  });

  it('returns true for Error with "rejected" in message', () => {
    expect(isUserRejectionError(new Error('User rejected the request'))).toBe(true);
  });

  it('returns true for Error with "denied" in message', () => {
    expect(isUserRejectionError(new Error('Request denied'))).toBe(true);
  });

  it('returns true for Error with "user rejected" in message', () => {
    expect(isUserRejectionError(new Error('The user rejected the operation'))).toBe(true);
  });

  it('returns true for nested cause with code 4001 (wagmi/viem wrapping)', () => {
    const err = {
      message: 'Connector not connected',
      cause: { code: 4001, message: 'User rejected' },
    };
    expect(isUserRejectionError(err)).toBe(true);
  });

  it('returns true for deeply nested cause chain', () => {
    const err = {
      message: 'External error',
      cause: {
        message: 'Internal error',
        cause: new Error('user rejected the request'),
      },
    };
    expect(isUserRejectionError(err)).toBe(true);
  });

  it('returns false for non-rejection errors', () => {
    expect(isUserRejectionError(new Error('Extension not found'))).toBe(false);
  });

  it('returns false for non-rejection error code', () => {
    expect(isUserRejectionError({ code: 4100 })).toBe(false);
  });

  it('returns false for null', () => {
    expect(isUserRejectionError(null)).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(isUserRejectionError(undefined)).toBe(false);
  });

  it('returns false for empty object', () => {
    expect(isUserRejectionError({})).toBe(false);
  });

  it('returns false for string', () => {
    expect(isUserRejectionError('rejected')).toBe(false);
  });

  it('returns false for number', () => {
    expect(isUserRejectionError(4001)).toBe(false);
  });

  it('handles case-insensitive "REJECTED"', () => {
    expect(isUserRejectionError(new Error('USER REJECTED'))).toBe(true);
  });

  it('handles case-insensitive "DENIED"', () => {
    expect(isUserRejectionError(new Error('DENIED'))).toBe(true);
  });

  it('returns true for object with code 4001 (plain provider error)', () => {
    const err = { code: 4001 };
    expect(isUserRejectionError(err)).toBe(true);
  });

  it('returns false for nested cause that is not a rejection', () => {
    const err = {
      message: 'Connection failed',
      cause: new Error('Network error'),
    };
    expect(isUserRejectionError(err)).toBe(false);
  });
});

// ===========================================================================
// 7. INTEGRATION: END-TO-END DISPLAY LIST BUILDING
// ===========================================================================

describe('End-to-end display list building', () => {
  it('builds correct display list for typical desktop setup (MetaMask + WC)', () => {
    const connectors: MockConnector[] = [
      { id: 'io.metamask', uid: 'mm-1', name: 'MetaMask' },
      { id: 'injected', uid: 'inj-1', name: 'Injected' },
      { id: 'walletConnect', uid: 'wc-1', name: 'WalletConnect' },
      { id: 'coinbaseWallet', uid: 'cb-1', name: 'Coinbase Wallet' },
    ];

    const deduped = deduplicateConnectors(connectors, true, true);
    const display = buildDisplayItems(deduped);

    const names = display.map(d => d.name);
    expect(names).toContain('MetaMask');
    expect(names).toContain('WalletConnect');
    expect(names).toContain('Coinbase Wallet');
    expect(names).toContain('Trust Wallet'); // virtual entry
    expect(names).not.toContain('Browser Wallet'); // injected hidden
  });

  it('builds correct display list for multi-wallet desktop (MetaMask + Rabby + WC)', () => {
    const connectors: MockConnector[] = [
      { id: 'io.metamask', uid: 'mm-1', name: 'MetaMask' },
      { id: 'io.rabby', uid: 'rb-1', name: 'Rabby' },
      { id: 'injected', uid: 'inj-1', name: 'Injected' },
      { id: 'walletConnect', uid: 'wc-1', name: 'WalletConnect' },
      { id: 'coinbaseWallet', uid: 'cb-1', name: 'Coinbase Wallet' },
    ];

    const deduped = deduplicateConnectors(connectors, true, true);
    const display = buildDisplayItems(deduped);

    const names = display.map(d => d.name);
    expect(names).toEqual(
      expect.arrayContaining(['MetaMask', 'Rabby', 'WalletConnect', 'Coinbase Wallet', 'Trust Wallet']),
    );
    expect(names).not.toContain('Browser Wallet');
    expect(display).toHaveLength(5);
  });

  it('builds correct display list for mobile browser (no extensions)', () => {
    const connectors: MockConnector[] = [
      { id: 'injected', uid: 'inj-1', name: 'Injected' },
      { id: 'walletConnect', uid: 'wc-1', name: 'WalletConnect' },
      { id: 'coinbaseWallet', uid: 'cb-1', name: 'Coinbase Wallet' },
    ];

    const deduped = deduplicateConnectors(connectors, true, true);
    const display = buildDisplayItems(deduped);

    const names = display.map(d => d.name);
    expect(names).toContain('Browser Wallet'); // injected shown (no EIP-6963)
    expect(names).toContain('WalletConnect');
    expect(names).toContain('Coinbase Wallet');
    expect(names).toContain('Trust Wallet'); // virtual entry
  });

  it('builds correct display list for Coinbase-only setup', () => {
    const connectors: MockConnector[] = [
      { id: 'com.coinbase', uid: 'cb-eip-1', name: 'Coinbase Wallet' },
      { id: 'coinbaseWallet', uid: 'cb-1', name: 'Coinbase Wallet' },
      { id: 'injected', uid: 'inj-1', name: 'Injected' },
      { id: 'walletConnect', uid: 'wc-1', name: 'WalletConnect' },
    ];

    const deduped = deduplicateConnectors(connectors, true, true);
    const display = buildDisplayItems(deduped);

    const names = display.map(d => d.name);
    // coinbaseWallet deduped away, injected deduped away
    expect(names).toEqual(expect.arrayContaining(['Coinbase Wallet', 'WalletConnect', 'Trust Wallet']));
    // Only one Coinbase Wallet entry (name dedup)
    expect(names.filter(n => n === 'Coinbase Wallet')).toHaveLength(1);
  });

  it('handles all EIP-6963 wallets discovered simultaneously', () => {
    const connectors: MockConnector[] = [
      { id: 'io.metamask', uid: 'mm-1', name: 'MetaMask' },
      { id: 'io.rabby', uid: 'rb-1', name: 'Rabby' },
      { id: 'com.trustwallet', uid: 'tw-1', name: 'Trust Wallet' },
      { id: 'com.coinbase', uid: 'cb-eip-1', name: 'Coinbase Wallet' },
      { id: 'com.brave', uid: 'br-1', name: 'Brave Wallet' },
      { id: 'injected', uid: 'inj-1', name: 'Injected' },
      { id: 'walletConnect', uid: 'wc-1', name: 'WalletConnect' },
      { id: 'coinbaseWallet', uid: 'cb-1', name: 'Coinbase Wallet' },
    ];

    const deduped = deduplicateConnectors(connectors, true, true);
    const display = buildDisplayItems(deduped);

    const names = display.map(d => d.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'MetaMask', 'Rabby', 'Trust Wallet', 'Coinbase Wallet',
        'Brave Wallet', 'WalletConnect',
      ]),
    );
    // No virtual Trust Wallet (already have EIP-6963 Trust Wallet)
    expect(display.filter(d => d.isVirtual)).toHaveLength(0);
    // No injected, no duplicate coinbaseWallet
    expect(names).not.toContain('Browser Wallet');
    expect(names.filter(n => n === 'Coinbase Wallet')).toHaveLength(1);
  });
});
