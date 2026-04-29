/**
 * useTokenTax — detects buy/sell tax for ERC-20 tokens on Dogechain.
 *
 * Detection strategy:
 *   1. Try common tax function selectors (buyTax, sellTax, totalFee, etc.)
 *   2. Fallback: simulate a minimal swap through the largest pool and
 *      compare expected output vs actual — the shortfall is the tax
 *   3. Cache results in sessionStorage keyed by token address
 */

import { useState, useEffect, useCallback } from 'react';
import {
  createPublicClient,
  http,
  parseAbi,
  type Address,
  getAddress,
} from 'viem';
import { dogechain } from 'wagmi/chains';
import { CONTRACTS } from '../lib/constants';
import { fetchPoolsForPair } from '../services/pathFinder/poolFetcher';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TokenTaxInfo {
  buyTax: number;        // percentage (e.g., 5 = 5%)
  sellTax: number;
  isTaxed: boolean;
  isHoneypot: boolean;   // true if sell simulation fails entirely (warning only, not blocking)
  warningLevel: 'none' | 'low' | 'medium' | 'high' | 'danger';
  warningMessage: string;
  source: 'function' | 'simulation' | 'fallback' | 'error';
}

const DEFAULT_TAX: TokenTaxInfo = {
  buyTax: 0,
  sellTax: 0,
  isTaxed: false,
  isHoneypot: false,
  warningLevel: 'none',
  warningMessage: '',
  source: 'fallback',
};

// ─── Whitelist ────────────────────────────────────────────────────────────────

// Platform tokens that are known to have no tax — skip detection entirely.
const PLATFORM_TOKENS = new Set([
  CONTRACTS.WWDOGE.toLowerCase(),
  CONTRACTS.DC_TOKEN.toLowerCase(),
  CONTRACTS.OMNOM_TOKEN.toLowerCase(),
  CONTRACTS.DINU_TOKEN.toLowerCase(),
]);

// ─── Cache ────────────────────────────────────────────────────────────────────

const CACHE_KEY = 'omnom_token_tax_v2';
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes

interface CacheEntry {
  info: TokenTaxInfo;
  timestamp: number;
}

function loadCache(): Map<string, CacheEntry> {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    if (!raw) return new Map();
    const parsed = JSON.parse(raw) as [string, CacheEntry][];
    const now = Date.now();
    return new Map(parsed.filter(([, v]) => now - v.timestamp < CACHE_TTL));
  } catch {
    return new Map();
  }
}

function saveCache(cache: Map<string, CacheEntry>) {
  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify([...cache.entries()]));
  } catch { /* sessionStorage full — ignore */ }
}

// ─── Client ───────────────────────────────────────────────────────────────────

const client = createPublicClient({ chain: dogechain, transport: http() });

// ─── Common tax function selectors ────────────────────────────────────────────
// Many tax tokens expose these functions. Try them first for speed.

const TAX_ABI = parseAbi([
  'function buyTotalFees() external view returns (uint256)',
  'function sellTotalFees() external view returns (uint256)',
  'function _buyTax() external view returns (uint256)',
  'function _sellTax() external view returns (uint256)',
  'function totalBuyFee() external view returns (uint256)',
  'function totalSellFee() external view returns (uint256)',
  'function buyFee() external view returns (uint256)',
  'function sellFee() external view returns (uint256)',
  'function buyTax() external view returns (uint256)',
  'function sellTax() external view returns (uint256)',
  'function totalFee() external view returns (uint256)',
  'function taxFee() external view returns (uint256)',
  'function _taxFee() external view returns (uint256)',
  'function liquidityFee() external view returns (uint256)',
  'function _liquidityFee() external view returns (uint256)',
]);

const ROUTER_ABI = parseAbi([
  'function getAmountsOut(uint amountIn, address[] calldata path) external view returns (uint[] memory amounts)',
]);

const ERC20_ABI = parseAbi([
  'function balanceOf(address) external view returns (uint256)',
  'function decimals() external view returns (uint8)',
]);

// ─── Detection functions ──────────────────────────────────────────────────────

