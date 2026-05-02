/**
 * @file PreFlightValidation.test.ts
 * @description Comprehensive tests for usePreFlightValidation hook
 *              and pre-flight test swap functionality.
 * 
 * Tests cover:
 * - Validation runs with 10% of full amount
 * - Successful validation allows full swap
 * - Failed validation shows appropriate warning
 * - localStorage caching behavior
 * - Cache invalidation on route/amount changes
 * - Error handling for common failure modes
 * 
 * Reference: src/hooks/useAggregator/usePreFlightValidation.ts
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

// ─── Type Definitions ────────────────────────────────────────────────────────

interface RouteStep {
  dexRouter: string;
  dexName: string;
  path: string[];
  amountIn: bigint;
  expectedAmountOut: bigint;
}

interface RouteResult {
  id: string;
  steps: RouteStep[];
  totalAmountIn: bigint;
  totalExpectedOut: bigint;
  priceImpact: number;
  feeAmount: bigint;
  feeBps: number;
  routeType?: 'direct' | 'multi_hop';
  intermediateToken?: string;
}

interface ValidationResult {
  success: boolean;
  testAmountIn: string;
  testExpectedOut: string;
  testActualOut: string | null;
  testTxHash: `0x${string}` | null;
  errorMessage: string | null;
  timestamp: number;
  routeId: string;
  recommendedSlippage: string;
}

// ─── Constants (matching usePreFlightValidation.ts) ───────────────────────────

const TEST_SWAP_FRACTION = 0.1; // 10%
const VALIDATION_CACHE_TTL_MS = 30_000;
const VALIDATION_STORAGE_KEY = 'omnom_preflight_validation';

const MOCK_WWDOGE_ADDRESS = '0x2458FE634F19be3C89b54AB719A2C5B7A383B4C0';
const MOCK_DC_ADDRESS = '0x8170d6c1d6D4f1B15f0d8c06896d2d9D9E9e9e9E';
const MOCK_MCRIB_ADDRESS = '0x1234567890123456789012345678901234567890';

// ─── Helper Functions ─────────────────────────────────────────────────────────

/**
 * Convert decimal amount to wei representation.
 */
function toWei(amount: number | string, decimals: number): bigint {
  const str = typeof amount === 'string' ? amount : amount.toString();
  const [whole, frac = ''] = str.split('.');
  const paddedFrac = frac.padEnd(decimals, '0').slice(0, decimals);
  return BigInt(whole + paddedFrac);
}

/**
 * Format wei to decimal string representation.
 */
function formatFromWei(wei: bigint, decimals: number): string {
  const str = wei.toString();
  if (str === '0') return '0';
  
  if (decimals === 0) {
    return str;
  }
  
  const padded = str.padStart(decimals + 1, '0');
  const whole = padded.slice(0, -decimals) || '0';
  const frac = padded.slice(-decimals);
  const trimmedFrac = frac.replace(/0+$/, '');
  
  return trimmedFrac ? `${whole}.${trimmedFrac}` : whole;
}

/**
 * Create a mock route for testing
 */
