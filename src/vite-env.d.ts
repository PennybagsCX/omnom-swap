/// <reference types="vite/client" />

/**
 * Type extensions for window properties used by wallet provider detection.
 * These are set by the inline script in index.html and by walletProviderManager.
 */
interface Window {
  /** Set by the inline script in index.html when window.ethereum is a getter. */
  __OMNOM_ETHEREUM_IS_GETTER?: boolean;
  /** Captured reference to window.ethereum set by walletProviderManager. */
  __OMNOM_CAPTURED_ETHEREUM?: import('./lib/walletProviderManager').EIP1193Provider;
}
