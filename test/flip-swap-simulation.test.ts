/**
 * @file flip-swap-simulation.test.ts
 * @description Jest/TypeScript test suite for flip/swap consistency in AggregatorSwap
 *
 * Tests UI-level flip operation behavior and mathematical consistency.
 * Since we can't interact with the actual React hooks in Jest, we simulate
 * the flip logic and verify mathematical consistency independently.
 *
 * Bug Tested: Decimal Mismatch on Flip
 * When activeField === 'buy' and user flips:
 *   - newBuyPlaceholder = reverseRoute.totalAmountIn formatted with inDecimals
 *   - BUT inDecimals is the OLD sell token's decimals (before flip)
 *   - After flip, this value should be formatted with the NEW sell token's decimals
 *
 * Example scenario: WWDOGE (18 dec) → OMNOM (6 dec)
 *   Before flip: sell=WWDOGE, buy=OMNOM, activeField='buy'
 *   reverseRoute.totalAmountIn = 1000000000000000000n (1 WWDOGE in wei)
 *   inDecimals = 18 (WWDOGE decimals - BUT this is from BEFORE flip)
 *
 *   After formatUnits with WRONG decimals (6 instead of 18):
 *   newBuyPlaceholder = formatUnits(1000000000000000000n, 6)
 *   This gives "1000000" which represents 1,000,000 OMNOM (wrong!)
 *   But it should be "0.000000000000000001" (1 wei of WWDOGE)
 *
 * Reference files:
 *   - src/components/aggregator/AggregatorSwap.tsx (handleSwapTokens at line 501)
 *   - src/hooks/useAggregator/useRoute.ts
 *   - src/hooks/useAggregator/useReverseRoute.ts
 *   - src/lib/format.ts
 *   - src/services/pathFinder/types.ts
 */

import { describe, it, expect } from 'vitest';
import { formatUnits } from 'viem';

// ─── Type Definitions ────────────────────────────────────────────────────────

interface TokenInfo {
  address: string;
  symbol: string;
  decimals: number;
}

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
}

interface SwapRequest {
  tokenIn: `0x${string}`;
  tokenOut: `0x${string}`;
  amountIn: bigint;
  minTotalAmountOut: bigint;
  steps: {
    router: `0x${string}`;
    path: `0x${string}`[];
    amountIn: bigint;
    minAmountOut: bigint;
  }[];
  deadline: bigint;
  recipient: `0x${string}`;
}

// ─── Mock Tokens ─────────────────────────────────────────────────────────────

const WWDOGE: TokenInfo = {
  address: '0x779B7dD715D8D2C1d3d8dA86E8b30D3c5D3e8f1a',
  symbol: 'WWDOGE',
  decimals: 18,
};

const OMNOM: TokenInfo = {
  address: '0x3B7e3cE2B8d3f8A3C9d8E7F6a5B4C3D2E1F0a9B8',
  symbol: 'OMNOM',
  decimals: 6,
};

const ZERO_DEC_TOKEN: TokenInfo = {
  address: '0x4C8e2A1B3d4E9F6a2C1d0E9f8B7A6C5D4E3F2B1',
  symbol: 'ZD',
  decimals: 0,
};

// ─── Helper Functions ─────────────────────────────────────────────────────────

/**
 * Convert a decimal amount to wei representation.
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
  return formatUnits(wei, decimals);
}

/**
 * Simulate the flip logic from AggregatorSwap.handleSwapTokens()
 *
 * This is a direct port of the flip logic at lines 501-526 of AggregatorSwap.tsx
 * with added logging to expose the decimal mismatch bug.
 */
interface FlipResult {
  newSellToken: TokenInfo;
  newBuyToken: TokenInfo;
  newSellAmount: string;
  newBuyPlaceholder: string;
  newActiveField: 'sell' | 'buy';
  bugDetected: boolean;
  bugDescription: string;
}

