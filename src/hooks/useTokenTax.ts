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
import { getAddress } from 'viem';
import { CONTRACTS } from '../lib/constants';
import { detectTokenTax as dynamicDetectTax, getCachedTax } from '../services/taxDetection';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TokenTaxInfo {
  buyTax: number;        // percentage (e.g., 5 = 5%)
  sellTax: number;
  isTaxed: boolean;
  isHoneypot: boolean;   // true if sell simulation fails entirely (warning only, not blocking)
  warningLevel: 'none' | 'low' | 'medium' | 'high' | 'danger' | 'critical';
  warningMessage: string;
  source: 'function' | 'simulation' | 'fallback' | 'error' | 'registry';
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
  const normalizedAddr = getAddress(tokenAddress).toLowerCase();

  // Skip known platform tokens — they have no tax
  if (PLATFORM_TOKENS.has(normalizedAddr)) return DEFAULT_TAX;

  // Fast-path: check dynamic service cache (synchronous)
  const cached = getCachedTax(normalizedAddr);
  if (cached) {
    const buyTax = cached.buyTax;
    const sellTax = cached.sellTax;
    const isTaxed = buyTax > 0 || sellTax > 0;
    const isHoneypot = sellTax >= 100;
    const { level, message } = computeWarningLevel(buyTax, sellTax, isHoneypot);
    console.log(`[useTokenTax] Cache hit for ${normalizedAddr.slice(0, 6)}...${normalizedAddr.slice(-4)}: buyTax=${buyTax}%, sellTax=${sellTax}%, type=${cached.taxType}, source=${cached.source}`);
    return {
      buyTax,
      sellTax,
      isTaxed,
      isHoneypot,
      warningLevel: level,
      warningMessage: message,
      source: cached.source === 'transfer-test' ? 'simulation' : cached.source,
    };
  }

  // Run the full dynamic detection pipeline
  try {
    const dynamicResult = await dynamicDetectTax(normalizedAddr);
    const buyTax = dynamicResult.buyTax;
    const sellTax = dynamicResult.sellTax;
    const isTaxed = buyTax > 0 || sellTax > 0;

    // Honeypot detection: Block tokens that cannot be sold
    const HONEYPOT_THRESHOLD = 90; // 90% sell tax = honeypot
    const isHoneypot = sellTax >= HONEYPOT_THRESHOLD;

    if (isHoneypot) {
      const error = new Error(`Honeypot detected: Token cannot be sold (${sellTax}% sell tax)`);
      error.name = 'HoneypotError';
      throw error;
    }

    // High tax warning threshold (25% is reasonable max)
    const MAX_REASONABLE_TAX = 25;
    const hasUnreasonableTax = buyTax > MAX_REASONABLE_TAX || sellTax > MAX_REASONABLE_TAX;

    const { level, message } = computeWarningLevel(buyTax, sellTax, isHoneypot);
    console.log(`[useTokenTax] Dynamic detection for ${normalizedAddr.slice(0, 6)}...${normalizedAddr.slice(-4)}: buyTax=${buyTax}%, sellTax=${sellTax}%, type=${dynamicResult.taxType}, source=${dynamicResult.source}`);
    return {
      buyTax,
      sellTax,
      isTaxed,
      isHoneypot,
      warningLevel: hasUnreasonableTax ? 'critical' : level,
      warningMessage: hasUnreasonableTax
        ? `WARNING: Extremely high tax detected (${buyTax}% buy / ${sellTax}% sell). This token may have unfavorable economics.`
        : message,
      source: dynamicResult.source === 'transfer-test' ? 'simulation' : dynamicResult.source,
    };
  } catch {
    console.log(`[useTokenTax] Dynamic detection failed for ${normalizedAddr.slice(0, 6)}...${normalizedAddr.slice(-4)}: using fallback (no tax assumed), source=error`);
    return { ...DEFAULT_TAX, source: 'error' };
  }
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
