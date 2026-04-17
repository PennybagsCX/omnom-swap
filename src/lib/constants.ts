
export const NETWORK_INFO = {
  chainId: 2000,
  rpcUrl: import.meta.env.VITE_RPC_URL || 'https://rpc.dogechain.dog',
  blockExplorer: 'https://explorer.dogechain.dog',
}

export const CONTRACTS = {
  WWDOGE: '0xb7ddc6414bf4f5515b52d8bdd69973ae205ff101',
  ALGEBRA_V3_ROUTER: '0x4aE2bD0666c76C7f39311b9B3e39b53C8D7C43Ea',
  DOGESWAP_V2_ROUTER: '0xa4ee06ce40cb7e8c04e127c1f7d3dfb7f7039c81',
  DOGESWAP_FACTORY: '0xd27d9d61590874bf9ee2a19b27e265399929c9c3', // NOTE: was previously misspelled as DOGEWAP_FACTORY (L-02 fix)
  ALGEBRA_QUOTER: '0xd8E1E7009802c914b0d39B31Fc1759A865b727B1',
  ALGEBRA_FACTORY: '0xd2480162Aa7F02Ead7BF4C127465446150D58452',
  DC_TOKEN: '0x7B4328c127B85369D9f82ca0503B000D09CF9180',
  DST_V2_TOKEN: '0x516f30111b5a65003c5f7cb35426eb608656ce01',
  OMNOM_TOKEN: '0xe3fca919883950c5cd468156392a6477ff5d18de',
  DINU_TOKEN: '0x8a764cf73438de795c98707b07034e577af54825',
  DOGESHRK_V2_ROUTER: '0x45afcf57f7e3f3b9ca70335e5e85e4f77dcc5087',
  DOGESHRK_FACTORY: '0x7c10a3b7ecd42dd7d79c0b9d58ddb812f92b574a',
  // WOJAK Finance (Dogechain) — standard UniswapV2 with WETH (not WDOGE)
  WOJAK_ROUTER: '0x9695906B4502D5397E6D21ff222e2C1a9e5654a9',
  WOJAK_FACTORY: '0xc7c86B4f940Ff1C13c736b697e3FbA5a6Bc979F9',
  // KibbleSwap (Dogechain) — standard UniswapV2 with WETH (not WDOGE)
  KIBBLESWAP_ROUTER: '0x6258c967337D3faF0C2ba3ADAe5656bA95419d5f',
  KIBBLESWAP_FACTORY: '0xF4bc79D32A7dEfd87c8A9C100FD83206bbF19Af5',
  // YodeSwap (Dogechain) — standard UniswapV2 with WETH (not WDOGE)
  YODESWAP_ROUTER: '0x72d85ab47fbfc5e7e04a8bcfca1601d8f8ce1a50',
  YODESWAP_FACTORY: '0xAaA04462e35F3E40d798331657CA015169E005d7',
}

// Structured contract reference list — used by PoolsScreen to render the
// "Contract Reference" section dynamically.  Adding a new entry here
// automatically surfaces it in the UI.
export const CONTRACT_REFERENCE: readonly { label: string; address: string; link?: 'token' | 'address' }[] = [
  { label: 'OMNOM Token', address: CONTRACTS.OMNOM_TOKEN, link: 'token' },
  { label: 'WWDOGE', address: CONTRACTS.WWDOGE },
  { label: 'Algebra V3 Router', address: CONTRACTS.ALGEBRA_V3_ROUTER },
  { label: 'Algebra V3 Quoter', address: CONTRACTS.ALGEBRA_QUOTER },
  { label: 'Algebra V3 Factory', address: CONTRACTS.ALGEBRA_FACTORY },
  { label: 'DogeSwap V2 Router', address: CONTRACTS.DOGESWAP_V2_ROUTER },
  { label: 'DogeSwap Factory', address: CONTRACTS.DOGESWAP_FACTORY },
  { label: 'DogeShrk V2 Router', address: CONTRACTS.DOGESHRK_V2_ROUTER },
  { label: 'DogeShrk Factory', address: CONTRACTS.DOGESHRK_FACTORY },
  { label: 'WOJAK Router', address: CONTRACTS.WOJAK_ROUTER },
  { label: 'WOJAK Factory', address: CONTRACTS.WOJAK_FACTORY },
  { label: 'KibbleSwap Router', address: CONTRACTS.KIBBLESWAP_ROUTER },
  { label: 'KibbleSwap Factory', address: CONTRACTS.KIBBLESWAP_FACTORY },
  { label: 'YodeSwap Router', address: CONTRACTS.YODESWAP_ROUTER },
  { label: 'YodeSwap Factory', address: CONTRACTS.YODESWAP_FACTORY },
] as const;

