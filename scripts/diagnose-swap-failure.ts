/**
 * OMNOM SWAP — Transaction Failure Diagnostic Script
 *
 * Comprehensive Viem-based diagnostic that performs all checks needed to
 * pinpoint the exact root cause of a failing swap transaction on Dogechain.
 *
 * Run with:  npx tsx scripts/diagnose-swap-failure.ts
 *
 * Phases:
 *   1. Token Analysis (name, symbol, decimals, balance, allowance, transferability, tax)
 *   2. Pool & Liquidity Analysis (pool existence, reserves, expected output vs minTotalAmountOut)
 *   3. Router & Contract State (supportedRouters, paused, aggregator balances/allowances)
 *   4. Full Swap Simulation (eth_call staticcall with exact failing params + variations)
 *   5. Structured Diagnostic Report
 */

import {
  createPublicClient,
  http,
  parseAbi,
  type Address,
  type Hex,
  encodeFunctionData,
  decodeErrorResult,
  formatUnits,
  zeroAddress,
} from 'viem';
import { dogechain } from 'wagmi/chains';

// ═══════════════════════════════════════════════════════════════════════════
// Configuration — Failing Transaction Parameters
// ═══════════════════════════════════════════════════════════════════════════

const SENDER: Address = '0x22F4194F6706E70aBaA14AB352D0baA6C7ceD24a';
const AGGREGATOR: Address = '0xb6eae524325cc31bb0f3d9af7bb63b4dc991b58a';
const TOKEN_IN: Address = '0xB9fcAa7590916578087842e017078D7797Fa18D0';
const TOKEN_OUT: Address = '0xb7ddc6414bf4f5515b52d8bdd69973ae205ff101'; // WWDOGE
const AMOUNT_IN = 27000000000000000000000n; // 27,000 × 10¹⁸
const MIN_TOTAL_AMOUNT_OUT = 58162281171110712550n; // ~58.16 WWDOGE
const TOOLSWAP_ROUTER: Address = '0x9bbf70e64fbe8fc7afe8a5ae90f2db1165013f93';
const TOOLSWAP_FACTORY: Address = '0xC3550497E591Ac6ed7a7E03ffC711CfB7412E57F';
const TOOLSWAP_FACTORY_ALIAS: Address = '0xaF85e6eD0Da6f7F5F86F2f5A7d595B1b0F35706C';
const DEADLINE = 1778326705n;
const TREASURY: Address = '0x628f3F4A82791D1d6dEC2Aebe7d648e53fF4FA88';

// ═══════════════════════════════════════════════════════════════════════════
// ABIs
// ═══════════════════════════════════════════════════════════════════════════

const ERC20_ABI = parseAbi([
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function totalSupply() view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function transferFrom(address from, address to, uint256 amount) returns (bool)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'function approve(address spender, uint256 amount) returns (bool)',
]);

const TAX_ABI = parseAbi([
  'function taxRate() view returns (uint256)',
  'function _taxFee() view returns (uint256)',
  'function buyTotalFees() view returns (uint256)',
  'function sellTotalFees() view returns (uint256)',
  'function _taxFeeBps() view returns (uint256)',
]);

const FACTORY_ABI = parseAbi([
  'function getPair(address tokenA, address tokenB) view returns (address)',
]);

const PAIR_ABI = parseAbi([
  'function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
  'function token0() view returns (address)',
  'function token1() view returns (address)',
  'function totalSupply() view returns (uint256)',
]);


const AGGREGATOR_ABI = parseAbi([
  'function supportedRouters(address) view returns (bool)',
  'function paused() view returns (bool)',
  'function owner() view returns (address)',
  'function treasury() view returns (address)',
  'function protocolFeeBps() view returns (uint256)',
  'function WWDOGE() view returns (address)',
  'function executeSwap((address tokenIn, address tokenOut, uint256 amountIn, uint256 minTotalAmountOut, (address router, address[] path, uint256 amountIn, uint256 minAmountOut)[] steps, uint256 deadline, address recipient) request) external payable',
]);

// ═══════════════════════════════════════════════════════════════════════════
// Client Setup
// ═══════════════════════════════════════════════════════════════════════════

const client = createPublicClient({
  chain: dogechain,
  transport: http('https://rpc.dogechain.dog'),
});

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

interface DiagnosticResult {
  check: string;
  passed: boolean;
  value?: string;
  error?: string;
  severity: 'INFO' | 'WARN' | 'FAIL' | 'PASS';
}

const results: DiagnosticResult[] = [];

function addResult(check: string, passed: boolean, severity: DiagnosticResult['severity'], value?: string, error?: string) {
  results.push({ check, passed, value, error, severity });
}

function formatBigInt(val: bigint, decimals: number = 18): string {
  return formatUnits(val, decimals);
}

