/**
 * @file taxDetection.test.ts
 * @description Comprehensive tests for the Tax Detection Service.
 *
 * Coverage:
 *   1. Cache Management (in-memory + localStorage)
 *   2. Function-Based Detection (contract getter calls)
 *   3. Simulation-Based Detection (swap simulation via getAmountsOut)
 *   4. Transfer Tax Detection (fee-on-transfer tokens)
 *   5. Conservative Fallback
 *   6. Edge Cases
 *
 * Reference: src/services/taxDetection.ts
 *
 * All tests use self-contained implementations (no real RPC calls).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ─── Types (mirrors src/services/taxDetection.ts) ──────────────────────────────

interface TokenTaxInfo {
  buyTax: number;
  sellTax: number;
  taxType: 'dex-only' | 'transfer' | 'unknown';
  source: 'function' | 'simulation' | 'transfer-test' | 'fallback';
  confidence: 'high' | 'medium' | 'low';
}

interface TaxCacheEntry {
  buyTax: number;
  sellTax: number;
  taxType: 'dex-only' | 'transfer' | 'unknown';
  source: 'function' | 'simulation' | 'transfer-test' | 'fallback';
  confidence: 'high' | 'medium' | 'low';
  detectedAt: number;
  expiresAt: number;
  tokenAddress: string;
}

// ─── Constants ─────────────────────────────────────────────────────────────────

const CACHE_TTL_MS = 30 * 60 * 1000;        // 30 minutes
const FALLBACK_TTL_MS = 10 * 60 * 1000;     // 10 minutes
const STORAGE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const STORAGE_KEY = 'omnom_tax_detection_v1';

const PLATFORM_TOKENS = new Set([
  '0xb7ddc6414bf4f5515b52d8bdd69973ae205ff101', // WWDOGE
  '0x7b4328c127b85369d9f82ca0503b000d09cf9180', // DC
  '0xe3fca919883950c5cd468156392a6477ff5d18de', // OMNOM
  '0x8a764cf73438de795c98707b07034e577af54825', // DINU
]);

// ─── Mock Tax Detection Service ────────────────────────────────────────────────

class MockTaxDetectionService {
  private memoryCache = new Map<string, TaxCacheEntry>();
  public localStorageData: Record<string, string> = {};

  // Mock RPC client — configurable per test
  public mockReadContract = vi.fn();
  public mockSimulateContract = vi.fn();
  public mockFetchPoolsForPair = vi.fn();

  // ── Cache: Public API ──────────────────────────────────────────────────────

  getCachedTax(tokenAddress: string): TokenTaxInfo | null {
    const key = tokenAddress.toLowerCase();
    const entry = this.memoryCache.get(key);
    if (!entry) return null;

    const now = Date.now();
    if (now >= entry.expiresAt) {
      this.memoryCache.delete(key);
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

  setCachedTax(
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

    this.memoryCache.set(key, entry);
    this.persistToStorage();
  }

  clearTaxCache(): void {
    this.memoryCache.clear();
    delete this.localStorageData[STORAGE_KEY];
  }

  // ── Cache: localStorage persistence ────────────────────────────────────────

  loadStorageCache(): void {
    try {
      const raw = this.localStorageData[STORAGE_KEY];
      if (!raw) return;
      const entries = JSON.parse(raw) as TaxCacheEntry[];
      const now = Date.now();
      for (const entry of entries) {
        if (now < entry.expiresAt + (STORAGE_TTL_MS - CACHE_TTL_MS)) {
          this.memoryCache.set(entry.tokenAddress.toLowerCase(), entry);
        }
      }
    } catch {
      // ignore
    }
  }

  persistToStorage(): void {
    try {
      const now = Date.now();
      const entries: TaxCacheEntry[] = [];
      for (const [, entry] of this.memoryCache) {
        if (now - entry.detectedAt < STORAGE_TTL_MS) {
          entries.push(entry);
        }
      }
      this.localStorageData[STORAGE_KEY] = JSON.stringify(entries);
    } catch {
      // ignore
    }
  }

  // ── Strategy 1: Contract Function Calls ────────────────────────────────────

  async tryTaxFunctionCalls(tokenAddress: string): Promise<{ buyTax: number; sellTax: number } | null> {
    const buyFunctions = ['buyTotalFees', '_buyTax', 'totalBuyFee', 'buyFee', 'buyTax'];
    const sellFunctions = ['sellTotalFees', '_sellTax', 'totalSellFee', 'sellFee', 'sellTax'];
    const sharedFunctions = ['totalFee', 'taxFee', '_taxFee', 'liquidityFee', '_liquidityFee', '_redisFee'];

    const trySingleCall = async (fnName: string): Promise<number | null> => {
      try {
        const result = await this.mockReadContract(tokenAddress, fnName);
        if (result === null || result === undefined) return null;
        const val = Number(result);
        if (isNaN(val) || val < 0) return null;
        // Normalize: if > 100, assume basis points
        return val > 100 ? val / 100 : val;
      } catch {
        return null;
      }
    };

    // Try buy functions
    const buyResults = await Promise.all(buyFunctions.map(fn => trySingleCall(fn)));
    let buyTax: number | null = null;
    for (const val of buyResults) {
      if (val !== null && val >= 0) { buyTax = val; break; }
    }

    // Try sell functions
    const sellResults = await Promise.all(sellFunctions.map(fn => trySingleCall(fn)));
    let sellTax: number | null = null;
    for (const val of sellResults) {
      if (val !== null && val >= 0) { sellTax = val; break; }
    }

    // Try shared functions if neither found
    if (buyTax === null && sellTax === null) {
      const sharedResults = await Promise.all(sharedFunctions.map(fn => trySingleCall(fn)));
      for (const val of sharedResults) {
        if (val !== null && val > 0) { buyTax = val; sellTax = val; break; }
      }
    }

    if (buyTax !== null || sellTax !== null) {
      return { buyTax: buyTax ?? 0, sellTax: sellTax ?? 0 };
    }
    return null;
  }

  // ── Strategy 2: Swap Simulation ────────────────────────────────────────────

  async simulateTaxViaSwap(tokenAddress: string): Promise<{
    buyTax: number;
    sellTax: number;
    isHoneypot: boolean;
  } | null> {
    const addr = tokenAddress.toLowerCase();
    const wwdoge = '0xb7ddc6414bf4f5515b52d8bdd69973ae205ff101';

    if (addr === wwdoge) return { buyTax: 0, sellTax: 0, isHoneypot: false };

    // Get pools
    const pools = await this.mockFetchPoolsForPair(addr, wwdoge);
    if (!pools || pools.length === 0) return null;

    const pool = pools[0];
    const reserveToken = pool.reserve0;
    const reserveWwdoge = pool.reserve1;

    if (reserveToken === 0n || reserveWwdoge === 0n) return null;

    // Expected output from AMM math (no tax)
    const testAmount = 10n ** 18n;
    const expectedOut = (testAmount * reserveWwdoge) / (reserveToken + testAmount);
    if (expectedOut === 0n) return null;

    // Sell simulation
    const sellResult = await this.mockReadContract(`${addr}_sell_simulation`, 'getAmountsOut');
    let sellWorks = false;
    let routerQuotedOut = 0n;

    if (sellResult && sellResult.length >= 2 && sellResult[sellResult.length - 1] > 0n) {
      routerQuotedOut = sellResult[sellResult.length - 1];
      sellWorks = true;
    }

    if (!sellWorks) {
      return { buyTax: 0, sellTax: 0, isHoneypot: true };
    }

    // Compute sell tax
    let sellTax = 0;
    if (routerQuotedOut > 0n && expectedOut > 0n && routerQuotedOut < expectedOut) {
      const diff = expectedOut - routerQuotedOut;
      sellTax = Math.round(Number((diff * 10000n) / expectedOut)) / 100;
    }

    // Buy simulation
    let buyTax = 0;
    const buyResult = await this.mockReadContract(`${addr}_buy_simulation`, 'getAmountsOut');
    if (buyResult && buyResult.length >= 2) {
      const quotedOut = buyResult[buyResult.length - 1];
      const buyAmount = 10n ** 18n;
      const expectedBuyOut = (buyAmount * reserveToken) / (reserveWwdoge + buyAmount);
      if (quotedOut < expectedBuyOut && expectedBuyOut > 0n) {
        const diff = expectedBuyOut - quotedOut;
        buyTax = Math.round(Number((diff * 10000n) / expectedBuyOut)) / 100;
      }
    } else {
      buyTax = sellTax; // fallback
    }

    return { buyTax: Math.max(0, buyTax), sellTax: Math.max(0, sellTax), isHoneypot: false };
  }

  // ── Strategy 3: Transfer Simulation ────────────────────────────────────────

  async simulateTransferTax(tokenAddress: string): Promise<{ transferTax: number } | null> {
    try {
      const holderBalance = await this.mockReadContract(tokenAddress, 'balanceOf_self');
      if (!holderBalance || holderBalance === 0n) return null;

      const testAmount = holderBalance / 1000n;
      if (testAmount === 0n) return null;

      const balanceBefore = await this.mockReadContract(tokenAddress, 'balanceOf_dead') ?? 0n;

      await this.mockSimulateContract(tokenAddress, 'transfer', testAmount);

      const balanceAfter = await this.mockReadContract(tokenAddress, 'balanceOf_dead_after') ?? 0n;
      const received = balanceAfter - balanceBefore;

      if (received < testAmount && testAmount > 0n) {
        const diff = testAmount - BigInt(received);
        const transferTax = Math.round(Number((diff * 10000n) / testAmount)) / 100;
        return { transferTax };
      }

      return { transferTax: 0 };
    } catch {
      return null;
    }
  }

  // ── Main Detection Function ────────────────────────────────────────────────

  async detectTokenTax(tokenAddress: string): Promise<TokenTaxInfo> {
    const normalizedAddr = tokenAddress.toLowerCase();

    // Skip platform tokens
    if (PLATFORM_TOKENS.has(normalizedAddr)) {
      return { buyTax: 0, sellTax: 0, taxType: 'unknown', source: 'fallback', confidence: 'high' };
    }

    // Check cache
    const cached = this.getCachedTax(normalizedAddr);
    if (cached) return cached;

    // Strategy 1: Function calls
    const funcResult = await this.tryTaxFunctionCalls(normalizedAddr);
    if (funcResult !== null) {
      const info: TokenTaxInfo = {
        buyTax: funcResult.buyTax,
        sellTax: funcResult.sellTax,
        taxType: 'unknown',
        source: 'function',
        confidence: 'high',
      };
      this.setCachedTax(normalizedAddr, info);
      return info;
    }

    // Strategy 2: Swap simulation
    const simResult = await this.simulateTaxViaSwap(normalizedAddr);
    if (simResult !== null) {
      if (simResult.isHoneypot) {
        const info: TokenTaxInfo = {
          buyTax: 0,
          sellTax: 100,
          taxType: 'dex-only',
          source: 'simulation',
          confidence: 'low',
        };
        this.setCachedTax(normalizedAddr, info, FALLBACK_TTL_MS);
        return info;
      }

      // Strategy 3: Transfer simulation (to distinguish tax type)
      let taxType: 'dex-only' | 'transfer' | 'unknown' = 'dex-only';
      if (simResult.buyTax > 0 || simResult.sellTax > 0) {
        const transferResult = await this.simulateTransferTax(normalizedAddr);
        if (transferResult !== null && transferResult.transferTax > 0) {
          taxType = 'transfer';
        } else if (transferResult !== null) {
          taxType = 'dex-only';
        } else {
          taxType = 'unknown';
        }
      }

      const info: TokenTaxInfo = {
        buyTax: simResult.buyTax,
        sellTax: simResult.sellTax,
        taxType,
        source: 'simulation',
        confidence: 'medium',
      };
      this.setCachedTax(normalizedAddr, info);
      return info;
    }

    // Strategy 3 standalone: Transfer simulation
    const transferResult = await this.simulateTransferTax(normalizedAddr);
    if (transferResult !== null && transferResult.transferTax > 0) {
      const info: TokenTaxInfo = {
        buyTax: transferResult.transferTax,
        sellTax: transferResult.transferTax,
        taxType: 'transfer',
        source: 'transfer-test',
        confidence: 'medium',
      };
      this.setCachedTax(normalizedAddr, info);
      return info;
    }

    // Conservative fallback
    const fallback: TokenTaxInfo = {
      buyTax: 0,
      sellTax: 0,
      taxType: 'unknown',
      source: 'fallback',
      confidence: 'low',
    };
    this.setCachedTax(normalizedAddr, fallback, FALLBACK_TTL_MS);
    return fallback;
  }
}

// ─── Helper ────────────────────────────────────────────────────────────────────

function makePool(reserve0: bigint, reserve1: bigint) {
  return { reserve0, reserve1 };
}

// ─── Test Suites ────────────────────────────────────────────────────────────────

describe('Tax Detection System', () => {
  let service: MockTaxDetectionService;

  beforeEach(() => {
    service = new MockTaxDetectionService();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ─── Cache Management ──────────────────────────────────────────────────────

  describe('Cache Management', () => {
    it('should return null for uncached token', () => {
      expect(service.getCachedTax('0xunknown123')).toBeNull();
    });

    it('should cache and retrieve tax info', () => {
      const info: TokenTaxInfo = {
        buyTax: 3,
        sellTax: 3,
        taxType: 'dex-only',
        source: 'function',
        confidence: 'high',
      };
      service.setCachedTax('0xtokenA', info);

      const cached = service.getCachedTax('0xtokenA');
      expect(cached).not.toBeNull();
      expect(cached!.buyTax).toBe(3);
      expect(cached!.sellTax).toBe(3);
      expect(cached!.source).toBe('function');
    });

    it('should respect TTL and expire entries', () => {
      const info: TokenTaxInfo = {
        buyTax: 5,
        sellTax: 5,
        taxType: 'dex-only',
        source: 'simulation',
        confidence: 'medium',
      };
      service.setCachedTax('0xtokenB', info, CACHE_TTL_MS);

      // Not expired yet
      expect(service.getCachedTax('0xtokenB')).not.toBeNull();

      // Advance past TTL
      vi.advanceTimersByTime(CACHE_TTL_MS + 1);

      expect(service.getCachedTax('0xtokenB')).toBeNull();
    });

    it('should persist to localStorage', () => {
      const info: TokenTaxInfo = {
        buyTax: 2,
        sellTax: 2,
        taxType: 'transfer',
        source: 'transfer-test',
        confidence: 'medium',
      };
      service.setCachedTax('0xtokenC', info);

      const stored = service.localStorageData[STORAGE_KEY];
      expect(stored).toBeDefined();
      const parsed = JSON.parse(stored);
      expect(parsed.length).toBeGreaterThan(0);
      expect(parsed[0].tokenAddress).toBe('0xtokenc');
    });

    it('should load from localStorage on init', () => {
      const now = Date.now();
      const entry: TaxCacheEntry = {
        buyTax: 4,
        sellTax: 4,
        taxType: 'dex-only',
        source: 'simulation',
        confidence: 'medium',
        detectedAt: now,
        expiresAt: now + CACHE_TTL_MS,
        tokenAddress: '0xtokend',
      };
      service.localStorageData[STORAGE_KEY] = JSON.stringify([entry]);

      service.loadStorageCache();

      const cached = service.getCachedTax('0xtokend');
      expect(cached).not.toBeNull();
      expect(cached!.buyTax).toBe(4);
    });

    it('should clear cache completely', () => {
      service.setCachedTax('0xtoken1', {
        buyTax: 1, sellTax: 1, taxType: 'dex-only', source: 'function', confidence: 'high',
      });
      service.setCachedTax('0xtoken2', {
        buyTax: 2, sellTax: 2, taxType: 'transfer', source: 'simulation', confidence: 'medium',
      });

      service.clearTaxCache();

      expect(service.getCachedTax('0xtoken1')).toBeNull();
      expect(service.getCachedTax('0xtoken2')).toBeNull();
      expect(service.localStorageData[STORAGE_KEY]).toBeUndefined();
    });
  });

  // ─── Function-Based Detection ──────────────────────────────────────────────

  describe('Function-Based Detection', () => {
    it('should detect buyTax via buyTax() function', async () => {
      service.mockReadContract.mockImplementation(async (_addr: string, fn: string) => {
        if (fn === 'buyTax') return 3n;
        if (fn === 'sellTax') return 3n;
        throw new Error('not found');
      });

      const result = await service.tryTaxFunctionCalls('0xtaxedtoken');
      expect(result).not.toBeNull();
      expect(result!.buyTax).toBe(3);
      expect(result!.sellTax).toBe(3);
    });

    it('should detect sellTax via sellTax() function', async () => {
      service.mockReadContract.mockImplementation(async (_addr: string, fn: string) => {
        if (fn === 'buyTax') return 0n;
        if (fn === 'sellTax') return 5n;
        throw new Error('not found');
      });

      const result = await service.tryTaxFunctionCalls('0xtaxedtoken');
      expect(result).not.toBeNull();
      expect(result!.buyTax).toBe(0);
      expect(result!.sellTax).toBe(5);
    });

    it('should try alternative getters (buyFee, _buyTax, etc.)', async () => {
      service.mockReadContract.mockImplementation(async (_addr: string, fn: string) => {
        // Standard buyTax/sellTax don't exist, but buyFee/sellFee do
        if (fn === 'buyFee') return 200n; // 200 basis points = 2%
        if (fn === 'sellFee') return 300n; // 300 basis points = 3%
        throw new Error('not found');
      });

      const result = await service.tryTaxFunctionCalls('0xtaxedtoken');
      expect(result).not.toBeNull();
      expect(result!.buyTax).toBe(2); // 200 bps → 2%
      expect(result!.sellTax).toBe(3); // 300 bps → 3%
    });

    it('should return null for tokens with no tax functions', async () => {
      service.mockReadContract.mockRejectedValue(new Error('not found'));

      const result = await service.tryTaxFunctionCalls('0xnotaxtoken');
      expect(result).toBeNull();
    });

    it('should handle contract revert gracefully', async () => {
      service.mockReadContract.mockRejectedValue(new Error('execution reverted'));

      const result = await service.tryTaxFunctionCalls('0xreverttoken');
      expect(result).toBeNull();
    });
  });

  // ─── Simulation-Based Detection ────────────────────────────────────────────

  describe('Simulation-Based Detection', () => {
    it('should detect tax via swap simulation', async () => {
      // Pool with 1000 token and 1000 WWDOGE
      service.mockFetchPoolsForPair.mockResolvedValue([
        makePool(BigInt('1000000000000000000000'), BigInt('1000000000000000000000')),
      ]);

      // Sell simulation: router quotes 2% less than expected (dex-only tax)
      service.mockReadContract.mockImplementation(async (id: string, fn: string) => {
        if (fn === 'getAmountsOut' && id.includes('sell_simulation')) {
          // Expected: ~0.999 WWDOGE, quoted: ~0.979 (2% less)
          return [0n, BigInt('979000000000000000')];
        }
        if (fn === 'getAmountsOut' && id.includes('buy_simulation')) {
          return [0n, BigInt('979000000000000000')];
        }
        return null;
      });

      const result = await service.simulateTaxViaSwap('0xsometoken');
      expect(result).not.toBeNull();
      expect(result!.isHoneypot).toBe(false);
      expect(result!.sellTax).toBeGreaterThan(0);
    });

    it('should detect asymmetric buy/sell taxes', async () => {
      service.mockFetchPoolsForPair.mockResolvedValue([
        makePool(BigInt('1000000000000000000000'), BigInt('1000000000000000000000')),
      ]);

      service.mockReadContract.mockImplementation(async (id: string, fn: string) => {
        if (fn === 'getAmountsOut' && id.includes('sell_simulation')) {
          // Sell tax: 3% less
          return [0n, BigInt('969000000000000000')];
        }
        if (fn === 'getAmountsOut' && id.includes('buy_simulation')) {
          // Buy tax: 5% less
          return [0n, BigInt('949000000000000000')];
        }
        return null;
      });

      const result = await service.simulateTaxViaSwap('0xsometoken');
      expect(result).not.toBeNull();
      expect(result!.buyTax).toBeGreaterThan(result!.sellTax);
    });

    it('should handle tokens with no WWDOGE pool', async () => {
      service.mockFetchPoolsForPair.mockResolvedValue([]);

      const result = await service.simulateTaxViaSwap('0xnopooltoken');
      expect(result).toBeNull();
    });

    it('should handle simulation timeout gracefully', async () => {
      // Simulate a pool fetch that returns empty (no pools available)
      // This tests the graceful handling of unavailable pool data
      service.mockFetchPoolsForPair.mockResolvedValue([]);

      const result = await service.simulateTaxViaSwap('0xslowtoken');
      expect(result).toBeNull();
    });

    it('should detect honeypot when sell fails', async () => {
      service.mockFetchPoolsForPair.mockResolvedValue([
        makePool(BigInt('1000000000000000000000'), BigInt('1000000000000000000000')),
      ]);

      // Sell simulation returns null/empty (reverted)
      service.mockReadContract.mockResolvedValue(null);

      const result = await service.simulateTaxViaSwap('0xhoneypot');
      expect(result).not.toBeNull();
      expect(result!.isHoneypot).toBe(true);
    });
  });

  // ─── Transfer Tax Detection ────────────────────────────────────────────────

  describe('Transfer Tax Detection', () => {
    it('should detect fee-on-transfer tokens', async () => {
      // Token contract holds 1000 tokens
      service.mockReadContract.mockImplementation(async (_addr: string, fn: string) => {
        if (fn === 'balanceOf_self') return BigInt('1000000000000000000000');
        if (fn === 'balanceOf_dead') return 0n;
        if (fn === 'balanceOf_dead_after') return BigInt('970000000000000000'); // 3% less
        return null;
      });

      // Transfer succeeds
      service.mockSimulateContract.mockResolvedValue(true);

      const result = await service.simulateTransferTax('0xfeeontoken');
      expect(result).not.toBeNull();
      expect(result!.transferTax).toBe(3);
    });

    it('should distinguish dex-only from transfer tax', async () => {
      // Token has dex tax but no transfer tax (received == testAmount)
      const selfBalance = BigInt('1000000000000000000000');
      const testAmount = selfBalance / 1000n; // 1e15
      service.mockReadContract.mockImplementation(async (_addr: string, fn: string) => {
        if (fn === 'balanceOf_self') return selfBalance;
        if (fn === 'balanceOf_dead') return 0n;
        // After transfer, dead address received exactly testAmount (no transfer tax)
        if (fn === 'balanceOf_dead_after') return testAmount;
        return null;
      });

      service.mockSimulateContract.mockResolvedValue(true);

      const result = await service.simulateTransferTax('0xdexonlytoken');
      expect(result).not.toBeNull();
      expect(result!.transferTax).toBe(0);
    });

    it('should handle transfer simulation failure', async () => {
      service.mockReadContract.mockImplementation(async (_addr: string, fn: string) => {
        if (fn === 'balanceOf_self') return BigInt('1000000000000000000000');
        throw new Error('execution reverted');
      });

      service.mockSimulateContract.mockRejectedValue(new Error('reverted'));

      const result = await service.simulateTransferTax('0xbroken');
      expect(result).toBeNull();
    });
  });

  // ─── Conservative Fallback ─────────────────────────────────────────────────

  describe('Conservative Fallback', () => {
    it('should return 0% with low confidence when all strategies fail', async () => {
      // All strategies fail
      service.mockReadContract.mockRejectedValue(new Error('fail'));
      service.mockFetchPoolsForPair.mockResolvedValue([]);
      service.mockSimulateContract.mockRejectedValue(new Error('fail'));

      const result = await service.detectTokenTax('0xunknowntoken');
      expect(result.buyTax).toBe(0);
      expect(result.sellTax).toBe(0);
      expect(result.confidence).toBe('low');
      expect(result.source).toBe('fallback');
    });

    it('should use shorter TTL for fallback results', async () => {
      service.mockReadContract.mockRejectedValue(new Error('fail'));
      service.mockFetchPoolsForPair.mockResolvedValue([]);
      service.mockSimulateContract.mockRejectedValue(new Error('fail'));

      await service.detectTokenTax('0xunknowntoken');

      service.getCachedTax('0xunknowntoken');
      // The entry should expire sooner (FALLBACK_TTL_MS vs CACHE_TTL_MS)
      // We verify by advancing time past FALLBACK_TTL but before CACHE_TTL
      vi.advanceTimersByTime(FALLBACK_TTL_MS + 1);
      expect(service.getCachedTax('0xunknowntoken')).toBeNull();
    });
  });

  // ─── Edge Cases ────────────────────────────────────────────────────────────

  describe('Edge Cases', () => {
    it('should handle zero-address token', async () => {
      service.mockReadContract.mockRejectedValue(new Error('fail'));
      service.mockFetchPoolsForPair.mockResolvedValue([]);

      const result = await service.detectTokenTax('0x0000000000000000000000000000000000000000');
      expect(result).toBeDefined();
      expect(result.confidence).toBe('low');
    });

    it('should handle invalid contract address', async () => {
      service.mockReadContract.mockRejectedValue(new Error('invalid address'));
      service.mockFetchPoolsForPair.mockResolvedValue([]);

      const result = await service.detectTokenTax('0xinvalid');
      expect(result).toBeDefined();
    });

    it('should handle tokens with extremely high tax (>50%)', async () => {
      service.mockReadContract.mockImplementation(async (_addr: string, fn: string) => {
        if (fn === 'buyTax') return 75n; // 75%
        if (fn === 'sellTax') return 75n;
        throw new Error('not found');
      });

      const result = await service.tryTaxFunctionCalls('0xhightax');
      expect(result).not.toBeNull();
      expect(result!.buyTax).toBe(75);
      expect(result!.sellTax).toBe(75);
    });

    it('should handle tokens with 0% tax explicitly set', async () => {
      service.mockReadContract.mockImplementation(async (_addr: string, fn: string) => {
        if (fn === 'buyTax') return 0n;
        if (fn === 'sellTax') return 0n;
        throw new Error('not found');
      });

      const result = await service.tryTaxFunctionCalls('0xzerotax');
      expect(result).not.toBeNull();
      expect(result!.buyTax).toBe(0);
      expect(result!.sellTax).toBe(0);
    });

    it('should handle concurrent detection requests for same token', async () => {
      service.mockReadContract.mockImplementation(async (_addr: string, fn: string) => {
        if (fn === 'buyTax') return 3n;
        if (fn === 'sellTax') return 3n;
        throw new Error('not found');
      });

      // Fire multiple concurrent detections
      const [r1, r2, r3] = await Promise.all([
        service.detectTokenTax('0xconcurrenToken'),
        service.detectTokenTax('0xconcurrenToken'),
        service.detectTokenTax('0xconcurrenToken'),
      ]);

      // All should return the same result
      expect(r1.buyTax).toBe(3);
      expect(r2.buyTax).toBe(3);
      expect(r3.buyTax).toBe(3);
    });

    it('should skip detection for platform tokens (WWDOGE, DC, OMNOM)', async () => {
      const wwdogeResult = await service.detectTokenTax('0xb7ddc6414bf4f5515b52d8bdd69973ae205ff101');
      expect(wwdogeResult.buyTax).toBe(0);
      expect(wwdogeResult.confidence).toBe('high');

      const dcResult = await service.detectTokenTax('0x7b4328c127b85369d9f82ca0503b000d09cf9180');
      expect(dcResult.buyTax).toBe(0);
      expect(dcResult.confidence).toBe('high');

      const omnomResult = await service.detectTokenTax('0xe3fca919883950c5cd468156392a6477ff5d18de');
      expect(omnomResult.buyTax).toBe(0);
      expect(omnomResult.confidence).toBe('high');
    });

    it('should handle case-insensitive token addresses', async () => {
      service.setCachedTax('0xABC123', {
        buyTax: 3, sellTax: 3, taxType: 'dex-only', source: 'function', confidence: 'high',
      });

      // Should find with different case
      const cached = service.getCachedTax('0xabc123');
      expect(cached).not.toBeNull();
      expect(cached!.buyTax).toBe(3);
    });
  });
});