// Dogechain Bubblemaps — deep-link URL for $OMNOM holder bubble map
export const BUBBLEMAP_URL = `https://www.dogechain-bubblemaps.xyz/?token=${CONTRACTS.OMNOM_TOKEN}&view=analysis&type=TOKEN`;

// OMNOM/WWDOGE pool - the primary pool for this DEX.
// L-08: This is hardcoded because the direct swap screen only quotes against
// this pool. Other pairs fall through to V3/V2 router quotes.
export const OMNOM_WWDOGE_POOL = '0x5bf60ea5cf2383f407f09cf38378176298238a6c';

export const TOKENS = [
  { symbol: 'WWDOGE', name: 'Wrapped Doge', balance: 0, address: CONTRACTS.WWDOGE, icon: '/tokens/wwdoge.webp', isImage: true, isNative: true, decimals: 18 },
  { symbol: 'OMNOM', name: 'DogeEatDoge', balance: 0, address: CONTRACTS.OMNOM_TOKEN, icon: '/tokens/omnom.png', isImage: true, decimals: 18 },
  { symbol: 'DC', name: 'DogeChain Token', balance: 0, address: CONTRACTS.DC_TOKEN, icon: '/tokens/dc.webp', isImage: true, decimals: 18 },
  { symbol: 'DINU', name: 'Doge Inu', balance: 0, address: CONTRACTS.DINU_TOKEN, icon: '/tokens/dinu.webp', isImage: true, decimals: 18 },
  // M-04: DST token was defined in CONTRACTS but missing from TOKENS array
  { symbol: 'DST', name: 'Dogechain Swap Token', balance: 0, address: CONTRACTS.DST_V2_TOKEN, icon: undefined, isImage: false, decimals: 18 },
];

export type TokenType = typeof TOKENS[number];

// Helper to check if a token is native WWDOGE/DOGE
export function isNativeToken(token: { symbol: string; address: string }): boolean {
  return token.symbol === 'WWDOGE' || token.symbol === 'DOGE' || token.address === CONTRACTS.WWDOGE;
}

// Price impact thresholds (fractions, not percentages)
export const PRICE_IMPACT_LOW = 0.01;    // 1% — green, negligible
export const PRICE_IMPACT_WARN = 0.03;   // 3% — yellow, caution
export const PRICE_IMPACT_BLOCK = 0.10;  // 10% — red, transaction blocked

export function calcPriceImpact(amountIn: number, reserveIn: number): number {
  if (amountIn <= 0 || reserveIn <= 0) return 0;
  return amountIn / (reserveIn + amountIn);
}

export function impactColor(impact: number): string {
  if (impact >= PRICE_IMPACT_BLOCK) return 'text-red-400';
  if (impact >= PRICE_IMPACT_WARN) return 'text-yellow-400';
  if (impact >= PRICE_IMPACT_LOW) return 'text-white';
  return 'text-green-400';
}

// Max uint256 for unlimited approvals
export const MAX_UINT256 = BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff');

// Multi-DEX router resolution — returns the correct router for a given dexId
export function getRouterForDex(dexId: string): `0x${string}` {
  const lower = dexId.toLowerCase();
  if (lower.includes('dogeshrek') || lower.includes('chewy')) {
    return CONTRACTS.DOGESHRK_V2_ROUTER as `0x${string}`;
  }
  if (lower.includes('wojak')) {
    return CONTRACTS.WOJAK_ROUTER as `0x${string}`;
  }
  if (lower.includes('kibble')) {
    return CONTRACTS.KIBBLESWAP_ROUTER as `0x${string}`;
  }
  if (lower.includes('yode')) {
    return CONTRACTS.YODESWAP_ROUTER as `0x${string}`;
  }
  return CONTRACTS.DOGESWAP_V2_ROUTER as `0x${string}`;
}

// Multi-DEX factory resolution — returns the correct factory for a given dexId
export function getFactoryForDex(dexId: string): `0x${string}` {
  const lower = dexId.toLowerCase();
  if (lower.includes('dogeshrek') || lower.includes('chewy')) {
    return CONTRACTS.DOGESHRK_FACTORY as `0x${string}`;
  }
  if (lower.includes('wojak')) {
    return CONTRACTS.WOJAK_FACTORY as `0x${string}`;
  }
  if (lower.includes('kibble')) {
    return CONTRACTS.KIBBLESWAP_FACTORY as `0x${string}`;
  }
  if (lower.includes('yode')) {
    return CONTRACTS.YODESWAP_FACTORY as `0x${string}`;
  }
  return CONTRACTS.DOGESWAP_FACTORY as `0x${string}`;
}

