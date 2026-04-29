/**
 * tokenCache — localStorage-persisted cache for token balance data.
 *
 * Survives page reloads and component unmounts/remounts.
 * Cache is tied to wallet address and has a 5-minute TTL.
 */

import type { TokenWithBalance } from '../hooks/usePrioritizedTokenLoader';

export interface CacheEntry {
  balanceMap: Map<string, TokenWithBalance>;
  timestamp: number;
  walletAddress: string;
}

const CACHE_KEY = 'omnom_token_cache';
const CACHE_VERSION = '2.0';
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// Serialized form where BigInt balance is stored as string
interface SerializedTokenWithBalance {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  balance?: string;
  formattedBalance?: string;
  metadata?: {
    logoUrl?: string;
    isNative?: boolean;
  };
}

interface SerializedCacheEntry {
  balanceMap: Array<[string, SerializedTokenWithBalance]>;
  timestamp: number;
  walletAddress: string;
  version: string;
}

function serializeTwb(twb: TokenWithBalance): SerializedTokenWithBalance {
  return {
    ...twb,
    balance: twb.balance !== undefined ? twb.balance.toString() : undefined,
  };
}

function deserializeTwb(s: SerializedTokenWithBalance): TokenWithBalance {
  return {
    ...s,
    balance: s.balance !== undefined ? BigInt(s.balance) : undefined,
  };
}

export function getGlobalCache(): CacheEntry | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as SerializedCacheEntry;

    if (!parsed.version || !parsed.walletAddress || !Array.isArray(parsed.balanceMap)) {
      return null;
    }

    if (parsed.version !== CACHE_VERSION) {
      return null;
    }

    const balanceMap = new Map<string, TokenWithBalance>();
    for (const [key, value] of parsed.balanceMap) {
      balanceMap.set(key, deserializeTwb(value));
    }

    return {
      balanceMap,
      timestamp: parsed.timestamp,
      walletAddress: parsed.walletAddress,
    };
  } catch {
    return null;
  }
}

export function setGlobalCache(entry: CacheEntry): void {
  try {
    const serialized: SerializedCacheEntry = {
      balanceMap: Array.from(entry.balanceMap.entries()).map(
        ([key, value]) => [key, serializeTwb(value)]
      ),
      timestamp: entry.timestamp,
      walletAddress: entry.walletAddress,
      version: CACHE_VERSION,
    };
    localStorage.setItem(CACHE_KEY, JSON.stringify(serialized));
  } catch (error) {
    console.warn('[tokenCache] Failed to save cache:', error);
  }
}

export function clearGlobalCache(): void {
  localStorage.removeItem(CACHE_KEY);
}

export function isGlobalCacheFresh(walletAddress: string): boolean {
  const cached = getGlobalCache();
  if (!cached) return false;

  // Check wallet address matches (case-insensitive)
  if (cached.walletAddress.toLowerCase() !== walletAddress.toLowerCase()) {
    return false;
  }

  const cacheAge = Date.now() - cached.timestamp;
  return cacheAge < CACHE_TTL_MS;
}

export function createCacheEntry(
  balanceMap: Map<string, TokenWithBalance>,
  walletAddress: string,
): CacheEntry {
  return {
    balanceMap: new Map(balanceMap),
    timestamp: Date.now(),
    walletAddress,
  };
}
