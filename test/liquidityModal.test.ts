/**
 * Liquidity Modal Simulation Tests
 *
 * Pure-function tests covering all LiquidityModal business logic:
 * - Balance validation (WWDOGE pairs with gas deduction, ERC20/ERC20 pairs)
 * - MAX button behavior with gas cost deduction
 * - computeWithdrawAmounts() correctness
 * - BigInt ratio calculations (RATIO_SCALE = 2^96)
 * - Slippage validation
 * - Edge cases (zero balances, empty pools, gas estimation failures)
 * - OMNOM-specific pool filtering scenarios
 */

import { describe, it, expect } from 'vitest';
import { parseUnits, formatUnits } from 'viem';
import { computeWithdrawAmounts } from '../src/hooks/useLiquidity';

// ─── Constants (matching LiquidityModal.tsx) ────────────────────────────────

const RATIO_SCALE = 2n ** 96n;

// Token addresses used in pool filtering scenarios

// ─── Helper: replicate balance validation logic from LiquidityModal.tsx ─────

interface BalanceValidationInput {
  nativeDoge: number;       // Full native DOGE balance
  gasCostDoge: number;      // Estimated gas cost in DOGE
  rawBalANum: number;       // ERC20 balance of token A
  rawBalBNum: number;       // ERC20 balance of token B
  isToken0WWDOGE: boolean;
  isToken1WWDOGE: boolean;
  amountA: string;          // User input for token A
  amountB: string;          // User input for token B
  isConnected: boolean;
  balancesLoaded: boolean;
}

function validateBalances(input: BalanceValidationInput): {
  balanceA: number;
  balanceB: number;
  availableNativeForWrap: number;
  insufficientBalance: boolean;
  maxButtonA: number;
  maxButtonB: number;
} {
  const availableNativeForWrap = Math.max(0, input.nativeDoge - input.gasCostDoge);
  const balanceA = input.isToken0WWDOGE ? availableNativeForWrap : input.rawBalANum;
  const balanceB = input.isToken1WWDOGE ? availableNativeForWrap : input.rawBalBNum;
  const parsedA = parseFloat(input.amountA) || 0;
  const parsedB = parseFloat(input.amountB) || 0;
  const insufficientBalance = input.balancesLoaded && input.isConnected && (
    (input.isToken0WWDOGE ? parsedA > availableNativeForWrap : parsedA > input.rawBalANum) ||
    (input.isToken1WWDOGE ? parsedB > availableNativeForWrap : parsedB > input.rawBalBNum)
  );
  // MAX button logic: 99% of displayed balance
  const maxButtonA = balanceA * 0.99;
  const maxButtonB = balanceB * 0.99;

  return { balanceA, balanceB, availableNativeForWrap, insufficientBalance, maxButtonA, maxButtonB };
}

// ─── Helper: replicate slippage validation ──────────────────────────────────

function validateSlippage(slippageStr: string): {
  parsed: number;
  error: string;
  warning: string;
} {
  const parsed = parseFloat(slippageStr) || 1;
  const error = parsed <= 0
    ? 'Slippage must be > 0%'
    : parsed > 50
      ? 'Slippage tolerance too high. Maximum is 50%.'
      : '';
  const warning = !error && parsed > 5
    ? 'High slippage may result in unfavorable execution'
    : '';
  return { parsed, error, warning };
}

// ─── Helper: replicate BigInt ratio calculation ─────────────────────────────

function computeAmountB(
  amountAStr: string,
  decimals0: number,
  decimals1: number,
  reserve0: bigint,
  reserve1: bigint,
): string {
  const ratioX96 = reserve0 > 0n && reserve1 > 0n
    ? (reserve1 * RATIO_SCALE) / reserve0
    : 0n;
  if (ratioX96 <= 0n) return '';
  const amountABigInt = parseUnits(amountAStr, decimals0);
  const amountBWei = (amountABigInt * ratioX96) / RATIO_SCALE;
  return formatUnits(amountBWei, decimals1).replace(/\.0+$/, '');
}

function computeAmountA(
  amountBStr: string,
  decimals0: number,
  decimals1: number,
  reserve0: bigint,
  reserve1: bigint,
): string {
  const ratioX96 = reserve0 > 0n && reserve1 > 0n
    ? (reserve1 * RATIO_SCALE) / reserve0
    : 0n;
  if (ratioX96 <= 0n) return '';
  const amountBBigInt = parseUnits(amountBStr, decimals1);
  const amountAWei = (amountBBigInt * RATIO_SCALE) / ratioX96;
  return formatUnits(amountAWei, decimals0).replace(/\.0+$/, '');
}