// Check if a dexId is one we explicitly support with factory/router mappings.
// Unknown DEXes will fall back to DogeSwap addresses, which causes LP tx reverts.
export function isKnownDex(dexId: string): boolean {
  const lower = dexId.toLowerCase();
  return (
    lower.includes('dogeswap') ||
    lower.includes('dogeshrek') ||
    lower.includes('chewy') ||
    lower.includes('wojak') ||
    lower.includes('kibble') ||
    lower.includes('yode')
  );
}

// Human-readable names for supported DEXes (shown in LP modal warning)
export const KNOWN_DEX_NAMES = ['DogeSwap', 'DogeShrk', 'WOJAK Finance', 'KibbleSwap', 'YodeSwap'] as const;

// Check if a router address uses standard ETH function names (addLiquidityETH, swapExactETHForTokens, etc.)
// DogeShrk, WOJAK, and KibbleSwap all use standard UniswapV2 naming (not WDOGE-specific)
export function isDogeshrkRouter(routerAddress: string): boolean {
  const lower = routerAddress.toLowerCase();
  return lower === CONTRACTS.DOGESHRK_V2_ROUTER.toLowerCase()
    || lower === CONTRACTS.WOJAK_ROUTER.toLowerCase()
    || lower === CONTRACTS.KIBBLESWAP_ROUTER.toLowerCase()
    || lower === CONTRACTS.YODESWAP_ROUTER.toLowerCase();
}

import { parseAbi } from 'viem';

// WWDOGE (WETH-compatible wrapper) ABI — just the deposit/withdraw functions needed for wrapping
export const WWDOGE_ABI = parseAbi([
  'function deposit() external payable',
  'function withdraw(uint256 wad) external',
  'function balanceOf(address) external view returns (uint256)',
  'function allowance(address owner, address spender) external view returns (uint256)',
]);

// V2 Router ABI — covers both DogeSwap (WDOGE names) and DogeShrk (standard ETH names)
// Parsed to structured format via parseAbi() to avoid "Cannot use 'in' operator" errors
// when passed to wagmi hooks (useReadContract, writeContractAsync).
export const V2_ROUTER_ABI = parseAbi([
  // Swap functions — DogeSwap WDOGE-specific names
  'function swapExactWDOGEForTokens(uint amountOutMin, address[] memory path, address to, uint deadline) external payable returns (uint[] memory amounts)',
  'function swapExactTokensForWDOGE(uint amountIn, uint amountOutMin, address[] memory path, address to, uint deadline) external returns (uint[] memory amounts)',
  'function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] memory path, address to, uint deadline) external returns (uint[] memory amounts)',
  // Swap functions — standard Uniswap V2 ETH names (DogeShrk)
  'function swapExactETHForTokens(uint amountOutMin, address[] memory path, address to, uint deadline) external payable returns (uint[] memory amounts)',
  'function swapExactTokensForETH(uint amountIn, uint amountOutMin, address[] memory path, address to, uint deadline) external returns (uint[] memory amounts)',
  // LP functions — standard (works on both routers)
  'function addLiquidity(address tokenA, address tokenB, uint amountADesired, uint amountBDesired, uint amountAMin, uint amountBMin, address to, uint deadline) external returns (uint amountA, uint amountB, uint liquidity)',
  'function removeLiquidity(address tokenA, address tokenB, uint liquidity, uint amountAMin, uint amountBMin, address to, uint deadline) external returns (uint amountA, uint amountB)',
  // LP functions — DogeSwap WDOGE-specific names
  'function addLiquidityWDOGE(address token, uint amountTokenDesired, uint amountTokenMin, uint amountWDOGEMin, address to, uint deadline) external payable returns (uint amountToken, uint amountWWDOGE, uint liquidity)',
  'function removeLiquidityWDOGE(address token, uint liquidity, uint amountTokenMin, uint amountWDOGEMin, address to, uint deadline) external returns (uint amountToken, uint amountWWDOGE)',
  // LP functions — standard Uniswap V2 ETH names (DogeShrk)
  'function addLiquidityETH(address token, uint amountTokenDesired, uint amountTokenMin, uint amountETHMin, address to, uint deadline) external payable returns (uint amountToken, uint amountETH, uint liquidity)',
  'function removeLiquidityETH(address token, uint liquidity, uint amountTokenMin, uint amountETHMin, address to, uint deadline) external returns (uint amountToken, uint amountETH)',
  // Quote
  'function getAmountsOut(uint amountIn, address[] memory path) public view returns (uint[] memory amounts)',
]);

