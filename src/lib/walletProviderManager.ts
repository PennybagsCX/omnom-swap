/**
 * Wallet Provider Manager
 *
 * Safely handles multiple wallet extensions competing for `window.ethereum`.
 * Resolves conflicts between MetaMask, Rabby, Trust, Coinbase, and other
 * EIP-1193 providers.
 *
 * Key problems solved:
 *  1. SES lockdown errors — MetaMask's LavaMoat/SES may remove JS intrinsics
 *  2. Provider getter conflicts — extensions setting window.ethereum as a getter
 *  3. Multiple provider detection — identifying all installed wallets
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Minimal EIP-1193 provider shape used for detection. */
export interface EIP1193Provider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
  on?: (event: string, handler: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, handler: (...args: unknown[]) => void) => void;
  /** Provider identity flags set by wallet extensions. */
  isMetaMask?: boolean;
  isRabby?: boolean;
  isTrust?: boolean;
  isTrustWallet?: boolean;
  isCoinbaseWallet?: boolean;
  isFrame?: boolean;
  isBraveWallet?: boolean;
  /** Some providers expose an array of all detected providers. */
  providers?: EIP1193Provider[];
  [key: string]: unknown;
}

/** A detected wallet with metadata and priority. */
export interface DetectedWallet {
  id: string;
  name: string;
  icon: string;
  provider: EIP1193Provider;
  priority: number;
}

