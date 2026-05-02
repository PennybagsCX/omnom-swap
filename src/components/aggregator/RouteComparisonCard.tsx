/**
 * RouteComparisonCard — Side-by-side comparison of direct vs multi-hop routes.
 *
 * Phase 7: Advisor mode component that shows when multi-hop via WWDOGE
 * would yield better output than the direct route.
 */

import { Zap, AlertTriangle, Check } from 'lucide-react';
import { formatUnits } from 'viem';
import type { RouteResult, RouteComparison } from '../../services/pathFinder/types';
import { getTokenDecimals } from '../../lib/constants';
import { formatCompactAmount } from '../../lib/format';

interface RouteComparisonCardProps {
  directRoute: RouteResult | null;
  multiHopRoute: RouteResult | null;
  comparison: RouteComparison;
  onSelectRoute: (route: RouteResult) => void;
  selectedRouteId?: string | null;
}

function formatTokenAmount(value: bigint, decimals: number): string {
  if (value === 0n) return '0';
  const formatted = formatUnits(value, decimals);
  const num = parseFloat(formatted);
  if (num === 0) return '0';
  return formatCompactAmount(num);
}

export function RouteComparisonCard({
  directRoute,
  multiHopRoute,
  comparison,
  onSelectRoute,
  selectedRouteId,
}: RouteComparisonCardProps) {
  if (!comparison.hasBetterAlternative && !directRoute && !multiHopRoute) {
    return null;
  }

  const outDecimals = multiHopRoute
    ? getTokenDecimals(multiHopRoute.steps[multiHopRoute.steps.length - 1].path[1])
    : directRoute
      ? getTokenDecimals(directRoute.steps[directRoute.steps.length - 1].path[1])
      : 18;

  return (
    <div className="bg-surface-container-low border border-outline-variant/15 p-4 rounded-lg">
      <div className="flex items-center gap-2 mb-3">
        <Zap className="w-4 h-4 text-primary" />
        <span className="font-headline text-xs uppercase tracking-widest text-primary">
          Route Comparison
        </span>
      </div>

      <div className="text-[10px] text-on-surface-variant mb-3">
        {comparison.message}
      </div>

      <div className="grid grid-cols-2 gap-2">
        {/* Direct Route Option */}
        {directRoute && (
          <button
            type="button"
            onClick={() => onSelectRoute(directRoute)}
            className={`p-3 rounded-lg border transition-all text-left ${
              selectedRouteId === directRoute.id
                ? 'bg-primary/10 border-primary/30'
                : 'bg-surface-container-highest border-outline-variant/20 hover:border-primary/20'
            }`}
          >
            <div className="flex items-center justify-between mb-2">
              <span className="font-headline text-xs text-white">Direct</span>
              {selectedRouteId === directRoute.id && (
                <Check className="w-3 h-3 text-primary" />
              )}
            </div>
            <div className="text-[10px] text-on-surface-variant mb-1">
              {directRoute.steps.length} hop{directRoute.steps.length !== 1 ? 's' : ''}
            </div>
            <div className="font-headline text-sm text-primary">
              {formatTokenAmount(directRoute.totalExpectedOut, outDecimals)}
            </div>
            <div className="text-[10px] text-secondary mt-1">
              {directRoute.steps.map(s => s.dexName).join(' → ')}
            </div>
          </button>
        )}

        {/* Multi-Hop Route Option */}
        {multiHopRoute && (
          <button
            type="button"
            onClick={() => onSelectRoute(multiHopRoute)}
            className={`p-3 rounded-lg border transition-all text-left ${
              selectedRouteId === multiHopRoute.id
                ? 'bg-primary/10 border-primary/30'
                : 'bg-surface-container-highest border-outline-variant/20 hover:border-primary/20'
            }`}
          >
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-1">
                <span className="font-headline text-xs text-white">Via WWDOGE</span>
                {comparison.hasBetterAlternative && comparison.betterRoute === 'multi_hop' && (
                  <span className="flex items-center gap-0.5 px-1.5 py-0.5 bg-primary/10 border border-primary/20 rounded-full text-[8px] text-primary">
                    <Zap className="w-2.5 h-2.5" />
                    Better
                  </span>
                )}
              </div>
              {selectedRouteId === multiHopRoute.id && (
                <Check className="w-3 h-3 text-primary" />
              )}
            </div>
            <div className="text-[10px] text-on-surface-variant mb-1">
              {multiHopRoute.steps.length} hop{multiHopRoute.steps.length !== 1 ? 's' : ''}
            </div>
            <div className="font-headline text-sm text-primary">
              {formatTokenAmount(multiHopRoute.totalExpectedOut, outDecimals)}
            </div>
            <div className="text-[10px] text-secondary mt-1">
              {multiHopRoute.steps.map(s => s.dexName).join(' → ')}
            </div>
          </button>
        )}
      </div>

      {/* Warning for low liquidity direct route */}
      {directRoute && comparison.betterRoute === 'multi_hop' && (
        <div className="mt-3 flex items-center gap-2 px-3 py-2 bg-yellow-500/5 border border-yellow-500/10 rounded-lg text-[10px] text-yellow-400">
          <AlertTriangle className="w-3 h-3" />
          <span>Direct route has low liquidity. Multi-hop via WWDOGE recommended for better execution.</span>
        </div>
      )}
    </div>
  );
}