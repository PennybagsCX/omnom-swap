/**
 * RouteVisualization — visual display of the swap route and routing options.
 *
 * Shows each hop as a node with DEX name, animated arrow connections,
 * amounts at each step, and fee deduction at the start.
 * Routes with more than 2 hops wrap to a new line.
 *
 * Phase 4 enhancements:
 *   - Displays available routing options ranked by expected output
 *   - Shows each route's estimated output, price impact, and number of hops
 *   - Allows user to select preferred routing path
 *   - Clearly warns about additional gas costs for multi-hop routes
 *   - Shows "Direct" vs "Via WWDOGE" vs "Via Other" options
 *
 * Phase 5 enhancements:
 *   - Price impact warnings (>5% shown as caution, >10% as danger)
 *   - Route freshness indicator
 */

import { ArrowRight, ArrowDown, Zap, AlertTriangle, Fuel, Info } from 'lucide-react';
import { formatUnits } from 'viem';
import type { RouteResult, RouteLiquidityAnalysis, RouteComparison, RouteAdvisorConfig } from '../../services/pathFinder/types';
import { DEFAULT_ADVISOR_CONFIG } from '../../services/pathFinder/types';
import { TOKENS, getTokenDecimals, impactColor, CONTRACTS } from '../../lib/constants';
import { formatCompactAmount } from '../../lib/format';

interface RouteVisualizationProps {
  route: RouteResult | null;
  allRoutes?: RouteResult[];
  onRouteSelect?: (route: RouteResult) => void;
  selectedRouteId?: string | null;
  priceImpactWarnings?: Array<{
    routeId: string;
    priceImpact: number;
    message: string;
    severity: 'warn' | 'block';
  }>;
  /** Phase 7: Advisor mode configuration */
  advisorConfig?: RouteAdvisorConfig;
  /** Phase 7: Route liquidity analysis for showing suboptimal direct route warnings */
  routeLiquidityAnalysis?: RouteLiquidityAnalysis | null;
  /** Phase 7: Comparison result between direct and multi-hop routes */
  routeComparison?: RouteComparison | null;
}

