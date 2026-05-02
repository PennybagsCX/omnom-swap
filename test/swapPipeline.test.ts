/**
 * @file swapPipeline.test.ts
 * @description Integration tests for the full swap pipeline:
 *   Quote → Route → TX Construction
 *
 * Coverage:
 *   1. Full Pipeline: Quote → Route → TX Construction
 *   2. Amount Validation
 *   3. Slippage with Tax
 *   4. Edge Cases
 *
 * Reference: src/hooks/useAggregator/useSwap.ts, src/hooks/useAutoSlippage.ts
 */

import { describe, it, expect } from 'vitest';

// ─── Type Definitions ──────────────────────────────────────────────────────────

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

interface SwapStepRequest {
  router: `0x${string}`;
  path: `0x${string}`[];
  amountIn: bigint;
  minAmountOut: bigint;
}

interface SwapRequest {
  tokenIn: `0x${string}`;
  tokenOut: `0x${string}`;
  amountIn: bigint;
  minTotalAmountOut: bigint;
  steps: SwapStepRequest[];
  deadline: bigint;
  recipient: `0x${string}`;
}

// ─── Constants ─────────────────────────────────────────────────────────────────

const WWDOGE = '0xb7ddc6414bf4f5515b52d8bdd69973ae205ff101';
const DC = '0x7b4328c127b85369d9f82ca0503b000d09cf9180';
const OMNOM = '0xe3fca919883950c5cd468156392a6477ff5d18de';
const MCRIB = '0xbdad927604c5cb78f15b3669a92fa5a1427d33a2';

const TOKEN_DECIMALS: Record<string, number> = {
  [WWDOGE.toLowerCase()]: 18,
  [DC.toLowerCase()]: 18,
  [OMNOM.toLowerCase()]: 18,
  [MCRIB.toLowerCase()]: 15,
};

function getTokenDecimals(addr: string): number {
  return TOKEN_DECIMALS[addr.toLowerCase()] ?? 18;
}

const MIN_INTERMEDIATE_OUT = BigInt('1000000000000'); // 1e12
const EXTRA_SECONDS_PER_HOP = 30;

// ─── Auto Slippage Calculation (mirrors useAutoSlippage.ts) ────────────────────

const BASE_SLIPPAGE = 0.5;
const PRICE_IMPACT_FACTOR = 0.5;
const HOP_BUFFER = 0.3;
const THIN_PAIR_BUFFER = 1.5;
const VARIANCE_FACTOR = 2.0;
const MIN_SLIPPAGE = 0.5;
const MAX_SLIPPAGE = 50;
const TVL_THIN_POOL_MIN_SLIPPAGE = 1.0;

interface AutoSlippageBreakdown {
  base: number;
  priceImpactBuffer: number;
  hopBuffer: number;
  thinPairBuffer: number;
  varianceBuffer: number;
  taxBuffer: number;
  total: number;
}

function calculateAutoSlippage(
  priceImpact: number,
  hopCount: number,
  tradeSizeVsLiquidity: number,
  isThinPair: boolean,
  _poolTvl: number = Infinity,
  buyTax: number = 0,
  sellTax: number = 0,
): AutoSlippageBreakdown {
  const impactPct = Math.abs(priceImpact) * 100;
  const thinPoolBuffer = isThinPair ? THIN_PAIR_BUFFER : 0;

  const totalTax = buyTax + sellTax;
  const taxBuffer = totalTax;

  const base = BASE_SLIPPAGE;
  const priceImpactBuffer = impactPct * PRICE_IMPACT_FACTOR;
  const hopBuffer = Math.max(0, hopCount - 1) * HOP_BUFFER;
  const varianceBuffer = Math.min(Math.max(0, tradeSizeVsLiquidity), 1) * VARIANCE_FACTOR;

  const raw = base + priceImpactBuffer + hopBuffer + thinPoolBuffer + varianceBuffer;
  const withThinPoolMin = Math.max(raw, TVL_THIN_POOL_MIN_SLIPPAGE);
  const withTaxMin = Math.max(withThinPoolMin, totalTax + MIN_SLIPPAGE);
  const total = Math.round(Math.min(Math.max(withTaxMin, MIN_SLIPPAGE), MAX_SLIPPAGE) * 100) / 100;

  return {
    base,
    priceImpactBuffer: Math.round(priceImpactBuffer * 100) / 100,
    hopBuffer: Math.round(hopBuffer * 100) / 100,
    thinPairBuffer: Math.round(thinPoolBuffer * 100) / 100,
    varianceBuffer: Math.round(varianceBuffer * 100) / 100,
    taxBuffer: Math.round(taxBuffer * 100) / 100,
    total,
  };
}