/** Summary of the current provider landscape for UI display. */
export interface ProviderConflictInfo {
  hasConflict: boolean;
  providers: DetectedWallet[];
  ethereumIsGetter: boolean;
  activeProvider: EIP1193Provider | null;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'omnom_preferred_wallet';

/**
 * Known wallet detection flags in priority order.
 * Lower `priority` = higher preference.
 */
const WALLET_DETECTION: ReadonlyArray<{
  id: string;
  name: string;
  icon: string;
  flag: string;
  priority: number;
}> = [
  { id: 'metamask', name: 'MetaMask', icon: '/wallets/metamask.svg', flag: 'isMetaMask', priority: 1 },
  { id: 'rabby', name: 'Rabby', icon: '/wallets/rabby.svg', flag: 'isRabby', priority: 2 },
  { id: 'trust', name: 'Trust Wallet', icon: '/wallets/trust.svg', flag: 'isTrust', priority: 3 },
  { id: 'coinbase', name: 'Coinbase Wallet', icon: '/wallets/coinbase.svg', flag: 'isCoinbaseWallet', priority: 4 },
  { id: 'brave', name: 'Brave Wallet', icon: '/wallets/browser.svg', flag: 'isBraveWallet', priority: 5 },
  { id: 'frame', name: 'Frame', icon: '/wallets/browser.svg', flag: 'isFrame', priority: 6 },
];

// ---------------------------------------------------------------------------
// Safe window.ethereum access
// ---------------------------------------------------------------------------

/** Read `window.ethereum` without throwing (handles SES lockdown). */
export function getEthereumFromWindow(): EIP1193Provider | undefined {
  try {
    return (window as unknown as { ethereum?: EIP1193Provider }).ethereum;
  } catch {
    // SES lockdown may block access
    return undefined;
  }
}

/** Check whether `window.ethereum` is defined as a getter (set by another extension). */
export function isEthereumGetter(): boolean {
  try {
    const desc = Object.getOwnPropertyDescriptor(window, 'ethereum');
    return desc !== undefined && typeof desc.get === 'function';
  } catch {
    return false;
  }
}

/** Read the `window.ethereumProviders` array some extensions populate. */
function getEthereumProvidersArray(): EIP1193Provider[] {
  try {
    const win = window as unknown as { ethereumProviders?: EIP1193Provider[] };
    return win.ethereumProviders ?? [];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Provider identification
// ---------------------------------------------------------------------------

/**
 * Identify a provider by checking its wallet-specific flags.
 * Returns `null` for unknown / generic providers.
 */
function identifyProvider(provider: EIP1193Provider): DetectedWallet | null {
  for (const wallet of WALLET_DETECTION) {
    if (provider[wallet.flag] === true) {
      return {
        id: wallet.id,
        name: wallet.name,
        icon: wallet.icon,
        provider,
        priority: wallet.priority,
      };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

/**
 * Detect all installed wallet providers.
 *
 * Checks, in order:
 *  1. `window.ethereum.providers` array (multi-provider wrapper)
 *  2. `window.ethereum` itself (single provider)
 *  3. `window.ethereumProviders` (alternative array)
 *
 * Returns a deduplicated list sorted by priority (highest first).
 */
export function detectAllProviders(): DetectedWallet[] {
  const detected: DetectedWallet[] = [];
  const seen = new Set<EIP1193Provider>();

  try {
    const ethereum = getEthereumFromWindow();

    // 1. Multi-provider array exposed by some extensions
    if (ethereum?.providers && Array.isArray(ethereum.providers)) {
      for (const provider of ethereum.providers) {
        if (seen.has(provider)) continue;
        seen.add(provider);

        const wallet = identifyProvider(provider);
        if (wallet) {
          detected.push(wallet);
        } else {
          detected.push({
            id: 'injected',
            name: 'Browser Wallet',
            icon: '/wallets/browser.svg',
            provider,
            priority: 99,
          });
        }
      }
    }

    // 2. window.ethereum itself
    if (ethereum && !seen.has(ethereum)) {
      seen.add(ethereum);
      const wallet = identifyProvider(ethereum);
      if (wallet) {
        detected.push(wallet);
      } else {
        detected.push({
          id: 'injected',
          name: 'Browser Wallet',
          icon: '/wallets/browser.svg',
          provider: ethereum,
          priority: 99,
        });
      }
    }

    // 3. Alternative ethereumProviders array
    for (const provider of getEthereumProvidersArray()) {
      if (seen.has(provider)) continue;
      seen.add(provider);
      const wallet = identifyProvider(provider);
      if (wallet) {
        detected.push(wallet);
      }
    }
  } catch (err) {
    // SES lockdown or other security errors — log and continue
    console.warn('[WalletProviderManager] Provider detection partially failed:', err);
  }

  // Sort by priority (lowest number = highest priority)
  detected.sort((a, b) => a.priority - b.priority);
  return detected;
}

// ---------------------------------------------------------------------------
// Provider resolution
// ---------------------------------------------------------------------------

/**
 * Get the preferred provider based on:
 *  1. User's stored preference (localStorage)
 *  2. Default priority order (MetaMask > Rabby > Trust > Coinbase > generic)
 */
export function getPreferredProvider(): EIP1193Provider | null {
  try {
    const providers = detectAllProviders();
    if (providers.length === 0) return null;

    // Check user preference
    const preferred = getPreferredWalletId();
    if (preferred) {
      const match = providers.find((p) => p.id === preferred);
      if (match) return match.provider;
    }

    // Return highest-priority provider
    return providers[0].provider;
  } catch {
    // Fallback: try window.ethereum directly
    return getEthereumFromWindow() ?? null;
  }
}

/** Persist the user's preferred wallet ID. */
export function setPreferredWallet(walletId: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, walletId);
  } catch {
    // localStorage may be unavailable (private browsing, quota, etc.)
  }
}

/** Read the user's stored preferred wallet ID. */
export function getPreferredWalletId(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Conflict detection
// ---------------------------------------------------------------------------

/**
 * Analyze the current provider landscape for conflicts.
 * Useful for showing warnings in the UI.
 */
export function detectProviderConflict(): ProviderConflictInfo {
  const providers = detectAllProviders();
  const ethereumIsGetter = isEthereumGetter();
  const ethereum = getEthereumFromWindow();

  return {
    hasConflict: providers.length > 1 || ethereumIsGetter,
    providers,
    ethereumIsGetter,
    activeProvider: ethereum ?? null,
  };
}

/**
 * Resolve a provider conflict by selecting the appropriate provider.
 * Does NOT attempt to overwrite `window.ethereum` (which would throw
 * if it is a getter set by another extension).
 */
export function resolveProviderConflict(): {
  provider: EIP1193Provider | null;
  conflict: ProviderConflictInfo;
} {
  const conflict = detectProviderConflict();
  const provider = getPreferredProvider();
  return { provider, conflict };
}

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------

/** Check if MetaMask is available (as window.ethereum or in the providers array). */
export function isMetaMaskAvailable(): boolean {
  try {
    return detectAllProviders().some((p) => p.id === 'metamask');
  } catch {
    return false;
  }
}

/** Check if any injected EIP-1193 provider is available. */
export function hasInjectedProvider(): boolean {
  try {
    return getEthereumFromWindow() !== undefined;
  } catch {
    return false;
  }
}

/** Get a display-friendly list of detected wallets (no provider references). */
export function getDetectedWallets(): Array<{ id: string; name: string; icon: string }> {
  return detectAllProviders().map((p) => ({
    id: p.id,
    name: p.name,
    icon: p.icon,
  }));
}

// ---------------------------------------------------------------------------
// Provider wait / retry
// ---------------------------------------------------------------------------

/**
 * Wait for `window.ethereum` to become available.
 *
 * Wallet extensions inject `window.ethereum` asynchronously — it may not be
 * present at module initialization time. This function polls for it with a
 * configurable timeout.
 *
 * @param timeoutMs Maximum time to wait in milliseconds (default: 1000).
 * @returns `true` if a provider was detected before the timeout, `false` otherwise.
 */
export function waitForProvider(timeoutMs: number = 1000): Promise<boolean> {
  return new Promise((resolve) => {
    // Check immediately — in most cases the provider is already available
    if (getEthereumFromWindow()) {
      resolve(true);
      return;
    }

    const startTime = Date.now();
    const pollInterval = 50; // Check every 50ms

    const timer = setInterval(() => {
      if (getEthereumFromWindow()) {
        clearInterval(timer);
        resolve(true);
        return;
      }

      if (Date.now() - startTime >= timeoutMs) {
        clearInterval(timer);
        resolve(false);
      }
    }, pollInterval);
  });
}

// ---------------------------------------------------------------------------
// SES lockdown mitigation
// ---------------------------------------------------------------------------

/**
 * Check whether an error message matches known SES / LavaMoat lockdown patterns.
 *
 * These errors are non-fatal — they occur when MetaMask's LavaMoat/SES removes
 * JavaScript intrinsics that the app doesn't actually depend on.
 */
function isSESLockdownError(msg: string): boolean {
  const lower = msg.toLowerCase();

  // Exact / substring matches for known error messages
  const knownPatterns = [
    'SES lockdown',
    'Removing unpermitted intrinsics',
    'Lockdown failed',
    'lockdown failed:',
    'installOneConstantShim: non-configurable',
    'harden: unexpected intrinsic',
    'SES_ASSERT',
    'policy() not yet supported',
    'removeProperty is not a function',        // SES removes Object.prototype
    'defineProperty is not a function',         // SES shim errors
    'MetaMask - SES',
    'LavaMoat/node',                            // LavaMoat packaging errors
    'LavaMoat/allow-scripts',                   // Script policy errors
    'Unable to initialize LavaMoat',
    'Error: LavaMoat',
  ];

  for (const pattern of knownPatterns) {
    if (msg.includes(pattern) || lower.includes(pattern.toLowerCase())) {
      return true;
    }
  }

  // Compound patterns (require two keywords together)
  if (lower.includes('lavamoat') && lower.includes('lockdown')) return true;
  if (lower.includes('lavamoat') && lower.includes('error')) return true;

  // Catch-all: any message containing 'lockdown', 'SES', or 'LavaMoat'
  // that looks like it came from a wallet extension (not user code)
  if (lower.includes('lockdown') || lower.includes('ses/') || lower.includes('lavamoat')) {
    return true;
  }

  return false;
}

/**
 * Install a global error handler that suppresses known SES lockdown errors.
 *
 * Returns a cleanup function to remove the listener.
 */
export function installSESErrorSuppression(): () => void {
  const handler = (event: ErrorEvent): void => {
    try {
      const msg = event.message ?? '';
      if (isSESLockdownError(msg)) {
        console.warn('[WalletProviderManager] Suppressed SES lockdown warning:', msg);
        event.stopImmediatePropagation();
        event.preventDefault();
      }
    } catch {
      // If the handler itself fails (e.g. event.message is a getter that throws),
      // silently ignore — we don't want our error suppression to cause errors.
    }
  };

  window.addEventListener('error', handler, true);
  return () => window.removeEventListener('error', handler, true);
}

/**
 * Suppress MetaMask's console error about the global Ethereum provider.
 * This is cosmetic — MetaMask logs this when another extension has already
 * set `window.ethereum` as a getter.
 *
 * Returns a cleanup function to restore the original `console.error`.
 */
export function suppressMetaMaskProviderError(): () => void {
  const originalError = console.error;
  const suppressedPatterns = [
    'MetaMask encountered an error setting the global Ethereum provider',
    'error setting the global Ethereum provider',
    'MetaMask: MetaMask failed to set provider',           // Additional MetaMask pattern
    'MetaMask: Failed to set window.ethereum',             // Newer MetaMask versions
    'MetaMask: The global web3 is already set',            // Web3 conflict
  ];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  console.error = (...args: any[]) => {
    try {
      const message = args.map((a: unknown) => (typeof a === 'string' ? a : '')).join(' ');
      if (suppressedPatterns.some((p) => message.includes(p))) {
        console.warn('[WalletProviderManager] Suppressed MetaMask provider conflict warning');
        return;
      }
    } catch {
      // If message extraction fails, fall through to original error
    }
    originalError.apply(console, args);
  };

  return () => {
    console.error = originalError;
  };
}

// ---------------------------------------------------------------------------
// Early provider protection (call once at app startup)
// ---------------------------------------------------------------------------

/**
 * Install all provider-protection measures.  Call as early as possible in
 * the app lifecycle (e.g. top of `main.tsx`).
 *
 * Measures installed:
 *  - Global error handler for SES lockdown warnings
 *  - Console-error suppression for MetaMask provider conflict
 *  - Capture `window.ethereum` reference for later use
 *
 * Returns a single cleanup function that removes all listeners.
 */
export function installProviderProtection(): () => void {
  const cleanups: Array<() => void> = [];

  // 1. Suppress SES lockdown errors
  cleanups.push(installSESErrorSuppression());

  // 2. Suppress MetaMask provider conflict console noise
  cleanups.push(suppressMetaMaskProviderError());

  // 3. Capture current window.ethereum reference for later use.
  //    This is stored so that even if another extension overwrites
  //    window.ethereum later, we still have a reference to the provider.
  try {
    const ethereum = getEthereumFromWindow();
    if (ethereum) {
      (window as unknown as Record<string, unknown>).__OMNOM_CAPTURED_ETHEREUM = ethereum;
    }
  } catch {
    // Ignore — may fail under SES lockdown
  }

  return () => cleanups.forEach((fn) => fn());
}
