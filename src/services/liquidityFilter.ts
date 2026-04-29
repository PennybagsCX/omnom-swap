/**
 * liquidityFilter — fetches and caches the set of token addresses
 * that appear in active pools on Dogechain.
 *
 * Uses GeckoTerminal's pool index to discover which tokens have liquidity.
 * Results are cached in localStorage with a 24h TTL.
 *
 * Sorts by reserve USD (TVL) to include ALL tokens with liquidity,
 * not just those with recent trading activity.
 */

import { CONTRACTS } from '../lib/constants';

const GECKO_BASE = import.meta.env.PROD
  ? 'https://api.geckoterminal.com/api/v2'
  : '/api/gecko';

const CACHE_KEY = 'omnom_liquid_tokens';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const MAX_PAGES = 25;
const PAGE_SIZE = 50;
const REQUEST_DELAY_MS = 2000;
const RETRY_DELAY_MS = 5000;
const MAX_RETRIES = 1;

const HUB_AND_POPULAR = new Set([
  CONTRACTS.WWDOGE.toLowerCase(),
  CONTRACTS.DC_TOKEN.toLowerCase(),
  CONTRACTS.OMNOM_TOKEN.toLowerCase(),
  CONTRACTS.DINU_TOKEN.toLowerCase(),
  CONTRACTS.DST_V2_TOKEN.toLowerCase(),
]);

interface CacheEntry {
  timestamp: number;
  addresses: string[];
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractTokenAddress(id: string): string {
  const idx = id.indexOf('0x');
  if (idx === -1) return id.toLowerCase();
  return id.slice(idx).toLowerCase();
}

async function fetchWithRetry(url: string, retries = MAX_RETRIES): Promise<Response> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(url);
    if (res.status === 429 && attempt < retries) {
      await delay(RETRY_DELAY_MS);
      continue;
    }
    return res;
  }
  throw new Error('Max retries exceeded');
}

/**
 * Fetch liquid token addresses from GeckoTerminal pool index.
 * Sorts by reserve USD to include all tokens with TVL, not just active traders.
 */
export async function fetchLiquidTokenAddresses(): Promise<Set<string>> {
  const addresses = new Set<string>(HUB_AND_POPULAR);

  for (let page = 1; page <= MAX_PAGES; page++) {
    try {
      const url = `${GECKO_BASE}/networks/dogechain/pools?page=${page}&limit=${PAGE_SIZE}&order=reserve_usd_desc`;

      const res = await fetchWithRetry(url);
      if (!res.ok) break;

      const json = await res.json();
      const pools = json?.data;

      if (!Array.isArray(pools) || pools.length === 0) break;

      for (const pool of pools) {
        const baseToken = pool?.relationships?.base_token?.data?.id;
        const quoteToken = pool?.relationships?.quote_token?.data?.id;

        if (baseToken) addresses.add(extractTokenAddress(baseToken));
        if (quoteToken) addresses.add(extractTokenAddress(quoteToken));
      }

      if (pools.length < PAGE_SIZE) break;

      if (page < MAX_PAGES) {
        await delay(REQUEST_DELAY_MS);
      }
    } catch {
      break;
    }
  }

  return addresses;
}

/**
 * Get the liquid token set, using localStorage cache when available.
 * Falls back to hub + popular tokens on API failure.
 */
export async function getLiquidTokenSet(): Promise<Set<string>> {
  // Check cache first
  try {
    const cached = localStorage.getItem(CACHE_KEY);
    if (cached) {
      const entry: CacheEntry = JSON.parse(cached);
      if (Date.now() - entry.timestamp < CACHE_TTL_MS && entry.addresses.length > 0) {
        return new Set([...HUB_AND_POPULAR, ...entry.addresses.map((a) => a.toLowerCase())]);
      }
    }
  } catch {
    // Corrupt cache, proceed to fetch
  }

  // Fetch from GeckoTerminal
  try {
    const addresses = await fetchLiquidTokenAddresses();

    // Cache the result (exclude hub/popular to save space)
    const toCache = [...addresses].filter((a) => !HUB_AND_POPULAR.has(a));
    const entry: CacheEntry = { timestamp: Date.now(), addresses: toCache };
    localStorage.setItem(CACHE_KEY, JSON.stringify(entry));

    return addresses;
  } catch {
    // API failed — return hardcoded fallback
    return new Set(HUB_AND_POPULAR);
  }
}

/** Clear the localStorage cache, forcing a refresh on next call. */
export function invalidateLiquidityCache(): void {
  try {
    localStorage.removeItem(CACHE_KEY);
  } catch {
    // Ignore storage errors
  }
}
