/**
 * UnifiedSwapScreen — single swap page with Direct/Aggregated toggle.
 *
 * Renders either SwapScreen (single-DEX) or AggregatorSwap (multi-DEX)
 * behind a pill-style segment control. Both modes share the same visual
 * container.
 *
 * H-06: Aggregator components are wrapped in ErrorBoundary to prevent
 * a render error from crashing the entire app.
 */

import { useState } from 'react';
import { SwapScreen } from './SwapScreen';
import { AggregatorSwap } from './aggregator/AggregatorSwap';
import { TreasuryDashboard } from './aggregator/TreasuryDashboard';
import { ErrorBoundary } from '../ErrorBoundary';
import type { TabType } from '../App';

type SwapMode = 'direct' | 'aggregated';

interface UnifiedSwapScreenProps {
  onTabChange: (tab: TabType) => void;
}

export function UnifiedSwapScreen({ onTabChange }: UnifiedSwapScreenProps) {
  const [mode, setMode] = useState<SwapMode>('aggregated');

  return (
    <div className="flex flex-col items-center w-full">
      {/* ── Pill Toggle ── */}
      <div className="flex items-center bg-surface-container-low border border-outline-variant/15 mb-6 p-1 w-full max-w-lg">
        <button
          onClick={() => setMode('aggregated')}
          className={`flex-1 py-2.5 font-headline font-bold text-xs uppercase tracking-widest transition-all cursor-pointer min-h-[44px] ${
            mode === 'aggregated'
              ? 'bg-primary text-black'
              : 'text-on-surface-variant hover:text-white'
          }`}
        >
          Aggregated Swap
        </button>
        <button
          onClick={() => setMode('direct')}
          className={`flex-1 py-2.5 font-headline font-bold text-xs uppercase tracking-widest transition-all cursor-pointer min-h-[44px] ${
            mode === 'direct'
              ? 'bg-primary text-black'
              : 'text-on-surface-variant hover:text-white'
          }`}
        >
          Direct Swap
        </button>
      </div>

      {/* ── Swap Content ── */}
      {mode === 'direct' ? (
        <SwapScreen />
      ) : (
        <div className="w-full space-y-6">
          {/* H-06: Error boundary around aggregator components */}
          <ErrorBoundary fallback={
            <div className="max-w-lg mx-auto p-6 bg-primary/5 border border-primary/20 text-center">
              <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-3" />
              <p className="text-primary font-headline text-sm uppercase tracking-wider">Loading Aggregator...</p>
              <p className="text-on-surface-variant text-xs mt-1 font-body">Fetching data from DEXes. This will auto-retry.</p>
              <button onClick={() => window.location.reload()} className="mt-3 px-4 py-2 bg-primary/10 border border-primary/20 text-primary text-xs font-headline uppercase hover:bg-primary/20 transition-colors cursor-pointer">Retry Now</button>
            </div>
          }>
            <AggregatorSwap />
          </ErrorBoundary>

          {/* Treasury & Swap History — full width, stacked */}
          <div className="max-w-lg mx-auto flex flex-col gap-4">
            <ErrorBoundary fallback={
              <div className="p-4 bg-primary/5 border border-primary/20 text-center">
                <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-2" />
                <p className="text-on-surface-variant font-headline text-xs uppercase tracking-wider">Loading treasury data...</p>
              </div>
            }>
              <TreasuryDashboard />
            </ErrorBoundary>
          </div>

          {/* Disclosures reference tile */}
          <div className="max-w-lg mx-auto">
            <button
              onClick={() => onTabChange('DISCLOSURES')}
              className="w-full flex items-center gap-4 p-4 bg-surface-container-low border border-outline-variant/15 hover:border-primary/30 hover:bg-surface-container-high transition-all cursor-pointer group text-left"
            >
              <span className="text-2xl shrink-0">📋</span>
              <div className="flex-1 min-w-0">
                <div className="font-headline font-bold text-sm uppercase tracking-wider text-on-surface group-hover:text-primary transition-colors">
                  Protocol Disclosures
                </div>
                <div className="text-on-surface-variant text-xs mt-0.5">
                  View our complete disclosures, legal notices, and compliance information
                </div>
              </div>
              <span className="text-on-surface-variant group-hover:text-primary transition-colors text-lg shrink-0">→</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
