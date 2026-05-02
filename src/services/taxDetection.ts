/**
 * Tax Detection Service — automatically detects ERC-20 buy/sell taxes on Dogechain.
 *
 * Detection strategies (in priority order):
 *   1. Contract function calls — try standard tax getter functions (buyTax, sellTax, etc.)
 *   2. Swap simulation — simulate swaps via router's getAmountsOut() and compare with AMM math
 *   3. Transfer simulation — simulate a transfer() call and check for fee-on-transfer
 *
 * Features:
 *   - In-memory cache with 30-minute TTL for detected taxes
 *   - localStorage persistence for cross-session caching (24h TTL)
 *   - Conservative fallback (0% tax, low confidence) when all strategies fail
 *   - 5-second timeout per strategy to prevent slow RPC from blocking the UI
 *   - Comprehensive logging for debugging
 *
 * This service is standalone (no React hooks) and can be used from any context.
 */

import { createPublicClient, http, parseAbi, getAddress, type Address, type PublicClient } from 'viem';
import { dogechain } from 'wagmi/chains';
import { CONTRACTS } from '../lib/constants';
import { fetchPoolsForPair } from './pathFinder/poolFetcher';

// ─── Log prefix ──────────────────────────────────────────────────────────────

const LOG = '[taxDetection]';

// ─── TTL Constants ───────────────────────────────────────────────────────────

const CACHE_TTL_MS = 30 * 60 * 1000;        // 30 minutes for detected taxes
const FALLBACK_TTL_MS = 10 * 60 * 1000;     // 10 minutes for fallback (uncertain)
const STORAGE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours for localStorage persistence
const DETECTION_TIMEOUT_MS = 10000;          // 10 second overall timeout — increased for slow RPCs
const STRATEGY2_TIMEOUT_MS = 15000;          // 15 second timeout for swap simulation (Strategy 2)

// ─── Platform Tokens (known zero-tax, skip detection) ────────────────────────

const PLATFORM_TOKENS = new Set([
  CONTRACTS.WWDOGE.toLowerCase(),
  CONTRACTS.DC_TOKEN.toLowerCase(),
  CONTRACTS.OMNOM_TOKEN.toLowerCase(),
  CONTRACTS.DINU_TOKEN.toLowerCase(),
]);

// ─── Exported Types ──────────────────────────────────────────────────────────

export interface TokenTaxInfo {
  buyTax: number;        // percentage (e.g., 3 for 3%)
  sellTax: number;       // percentage
  taxType: 'dex-only' | 'transfer' | 'unknown';
  source: 'function' | 'simulation' | 'transfer-test' | 'fallback' | 'registry';
  confidence: 'high' | 'medium' | 'low';
}

// ─── Cache Types ─────────────────────────────────────────────────────────────

interface TaxCacheEntry {
  buyTax: number;
  sellTax: number;
  taxType: 'dex-only' | 'transfer' | 'unknown';
  source: 'function' | 'simulation' | 'transfer-test' | 'fallback' | 'registry';
  confidence: 'high' | 'medium' | 'low';
  detectedAt: number;    // timestamp
  expiresAt: number;     // timestamp (TTL)
  tokenAddress: string;
}

// ─── Known Tax Overrides ─────────────────────────────────────────────────────
// Tokens where automatic detection is inaccurate. Checked BEFORE any strategy.
const KNOWN_TAX_OVERRIDES: Record<string, { buyTax: number; sellTax: number; taxType: 'dex-only' | 'transfer'; reason: string }> = {
  '0xbdad927604c5cb78f15b3669a92fa5a1427d33a2': {
    buyTax: 3,
    sellTax: 3,
    taxType: 'dex-only',
    reason: 'MCRIB — 3% buy/sell tax',
  },
};

// ─── In-Memory Cache ─────────────────────────────────────────────────────────

const memoryCache = new Map<string, TaxCacheEntry>();

// ─── viem Client ─────────────────────────────────────────────────────────────

const client: PublicClient = createPublicClient({
  chain: dogechain,
  transport: http(),
});

// ─── ABI Fragments ───────────────────────────────────────────────────────────

