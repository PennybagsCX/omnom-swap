import { useSyncExternalStore } from 'react';
import { useAccount } from 'wagmi';
import { getEthereumFromWindow, detectAllProviders } from '../lib/walletProviderManager';

/** Return type for the useMetaMaskStatus hook. */
export interface MetaMaskStatus {
  /** Whether the MetaMask extension is installed and detected. */
  isMetaMaskInstalled: boolean;
  /** Whether the user is connected AND using MetaMask as the active provider. */
  isMetaMaskConnected: boolean;
  /** MetaMask version string if exposed by the provider, otherwise null. */
  metaMaskVersion: string | null;
  /** Whether multiple injected providers are competing for window.ethereum. */
  hasProviderConflict: boolean;
}

/**
 * Cached snapshot to ensure stable references for `useSyncExternalStore`.
 * `useSyncExternalStore` uses `Object.is()` to compare snapshots — if
 * `getMetaMaskSnapshot` returns a new object literal on every call, React
 * will detect a "change" and re-render infinitely.  We cache the last
 * result and only create a new object when the primitive values actually
 * differ.
 */
let _cachedSnapshot: { isMetaMaskInstalled: boolean; metaMaskVersion: string | null; hasProviderConflict: boolean } | null = null;

/**
 * Read MetaMask-specific info from `window.ethereum` at call time.
 * This is called inside `useSyncExternalStore` so it runs at render time,
 * not at module initialization time — avoiding the race condition where
 * `window.ethereum` isn't available yet.
 *
 * Returns a **stable reference** — the same object is returned as long
 * as the underlying values haven't changed.
 */
function getMetaMaskSnapshot(): Omit<MetaMaskStatus, 'isMetaMaskConnected'> {
  let isMetaMaskInstalled = false;
  let metaMaskVersion: string | null = null;
  let hasProviderConflict = false;

  try {
    const ethereum = getEthereumFromWindow();

    if (ethereum) {
      isMetaMaskInstalled = ethereum.isMetaMask === true;

      // Some versions of MetaMask expose a `version` string
      if (isMetaMaskInstalled && typeof (ethereum as Record<string, unknown>).version === 'string') {
        metaMaskVersion = (ethereum as Record<string, unknown>).version as string;
      }

      // Check for provider conflict (multiple injected providers)
      const providers = detectAllProviders();
      hasProviderConflict = providers.length > 1;
    }
  } catch {
    // SES lockdown or property access error — assume not installed
  }

  // Return the cached snapshot if values haven't changed — this is
  // critical for `useSyncExternalStore` which uses Object.is() comparison.
  if (
    _cachedSnapshot &&
    _cachedSnapshot.isMetaMaskInstalled === isMetaMaskInstalled &&
    _cachedSnapshot.metaMaskVersion === metaMaskVersion &&
    _cachedSnapshot.hasProviderConflict === hasProviderConflict
  ) {
    return _cachedSnapshot;
  }

  _cachedSnapshot = { isMetaMaskInstalled, metaMaskVersion, hasProviderConflict };
  return _cachedSnapshot;
}

/**
 * No-op subscribe — we don't actively watch for `window.ethereum` changes.
 * The snapshot is re-evaluated on every render via useSyncExternalStore.
 */
function subscribe(_callback: () => void): () => void {
  return () => {};
}

/**
 * Hook that provides MetaMask-specific status information.
 *
 * Safe to use anywhere in the component tree. All detection runs at render
 * time (not module initialization time), so it works correctly even if
 * MetaMask injects `window.ethereum` after the page loads.
 */
export function useMetaMaskStatus(): MetaMaskStatus {
  const { isConnected, connector } = useAccount();

  // Get MetaMask detection info at render time
  const snapshot = useSyncExternalStore(subscribe, getMetaMaskSnapshot);

  // Determine if the active connection is through MetaMask
  const isMetaMaskConnected = isConnected
    ? snapshot.isMetaMaskInstalled
      // If MetaMask is the injected provider and the user is connected via
      // the injected connector, they're using MetaMask.
      ? (connector?.id?.toLowerCase().includes('injected') ?? false) ||
        (connector?.id?.toLowerCase().includes('metamask') ?? false)
      : false
    : false;

  return {
    isMetaMaskInstalled: snapshot.isMetaMaskInstalled,
    isMetaMaskConnected,
    metaMaskVersion: snapshot.metaMaskVersion,
    hasProviderConflict: snapshot.hasProviderConflict,
  };
}
