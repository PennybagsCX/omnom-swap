/**
 * TokenWarningBanner — displays tax and honeypot warnings.
 *
 * Matches existing OMNOM SWAP dark theme with severity-based colors.
 * Used in AggregatorSwap (above swap button + confirm modal) and TokenSelector.
 */

import { AlertTriangle, ShieldAlert, ShieldX, Info } from 'lucide-react';
import type { TokenTaxInfo } from '../../hooks/useTokenTax';

// ─── Severity styles ──────────────────────────────────────────────────────────

const SEVERITY_STYLES: Record<TokenTaxInfo['warningLevel'], {
  container: string;
  border: string;
  icon: string;
  badge: string;
}> = {
  none: { container: '', border: '', icon: '', badge: '' },
  low: {
    container: 'bg-yellow-400/5',
    border: 'border-yellow-400/20',
    icon: 'text-yellow-400',
    badge: 'bg-yellow-400/15 text-yellow-400',
  },
  medium: {
    container: 'bg-orange-400/5',
    border: 'border-orange-400/25',
    icon: 'text-orange-400',
    badge: 'bg-orange-400/15 text-orange-400',
  },
  high: {
    container: 'bg-red-400/5',
    border: 'border-red-400/30',
    icon: 'text-red-400',
    badge: 'bg-red-400/15 text-red-400',
  },
  danger: {
    container: 'bg-red-500/8',
    border: 'border-red-500/40',
    icon: 'text-red-400',
    badge: 'bg-red-500/20 text-red-400',
  },
  critical: {
    container: 'bg-red-600/10',
    border: 'border-red-600/50',
    icon: 'text-red-500',
    badge: 'bg-red-600/25 text-red-500',
  },
};

function getIcon(level: TokenTaxInfo['warningLevel']) {
  if (level === 'critical' || level === 'danger') return ShieldX;
  if (level === 'high') return ShieldAlert;
  if (level === 'medium' || level === 'low') return AlertTriangle;
  return Info;
}

// ─── Banner Component ─────────────────────────────────────────────────────────

interface TokenWarningBannerProps {
  taxInfo: TokenTaxInfo;
  /** Compact mode for inline use (e.g., inside confirm modal) */
  compact?: boolean;
  /** Custom className override */
  className?: string;
}

export function TokenWarningBanner({ taxInfo, compact, className }: TokenWarningBannerProps) {
  if (taxInfo.warningLevel === 'none') return null;

  const styles = SEVERITY_STYLES[taxInfo.warningLevel];
  const Icon = getIcon(taxInfo.warningLevel);

  return (
    <div
      className={`flex items-start justify-center gap-2 border text-on-surface-variant font-body text-center ${
        compact ? 'p-2 text-[10px]' : 'p-3 text-xs'
      } ${styles.container} ${styles.border} ${className || ''}`}
    >
      <Icon className={`shrink-0 ${compact ? 'w-3 h-3 mt-0.5' : 'w-4 h-4 mt-0.5'} ${styles.icon}`} />
      <span>{taxInfo.warningMessage}</span>
    </div>
  );
}

// ─── Tax Badge (for TokenSelector rows) ───────────────────────────────────────

interface TaxBadgeProps {
  taxInfo: TokenTaxInfo;
}

export function TaxBadge({ taxInfo }: TaxBadgeProps) {
  if (taxInfo.warningLevel === 'none' && !taxInfo.isTaxed) return null;

  const styles = SEVERITY_STYLES[taxInfo.warningLevel];

  if (taxInfo.isHoneypot) {
    return (
      <span className={`text-[9px] px-1.5 py-0.5 ${SEVERITY_STYLES.high.badge} rounded font-body`}>
        CAUTION
      </span>
    );
  }

  if (taxInfo.isTaxed) {
    const maxTax = Math.max(taxInfo.buyTax, taxInfo.sellTax);
    return (
      <span className={`text-[9px] px-1.5 py-0.5 ${styles.badge || SEVERITY_STYLES.low.badge} rounded font-body`}>
        {maxTax.toFixed(maxTax % 1 === 0 ? 0 : 1)}% TAX
      </span>
    );
  }

  return null;
}

// ─── Tax Fee Row (for fee breakdown) ──────────────────────────────────────────

interface TaxFeeRowProps {
  taxInfo: TokenTaxInfo;
  side: 'sell' | 'buy';
  /** The token amount being taxed (formatted string) */
  amount: string;
  /** Token symbol */
  symbol: string;
}

export function TaxFeeRow({ taxInfo, side, amount, symbol }: TaxFeeRowProps) {
  if (!taxInfo.isTaxed) return null;

  const tax = side === 'sell' ? taxInfo.sellTax : taxInfo.buyTax;

  return (
    <div className="flex justify-between text-xs font-headline text-on-surface-variant uppercase">
      <span>Token Tax ({tax.toFixed(tax % 1 === 0 ? 0 : 1)}% {side})</span>
      <span className="text-orange-400">
        {amount} {symbol}
      </span>
    </div>
  );
}