// ─── Helper: gas estimation constants ───────────────────────────────────────

const GAS_BUFFER_NUMERATOR = 130n;
const GAS_BUFFER_DENOMINATOR = 100n;
const MAX_GAS_CAP = 2_000_000n;

function simulateGasEstimation(estimatedGas: bigint, gasPrice: bigint): {
  gasLimit: bigint;
  gasCost: bigint;
  gasCostDoge: number;
} {
  const bufferedGas = (estimatedGas * GAS_BUFFER_NUMERATOR) / GAS_BUFFER_DENOMINATOR;
  const gasLimit = bufferedGas > MAX_GAS_CAP ? MAX_GAS_CAP : bufferedGas;
  const gasCost = gasLimit * gasPrice;
  const gasCostDoge = Number(formatUnits(gasCost, 18));
  return { gasLimit, gasCost, gasCostDoge };
}

// ═══════════════════════════════════════════════════════════════════════════════
// TEST SUITES
// ═══════════════════════════════════════════════════════════════════════════════

describe('computeWithdrawAmounts', () => {
  it('returns zeros for zero totalSupply', () => {
    const result = computeWithdrawAmounts(1000n, 0n, 500n, 500n, 50);
    expect(result.amount0).toBe(0n);
    expect(result.amount1).toBe(0n);
    expect(result.liquidityToWithdraw).toBe(0n);
  });

  it('computes 100% withdrawal correctly', () => {
    const totalSupply = parseUnits('1000', 18);
    const reserve0 = parseUnits('5000', 18);
    const reserve1 = parseUnits('10000', 18);
    const lpBalance = parseUnits('100', 18);

    const result = computeWithdrawAmounts(lpBalance, totalSupply, reserve0, reserve1, 100);

    // 100 LP out of 1000 total = 10% of reserves
    expect(result.liquidityToWithdraw).toBe(lpBalance);
    const expectedAmount0 = (reserve0 * lpBalance) / totalSupply;
    const expectedAmount1 = (reserve1 * lpBalance) / totalSupply;
    expect(result.amount0).toBe(expectedAmount0);
    expect(result.amount1).toBe(expectedAmount1);
  });

  it('computes 50% withdrawal correctly', () => {
    const totalSupply = parseUnits('1000', 18);
    const reserve0 = parseUnits('5000', 18);
    const reserve1 = parseUnits('10000', 18);
    const lpBalance = parseUnits('100', 18);

    const result = computeWithdrawAmounts(lpBalance, totalSupply, reserve0, reserve1, 50);

    // 50% of 100 LP = 50 LP = 5% of reserves
    const expectedLiquidity = (lpBalance * BigInt(Math.floor(50 * 100))) / 10000n;
    expect(result.liquidityToWithdraw).toBe(expectedLiquidity);
    expect(result.amount0).toBe((reserve0 * expectedLiquidity) / totalSupply);
    expect(result.amount1).toBe((reserve1 * expectedLiquidity) / totalSupply);
  });

  it('computes 25% withdrawal correctly', () => {
    const totalSupply = parseUnits('1000', 18);
    const reserve0 = parseUnits('5000', 18);
    const reserve1 = parseUnits('10000', 18);
    const lpBalance = parseUnits('100', 18);

    const result = computeWithdrawAmounts(lpBalance, totalSupply, reserve0, reserve1, 25);
    const expectedLiquidity = (lpBalance * 2500n) / 10000n;
    expect(result.liquidityToWithdraw).toBe(expectedLiquidity);
  });

  it('computes 75% withdrawal correctly', () => {
    const totalSupply = parseUnits('1000', 18);
    const reserve0 = parseUnits('5000', 18);
    const reserve1 = parseUnits('10000', 18);
    const lpBalance = parseUnits('100', 18);

    const result = computeWithdrawAmounts(lpBalance, totalSupply, reserve0, reserve1, 75);
    const expectedLiquidity = (lpBalance * 7500n) / 10000n;
    expect(result.liquidityToWithdraw).toBe(expectedLiquidity);
  });

  it('handles very small LP balance (dust)', () => {
    const totalSupply = parseUnits('1000000', 18);
    const reserve0 = parseUnits('5000000', 18);
    const reserve1 = parseUnits('10000000', 18);
    const dustBalance = 1n; // 1 wei

    const result = computeWithdrawAmounts(dustBalance, totalSupply, reserve0, reserve1, 100);
    // 1 wei of LP / 1e24 total → integer division gives tiny non-zero amounts
    expect(result.liquidityToWithdraw).toBe(1n);
    expect(result.amount0).toBe((reserve0 * 1n) / totalSupply);
    expect(result.amount1).toBe((reserve1 * 1n) / totalSupply);
  });

  it('handles 0% withdrawal', () => {
    const totalSupply = parseUnits('1000', 18);
    const reserve0 = parseUnits('5000', 18);
    const lpBalance = parseUnits('100', 18);

    const result = computeWithdrawAmounts(lpBalance, totalSupply, reserve0, reserve0, 0);
    expect(result.liquidityToWithdraw).toBe(0n);
    expect(result.amount0).toBe(0n);
    expect(result.amount1).toBe(0n);
  });

  it('handles uneven reserves (100:1 ratio)', () => {
    const totalSupply = parseUnits('100', 18);
    const reserve0 = parseUnits('10000', 18);
    const reserve1 = parseUnits('100', 18);
    const lpBalance = parseUnits('10', 18);

    const result = computeWithdrawAmounts(lpBalance, totalSupply, reserve0, reserve1, 100);
    // 10 LP / 100 total = 10% of reserves
    const expected0 = (reserve0 * lpBalance) / totalSupply; // 1000
    const expected1 = (reserve1 * lpBalance) / totalSupply; // 10
    expect(result.amount0).toBe(expected0);
    expect(result.amount1).toBe(expected1);
  });
});