function separator(title: string) {
  console.log(`\n${'═'.repeat(70)}`);
  console.log(`  ${title}`);
  console.log(`${'═'.repeat(70)}`);
}

async function safeCall<T>(fn: () => Promise<T>): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    const data = await fn();
    return { ok: true, data };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 1: Token Analysis
// ═══════════════════════════════════════════════════════════════════════════

async function phase1_tokenAnalysis() {
  separator('PHASE 1: Token Analysis');

  // 1a. Basic token info
  console.log('\n── tokenIn Metadata ──');
  const nameRes = await safeCall(() => client.readContract({
    address: TOKEN_IN, abi: ERC20_ABI, functionName: 'name',
  }));
  if (nameRes.ok) {
    console.log(`  name(): ${nameRes.data}`);
    addResult('tokenIn.name', true, 'INFO', nameRes.data);
  } else {
    console.log(`  name(): FAILED — ${nameRes.error}`);
    addResult('tokenIn.name', false, 'WARN', undefined, nameRes.error);
  }

  const symbolRes = await safeCall(() => client.readContract({
    address: TOKEN_IN, abi: ERC20_ABI, functionName: 'symbol',
  }));
  if (symbolRes.ok) {
    console.log(`  symbol(): ${symbolRes.data}`);
    addResult('tokenIn.symbol', true, 'INFO', symbolRes.data);
  } else {
    console.log(`  symbol(): FAILED — ${symbolRes.error}`);
    addResult('tokenIn.symbol', false, 'WARN', undefined, symbolRes.error);
  }

  const decimalsRes = await safeCall(() => client.readContract({
    address: TOKEN_IN, abi: ERC20_ABI, functionName: 'decimals',
  }));
  const decimals = decimalsRes.ok ? decimalsRes.data : 18n;
  console.log(`  decimals(): ${decimalsRes.ok ? decimals : 'FAILED — ' + decimalsRes.error}`);
  addResult('tokenIn.decimals', decimalsRes.ok, decimalsRes.ok ? 'INFO' : 'WARN', decimalsRes.ok ? String(decimals) : undefined);

  const supplyRes = await safeCall(() => client.readContract({
    address: TOKEN_IN, abi: ERC20_ABI, functionName: 'totalSupply',
  }));
  if (supplyRes.ok) {
    console.log(`  totalSupply(): ${formatBigInt(supplyRes.data, Number(decimals))} (${supplyRes.data})`);
    addResult('tokenIn.totalSupply', true, 'INFO', formatBigInt(supplyRes.data, Number(decimals)));
  } else {
    console.log(`  totalSupply(): FAILED — ${supplyRes.error}`);
    addResult('tokenIn.totalSupply', false, 'WARN', undefined, supplyRes.error);
  }

  // 1b. Sender balance
  console.log('\n── Sender Balance & Allowance ──');
  const balRes = await safeCall(() => client.readContract({
    address: TOKEN_IN, abi: ERC20_ABI, functionName: 'balanceOf', args: [SENDER],
  }));
  if (balRes.ok) {
    const sufficient = balRes.data >= AMOUNT_IN;
    console.log(`  Sender tokenIn balance: ${formatBigInt(balRes.data, Number(decimals))}`);
    console.log(`  Required amountIn:      ${formatBigInt(AMOUNT_IN, Number(decimals))}`);
    console.log(`  Sufficient balance:      ${sufficient ? '✅ YES' : '❌ NO'}`);
    addResult('sender.balance >= amountIn', sufficient, sufficient ? 'PASS' : 'FAIL',
      `balance=${formatBigInt(balRes.data, Number(decimals))}, required=${formatBigInt(AMOUNT_IN, Number(decimals))}`);
  } else {
    console.log(`  Sender balance: FAILED — ${balRes.error}`);
    addResult('sender.balance', false, 'FAIL', undefined, balRes.error);
  }

  // 1c. Allowance to aggregator
  const allowRes = await safeCall(() => client.readContract({
    address: TOKEN_IN, abi: ERC20_ABI, functionName: 'allowance', args: [SENDER, AGGREGATOR],
  }));
  if (allowRes.ok) {
    const sufficient = allowRes.data >= AMOUNT_IN;
    console.log(`  Allowance to aggregator: ${formatBigInt(allowRes.data, Number(decimals))}`);
    console.log(`  Sufficient allowance:    ${sufficient ? '✅ YES' : '❌ NO'}`);
    addResult('sender.allowance >= amountIn', sufficient, sufficient ? 'PASS' : 'FAIL',
      `allowance=${formatBigInt(allowRes.data, Number(decimals))}`);
  } else {
    console.log(`  Allowance: FAILED — ${allowRes.error}`);
    addResult('sender.allowance', false, 'FAIL', undefined, allowRes.error);
  }

  // 1d. Staticcall transferFrom tests
  console.log('\n── Transfer Simulation (staticcall) ──');
  const transfer0Res = await safeCall(() => client.simulateContract({
    account: SENDER,
    address: TOKEN_IN,
    abi: ERC20_ABI,
    functionName: 'transferFrom',
    args: [SENDER, AGGREGATOR, 0n],
  }));
  console.log(`  transferFrom(sender, aggregator, 0): ${transfer0Res.ok ? '✅ OK' : '❌ REVERT — ' + transfer0Res.error}`);
  addResult('transferFrom(0)', transfer0Res.ok, transfer0Res.ok ? 'PASS' : 'FAIL', undefined, transfer0Res.ok ? undefined : transfer0Res.error);

  const transfer1Res = await safeCall(() => client.simulateContract({
    account: SENDER,
    address: TOKEN_IN,
    abi: ERC20_ABI,
    functionName: 'transferFrom',
    args: [SENDER, AGGREGATOR, 1n],
  }));
  console.log(`  transferFrom(sender, aggregator, 1): ${transfer1Res.ok ? '✅ OK' : '❌ REVERT — ' + transfer1Res.error}`);
  addResult('transferFrom(1)', transfer1Res.ok, transfer1Res.ok ? 'PASS' : 'FAIL', undefined, transfer1Res.ok ? undefined : transfer1Res.error);

  const transferFullRes = await safeCall(() => client.simulateContract({
    account: SENDER,
    address: TOKEN_IN,
    abi: ERC20_ABI,
    functionName: 'transferFrom',
    args: [SENDER, AGGREGATOR, AMOUNT_IN],
  }));
  console.log(`  transferFrom(sender, aggregator, amountIn): ${transferFullRes.ok ? '✅ OK' : '❌ REVERT — ' + transferFullRes.error}`);
  addResult('transferFrom(amountIn)', transferFullRes.ok, transferFullRes.ok ? 'PASS' : 'FAIL', undefined, transferFullRes.ok ? undefined : transferFullRes.error);

  // 1e. Tax detection
  console.log('\n── Tax Function Detection ──');
  const taxFunctions = ['taxRate', '_taxFee', 'buyTotalFees', 'sellTotalFees', '_taxFeeBps'] as const;
  let taxDetected = false;
  for (const fn of taxFunctions) {
    const res = await safeCall(() => client.readContract({
      address: TOKEN_IN, abi: TAX_ABI, functionName: fn,
    }));
    if (res.ok) {
      console.log(`  ${fn}(): ${res.data}`);
      addResult(`tax.${fn}`, true, 'WARN', String(res.data));
      taxDetected = true;
    } else {
      console.log(`  ${fn}(): not found / reverted`);
    }
  }
  if (!taxDetected) {
    console.log('  ℹ️  No standard tax functions detected');
    addResult('taxDetection', true, 'INFO', 'No standard tax functions found');
  }

  return Number(decimals);
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 2: Pool & Liquidity Analysis
// ═══════════════════════════════════════════════════════════════════════════

async function phase2_poolAnalysis(decimals: number) {
  separator('PHASE 2: Pool & Liquidity Analysis');

  // 2a. Check pool on ToolSwap Factory
  console.log('\n── ToolSwap Factory Pool Check ──');
  const pairRes = await safeCall(() => client.readContract({
    address: TOOLSWAP_FACTORY, abi: FACTORY_ABI, functionName: 'getPair', args: [TOKEN_IN, TOKEN_OUT],
  }));
  let pairAddress: Address | null = null;

  if (pairRes.ok && pairRes.data !== zeroAddress) {
    pairAddress = pairRes.data as Address;
    console.log(`  ✅ Pool exists: ${pairAddress}`);
    addResult('toolSwap.poolExists', true, 'PASS', pairAddress);
  } else {
    console.log(`  ❌ Pool does NOT exist on ToolSwap Factory`);
    addResult('toolSwap.poolExists', false, 'FAIL', pairRes.ok ? 'zero address' : pairRes.error);
  }

  // 2b. Check alternate factory
  console.log('\n── ToolSwap Factory Alias Pool Check ──');
  const altPairRes = await safeCall(() => client.readContract({
    address: TOOLSWAP_FACTORY_ALIAS, abi: FACTORY_ABI, functionName: 'getPair', args: [TOKEN_IN, TOKEN_OUT],
  }));
  let altPairAddress: Address | null = null;

  if (altPairRes.ok && altPairRes.data !== zeroAddress) {
    altPairAddress = altPairRes.data as Address;
    console.log(`  ✅ Pool exists on alias factory: ${altPairAddress}`);
    addResult('toolSwapAlias.poolExists', true, 'PASS', altPairAddress);
  } else {
    console.log(`  ❌ Pool does NOT exist on ToolSwap Factory Alias`);
    addResult('toolSwapAlias.poolExists', false, 'WARN', altPairRes.ok ? 'zero address' : altPairRes.error);
  }

  // 2c. If pool exists, analyze reserves
  const activePair = pairAddress || altPairAddress;
  if (activePair) {
    console.log(`\n── Reserve Analysis (pair: ${activePair}) ──`);

    const token0Res = await safeCall(() => client.readContract({
      address: activePair, abi: PAIR_ABI, functionName: 'token0',
    }));
    const token1Res = await safeCall(() => client.readContract({
      address: activePair, abi: PAIR_ABI, functionName: 'token1',
    }));
    const reservesRes = await safeCall(() => client.readContract({
      address: activePair, abi: PAIR_ABI, functionName: 'getReserves',
    }));

    if (token0Res.ok && token1Res.ok && reservesRes.ok) {
      const [reserve0, reserve1] = reservesRes.data;
      const token0 = token0Res.data as Address;
      const token1 = token1Res.data as Address;

      console.log(`  token0: ${token0}`);
      console.log(`  token1: ${token1}`);
      console.log(`  reserve0: ${formatBigInt(reserve0, decimals)} (${reserve0})`);
      console.log(`  reserve1: ${formatBigInt(reserve1, 18)})`); // WWDOGE is 18 decimals

      // Determine which reserve is which
      const isToken0Input = token0.toLowerCase() === TOKEN_IN.toLowerCase();
      const reserveIn = isToken0Input ? reserve0 : reserve1;
      const reserveOut = isToken0Input ? reserve1 : reserve0;

      console.log(`\n  reserveIn (tokenIn):  ${formatBigInt(reserveIn, decimals)}`);
      console.log(`  reserveOut (WWDOGE):  ${formatBigInt(reserveOut, 18)}`);

      // Calculate expected output using constant product formula with 0.3% fee
      // amountOut = (swapAmount * 997 * reserveOut) / (reserveIn * 1000 + swapAmount * 997)
      const feeBps = 25n; // protocol fee 0.25%
      const swapAmount = AMOUNT_IN - (AMOUNT_IN * feeBps) / 10000n;
      const numerator = swapAmount * 997n * reserveOut;
      const denominator = reserveIn * 1000n + swapAmount * 997n;
      const expectedOutput = numerator / denominator;

      console.log(`\n  ── Expected Output Calculation ──`);
      console.log(`  amountIn:         ${formatBigInt(AMOUNT_IN, decimals)}`);
      console.log(`  protocolFeeBps:   ${feeBps} (0.25%)`);
      console.log(`  swapAmount:       ${formatBigInt(swapAmount, decimals)} (after fee)`);
      console.log(`  expectedOutput:   ${formatBigInt(expectedOutput, 18)} WWDOGE`);
      console.log(`  minTotalAmountOut:${formatBigInt(MIN_TOTAL_AMOUNT_OUT, 18)} WWDOGE`);
      console.log(`  Output >= min?    ${expectedOutput >= MIN_TOTAL_AMOUNT_OUT ? '✅ YES' : '❌ NO — SLIPPAGE EXCEEDED'}`);

      const slippageOk = expectedOutput >= MIN_TOTAL_AMOUNT_OUT;
      addResult('expectedOutput >= minTotalAmountOut', slippageOk, slippageOk ? 'PASS' : 'FAIL',
        `expected=${formatBigInt(expectedOutput, 18)}, min=${formatBigInt(MIN_TOTAL_AMOUNT_OUT, 18)}`);

      // Check reserve sufficiency
      const reserveSufficient = reserveOut > expectedOutput;
      console.log(`  Reserve sufficient? ${reserveSufficient ? '✅ YES' : '❌ NO — INSUFFICIENT LIQUIDITY'}`);
      addResult('reserveSufficient', reserveSufficient, reserveSufficient ? 'PASS' : 'FAIL',
        `reserveOut=${formatBigInt(reserveOut, 18)}, expectedOut=${formatBigInt(expectedOutput, 18)}`);

      if (reserveIn === 0n || reserveOut === 0n) {
        console.log(`  ⚠️  One or both reserves are ZERO — pool is empty!`);
        addResult('reservesNonZero', false, 'FAIL', 'One or both reserves are zero');
      } else {
        addResult('reservesNonZero', true, 'PASS', 'Both reserves > 0');
      }
    } else {
      const reserveErr = !reservesRes.ok ? reservesRes.error : !token0Res.ok ? token0Res.error : !token1Res.ok ? token1Res.error : 'unknown error';
      console.log(`  ❌ Failed to read reserves: ${reserveErr}`);
      addResult('getReserves', false, 'FAIL', undefined, reserveErr);
    }
  } else {
    console.log('\n  ⚠️  No pool found on either factory — cannot analyze reserves');
    addResult('poolAnalysis', false, 'FAIL', 'No pool exists for this token pair');
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 3: Router & Contract State
// ═══════════════════════════════════════════════════════════════════════════

async function phase3_routerAndContractState() {
  separator('PHASE 3: Router & Contract State');

  // 3a. Supported routers
  console.log('\n── Aggregator Router Registration ──');
  const routerRes = await safeCall(() => client.readContract({
    address: AGGREGATOR, abi: AGGREGATOR_ABI, functionName: 'supportedRouters', args: [TOOLSWAP_ROUTER],
  }));
  if (routerRes.ok) {
    console.log(`  supportedRouters(ToolSwap): ${routerRes.data ? '✅ REGISTERED' : '❌ NOT REGISTERED'}`);
    addResult('supportedRouters(ToolSwap)', routerRes.data, routerRes.data ? 'PASS' : 'FAIL');
  } else {
    console.log(`  supportedRouters(ToolSwap): FAILED — ${routerRes.error}`);
    addResult('supportedRouters(ToolSwap)', false, 'FAIL', undefined, routerRes.error);
  }

  // 3b. Paused state
  console.log('\n── Aggregator Pause State ──');
  const pausedRes = await safeCall(() => client.readContract({
    address: AGGREGATOR, abi: AGGREGATOR_ABI, functionName: 'paused',
  }));
  if (pausedRes.ok) {
    console.log(`  paused(): ${pausedRes.data ? '❌ YES — TRADING PAUSED' : '✅ NO — Trading active'}`);
    addResult('paused', !pausedRes.data, pausedRes.data ? 'FAIL' : 'PASS');
  } else {
    console.log(`  paused(): FAILED — ${pausedRes.error}`);
    addResult('paused', false, 'FAIL', undefined, pausedRes.error);
  }

  // 3c. Aggregator config
  console.log('\n── Aggregator Configuration ──');
  const ownerRes = await safeCall(() => client.readContract({
    address: AGGREGATOR, abi: AGGREGATOR_ABI, functionName: 'owner',
  }));
  if (ownerRes.ok) console.log(`  owner(): ${ownerRes.data}`);

  const treasuryRes = await safeCall(() => client.readContract({
    address: AGGREGATOR, abi: AGGREGATOR_ABI, functionName: 'treasury',
  }));
  if (treasuryRes.ok) {
    console.log(`  treasury(): ${treasuryRes.data}`);
    const treasuryMatch = (treasuryRes.data as Address).toLowerCase() === TREASURY.toLowerCase();
    console.log(`  treasury matches expected: ${treasuryMatch ? '✅ YES' : '⚠️ NO'}`);
  }

  const feeRes = await safeCall(() => client.readContract({
    address: AGGREGATOR, abi: AGGREGATOR_ABI, functionName: 'protocolFeeBps',
  }));
  if (feeRes.ok) console.log(`  protocolFeeBps(): ${feeRes.data} (${Number(feeRes.data) / 100}%)`);

  const wwdogeRes = await safeCall(() => client.readContract({
    address: AGGREGATOR, abi: AGGREGATOR_ABI, functionName: 'WWDOGE',
  }));
  if (wwdogeRes.ok) {
    const wwdogeMatch = (wwdogeRes.data as Address).toLowerCase() === TOKEN_OUT.toLowerCase();
    console.log(`  WWDOGE(): ${wwdogeRes.data} ${wwdogeMatch ? '✅ matches tokenOut' : '⚠️ MISMATCH'}`);
  }

  // 3d. Aggregator tokenIn balance (leftover from previous failed swaps)
  console.log('\n── Aggregator Token Balances ──');
  const aggBalRes = await safeCall(() => client.readContract({
    address: TOKEN_IN, abi: ERC20_ABI, functionName: 'balanceOf', args: [AGGREGATOR],
  }));
  if (aggBalRes.ok) {
    console.log(`  Aggregator tokenIn balance: ${formatBigInt(aggBalRes.data)} (${aggBalRes.data})`);
    if (aggBalRes.data > 0n) {
      console.log(`  ⚠️  Aggregator has leftover tokenIn — possible previous failed swap`);
    }
    addResult('aggregator.tokenInBalance', aggBalRes.data === 0n, aggBalRes.data > 0n ? 'WARN' : 'PASS',
      formatBigInt(aggBalRes.data));
  }

  // 3e. Aggregator allowance to ToolSwap Router
  console.log('\n── Aggregator Allowance to Router ──');
  const aggAllowRes = await safeCall(() => client.readContract({
    address: TOKEN_IN, abi: ERC20_ABI, functionName: 'allowance', args: [AGGREGATOR, TOOLSWAP_ROUTER],
  }));
  if (aggAllowRes.ok) {
    console.log(`  Aggregator → ToolSwap Router allowance: ${formatBigInt(aggAllowRes.data)}`);
    // Note: The aggregator uses safeApprove before each swap, so this is informational
    addResult('aggregator.allowanceToRouter', true, 'INFO', formatBigInt(aggAllowRes.data));
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 4: Full Swap Simulation
// ═══════════════════════════════════════════════════════════════════════════

async function phase4_swapSimulation() {
  separator('PHASE 4: Full Swap Simulation');

  // Build the SwapRequest struct matching the failing transaction
  const swapRequestData = {
    tokenIn: TOKEN_IN,
    tokenOut: TOKEN_OUT,
    amountIn: AMOUNT_IN,
    minTotalAmountOut: MIN_TOTAL_AMOUNT_OUT,
    steps: [{
      router: TOOLSWAP_ROUTER,
      path: [TOKEN_IN, TOKEN_OUT],
      amountIn: AMOUNT_IN,
      minAmountOut: 0n, // Individual step minAmountOut
    }],
    deadline: DEADLINE,
    recipient: SENDER,
  };

  // 4a. Exact failing transaction simulation
  console.log('\n── Simulation 1: Exact Failing Parameters ──');
  const calldata = encodeFunctionData({
    abi: AGGREGATOR_ABI,
    functionName: 'executeSwap',
    args: [swapRequestData],
  });

  const sim1Res = await safeCall(() => client.call({
    to: AGGREGATOR,
    data: calldata as Hex,
    account: SENDER,
  }));
  if (sim1Res.ok) {
    console.log(`  ✅ Simulation succeeded (unexpected — transaction may have been fixed)`);
    addResult('sim.exact', true, 'PASS');
  } else {
    console.log(`  ❌ Simulation reverted:`);
    console.log(`     ${sim1Res.error}`);
    // Try to decode the revert reason
    try {
      const revertData = extractRevertData(sim1Res.error);
      if (revertData) {
        const decoded = decodeErrorResult({ abi: AGGREGATOR_ABI, data: revertData });
        console.log(`  Decoded revert: ${decoded.errorName}${decoded.args ? ': ' + decoded.args.join(', ') : ''}`);
        addResult('sim.exact.revertReason', false, 'FAIL', decoded.errorName);
      } else {
        addResult('sim.exact.revertReason', false, 'FAIL', undefined, sim1Res.error);
      }
    } catch {
      // Try to extract a readable revert string
      const match = sim1Res.error.match(/reverted with reason string '(.+?)'/);
      if (match) {
        console.log(`  Revert reason: ${match[1]}`);
        addResult('sim.exact.revertReason', false, 'FAIL', match[1]);
      } else {
        addResult('sim.exact.revertReason', false, 'FAIL', undefined, sim1Res.error);
      }
    }
  }

  // 4b. Fresh deadline simulation
  console.log('\n── Simulation 2: Fresh Deadline (now + 300s) ──');
  const block = await client.getBlock();
  const freshDeadline = block.timestamp + BigInt(300);

  const freshDeadlineData = {
    ...swapRequestData,
    deadline: freshDeadline,
  };
  const calldata2 = encodeFunctionData({
    abi: AGGREGATOR_ABI,
    functionName: 'executeSwap',
    args: [freshDeadlineData],
  });

  const sim2Res = await safeCall(() => client.call({
    to: AGGREGATOR,
    data: calldata2 as Hex,
    account: SENDER,
  }));
  if (sim2Res.ok) {
    console.log(`  ✅ Succeeds with fresh deadline — deadline was the issue!`);
    addResult('sim.freshDeadline', true, 'PASS', 'Deadline was the root cause');
  } else {
    const match = sim2Res.error.match(/reverted with reason string '(.+?)'/);
    console.log(`  ❌ Still reverts: ${match ? match[1] : sim2Res.error}`);
    addResult('sim.freshDeadline', false, 'FAIL', match ? match[1] : undefined, sim2Res.error);
  }

  // 4c. Zero slippage simulation
  console.log('\n── Simulation 3: minTotalAmountOut = 0 (no slippage) ──');
  const zeroSlippageData = {
    ...swapRequestData,
    deadline: freshDeadline,
    minTotalAmountOut: BigInt(0),
    steps: [{
      ...swapRequestData.steps[0],
      minAmountOut: BigInt(0),
    }],
  };
  const calldata3 = encodeFunctionData({
    abi: AGGREGATOR_ABI,
    functionName: 'executeSwap',
    args: [zeroSlippageData],
  });

  const sim3Res = await safeCall(() => client.call({
    to: AGGREGATOR,
    data: calldata3 as Hex,
    account: SENDER,
  }));
  if (sim3Res.ok) {
    console.log(`  ✅ Succeeds with zero slippage — slippage was the issue!`);
    addResult('sim.zeroSlippage', true, 'PASS', 'Slippage protection was too tight');
  } else {
    const match = sim3Res.error.match(/reverted with reason string '(.+?)'/);
    console.log(`  ❌ Still reverts: ${match ? match[1] : sim3Res.error}`);
    addResult('sim.zeroSlippage', false, 'FAIL', match ? match[1] : undefined, sim3Res.error);
  }

  // 4d. Deadline analysis
  console.log('\n── Deadline Analysis ──');
  console.log(`  Transaction deadline: ${DEADLINE} (${new Date(Number(DEADLINE) * 1000).toISOString()})`);
  console.log(`  Current block time:   ${block.timestamp} (${new Date(Number(block.timestamp) * 1000).toISOString()})`);
  const deadlineExpired = block.timestamp > DEADLINE;
  console.log(`  Deadline expired?     ${deadlineExpired ? '❌ YES — DEADLINE IS IN THE PAST' : '✅ NO'}`);
  // Also check the MIN_DEADLINE_BUFFER constraint
  const minBuffer = BigInt(60); // 1 minute from contract
  const deadlineBufferOk = DEADLINE >= block.timestamp + minBuffer;
  console.log(`  Deadline >= now + 60s? ${deadlineBufferOk ? '✅ YES' : '❌ NO — fails MIN_DEADLINE_BUFFER check'}`);
  addResult('deadline.expired', !deadlineExpired, deadlineExpired ? 'FAIL' : 'PASS',
    `deadline=${DEADLINE}, now=${block.timestamp}`);
  addResult('deadline.minBuffer', deadlineBufferOk, deadlineBufferOk ? 'PASS' : 'FAIL',
    `deadline must be >= now + 60s`);
}

/**
 * Extract hex revert data from a Viem error message.
 */
function extractRevertData(errorMsg: string): Hex | null {
  // Viem typically includes the revert data as 0x... in the error message
  const match = errorMsg.match(/(0x[0-9a-fA-F]{8,})/);
  if (match) {
    return match[1] as Hex;
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 5: Diagnostic Report
// ═══════════════════════════════════════════════════════════════════════════

function phase5_report() {
  separator('PHASE 5: Diagnostic Report');

  const failures = results.filter(r => r.severity === 'FAIL');
  const warnings = results.filter(r => r.severity === 'WARN');
  const passes = results.filter(r => r.severity === 'PASS');

  console.log('\n── Summary ──');
  console.log(`  Total checks: ${results.length}`);
  console.log(`  ✅ Passed:    ${passes.length}`);
  console.log(`  ⚠️  Warnings: ${warnings.length}`);
  console.log(`  ❌ Failed:    ${failures.length}`);

  if (failures.length > 0) {
    console.log('\n── ❌ Failed Checks ──');
    for (const f of failures) {
      console.log(`  • ${f.check}: ${f.value || f.error || 'Failed'}`);
    }
  }

  if (warnings.length > 0) {
    console.log('\n── ⚠️ Warnings ──');
    for (const w of warnings) {
      console.log(`  • ${w.check}: ${w.value || w.error || 'Warning'}`);
    }
  }

  // Root cause analysis
  console.log('\n── 🔍 Root Cause Analysis ──');

  const poolExists = results.find(r => r.check === 'toolSwap.poolExists' || r.check === 'toolSwapAlias.poolExists');
  const balanceOk = results.find(r => r.check === 'sender.balance >= amountIn');
  const allowanceOk = results.find(r => r.check === 'sender.allowance >= amountIn');
  const deadlineOk = results.find(r => r.check === 'deadline.expired');
  const deadlineBufferOk = results.find(r => r.check === 'deadline.minBuffer');
  const routerOk = results.find(r => r.check === 'supportedRouters(ToolSwap)');
  const pausedOk = results.find(r => r.check === 'paused');
  const transferOk = results.find(r => r.check === 'transferFrom(amountIn)');
  const slippageOk = results.find(r => r.check === 'expectedOutput >= minTotalAmountOut');
  const simFreshDeadline = results.find(r => r.check === 'sim.freshDeadline');
  const simZeroSlippage = results.find(r => r.check === 'sim.zeroSlippage');

  const rootCauses: string[] = [];

  if (poolExists && !poolExists.passed) {
    rootCauses.push('🔴 CRITICAL: No liquidity pool exists for this token pair on ToolSwap. The swap cannot execute without a pool.');
  }

  if (deadlineOk && !deadlineOk.passed) {
    rootCauses.push('🔴 CRITICAL: The deadline has expired. The transaction deadline is in the past, which causes an immediate revert in executeSwap.');
  }

  if (deadlineBufferOk && !deadlineBufferOk.passed) {
    rootCauses.push('🟠 HIGH: The deadline fails the MIN_DEADLINE_BUFFER check (must be >= now + 60s). Even if not fully expired, it is too close to current time.');
  }

  if (routerOk && !routerOk.passed) {
    rootCauses.push('🔴 CRITICAL: ToolSwap router is not registered in the aggregator. The swap will revert with "Unsupported router".');
  }

  if (pausedOk && !pausedOk.passed) {
    rootCauses.push('🔴 CRITICAL: The aggregator contract is paused. All swaps are blocked.');
  }

  if (balanceOk && !balanceOk.passed) {
    rootCauses.push('🟠 HIGH: Sender does not have sufficient tokenIn balance for this swap.');
  }

  if (allowanceOk && !allowanceOk.passed) {
    rootCauses.push('🟠 HIGH: Sender has not approved sufficient tokenIn to the aggregator contract.');
  }

  if (transferOk && !transferOk.passed) {
    rootCauses.push('🟠 HIGH: Token transferFrom reverts — the token may have transfer restrictions or anti-contract mechanics that block the aggregator.');
  }

  if (slippageOk && !slippageOk.passed) {
    rootCauses.push('🟡 MEDIUM: Expected output is below minTotalAmountOut — the pool has insufficient liquidity or the price has moved.');
  }

  if (simFreshDeadline && simFreshDeadline.passed) {
    rootCauses.push('✅ CONFIRMED: Using a fresh deadline fixes the issue. Root cause is deadline expiration.');
  }

  if (simZeroSlippage && simZeroSlippage.passed) {
    rootCauses.push('✅ CONFIRMED: Using minTotalAmountOut=0 fixes the issue. Root cause is slippage protection.');
  }

  if (rootCauses.length === 0) {
    console.log('  ℹ️  No definitive root cause identified from individual checks. The issue may be a combination of factors or an edge case in the swap execution path.');
  } else {
    for (const cause of rootCauses) {
      console.log(`  ${cause}`);
    }
  }

  // Suggested fixes
  console.log('\n── 💡 Suggested Fixes ──');
  if (deadlineOk && !deadlineOk.passed) {
    console.log('  1. Use a fresh deadline: `Math.floor(Date.now() / 1000) + 300` (5 minutes from now)');
  }
  if (poolExists && !poolExists.passed) {
    console.log('  2. Find a DEX that has a pool for this token pair, or create one');
    console.log('     Check other factories (DogeSwap, KibbleSwap, etc.) for pools');
  }
  if (routerOk && !routerOk.passed) {
    console.log('  3. Register the ToolSwap router in the aggregator contract (requires owner)');
  }
  if (transferOk && !transferOk.passed) {
    console.log('  4. The token appears to have transfer restrictions — it may not be compatible with DEX aggregation');
  }
  if (slippageOk && !slippageOk.passed) {
    console.log('  5. Increase slippage tolerance or reduce the swap amount');
  }
  if (balanceOk && !balanceOk.passed) {
    console.log('  6. Ensure the sender wallet has sufficient token balance');
  }
  if (allowanceOk && !allowanceOk.passed) {
    console.log('  7. Call approve(aggregator, amountIn) or approve(aggregator, MAX_UINT256) on the token contract');
  }

  console.log('\n' + '═'.repeat(70));
  console.log('  Diagnostic complete.');
  console.log('═'.repeat(70) + '\n');
}

// ═══════════════════════════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════════════════════════

async function main() {
  console.log('╔══════════════════════════════════════════════════════════════════╗');
  console.log('║  OMNOM SWAP — Transaction Failure Diagnostic                   ║');
  console.log('╠══════════════════════════════════════════════════════════════════╣');
  console.log(`║  Sender:     ${SENDER}`);
  console.log(`║  Aggregator: ${AGGREGATOR}`);
  console.log(`║  tokenIn:    ${TOKEN_IN}`);
  console.log(`║  tokenOut:   ${TOKEN_OUT} (WWDOGE)`);
  console.log(`║  amountIn:   ${formatBigInt(AMOUNT_IN)} tokens`);
  console.log(`║  Router:     ${TOOLSWAP_ROUTER}`);
  console.log('╚══════════════════════════════════════════════════════════════════╝');

  try {
    const decimals = await phase1_tokenAnalysis();
    await phase2_poolAnalysis(decimals);
    await phase3_routerAndContractState();
    await phase4_swapSimulation();
    phase5_report();
  } catch (err) {
    console.error('\n💥 Fatal error during diagnostic:', err);
    phase5_report();
  }
}

main();