async function tryTaxFunctions(tokenAddress: Address): Promise<{ buyTax: number; sellTax: number } | null> {
  const addr = getAddress(tokenAddress);

  const tryCall = async (fn: (typeof TAX_ABI)[number]['name']): Promise<number | null> => {
    try {
      const result = await client.readContract({
        address: addr,
        abi: TAX_ABI,
        functionName: fn,
      });
      const val = Number(result);
      // Tax values are typically in basis points (100 = 1%) or percentage (1 = 1%)
      // Heuristic: if > 100, assume basis points
      return val > 100 ? val / 100 : val;
    } catch {
      return null;
    }
  };

  // Try buy tax functions in order of commonness
  type TaxFn = (typeof TAX_ABI)[number]['name'];
  const buyFunctions: TaxFn[] = ['buyTotalFees', '_buyTax', 'totalBuyFee', 'buyFee', 'buyTax'];
  const sellFunctions: TaxFn[] = ['sellTotalFees', '_sellTax', 'totalSellFee', 'sellFee', 'sellTax'];
  const sharedFunctions: TaxFn[] = ['totalFee', 'taxFee', '_taxFee'];

  let buyTax: number | null = null;
  let sellTax: number | null = null;

  for (const fn of buyFunctions) {
    const val = await tryCall(fn);
    if (val !== null && val >= 0) { buyTax = val; break; }
  }

  for (const fn of sellFunctions) {
    const val = await tryCall(fn);
    if (val !== null && val >= 0) { sellTax = val; break; }
  }

  // If no separate buy/sell found, try shared fee functions
  if (buyTax === null && sellTax === null) {
    for (const fn of sharedFunctions) {
      const val = await tryCall(fn);
      if (val !== null && val > 0) {
        buyTax = val;
        sellTax = val;
        break;
      }
    }
  }

  if (buyTax !== null || sellTax !== null) {
    return { buyTax: buyTax ?? 0, sellTax: sellTax ?? 0 };
  }

  return null;
}

async function simulateTaxViaSwap(tokenAddress: Address): Promise<{
  buyTax: number;
  sellTax: number;
  isHoneypot: boolean;
} | null> {
  const addr = tokenAddress.toLowerCase();
  const wwdoge = CONTRACTS.WWDOGE.toLowerCase();

  if (addr === wwdoge) return { buyTax: 0, sellTax: 0, isHoneypot: false };

  // Find the best pool for token/WWDOGE
  const pools = await fetchPoolsForPair(addr, wwdoge, client);
  if (pools.length === 0) return null;

  const pool = pools[0]; // Use first available pool
  const routerAddr = getAddress(pool.router);

  // Get token decimals
  let decimals = 18;
  try {
    decimals = await client.readContract({
      address: getAddress(addr),
      abi: ERC20_ABI,
      functionName: 'decimals',
    });
  } catch { /* use default */ }

  // Test amount: 1 token
  const testAmount = 10n ** BigInt(decimals);

  // Determine if token is token0 or token1 in the pair
  const isToken0 = pool.token0 === addr;
  const reserveToken = isToken0 ? pool.reserve0 : pool.reserve1;
  const reserveWwdoge = isToken0 ? pool.reserve1 : pool.reserve0;

  if (reserveToken === 0n || reserveWwdoge === 0n) return null;

  // Expected output from reserves (constant product)
  // expectedOut = (testAmount * reserveWwdoge) / (reserveToken + testAmount)
  const expectedOut = (testAmount * reserveWwdoge) / (reserveToken + testAmount);

  if (expectedOut === 0n) return null;

  // Try getAmountsOut on the router to see what the DEX actually quotes
  let routerQuotedOut = 0n;
  let sellWorks = false;

  try {
    const path = isToken0
      ? [getAddress(addr), getAddress(wwdoge)]
      : [getAddress(wwdoge), getAddress(addr)];

    // Sell simulation: token → WWDOGE
    const amounts = await client.readContract({
      address: routerAddr,
      abi: ROUTER_ABI,
      functionName: 'getAmountsOut',
      args: [testAmount, path],
    }) as bigint[];

    if (amounts.length >= 2 && amounts[amounts.length - 1] > 0n) {
      routerQuotedOut = amounts[amounts.length - 1];
      sellWorks = true;
    }
  } catch {
    // Router call failed — could be restricted
    sellWorks = false;
  }

  if (!sellWorks) {
    // Check if it's truly restricted by trying a different DEX
    for (let i = 1; i < pools.length; i++) {
      try {
        const altRouter = getAddress(pools[i].router);
        const altPath = [getAddress(addr), getAddress(wwdoge)];
        const amounts = await client.readContract({
          address: altRouter,
          abi: ROUTER_ABI,
          functionName: 'getAmountsOut',
          args: [testAmount, altPath],
        }) as bigint[];
        if (amounts.length >= 2 && amounts[amounts.length - 1] > 0n) {
          routerQuotedOut = amounts[amounts.length - 1];
          sellWorks = true;
          break;
        }
      } catch {
        continue;
      }
    }

    if (!sellWorks) {
      return { buyTax: 0, sellTax: 0, isHoneypot: true };
    }
  }

  // Compute sell tax: difference between expected and quoted
  // If router quotes less than expected from reserves, the difference is the tax
  let sellTax = 0;
  if (routerQuotedOut > 0n && expectedOut > 0n) {
    if (routerQuotedOut < expectedOut) {
      const diff = expectedOut - routerQuotedOut;
      sellTax = Math.round(Number((diff * 10000n) / expectedOut)) / 100;
    }
  }

  // For buy tax, try reverse direction (WWDOGE → token)
  let buyTax = 0;
  try {
    const buyPath = [getAddress(wwdoge), getAddress(addr)];
    const buyAmount = 10n ** 18n; // 1 WWDOGE
    const buyAmounts = await client.readContract({
      address: routerAddr,
      abi: ROUTER_ABI,
      functionName: 'getAmountsOut',
      args: [buyAmount, buyPath],
    }) as bigint[];

    if (buyAmounts.length >= 2) {
      const quotedOut = buyAmounts[buyAmounts.length - 1];
      // Expected from reserves
      const reserveWwdogeBuy = isToken0 ? pool.reserve1 : pool.reserve0;
      const reserveTokenBuy = isToken0 ? pool.reserve0 : pool.reserve1;
      const expectedBuyOut = (buyAmount * reserveTokenBuy) / (reserveWwdogeBuy + buyAmount);

      if (quotedOut < expectedBuyOut && expectedBuyOut > 0n) {
        const diff = expectedBuyOut - quotedOut;
        buyTax = Math.round(Number((diff * 10000n) / expectedBuyOut)) / 100;
      }
    }
  } catch {
    // Buy simulation failed — assume same as sell tax
    buyTax = sellTax;
  }

  return {
    buyTax: Math.max(0, buyTax),
    sellTax: Math.max(0, sellTax),
    isHoneypot: false,
  };
}