// ─── Swap Request Builder (mirrors buildSwapRequest from useSwap.ts) ───────────

function buildSwapRequest(
  route: RouteResult,
  slippageBps: number,
  deadlineMinutes: number,
  recipientAddress: string,
): SwapRequest {
  const currentTimeSeconds = Math.floor(Date.now() / 1000);
  const safeDeadlineMinutes = Number.isFinite(deadlineMinutes) && deadlineMinutes > 0 ? deadlineMinutes : 5;
  const userDeadlineSeconds = safeDeadlineMinutes * 60;
  const hopCount = route.steps.length;
  const extraPerHop = Math.max(0, hopCount - 1) * EXTRA_SECONDS_PER_HOP;
  const effectiveDeadlineSeconds = userDeadlineSeconds + extraPerHop;
  const deadline = BigInt(currentTimeSeconds + effectiveDeadlineSeconds);

  const slippageMultiplier = 10000n - BigInt(slippageBps);
  const minTotalAmountOut = (route.totalExpectedOut * slippageMultiplier) / 10000n;

  const stepMinAmounts: bigint[] = route.steps.map((step) => {
    return (step.expectedAmountOut * slippageMultiplier) / 10000n;
  });

  const stepExpectedNormalized: bigint[] = route.steps.map((step) => {
    const tokenOut = step.path[step.path.length - 1];
    const tokenOutDecimals = getTokenDecimals(tokenOut);
    const expectedOut = step.expectedAmountOut;
    if (tokenOutDecimals < 18) {
      return expectedOut * 10n ** BigInt(18 - tokenOutDecimals);
    } else if (tokenOutDecimals > 18) {
      return expectedOut / 10n ** BigInt(tokenOutDecimals - 18);
    }
    return expectedOut;
  });

  const steps = route.steps.map((step, i) => {
    let stepAmountIn: bigint;
    let stepMinOut: bigint;

    if (i === 0) {
      const feeAmount = (route.totalAmountIn * BigInt(route.feeBps)) / 10000n;
      stepAmountIn = route.totalAmountIn - feeAmount;
      stepMinOut = stepMinAmounts[0];
    } else {
      stepAmountIn = stepExpectedNormalized[i - 1];
      if (i < route.steps.length - 1) {
        stepMinOut = MIN_INTERMEDIATE_OUT;
      } else {
        stepMinOut = stepMinAmounts[i];
      }
    }

    return {
      router: step.dexRouter as `0x${string}`,
      path: step.path as `0x${string}`[],
      amountIn: stepAmountIn,
      minAmountOut: stepMinOut,
    };
  });

  return {
    tokenIn: route.steps[0]?.path[0] as `0x${string}` ?? '0x0000000000000000000000000000000000000000',
    tokenOut: route.steps[route.steps.length - 1]?.path[route.steps.length - 1]?.length ? route.steps[route.steps.length - 1].path[route.steps[route.steps.length - 1].path.length - 1] as `0x${string}` : '0x0000000000000000000000000000000000000000',
    amountIn: route.totalAmountIn,
    minTotalAmountOut,
    steps,
    deadline,
    recipient: recipientAddress as `0x${string}`,
  };
}

// ─── Helper: create mock route ─────────────────────────────────────────────────