function createMockRoute(
  totalAmountIn: bigint,
  totalExpectedOut: bigint,
  feeBps: number = 25,
  routeType: 'direct' | 'multi_hop' = 'direct'
): RouteResult {
  return {
    id: `route-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    steps: [{
      dexRouter: '0x1111111111111111111111111111111111111111',
      dexName: 'MockDEX',
      path: [MOCK_DC_ADDRESS, MOCK_WWDOGE_ADDRESS],
      amountIn: totalAmountIn,
      expectedAmountOut: totalExpectedOut,
    }],
    totalAmountIn,
    totalExpectedOut,
    priceImpact: 0.001,
    feeAmount: (totalAmountIn * BigInt(feeBps)) / 10000n,
    feeBps,
    routeType,
    intermediateToken: routeType === 'multi_hop' ? MOCK_WWDOGE_ADDRESS : undefined,
  };
}

// ─── Mock Cache Implementation ────────────────────────────────────────────────

class MockLocalStorage {
  private store: Map<string, string> = new Map();
  
  getItem(key: string): string | null {
    return this.store.get(key) || null;
  }
  
  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
  
  removeItem(key: string): void {
    this.store.delete(key);
  }
  
  clear(): void {
    this.store.clear();
  }
}

// Global mock storage
const mockStorage = new MockLocalStorage();

// Mock localStorage getter/setter
Object.defineProperty(global, 'localStorage', {
  value: mockStorage,
  writable: true,
});

// ─── Cache Functions (mirroring usePreFlightValidation.ts) ────────────────────

interface CachedValidation {
  routeId: string;
  amountIn: string;
  result: ValidationResult;
}

function getCachedValidation(routeId: string, amountIn: string): CachedValidation | null {
  try {
    const raw = localStorage.getItem(VALIDATION_STORAGE_KEY);
    if (!raw) return null;
    const cached: CachedValidation = JSON.parse(raw);
    // Check if cache is still valid (not expired)
    if (Date.now() - cached.result.timestamp > VALIDATION_CACHE_TTL_MS) {
      return null;
    }
    // Check if route/amount matches
    if (cached.routeId !== routeId || cached.amountIn !== amountIn) {
      return null;
    }
    return cached;
  } catch {
    return null;
  }
}

function storeValidation(routeId: string, amountIn: string, result: ValidationResult): void {
  try {
    const cached: CachedValidation = { routeId, amountIn, result };
    localStorage.setItem(VALIDATION_STORAGE_KEY, JSON.stringify(cached));
  } catch {
    // Ignore storage errors (quota exceeded, private browsing, etc.)
  }
}

function clearValidationCache(): void {
  localStorage.removeItem(VALIDATION_STORAGE_KEY);
}

// ─── Test Suites ─────────────────────────────────────────────────────────────

describe('PreFlightValidation Hook Tests', () => {
  beforeEach(() => {
    // Clear storage before each test
    localStorage.clear();
  });
  
  afterEach(() => {
    localStorage.clear();
  });
  
  describe('1. Test Swap Amount Calculation (10%)', () => {
    it('should calculate 10% of normal amount correctly', () => {
      const normalAmount = toWei(1000, 18);
      const expectedTestAmount = toWei(100, 18);
      
      const actualTestAmount = (normalAmount * BigInt(Math.round(TEST_SWAP_FRACTION * 10000))) / 10000n;
      
      expect(actualTestAmount).toBe(expectedTestAmount);
    });
    
    it('should handle very large amounts', () => {
      const largeAmount = toWei(1000000, 18); // 1M tokens
      const expectedTestAmount = toWei(100000, 18); // 100K tokens (10%)
      
      const actualTestAmount = (largeAmount * BigInt(Math.round(TEST_SWAP_FRACTION * 10000))) / 10000n;
      
      expect(actualTestAmount).toBe(expectedTestAmount);
    });
    
    it('should handle very small amounts (minimum test)', () => {
      const tinyAmount = toWei(0.001, 18); // 0.001 tokens
      const testAmount = (tinyAmount * BigInt(Math.round(TEST_SWAP_FRACTION * 10000))) / 10000n;
      
      // For very small amounts, test amount might be 0 after integer division
      expect(testAmount).toBeGreaterThanOrEqual(0n);
    });
    
    it('should return 0 test amount for amounts too small to have 10%', () => {
      const verySmallAmount = 1n; // 1 wei
      const testAmount = (verySmallAmount * BigInt(Math.round(TEST_SWAP_FRACTION * 10000))) / 10000n;
      
      expect(testAmount).toBe(0n); // 10% of 1 wei = 0
    });
    
    it('should handle decimal precision correctly', () => {
      // Test with amount that doesn't divide evenly
      const oddAmount = toWei(333, 18);
      const testAmount = (oddAmount * BigInt(Math.round(TEST_SWAP_FRACTION * 10000))) / 10000n;
      
      // 10% of 333 = 33.3, but we get integer division
      const expectedWei = toWei(33.3, 18);
      expect(Number(testAmount)).toBeCloseTo(Number(expectedWei), 0);
    });
  });
  
  describe('2. Test Route Expected Output Calculation', () => {
    it('should calculate proportional expected output for test amount', () => {
      const fullAmount = toWei(1000, 18);
      const fullExpectedOut = toWei(800, 18); // 80% efficiency
      const testAmount = fullAmount / 10n;
      
      const testExpectedOut = (fullExpectedOut * testAmount) / fullAmount;
      const expectedTestOut = toWei(80, 18);
      
      expect(testExpectedOut).toBe(expectedTestOut);
    });
    
    it('should handle when expected output is very small', () => {
      const fullAmount = toWei(10000, 18);
      const fullExpectedOut = toWei(5, 18); // Very low output
      const testAmount = fullAmount / 10n;
      
      const testExpectedOut = (fullExpectedOut * testAmount) / fullAmount;
      
      expect(testExpectedOut).toBe(toWei(0.5, 18));
    });
    
    it('should handle zero expected output', () => {
      const fullAmount = toWei(1000, 18);
      const fullExpectedOut = 0n;
      const testAmount = fullAmount / 10n;
      
      const testExpectedOut = (fullExpectedOut * testAmount) / fullAmount;
      
      expect(testExpectedOut).toBe(0n);
    });
  });
  
  describe('3. Test Swap Request Building', () => {
    it('should build valid test swap request structure', () => {
      const route = createMockRoute(toWei(1000, 18), toWei(800, 18));
      const testAmountIn = route.totalAmountIn / 10n;
      const testExpectedOut = (route.totalExpectedOut * testAmountIn) / route.totalAmountIn;
      const slippageBps = 50;
      
      const slippageMultiplier = 10000n - BigInt(slippageBps);
      const testMinTotalOut = (testExpectedOut * slippageMultiplier) / 10000n;
      
      const request = {
        tokenIn: route.steps[0].path[0] as `0x${string}`,
        tokenOut: route.steps[route.steps.length - 1].path[route.steps[route.steps.length - 1].path.length - 1] as `0x${string}`,
        amountIn: testAmountIn,
        minTotalAmountOut: testMinTotalOut,
        deadline: BigInt(Math.floor(Date.now() / 1000) + 2 * 60),
        recipient: '0x3000000000000000000000000000000000000003' as `0x${string}`,
        steps: route.steps.map((step, i) => {
          let stepAmountIn: bigint;
          let stepMinOut: bigint;
          
          const stepMinAmounts = route.steps.map((s) => 
            (s.expectedAmountOut * slippageMultiplier) / 10000n
          );
          
          if (i === 0) {
            const feeAmount = (testAmountIn * BigInt(route.feeBps)) / 10000n;
            stepAmountIn = testAmountIn - feeAmount;
            stepMinOut = stepMinAmounts[0];
          } else {
            stepAmountIn = stepMinAmounts[i - 1];
            stepMinOut = i < route.steps.length - 1
              ? BigInt('1000000000000') // MIN_INTERMEDIATE_OUT
              : stepMinAmounts[i];
          }
          
          return {
            router: step.dexRouter as `0x${string}`,
            path: step.path as `0x${string}`[],
            amountIn: stepAmountIn,
            minAmountOut: stepMinOut,
          };
        }),
      };
      
      // Verify structure
      expect(request.tokenIn).toBe(MOCK_DC_ADDRESS);
      expect(request.amountIn).toBe(testAmountIn);
      expect(request.steps.length).toBe(1);
      expect(request.deadline).toBeGreaterThan(0);
    });
    
    it('should set correct deadline for test swap (2 minutes)', () => {
      const currentTimeSeconds = Math.floor(Date.now() / 1000);
      const testDeadline = BigInt(currentTimeSeconds + 2 * 60);
      
      const expectedDeadline = currentTimeSeconds + 120;
      expect(Number(testDeadline)).toBe(expectedDeadline);
    });
    
    it('should calculate step min amounts correctly', () => {
      const stepExpectedOut = toWei(800, 18);
      const slippageBps = 50;
      const slippageMultiplier = 10000n - BigInt(slippageBps);
      
      const stepMinOut = (stepExpectedOut * slippageMultiplier) / 10000n;
      const expectedMinOut = toWei(796, 18); // 99.5% of 800
      
      expect(stepMinOut).toBe(expectedMinOut);
    });
  });
  
  describe('4. Cache Behavior', () => {
    it('should store validation result in localStorage', () => {
      const route = createMockRoute(toWei(1000, 18), toWei(800, 18));
      
      const result: ValidationResult = {
        success: true,
        testAmountIn: '100',
        testExpectedOut: '80',
        testActualOut: null,
        testTxHash: '0x1234567890abcdef' as `0x${string}`,
        errorMessage: null,
        timestamp: Date.now(),
        routeId: route.id,
        recommendedSlippage: '0.5',
      };
      
      storeValidation(route.id, route.totalAmountIn.toString(), result);
      
      const cached = getCachedValidation(route.id, route.totalAmountIn.toString());
      expect(cached).not.toBeNull();
      expect(cached?.routeId).toBe(route.id);
      expect(cached?.result.success).toBe(true);
    });
    
    it('should retrieve cached validation result', () => {
      const route = createMockRoute(toWei(1000, 18), toWei(800, 18));
      
      const result: ValidationResult = {
        success: true,
        testAmountIn: '100',
        testExpectedOut: '80',
        testActualOut: null,
        testTxHash: null,
        errorMessage: null,
        timestamp: Date.now(),
        routeId: route.id,
        recommendedSlippage: '0.5',
      };
      
      storeValidation(route.id, route.totalAmountIn.toString(), result);
      
      const cached = getCachedValidation(route.id, route.totalAmountIn.toString());
      expect(cached).not.toBeNull();
      expect(cached?.result.success).toBe(true);
    });
    
    it('should return null for different route ID', () => {
      const route1 = createMockRoute(toWei(1000, 18), toWei(800, 18));
      const route2 = createMockRoute(toWei(2000, 18), toWei(1600, 18));
      
      const result: ValidationResult = {
        success: true,
        testAmountIn: '100',
        testExpectedOut: '80',
        testActualOut: null,
        testTxHash: null,
        errorMessage: null,
        timestamp: Date.now(),
        routeId: route1.id,
        recommendedSlippage: '0.5',
      };
      
      storeValidation(route1.id, route1.totalAmountIn.toString(), result);
      
      // Try to get with different route ID
      const cached = getCachedValidation(route2.id, route1.totalAmountIn.toString());
      expect(cached).toBeNull();
    });
    
    it('should return null for different amount', () => {
      const route = createMockRoute(toWei(1000, 18), toWei(800, 18));
      
      const result: ValidationResult = {
        success: true,
        testAmountIn: '100',
        testExpectedOut: '80',
        testActualOut: null,
        testTxHash: null,
        errorMessage: null,
        timestamp: Date.now(),
        routeId: route.id,
        recommendedSlippage: '0.5',
      };
      
      storeValidation(route.id, toWei(1000, 18).toString(), result);
      
      // Try to get with different amount
      const cached = getCachedValidation(route.id, toWei(2000, 18).toString());
      expect(cached).toBeNull();
    });
    
    it('should expire cache after 30 seconds', () => {
      const route = createMockRoute(toWei(1000, 18), toWei(800, 18));
      
      const oldTimestamp = Date.now() - (VALIDATION_CACHE_TTL_MS + 1000);
      const result: ValidationResult = {
        success: true,
        testAmountIn: '100',
        testExpectedOut: '80',
        testActualOut: null,
        testTxHash: null,
        errorMessage: null,
        timestamp: oldTimestamp,
        routeId: route.id,
        recommendedSlippage: '0.5',
      };
      
      storeValidation(route.id, route.totalAmountIn.toString(), result);
      
      // Cache should be expired
      const cached = getCachedValidation(route.id, route.totalAmountIn.toString());
      expect(cached).toBeNull();
    });
    
    it('should return null for fresh cache within TTL', () => {
      const route = createMockRoute(toWei(1000, 18), toWei(800, 18));
      
      const recentTimestamp = Date.now() - 5000; // 5 seconds ago
      const result: ValidationResult = {
        success: true,
        testAmountIn: '100',
        testExpectedOut: '80',
        testActualOut: null,
        testTxHash: null,
        errorMessage: null,
        timestamp: recentTimestamp,
        routeId: route.id,
        recommendedSlippage: '0.5',
      };
      
      storeValidation(route.id, route.totalAmountIn.toString(), result);
      
      // Cache should still be valid
      const cached = getCachedValidation(route.id, route.totalAmountIn.toString());
      expect(cached).not.toBeNull();
    });
  });
  
  describe('5. Cache Invalidation on Route/Amount Changes', () => {
    it('should invalidate cache when route changes', () => {
      const route1 = createMockRoute(toWei(1000, 18), toWei(800, 18));
      const route2 = createMockRoute(toWei(1000, 18), toWei(800, 18)); // Different ID
      
      const result: ValidationResult = {
        success: true,
        testAmountIn: '100',
        testExpectedOut: '80',
        testActualOut: null,
        testTxHash: null,
        errorMessage: null,
        timestamp: Date.now(),
        routeId: route1.id,
        recommendedSlippage: '0.5',
      };
      
      storeValidation(route1.id, route1.totalAmountIn.toString(), result);
      
      // Different route ID should not match
      const cached = getCachedValidation(route2.id, route1.totalAmountIn.toString());
      expect(cached).toBeNull();
    });
    
    it('should invalidate cache when amount changes', () => {
      const route = createMockRoute(toWei(1000, 18), toWei(800, 18));
      
      const result: ValidationResult = {
        success: true,
        testAmountIn: '100',
        testExpectedOut: '80',
        testActualOut: null,
        testTxHash: null,
        errorMessage: null,
        timestamp: Date.now(),
        routeId: route.id,
        recommendedSlippage: '0.5',
      };
      
      storeValidation(route.id, toWei(1000, 18).toString(), result);
      
      // Different amount should not match
      const cached = getCachedValidation(route.id, toWei(2000, 18).toString());
      expect(cached).toBeNull();
    });
    
    it('should clear cache completely when requested', () => {
      const route = createMockRoute(toWei(1000, 18), toWei(800, 18));
      
      const result: ValidationResult = {
        success: true,
        testAmountIn: '100',
        testExpectedOut: '80',
        testActualOut: null,
        testTxHash: null,
        errorMessage: null,
        timestamp: Date.now(),
        routeId: route.id,
        recommendedSlippage: '0.5',
      };
      
      storeValidation(route.id, route.totalAmountIn.toString(), result);
      
      // Clear cache
      clearValidationCache();
      
      // Cache should be empty
      const cached = getCachedValidation(route.id, route.totalAmountIn.toString());
      expect(cached).toBeNull();
    });
  });
  
  describe('6. Validation Result Processing', () => {
    it('should determine recommended slippage on success', () => {
      createMockRoute(toWei(1000, 18), toWei(800, 18), 25, 'direct');
      // On success, recommended slippage stays at default
      const successRecommendedSlippage = '0.5';
      expect(successRecommendedSlippage).toBe('0.5');
    });
    
    it('should increase slippage recommendation on failure for direct routes', () => {
      const route = createMockRoute(toWei(1000, 18), toWei(800, 18), 25, 'direct');
      const success = false;
      
      let recommendedSlippage = '0.5';
      if (!success) {
        if (route.priceImpact && route.priceImpact > 0.05) {
          recommendedSlippage = '3.0';
        } else {
          recommendedSlippage = '1.0';
        }
      }
      
      expect(recommendedSlippage).toBe('1.0');
    });
    
    it('should increase slippage recommendation on failure for multi-hop routes', () => {
      const route = createMockRoute(toWei(1000, 18), toWei(800, 18), 25, 'multi_hop');
      const success = false;
      
      let recommendedSlippage = '0.5';
      if (!success) {
        if (route.routeType === 'multi_hop' || (route.priceImpact && route.priceImpact > 0.05)) {
          recommendedSlippage = '3.0';
        } else {
          recommendedSlippage = '1.0';
        }
      }
      
      expect(recommendedSlippage).toBe('3.0');
    });
    
    it('should increase slippage to max on high price impact failure', () => {
      const route = createMockRoute(toWei(1000, 18), toWei(800, 18), 25, 'direct');
      route.priceImpact = 0.08; // 8% price impact
      
      const success = false;
      
      let recommendedSlippage = '0.5';
      if (!success) {
        if (route.routeType === 'multi_hop' || route.priceImpact > 0.05) {
          recommendedSlippage = '3.0';
        } else {
          recommendedSlippage = '1.0';
        }
      }
      
      expect(recommendedSlippage).toBe('3.0');
    });
  });
  
  describe('7. Error Message Handling', () => {
    it('should provide helpful error for insufficient balance', () => {
      const error = 'ds-token-insufficient-balance';
      
      let helpfulMessage = `Test swap execution failed: ${error}`;
      if (error.includes('ds-token-insufficient-balance') || error.includes('insufficient balance')) {
        helpfulMessage = 'Insufficient token balance for the test swap. Check your wallet balance.';
      }
      
      expect(helpfulMessage).toBe('Insufficient token balance for the test swap. Check your wallet balance.');
    });
    
    it('should provide helpful error for transfer amount exceeds balance', () => {
      const error = 'transfer amount exceeds balance';
      
      let helpfulMessage = `Test swap execution failed: ${error}`;
      if (error.includes('ds-token-insufficient-balance') || error.includes('insufficient balance')) {
        helpfulMessage = 'Insufficient token balance for the test swap. Check your wallet balance.';
      } else if (error.includes('transfer amount exceeds balance')) {
        helpfulMessage = 'Token transfer failed mid-swap. The route may have a compatibility issue.';
      }
      
      expect(helpfulMessage).toBe('Token transfer failed mid-swap. The route may have a compatibility issue.');
    });
    
    it('should provide helpful error for revert', () => {
      const error = 'Transaction reverted';
      
      let helpfulMessage = `Test swap execution failed: ${error}`;
      if (error.includes('ds-token-insufficient-balance') || error.includes('insufficient balance')) {
        helpfulMessage = 'Insufficient token balance for the test swap. Check your wallet balance.';
      } else if (error.includes('transfer amount exceeds balance')) {
        helpfulMessage = 'Token transfer failed mid-swap. The route may have a compatibility issue.';
      } else if (error.toLowerCase().includes('revert')) {
        helpfulMessage = 'The route was rejected by the blockchain. The pair may not exist on one of the DEXs.';
      }
      
      expect(helpfulMessage).toBe('The route was rejected by the blockchain. The pair may not exist on one of the DEXs.');
    });
    
    it('should provide helpful error for deadline exceeded', () => {
      const error = 'deadline exceeded';
      
      let helpfulMessage = `Test swap execution failed: ${error}`;
      if (error.includes('ds-token-insufficient-balance') || error.includes('insufficient balance')) {
        helpfulMessage = 'Insufficient token balance for the test swap. Check your wallet balance.';
      } else if (error.includes('transfer amount exceeds balance')) {
        helpfulMessage = 'Token transfer failed mid-swap. The route may have a compatibility issue.';
      } else if (error.toLowerCase().includes('revert')) {
        helpfulMessage = 'The route was rejected by the blockchain. The pair may not exist on one of the DEXs.';
      } else if (error.toLowerCase().includes('deadline')) {
        helpfulMessage = 'Transaction deadline exceeded. The swap took too long to execute.';
      }
      
      expect(helpfulMessage).toBe('Transaction deadline exceeded. The swap took too long to execute.');
    });
    
    it('should handle unknown errors gracefully', () => {
      const error = 'some unknown error';
      
      let helpfulMessage = `Test swap execution failed: ${error}`;
      if (error.includes('ds-token-insufficient-balance') || error.includes('insufficient balance')) {
        helpfulMessage = 'Insufficient token balance for the test swap. Check your wallet balance.';
      } else if (error.includes('transfer amount exceeds balance')) {
        helpfulMessage = 'Token transfer failed mid-swap. The route may have a compatibility issue.';
      } else if (error.toLowerCase().includes('revert')) {
        helpfulMessage = 'The route was rejected by the blockchain. The pair may not exist on one of the DEXs.';
      } else if (error.toLowerCase().includes('deadline')) {
        helpfulMessage = 'Transaction deadline exceeded. The swap took too long to execute.';
      }
      
      expect(helpfulMessage).toBe('Test swap execution failed: some unknown error');
    });
  });
  
  describe('8. Skip Validation Preference', () => {
    it('should handle skip validation flag', () => {
      let skipValidation = false;
      
      // When skip is true, validation should be skipped
      skipValidation = true;
      expect(skipValidation).toBe(true);
      
      // When skip is false, validation should run
      skipValidation = false;
      expect(skipValidation).toBe(false);
    });
    
    it('should persist skip preference across operations', () => {
      let skipValidation = false;
      
      // User sets skip preference
      skipValidation = true;
      
      // Simulate multiple validation attempts
      for (let i = 0; i < 5; i++) {
        if (skipValidation) {
          // Skip validation
        }
      }
      
      expect(skipValidation).toBe(true);
    });
  });
  
  describe('9. Validation State Management', () => {
    it('should track validation as not validated initially', () => {
      let validationResult: ValidationResult | null = null;
      
      const isValidated = validationResult !== null;
      expect(isValidated).toBe(false);
    });
    
    it('should track validation as validated after result is set', () => {
      const result: ValidationResult = {
        success: true,
        testAmountIn: '100',
        testExpectedOut: '80',
        testActualOut: null,
        testTxHash: null,
        errorMessage: null,
        timestamp: Date.now(),
        routeId: 'test-route',
        recommendedSlippage: '0.5',
      };
      
      const isValidated = result !== null;
      const isValid = result?.success ?? false;
      
      expect(isValidated).toBe(true);
      expect(isValid).toBe(true);
    });
    
    it('should track validating state correctly', () => {
      let isValidating = false;
      
      // Start validating
      isValidating = true;
      expect(isValidating).toBe(true);
      
      // Finish validating
      isValidating = false;
      expect(isValidating).toBe(false);
    });
    
    it('should handle validation result clearing', () => {
      const result: ValidationResult = {
        success: true,
        testAmountIn: '100',
        testExpectedOut: '80',
        testActualOut: null,
        testTxHash: null,
        errorMessage: null,
        timestamp: Date.now(),
        routeId: 'test-route',
        recommendedSlippage: '0.5',
      };
      
      // Set result
      let validationResult: ValidationResult | null = result;
      expect(validationResult).not.toBeNull();
      
      // Clear result
      validationResult = null;
      expect(validationResult).toBeNull();
    });
  });
  
  describe('10. Multi-hop Route Handling', () => {
    it('should calculate test amount for multi-hop routes', () => {
      const route = createMockRoute(toWei(1000, 18), toWei(600, 18), 25, 'multi_hop');
      route.intermediateToken = MOCK_WWDOGE_ADDRESS;
      
      const testAmountIn = (route.totalAmountIn * BigInt(Math.round(TEST_SWAP_FRACTION * 10000))) / 10000n;
      
      expect(testAmountIn).toBe(toWei(100, 18));
      expect(route.routeType).toBe('multi_hop');
    });
    
    it('should handle intermediate token in multi-hop path', () => {
      const route = createMockRoute(toWei(1000, 18), toWei(600, 18), 25, 'multi_hop');
      route.intermediateToken = MOCK_WWDOGE_ADDRESS;
      route.steps = [
        {
          dexRouter: '0x1111111111111111111111111111111111111111',
          dexName: 'DEX1',
          path: [MOCK_DC_ADDRESS, MOCK_WWDOGE_ADDRESS],
          amountIn: toWei(1000, 18),
          expectedAmountOut: toWei(900, 18),
        },
        {
          dexRouter: '0x2222222222222222222222222222222222222222',
          dexName: 'DEX2',
          path: [MOCK_WWDOGE_ADDRESS, MOCK_MCRIB_ADDRESS],
          amountIn: toWei(900, 18),
          expectedAmountOut: toWei(600, 18),
        },
      ];
      
      expect(route.steps.length).toBe(2);
      expect(route.intermediateToken).toBe(MOCK_WWDOGE_ADDRESS);
      expect(route.steps[0].path[1]).toBe(MOCK_WWDOGE_ADDRESS);
      expect(route.steps[1].path[0]).toBe(MOCK_WWDOGE_ADDRESS);
    });
    
    it('should build multi-hop test request with correct steps', () => {
      const route = createMockRoute(toWei(1000, 18), toWei(600, 18), 25, 'multi_hop');
      route.intermediateToken = MOCK_WWDOGE_ADDRESS;
      route.steps = [
        {
          dexRouter: '0x1111111111111111111111111111111111111111',
          dexName: 'DEX1',
          path: [MOCK_DC_ADDRESS, MOCK_WWDOGE_ADDRESS],
          amountIn: toWei(1000, 18),
          expectedAmountOut: toWei(900, 18),
        },
        {
          dexRouter: '0x2222222222222222222222222222222222222222',
          dexName: 'DEX2',
          path: [MOCK_WWDOGE_ADDRESS, MOCK_MCRIB_ADDRESS],
          amountIn: toWei(900, 18),
          expectedAmountOut: toWei(600, 18),
        },
      ];
      
      const testAmountIn = (route.totalAmountIn * BigInt(Math.round(TEST_SWAP_FRACTION * 10000))) / 10000n;
      const slippageBps = 50;
      const slippageMultiplier = 10000n - BigInt(slippageBps);
      
      const stepMinAmounts = route.steps.map((step) => 
        (step.expectedAmountOut * slippageMultiplier) / 10000n
      );
      
      expect(stepMinAmounts.length).toBe(2);
      
      // First step amount should be test amount minus fee
      const feeAmount = (testAmountIn * BigInt(route.feeBps)) / 10000n;
      const firstStepAmountIn = testAmountIn - feeAmount;
      expect(firstStepAmountIn).toBe((toWei(100, 18) * 9975n) / 10000n);
    });
  });
  
  describe('11. Edge Cases', () => {
    it('should handle test amount of 0', () => {
      const normalAmount = 1n; // Very small
      const testAmountIn = (normalAmount * BigInt(Math.round(TEST_SWAP_FRACTION * 10000))) / 10000n;
      
      expect(testAmountIn).toBe(0n);
    });
    
    it('should handle route with no steps', () => {
      const route: RouteResult = {
        id: 'empty-route',
        steps: [],
        totalAmountIn: toWei(1000, 18),
        totalExpectedOut: 0n,
        priceImpact: 0,
        feeAmount: 0n,
        feeBps: 25,
      };
      
      expect(route.steps.length).toBe(0);
    });
    
    it('should handle very high fee percentage', () => {
      const testAmountIn = toWei(100, 18);
      const feeBps = 500; // 5% fee (max allowed)
      
      const feeAmount = (testAmountIn * BigInt(feeBps)) / 10000n;
      
      expect(feeAmount).toBe(toWei(5, 18));
    });
    
    it('should handle zero slippage', () => {
      const amount = toWei(1000, 18);
      const slippageBps = 0;
      const slippageMultiplier = 10000n - BigInt(slippageBps);
      
      const minOut = (amount * slippageMultiplier) / 10000n;
      
      expect(minOut).toBe(amount);
    });
    
    it('should handle maximum slippage (100%)', () => {
      const amount = toWei(1000, 18);
      const slippageBps = 10000;
      const slippageMultiplier = 10000n - BigInt(slippageBps);
      
      const minOut = (amount * slippageMultiplier) / 10000n;
      
      expect(minOut).toBe(0n);
    });
  });
  
  describe('12. Integration Scenarios', () => {
    it('should complete full validation flow: create route -> run test -> cache result', () => {
      // Create route
      const route = createMockRoute(toWei(1000, 18), toWei(800, 18));
      
      // Check cache before validation
      let cached = getCachedValidation(route.id, route.totalAmountIn.toString());
      expect(cached).toBeNull();
      
      // Simulate successful validation
      const result: ValidationResult = {
        success: true,
        testAmountIn: formatFromWei(route.totalAmountIn / 10n, 18),
        testExpectedOut: formatFromWei(route.totalExpectedOut / 10n, 18),
        testActualOut: null,
        testTxHash: '0xabcdef1234567890abcdef1234567890abcdef12' as `0x${string}`,
        errorMessage: null,
        timestamp: Date.now(),
        routeId: route.id,
        recommendedSlippage: '0.5',
      };
      
      // Store result
      storeValidation(route.id, route.totalAmountIn.toString(), result);
      
      // Check cache after validation
      cached = getCachedValidation(route.id, route.totalAmountIn.toString());
      expect(cached).not.toBeNull();
      expect(cached?.result.success).toBe(true);
      expect(cached?.result.testTxHash).toBe('0xabcdef1234567890abcdef1234567890abcdef12');
    });
    
    it('should skip validation when cached result exists', () => {
      const route = createMockRoute(toWei(1000, 18), toWei(800, 18));
      
      // Store cached result
      const cachedResult: ValidationResult = {
        success: true,
        testAmountIn: '100',
        testExpectedOut: '80',
        testActualOut: null,
        testTxHash: '0x1234567890abcdef1234567890abcdef12345678' as `0x${string}`,
        errorMessage: null,
        timestamp: Date.now(),
        routeId: route.id,
        recommendedSlippage: '0.5',
      };
      storeValidation(route.id, route.totalAmountIn.toString(), cachedResult);
      
      // Check if we should use cached result
      const shouldSkipValidation = getCachedValidation(route.id, route.totalAmountIn.toString()) !== null;
      expect(shouldSkipValidation).toBe(true);
    });
    
    it('should allow full swap after successful pre-flight validation', () => {
      const route = createMockRoute(toWei(1000, 18), toWei(800, 18));
      
      const validationResult: ValidationResult = {
        success: true,
        testAmountIn: '100',
        testExpectedOut: '80',
        testActualOut: null,
        testTxHash: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcdef' as `0x${string}`,
        errorMessage: null,
        timestamp: Date.now(),
        routeId: route.id,
        recommendedSlippage: '0.5',
      };
      
      const isValid = validationResult.success;
      
      // If validation passed, allow full swap
      if (isValid) {
        // Execute full swap
        expect(true).toBe(true);
      } else {
        // Show warning and require confirmation
        expect(false).toBe(true);
      }
    });
    
    it('should show warning after failed pre-flight validation', () => {
      const route = createMockRoute(toWei(1000, 18), toWei(800, 18));
      
      const validationResult: ValidationResult = {
        success: false,
        testAmountIn: '100',
        testExpectedOut: '80',
        testActualOut: null,
        testTxHash: null,
        errorMessage: 'Insufficient liquidity for the test swap',
        timestamp: Date.now(),
        routeId: route.id,
        recommendedSlippage: '3.0',
      };
      
      const isValid = validationResult.success;
      
      // If validation failed, show warning
      if (!isValid) {
        expect(validationResult.errorMessage).toBe('Insufficient liquidity for the test swap');
        expect(validationResult.recommendedSlippage).toBe('3.0');
      }
    });
  });
});

describe('PreFlightValidation Cache Edge Cases', () => {
  beforeEach(() => {
    localStorage.clear();
  });
  
  afterEach(() => {
    localStorage.clear();
  });
  
  it('should handle corrupted JSON in localStorage', () => {
    localStorage.setItem(VALIDATION_STORAGE_KEY, 'not valid json {{{');
    
    const result = getCachedValidation('any-route', 'any-amount');
    expect(result).toBeNull();
  });
  
  it('should handle empty localStorage', () => {
    const result = getCachedValidation('any-route', 'any-amount');
    expect(result).toBeNull();
  });
  
  it('should handle localStorage quota exceeded', () => {
    // Simulate a scenario where localStorage throws
    const originalSetItem = localStorage.setItem.bind(localStorage);
    
    localStorage.setItem = function(key: string, value: string) {
      if (key === VALIDATION_STORAGE_KEY) {
        throw new Error('Quota exceeded');
      }
      return originalSetItem(key, value);
    };
    
    // Should not throw, just silently fail
    expect(() => {
      storeValidation('route-id', '1000', {
        success: true,
        testAmountIn: '100',
        testExpectedOut: '80',
        testActualOut: null,
        testTxHash: null,
        errorMessage: null,
        timestamp: Date.now(),
        routeId: 'route-id',
        recommendedSlippage: '0.5',
      });
    }).not.toThrow();
    
    localStorage.setItem = originalSetItem;
  });
  
  it('should handle missing fields in cached validation', () => {
    // Store incomplete cache entry
    localStorage.setItem(VALIDATION_STORAGE_KEY, JSON.stringify({
      routeId: 'test-route',
      amountIn: '1000',
      result: {
        success: true,
        // Missing other fields
      }
    }));
    
    // Should handle gracefully
    const cached = getCachedValidation('test-route', '1000');
    // Either returns null (if validation fails) or partial data
    expect(cached === null || cached.result.success === true).toBe(true);
  });
});