// ─── Warning helpers ──────────────────────────────────────────────────────────

function computeWarningLevel(buyTax: number, sellTax: number, isHoneypot: boolean): {
  level: TokenTaxInfo['warningLevel'];
  message: string;
} {
  if (isHoneypot) {
    return {
      level: 'high',
      message: 'This token may not be sellable on DEXes — sell simulation failed on all DEXes. Proceed with caution.',
    };
  }

  const maxTax = Math.max(buyTax, sellTax);

  if (maxTax === 0) return { level: 'none', message: '' };

  if (maxTax > 25) {
    return {
      level: 'danger',
      message: `Extreme tax: ${buyTax}% buy / ${sellTax}% sell. This token will take over a quarter of your trade value.`,
    };
  }
  if (maxTax > 10) {
    return {
      level: 'high',
      message: `High tax token: ${buyTax}% buy / ${sellTax}% sell. You will receive significantly less than quoted.`,
    };
  }
  if (maxTax > 3) {
    return {
      level: 'medium',
      message: `This token has a ${buyTax}% buy / ${sellTax}% sell tax. High taxes reduce your output.`,
    };
  }

  return {
    level: 'low',
    message: `Low tax token: ${buyTax}% buy / ${sellTax}% sell tax included in token transfers.`,
  };
}

// ─── Main detection function ──────────────────────────────────────────────────