interface RouteOption {
  route: RouteResult;
  label: string;
  hopsLabel: string;
  outputLabel: string;
  priceImpactLabel: string;
  gasWarning?: string;
  isSelected: boolean;
  hasWarning: boolean;
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

/**
 * Classify a route and generate a human-readable label.
 */
function classifyRouteLabel(route: RouteResult, _tokenIn: string, _tokenOut: string): string {
  if (!route.routeType || route.routeType === 'direct') {
    return 'Direct';
  }

  // Multi-hop route — identify the intermediate
  if (route.intermediateToken) {
    const intermediateSymbol = getTokenSymbol(route.intermediateToken);
    return `Via ${intermediateSymbol}`;
  }

  // Generic multi-hop
  return `${route.steps.length} Hops`;
}

/**
 * Build route options for display, sorted by output descending.
 */
function buildRouteOptions(
  allRoutes: RouteResult[],
  selectedRouteId: string | null | undefined,
  tokenIn: string,
  tokenOut: string,
  priceImpactWarnings: Array<{ routeId: string; priceImpact: number; message: string; severity: 'warn' | 'block' }> | undefined,
  _onRouteSelect: ((route: RouteResult) => void) | undefined,
): RouteOption[] {
  const outDecimals = getTokenDecimals(tokenOut);

  return allRoutes.map((route) => {
    const label = classifyRouteLabel(route, tokenIn, tokenOut);
    const hopsLabel = route.steps.length === 1 ? '1 hop' : `${route.steps.length} hops`;
    const outputLabel = formatTokenAmount(route.totalExpectedOut, outDecimals);
    const priceImpactPct = (route.priceImpact * 100).toFixed(2);
    const priceImpactLabel = `${priceImpactPct}% impact`;

    // Gas warning for multi-hop routes
    const gasWarning = route.steps.length > 1
      ? `~${route.steps.length}x gas cost`
      : undefined;

    const isSelected = route.id === selectedRouteId;
    const warning = priceImpactWarnings?.find(w => w.routeId === route.id);

    return {
      route,
      label,
      hopsLabel,
      outputLabel,
      priceImpactLabel,
      gasWarning,
      isSelected,
      hasWarning: !!warning,
    };
  });
}

/** Single route option for selection */
function RouteOptionCard({
  option,
  onSelect,
  warning,
}: {
  option: RouteOption;
  onSelect?: (route: RouteResult) => void;
  warning?: { severity: 'warn' | 'block'; message: string };
}) {
  const { route, label, hopsLabel, outputLabel, priceImpactLabel, gasWarning, isSelected, hasWarning } = option;

  const borderColor = isSelected
    ? 'border-primary/50'
    : hasWarning
      ? 'border-yellow-500/30'
      : 'border-outline-variant/20';

  const bgColor = isSelected
    ? 'bg-primary/5'
    : hasWarning
      ? 'bg-yellow-500/5'
      : 'bg-surface-container-low';

  return (
    <button
      type="button"
      onClick={() => onSelect?.(route)}
      className={`w-full text-left p-3 rounded-lg border ${borderColor} ${bgColor} transition-all hover:border-primary/30 hover:bg-primary/5`}
    >
      <div className="flex items-center justify-between gap-2">
        {/* Route label and type */}
        <div className="flex flex-col items-start gap-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-headline text-sm text-white">{label}</span>
            {route.steps.length > 1 && (
              <span className="flex items-center gap-0.5 text-[10px] text-secondary">
                <Fuel className="w-3 h-3" />
                {gasWarning}
              </span>
            )}
          </div>
          <span className="text-[10px] text-on-surface-variant">
            {hopsLabel} · {route.steps.map(s => s.dexName).join(' → ')}
          </span>
        </div>

        {/* Output and price impact */}
        <div className="flex flex-col items-end gap-1">
          <span className="font-headline text-sm text-primary">
            {outputLabel}
          </span>
          <span className={`text-[10px] ${impactColor(route.priceImpact)}`}>
            {priceImpactLabel}
          </span>
        </div>
      </div>

      {/* Warning message */}
      {warning && (
        <div className={`mt-2 flex items-center gap-1.5 text-[10px] ${warning.severity === 'block' ? 'text-red-400' : 'text-yellow-400'}`}>
          <AlertTriangle className="w-3 h-3" />
          <span>{warning.message}</span>
        </div>
      )}
    </button>
  );
}

export function RouteVisualization({
  route,
  allRoutes = [],
  onRouteSelect,
  selectedRouteId,
  priceImpactWarnings = [],
  advisorConfig = DEFAULT_ADVISOR_CONFIG,
  routeLiquidityAnalysis,
  routeComparison,
}: RouteVisualizationProps) {
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

  // Build route options if multiple routes available
  const routeOptions = allRoutes.length > 1
    ? buildRouteOptions(allRoutes, selectedRouteId ?? route.id, firstToken, lastToken, priceImpactWarnings, onRouteSelect)
    : [];

  // Split into rows of 2 hops max
  const rows = chunkSteps(route.steps, 2);

  // Check if route is multi-hop
  const isMultiHop = route.steps.length > 1;

  // Get the selected route's warning (if any)
  const routeWarning = priceImpactWarnings.find(w => w.routeId === route.id);

  return (
    <div className="bg-surface-container-low border border-outline-variant/15 p-4">
      <div className="flex items-center justify-center gap-2 mb-3">
        <Zap className="w-4 h-4 text-primary" />
        <span className="font-headline text-xs uppercase tracking-widest text-on-surface-variant">
          Selected Route
        </span>
        {isMultiHop && (
          <span className="flex items-center gap-1 text-[10px] text-secondary ml-2">
            <Fuel className="w-3 h-3" />
            Multi-hop
          </span>
        )}
        {/* Phase 7: "Recommended via WWDOGE" badge */}
        {advisorConfig.showWwdogeBadge && route.routeType === 'multi_hop' && route.intermediateToken?.toLowerCase() === CONTRACTS.WWDOGE.toLowerCase() && (
          <span className="flex items-center gap-1 px-2 py-0.5 bg-primary/10 border border-primary/20 rounded-full text-[10px] text-primary ml-2">
            <Zap className="w-3 h-3" />
            Recommended via WWDOGE
          </span>
        )}
        {/* Phase 7: "Low Liquidity" warning badge */}
        {advisorConfig.showLowLiquidityWarnings && route.routeType === 'direct' && routeLiquidityAnalysis?.shouldPreferMultiHop && (
          <span className="flex items-center gap-1 px-2 py-0.5 bg-yellow-500/10 border border-yellow-500/20 rounded-full text-[10px] text-yellow-400 ml-2">
            <AlertTriangle className="w-3 h-3" />
            Low Liquidity
          </span>
        )}
      </div>

      {/* Price impact warning banner */}
      {routeWarning && (
        <div className={`mb-3 flex items-center gap-2 px-3 py-2 rounded-lg text-xs ${
          routeWarning.severity === 'block'
            ? 'bg-red-500/10 border border-red-500/20 text-red-400'
            : 'bg-yellow-500/10 border border-yellow-500/20 text-yellow-400'
        }`}>
          <AlertTriangle className="w-4 h-4" />
          <span>{routeWarning.message}</span>
        </div>
      )}

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

      {/* ─── Phase 4: Alternative Routing Options UI ──────────────────────────── */}
      {routeOptions.length > 1 && (
        <div className="mt-4 pt-4 border-t border-outline-variant/10">
          <div className="flex items-center gap-2 mb-3">
            <Zap className="w-4 h-4 text-secondary" />
            <span className="font-headline text-xs uppercase tracking-widest text-secondary">
              Alternative Routes
            </span>
            <span className="text-[10px] text-on-surface-variant">
              ({routeOptions.length} available)
            </span>
          </div>

          <div className="flex flex-col gap-2">
            {routeOptions.slice(0, 5).map((option) => {
              const warning = priceImpactWarnings?.find(w => w.routeId === option.route.id);
              return (
                <RouteOptionCard
                  key={option.route.id}
                  option={option}
                  onSelect={onRouteSelect}
                  warning={warning ? { severity: warning.severity, message: warning.message } : undefined}
                />
              );
            })}
          </div>

          {routeOptions.length > 5 && (
            <div className="mt-2 text-[10px] text-on-surface-variant text-center">
              +{routeOptions.length - 5} more routes available
            </div>
          )}

          {/* Gas cost warning */}
          <div className="mt-3 flex items-center gap-2 px-3 py-2 bg-surface-container-highest border border-outline-variant/10 rounded-lg text-[10px] text-on-surface-variant">
            <Fuel className="w-3 h-3" />
            <span>Multi-hop routes may consume more gas. Direct routes are typically more efficient.</span>
          </div>
        </div>
      )}

      {/* ─── Phase 7: Advisor Mode Comparison View ──────────────────────────────── */}
      {advisorConfig.showComparisonView && routeComparison?.hasBetterAlternative && (
        <div className="mt-4 pt-4 border-t border-outline-variant/10">
          <div className="flex items-center gap-2 mb-3">
            <Info className="w-4 h-4 text-primary" />
            <span className="font-headline text-xs uppercase tracking-widest text-primary">
              Route Comparison
            </span>
          </div>
          <div className="text-[10px] text-on-surface-variant mb-3">
            {routeComparison.message}
          </div>
          <div className="grid grid-cols-2 gap-2">
            {/* Direct Option */}
            {allRoutes.find(r => r.routeType === 'direct') && (
              <button
                type="button"
                onClick={() => {
                  const directRoute = allRoutes.find(r => r.routeType === 'direct');
                  if (directRoute) onRouteSelect?.(directRoute);
                }}
                className={`p-3 rounded-lg border transition-all text-left ${
                  selectedRouteId === allRoutes.find(r => r.routeType === 'direct')?.id
                    ? 'bg-primary/10 border-primary/30'
                    : 'bg-surface-container-highest border-outline-variant/20 hover:border-primary/20'
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="font-headline text-xs text-white">Direct</span>
                </div>
                <div className="text-[10px] text-on-surface-variant mb-1">
                  TVL: ${routeLiquidityAnalysis?.directRouteTVL.toFixed(0) ?? '0'}
                </div>
              </button>
            )}
            {/* Multi-hop Option */}
            {allRoutes.find(r => r.routeType === 'multi_hop' && r.intermediateToken?.toLowerCase() === CONTRACTS.WWDOGE.toLowerCase()) && (
              <button
                type="button"
                onClick={() => {
                  const multiHopRoute = allRoutes.find(r => r.routeType === 'multi_hop' && r.intermediateToken?.toLowerCase() === CONTRACTS.WWDOGE.toLowerCase());
                  if (multiHopRoute) onRouteSelect?.(multiHopRoute);
                }}
                className={`p-3 rounded-lg border transition-all text-left ${
                  selectedRouteId === allRoutes.find(r => r.routeType === 'multi_hop' && r.intermediateToken?.toLowerCase() === CONTRACTS.WWDOGE.toLowerCase())?.id
                    ? 'bg-primary/10 border-primary/30'
                    : 'bg-surface-container-highest border-outline-variant/20 hover:border-primary/20'
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="font-headline text-xs text-white">Via WWDOGE</span>
                  <span className="flex items-center gap-0.5 px-1.5 py-0.5 bg-primary/10 border border-primary/20 rounded-full text-[8px] text-primary">
                    <Zap className="w-2.5 h-2.5" />
                    Better
                  </span>
                </div>
                <div className="text-[10px] text-on-surface-variant mb-1">
                  {routeComparison.savingsPercent.toFixed(2)}% more output
                </div>
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