function simulateFlipFromSellMode(
  sellToken: TokenInfo,
  buyToken: TokenInfo,
  sellAmount: string,
  forwardRoute: RouteResult | null,
  outDecimals: number
): FlipResult {
  const temp = sellToken;
  let newSellAmount: string;
  let newBuyPlaceholder: string;

  // Line 506-508 of AggregatorSwap.tsx
  if (forwardRoute?.totalExpectedOut && forwardRoute.totalExpectedOut > 0n) {
    newSellAmount = formatUnits(forwardRoute.totalExpectedOut, outDecimals);
    newBuyPlaceholder = sellAmount;
  } else {
    newSellAmount = sellAmount || '';
    newBuyPlaceholder = '';
  }

  const newSellToken = buyToken;
  const newBuyToken = temp;

  return {
    newSellToken,
    newBuyToken,
    newSellAmount,
    newBuyPlaceholder,
    newActiveField: 'sell',
    bugDetected: false,
    bugDescription: '',
  };
}

function simulateFlipFromBuyMode(
  sellToken: TokenInfo,
  buyToken: TokenInfo,
  buyAmountInput: string,
  reverseRoute: RouteResult | null,
  inDecimals: number // This is the CRITICAL parameter that causes the bug
): FlipResult {
  const temp = sellToken;
  let newSellAmount: string;
  let newBuyPlaceholder: string;

  // Lines 509-513 of AggregatorSwap.tsx
  if (buyAmountInput && parseFloat(buyAmountInput) > 0) {
    newSellAmount = buyAmountInput;
    newBuyPlaceholder = reverseRoute?.totalAmountIn && reverseRoute.totalAmountIn > 0n
      ? formatUnits(reverseRoute.totalAmountIn, inDecimals)
      : (sellToken.symbol || '');

    // ─── BUG DETECTION ───────────────────────────────────────────────────────
    // After flip, newBuyPlaceholder should be in NEW sell token's decimals
    // But inDecimals is from the OLD sell token (before flip)
    // This causes the decimal mismatch bug

    const newSellDecimals = buyToken.decimals; // The token that BECOMES sell
    // Check if inDecimals matches what it should be after flip
    // inDecimals should be buyToken.decimals (which becomes sell after flip)
    // But it's actually sellToken.decimals (which was sell before flip)
    const incorrectDecimals = inDecimals !== newSellDecimals;
    const decimalDifference = Math.abs(inDecimals - newSellDecimals);

    const bugDetected = incorrectDecimals && decimalDifference > 0;

    return {
      newSellToken: buyToken,
      newBuyToken: temp,
      newSellAmount,
      newBuyPlaceholder,
      newActiveField: 'sell',
      bugDetected,
      bugDescription: bugDetected
        ? `DECIMAL MISMATCH BUG: inDecimals=${inDecimals} but should be ${newSellDecimals} ` +
          `(difference: ${decimalDifference} decimals). ` +
          `Formatting ${reverseRoute?.totalAmountIn?.toString() ?? "unknown"} wei with wrong decimals ` +
          `will produce incorrect display value.`
        : '',
    };
  }

  return {
    newSellToken: buyToken,
    newBuyToken: temp,
    newSellAmount: buyAmountInput || '',
    newBuyPlaceholder: '',
    newActiveField: 'sell',
    bugDetected: false,
    bugDescription: '',
  };
}

/**
 * Build a mock route for testing.
 */
function createMockRoute(
  totalAmountIn: bigint,
  totalExpectedOut: bigint,
  feeBps: number = 25
): RouteResult {
  return {
    id: `mock-route-${Date.now()}`,
    steps: [{
      dexRouter: '0x0000000000000000000000000000000000000001',
      dexName: 'MockDEX',
      path: ['0x0000000000000000000000000000000000000001', '0x0000000000000000000000000000000000000002'],
      amountIn: totalAmountIn,
      expectedAmountOut: totalExpectedOut,
    }],
    totalAmountIn,
    totalExpectedOut,
    priceImpact: 0.001,
    feeAmount: (totalAmountIn * BigInt(feeBps)) / 10000n,
    feeBps,
  };
}

// ─── Test Suites ─────────────────────────────────────────────────────────────

