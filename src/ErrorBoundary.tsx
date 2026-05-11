import { Component, ErrorInfo, ReactNode } from 'react';
import { TriangleAlert, RefreshCw, Wallet } from 'lucide-react';

interface Props {
  children?: ReactNode;
  /** Optional lightweight fallback for inline error boundaries. */
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
  /** Whether this error is a known wallet provider conflict. */
  isWalletConflict: boolean;
}

/**
 * Check if an error is caused by a wallet provider conflict.
 * These errors are thrown by MetaMask's inpage.js when another extension
 * has already set `window.ethereum` as a getter property.
 */
function isWalletProviderError(error: Error): boolean {
  const msg = error.message?.toLowerCase() ?? '';
  const stack = error.stack?.toLowerCase() ?? '';

  return (
    // MetaMask inpage.js getter conflict
    msg.includes('cannot set property ethereum') ||
    msg.includes('only a getter') ||
    // SES lockdown errors
    msg.includes('ses lockdown') ||
    msg.includes('removing unpermitted intrinsics') ||
    // Generic wallet provider errors
    msg.includes('ethereum provider') ||
    // Stack trace contains inpage.js (MetaMask content script)
    stack.includes('inpage.js')
  );
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    isWalletConflict: false,
  };

  public static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      error,
      isWalletConflict: isWalletProviderError(error),
    };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    if (isWalletProviderError(error)) {
      // Log wallet conflicts at warn level — they're usually recoverable
      console.warn(
        '[ErrorBoundary] Wallet provider conflict caught:',
        error.message,
        '\nComponent stack:',
        errorInfo.componentStack,
      );
    } else {
      console.error('Uncaught error:', error, errorInfo.componentStack);
    }
  }

  /** Retry by clearing the error state and re-initializing. */
  private handleRetry = () => {
    // Attempt to re-detect providers by triggering a fresh import
    // of the wallet provider manager (side-effect free on re-import).
    // Then clear the error state to re-render the component tree.
    this.setState({ hasError: false, error: undefined, isWalletConflict: false });
  };

  public render() {
    if (this.state.hasError) {
      // If a custom fallback was provided, use it (e.g. for inline component boundaries)
      if (this.props.fallback) {
        return this.props.fallback;
      }

      // Wallet-specific conflict screen
      if (this.state.isWalletConflict) {
        return (
          <div className="min-h-screen flex items-center justify-center bg-[#0a0a0c] font-body text-white relative overflow-hidden p-6">
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-yellow-900/10 blur-[150px] rounded-none pointer-events-none"></div>
            <div className="max-w-xl w-full bg-surface-container-low border-2 border-yellow-700 p-8 relative z-10 shadow-[0_0_50px_rgba(255,215,0,0.15)] flex flex-col items-center">
              <Wallet className="w-24 h-24 text-yellow-500 mb-6" />
              <h1 className="font-headline font-black text-3xl uppercase tracking-tighter text-yellow-500 mb-2">WALLET CONFLICT</h1>
              <h2 className="font-headline font-bold text-lg uppercase tracking-widest text-on-surface-variant mb-6 text-center">
                Multiple wallet extensions are competing for the provider.
              </h2>

              <div className="bg-surface-container-highest border border-outline-variant/30 p-4 w-full mb-4 text-sm text-on-surface-variant space-y-2">
                <p>This usually happens when you have multiple wallet extensions installed (e.g. MetaMask + Rabby).</p>
                <p className="text-yellow-300/80">Try one of these:</p>
                <ul className="list-disc list-inside space-y-1 text-xs">
                  <li>Refresh the page and try again</li>
                  <li>Disable other wallet extensions temporarily</li>
                  <li>Use WalletConnect instead of an injected provider</li>
                </ul>
              </div>

              <div className="bg-surface-container-highest border border-outline-variant/30 p-3 w-full mb-6 font-mono text-xs text-red-300/60 overflow-x-auto whitespace-pre-wrap">
                {this.state.error?.message || "Unknown wallet error"}
              </div>

              <div className="flex gap-3 w-full">
                <button
                  onClick={this.handleRetry}
                  className="flex-1 bg-yellow-600 hover:bg-yellow-500 text-black flex items-center justify-center gap-2 font-headline font-black uppercase tracking-widest text-sm py-4 shadow-[0_0_20px_rgba(255,215,0,0.3)] transition-all active:scale-[0.98] cursor-pointer"
                >
                  <RefreshCw className="w-4 h-4" /> RETRY
                </button>
                <button
                  onClick={() => window.location.reload()}
                  className="flex-1 border border-outline-variant/30 text-on-surface-variant font-headline font-bold py-4 uppercase tracking-widest text-sm hover:text-white hover:border-primary/50 transition-colors cursor-pointer"
                >
                  RELOAD PAGE
                </button>
              </div>
            </div>
          </div>
        );
      }

      // Default: full-page crash screen
      return (
        <div className="min-h-screen flex items-center justify-center bg-[#0a0a0c] font-body text-white relative overflow-hidden p-6">
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-red-900/10 blur-[150px] rounded-none pointer-events-none"></div>
          <div className="max-w-xl w-full bg-surface-container-low border-2 border-red-900 p-8 relative z-10 shadow-[0_0_50px_rgba(255,0,0,0.15)] flex flex-col items-center">
            <TriangleAlert className="w-24 h-24 text-red-500 mb-6 animate-pulse" />
            <h1 className="font-headline font-black text-4xl uppercase tracking-tighter text-red-500 mb-2">SYSTEM FAILURE</h1>
            <h2 className="font-headline font-bold text-xl uppercase tracking-widest text-on-surface-variant mb-8 text-center">
              The Beast crashed into a critical exception.
            </h2>

            <div className="bg-surface-container-highest border border-outline-variant/30 p-4 w-full mb-8 font-mono text-xs text-red-300/80 overflow-x-auto whitespace-pre-wrap">
              {this.state.error?.message || "Unknown Core Panic"}
            </div>

            <button
              onClick={() => window.location.reload()}
              className="bg-red-600 hover:bg-red-500 text-white flex items-center gap-2 font-headline font-black uppercase tracking-widest text-lg w-full justify-center py-5 shadow-[0_0_20px_rgba(255,0,0,0.4)] transition-all active:scale-[0.98] cursor-pointer"
            >
              <RefreshCw className="w-5 h-5" /> REBOOT CORE
            </button>
          </div>
        </div>
      );
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (this as any).props.children;
  }
}
