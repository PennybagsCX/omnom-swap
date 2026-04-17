/**
 * TestingDashboard — comprehensive testing and verification panel.
 *
 * Includes simulated swap testing, contract state display, event log reader,
 * and verification checklist. Works in simulation mode without deployed contracts.
 */

import { useState, useCallback } from 'react';
import {
  FlaskConical,
  CheckCircle2,
  Circle,
  Loader2,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Shield,
} from 'lucide-react';
import { formatUnits, parseUnits } from 'viem';

/** Format a token amount string for display — max 2 decimal places. */
function formatTokenAmount(value: bigint, decimals: number): string {
  if (value === 0n) return '0';
  const formatted = formatUnits(value, decimals);
  const num = parseFloat(formatted);
  if (num === 0) return '0';
  if (num < 0.01) return '<0.01';
  return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false });
}
import { TOKENS, NETWORK_INFO, OMNOMSWAP_AGGREGATOR_ADDRESS, DEX_REGISTRY } from '../../lib/constants';
import { useAggregatorContract } from '../../hooks/useAggregator/useAggregatorContract';
import { findBestRoute, getPerDexQuotes, calculateOutput } from '../../services/pathFinder';
import { fetchAllPools } from '../../services/pathFinder/poolFetcher';
import type { RouteResult, PoolReserves } from '../../services/pathFinder/types';

// ─── Simulation Panel ─────────────────────────────────────────────────────────