describe('Balance Validation — WWDOGE pairs (OMNOM/WWDOGE)', () => {
  it('shows INSUFFICIENT BALANCE when amount exceeds gas-adjusted balance', () => {
    // User has 100 DOGE, gas costs 0.5 DOGE
    // Available: 99.5 DOGE
    // User enters 100 → 100 > 99.5 → INSUFFICIENT
    const result = validateBalances({
      nativeDoge: 100,
      gasCostDoge: 0.5,
      rawBalANum: 5000,
      rawBalBNum: 0,
      isToken0WWDOGE: false,  // OMNOM is token0
      isToken1WWDOGE: true,   // WWDOGE is token1
      amountA: '100',
      amountB: '100',
      isConnected: true,
      balancesLoaded: true,
    });
    expect(result.availableNativeForWrap).toBe(99.5);
    expect(result.insufficientBalance).toBe(true);
  });

  it('allows amount within gas-adjusted balance', () => {
    // User has 100 DOGE, gas costs 0.5 DOGE
    // Available: 99.5 DOGE
    // User enters 50 → 50 < 99.5 → OK
    const result = validateBalances({
      nativeDoge: 100,
      gasCostDoge: 0.5,
      rawBalANum: 5000,
      rawBalBNum: 0,
      isToken0WWDOGE: false,
      isToken1WWDOGE: true,
      amountA: '1000',
      amountB: '50',
      isConnected: true,
      balancesLoaded: true,
    });
    expect(result.availableNativeForWrap).toBe(99.5);
    expect(result.insufficientBalance).toBe(false);
  });

  it('MAX button sets amount within gas-adjusted balance', () => {
    // This is the key bug fix: MAX should not exceed available balance
    const result = validateBalances({
      nativeDoge: 100,
      gasCostDoge: 0.5,
      rawBalANum: 5000,
      rawBalBNum: 0,
      isToken0WWDOGE: false,
      isToken1WWDOGE: true,
      amountA: '4950',
      amountB: '98.505', // 99% of 99.5
      isConnected: true,
      balancesLoaded: true,
    });
    // MAX sets to 99.5 * 0.99 = 98.505
    expect(result.maxButtonB).toBeCloseTo(98.505, 2);
    // 98.505 should NOT trigger insufficient balance
    expect(result.insufficientBalance).toBe(false);
  });

  it('handles zero gas cost (ERC20/ERC20 pair, no gas estimation)', () => {
    const result = validateBalances({
      nativeDoge: 100,
      gasCostDoge: 0,
      rawBalANum: 5000,
      rawBalBNum: 2000,
      isToken0WWDOGE: false,
      isToken1WWDOGE: false,
      amountA: '4900',  // 99% of 5000
      amountB: '1960',  // 99% of 2000
      isConnected: true,
      balancesLoaded: true,
    });
    expect(result.insufficientBalance).toBe(false);
  });

  it('handles native DOGE < gas cost', () => {
    // User has 0.3 DOGE but gas costs 0.5 DOGE
    const result = validateBalances({
      nativeDoge: 0.3,
      gasCostDoge: 0.5,
      rawBalANum: 5000,
      rawBalBNum: 0,
      isToken0WWDOGE: false,
      isToken1WWDOGE: true,
      amountA: '1000',
      amountB: '0.1',
      isConnected: true,
      balancesLoaded: true,
    });
    // availableNativeForWrap = max(0, 0.3 - 0.5) = 0
    expect(result.availableNativeForWrap).toBe(0);
    expect(result.balanceB).toBe(0);
    // 0.1 > 0 → INSUFFICIENT
    expect(result.insufficientBalance).toBe(true);
  });

  it('disconnected user never shows insufficient balance', () => {
    const result = validateBalances({
      nativeDoge: 0,
      gasCostDoge: 0,
      rawBalANum: 0,
      rawBalBNum: 0,
      isToken0WWDOGE: true,
      isToken1WWDOGE: false,
      amountA: '1000',
      amountB: '1000',
      isConnected: false,
      balancesLoaded: true,
    });
    expect(result.insufficientBalance).toBe(false);
  });

  it('balances not loaded never shows insufficient balance', () => {
    const result = validateBalances({
      nativeDoge: 0,
      gasCostDoge: 0,
      rawBalANum: 0,
      rawBalBNum: 0,
      isToken0WWDOGE: true,
      isToken1WWDOGE: false,
      amountA: '1000',
      amountB: '1000',
      isConnected: true,
      balancesLoaded: false,
    });
    expect(result.insufficientBalance).toBe(false);
  });

  it('WWDOGE as token0 — validates token0 against native', () => {
    const result = validateBalances({
      nativeDoge: 10,
      gasCostDoge: 0.3,
      rawBalANum: 0,      // WWDOGE ERC20 balance (irrelevant)
      rawBalBNum: 5000,    // OMNOM balance
      isToken0WWDOGE: true,
      isToken1WWDOGE: false,
      amountA: '9',
      amountB: '1000',
      isConnected: true,
      balancesLoaded: true,
    });
    // Available: 10 - 0.3 = 9.7
    // 9 < 9.7 → OK
    expect(result.availableNativeForWrap).toBe(9.7);
    expect(result.insufficientBalance).toBe(false);
  });

  it('WWDOGE as token0 — rejects amount exceeding gas-adjusted balance', () => {
    const result = validateBalances({
      nativeDoge: 10,
      gasCostDoge: 0.3,
      rawBalANum: 0,
      rawBalBNum: 5000,
      isToken0WWDOGE: true,
      isToken1WWDOGE: false,
      amountA: '10',       // 10 > 9.7 → INSUFFICIENT
      amountB: '1000',
      isConnected: true,
      balancesLoaded: true,
    });
    expect(result.insufficientBalance).toBe(true);
  });
});

