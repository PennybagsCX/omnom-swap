/**
 * tokenCompatibility — determines token tradeability via hub connectivity.
 *
 * Instead of checking every token pair (N^2 RPC calls), checks whether the
 * selected token can reach any hub token (WWDOGE, DC, OMNOM). If yes, virtually
 * all tokens are tradeable via multi-hop routing through that hub.
 *
 * This reduces RPC calls from ~1,000,000 to ~21 per modal open.
 */

import { createPublicClient, http } from 'viem';
import { dogechain } from 'wagmi/chains';
import type { TokenType } from './constants';
import { fetchPoolsForPair, HUB_TOKENS } from '../services/pathFinder/poolFetcher';

const publicClient = createPublicClient({ chain: dogechain, transport: http() });

/** Cache: selected token address → has hub connectivity */
const hubCache = new Map<string, boolean>();

/**
 * Check if a token can reach any hub token via a direct pool on any DEX.
 * ~21 RPC calls max (3 hubs × 7 DEXes). Returns early on first hit.
 */
async function hasHubConnectivity(tokenAddress: string): Promise<boolean> {
  const normalized = tokenAddress.toLowerCase();
  const hubAddrs = HUB_TOKENS.map(h => h.address.toLowerCase());

  // Hub tokens always have connectivity
  if (hubAddrs.includes(normalized)) return true;

  // Check cache
  if (hubCache.has(normalized)) return hubCache.get(normalized)!;

  for (const hub of HUB_TOKENS) {
    const hubAddr = hub.address.toLowerCase();
    const pools = await fetchPoolsForPair(tokenAddress, hub.address, publicClient);
    const connected = pools.some(p => {
      const p0 = p.token0.toLowerCase();
      const p1 = p.token1.toLowerCase();
      return (p0 === normalized && p1 === hubAddr) || (p1 === normalized && p0 === hubAddr);
    });
    if (connected) {
      hubCache.set(normalized, true);
      return true;
    }
  }

  hubCache.set(normalized, false);
  return false;
}

/**
 * Check if the selected token is tradeable (has hub connectivity).
 *
 * Returns true if the selected token can reach WWDOGE, DC, or OMNOM via
 * direct pools on any DEX. In practice this is true for 99%+ of tokens
 * since WWDOGE is the primary trading pair on Dogechain.
 *
 * UI should show all tokens when true, and let the route computation
 * handle the rare "no route available" case.
 */
export async function isTokenTradeable(token: TokenType): Promise<boolean> {
  try {
    return await hasHubConnectivity(token.address);
  } catch {
    return true; // Assume tradeable on error to avoid hiding tokens
  }
}

/** Clear the hub connectivity cache (on wallet switch, etc.) */
export function clearCompatibilityCache(): void {
  hubCache.clear();
}
