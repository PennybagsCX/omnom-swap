/**
 * RouteVisualization — visual display of the swap route.
 *
 * Shows each hop as a node with DEX name, animated arrow connections,
 * amounts at each step, and fee deduction at the start.
 * Routes with more than 2 hops wrap to a new line.
 */

import { ArrowRight, ArrowDown, Zap } from 'lucide-react';
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

/** Token circle node */
function TokenNode({ symbol, variant }: { symbol: string; variant: 'primary' | 'secondary' }) {
  const border = variant === 'primary' ? 'border-primary/30' : 'border-outline-variant/30';
  const textColor = variant === 'primary' ? 'text-primary' : 'text-white';
  return (
    <div className="flex flex-col items-center px-1.5">
      <div className={`w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-surface-container-highest border ${border} flex items-center justify-center`}>
        <span className={`text-[9px] sm:text-[10px] font-headline font-bold ${textColor}`}>
          {symbol.slice(0, 3)}
        </span>
      </div>
      <span className="text-[9px] sm:text-[10px] text-on-surface-variant mt-0.5 max-w-[52px] truncate text-center">
        {symbol}
      </span>
    </div>
  );
}

/** Arrow connector between two tokens */
function HopArrow({ dexName, amount }: { dexName: string; amount: string }) {
  return (
    <div className="flex flex-col items-center mx-0.5 sm:mx-1">
      <span className="text-[8px] sm:text-[9px] font-headline uppercase tracking-wider text-secondary mb-0.5 whitespace-nowrap max-w-[72px] sm:max-w-[90px] truncate">
        {dexName}
      </span>
      <div className="flex items-center">
        <div className="h-px w-3 sm:w-4 bg-gradient-to-r from-primary/50 to-primary" />
        <ArrowRight className="w-2.5 h-2.5 sm:w-3 sm:h-3 text-primary animate-pulse" />
      </div>
      <span className="text-[8px] sm:text-[9px] text-on-surface-variant mt-0.5 whitespace-nowrap">
        {amount}
      </span>
    </div>
  );
}

/** Vertical connector between rows */
function RowConnector() {
  return (
    <div className="flex flex-col items-center py-0.5">
      <ArrowDown className="w-3 h-3 text-primary/60" />
    </div>
  );
}

/** Chunk steps into rows of max 2 hops */
function chunkSteps<T>(steps: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < steps.length; i += size) {
    chunks.push(steps.slice(i, i + size));
  }
  return chunks;
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

  // Split into rows of 2 hops max
  const rows = chunkSteps(route.steps, 2);

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
          <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 mb-3 px-3 py-1.5 bg-primary/5 border border-primary/10 text-xs font-body">
            <span className="text-on-surface-variant">Protocol Fee:</span>
            <span className="text-primary font-bold">
              {formatTokenAmount(route.feeAmount, feeDecimals)} {getTokenSymbol(firstToken)}
            </span>
            <span className="text-on-surface-variant">({route.feeBps / 100}% of input)</span>
          </div>
        );
      })()}

      {/* Route rows — 2 hops per line, stacked vertically */}
      <div className="flex flex-col items-center gap-0 py-2">
        {rows.map((rowSteps, rowIdx) => {
          const globalOffset = rowIdx * 2;

          return (
            <div key={rowIdx} className="contents">
              {/* Down arrow between rows */}
              {rowIdx > 0 && <RowConnector />}

              <div className="flex items-center justify-center gap-1 flex-wrap">
                {rowSteps.map((step, stepIdx) => {
                  const idx = globalOffset + stepIdx;
                  const fromSymbol = getTokenSymbol(step.path[0]);
                  const toSymbol = getTokenSymbol(step.path[1]);
                  const outDecimals = getTokenDecimals(step.path[1]);

                  return (
                    <div key={idx} className="flex items-center gap-1 shrink-0">
                      {/* From token — show only for the very first step of the route */}
                      {idx === 0 && (
                        <TokenNode symbol={fromSymbol} variant="primary" />
                      )}

                      <HopArrow
                        dexName={step.dexName}
                        amount={formatTokenAmount(step.expectedAmountOut, outDecimals)}
                      />

                      <TokenNode symbol={toSymbol} variant="secondary" />
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Summary — centered */}
      <div className="mt-3 pt-3 border-t border-outline-variant/10 flex flex-col items-center justify-center gap-1 text-xs font-body text-center">
        <div className="text-on-surface-variant break-words max-w-full">
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