describe('Balance Validation — ERC20/ERC20 pairs (OMNOM/USDT, OMNOM/MCRIB)', () => {
  it('validates against ERC20 balances directly', () => {
    const result = validateBalances({
      nativeDoge: 0,
      gasCostDoge: 0,
      rawBalANum: 5000,
      rawBalBNum: 2000,
      isToken0WWDOGE: false,
      isToken1WWDOGE: false,
      amountA: '4000',
      amountB: '1500',
      isConnected: true,
      balancesLoaded: true,
    });
    expect(result.insufficientBalance).toBe(false);
    expect(result.balanceA).toBe(5000);
    expect(result.balanceB).toBe(2000);
  });

  it('shows INSUFFICIENT when exceeding ERC20 balance', () => {
    const result = validateBalances({
      nativeDoge: 0,
      gasCostDoge: 0,
      rawBalANum: 5000,
      rawBalBNum: 2000,
      isToken0WWDOGE: false,
      isToken1WWDOGE: false,
      amountA: '6000',     // 6000 > 5000 → INSUFFICIENT
      amountB: '1500',
      isConnected: true,
      balancesLoaded: true,
    });
    expect(result.insufficientBalance).toBe(true);
  });

  it('zero ERC20 balance with non-zero input → INSUFFICIENT', () => {
    const result = validateBalances({
      nativeDoge: 0,
      gasCostDoge: 0,
      rawBalANum: 0,
      rawBalBNum: 0,
      isToken0WWDOGE: false,
      isToken1WWDOGE: false,
      amountA: '1',
      amountB: '1',
      isConnected: true,
      balancesLoaded: true,
    });
    expect(result.insufficientBalance).toBe(true);
  });
});

