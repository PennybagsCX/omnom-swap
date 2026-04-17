/**
 * RouteVisualization — visual display of the swap route.
 *
 * Shows each hop as a node with DEX name, animated arrow connections,
 * amounts at each step, and fee deduction at the start.
 */

import { ArrowRight, Zap } from 'lucide-react';
import { formatUnits } from 'viem';
import type { RouteResult } from '../../services/pathFinder/types';
import { TOKENS, getTokenDecimals } from '../../lib/constants';
import { formatCompactAmount } from '../../lib/format';

interface RouteVisualizationProps {
  route: RouteResult | null;
}

function getTokenSymbol(address: string): string {
  const token = TOKENS.find((t) => t.address.toLowerCase() === address.toLowerCase());
  return token?.symbol ?? `${address.slice(0, 6)}...`;
}

/** Format a token amount string for display with compact notation for small values. */
function formatTokenAmount(value: bigint, decimals: number): string {
  if (value === 0n) return '0';
  const formatted = formatUnits(value, decimals);
  const num = parseFloat(formatted);
  if (num === 0) return '0';
  return formatCompactAmount(num);
}

export function RouteVisualization({ route }: RouteVisualizationProps) {
  if (!route || route.steps.length === 0) {
    return (
      <div className="bg-surface-container-low border border-outline-variant/15 p-4">
        <div className="flex items-center gap-2 mb-2">
          <Zap className="w-4 h-4 text-primary" />
          <span className="font-headline text-xs uppercase tracking-widest text-on-surface-variant">
            Route
          </span>
        </div>
        <div className="text-on-surface-variant font-body text-sm text-center py-4">
          No route found. Enter an amount to see available routes.
        </div>
      </div>
    );
  }

  const firstToken = route.steps[0].path[0];
  const lastStep = route.steps[route.steps.length - 1];
  const lastToken = lastStep.path[lastStep.path.length - 1];

  return (
    <div className="bg-surface-container-low border border-outline-variant/15 p-4">
      <div className="flex items-center justify-center gap-2 mb-3">
        <Zap className="w-4 h-4 text-primary" />
        <span className="font-headline text-xs uppercase tracking-widest text-on-surface-variant">
          Selected Route
        </span>
      </div>

      {/* Fee deduction indicator */}
      {route.feeAmount > 0n && (() => {
        const feeDecimals = getTokenDecimals(firstToken);
        return (
          <div className="flex items-center justify-center gap-2 mb-3 px-3 py-1.5 bg-primary/5 border border-primary/10 text-xs font-body">
            <span className="text-on-surface-variant">Protocol Fee:</span>
            <span className="text-primary font-bold">
              {formatTokenAmount(route.feeAmount, feeDecimals)} {getTokenSymbol(firstToken)}
            </span>
            <span className="text-on-surface-variant">({route.feeBps / 100}% of input)</span>
          </div>
        );
      })()}

      {/* Route nodes — centered */}
      <div className="flex items-center justify-center gap-1 overflow-x-auto no-scrollbar py-2">
        {route.steps.map((step, idx) => {
          const fromSymbol = getTokenSymbol(step.path[0]);
          const toSymbol = getTokenSymbol(step.path[1]);

          return (
            <div key={idx} className="flex items-center gap-1 shrink-0">
              {/* Token node */}
              {idx === 0 && (
                <div className="flex flex-col items-center px-2">
                  <div className="w-8 h-8 rounded-full bg-surface-container-highest border border-primary/30 flex items-center justify-center">
                    <span className="text-[10px] font-headline font-bold text-primary">
                      {fromSymbol.slice(0, 3)}
                    </span>
                  </div>
                  <span className="text-[10px] text-on-surface-variant mt-1">{fromSymbol}</span>
                </div>
              )}

              {/* Arrow with DEX label */}
              <div className="flex flex-col items-center mx-1">
                <span className="text-[9px] font-headline uppercase tracking-wider text-secondary mb-0.5 whitespace-nowrap">
                  {step.dexName}
                </span>
                <div className="flex items-center">
                  <div className="h-px w-4 bg-gradient-to-r from-primary/50 to-primary" />
                  <ArrowRight className="w-3 h-3 text-primary animate-pulse" />
                </div>
                <span className="text-[9px] text-on-surface-variant mt-0.5 whitespace-nowrap">
                  {formatTokenAmount(step.expectedAmountOut, 18)}
                </span>
              </div>

              {/* Token node */}
              <div className="flex flex-col items-center px-2">
                <div className="w-8 h-8 rounded-full bg-surface-container-highest border border-outline-variant/30 flex items-center justify-center">
                  <span className="text-[10px] font-headline font-bold text-white">
                    {toSymbol.slice(0, 3)}
                  </span>
                </div>
                <span className="text-[10px] text-on-surface-variant mt-1">{toSymbol}</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Summary — centered */}
      <div className="mt-3 pt-3 border-t border-outline-variant/10 flex flex-col items-center justify-center gap-1 text-xs font-body text-center">
        <div className="text-on-surface-variant break-all">
          {getTokenSymbol(firstToken)} → {getTokenSymbol(lastToken)} via{' '}
          {route.steps.map((s) => s.dexName).join(' → ')}
        </div>
        <div className="text-white">
          {route.steps.length} hop{route.steps.length !== 1 ? 's' : ''}
        </div>
      </div>
    </div>
  );
}