const TAX_DETECTION_ABI = parseAbi([
  // Standard tax getters
  'function buyTax() view returns (uint256)',
  'function sellTax() view returns (uint256)',
  'function buyFee() view returns (uint256)',
  'function sellFee() view returns (uint256)',
  'function totalFee() view returns (uint256)',
  'function taxFee() view returns (uint256)',
  'function _buyTax() view returns (uint256)',
  'function _sellTax() view returns (uint256)',
  'function buyTotalFees() view returns (uint256)',
  'function sellTotalFees() view returns (uint256)',
  // Additional common getters
  'function totalBuyFee() view returns (uint256)',
  'function totalSellFee() view returns (uint256)',
  'function liquidityFee() view returns (uint256)',
  'function _liquidityFee() view returns (uint256)',
  // Reflection / RFI token getters
  'function _taxFee() view returns (uint256)',
  'function _redisFee() view returns (uint256)',
  // ERC20 standard
  'function decimals() view returns (uint8)',
  'function balanceOf(address) view returns (uint256)',
  'function totalSupply() view returns (uint256)',
]);

const ROUTER_ABI = parseAbi([
  'function getAmountsOut(uint256, address[]) view returns (uint256[])',
]);

const ERC20_ABI = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function transfer(address, uint256) returns (bool)',
  'function totalSupply() view returns (uint256)',
]);

// ─── Helper: timeout wrapper ─────────────────────────────────────────────────

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T | null> {
  return Promise.race([
    promise,
    new Promise<null>((resolve) =>
      setTimeout(() => {
        console.warn(`${LOG} ⏱ ${label} timed out after ${ms}ms`);
        resolve(null);
      }, ms),
    ),
  ]);
}

// ─── Helper: normalize tax value ─────────────────────────────────────────────

/**
 * Tax values from contract calls are typically in basis points (100 = 1%)
 * or whole percentages (1 = 1%). Heuristic: if > 100, assume basis points.
 */
function normalizeTaxValue(raw: bigint): number {
  const val = Number(raw);
  if (val > 100) return val / 100; // basis points → percentage
  return val;
}

// ─── Helper: short address for logging ───────────────────────────────────────

function shortAddr(addr: string): string {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

// ─── Cache: localStorage persistence ─────────────────────────────────────────

const STORAGE_KEY = 'omnom_tax_detection_v1';

function loadStorageCache(): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const entries = JSON.parse(raw) as TaxCacheEntry[];
    const now = Date.now();
    let loaded = 0;
    for (const entry of entries) {
      // Only load entries that haven't expired in localStorage
      if (now < entry.expiresAt + (STORAGE_TTL_MS - CACHE_TTL_MS)) {
        memoryCache.set(entry.tokenAddress.toLowerCase(), entry);
        loaded++;
      }
    }
    if (loaded > 0) {
      console.log(`${LOG} Loaded ${loaded} cached entries from localStorage`);
    }
  } catch (err) {
    console.warn(`${LOG} Failed to load localStorage cache:`, err);
  }
}