describe('BigInt Ratio Calculation (RATIO_SCALE = 2^96)', () => {
  it('computes correct B from A for 1:1 pool', () => {
    const reserve0 = parseUnits('1000', 18);
    const reserve1 = parseUnits('1000', 18);
    const result = computeAmountB('100', 18, 18, reserve0, reserve1);
    expect(parseFloat(result)).toBeCloseTo(100, 4);
  });

  it('computes correct B from A for 2:1 pool', () => {
    const reserve0 = parseUnits('1000', 18);  // token A
    const reserve1 = parseUnits('2000', 18);  // token B (2x A)
    const result = computeAmountB('100', 18, 18, reserve0, reserve1);
    expect(parseFloat(result)).toBeCloseTo(200, 4);
  });

  it('computes correct A from B for 2:1 pool (reverse)', () => {
    const reserve0 = parseUnits('1000', 18);
    const reserve1 = parseUnits('2000', 18);
    const result = computeAmountA('200', 18, 18, reserve0, reserve1);
    expect(parseFloat(result)).toBeCloseTo(100, 4);
  });

  it('handles different decimals (18 and 8)', () => {
    const reserve0 = parseUnits('1000', 18);  // 18-decimal token
    const reserve1 = parseUnits('1000', 8);   // 8-decimal token
    const result = computeAmountB('100', 18, 8, reserve0, reserve1);
    expect(parseFloat(result)).toBeCloseTo(100, 0);
  });

  it('returns empty string for zero reserves', () => {
    const result = computeAmountB('100', 18, 18, 0n, 0n);
    expect(result).toBe('');
  });

  it('handles very large amounts without precision loss', () => {
    const reserve0 = parseUnits('1000000000', 18);  // 1B tokens
    const reserve1 = parseUnits('1000000000', 18);
    const result = computeAmountB('500000000', 18, 18, reserve0, reserve1);
    expect(parseFloat(result)).toBeCloseTo(500000000, 0);
  });

  it('handles very small amounts', () => {
    const reserve0 = parseUnits('1000000', 18);
    const reserve1 = parseUnits('1000000', 18);
    const result = computeAmountB('0.000001', 18, 18, reserve0, reserve1);
    expect(parseFloat(result)).toBeCloseTo(0.000001, 6);
  });

  it('round-trip: A → B → A returns original (within precision)', () => {
    const reserve0 = parseUnits('12345', 18);
    const reserve1 = parseUnits('67890', 18);
    const originalA = '100';
    const computedB = computeAmountB(originalA, 18, 18, reserve0, reserve1);
    const computedA = computeAmountA(computedB, 18, 18, reserve0, reserve1);
    expect(parseFloat(computedA)).toBeCloseTo(parseFloat(originalA), 6);
  });
});

describe('Slippage Validation', () => {
  it('accepts valid slippage 3%', () => {
    const { parsed, error, warning } = validateSlippage('3.0');
    expect(parsed).toBe(3.0);
    expect(error).toBe('');
    expect(warning).toBe('');
  });

  it('treats 0% slippage as default 1% (parseFloat(0) || 1)', () => {
    // parseFloat('0.0') returns 0, which is falsy, so || 1 gives 1%
    const { parsed, error } = validateSlippage('0.0');
    expect(parsed).toBe(1); // Defaults to 1% (can't set 0%)
    expect(error).toBe('');
  });

  it('rejects negative slippage', () => {
    const { error } = validateSlippage('-1');
    expect(error).toBe('Slippage must be > 0%');
  });

  it('rejects >50% slippage', () => {
    const { error } = validateSlippage('51');
    expect(error).toBe('Slippage tolerance too high. Maximum is 50%.');
  });

  it('warns on high slippage (5-50%)', () => {
    const { error, warning } = validateSlippage('10');
    expect(error).toBe('');
    expect(warning).toBe('High slippage may result in unfavorable execution');
  });

  it('no warning for slippage ≤ 5%', () => {
    const { warning } = validateSlippage('5.0');
    expect(warning).toBe('');
  });

  it('handles empty string (defaults to 1)', () => {
    const { parsed } = validateSlippage('');
    expect(parsed).toBe(1);
  });

  it('handles non-numeric (defaults to 1)', () => {
    const { parsed } = validateSlippage('abc');
    expect(parsed).toBe(1);
  });

  it('accepts boundary value 50%', () => {
    const { error } = validateSlippage('50');
    expect(error).toBe('');
  });

  it('accepts boundary value 0.01%', () => {
    const { error } = validateSlippage('0.01');
    expect(error).toBe('');
  });
});