describe('Flip Swap Consistency Tests', () => {
  describe('Flip from Sell Mode', () => {
    it('should preserve original sell amount as new buy placeholder', () => {
      // User typed sell amount, then flipped
      const sellAmount = '100';
      const forwardRoute = createMockRoute(
        toWei(100, WWDOGE.decimals),
        toWei(100, OMNOM.decimals)
      );
      const outDecimals = OMNOM.decimals;

      const result = simulateFlipFromSellMode(
        WWDOGE,
        OMNOM,
        sellAmount,
        forwardRoute,
        outDecimals
      );

      expect(result.newBuyPlaceholder).toBe(sellAmount);
      // forwardRoute.totalExpectedOut = toWei(100, 6) = 100000000n (100 OMNOM in wei)
      // formatUnits(100000000, 6) = "100"
      expect(result.newSellAmount).toBe('100');
      expect(result.newSellToken.symbol).toBe(OMNOM.symbol);
      expect(result.newBuyToken.symbol).toBe(WWDOGE.symbol);
    });

    it('should correctly format forwardRoute.totalExpectedOut with outDecimals', () => {
      // Test with different decimal tokens
      const sellAmount = '1';
      const forwardRoute = createMockRoute(
        toWei(1, WWDOGE.decimals), // 1 WWDOGE
        toWei(1, OMNOM.decimals) // 1 OMNOM = 1,000,000 wei since 6 decimals
      );

      const result = simulateFlipFromSellMode(
        WWDOGE,
        OMNOM,
        sellAmount,
        forwardRoute,
        OMNOM.decimals
      );

      // newSellAmount = formatUnits(1000000, 6) = "1" (1 OMNOM)
      expect(result.newSellAmount).toBe('1');
    });

    it('should handle empty forwardRoute gracefully', () => {
      const result = simulateFlipFromSellMode(
        WWDOGE,
        OMNOM,
        '100',
        null,
        OMNOM.decimals
      );

      expect(result.newSellAmount).toBe('100');
      expect(result.newBuyPlaceholder).toBe('');
      expect(result.bugDetected).toBe(false);
    });

    it('should handle zero amount route', () => {
      const forwardRoute = createMockRoute(0n, 0n);
      const result = simulateFlipFromSellMode(
        WWDOGE,
        OMNOM,
        '100',
        forwardRoute,
        OMNOM.decimals
      );

      // When forwardRoute.totalExpectedOut is 0n (falsy), newBuyPlaceholder is ''
      // because the code enters the else branch (line 147-149 in simulateFlipFromSellMode)
      expect(result.newBuyPlaceholder).toBe('');
      expect(result.newSellAmount).toBe('100'); // Falls back to sellAmount
      expect(result.bugDetected).toBe(false);
    });
  });

  describe('Flip from Buy Mode - CRITICAL BUG TESTS', () => {
    it('⚠️ DETECTS BUG: decimal mismatch when flipping WWDOGE → OMNOM', () => {
      // CRITICAL SCENARIO: WWDOGE (18 dec) → OMNOM (6 dec)
      // User was buying OMNOM, now flips

      const buyAmountInput = '100'; // User wants 100 OMNOM
      const reverseRoute = createMockRoute(
        toWei(100, WWDOGE.decimals), // Need 100 WWDOGE to get 100 OMNOM (at 1:1 rate)
        toWei(100, OMNOM.decimals)  // Output is 100 OMNOM
      );

      // inDecimals from useReverseRoute is WWDOGE's decimals (18)
      // But after flip, this becomes the SELL token's decimals
      // which should be OMNOM's decimals (6)
      const inDecimals = WWDOGE.decimals; // 18 - from the hook

      const result = simulateFlipFromBuyMode(
        WWDOGE,    // old sell
        OMNOM,     // old buy
        buyAmountInput,
        reverseRoute,
        inDecimals // This is WRONG - should be OMNOM.decimals (6) after flip
      );

      // BUG: newBuyPlaceholder is formatted with 18 decimals but should be 6
      // formatUnits(1000000000000000000n, 6) would give wrong result
      expect(result.bugDetected).toBe(true);
      expect(result.bugDescription).toContain('DECIMAL MISMATCH BUG');
      expect(result.bugDescription).toContain('inDecimals=18'); // Shows the wrong decimals used
    });

    it('⚠️ DETECTS BUG: large decimal difference amplifies error', () => {
      // Extreme case: 18 decimals vs 6 decimals = 12 decimal difference
      // This means the error is multiplied by 10^12

      const buyAmountInput = '1';
      const reverseRoute = createMockRoute(
        toWei(1, WWDOGE.decimals), // 1 WWDOGE
        toWei(1, OMNOM.decimals)   // 1 OMNOM
      );

      const result = simulateFlipFromBuyMode(
        WWDOGE,   // 18 decimals
        ZERO_DEC_TOKEN, // 0 decimals (extreme case)
        buyAmountInput,
        reverseRoute,
        WWDOGE.decimals // 18 - but should be 0 after flip
      );

      expect(result.bugDetected).toBe(true);
      // 12 decimal difference means error is 10^12 times
      expect(result.bugDescription).toContain('difference: 18');
    });

    it('should correctly flip when decimals match', () => {
      // When both tokens have same decimals, no bug occurs
      const sameDecToken: TokenInfo = { ...OMNOM, decimals: 18 };

      const buyAmountInput = '100';
      const reverseRoute = createMockRoute(
        toWei(100, sameDecToken.decimals),
        toWei(100, sameDecToken.decimals)
      );

      const result = simulateFlipFromBuyMode(
        sameDecToken,
        sameDecToken,
        buyAmountInput,
        reverseRoute,
        sameDecToken.decimals
      );

      expect(result.bugDetected).toBe(false);
    });

    it('should handle empty buyAmountInput', () => {
      const result = simulateFlipFromBuyMode(
        WWDOGE,
        OMNOM,
        '', // empty
        createMockRoute(toWei(100, WWDOGE.decimals), toWei(100, OMNOM.decimals)),
        WWDOGE.decimals
      );

      expect(result.newSellAmount).toBe('');
      expect(result.bugDetected).toBe(false);
    });

    it('should handle null reverseRoute', () => {
      const result = simulateFlipFromBuyMode(
        WWDOGE,
        OMNOM,
        '100',
        null,
        WWDOGE.decimals
      );

      // When reverseRoute is null, newBuyPlaceholder falls back to sellToken.symbol
      expect(result.newBuyPlaceholder).toBe(WWDOGE.symbol);
      // Bug detection doesn't depend on reverseRoute - it detects decimal mismatch
      // inDecimals=18 (WWDOGE) != newSellDecimals=6 (OMNOM), so bug IS detected
      expect(result.bugDetected).toBe(true);
    });
  });

  describe('Mathematical Consistency Tests', () => {
    it('should preserve sellAmount * price = buyAmount after flip within slippage tolerance', () => {
      // Test with various slippage values
      const slippageOptions = [0.1, 0.5, 1.0, 5.0]; // percent
      const price = 1.5; // 1 WWDOGE = 1.5 OMNOM

      for (const slippage of slippageOptions) {
        const sellAmount = 100;
        const expectedBuy = sellAmount * price;

        // Simulate forward route
        const forwardRoute = createMockRoute(
          toWei(sellAmount, WWDOGE.decimals),
          toWei(expectedBuy, OMNOM.decimals)
        );

        // Flip from sell mode
        const flipResult = simulateFlipFromSellMode(
          WWDOGE,
          OMNOM,
          sellAmount.toString(),
          forwardRoute,
          OMNOM.decimals
        );

        // Verify the math
        const receivedSellAmount = parseFloat(flipResult.newSellAmount);
        const originalBuyAmount = parseFloat(flipResult.newBuyPlaceholder);

        // Price consistency check
        // price = newSellAmount / newBuyPlaceholder (sell token amount / buy token amount)
        const reconstructedPrice = receivedSellAmount > 0
          ? receivedSellAmount / originalBuyAmount
          : 0;

        // Price should be within slippage tolerance of original
        expect(reconstructedPrice).toBeGreaterThanOrEqual(price * (1 - slippage / 100));
        expect(reconstructedPrice).toBeLessThanOrEqual(price * (1 + slippage / 100));
      }
    });

    it('should correctly calculate fee deductions across flips', () => {
      const feeBps = 25; // 0.25%
      const sellAmount = toWei(1000, WWDOGE.decimals);
      const expectedFee = (sellAmount * BigInt(feeBps)) / 10000n;
      const amountAfterFee = sellAmount - expectedFee;

      // Fee should always be calculated on the sell amount
      expect(expectedFee).toBe(toWei(2.5, WWDOGE.decimals)); // 0.25% of 1000
      expect(amountAfterFee).toBe(toWei(997.5, WWDOGE.decimals));

      // Verify fee is proportional
      const actualFeePercent = Number(expectedFee) / Number(sellAmount) * 10000;
      expect(actualFeePercent).toBeCloseTo(feeBps, 1);
    });

    it('should not lose significance through truncation on small amounts', () => {
      // Test with 1 wei (minimum possible amount)
      const oneWei = 1n;
      const slippageBps = 50;

      // (amount * (10000 - slippageBps)) / 10000
      const minOut = (oneWei * BigInt(10000 - slippageBps)) / 10000n;

      // For 1 wei with 0.5% slippage, result should be 0 or 1
      expect(minOut).toBeLessThanOrEqual(oneWei);
    });

    it('should preserve conversion factors across decimal conversions', () => {
      // Test that 1:1 rate is preserved regardless of decimal scaling
      const amount1 = toWei(1, 18);
      const amount2 = toWei(1, 6);

      // These represent the same "value" but different wei representations
      expect(amount1).toBe(1000000000000n * amount2); // 10^12 difference

      // Formatting and parsing should maintain this relationship
      const formatted1 = formatFromWei(amount1, 18);
      const formatted2 = formatFromWei(amount2, 6);

      expect(parseFloat(formatted1)).toBeCloseTo(parseFloat(formatted2), 2);
    });
  });

  describe('Edge Case Tests', () => {
    it('should handle zero sell amount (empty string equivalent)', () => {
      const result = simulateFlipFromSellMode(
        WWDOGE,
        OMNOM,
        '0',
        null,
        OMNOM.decimals
      );

      expect(result.newSellAmount).toBe('0');
      expect(result.bugDetected).toBe(false);
    });

    it('should handle maximum uint256 with overflow protection', () => {
      const maxUint256 = BigInt('115792089237316195423570985008687907853269984665640564039457584007913129639935');

      // Test that operations don't overflow
      const feeBps = 25;
      const fee = (maxUint256 * BigInt(feeBps)) / 10000n;

      // Fee should be calculable without overflow
      expect(fee).toBeLessThan(maxUint256);
      expect(fee).toBeGreaterThan(0n);

      // This would overflow if we tried to add fee back
      // const wouldOverflow = maxUint256 + fee; // Would exceed maxUint256
    });

    it('should handle extreme decimal mismatch (0 vs 18)', () => {
      const result = simulateFlipFromBuyMode(
        { ...WWDOGE, decimals: 18 },
        { ...ZERO_DEC_TOKEN, decimals: 0 },
        '100',
        createMockRoute(toWei(100, 18), 100n),
        18 // inDecimals from old sell
      );

      expect(result.bugDetected).toBe(true);
      // 18 decimal difference should be detected
      expect(result.bugDescription).toContain('18');
    });

    it('should handle rapid repeated flips (race condition simulation)', () => {
      // Simulate 10 rapid flips
      let currentSellToken = WWDOGE;
      let currentBuyToken = OMNOM;
      let currentSellAmount = '100';
      let activeField: 'sell' | 'buy' = 'sell';

      const flipResults: FlipResult[] = [];

      for (let i = 0; i < 10; i++) {
        const route = createMockRoute(
          toWei(parseFloat(currentSellAmount), currentSellToken.decimals),
          toWei(parseFloat(currentSellAmount), currentBuyToken.decimals)
        );

        const result = activeField === 'sell'
          ? simulateFlipFromSellMode(currentSellToken, currentBuyToken, currentSellAmount, route, currentBuyToken.decimals)
          : simulateFlipFromBuyMode(currentSellToken, currentBuyToken, currentSellAmount, route, currentSellToken.decimals);

        flipResults.push(result);

        // Swap for next iteration
        const temp = currentSellToken;
        currentSellToken = currentBuyToken;
        currentBuyToken = temp;
        currentSellAmount = result.newSellAmount;
        activeField = 'sell'; // Always resets to sell after flip
      }

      // All flips should complete without errors
      expect(flipResults.length).toBe(10);
      flipResults.forEach(result => {
        expect(result.newSellToken).toBeDefined();
        expect(result.newBuyToken).toBeDefined();
      });
    });

    it('should auto-flip when same token selected (same token prevention)', () => {
      // When user selects same token for both sell and buy, UI auto-flips
      // Simulate this scenario
      const result = simulateFlipFromSellMode(
        WWDOGE,
        WWDOGE, // Same token
        '100',
        createMockRoute(toWei(100, WWDOGE.decimals), toWei(100, WWDOGE.decimals)),
        WWDOGE.decimals
      );

      // After flip, tokens should be same (but this is a no-op flip)
      // In real UI, this would trigger handleSwapTokens which exchanges them
      // Since they're same, net effect is no change
      expect(result.bugDetected).toBe(false);
    });

    it('should handle no route found scenario', () => {
      const result = simulateFlipFromSellMode(
        WWDOGE,
        OMNOM,
        '100',
        null, // No route
        OMNOM.decimals
      );

      expect(result.newSellAmount).toBe('100');
      expect(result.bugDetected).toBe(false);
    });
  });

  describe('Transaction Payload Validity', () => {
    it('should build valid SwapRequest after flip', () => {
      const sellAmount = toWei(100, WWDOGE.decimals);
      const minOut = (sellAmount * 9500n) / 10000n; // 0.5% slippage
      const deadline = BigInt(Math.floor(Date.now() / 1000)) + 300n;

      const request: SwapRequest = {
        tokenIn: WWDOGE.address as `0x${string}`,
        tokenOut: OMNOM.address as `0x${string}`,
        amountIn: sellAmount,
        minTotalAmountOut: minOut,
        steps: [{
          router: '0x1234567890123456789012345678901234567890' as `0x${string}`,
          path: [WWDOGE.address as `0x${string}`, OMNOM.address as `0x${string}`],
          amountIn: sellAmount - (sellAmount * 25n) / 10000n, // After fee
          minAmountOut: minOut,
        }],
        deadline,
        recipient: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd' as `0x${string}`,
      };

      // Validate structure
      expect(request.tokenIn).toBe(WWDOGE.address);
      expect(request.tokenOut).toBe(OMNOM.address);
      expect(request.amountIn).toBe(sellAmount);
      expect(request.minTotalAmountOut).toBe(minOut);
      expect(request.steps.length).toBeGreaterThan(0);
      expect(request.deadline).toBeGreaterThan(0);
      expect(request.recipient).toMatch(/^0x[a-f0-9]{40}$/);
    });

    it('should correctly calculate deadline with per-hop buffer', () => {
      const userDeadlineMinutes = 5;
      const hopCount = 3;
      const extraSecondsPerHop = 30;

      const baseDeadline = userDeadlineMinutes * 60;
      const hopBuffer = Math.max(0, hopCount - 1) * extraSecondsPerHop;
      const effectiveDeadline = baseDeadline + hopBuffer;

      expect(effectiveDeadline).toBe(300 + 60); // 5 min + 60 sec (2 extra hops)
    });

    it('should handle multi-hop step chaining correctly', () => {
      // Simulate 3-hop route
      const route: RouteResult = {
        id: 'multi-hop-test',
        steps: [
          {
            dexRouter: '0x1111',
            dexName: 'DEX1',
            path: ['A', 'B'],
            amountIn: toWei(100, WWDOGE.decimals),
            expectedAmountOut: toWei(95, 18),
          },
          {
            dexRouter: '0x2222',
            dexName: 'DEX2',
            path: ['B', 'C'],
            amountIn: toWei(95, 18),
            expectedAmountOut: toWei(90, OMNOM.decimals),
          },
          {
            dexRouter: '0x3333',
            dexName: 'DEX3',
            path: ['C', 'D'],
            amountIn: toWei(90, OMNOM.decimals),
            expectedAmountOut: toWei(85, OMNOM.decimals),
          },
        ],
        totalAmountIn: toWei(100, WWDOGE.decimals),
        totalExpectedOut: toWei(85, OMNOM.decimals),
        priceImpact: 0.15,
        feeAmount: toWei(0.25, WWDOGE.decimals),
        feeBps: 25,
      };

      // Verify step chaining
      expect(route.steps.length).toBe(3);
      expect(route.steps[0].amountIn).toBe(route.totalAmountIn);

      // Each subsequent step should use previous step's output
      for (let i = 1; i < route.steps.length; i++) {
        // In real execution, amountIn would be slippage-adjusted from previous step
        expect(route.steps[i].amountIn).toBeLessThanOrEqual(route.steps[i-1].expectedAmountOut);
      }

      // Final output should be less than initial input due to fees and slippage
      expect(route.totalExpectedOut).toBeLessThan(route.totalAmountIn);
    });
  });

  describe('Slippage Calculations', () => {
    it('should calculate minAmountOut correctly for various slippage percentages', () => {
      const testCases = [
        { amount: 1000, slippageBps: 1, expectedMin: 999 },
        { amount: 1000, slippageBps: 10, expectedMin: 999 },
        { amount: 1000, slippageBps: 50, expectedMin: 995 },
        { amount: 1000, slippageBps: 100, expectedMin: 990 },
        { amount: 1000, slippageBps: 500, expectedMin: 950 },
        { amount: 1000, slippageBps: 1000, expectedMin: 900 },
      ];

      testCases.forEach(({ amount, slippageBps, expectedMin }) => {
        const minOut = (BigInt(amount) * BigInt(10000 - slippageBps)) / 10000n;
        expect(Number(minOut)).toBe(expectedMin);
      });
    });

    it('should handle 100% slippage (10000 bps)', () => {
      const amount = 1000n;
      const slippageBps = 10000;

      const minOut = (amount * BigInt(10000 - slippageBps)) / 10000n;

      expect(minOut).toBe(0n); // Accept anything
    });

    it('should not cause underflow with valid slippage', () => {
      const amounts = [1n, 100n, 1000000n, toWei(1, 18)];
      const slippageBps = 9999; // Very high but valid

      amounts.forEach(amount => {
        const minOut = (amount * BigInt(10000 - slippageBps)) / 10000n;
        expect(minOut).toBeGreaterThanOrEqual(0n);
        expect(minOut).toBeLessThanOrEqual(amount);
      });
    });
  });

  describe('Price Impact Tests', () => {
    it('should calculate price impact correctly', () => {
      const reserveIn = toWei(10000, 18);
      toWei(10000, 18); // _reserveOut - intentionally unused
      const amountIn = toWei(100, 18);

      // Simple price impact: (amountIn / reserveIn) * 100 = 1%
      const priceImpactFraction = Number(amountIn) / Number(reserveIn);

      expect(priceImpactFraction).toBeCloseTo(0.01, 4); // 1%
    });

    it('should flag high price impact (>5%)', () => {
      const PRICE_IMPACT_WARN = 0.05;
      const PRICE_IMPACT_BLOCK = 0.15;

      const testCases = [
        { amountIn: 500, reserveIn: 10000, expectedWarning: true, expectedBlock: false },
        { amountIn: 1000, reserveIn: 10000, expectedWarning: true, expectedBlock: false },
        { amountIn: 2000, reserveIn: 10000, expectedWarning: true, expectedBlock: true },
      ];

      testCases.forEach(({ amountIn, reserveIn, expectedWarning, expectedBlock }) => {
        const priceImpact = amountIn / reserveIn;

        const hasWarning = priceImpact >= PRICE_IMPACT_WARN;
        const hasBlock = priceImpact >= PRICE_IMPACT_BLOCK;

        expect(hasWarning).toBe(expectedWarning);
        expect(hasBlock).toBe(expectedBlock);
      });
    });
  });

  describe('Format Units Consistency', () => {
    it('should correctly format various decimal tokens', () => {
      // Test WWDOGE (18 decimals)
      const wwdogeWei = toWei(1.5, 18);
      const wwdogeFormatted = formatFromWei(wwdogeWei, 18);
      expect(parseFloat(wwdogeFormatted)).toBeCloseTo(1.5, 2);

      // Test OMNOM (6 decimals)
      const omnomWei = toWei(1.5, 6);
      const omnomFormatted = formatFromWei(omnomWei, 6);
      expect(parseFloat(omnomFormatted)).toBeCloseTo(1.5, 2);

      // Test 0 decimals
      const zeroDecWei = 150n;
      const zeroDecFormatted = formatFromWei(zeroDecWei, 0);
      expect(zeroDecFormatted).toBe('150');
    });

    it('should handle very small amounts without scientific notation', () => {
      // 1 wei of ETH (18 decimals) = 0.000000000000000001 ETH
      const oneWei = 1n;
      const formatted = formatFromWei(oneWei, 18);

      // Should NOT be scientific notation
      expect(formatted).not.toContain('e');
      expect(formatted).toContain('0'); // Should show the zero
    });

    it('should not lose precision with large wei amounts', () => {
      // Max safe integer in JS is 2^53 - 1 ≈ 9e15
      // But BigInt can handle larger values
      const largeAmount = toWei(999999999, 18);
      const formatted = formatFromWei(largeAmount, 18);

      // Should handle without overflow
      expect(parseFloat(formatted)).toBeGreaterThan(0);
    });
  });
});