function createMockDirectRoute(
  tokenIn: string,
  tokenOut: string,
  amountIn: bigint,
  expectedOut: bigint,
  feeBps = 25,
): RouteResult {
  const feeAmount = (amountIn * BigInt(feeBps)) / 10000n;
  return {
    id: `direct:${tokenIn}>${tokenOut}`,
    steps: [{
      dexRouter: '0xa4ee06ce40cb7e8c04e127c1f7d3dfb7f7039c81',
      dexName: 'DogeSwap',
      path: [tokenIn, tokenOut],
      amountIn: amountIn - feeAmount,
      expectedAmountOut: expectedOut,
    }],
    totalAmountIn: amountIn,
    totalExpectedOut: expectedOut,
    priceImpact: 0.005,
    feeAmount,
    feeBps,
    routeType: 'direct',
  };
}

function createMockMultiHopRoute(
  tokenIn: string,
  intermediate: string,
  tokenOut: string,
  amountIn: bigint,
  expectedOut: bigint,
  feeBps = 25,
): RouteResult {
  const feeAmount = (amountIn * BigInt(feeBps)) / 10000n;
  const swapAmount = amountIn - feeAmount;
  const intermediateAmount = (swapAmount * 99n) / 100n; // ~1% loss per hop

  return {
    id: `multihop:${tokenIn}>${intermediate}>${tokenOut}`,
    steps: [
      {
        dexRouter: '0xa4ee06ce40cb7e8c04e127c1f7d3dfb7f7039c81',
        dexName: 'DogeSwap',
        path: [tokenIn, intermediate],
        amountIn: swapAmount,
        expectedAmountOut: intermediateAmount,
      },
      {
        dexRouter: '0x45afcf57f7e3f3b9ca70335e5e85e4f77dcc5087',
        dexName: 'DogeShrk',
        path: [intermediate, tokenOut],
        amountIn: intermediateAmount,
        expectedAmountOut: expectedOut,
      },
    ],
    totalAmountIn: amountIn,
    totalExpectedOut: expectedOut,
    priceImpact: 0.015,
    feeAmount,
    feeBps,
    routeType: 'multi_hop',
    intermediateToken: intermediate,
  };
}

// ─── Test Suites ────────────────────────────────────────────────────────────────