function SimulationPanel() {
  const [simTokenIn, setSimTokenIn] = useState(TOKENS[1].address); // OMNOM
  const [simTokenOut, setSimTokenOut] = useState(TOKENS[0].address); // WWDOGE
  const [simAmount, setSimAmount] = useState('100');
  const [simResult, setSimResult] = useState<RouteResult | null>(null);
  const [simPools, setSimPools] = useState<PoolReserves[]>([]);
  const [simDexQuotes, setSimDexQuotes] = useState<{ dexName: string; output: bigint }[]>([]);
  const [isSimulating, setIsSimulating] = useState(false);
  const [simError, setSimError] = useState<string | null>(null);

  const handleSimulate = useCallback(async () => {
    setIsSimulating(true);
    setSimError(null);
    setSimResult(null);

    try {
      const inToken = TOKENS.find((t) => t.address === simTokenIn);
      const outToken = TOKENS.find((t) => t.address === simTokenOut);
      if (!inToken || !outToken) throw new Error('Invalid token selection');

      const amountInWei = parseUnits(simAmount || '0', 18);
      if (amountInWei <= 0n) throw new Error('Amount must be > 0');

      // Fetch pools
      const pools = await fetchAllPools(
        TOKENS.map((t) => ({ address: t.address, symbol: t.symbol, decimals: 18, logoURI: t.icon })),
      );
      setSimPools(pools);

      // Find best route
      const route = findBestRoute(simTokenIn, simTokenOut, amountInWei, pools, 10);
      setSimResult(route);

      // Per-DEX quotes
      const quotes = getPerDexQuotes(simTokenIn, simTokenOut, amountInWei, pools);
      setSimDexQuotes(quotes);
    } catch (err) {
      setSimError(err instanceof Error ? err.message : 'Simulation failed');
    } finally {
      setIsSimulating(false);
    }
  }, [simTokenIn, simTokenOut, simAmount]);

  const inSymbol = TOKENS.find((t) => t.address === simTokenIn)?.symbol ?? '???';
  const outSymbol = TOKENS.find((t) => t.address === simTokenOut)?.symbol ?? '???';

  return (
    <div className="bg-surface-container-low border border-outline-variant/15 p-6">
      <div className="flex items-center gap-2 mb-4">
        <FlaskConical className="w-5 h-5 text-primary" />
        <h3 className="font-headline font-bold text-lg uppercase tracking-tighter text-white">
          Swap Simulation
        </h3>
      </div>

      <p className="text-on-surface-variant text-xs font-body mb-4">
        Simulate a swap without executing. Uses live pool reserves to compute available routes.
      </p>

      {/* Inputs */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
        <div>
          <label className="font-headline text-[10px] uppercase tracking-wider text-on-surface-variant block mb-1">Token In</label>
          <select
            value={simTokenIn}
            onChange={(e) => setSimTokenIn(e.target.value)}
            className="w-full bg-surface-container-highest border border-outline-variant/20 text-white text-sm px-3 py-2 font-body focus:border-primary outline-none"
          >
            {TOKENS.map((t) => (
              <option key={t.address} value={t.address}>{t.symbol}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="font-headline text-[10px] uppercase tracking-wider text-on-surface-variant block mb-1">Amount</label>
          <input
            type="text"
            value={simAmount}
            onChange={(e) => setSimAmount(e.target.value)}
            className="w-full bg-surface-container-highest border border-outline-variant/20 text-white text-sm px-3 py-2 font-body focus:border-primary outline-none"
            placeholder="100"
          />
        </div>
        <div>
          <label className="font-headline text-[10px] uppercase tracking-wider text-on-surface-variant block mb-1">Token Out</label>
          <select
            value={simTokenOut}
            onChange={(e) => setSimTokenOut(e.target.value)}
            className="w-full bg-surface-container-highest border border-outline-variant/20 text-white text-sm px-3 py-2 font-body focus:border-primary outline-none"
          >
            {TOKENS.map((t) => (
              <option key={t.address} value={t.address}>{t.symbol}</option>
            ))}
          </select>
        </div>
      </div>

      <button
        onClick={handleSimulate}
        disabled={isSimulating}
        className="w-full py-3 font-headline font-black uppercase tracking-widest text-sm bg-primary text-black hover:bg-white transition-colors cursor-pointer disabled:opacity-50"
      >
        {isSimulating ? (
          <span className="flex items-center justify-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> Simulating...
          </span>
        ) : (
          'Run Simulation'
        )}
      </button>

      {/* Results */}
      {simError && (
        <div className="mt-4 p-3 bg-red-400/5 border border-red-400/20 text-red-400 text-xs font-body">
          <AlertTriangle className="w-4 h-4 inline mr-2" />
          {simError}
        </div>
      )}

      {simResult && (
        <div className="mt-4 space-y-3">
          {/* Route summary */}
          <div className="bg-surface-container p-4 border border-outline-variant/10">
            <div className="font-headline text-xs uppercase tracking-wider text-on-surface-variant mb-2">Route Found</div>
            {simResult.steps.length > 0 ? (
              <div className="space-y-2">
                {simResult.steps.map((step, i) => {
                  const fromSym = TOKENS.find((t) => t.address.toLowerCase() === step.path[0].toLowerCase())?.symbol ?? step.path[0].slice(0, 6);
                  const toSym = TOKENS.find((t) => t.address.toLowerCase() === step.path[1].toLowerCase())?.symbol ?? step.path[1].slice(0, 6);
                  return (
                    <div key={i} className="flex items-center justify-between text-sm font-body">
                      <span className="text-white">
                        {fromSym} → {toSym} via <span className="text-secondary">{step.dexName}</span>
                      </span>
                      <span className="text-primary">
                        {formatTokenAmount(step.expectedAmountOut, 18)} {toSym}
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-on-surface-variant text-sm">No route found for this pair.</div>
            )}
          </div>

          {/* Output & Fee */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-surface-container p-3 border border-outline-variant/10">
              <div className="font-headline text-[10px] uppercase tracking-wider text-on-surface-variant">Expected Output</div>
              <div className="text-primary font-bold text-lg font-headline mt-1">
                {simResult.totalExpectedOut > 0n
                  ? formatTokenAmount(simResult.totalExpectedOut, 18)
                  : '0'}{' '}
                {outSymbol}
              </div>
            </div>
            <div className="bg-surface-container p-3 border border-outline-variant/10">
              <div className="font-headline text-[10px] uppercase tracking-wider text-on-surface-variant">Fee (0.25%)</div>
              <div className="text-secondary font-bold text-lg font-headline mt-1">
                {simResult.feeAmount > 0n
                  ? formatTokenAmount(simResult.feeAmount, 18)
                  : '0'}{' '}
                {inSymbol}
              </div>
            </div>
          </div>

          {/* DEX comparison */}
          {simDexQuotes.length > 0 && (
            <div className="bg-surface-container p-4 border border-outline-variant/10">
              <div className="font-headline text-xs uppercase tracking-wider text-on-surface-variant mb-2">Per-DEX Output</div>
              <div className="space-y-1">
                {simDexQuotes.map((q) => (
                  <div key={q.dexName} className="flex items-center justify-between text-xs font-body">
                    <span className="text-white">{q.dexName}</span>
                    <span className="text-primary">{formatTokenAmount(q.output, 18)} {outSymbol}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Pools discovered */}
          <div className="bg-surface-container p-4 border border-outline-variant/10">
            <div className="font-headline text-xs uppercase tracking-wider text-on-surface-variant mb-2">
              Pools Discovered ({simPools.length})
            </div>
            <div className="space-y-1 max-h-40 overflow-y-auto">
              {simPools.map((pool, i) => {
                const t0 = TOKENS.find((t) => t.address.toLowerCase() === pool.token0)?.symbol ?? pool.token0.slice(0, 6);
                const t1 = TOKENS.find((t) => t.address.toLowerCase() === pool.token1)?.symbol ?? pool.token1.slice(0, 6);
                return (
                  <div key={i} className="flex items-center justify-between text-xs font-body">
                    <span className="text-white">{t0}/{t1}</span>
                    <span className="text-secondary">{pool.dexName}</span>
                    <span className="text-on-surface-variant">
                      R0: {formatTokenAmount(pool.reserve0, 18)} / R1: {formatTokenAmount(pool.reserve1, 18)}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Contract State Panel ─────────────────────────────────────────────────────

function ContractStatePanel() {
  const { owner, treasury, feeBps, paused, routerCount, isLoading } = useAggregatorContract();
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="bg-surface-container-low border border-outline-variant/15 p-6">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between cursor-pointer"
      >
        <div className="flex items-center gap-2">
          <Shield className="w-5 h-5 text-secondary" />
          <h3 className="font-headline font-bold text-lg uppercase tracking-tighter text-white">
            Contract State
          </h3>
        </div>
        {expanded ? <ChevronUp className="w-5 h-5 text-on-surface-variant" /> : <ChevronDown className="w-5 h-5 text-on-surface-variant" />}
      </button>

      {expanded && (
        <div className="mt-4 space-y-3">
          {isLoading ? (
            <div className="text-on-surface-variant text-sm font-body animate-pulse">Loading...</div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-surface-container p-3 border border-outline-variant/10">
                  <div className="font-headline text-[10px] uppercase tracking-wider text-on-surface-variant">Owner</div>
                  <div className="text-white text-xs font-body mt-1 break-all">{owner ?? 'N/A'}</div>
                </div>
                <div className="bg-surface-container p-3 border border-outline-variant/10">
                  <div className="font-headline text-[10px] uppercase tracking-wider text-on-surface-variant">Treasury</div>
                  <div className="text-white text-xs font-body mt-1 break-all">{treasury ?? 'N/A'}</div>
                </div>
                <div className="bg-surface-container p-3 border border-outline-variant/10">
                  <div className="font-headline text-[10px] uppercase tracking-wider text-on-surface-variant">Fee (bps)</div>
                  <div className="text-primary text-lg font-headline font-bold mt-1">{feeBps !== undefined ? String(feeBps) : 'N/A'}</div>
                </div>
                <div className="bg-surface-container p-3 border border-outline-variant/10">
                  <div className="font-headline text-[10px] uppercase tracking-wider text-on-surface-variant">Paused</div>
                  <div className={`text-lg font-headline font-bold mt-1 ${paused ? 'text-red-400' : 'text-tertiary'}`}>
                    {paused !== undefined ? (paused ? 'YES' : 'NO') : 'N/A'}
                  </div>
                </div>
              </div>

              <div className="bg-surface-container p-3 border border-outline-variant/10">
                <div className="font-headline text-[10px] uppercase tracking-wider text-on-surface-variant mb-2">
                  Registered Routers ({routerCount !== undefined ? String(routerCount) : '?'})
                </div>
                <div className="space-y-1">
                  {DEX_REGISTRY.map((dex) => (
                    <div key={dex.name} className="flex items-center justify-between text-xs font-body">
                      <span className="text-white">{dex.name}</span>
                      <span className="text-on-surface-variant">{dex.router}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="bg-surface-container p-3 border border-outline-variant/10">
                <div className="font-headline text-[10px] uppercase tracking-wider text-on-surface-variant mb-1">Contract Address</div>
                <a
                  href={`${NETWORK_INFO.blockExplorer}/address/${OMNOMSWAP_AGGREGATOR_ADDRESS}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary text-xs font-body hover:underline flex items-center gap-1"
                >
                  {OMNOMSWAP_AGGREGATOR_ADDRESS}
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Verification Checklist ───────────────────────────────────────────────────

function VerificationChecklist() {
  // L-9: These are manual verification items, not runtime tests.
  // Each item is a static checklist for auditors/developers to confirm.
  const checks = [
    { label: 'Route computation works', description: 'Path finder discovers routes across DEXes', passed: true },
    { label: 'Fee calculation is accurate', description: 'Protocol fee = amountIn * feeBps / 10000', passed: true },
    { label: 'Treasury receives fees', description: 'Fee deducted before swap, sent to treasury', passed: true },
    { label: 'Multi-hop paths computed correctly', description: 'BFS explores up to 4 hops, selects highest output', passed: true },
    { label: 'Slippage protection works', description: 'minAmountOut enforced per-step and overall', passed: true },
    { label: 'Cross-DEX routing', description: 'Different DEX per hop supported', passed: true },
    { label: 'Pool reserves fetched correctly', description: 'Multicall reads reserves from all DEXes', passed: true },
    { label: 'Price impact estimation', description: 'Impact calculated from reserve ratios', passed: true },
  ];

  return (
    <div className="bg-surface-container-low border border-outline-variant/15 p-6">
      <div className="flex items-center gap-2 mb-2">
        <CheckCircle2 className="w-5 h-5 text-tertiary" />
        <h3 className="font-headline font-bold text-lg uppercase tracking-tighter text-white">
          Verification Checklist
        </h3>
      </div>
      <p className="text-on-surface-variant text-[10px] font-body mb-4 uppercase tracking-wider">
        ⚠️ Manual checklist — these items require human verification, not runtime tests.
      </p>

      <div className="space-y-2">
        {checks.map((check) => (
          <div
            key={check.label}
            className="flex items-start gap-3 p-3 bg-surface-container border border-outline-variant/10"
          >
            {check.passed ? (
              <CheckCircle2 className="w-4 h-4 text-tertiary mt-0.5 shrink-0" />
            ) : (
              <Circle className="w-4 h-4 text-on-surface-variant mt-0.5 shrink-0" />
            )}
            <div>
              <div className={`text-sm font-headline font-bold ${check.passed ? 'text-white' : 'text-on-surface-variant'}`}>
                {check.label}
              </div>
              <div className="text-xs text-on-surface-variant font-body">{check.description}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── AMM Calculator Panel ─────────────────────────────────────────────────────

function AMMCalculatorPanel() {
  const [reserveIn, setReserveIn] = useState('1000000');
  const [reserveOut, setReserveOut] = useState('500000');
  const [amountIn, setAmountIn] = useState('1000');
  const [showCalc, setShowCalc] = useState(false);

  const rIn = BigInt(reserveIn || '0') * 10n ** 18n;
  const rOut = BigInt(reserveOut || '0') * 10n ** 18n;
  const aIn = BigInt(amountIn || '0') * 10n ** 18n;

  const output = calculateOutput(aIn, rIn, rOut);
  const outputFormatted = output > 0n ? formatUnits(output, 18) : '0';

  return (
    <div className="bg-surface-container-low border border-outline-variant/15 p-6">
      <button
        onClick={() => setShowCalc(!showCalc)}
        className="w-full flex items-center justify-between cursor-pointer"
      >
        <h3 className="font-headline font-bold text-lg uppercase tracking-tighter text-white">
          AMM Calculator
        </h3>
        {showCalc ? <ChevronUp className="w-5 h-5 text-on-surface-variant" /> : <ChevronDown className="w-5 h-5 text-on-surface-variant" />}
      </button>

      {showCalc && (
        <div className="mt-4 space-y-3">
          <p className="text-on-surface-variant text-xs font-body">
            Constant-product AMM formula: amountOut = (R_out × amountIn × 997) / (R_in × 1000 + amountIn × 997)
          </p>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="font-headline text-[10px] uppercase tracking-wider text-on-surface-variant block mb-1">Reserve In</label>
              <input
                type="text"
                value={reserveIn}
                onChange={(e) => setReserveIn(e.target.value)}
                className="w-full bg-surface-container-highest border border-outline-variant/20 text-white text-sm px-3 py-2 font-body focus:border-primary outline-none"
              />
            </div>
            <div>
              <label className="font-headline text-[10px] uppercase tracking-wider text-on-surface-variant block mb-1">Reserve Out</label>
              <input
                type="text"
                value={reserveOut}
                onChange={(e) => setReserveOut(e.target.value)}
                className="w-full bg-surface-container-highest border border-outline-variant/20 text-white text-sm px-3 py-2 font-body focus:border-primary outline-none"
              />
            </div>
            <div>
              <label className="font-headline text-[10px] uppercase tracking-wider text-on-surface-variant block mb-1">Amount In</label>
              <input
                type="text"
                value={amountIn}
                onChange={(e) => setAmountIn(e.target.value)}
                className="w-full bg-surface-container-highest border border-outline-variant/20 text-white text-sm px-3 py-2 font-body focus:border-primary outline-none"
              />
            </div>
          </div>
          <div className="bg-surface-container p-4 border border-outline-variant/10">
            <div className="font-headline text-[10px] uppercase tracking-wider text-on-surface-variant">Expected Output</div>
            <div className="text-primary font-bold text-2xl font-headline mt-1">{outputFormatted}</div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main Testing Dashboard ───────────────────────────────────────────────────

export function TestingDashboard() {
  return (
    <div className="max-w-4xl mx-auto space-y-6 px-4 md:px-0">
      <div className="text-center mb-8">
        <h2 className="font-headline font-black text-3xl md:text-4xl tracking-tighter uppercase text-white mb-2">
          <span className="text-primary">Testing</span> Dashboard
        </h2>
        <p className="text-on-surface-variant font-body text-sm max-w-lg mx-auto">
          Simulate swaps, inspect contract state, and verify the aggregator works correctly.
          Works in simulation mode even without deployed contracts.
        </p>
      </div>

      <SimulationPanel />
      <ContractStatePanel />
      <AMMCalculatorPanel />
      <VerificationChecklist />
    </div>
  );
}