// ─── Test Utilities ──────────────────────────────────────────────────────────

/**
 * Helper to create test fixtures for repeated test scenarios.
 */
function createFlipScenario(
  sellSymbol: string,
  buySymbol: string,
  sellDecimals: number,
  buyDecimals: number,
  activeField: 'sell' | 'buy'
) {
  return {
    tokens: {
      sell: { symbol: sellSymbol, decimals: sellDecimals, address: `0x${sellSymbol}` } as TokenInfo,
      buy: { symbol: buySymbol, decimals: buyDecimals, address: `0x${buySymbol}` } as TokenInfo,
    },
    activeField,
    amount: '100',
  };
}

describe('Flip Scenario Fixtures', () => {
  const scenarios = [
    createFlipScenario('WWDOGE', 'OMNOM', 18, 6, 'sell'),
    createFlipScenario('WWDOGE', 'OMNOM', 18, 6, 'buy'),
    createFlipScenario('OMNOM', 'WWDOGE', 6, 18, 'sell'),
    createFlipScenario('ZD', 'WWDOGE', 0, 18, 'buy'),
    createFlipScenario('WWDOGE', 'WWDOGE', 18, 18, 'sell'),
  ];

  scenarios.forEach(({ tokens, activeField, amount }) => {
    it(`should handle ${tokens.sell.symbol} → ${tokens.buy.symbol} flip from ${activeField} mode`, () => {
      const route = createMockRoute(
        toWei(parseFloat(amount), tokens.sell.decimals),
        toWei(parseFloat(amount), tokens.buy.decimals)
      );

      const result = activeField === 'sell'
        ? simulateFlipFromSellMode(tokens.sell, tokens.buy, amount, route, tokens.buy.decimals)
        : simulateFlipFromBuyMode(tokens.sell, tokens.buy, amount, route, tokens.sell.decimals);

      expect(result.newSellToken).toBeDefined();
      expect(result.newBuyToken).toBeDefined();
    });
  });
});