async function detectTokenTax(tokenAddress: string): Promise<TokenTaxInfo> {
  const addr = getAddress(tokenAddress) as Address;
  const normalizedAddr = addr.toLowerCase();

  // Skip known platform tokens — they have no tax
  if (PLATFORM_TOKENS.has(normalizedAddr)) return DEFAULT_TAX;

  // Step 1: Try common tax function selectors (fastest, 2-4 RPC calls)
  const funcResult = await tryTaxFunctions(addr);
  if (funcResult !== null) {
    const buyTax = funcResult.buyTax;
    const sellTax = funcResult.sellTax;
    const isTaxed = buyTax > 0 || sellTax > 0;
    const { level, message } = computeWarningLevel(buyTax, sellTax, false);
    return {
      buyTax,
      sellTax,
      isTaxed,
      isHoneypot: false,
      warningLevel: level,
      warningMessage: message,
      source: 'function',
    };
  }

  // Step 2: Simulate swap to measure actual tax (slower, ~5-10 RPC calls)
  const simResult = await simulateTaxViaSwap(addr);
  if (simResult !== null) {
    const buyTax = simResult.buyTax;
    const sellTax = simResult.sellTax;
    const isTaxed = buyTax > 0 || sellTax > 0;
    const { level, message } = computeWarningLevel(buyTax, sellTax, simResult.isHoneypot);
    return {
      buyTax,
      sellTax,
      isTaxed,
      isHoneypot: simResult.isHoneypot,
      warningLevel: level,
      warningMessage: message,
      source: 'simulation',
    };
  }

  // Step 3: Could not determine — assume safe
  return DEFAULT_TAX;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Detect tax and restrictions for a single token.
 * Returns cached result if available, otherwise performs detection.
 */
export function useTokenTax(tokenAddress: string | undefined) {
  const [taxInfo, setTaxInfo] = useState<TokenTaxInfo>(DEFAULT_TAX);
  const [loading, setLoading] = useState(false);

  const detect = useCallback(async () => {
    if (!tokenAddress) {
      setTaxInfo(DEFAULT_TAX);
      return;
    }

    const normalized = tokenAddress.toLowerCase();

    // Check cache first
    const cache = loadCache();
    const cached = cache.get(normalized);
    if (cached) {
      setTaxInfo(cached.info);
      return;
    }

    setLoading(true);
    try {
      const info = await detectTokenTax(tokenAddress);

      // Cache the result
      const newCache = loadCache();
      newCache.set(normalized, { info, timestamp: Date.now() });
      saveCache(newCache);

      setTaxInfo(info);
    } catch {
      setTaxInfo({ ...DEFAULT_TAX, source: 'error' });
    } finally {
      setLoading(false);
    }
  }, [tokenAddress]);

  useEffect(() => {
    detect();
  }, [detect]);

  return { taxInfo, loading, refresh: detect };
}

/**
 * Detect tax for both sell and buy tokens in a swap.
 * More efficient than two separate useTokenTax calls.
 */
export function useSwapTokenTax(
  sellTokenAddress: string | undefined,
  buyTokenAddress: string | undefined,
) {
  const [sellTax, setSellTax] = useState<TokenTaxInfo>(DEFAULT_TAX);
  const [buyTax, setBuyTax] = useState<TokenTaxInfo>(DEFAULT_TAX);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const normalizedSell = sellTokenAddress?.toLowerCase();
    const normalizedBuy = buyTokenAddress?.toLowerCase();

    // Same token — no need to check twice
    if (normalizedSell && normalizedSell === normalizedBuy) {
      return;
    }

    const cache = loadCache();

    const checkToken = async (address: string | undefined, setter: (info: TokenTaxInfo) => void) => {
      if (!address) {
        setter(DEFAULT_TAX);
        return;
      }
      const normalized = address.toLowerCase();
      const cached = cache.get(normalized);
      if (cached) {
        setter(cached.info);
        return;
      }
      const info = await detectTokenTax(address);
      const newCache = loadCache();
      newCache.set(normalized, { info, timestamp: Date.now() });
      saveCache(newCache);
      setter(info);
    };

    setLoading(true);
    Promise.all([
      checkToken(sellTokenAddress, setSellTax),
      checkToken(buyTokenAddress, setBuyTax),
    ]).finally(() => setLoading(false));
  }, [sellTokenAddress, buyTokenAddress]);

  return { sellTax, buyTax, loading };
}

/** Clear the tax detection cache */
export function clearTaxCache(): void {
  sessionStorage.removeItem(CACHE_KEY);
}

/**
 * Synchronous cache reader for use in token lists.
 * Returns cached tax info if available, otherwise returns default (no tax).
 */
export function getCachedTaxInfo(tokenAddress: string): TokenTaxInfo {
  try {
    const cache = loadCache();
    const cached = cache.get(tokenAddress.toLowerCase());
    if (cached) return cached.info;
  } catch { /* ignore */ }
  return DEFAULT_TAX;
}