// LP Pair (pool) contract ABI fragments — parsed to structured format.
export const PAIR_ABI = parseAbi([
  'function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
  'function token0() external view returns (address)',
  'function token1() external view returns (address)',
  'function totalSupply() external view returns (uint256)',
  'function balanceOf(address) external view returns (uint256)',
  'function approve(address spender, uint256 amount) external returns (bool)',
  'function allowance(address owner, address spender) external view returns (uint256)',
  'function transfer(address to, uint256 amount) external returns (bool)',
  'function transferFrom(address from, address to, uint256 amount) external returns (bool)',
  'function mint(address to) external returns (uint256)',
  'function burn(address to) external returns (uint256 amount0, uint256 amount1)',
  'function swap(uint256 amount0Out, uint256 amount1Out, address to, bytes calldata data) external',
]);

// ─── OmnomSwap Aggregator Contract ────────────────────────────────────────────

// Deployed to Dogechain mainnet — 2026-04-17 (v4: fixed WWDOGE address)
export const OMNOMSWAP_AGGREGATOR_ADDRESS = '0x88F81031b258A0Fb789AC8d3A8071533BFADeC14' as `0x${string}`;

/** Known on-chain state for the deployed aggregator (used as fallback when RPC reads fail). */
export const AGGREGATOR_KNOWN_STATE = {
  treasury: '0x628f3F4A82791D1d6dEC2Aebe7d648e53fF4FA88' as `0x${string}`,
  protocolFeeBps: 25n,   // 25 bps = 0.25%
  wwdoge: '0xB7ddC6414bf4F5515b52D8BdD69973Ae205ff101' as `0x${string}`,
} as const;

/** Check whether the aggregator contract has been deployed (i.e. address is not the placeholder). */
export const isAggregatorDeployed = (): boolean =>
  OMNOMSWAP_AGGREGATOR_ADDRESS !== '0x0000000000000000000000000000000000000001';

/** Get decimals for a token by its address, falling back to 18. */
export function getTokenDecimals(tokenAddress: string): number {
  const t = TOKENS.find((tok) => tok.address.toLowerCase() === tokenAddress.toLowerCase());
  return t?.decimals ?? 18;
}

// Aggregator contract ABI — matches OmnomSwapAggregator.sol
// Parsed to structured format via parseAbi() to avoid "Cannot use 'in' operator" errors
// when passed to wagmi hooks (useReadContract, writeContractAsync).
export const OMNOMSWAP_AGGREGATOR_ABI = parseAbi([
  // Read functions
  'function owner() external view returns (address)',
  'function treasury() external view returns (address)',
  'function protocolFeeBps() external view returns (uint256)',
  'function WWDOGE() external view returns (address)',
  'function paused() external view returns (bool)',
  'function supportedRouters(address) external view returns (bool)',
  'function routerList(uint256) external view returns (address)',
  'function getRouterCount() external view returns (uint256)',
  // Write functions
  'function executeSwap((address tokenIn, address tokenOut, uint256 amountIn, uint256 minTotalAmountOut, (address router, address[] path, uint256 amountIn, uint256 minAmountOut)[] steps, uint256 deadline, address recipient) request) external payable returns (uint256)',
  'function addRouter(address router) external',
  'function removeRouter(address router) external',
  'function setTreasury(address _treasury) external',
  'function setProtocolFee(uint256 _bps) external',
  'function pause() external',
  'function unpause() external',
  'function rescueTokens(address token, uint256 amount) external',
  'function transferOwnership(address newOwner) external',
  // Receive function (reverts direct native transfers — use executeSwap)
  'receive() external payable',
  // Events
  'event SwapExecuted(address indexed user, address tokenIn, address tokenOut, uint256 amountIn, uint256 amountOut, uint256 feeCollected)',
  'event RouterAdded(address indexed router)',
  'event RouterRemoved(address indexed router)',
  'event TreasuryUpdated(address indexed oldTreasury, address indexed newTreasury)',
  'event ProtocolFeeUpdated(uint256 oldBps, uint256 newBps)',
  'event OwnershipTransferred(address indexed previousOwner, address indexed newOwner)',
  'event TokensRescued(address indexed token, uint256 amount)',
  'event Paused()',
  'event Unpaused()',
]);

// DEX registry for the aggregator — maps DEX names to router/factory pairs
export const DEX_REGISTRY = [
  { name: 'DogeSwap', router: CONTRACTS.DOGESWAP_V2_ROUTER, factory: CONTRACTS.DOGESWAP_FACTORY },
  { name: 'DogeShrk', router: CONTRACTS.DOGESHRK_V2_ROUTER, factory: CONTRACTS.DOGESHRK_FACTORY },
  { name: 'WOJAK Finance', router: CONTRACTS.WOJAK_ROUTER, factory: CONTRACTS.WOJAK_FACTORY },
  { name: 'KibbleSwap', router: CONTRACTS.KIBBLESWAP_ROUTER, factory: CONTRACTS.KIBBLESWAP_FACTORY },
  { name: 'YodeSwap', router: CONTRACTS.YODESWAP_ROUTER, factory: CONTRACTS.YODESWAP_FACTORY },
] as const;