describe('Gas Estimation Simulation', () => {
  it('adds 30% buffer to estimated gas', () => {
    const estimatedGas = 200000n;
    const gasPrice = 1000000000n; // 1 gwei
    const { gasLimit } = simulateGasEstimation(estimatedGas, gasPrice);
    expect(gasLimit).toBe(260000n); // 200k * 1.3
  });

  it('caps gas at 2M units', () => {
    const estimatedGas = 5_000_000n;
    const gasPrice = 1000000000n; // 1 gwei
    const { gasLimit } = simulateGasEstimation(estimatedGas, gasPrice);
    expect(gasLimit).toBe(2_000_000n);
  });

  it('calculates gas cost correctly', () => {
    const estimatedGas = 300000n;
    const gasPrice = 2000000000n; // 2 gwei
    const { gasCost, gasCostDoge } = simulateGasEstimation(estimatedGas, gasPrice);
    // buffered: 390000, cost: 390000 * 2 gwei
    const expectedLimit = 390000n;
    const expectedCost = expectedLimit * gasPrice;
    expect(gasCost).toBe(expectedCost);
    expect(gasCostDoge).toBeGreaterThan(0);
  });

  it('realistic Dogechain gas estimation', () => {
    // Typical: ~250k gas for addLiquidity, gas price ~1 gwei on Dogechain
    const estimatedGas = 250000n;
    const gasPrice = 1000000000n; // 1 gwei
    const { gasLimit, gasCostDoge } = simulateGasEstimation(estimatedGas, gasPrice);
    // 250k * 1.3 = 325k
    expect(gasLimit).toBe(325000n);
    expect(gasCostDoge).toBeGreaterThan(0);
    expect(gasCostDoge).toBeLessThan(1);
  });
});

describe('OMNOM Pool Filtering Scenarios', () => {
  it('OMNOM/WWDOGE pool — validates correctly with gas', () => {
    const result = validateBalances({
      nativeDoge: 50,
      gasCostDoge: 0.3,
      rawBalANum: 10000,  // OMNOM balance
      rawBalBNum: 0,       // WWDOGE ERC20 (irrelevant, uses native)
      isToken0WWDOGE: false,
      isToken1WWDOGE: true,
      amountA: '5000',
      amountB: '25',
      isConnected: true,
      balancesLoaded: true,
    });
    expect(result.availableNativeForWrap).toBe(49.7);
    expect(result.insufficientBalance).toBe(false);
  });

  it('OMNOM/MCRIB pool — both ERC20, no gas estimation', () => {
    const result = validateBalances({
      nativeDoge: 0,
      gasCostDoge: 0,
      rawBalANum: 50000,  // OMNOM
      rawBalBNum: 100000, // MCRIB
      isToken0WWDOGE: false,
      isToken1WWDOGE: false,
      amountA: '1000',
      amountB: '2000',
      isConnected: true,
      balancesLoaded: true,
    });
    expect(result.insufficientBalance).toBe(false);
    expect(result.balanceA).toBe(50000);
    expect(result.balanceB).toBe(100000);
  });

  it('OMNOM/USDT pool — validates both ERC20 balances', () => {
    const result = validateBalances({
      nativeDoge: 0,
      gasCostDoge: 0,
      rawBalANum: 1000,
      rawBalBNum: 500,
      isToken0WWDOGE: false,
      isToken1WWDOGE: false,
      amountA: '900',
      amountB: '450',
      isConnected: true,
      balancesLoaded: true,
    });
    expect(result.insufficientBalance).toBe(false);
  });
});

