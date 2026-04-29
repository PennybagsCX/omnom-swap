/**
 * useLiquidityFilter — provides the full token list for the selector.
 *
 * Returns all tokens immediately for search/browsing.
 * GeckoTerminal fetch runs in background for enrichment only.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { TOKENS } from '../lib/constants';

export function useLiquidityFilter() {
  const [liquidAddresses, setLiquidAddresses] = useState<Set<string>>(new Set());

  // All tokens are always available immediately
  const filteredTokens = useMemo(() => TOKENS, []);

  // Background fetch of GeckoTerminal liquid tokens (for enrichment/badges)
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const { getLiquidTokenSet } = await import('../services/liquidityFilter');
        const liquidSet = await getLiquidTokenSet();
        if (!cancelled) setLiquidAddresses(liquidSet);
      } catch {
        // Background fetch failed — non-critical
      }
    })();

    return () => { cancelled = true; };
  }, []);

  const refresh = useCallback(() => {
    // Re-fetch GeckoTerminal data in background
    (async () => {
      try {
        const { invalidateLiquidityCache, getLiquidTokenSet } = await import('../services/liquidityFilter');
        invalidateLiquidityCache();
        const liquidSet = await getLiquidTokenSet();
        setLiquidAddresses(liquidSet);
      } catch {
        // Non-critical
      }
    })();
  }, []);

  return {
    filteredTokens,
    isFilterReady: true,
    liquidCount: filteredTokens.length,
    liquidAddresses,
    totalCount: TOKENS.length,
    refresh,
  };
}
