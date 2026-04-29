/**
 * useHardcodedTokenLoader — instant token availability for top tokens.
 *
 * Provides the most important tokens immediately without any RPC calls.
 * These tokens appear instantly in the selector with no loading skeleton.
 *
 * Tokens included:
 *   - WWDOGE (native wrapped token)
 *   - OMNOM (protocol token)
 *   - DC (Dogechain Token)
 *   - DINU (Doge Inu)
 *   - DST (Dogechain Swap Token)
 */

import { useMemo } from 'react';
import { CONTRACTS } from '../lib/constants';

export interface HardcodedToken {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  logoUrl?: string;
  isNative?: boolean;
}

// Top 5 critical tokens that should always be available instantly
const HARDCODED_TOKENS: HardcodedToken[] = [
  {
    address: CONTRACTS.WWDOGE,
    symbol: 'WWDOGE',
    name: 'Wrapped WDOGE',
    decimals: 18,
    logoUrl: '/tokens/wwdoge.webp',
    isNative: true,
  },
  {
    address: CONTRACTS.OMNOM_TOKEN,
    symbol: 'OMNOM',
    name: 'Doge Eat Doge',
    decimals: 18,
    logoUrl: '/tokens/omnom.png',
  },
  {
    address: CONTRACTS.DC_TOKEN,
    symbol: 'DC',
    name: 'Dogechain Token',
    decimals: 18,
    logoUrl: '/tokens/dc.webp',
  },
  {
    address: CONTRACTS.DINU_TOKEN,
    symbol: 'DINU',
    name: 'Doge Inu',
    decimals: 18,
    logoUrl: '/tokens/dinu.webp',
  },
  {
    address: CONTRACTS.DST_V2_TOKEN,
    symbol: 'DST',
    name: 'Dogechain Swap Token',
    decimals: 18,
    logoUrl: undefined, // No logo available
  },
];

/**
 * Hook that provides hardcoded tokens instantly.
 * No RPC calls, no loading state, no dependencies.
 */
export function useHardcodedTokenLoader() {
  const tokens = useMemo(() => HARDCODED_TOKENS, []);

  /**
   * Get all hardcoded token pairs for routing.
   * Returns pairs in format: [[token0, token1], ...]
   */
  const getPairs = useMemo(() => {
    const pairs: [string, string][] = [];
    for (let i = 0; i < tokens.length; i++) {
      for (let j = i + 1; j < tokens.length; j++) {
        pairs.push([tokens[i].address, tokens[j].address]);
      }
    }
    return pairs;
  }, [tokens]);

  return {
    tokens,
    getPairs,
  };
}