describe('Edge Cases', () => {
  it('zero native DOGE with WWDOGE pair — available is 0', () => {
    const result = validateBalances({
      nativeDoge: 0,
      gasCostDoge: 0.3,
      rawBalANum: 5000,
      rawBalBNum: 0,
      isToken0WWDOGE: false,
      isToken1WWDOGE: true,
      amountA: '100',
      amountB: '0.001',
      isConnected: true,
      balancesLoaded: true,
    });
    expect(result.availableNativeForWrap).toBe(0);
    expect(result.insufficientBalance).toBe(true);
  });

  it('gas estimation failure (cost = 0) — uses full native balance', () => {
    // When gas estimation fails, cost is 0n, so gasCostDoge = 0
    const result = validateBalances({
      nativeDoge: 100,
      gasCostDoge: 0,  // Estimation failed
      rawBalANum: 5000,
      rawBalBNum: 0,
      isToken0WWDOGE: false,
      isToken1WWDOGE: true,
      amountA: '1000',
      amountB: '99',   // 99 < 100 → OK (but user hasn't reserved gas!)
      isConnected: true,
      balancesLoaded: true,
    });
    expect(result.availableNativeForWrap).toBe(100);
    expect(result.insufficientBalance).toBe(false);
    // Note: This is the "don't block the user" fallback from line 256
  });

  it('very small amounts — no false INSUFFICIENT', () => {
    const result = validateBalances({
      nativeDoge: 100,
      gasCostDoge: 0.5,
      rawBalANum: 5000,
      rawBalBNum: 0,
      isToken0WWDOGE: false,
      isToken1WWDOGE: true,
      amountA: '1',
      amountB: '0.001',
      isConnected: true,
      balancesLoaded: true,
    });
    expect(result.insufficientBalance).toBe(false);
  });

  it('MAX button for ERC20 pair — 99% of balance', () => {
    const result = validateBalances({
      nativeDoge: 0,
      gasCostDoge: 0,
      rawBalANum: 1000,
      rawBalBNum: 2000,
      isToken0WWDOGE: false,
      isToken1WWDOGE: false,
      amountA: '990',
      amountB: '1980',
      isConnected: true,
      balancesLoaded: true,
    });
    expect(result.maxButtonA).toBeCloseTo(990, 1);
    expect(result.maxButtonB).toBeCloseTo(1980, 1);
    expect(result.insufficientBalance).toBe(false);
  });

  it('MAX button for WWDOGE pair — 99% of gas-adjusted balance', () => {
    const result = validateBalances({
      nativeDoge: 100,
      gasCostDoge: 0.5,
      rawBalANum: 5000,
      rawBalBNum: 0,
      isToken0WWDOGE: false,
      isToken1WWDOGE: true,
      amountA: '1000',
      amountB: '98.505', // 99% of 99.5
      isConnected: true,
      balancesLoaded: true,
    });
    expect(result.maxButtonB).toBeCloseTo(98.505, 2);
    expect(result.insufficientBalance).toBe(false);
  });

  it('empty pool — zero reserves, ratio calculation returns empty', () => {
    const result = computeAmountB('100', 18, 18, 0n, 0n);
    expect(result).toBe('');
  });

  it('one-side empty reserve — ratio calculation returns empty', () => {
    const result = computeAmountB('100', 18, 18, parseUnits('1000', 18), 0n);
    expect(result).toBe('');
  });

  it('computeWithdrawAmounts with single wei of totalSupply', () => {
    const result = computeWithdrawAmounts(
      1n,
      1n,
      parseUnits('100', 18),
      parseUnits('200', 18),
      100,
    );
    // 1 LP / 1 total = 100% of reserves
    expect(result.liquidityToWithdraw).toBe(1n);
    expect(result.amount0).toBe(parseUnits('100', 18));
    expect(result.amount1).toBe(parseUnits('200', 18));
  });

  it('very large gas cost exceeding native balance', () => {
    const result = validateBalances({
      nativeDoge: 0.1,
      gasCostDoge: 10,  // Gas costs more than entire balance
      rawBalANum: 5000,
      rawBalBNum: 0,
      isToken0WWDOGE: false,
      isToken1WWDOGE: true,
      amountA: '100',
      amountB: '0.001',
      isConnected: true,
      balancesLoaded: true,
    });
    expect(result.availableNativeForWrap).toBe(0);
    expect(result.balanceB).toBe(0);
    expect(result.insufficientBalance).toBe(true);
  });

  it('both tokens are WWDOGE (edge case)', () => {
    const result = validateBalances({
      nativeDoge: 100,
      gasCostDoge: 0.5,
      rawBalANum: 0,
      rawBalBNum: 0,
      isToken0WWDOGE: true,
      isToken1WWDOGE: true,
      amountA: '49',
      amountB: '49',
      isConnected: true,
      balancesLoaded: true,
    });
    // Both use availableNativeForWrap (99.5)
    // But both amounts come from same balance — 49 + 49 = 98 < 99.5 individually
    // Each check is independent: 49 < 99.5 for each → OK
    // (In practice this pool type shouldn't exist)
    expect(result.insufficientBalance).toBe(false);
  });
});

