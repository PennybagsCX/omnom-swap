/**
 * PriceComparison — table comparing prices across all DEXes.
 *
 * Displays output amounts across DEXes for comparison.
 * Provides sorting controls based on objective criteria: output amount,
 * alphabetical (DEX name), and difference from highest.
 */

import { useState } from 'react';
import { Trophy, ArrowUpDown } from 'lucide-react';
import { TOKENS, getTokenDecimals } from '../../lib/constants';
import { formatCompactAmount } from '../../lib/format';
import type { PerDexQuote } from '../../hooks/useAggregator/useRoute';

type SortMode = 'output-desc' | 'output-asc' | 'alpha';

interface PriceComparisonProps {
  dexQuotes: PerDexQuote[];
  aggregatorOutput: bigint | null;
  tokenOutAddress: string | undefined;
}

function getTokenSymbol(address: string): string {
  const token = TOKENS.find((t) => t.address.toLowerCase() === address.toLowerCase());
  return token?.symbol ?? '???';
}

const SORT_LABELS: Record<SortMode, string> = {
  'output-desc': 'Highest Output',
  'output-asc': 'Lowest Output',
  'alpha': 'A-Z (DEX)',
};

/** Format a token amount string for display with compact notation for small values. */
function formatTokenAmount(value: bigint, decimals: number): string {
  if (value === 0n) return '0';
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const whole = abs / (10n ** BigInt(decimals));
  const frac = abs % (10n ** BigInt(decimals));
  const fracStr = frac.toString().padStart(decimals, '0').replace(/0+$/, '');
  const formatted = `${negative ? '-' : ''}${whole}${fracStr ? '.' + fracStr : ''}`;
  const num = parseFloat(formatted);
  if (num === 0) return '0';
  return formatCompactAmount(num);
}

export function PriceComparison({ dexQuotes, aggregatorOutput, tokenOutAddress }: PriceComparisonProps) {
  const [sortMode, setSortMode] = useState<SortMode>('output-desc');
  const outDecimals = tokenOutAddress ? getTokenDecimals(tokenOutAddress) : 18;

  if (dexQuotes.length === 0 && !aggregatorOutput) {
    return null;
  }

  const outSymbol = tokenOutAddress ? getTokenSymbol(tokenOutAddress) : '';
  const allOutputs = [
    ...dexQuotes.map((q) => ({ name: q.dexName, output: q.output, isAggregator: false })),
    ...(aggregatorOutput && aggregatorOutput > 0n
      ? [{ name: 'OmnomSwap (Aggregated)', output: aggregatorOutput, isAggregator: true }]
      : []),
  ];

  if (allOutputs.length === 0) return null;

  const maxOutput = allOutputs.reduce((max, q) => (q.output > max ? q.output : max), 0n);

  // Apply sorting — L-1: use proper BigInt comparison to avoid precision loss
  const sorted = [...allOutputs].sort((a, b) => {
    switch (sortMode) {
      case 'output-desc':
        return a.output > b.output ? -1 : a.output < b.output ? 1 : 0;
      case 'output-asc':
        return a.output < b.output ? -1 : a.output > b.output ? 1 : 0;
      case 'alpha':
        return a.name.localeCompare(b.name);
      default:
        return 0;
    }
  });

  return (
    <div className="bg-surface-container-low border border-outline-variant/15 p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Trophy className="w-4 h-4 text-primary" />
          <span className="font-headline text-xs uppercase tracking-widest text-on-surface-variant">
            Price Comparison
          </span>
        </div>
      </div>

      {/* Sort controls */}
      <div className="flex items-center gap-2 mb-3">
        <ArrowUpDown className="w-3 h-3 text-on-surface-variant" />
        <span className="text-[10px] font-headline uppercase tracking-wider text-on-surface-variant">Sort:</span>
        {(Object.keys(SORT_LABELS) as SortMode[]).map((mode) => (
          <button
            key={mode}
            onClick={() => setSortMode(mode)}
            className={`text-[10px] font-headline uppercase tracking-wider px-2 py-1 cursor-pointer transition-colors ${
              sortMode === mode
                ? 'bg-primary/10 text-primary border border-primary/20'
                : 'text-on-surface-variant hover:text-white'
            }`}
          >
            {SORT_LABELS[mode]}
          </button>
        ))}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm font-body">
          <thead>
            <tr className="border-b border-outline-variant/10">
              <th className="text-left py-2 text-on-surface-variant font-normal text-xs uppercase tracking-wider">Source</th>
              <th className="text-right py-2 text-on-surface-variant font-normal text-xs uppercase tracking-wider">Output</th>
              <th className="text-right py-2 text-on-surface-variant font-normal text-xs uppercase tracking-wider">vs Highest</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((quote) => {
              const isHighest = quote.output === maxOutput;
              const diffFromHighest = maxOutput > 0n
                ? ((Number(maxOutput - quote.output)) / Number(maxOutput) * 100).toFixed(2)
                : '0.00';

              return (
                <tr
                  key={quote.name}
                  className={`border-b border-outline-variant/5 ${
                    quote.isAggregator ? 'bg-primary/5' : ''
                  }`}
                >
                  <td className="py-2 flex items-center gap-2">
                    <span className={isHighest ? 'text-primary font-bold' : 'text-white'}>
                      {quote.name}
                    </span>
                    {quote.isAggregator && (
                      <span className="text-[9px] bg-primary/10 text-primary px-1.5 py-0.5 font-headline uppercase tracking-wider">
                        Aggregated
                      </span>
                    )}
                  </td>
                  <td className={`text-right py-2 ${isHighest ? 'text-primary font-bold' : 'text-white'}`}>
                    {formatTokenAmount(quote.output, outDecimals)} {outSymbol}
                  </td>
                  <td className={`text-right py-2 ${parseFloat(diffFromHighest) === 0 ? 'text-tertiary' : 'text-red-400'}`}>
                    {parseFloat(diffFromHighest) === 0 ? 'Highest' : `-${diffFromHighest}%`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