function persistToStorage(): void {
  try {
    const now = Date.now();
    const entries: TaxCacheEntry[] = [];
    for (const [, entry] of memoryCache) {
      // Only persist entries whose storage TTL hasn't expired
      if (now - entry.detectedAt < STORAGE_TTL_MS) {
        entries.push(entry);
      }
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch (err) {
    // localStorage full or unavailable — ignore silently
    console.warn(`${LOG} Failed to persist cache to localStorage:`, err);
  }
}

// ─── Cache: public API ───────────────────────────────────────────────────────

/**
 * Get a cached tax result if available and not expired.
 */
export function getCachedTax(tokenAddress: string): TokenTaxInfo | null {
  const normalizedAddr = tokenAddress.toLowerCase();

  // Always check overrides first — they're authoritative
  const override = KNOWN_TAX_OVERRIDES[normalizedAddr];
  if (override) {
    return {
      buyTax: override.buyTax,
      sellTax: override.sellTax,
      taxType: override.taxType,
      source: 'registry',
      confidence: 'high',
    };
  }

  // Then check cache
  const entry = memoryCache.get(normalizedAddr);
  if (!entry) return null;

  const now = Date.now();
  if (now >= entry.expiresAt) {
    memoryCache.delete(normalizedAddr);
    console.log(`${LOG} Cache expired for ${shortAddr(normalizedAddr)}, removing`);
    return null;
  }

  return {
    buyTax: entry.buyTax,
    sellTax: entry.sellTax,
    taxType: entry.taxType,
    source: entry.source,
    confidence: entry.confidence,
  };
}

/**
 * Store a tax detection result in cache.
 */
function setCachedTax(
  tokenAddress: string,
  info: TokenTaxInfo,
  ttlMs: number = CACHE_TTL_MS,
): void {
  const key = tokenAddress.toLowerCase();
  const now = Date.now();

  const entry: TaxCacheEntry = {
    ...info,
    tokenAddress: key,
    detectedAt: now,
    expiresAt: now + ttlMs,
  };

  memoryCache.set(key, entry);
  persistToStorage();
  console.log(
    `${LOG} Cached tax for ${shortAddr(key)}: buy=${info.buyTax}%, sell=${info.sellTax}%, ` +
    `source=${info.source}, confidence=${info.confidence}, TTL=${Math.round(ttlMs / 1000)}s`,
  );
}

/**
 * Clear all cached tax data (memory + localStorage).
 */
export function clearTaxCache(): void {
  memoryCache.clear();
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch { /* ignore */ }
  console.log(`${LOG} Tax cache cleared`);
}

// ─── Strategy 1: Contract Function Calls ─────────────────────────────────────

/**
 * Try standard tax getter functions on the token contract.
 * Uses a multicall-like approach to try all getters in parallel.
 *
 * Returns buy/sell tax percentages, or null if no getters are found.
 */
async function tryTaxFunctionCalls(
  tokenAddress: Address,
): Promise<{ buyTax: number; sellTax: number } | null> {
  console.log(`${LOG} Strategy 1: Trying tax function calls for ${shortAddr(tokenAddress)}`);

  // Define function groups — try buy-specific, sell-specific, then shared
  const buyFunctions = [
    'buyTotalFees',
    '_buyTax',
    'totalBuyFee',
    'buyFee',
    'buyTax',
  ] as const;

  const sellFunctions = [
    'sellTotalFees',
    '_sellTax',
    'totalSellFee',
    'sellFee',
    'sellTax',
  ] as const;

  const sharedFunctions = [
    'totalFee',
    'taxFee',
    '_taxFee',
    'liquidityFee',
    '_liquidityFee',
    '_redisFee',
  ] as const;

  // Helper to try a single function call
  const trySingleCall = async (fnName: string): Promise<number | null> => {
    try {
      const result = await client.readContract({
        address: tokenAddress,
        abi: TAX_DETECTION_ABI,
        functionName: fnName as typeof TAX_DETECTION_ABI[number]['name'],
      });
      const val = Number(result);
      if (isNaN(val) || val < 0) return null;
      return normalizeTaxValue(result as bigint);
    } catch {
      return null;
    }
  };

  // Try all buy functions in parallel
  const buyResults = await Promise.all(buyFunctions.map(fn => trySingleCall(fn)));
  let buyTax: number | null = null;
  for (const val of buyResults) {
    if (val !== null && val >= 0) {
      buyTax = val;
      console.log(`${LOG}   buyTax detected via function call: ${val}%`);
      break;
    }
  }

  // Try all sell functions in parallel
  const sellResults = await Promise.all(sellFunctions.map(fn => trySingleCall(fn)));
  let sellTax: number | null = null;
  for (const val of sellResults) {
    if (val !== null && val >= 0) {
      sellTax = val;
      console.log(`${LOG}   sellTax detected via function call: ${val}%`);
      break;
    }
  }

  // If neither buy nor sell found, try shared functions
  if (buyTax === null && sellTax === null) {
    const sharedResults = await Promise.all(sharedFunctions.map(fn => trySingleCall(fn)));
    for (const val of sharedResults) {
      if (val !== null && val > 0) {
        buyTax = val;
        sellTax = val;
        console.log(`${LOG}   Shared tax detected via function call: ${val}% (applied to both buy & sell)`);
        break;
      }
    }
  }

  if (buyTax !== null || sellTax !== null) {
    console.log(
      `${LOG} Strategy 1 SUCCESS for ${shortAddr(tokenAddress)}: ` +
      `buyTax=${buyTax ?? 0}%, sellTax=${sellTax ?? 0}%`,
    );
    return { buyTax: buyTax ?? 0, sellTax: sellTax ?? 0 };
  }

  console.log(`${LOG} Strategy 1 MISS for ${shortAddr(tokenAddress)}: no tax getters found`);
  return null;
}

// ─── Strategy 2: Swap Simulation ─────────────────────────────────────────────

/**
 * Simulate swaps via the router's getAmountsOut() and compare with expected AMM math.
 * The difference between expected and quoted output is the tax.
 *
 * This detects dex-only taxes (taxes applied only when swapping through a DEX pair).
 */
async function simulateTaxViaSwap(
  tokenAddress: Address,
): Promise<{
  buyTax: number;
  sellTax: number;
  isHoneypot: boolean;
} | null> {
  const addr = tokenAddress.toLowerCase();
  const wwdoge = CONTRACTS.WWDOGE.toLowerCase();

  console.log(`${LOG} Strategy 2: Swap simulation for ${shortAddr(addr)}`);

  if (addr === wwdoge) {
    console.log(`${LOG}   WWDOGE — no tax, skipping simulation`);
    return { buyTax: 0, sellTax: 0, isHoneypot: false };
  }

  // Find pools for token/WWDOGE
  let pools;
  try {
    pools = await fetchPoolsForPair(addr, wwdoge, client);
  } catch (err) {
    console.warn(`${LOG}   Failed to fetch pools for ${shortAddr(addr)}:`, err);
    return null;
  }

  if (!pools || pools.length === 0) {
    console.log(`${LOG}   No WWDOGE pool found for ${shortAddr(addr)} — cannot simulate`);
    return null;
  }

  console.log(`${LOG}   Found ${pools.length} pool(s) for ${shortAddr(addr)}`);

  const pool = pools[0];
  const routerAddr = getAddress(pool.router);

  // Get token decimals
  let decimals = 18;
  try {
    const dec = await client.readContract({
      address: tokenAddress,
      abi: ERC20_ABI,
      functionName: 'decimals',
    });
    decimals = Number(dec);
  } catch {
    console.log(`${LOG}   Could not read decimals, defaulting to 18`);
  }

  // Test amount: 1 token
  const testAmount = 10n ** BigInt(decimals);

  // Determine token position in the pair
  const isToken0 = pool.token0.toLowerCase() === addr;
  const reserveToken = isToken0 ? pool.reserve0 : pool.reserve1;
  const reserveWwdoge = isToken0 ? pool.reserve1 : pool.reserve0;

  if (reserveToken === 0n || reserveWwdoge === 0n) {
    console.log(`${LOG}   Pool has zero reserves — cannot simulate`);
    return null;
  }

  // Expected output from constant product AMM math (no tax)
  // expectedOut = (testAmount * reserveWwdoge) / (reserveToken + testAmount)
  const expectedOut = (testAmount * reserveWwdoge) / (reserveToken + testAmount);
  if (expectedOut === 0n) {
    console.log(`${LOG}   Expected output is zero — insufficient reserves`);
    return null;
  }

  console.log(
    `${LOG}   Pool reserves: token=${reserveToken.toString()}, wwdoge=${reserveWwdoge.toString()}, ` +
    `expectedOut=${expectedOut.toString()}`,
  );

  // ── Sell simulation: token → WWDOGE ──
  let routerQuotedOut = 0n;
  let sellWorks = false;

  try {
    const sellPath: [`0x${string}`, ...`0x${string}`[]] = [
      getAddress(addr),
      getAddress(wwdoge),
    ];
    const amounts = await client.readContract({
      address: routerAddr,
      abi: ROUTER_ABI,
      functionName: 'getAmountsOut',
      args: [testAmount, sellPath],
    }) as bigint[];

    if (amounts.length >= 2 && amounts[amounts.length - 1] > 0n) {
      routerQuotedOut = amounts[amounts.length - 1];
      sellWorks = true;
      console.log(`${LOG}   Sell simulation: router quoted ${routerQuotedOut.toString()} (expected ${expectedOut.toString()})`);
    }
  } catch (err) {
    console.log(`${LOG}   Sell simulation failed on primary DEX:`, err);
    sellWorks = false;
  }

  // If sell failed on primary DEX, try alternative DEXes
  if (!sellWorks && pools.length > 1) {
    console.log(`${LOG}   Trying alternative DEXes for sell simulation...`);
    for (let i = 1; i < pools.length; i++) {
      try {
        const altRouter = getAddress(pools[i].router);
        const altPath: [`0x${string}`, ...`0x${string}`[]] = [
          getAddress(addr),
          getAddress(wwdoge),
        ];
        const amounts = await client.readContract({
          address: altRouter,
          abi: ROUTER_ABI,
          functionName: 'getAmountsOut',
          args: [testAmount, altPath],
        }) as bigint[];

        if (amounts.length >= 2 && amounts[amounts.length - 1] > 0n) {
          routerQuotedOut = amounts[amounts.length - 1];
          sellWorks = true;
          console.log(`${LOG}   Sell simulation succeeded on alt DEX ${pools[i].dexName}: quoted ${routerQuotedOut.toString()}`);
          break;
        }
      } catch {
        continue;
      }
    }
  }

  // If sell still doesn't work on any DEX, it might be a honeypot
  if (!sellWorks) {
    console.warn(`${LOG}   Sell simulation FAILED on all DEXes — possible honeypot: ${shortAddr(addr)}`);
    return { buyTax: 0, sellTax: 0, isHoneypot: true };
  }

  // Compute sell tax: difference between expected (AMM math) and quoted (router)
  let sellTax = 0;
  if (routerQuotedOut > 0n && expectedOut > 0n) {
    if (routerQuotedOut < expectedOut) {
      const diff = expectedOut - routerQuotedOut;
      sellTax = Math.round(Number((diff * 10000n) / expectedOut)) / 100;
      console.log(`${LOG}   Sell tax detected: ${sellTax}% (expected ${expectedOut.toString()}, got ${routerQuotedOut.toString()})`);
    } else {
      console.log(`${LOG}   No sell tax detected (router quoted >= expected)`);
    }
  }

  // ── Buy simulation: WWDOGE → token ──
  let buyTax = 0;
  try {
    const buyPath: [`0x${string}`, ...`0x${string}`[]] = [
      getAddress(wwdoge),
      getAddress(addr),
    ];
    const buyAmount = 10n ** 18n; // 1 WWDOGE
    const buyAmounts = await client.readContract({
      address: routerAddr,
      abi: ROUTER_ABI,
      functionName: 'getAmountsOut',
      args: [buyAmount, buyPath],
    }) as bigint[];

    if (buyAmounts.length >= 2) {
      const quotedOut = buyAmounts[buyAmounts.length - 1];
      // Expected from reserves (constant product)
      const reserveWwdogeBuy = isToken0 ? pool.reserve1 : pool.reserve0;
      const reserveTokenBuy = isToken0 ? pool.reserve0 : pool.reserve1;
      const expectedBuyOut = (buyAmount * reserveTokenBuy) / (reserveWwdogeBuy + buyAmount);

      if (quotedOut < expectedBuyOut && expectedBuyOut > 0n) {
        const diff = expectedBuyOut - quotedOut;
        buyTax = Math.round(Number((diff * 10000n) / expectedBuyOut)) / 100;
        console.log(`${LOG}   Buy tax detected: ${buyTax}% (expected ${expectedBuyOut.toString()}, got ${quotedOut.toString()})`);
      } else {
        console.log(`${LOG}   No buy tax detected (router quoted >= expected)`);
      }
    }
  } catch (err) {
    // Buy simulation failed — assume same as sell tax
    console.log(`${LOG}   Buy simulation failed, using sell tax as fallback:`, err);
    buyTax = sellTax;
  }

  const result = {
    buyTax: Math.max(0, buyTax),
    sellTax: Math.max(0, sellTax),
    isHoneypot: false,
  };

  console.log(
    `${LOG} Strategy 2 RESULT for ${shortAddr(addr)}: ` +
    `buyTax=${result.buyTax}%, sellTax=${result.sellTax}%, isHoneypot=${result.isHoneypot}`,
  );

  return result;
}

// ─── Strategy 3: Transfer Simulation ────────────────────────────────────────

/**
 * Simulate a transfer() call and check if the received amount is less than sent.
 * This detects fee-on-transfer tokens (transfer-type taxes).
 *
 * Uses eth_call (no gas cost) to simulate the transfer from a funded address
 * (the pool or token contract itself) to a burn address.
 */
async function simulateTransferTax(
  tokenAddress: Address,
): Promise<{ transferTax: number } | null> {
  console.log(`${LOG} Strategy 3: Transfer simulation for ${shortAddr(tokenAddress)}`);

  // We need an address that holds tokens. Try the token contract itself
  // (some tokens hold their own supply) or a known holder.
  // Use a dead address as the recipient.
  const deadAddress: Address = '0x000000000000000000000000000000000000dEaD';

  // First, find a holder with tokens — try the WWDOGE pool if it exists
  let holderBalance = 0n;
  let holderAddress: Address = tokenAddress; // fallback: try the token contract itself

  try {
    // Check the token contract's own balance
    holderBalance = await client.readContract({
      address: tokenAddress,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [tokenAddress],
    }) as bigint;

    if (holderBalance > 0n) {
      holderAddress = tokenAddress;
    }
  } catch { /* ignore */ }

  // If the token contract doesn't hold tokens, try the WWDOGE pool
  if (holderBalance === 0n) {
    try {
      const wwdoge = CONTRACTS.WWDOGE.toLowerCase();
      const pools = await fetchPoolsForPair(tokenAddress.toLowerCase(), wwdoge, client);
      if (pools.length > 0) {
        // The pool address can be derived from factory but we don't have it directly.
        // Instead, check the total supply and use a fraction.
        const totalSupply = await client.readContract({
          address: tokenAddress,
          abi: ERC20_ABI,
          functionName: 'totalSupply',
        }) as bigint;

        if (totalSupply > 0n) {
          // We can't easily get the pool address without factory.getPair()
          // So we'll skip this strategy if we can't find a holder
          console.log(`${LOG}   No suitable holder found for transfer simulation, skipping`);
          return null;
        }
      }
    } catch {
      console.log(`${LOG}   Could not find pools for transfer simulation`);
      return null;
    }
  }

  if (holderBalance === 0n) {
    console.log(`${LOG}   No tokens held by contract — cannot simulate transfer`);
    return null;
  }

  // Test transfer amount: use a small fraction of the holder's balance
  const testAmount = holderBalance / 1000n; // 0.1% of holdings
  if (testAmount === 0n) {
    console.log(`${LOG}   Test amount is zero — balance too low`);
    return null;
  }

  console.log(
    `${LOG}   Simulating transfer of ${testAmount.toString()} from ${shortAddr(holderAddress)} to dead address`,
  );

  // Simulate the transfer using eth_call
  // We impersonate the holder address by overriding the "from" field
  try {
    // First, get the balance of the dead address before transfer
    const balanceBefore = await client.readContract({
      address: tokenAddress,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [deadAddress],
    }) as bigint;

    // Simulate the transfer using eth_call via readContract
    // Note: This will fail if the token has transfer restrictions,
    // but that's fine — we catch and return null
    // We use simulateContract which does an eth_call (no gas cost)
    await client.simulateContract({
      address: tokenAddress,
      abi: ERC20_ABI,
      functionName: 'transfer',
      args: [deadAddress, testAmount],
      account: holderAddress,
    });

    // If we get here without error, check the balance after
    const balanceAfter = await client.readContract({
      address: tokenAddress,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [deadAddress],
    }) as bigint;

    const received = balanceAfter - balanceBefore;
    if (received < testAmount && testAmount > 0n) {
      const diff = testAmount - received;
      const transferTax = Math.round(Number((diff * 10000n) / testAmount)) / 100;
      console.log(
        `${LOG}   Transfer tax detected: ${transferTax}% (sent ${testAmount.toString()}, received ${received.toString()})`,
      );
      return { transferTax };
    }

    console.log(`${LOG}   No transfer tax detected (received == sent)`);
    return { transferTax: 0 };
  } catch (err) {
    console.log(`${LOG}   Transfer simulation failed (token may have restrictions):`, err);
    return null;
  }
}

// ─── Main Detection Function ─────────────────────────────────────────────────

/**
 * Detect buy/sell tax for a token on Dogechain.
 *
 * Runs detection strategies in priority order:
 *   1. Contract function calls (fastest, ~2-10 RPC calls)
 *   2. Swap simulation via getAmountsOut (moderate, ~5-15 RPC calls)
 *   3. Transfer simulation (for fee-on-transfer tokens)
 *
 * Falls back to 0% tax with low confidence if all strategies fail or timeout.
 * Results are cached in memory and localStorage.
 */
export async function detectTokenTax(tokenAddress: string): Promise<TokenTaxInfo> {
  const normalizedAddr = tokenAddress.toLowerCase();

  console.log(`${LOG} ═════════════════════════════════════════════════`);
  console.log(`${LOG} Starting tax detection for ${shortAddr(normalizedAddr)}`);

  // ── Step 0: Check known tax overrides (authoritative, takes precedence over cache) ──
  const override = KNOWN_TAX_OVERRIDES[normalizedAddr];
  if (override) {
    // Clear any stale cached entry that contradicts the override
    memoryCache.delete(normalizedAddr);
    console.log(`${LOG} Using known tax override for ${shortAddr(normalizedAddr)}: buy=${override.buyTax}%, sell=${override.sellTax}%, type=${override.taxType} (${override.reason})`);
    const result: TokenTaxInfo = {
      buyTax: override.buyTax,
      sellTax: override.sellTax,
      taxType: override.taxType,
      source: 'registry',
      confidence: 'high',
    };
    setCachedTax(normalizedAddr, result);
    return result;
  }

  // ── Skip platform tokens ──
  if (PLATFORM_TOKENS.has(normalizedAddr)) {
    console.log(`${LOG} Platform token ${shortAddr(normalizedAddr)} — known zero tax, skipping detection`);
    return {
      buyTax: 0,
      sellTax: 0,
      taxType: 'unknown',
      source: 'fallback',
      confidence: 'high',
    };
  }

  // ── Check cache ──
  const cached = getCachedTax(normalizedAddr);
  if (cached) {
    console.log(
      `${LOG} Cache HIT for ${shortAddr(normalizedAddr)}: ` +
      `buy=${cached.buyTax}%, sell=${cached.sellTax}%, source=${cached.source}`,
    );
    return cached;
  }

  const addr = getAddress(normalizedAddr) as Address;

  // ── Strategy 1: Contract function calls ──
  console.log(`${LOG} ── Strategy 1: Contract function calls ──`);
  const funcResult = await withTimeout(
    tryTaxFunctionCalls(addr),
    DETECTION_TIMEOUT_MS,
    'Strategy 1 (function calls)',
  );

  if (funcResult !== null) {
    const info: TokenTaxInfo = {
      buyTax: funcResult.buyTax,
      sellTax: funcResult.sellTax,
      taxType: 'unknown',
      source: 'function',
      confidence: 'high',
    };
    setCachedTax(normalizedAddr, info);
    console.log(
      `${LOG} ✓ Detection complete for ${shortAddr(normalizedAddr)} via function calls: ` +
      `buy=${info.buyTax}%, sell=${info.sellTax}%`,
    );
    return info;
  }

  // ── Strategy 2: Swap simulation ──
  // Use a longer timeout for swap simulation since it involves multiple RPC calls
  // (pool discovery, reserve fetching, router getAmountsOut for buy & sell)
  console.log(`${LOG} ── Strategy 2: Swap simulation ──`);
  
  // Start the simulation and also keep a reference for late result capture.
  // If the overall timeout fires but the simulation completes shortly after,
  // we can still use its result instead of falling back to 0%.
  // Uses a separate object to avoid TypeScript narrowing issues.
  const lateCapture = { result: null as { buyTax: number; sellTax: number; isHoneypot: boolean } | null };
  const simPromise = simulateTaxViaSwap(addr).then(r => { lateCapture.result = r; return r; });
  
  const simResult = await withTimeout(
    simPromise,
    STRATEGY2_TIMEOUT_MS,
    'Strategy 2 (swap simulation)',
  );

  if (simResult !== null) {
    // If honeypot detected, return with low confidence
    if (simResult.isHoneypot) {
      console.warn(`${LOG} ⚠ Honeypot detected for ${shortAddr(normalizedAddr)} — sell simulation failed on all DEXes`);
      const info: TokenTaxInfo = {
        buyTax: 0,
        sellTax: 100, // Assume 100% sell tax (can't sell)
        taxType: 'dex-only',
        source: 'simulation',
        confidence: 'low',
      };
      setCachedTax(normalizedAddr, info, FALLBACK_TTL_MS);
      return info;
    }

    // Determine tax type by comparing simulation results
    let taxType: 'dex-only' | 'transfer' | 'unknown' = 'dex-only';

    // ── Strategy 3: Transfer simulation (to distinguish dex-only vs transfer tax) ──
    if (simResult.buyTax > 0 || simResult.sellTax > 0) {
      console.log(`${LOG} ── Strategy 3: Transfer simulation (distinguishing tax type) ──`);
      const transferResult = await withTimeout(
        simulateTransferTax(addr),
        DETECTION_TIMEOUT_MS,
        'Strategy 3 (transfer simulation)',
      );

      if (transferResult !== null && transferResult.transferTax > 0) {
        taxType = 'transfer';
        console.log(`${LOG}   Transfer tax confirmed: ${transferResult.transferTax}%`);
      } else if (transferResult !== null) {
        taxType = 'dex-only';
        console.log(`${LOG}   No transfer tax — tax is dex-only`);
      } else {
        taxType = 'unknown';
        console.log(`${LOG}   Transfer simulation inconclusive — tax type unknown`);
      }
    }

    const info: TokenTaxInfo = {
      buyTax: simResult.buyTax,
      sellTax: simResult.sellTax,
      taxType,
      source: 'simulation',
      confidence: 'medium',
    };
    setCachedTax(normalizedAddr, info);
    console.log(
      `${LOG} ✓ Detection complete for ${shortAddr(normalizedAddr)} via simulation: ` +
      `buy=${info.buyTax}%, sell=${info.sellTax}%, type=${info.taxType}`,
    );
    return info;
  }

  // ── Strategy 3 (standalone): Transfer simulation ──
  // If swap simulation failed entirely (no pool), try transfer simulation alone
  console.log(`${LOG} ── Strategy 3: Transfer simulation (standalone) ──`);
  const transferResult = await withTimeout(
    simulateTransferTax(addr),
    DETECTION_TIMEOUT_MS,
    'Strategy 3 (transfer simulation standalone)',
  );

  if (transferResult !== null && transferResult.transferTax > 0) {
    const info: TokenTaxInfo = {
      buyTax: transferResult.transferTax,
      sellTax: transferResult.transferTax,
      taxType: 'transfer',
      source: 'transfer-test',
      confidence: 'medium',
    };
    setCachedTax(normalizedAddr, info);
    console.log(
      `${LOG} ✓ Detection complete for ${shortAddr(normalizedAddr)} via transfer test: ` +
      `tax=${info.buyTax}%`,
    );
    return info;
  }

  // ── Late result capture for Strategy 2 ──
  // If Strategy 2 completed after the timeout but before we reached this point,
  // use its result instead of falling back to 0%.
  const lateResult = lateCapture.result;
  if (lateResult !== null) {
    console.log(`${LOG} Using late Strategy 2 result for ${shortAddr(normalizedAddr)}: buyTax=${lateResult.buyTax}%, sellTax=${lateResult.sellTax}%`);
    const info: TokenTaxInfo = {
      buyTax: lateResult.buyTax,
      sellTax: lateResult.sellTax,
      taxType: 'dex-only',
      source: 'simulation',
      confidence: 'low', // Lower confidence since it arrived late
    };
    setCachedTax(normalizedAddr, info, FALLBACK_TTL_MS);
    return info;
  }

  // ── Conservative Fallback ──
  console.log(
    `${LOG} ✗ All detection strategies failed for ${shortAddr(normalizedAddr)} — ` +
    `assuming 0% tax (low confidence)`,
  );
  const fallback: TokenTaxInfo = {
    buyTax: 0,
    sellTax: 0,
    taxType: 'unknown',
    source: 'fallback',
    confidence: 'low',
  };
  setCachedTax(normalizedAddr, fallback, FALLBACK_TTL_MS);
  return fallback;
}

// ─── Initialize: Load localStorage cache on module import ────────────────────

loadStorageCache();

console.log(`${LOG} Tax detection service initialized`);
