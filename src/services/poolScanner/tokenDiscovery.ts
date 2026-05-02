/**
 * Token Discovery — Builds a registry of tokens that pair with OMNOM.
 *
 * DexScreener returns token metadata (symbol, name) for all active OMNOM pairs.
 * The event log scanner discovers additional tokens DexScreener doesn't know about.
 * This service merges both sources into a unified token registry so the UI can
 * display proper token symbols instead of "Unknown".
 *
 * Cache: 1 hour (token metadata rarely changes)
 */

import { CONTRACTS } from '../../lib/constants';

const DEXSCREENER_URL = 'https://api.dexscreener.com/latest/dex/tokens';

export interface TokenInfo {
  address: string;
  symbol: string;
  name: string;
  decimals?: number;
}

type CachedRegistry = {
  tokens: Map<string, TokenInfo>;
  timestamp: number;
};

let cachedRegistry: CachedRegistry | null = null;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

const STORAGE_KEY = 'omnom_token_registry_v1';

// Serialize Map → JSON
function serializeRegistry(tokens: Map<string, TokenInfo>): string {
  return JSON.stringify([...tokens.entries()]);
}

// Deserialize JSON → Map
function deserializeRegistry(raw: string): Map<string, TokenInfo> {
  return new Map(JSON.parse(raw) as [string, TokenInfo][]);
}

function loadFromStorage(): CachedRegistry | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const { tokens, timestamp } = JSON.parse(raw) as { tokens: string; timestamp: number };
    return { tokens: deserializeRegistry(tokens), timestamp };
  } catch {
    return null;
  }
}

function saveToStorage(cached: CachedRegistry): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      tokens: serializeRegistry(cached.tokens),
      timestamp: cached.timestamp,
    }));
  } catch {
    // localStorage full — skip
  }
}

// Initialize from localStorage (seed tokens used as fallback)
cachedRegistry = loadFromStorage();

// Seed tokens — always available even if API is down
const SEED_TOKENS: TokenInfo[] = [
  { address: CONTRACTS.OMNOM_TOKEN, symbol: 'OMNOM', name: 'OmnomSwap' },
  { address: CONTRACTS.WWDOGE, symbol: 'WWDOGE', name: 'Wrapped Dogecoin' },
  { address: '0x66CFd94e31C78fA2Af09CBaD615e0708487fCBf', symbol: 'USDT', name: 'Tether USD' },
  { address: '0xc21223249CC284701F197eC09Bf8d3293ED5c8ec', symbol: 'USDC', name: 'USD Coin' },
  { address: '0x0CdcFe2b9F49f8C26e09448e628408a6A6788228', symbol: 'DAI', name: 'Dai Stablecoin' },
  { address: '0x4FcCd7E581ab84255F301efE36Db397A5a4E293b', symbol: 'MCRIB', name: 'McRib' },
  { address: '0x90d768f0a6ebb8ffcabe89b0313b34265bc3f54a', symbol: 'DC', name: 'Dogechain' },
  { address: '0x9D3454387855c768499943c020c5705b2544151c', symbol: 'USDO', name: 'USDO' },
  { address: '0x3593acb873e91c781d4e27c4a9a36de15b033896', symbol: 'oneD', name: 'oneD' },
];

/**
 * Discover all tokens that have paired with OMNOM from DexScreener.
 * Returns a map keyed by lowercase address.
 */
export async function discoverOmnomTokens(): Promise<Map<string, TokenInfo>> {
  const now = Date.now();

  if (cachedRegistry && now - cachedRegistry.timestamp < CACHE_TTL_MS) {
    console.log('[TokenDiscovery] Returning cached registry');
    return cachedRegistry.tokens;
  }

  console.log('[TokenDiscovery] Fetching token registry from DexScreener...');

  // Start with seed tokens
  const tokenMap = new Map<string, TokenInfo>();
  for (const t of SEED_TOKENS) {
    tokenMap.set(t.address.toLowerCase(), t);
  }

  // Fetch from DexScreener to discover additional tokens
  try {
    const res = await fetch(`${DEXSCREENER_URL}/${CONTRACTS.OMNOM_TOKEN}`);
    if (!res.ok) throw new Error(`DexScreener ${res.status}`);

    const data = await res.json();
    const pairs = data.pairs || [];

    for (const pair of pairs) {
      // Extract base and quote tokens
      if (pair.baseToken) {
        const addr = pair.baseToken.address?.toLowerCase();
        if (addr && !tokenMap.has(addr)) {
          tokenMap.set(addr, {
            address: addr,
            symbol: pair.baseToken.symbol || 'Unknown',
            name: pair.baseToken.name || 'Unknown',
          });
        }
      }
      if (pair.quoteToken) {
        const addr = pair.quoteToken.address?.toLowerCase();
        if (addr && !tokenMap.has(addr)) {
          tokenMap.set(addr, {
            address: addr,
            symbol: pair.quoteToken.symbol || 'Unknown',
            name: pair.quoteToken.name || 'Unknown',
          });
        }
      }
    }

    console.log(`[TokenDiscovery] Discovered ${tokenMap.size} tokens from ${pairs.length} DexScreener pairs`);
  } catch (e) {
    console.warn('[TokenDiscovery] DexScreener fetch failed, using seed tokens:', e);
  }

  cachedRegistry = { tokens: tokenMap, timestamp: now };
  saveToStorage(cachedRegistry);
  return tokenMap;
}

/**
 * Look up a token symbol by address.
 * Returns the symbol or a truncated address if unknown.
 */
export function getTokenSymbol(
  tokenMap: Map<string, TokenInfo>,
  address: string,
): string {
  const info = tokenMap.get(address.toLowerCase());
  return info?.symbol || `${address.slice(0, 6)}...${address.slice(-4)}`;
}

/**
 * Look up token info by address.
 */
export function getTokenInfo(
  tokenMap: Map<string, TokenInfo>,
  address: string,
): TokenInfo | undefined {
  return tokenMap.get(address.toLowerCase());
}

/**
 * Clear the token discovery cache.
 */
export function clearTokenDiscoveryCache(): void {
  cachedRegistry = null;
  try { localStorage.removeItem(STORAGE_KEY); } catch {}
  console.log('[TokenDiscovery] Cache cleared');
}