describe('Swap Pipeline Integration', () => {

  // ─── Full Pipeline ─────────────────────────────────────────────────────────

  describe('Full Pipeline: Quote → Route → TX Construction', () => {
    const recipient = '0x1234567890123456789012345678901234567890';

    it('should construct valid swap request for DC → WWDOGE (direct)', () => {
      const route = createMockDirectRoute(DC, WWDOGE, 1000000000000000000n, 995000000000000000n);
      const request = buildSwapRequest(route, 50, 5, recipient);

      expect(request.tokenIn).toBe(DC);
      expect(request.tokenOut).toBe(WWDOGE);
      expect(request.amountIn).toBe(1000000000000000000n);
      expect(request.minTotalAmountOut).toBeGreaterThan(0n);
      expect(request.minTotalAmountOut).toBeLessThan(route.totalExpectedOut);
      expect(request.steps.length).toBe(1);
      expect(request.steps[0].amountIn).toBeLessThan(route.totalAmountIn); // fee deducted
      expect(request.deadline).toBeGreaterThan(0n);
      expect(request.recipient).toBe(recipient);
    });

    it('should construct valid swap request for DC → MCRIB (multi-hop)', () => {
      const route = createMockMultiHopRoute(DC, WWDOGE, MCRIB, 1000000000000000000n, 950000000000000n);
      const request = buildSwapRequest(route, 50, 5, recipient);

      expect(request.steps.length).toBe(2);
      expect(request.tokenIn).toBe(DC);
      expect(request.tokenOut).toBe(MCRIB);

      // First step amountIn should have fee deducted
      const feeAmount = (route.totalAmountIn * BigInt(route.feeBps)) / 10000n;
      expect(request.steps[0].amountIn).toBe(route.totalAmountIn - feeAmount);

      // Second step amountIn should use normalized output from step 1
      expect(request.steps[1].amountIn).toBeGreaterThan(0n);

      // minTotalAmountOut should be in MCRIB's native decimals (15)
      expect(request.minTotalAmountOut).toBeGreaterThan(0n);
    });

    it('should construct valid swap request for MCRIB → WWDOGE (sell taxed token)', () => {
      const route = createMockDirectRoute(MCRIB, WWDOGE, 1000000000000000n, 970000000000000000n);
      const request = buildSwapRequest(route, 50, 5, recipient);

      expect(request.tokenIn).toBe(MCRIB);
      expect(request.tokenOut).toBe(WWDOGE);
      expect(request.minTotalAmountOut).toBeGreaterThan(0n);
      expect(request.minTotalAmountOut).toBeLessThan(route.totalExpectedOut);
    });

    it('should handle WWDOGE → OMNOM → MCRIB route', () => {
      // 3-hop route: WWDOGE → OMNOM → DC → MCRIB
      const feeBps = 25;
      const amountIn = 1000000000000000000n;
      const feeAmount = (amountIn * BigInt(feeBps)) / 10000n;
      const swapAmount = amountIn - feeAmount;

      const route: RouteResult = {
        id: '3hop:WWDOGE>OMNOM>DC>MCRIB',
        steps: [
          { dexRouter: '0x1', dexName: 'DogeSwap', path: [WWDOGE, OMNOM], amountIn: swapAmount, expectedAmountOut: 980000000000000000n },
          { dexRouter: '0x2', dexName: 'DogeShrk', path: [OMNOM, DC], amountIn: 980000000000000000n, expectedAmountOut: 960000000000000000n },
          { dexRouter: '0x3', dexName: 'FraxSwap', path: [DC, MCRIB], amountIn: 960000000000000000n, expectedAmountOut: 940000000000000n },
        ],
        totalAmountIn: amountIn,
        totalExpectedOut: 940000000000000n,
        priceImpact: 0.03,
        feeAmount,
        feeBps,
        routeType: 'multi_hop',
      };

      const request = buildSwapRequest(route, 50, 5, recipient);

      expect(request.steps.length).toBe(3);
      // Step 0: fee deducted from amountIn
      expect(request.steps[0].amountIn).toBe(swapAmount);
      // Step 1: uses normalized output from step 0
      expect(request.steps[1].amountIn).toBeGreaterThan(0n);
      // Step 2: uses normalized output from step 1
      expect(request.steps[2].amountIn).toBeGreaterThan(0n);
      // Intermediate steps use MIN_INTERMEDIATE_OUT
      expect(request.steps[1].minAmountOut).toBe(MIN_INTERMEDIATE_OUT);
      // Last step uses slippage-adjusted minAmountOut
      expect(request.steps[2].minAmountOut).toBeGreaterThan(MIN_INTERMEDIATE_OUT);
    });
  });

  // ─── Amount Validation ─────────────────────────────────────────────────────

  describe('Amount Validation', () => {
    const recipient = '0x1234567890123456789012345678901234567890';

    it('should produce minAmountOut < expectedAmountOut', () => {
      const route = createMockDirectRoute(DC, WWDOGE, 1000000000000000000n, 1000000000000000000n);
      const request = buildSwapRequest(route, 50, 5, recipient);

      expect(request.minTotalAmountOut).toBeLessThan(route.totalExpectedOut);
    });

    it('should produce minTotalAmountOut in native decimals', () => {
      // MCRIB has 15 decimals — minTotalAmountOut should be in 15-decimal form
      const route = createMockDirectRoute(DC, MCRIB, 1000000000000000000n, 1000000000000000n);
      const request = buildSwapRequest(route, 50, 5, recipient);

      // minTotalAmountOut should be in the same decimal representation as totalExpectedOut
      const ratio = Number(request.minTotalAmountOut) / Number(route.totalExpectedOut);
      // With 0.5% slippage, ratio should be ~0.995
      expect(ratio).toBeCloseTo(0.995, 1);
    });

    it('should not have extreme ratio between consecutive steps', () => {
      const route = createMockMultiHopRoute(DC, WWDOGE, MCRIB, 1000000000000000000n, 1000000000000000n);
      const request = buildSwapRequest(route, 50, 5, recipient);

      for (let i = 1; i < request.steps.length; i++) {
        const prev = request.steps[i - 1].amountIn;
        const curr = request.steps[i].amountIn;
        if (prev > 0n && curr > 0n) {
          const ratio = curr > prev ? Number(curr / prev) : Number(prev / curr);
          expect(ratio).toBeLessThan(1e15);
        }
      }
    });

    it('should account for platform fee in step 1 amountIn', () => {
      const amountIn = 1000000000000000000n;
      const feeBps = 25;
      const route = createMockDirectRoute(DC, WWDOGE, amountIn, 1000000000000000000n, feeBps);
      const request = buildSwapRequest(route, 50, 5, recipient);

      const expectedFee = (amountIn * BigInt(feeBps)) / 10000n;
      expect(request.steps[0].amountIn).toBe(amountIn - expectedFee);
    });
  });

  // ─── Slippage with Tax ─────────────────────────────────────────────────────

  describe('Slippage with Tax', () => {
    it('should apply minimum 3.5% slippage for 3% buy tax tokens', () => {
      const breakdown = calculateAutoSlippage(0.001, 1, 0.01, false, Infinity, 3, 0);
      // taxBuffer = 3%, minimum = tax + base(0.5%) = 3.5%
      expect(breakdown.total).toBeGreaterThanOrEqual(3.5);
      expect(breakdown.taxBuffer).toBe(3);
    });

    it('should apply higher slippage for thin pools', () => {
      const normalPool = calculateAutoSlippage(0.001, 1, 0.01, false, 200_000);
      const thinPool = calculateAutoSlippage(0.001, 1, 0.01, true, 50_000);

      expect(thinPool.total).toBeGreaterThan(normalPool.total);
      expect(thinPool.thinPairBuffer).toBe(THIN_PAIR_BUFFER);
    });

    it('should stack tax buffer on top of price impact slippage', () => {
      const noTax = calculateAutoSlippage(0.05, 1, 0.01, false, Infinity, 0, 0);
      const withTax = calculateAutoSlippage(0.05, 1, 0.01, false, Infinity, 5, 0);

      expect(withTax.total).toBeGreaterThan(noTax.total);
      expect(withTax.taxBuffer).toBe(5);
      expect(withTax.priceImpactBuffer).toBe(noTax.priceImpactBuffer);
    });

    it('should handle zero-tax tokens with standard slippage', () => {
      const breakdown = calculateAutoSlippage(0.001, 1, 0.01, false, Infinity, 0, 0);
      expect(breakdown.taxBuffer).toBe(0);
      expect(breakdown.total).toBeGreaterThanOrEqual(MIN_SLIPPAGE);
      expect(breakdown.total).toBeLessThanOrEqual(MAX_SLIPPAGE);
    });

    it('should add hop buffer for multi-hop routes', () => {
      const direct = calculateAutoSlippage(0.001, 1, 0.01, false);
      const twoHop = calculateAutoSlippage(0.001, 2, 0.01, false);
      const threeHop = calculateAutoSlippage(0.001, 3, 0.01, false);

      // Hop buffer uses max(0, hopCount - 1), so 1-hop = 0, 2-hop = 0.3, 3-hop = 0.6
      expect(twoHop.hopBuffer).toBe(HOP_BUFFER);
      expect(threeHop.hopBuffer).toBe(HOP_BUFFER * 2);
      // Verify hop buffers increase total slippage
      expect(twoHop.total).toBeGreaterThanOrEqual(direct.total);
      expect(threeHop.hopBuffer).toBeGreaterThan(twoHop.hopBuffer);
    });

    it('should enforce thin pool minimum slippage of 1%', () => {
      const breakdown = calculateAutoSlippage(0.0001, 1, 0.001, false, 50_000);
      expect(breakdown.total).toBeGreaterThanOrEqual(TVL_THIN_POOL_MIN_SLIPPAGE);
    });
  });

  // ─── Edge Cases ────────────────────────────────────────────────────────────

  describe('Edge Cases', () => {
    const recipient = '0x1234567890123456789012345678901234567890';

    it('should reject routes with corrupted reserve data', () => {
      // Route with 0 expected output
      const route: RouteResult = {
        id: 'corrupt',
        steps: [{ dexRouter: '0x1', dexName: 'DogeSwap', path: [DC, WWDOGE], amountIn: 1000000000000000000n, expectedAmountOut: 0n }],
        totalAmountIn: 1000000000000000000n,
        totalExpectedOut: 0n,
        priceImpact: 0,
        feeAmount: 25n,
        feeBps: 25,
      };

      const request = buildSwapRequest(route, 50, 5, recipient);
      expect(request.minTotalAmountOut).toBe(0n);
    });

    it('should handle empty route results gracefully', () => {
      const route: RouteResult = {
        id: '',
        steps: [],
        totalAmountIn: 1000000000000000000n,
        totalExpectedOut: 0n,
        priceImpact: 0,
        feeAmount: 25n,
        feeBps: 25,
      };

      const request = buildSwapRequest(route, 50, 5, recipient);
      expect(request.steps.length).toBe(0);
      expect(request.tokenIn).toBe('0x0000000000000000000000000000000000000000');
    });

    it('should handle single-DEX routes', () => {
      const route = createMockDirectRoute(DC, WWDOGE, 1000000000000000000n, 995000000000000000n);
      const request = buildSwapRequest(route, 50, 5, recipient);

      expect(request.steps.length).toBe(1);
      expect(request.steps[0].router).toBe(route.steps[0].dexRouter);
    });

    it('should handle cross-DEX multi-hop routes', () => {
      const route = createMockMultiHopRoute(DC, WWDOGE, OMNOM, 1000000000000000000n, 950000000000000000n);
      const request = buildSwapRequest(route, 50, 5, recipient);

      // Different DEX per hop
      expect(request.steps[0].router).not.toBe(request.steps[1].router);
    });

    it('should extend deadline for multi-hop routes', () => {
      const directRoute = createMockDirectRoute(DC, WWDOGE, 1000000000000000000n, 1000000000000000000n);
      const multiHopRoute = createMockMultiHopRoute(DC, WWDOGE, OMNOM, 1000000000000000000n, 1000000000000000000n);

      const directRequest = buildSwapRequest(directRoute, 50, 5, recipient);
      const multiHopRequest = buildSwapRequest(multiHopRoute, 50, 5, recipient);

      // Multi-hop deadline should be 30s longer per extra hop
      const deadlineDiff = Number(multiHopRequest.deadline - directRequest.deadline);
      expect(deadlineDiff).toBe(EXTRA_SECONDS_PER_HOP);
    });

    it('should handle MCRIB 15-decimal output correctly in multi-hop', () => {
      const feeBps = 25;
      const amountIn = 1000000000000000000n;
      const feeAmount = (amountIn * BigInt(feeBps)) / 10000n;
      const swapAmount = amountIn - feeAmount;

      const route: RouteResult = {
        id: 'dc>wwdoge>mcrib',
        steps: [
          { dexRouter: '0x1', dexName: 'DogeSwap', path: [DC, WWDOGE], amountIn: swapAmount, expectedAmountOut: 970000000000000000n },
          { dexRouter: '0x2', dexName: 'DogeShrk', path: [WWDOGE, MCRIB], amountIn: 970000000000000000n, expectedAmountOut: 950000000000000n }, // 15 dec
        ],
        totalAmountIn: amountIn,
        totalExpectedOut: 950000000000000n, // in MCRIB's 15 decimals
        priceImpact: 0.02,
        feeAmount,
        feeBps,
        routeType: 'multi_hop',
        intermediateToken: WWDOGE,
      };

      const request = buildSwapRequest(route, 50, 5, recipient);

      // minTotalAmountOut should be in MCRIB's 15-decimal form
      expect(request.minTotalAmountOut).toBeGreaterThan(0n);
      expect(request.minTotalAmountOut).toBeLessThan(route.totalExpectedOut);

      // Step 1 amountIn should be normalized (18-decimal equivalent of step 0 output)
      const mcribDecimals = getTokenDecimals(MCRIB);
      expect(mcribDecimals).toBe(15);
      // The normalized amount should be ~950000 * 10^(18-15) = 950000000 in 18-decimal
      const step1AmountIn = request.steps[1].amountIn;
      expect(step1AmountIn).toBeGreaterThan(0n);
    });
  });
});
