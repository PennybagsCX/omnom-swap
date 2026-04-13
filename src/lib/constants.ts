import { PawPrint, Bitcoin, Dog } from 'lucide-react';

export const NETWORK_INFO = {
  chainId: 2000,
  rpcUrl: 'https://rpc.dogechain.dog',
  blockExplorer: 'https://explorer.dogechain.dog',
}

export const CONTRACTS = {
  WWDOGE: '0xb7ddc6414bf4f5515b52d8bdd69973ae205ff101',
  ALGEBRA_V3_ROUTER: '0x4aE2bD0666c76C7f39311b9B3e39b53C8D7C43Ea',
  DOGESWAP_V2_ROUTER: '0xa4ee06ce40cb7e8c04e127c1f7d3dfb7f7039c81', // Active V2 router for price quoting
  ALGEBRA_QUOTER: '0xd8E1E7009802c914b0d39B31Fc1759A865b727B1', // V3 Quoter for accurate pricing
  ALGEBRA_FACTORY: '0xd2480162Aa7F02Ead7BF4C127465446150D58452',
  DC_TOKEN: '0x7B4328c127B85369D9f82ca0503B000D09CF9180',
  DST_V2_TOKEN: '0x516f30111b5a65003c5f7cb35426eb608656ce01',
  OMNOM_TOKEN: '0xe3fca919883950c5cd468156392a6477ff5d18de',
  DINU_TOKEN: '0x8a764cf73438de795c98707b07034e577af54825',
}

// OMNOM/WWDOGE pool - the primary pool for this DEX
export const OMNOM_WWDOGE_POOL = '0x5bf60ea5cf2383f407f09cf38378176298238a6c';

export const TOKENS = [
  { symbol: 'WWDOGE', name: 'Wrapped Doge', balance: 0, address: CONTRACTS.WWDOGE, icon: 'https://lh3.googleusercontent.com/aida-public/AB6AXuD33Ssm2WE6hLYmOKHoQGa8bgIWiahDkvTIHWLsSoH4nr303LaV7pMAJoqpEy9xlEZHDBwLAuCEyodi7A31ysbQwltZJe2zu4TawtiwvEF13jQ_U5bDEBghLERSdxgO3PuV2ZXoiPtwgkZti4BK0WsZUQ9R-4o6H1HIdz1Nmnymlq1kLWUovyO8go9zoontFfDgSnPPUdprcHOWXncXjSywG7XsDQxJwB6c1gXbyeoXcY7Ibk1h6xH3jzo72x80PNC4xP8HSZ7KhKFp', isImage: true, isNative: true },
  { symbol: 'OMNOM', name: 'DogeEatDoge', balance: 0, address: CONTRACTS.OMNOM_TOKEN, icon: PawPrint, isImage: false },
  { symbol: 'DC', name: 'DogeChain Token', balance: 0, address: CONTRACTS.DC_TOKEN, icon: Bitcoin, isImage: false },
  { symbol: 'DINU', name: 'Doge Inu', balance: 0, address: CONTRACTS.DINU_TOKEN, icon: Dog, isImage: false },
];

// Helper to check if a token is native WWDOGE/DOGE
export function isNativeToken(token: { symbol: string; address: string }): boolean {
  return token.symbol === 'WWDOGE' || token.symbol === 'DOGE' || token.address === CONTRACTS.WWDOGE;
}

// Max uint256 for unlimited approvals
export const MAX_UINT256 = BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff');

// V2 Router ABI — comprehensive (swap + LP + quote)
// DogeSwap V2 uses WDOGE-specific function names (not standard Uniswap ETH names)
export const V2_ROUTER_ABI = [
  // Swap functions
  'function swapExactWDOGEForTokens(uint amountOutMin, address[] memory path, address to, uint deadline) external payable returns (uint[] memory amounts)',
  'function swapExactTokensForWDOGE(uint amountIn, uint amountOutMin, address[] memory path, address to, uint deadline) external returns (uint[] memory amounts)',
  'function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] memory path, address to, uint deadline) external returns (uint[] memory amounts)',
  // LP functions (standard + WDOGE-specific)
  'function addLiquidity(address tokenA, address tokenB, uint amountADesired, uint amountBDesired, uint amountAMin, uint amountBMin, address to, uint deadline) external returns (uint amountA, uint amountB, uint liquidity)',
  'function addLiquidityWDOGE(address token, uint amountTokenDesired, uint amountTokenMin, uint amountWDOGEMin, address to, uint deadline) external payable returns (uint amountToken, uint amountWWDOGE, uint liquidity)',
  'function removeLiquidity(address tokenA, address tokenB, uint liquidity, uint amountAMin, uint amountBMin, address to, uint deadline) external returns (uint amountA, uint amountB)',
  'function removeLiquidityWDOGE(address token, uint liquidity, uint amountTokenMin, uint amountWDOGEMin, address to, uint deadline) external returns (uint amountToken, uint amountWWDOGE)',
  // Quote
  'function getAmountsOut(uint amountIn, address[] memory path) public view returns (uint[] memory amounts)',
] as const;

// LP Pair (pool) contract ABI fragments
export const PAIR_ABI = [
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
] as const;