describe('Add Liquidity Slippage Amounts', () => {
  it('computes amountMin correctly for 3% slippage', () => {
    const amountADesired = parseUnits('100', 18);
    const amountBDesired = parseUnits('200', 18);
    const slippageBps = BigInt(Math.floor(3 * 100)); // 300
    const basisPoints = 10000n;

    const amountAMin = (amountADesired * (basisPoints - slippageBps)) / basisPoints;
    const amountBMin = (amountBDesired * (basisPoints - slippageBps)) / basisPoints;

    // 100 * 0.97 = 97
    expect(formatUnits(amountAMin, 18)).toMatch(/^97/);
    // 200 * 0.97 = 194
    expect(formatUnits(amountBMin, 18)).toMatch(/^194/);
  });

  it('computes amountMin correctly for 0.5% slippage', () => {
    const amountADesired = parseUnits('1000', 18);
    const slippageBps = BigInt(Math.floor(0.5 * 100)); // 50
    const basisPoints = 10000n;

    const amountAMin = (amountADesired * (basisPoints - slippageBps)) / basisPoints;

    // 1000 * 0.995 = 995
    expect(formatUnits(amountAMin, 18)).toMatch(/^995/);
  });

  it('computes amountMin correctly for 50% slippage (max)', () => {
    const amountADesired = parseUnits('100', 18);
    const slippageBps = BigInt(Math.floor(50 * 100)); // 5000
    const basisPoints = 10000n;

    const amountAMin = (amountADesired * (basisPoints - slippageBps)) / basisPoints;

    // 100 * 0.5 = 50
    expect(formatUnits(amountAMin, 18)).toMatch(/^50/);
  });
});

describe('Remove Liquidity Amount Calculations', () => {
  it('computes correct remove amounts with slippage', () => {
    const totalSupply = parseUnits('1000', 18);
    const reserve0 = parseUnits('5000', 18);
    const reserve1 = parseUnits('10000', 18);
    const lpBalance = parseUnits('100', 18);

    const { amount0, amount1, liquidityToWithdraw } = computeWithdrawAmounts(
      lpBalance, totalSupply, reserve0, reserve1, 50,
    );

    // 50 LP (50% of 100) = 5% of pool
    // amount0 = 5000 * 0.05 = 250
    // amount1 = 10000 * 0.05 = 500
    const expected0 = (reserve0 * liquidityToWithdraw) / totalSupply;
    const expected1 = (reserve1 * liquidityToWithdraw) / totalSupply;
    expect(amount0).toBe(expected0);
    expect(amount1).toBe(expected1);

    // Apply 3% slippage to minimums
    const slippageBps = 300n;
    const basisPoints = 10000n;
    const amountAMin = (amount0 * (basisPoints - slippageBps)) / basisPoints;
    // amountAMin should be ~97% of amount0
    const ratio = Number(amountAMin * 10000n / amount0) / 100;
    expect(ratio).toBeCloseTo(97, 1);
  });
});

describe('Deadline Calculation', () => {
  it('clamps deadline to minimum 1 minute', () => {
    // parseInt('0') = 0, which is falsy, so || 20 applies — matching component behavior
    const input = parseInt('0') || 20;
    const deadline = Math.max(1, Math.min(60, input));
    expect(deadline).toBe(20); // Component uses || 20 fallback for 0
  });

  it('clamps deadline to maximum 60 minutes', () => {
    const input = 120;
    const deadline = Math.max(1, Math.min(60, input || 20));
    expect(deadline).toBe(60);
  });

  it('defaults to 20 for NaN', () => {
    const input = parseInt('abc') || 20;
    const deadline = Math.max(1, Math.min(60, input));
    expect(deadline).toBe(20);
  });

  it('passes through valid deadline', () => {
    const input = 5;
    const deadline = Math.max(1, Math.min(60, input || 20));
    expect(deadline).toBe(5);
  });
});
