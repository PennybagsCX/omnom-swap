import { useState } from 'react';
import { AlertTriangle, X, Copy, Check } from 'lucide-react';
import { hasWalletConnect } from '../lib/web3/config';

const SESSION_KEY = 'omnom_telegram_banner_dismissed';

function isTelegramBrowser(): boolean {
  const ua = navigator.userAgent;
  return /TelegramBot|Telegram/i.test(ua);
}

export function TelegramBanner() {
  const [dismissed, setDismissed] = useState(() => {
    try {
      return sessionStorage.getItem(SESSION_KEY) === 'true';
    } catch {
      return false;
    }
  });
  const [copied, setCopied] = useState(false);

  // Don't render if not in Telegram or already dismissed
  if (!isTelegramBrowser() || dismissed) {
    return null;
  }

  const handleDismiss = () => {
    setDismissed(true);
    try {
      sessionStorage.setItem(SESSION_KEY, 'true');
    } catch {
      // sessionStorage may be unavailable
    }
  };

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback: create a temporary input element
      const input = document.createElement('input');
      input.value = window.location.href;
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      document.body.removeChild(input);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="bg-yellow-900/30 border-b border-yellow-500/30 px-4 py-3 relative">
      <div className="max-w-[1920px] mx-auto flex items-start gap-3">
        <AlertTriangle className="w-5 h-5 text-yellow-400 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="text-yellow-200 text-sm font-body leading-relaxed">
            ⚠️ To connect your wallet, open this page in your mobile browser (Safari or Chrome). MetaMask and other EVM wallet extensions don't work inside Telegram's browser.
          </p>
          {hasWalletConnect && (
            <p className="text-yellow-200/80 text-xs font-body mt-1">
              💡 Or use <strong>WalletConnect</strong> to link your mobile wallet directly from here.
            </p>
          )}
          <button
            onClick={handleCopyLink}
            className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 bg-yellow-500/20 border border-yellow-500/30 text-yellow-300 text-xs font-headline uppercase tracking-wider hover:bg-yellow-500/30 transition-colors cursor-pointer"
          >
            {copied ? (
              <>
                <Check className="w-3 h-3" />
                Copied!
              </>
            ) : (
              <>
                <Copy className="w-3 h-3" />
                Copy Link
              </>
            )}
          </button>
        </div>
        <button
          onClick={handleDismiss}
          className="text-yellow-400/60 hover:text-yellow-300 transition-colors cursor-pointer shrink-0 mt-0.5"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
