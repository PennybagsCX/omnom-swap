
import masterTokenList from '../data/dogechain-tokens.json';

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
  YODESWAP_FACTORY: '0xaAa04462e35F3E40d798331657CA015169E005d7',
  // FraxSwap (Dogechain) — UniswapV2 compatible
  FRAXSWAP_ROUTER: '0x0f6A5c5F341791e897eB1FB8fE8B4e30EC4F9bDf',
  FRAXSWAP_FACTORY: '0x67b7DA7c0564c6aC080f0A6D9fB4675e52E6bF1d',
  // ToolSwap (Dogechain) — standard UniswapV2 with WETH (not WDOGE)
  TOOLSWAP_ROUTER: '0x9BBF70e64fbe8Fc7afE8a5Ae90F2DB1165013F93',
  TOOLSWAP_FACTORY: '0xC3550497E591Ac6ed7a7E03ffC711CfB7412E57F',
  // ToolSwap alias — alternative factory deployed by same deployer, same router, 34 pairs
  TOOLSWAP_FACTORY_ALIAS: '0xaF85e6eD0Da6f7F5F86F2f5A7d595B1b0F35706C',
  // DMUSK (Dogechain) — branded fork, DMUSK token, staking pools, 24 pairs, deprecated
  DMUSK_FACTORY: '0x4e5E0739231A3BdE1c51188aCfEabC19983541E6',
  DMUSK_ROUTER: '0xaa4B2479C4c10B917Faa98Cc7c2B24D99BFA2174',
  // IceCreamSwap V2 (Dogechain) — multi-chain UniswapV2 fork, WETH()=WWDOGE
  ICECREAMSWAP_ROUTER: '0xBb5e1777A331ED93E07cF043363e48d320eb96c4',
  ICECREAMSWAP_FACTORY: '0x9E6d21E759A7A288b80eef94E4737D313D31c13f',
  // PupSwap (Dogechain) — UniswapV2 compatible, WETH()=WWDOGE, 95 pairs
  PUPSWAP_ROUTER: '0x05F2a20AF837268Be340a3bF82BB87069cF4a8C3',
  PUPSWAP_FACTORY: '0x0EBfEdC4A97D6B761a63Ad7c0a989e384ad59b3d',
  // Bourbon Defi (Dogechain) — UniswapV2 compatible, WETH()=WWDOGE, 113 pairs
  BOURBONSWAP_ROUTER: '0x6B172911a5Af8C9Eb2B7759688204624CcC9b0Ee',
  BOURBONSWAP_FACTORY: '0x6B09Aa7a03d918b08C8924591fc792ce9d80CBb5',
  // BreadFactory (Dogechain) — UniswapV2 compatible, WETH()=WWDOGE, active OMNOM/WWDOGE pool
  BREADFACTORY_ROUTER: '0x270AB932F923813378cCac2853a2c391279ff0Ed',
  BREADFACTORY_FACTORY: '0xBeE74FA515808793Dc283f3Dd28720Ada56BAf17',
}

// ─── Contract Reference (Disclosures Page) ──────────────────────────────────
// NOTE: Must be defined after OMNOMSWAP_AGGREGATOR_ADDRESS and AGGREGATOR_KNOWN_STATE.

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
  { label: 'FraxSwap Router', address: CONTRACTS.FRAXSWAP_ROUTER },
  { label: 'FraxSwap Factory', address: CONTRACTS.FRAXSWAP_FACTORY },
  { label: 'ToolSwap Router', address: CONTRACTS.TOOLSWAP_ROUTER },
  { label: 'ToolSwap Factory', address: CONTRACTS.TOOLSWAP_FACTORY },
  { label: 'ToolSwap Factory Alias', address: CONTRACTS.TOOLSWAP_FACTORY_ALIAS },
  { label: 'DMUSK Router', address: CONTRACTS.DMUSK_ROUTER },
  { label: 'DMUSK Factory', address: CONTRACTS.DMUSK_FACTORY },
  { label: 'IceCreamSwap Router', address: CONTRACTS.ICECREAMSWAP_ROUTER },
  { label: 'IceCreamSwap Factory', address: CONTRACTS.ICECREAMSWAP_FACTORY },
  { label: 'PupSwap Router', address: CONTRACTS.PUPSWAP_ROUTER },
  { label: 'PupSwap Factory', address: CONTRACTS.PUPSWAP_FACTORY },
  { label: 'Bourbon Defi Router', address: CONTRACTS.BOURBONSWAP_ROUTER },
  { label: 'Bourbon Defi Factory', address: CONTRACTS.BOURBONSWAP_FACTORY },
  { label: 'BreadFactory Router', address: CONTRACTS.BREADFACTORY_ROUTER },
  { label: 'BreadFactory Factory', address: CONTRACTS.BREADFACTORY_FACTORY },
  { label: 'OmnomSwap Aggregator', address: '0x88F81031b258A0Fb789AC8d3A8071533BFADeC14', link: 'address' },
  { label: 'Protocol Treasury', address: '0x628f3F4A82791D1d6dEC2Aebe7d648e53fF4FA88', link: 'address' },
] as const;

// Dogechain Bubblemaps — deep-link URL for $OMNOM holder bubble map
export const BUBBLEMAP_URL = `https://www.dogechain-bubblemaps.xyz/?token=${CONTRACTS.OMNOM_TOKEN}&view=analysis&type=TOKEN`;

// OMNOM/WWDOGE pool - the primary pool for this DEX.
// L-08: This is hardcoded because the direct swap screen only quotes against
// this pool. Other pairs fall through to V3/V2 router quotes.
export const OMNOM_WWDOGE_POOL = '0x5bf60ea5cf2383f407f09cf38378176298238a6c';

// Known token icon overrides — tokens with local images in /public/tokens/
const TOKEN_ICONS: Record<string, string> = {
  [CONTRACTS.WWDOGE.toLowerCase()]: '/tokens/wwdoge.webp',
  [CONTRACTS.OMNOM_TOKEN.toLowerCase()]: '/tokens/omnom.png',
  [CONTRACTS.DC_TOKEN.toLowerCase()]: '/tokens/dc.webp',
  [CONTRACTS.DINU_TOKEN.toLowerCase()]: '/tokens/dinu.webp',
};

export const TOKENS = (masterTokenList as { address: string; symbol: string; name: string; decimals: number }[]).map((t) => {
  const addr = t.address.toLowerCase();
  const icon = TOKEN_ICONS[addr];
  return {
    symbol: t.symbol,
    name: t.name,
    balance: 0,
    address: t.address,
    icon,
    isImage: !!icon,
    isNative: addr === CONTRACTS.WWDOGE.toLowerCase(),
    decimals: t.decimals,
  };
});

export type TokenType = typeof TOKENS[number];

// Helper to check if a token is native WWDOGE/DOGE
export function isNativeToken(token: { symbol: string; address: string }): boolean {
  return token.symbol === 'WWDOGE' || token.symbol === 'DOGE' || token.address === CONTRACTS.WWDOGE;
}

// DogeSwap-native tokens — the only tokens shown in Direct Swap mode
export const DOGESWAP_NATIVE_TOKENS = new Set([
  CONTRACTS.WWDOGE.toLowerCase(),
  CONTRACTS.OMNOM_TOKEN.toLowerCase(),
  CONTRACTS.DC_TOKEN.toLowerCase(),
  CONTRACTS.DINU_TOKEN.toLowerCase(),
]) as ReadonlySet<string>;

export function isDogeSwapNativeToken(token: { address: string }): boolean {
  return DOGESWAP_NATIVE_TOKENS.has(token.address.toLowerCase());
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
  if (lower.includes('frax')) {
    return CONTRACTS.FRAXSWAP_ROUTER as `0x${string}`;
  }
  if (lower.includes('tool')) {
    return CONTRACTS.TOOLSWAP_ROUTER as `0x${string}`;
  }
  if (lower.includes('icecream') || lower.includes('ice cream')) {
    return CONTRACTS.ICECREAMSWAP_ROUTER as `0x${string}`;
  }
  if (lower.includes('pup')) {
    return CONTRACTS.PUPSWAP_ROUTER as `0x${string}`;
  }
  if (lower.includes('bourbon')) {
    return CONTRACTS.BOURBONSWAP_ROUTER as `0x${string}`;
  }
  if (lower.includes('bread')) {
    return CONTRACTS.BREADFACTORY_ROUTER as `0x${string}`;
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
  if (lower.includes('frax')) {
    return CONTRACTS.FRAXSWAP_FACTORY as `0x${string}`;
  }
  if (lower.includes('tool')) {
    return CONTRACTS.TOOLSWAP_FACTORY as `0x${string}`;
  }
  if (lower.includes('icecream') || lower.includes('ice cream')) {
    return CONTRACTS.ICECREAMSWAP_FACTORY as `0x${string}`;
  }
  if (lower.includes('pup')) {
    return CONTRACTS.PUPSWAP_FACTORY as `0x${string}`;
  }
  if (lower.includes('bourbon')) {
    return CONTRACTS.BOURBONSWAP_FACTORY as `0x${string}`;
  }
  if (lower.includes('bread')) {
    return CONTRACTS.BREADFACTORY_FACTORY as `0x${string}`;
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
    lower.includes('yode') ||
    lower.includes('frax') ||
    lower.includes('tool') ||
    lower.includes('dmusk') ||
    lower.includes('icecream') ||
    lower.includes('ice cream') ||
    lower.includes('pup') ||
    lower.includes('bourbon') ||
    lower.includes('bread') ||
    lower === '0xbee74fa515808793dc283f3dd28720ada56baf17'
  );
}

// Human-readable names for supported DEXes (shown in LP modal warning)
export const KNOWN_DEX_NAMES = ['DogeSwap', 'DogeShrk', 'WOJAK Finance', 'KibbleSwap', 'YodeSwap', 'FraxSwap', 'ToolSwap', 'DMUSK', 'IceCreamSwap', 'PupSwap', 'Bourbon Defi'] as const;

// ─── DEX Display Name Resolution ───────────────────────────────────────────────

/**
 * Maps lowercase DexScreener dexId strings (programmatic identifiers) to
 * human-readable display names. DexScreener returns lowercase IDs like
 * "dogeshrek", "kibbleswap", "icecreamswap" — these need mapping to proper names.
 */
export const DEX_NAME_MAP: Record<string, string> = {
  // DexScreener lowercase IDs → Display names
  dogeswap:      'DogeSwap',
  dogeshrek:     'DogeShrk',
  dogeshrek_:    'DogeShrk',
  chewy:         'DogeShrk',     // DogeShrk also marketed as "Chewy"
  fraxswap:      'FraxSwap',
  kibbleswap:    'KibbleSwap',
  kibbleswap_:    'KibbleSwap',
  quickswap:     'QuickSwap',
  quickswap_dogechain: 'QuickSwap',
  yodeswap:      'YodeSwap',
  yodeswap_:      'YodeSwap',
  bourbondefi:   'Bourbon Defi',
  bourbon_defi:   'Bourbon Defi',
  sushiswap:      'SushiSwap',
  uniswap:        'Uniswap',
  wojak:          'WOJAK Finance',
  wojak_:         'WOJAK Finance',
  icecreamswap:   'IceCreamSwap',
  ice_cream_swap: 'IceCreamSwap',
  toolswap:       'ToolSwap',
  toolswap_:       'ToolSwap',
  dmusk:           'DMUSK',
  dmusk_:           'DMUSK',
  pupswap:        'PupSwap',
  pupswap_:        'PupSwap',
  pup:            'PupSwap',
  // Factory address (BreadFactory reports raw factory address as dexId)
  '0xbee74fa515808793dc283f3dd28720ada56baf17': 'BreadFactory',
};

// ─── Factory Address → DEX Name reverse lookup ────────────────────────────────
//
// DexScreener sometimes returns raw factory contract addresses as the dexId field.
// This table maps known factory addresses back to their human-readable DEX names.
const FACTORY_TO_DEX_NAME: Record<string, string> = {
  [CONTRACTS.DOGESWAP_FACTORY.toLowerCase()]:     'DogeSwap',
  [CONTRACTS.DOGESHRK_FACTORY.toLowerCase()]:     'DogeShrk',
  [CONTRACTS.WOJAK_FACTORY.toLowerCase()]:         'WOJAK Finance',
  [CONTRACTS.KIBBLESWAP_FACTORY.toLowerCase()]:   'KibbleSwap',
  [CONTRACTS.YODESWAP_FACTORY.toLowerCase()]:     'YodeSwap',
  [CONTRACTS.FRAXSWAP_FACTORY.toLowerCase()]:     'FraxSwap',
  [CONTRACTS.TOOLSWAP_FACTORY.toLowerCase()]:     'ToolSwap',
  [CONTRACTS.TOOLSWAP_FACTORY_ALIAS.toLowerCase()]: 'ToolSwap',
  [CONTRACTS.DMUSK_FACTORY.toLowerCase()]:         'DMUSK',
  [CONTRACTS.ICECREAMSWAP_FACTORY.toLowerCase()]: 'IceCreamSwap',
  [CONTRACTS.PUPSWAP_FACTORY.toLowerCase()]:       'PupSwap',
  [CONTRACTS.BOURBONSWAP_FACTORY.toLowerCase()]:   'Bourbon Defi',
  [CONTRACTS.BREADFACTORY_FACTORY.toLowerCase()]:   'BreadFactory',
};

// ─── Router Address → DEX Name reverse lookup ─────────────────────────────────
//
// DexScreener sometimes returns raw router contract addresses as the dexId field.
// This table maps known router addresses back to their human-readable DEX names.
const ROUTER_TO_DEX_NAME: Record<string, string> = {
  [CONTRACTS.DOGESWAP_V2_ROUTER.toLowerCase()]:   'DogeSwap',
  [CONTRACTS.DOGESHRK_V2_ROUTER.toLowerCase()]:   'DogeShrk',
  [CONTRACTS.WOJAK_ROUTER.toLowerCase()]:         'WOJAK Finance',
  [CONTRACTS.KIBBLESWAP_ROUTER.toLowerCase()]:   'KibbleSwap',
  [CONTRACTS.YODESWAP_ROUTER.toLowerCase()]:     'YodeSwap',
  [CONTRACTS.FRAXSWAP_ROUTER.toLowerCase()]:     'FraxSwap',
  [CONTRACTS.TOOLSWAP_ROUTER.toLowerCase()]:     'ToolSwap',
  [CONTRACTS.DMUSK_ROUTER.toLowerCase()]:         'DMUSK',
  [CONTRACTS.ICECREAMSWAP_ROUTER.toLowerCase()]: 'IceCreamSwap',
  [CONTRACTS.PUPSWAP_ROUTER.toLowerCase()]:       'PupSwap',
  [CONTRACTS.BOURBONSWAP_ROUTER.toLowerCase()]:   'Bourbon Defi',
  [CONTRACTS.BREADFACTORY_ROUTER.toLowerCase()]:   'BreadFactory',
};

/**
 * Resolve a DexScreener dexId to a human-readable display name.
 * Falls back to capitalize-from-id or raw dexId if no mapping exists.
 *
 * @param dexId - Raw dexId string from DexScreener API or pool data
 * @returns Human-readable DEX name
 */
export function resolveDexName(dexId: string | undefined | null): string {
  if (!dexId) return '—';

  const trimmed = dexId.trim();
  if (!trimmed) return '—';

  const lower = trimmed.toLowerCase();

  // 0. If it looks like a hex address, check the router→name registry first,
  // then factory→name registry (covers cases where DexScreener returns factory address)
  if (lower.startsWith('0x') && trimmed.length === 42) {
    const resolved = ROUTER_TO_DEX_NAME[lower];
    if (resolved) return resolved;
    // Also check factory addresses — DexScreener sometimes returns factory, not router
    const factoryResolved = FACTORY_TO_DEX_NAME[lower];
    if (factoryResolved) return factoryResolved;
    console.warn(`[resolveDexName] Unknown DEX address rendered: ${trimmed}`);
    return 'Unknown DEX'; // Show friendly label for unresolvable router addresses
  }

  // 1. Direct lookup in DEX_NAME_MAP
  const mapped = DEX_NAME_MAP[lower];
  if (mapped) return mapped;

  // 2. Check known DEX names list for case-insensitive match
  const knownMatch = KNOWN_DEX_NAMES.find(
    (name) => name.toLowerCase().replace(/\s+/g, '') === lower.replace(/\s+/g, ''),
  );
  if (knownMatch) return knownMatch;

  // 3. Check if dexId is a known DEX via isKnownDex pattern match
  // (includes 'dogeshrek', 'wojak', etc.) — return proper name
  if (lower.includes('dogeshrek') || lower.includes('chewy')) return 'DogeShrk';
  if (lower.includes('dogeswap')) return 'DogeSwap';
  if (lower.includes('wojak')) return 'WOJAK Finance';
  if (lower.includes('kibble')) return 'KibbleSwap';
  if (lower.includes('yode')) return 'YodeSwap';
  if (lower.includes('frax')) return 'FraxSwap';
  if (lower.includes('tool')) return 'ToolSwap';
  if (lower.includes('dmusk')) return 'DMUSK';
  if (lower.includes('icecream') || lower.includes('ice cream')) return 'IceCreamSwap';
  if (lower.includes('pup')) return 'PupSwap';
  if (lower.includes('bourbon')) return 'Bourbon Defi';

  // 5. Capitalize underscored_ids or return as-is
  if (lower.includes('_')) {
    return lower
      .split('_')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  return trimmed;
}

// Check if a router address uses standard ETH function names (addLiquidityETH, swapExactETHForTokens, etc.)
// DogeShrk, WOJAK, KibbleSwap, ToolSwap all use standard UniswapV2 naming (not WDOGE-specific)
export function isDogeshrkRouter(routerAddress: string): boolean {
  const lower = routerAddress.toLowerCase();
  return lower === CONTRACTS.DOGESHRK_V2_ROUTER.toLowerCase()
    || lower === CONTRACTS.WOJAK_ROUTER.toLowerCase()
    || lower === CONTRACTS.KIBBLESWAP_ROUTER.toLowerCase()
    || lower === CONTRACTS.YODESWAP_ROUTER.toLowerCase()
    || lower === CONTRACTS.FRAXSWAP_ROUTER.toLowerCase()
    || lower === CONTRACTS.TOOLSWAP_ROUTER.toLowerCase()
    || lower === CONTRACTS.DMUSK_ROUTER.toLowerCase()
    || lower === CONTRACTS.ICECREAMSWAP_ROUTER.toLowerCase()
    || lower === CONTRACTS.PUPSWAP_ROUTER.toLowerCase()
    || lower === CONTRACTS.BOURBONSWAP_ROUTER.toLowerCase()
    || lower === CONTRACTS.BREADFACTORY_ROUTER.toLowerCase();
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

// Deployed to Dogechain mainnet — 2026-05-01 (v6: all 12 routers, deadline validation)
// NOTE: The previous deployment at 0x8F8f0e68... has been replaced by the new aggregator
// at this address. All 12 routers (DogeSwap, DogeShrk, WOJAK, KibbleSwap, YodeSwap,
// FraxSwap, ToolSwap, DMUSK, IceCreamSwap, PupSwap, Bourbon Defi, BreadFactory) are registered.
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
  { name: 'FraxSwap', router: CONTRACTS.FRAXSWAP_ROUTER, factory: CONTRACTS.FRAXSWAP_FACTORY },
  { name: 'ToolSwap', router: CONTRACTS.TOOLSWAP_ROUTER, factory: CONTRACTS.TOOLSWAP_FACTORY },
  { name: 'IceCreamSwap', router: CONTRACTS.ICECREAMSWAP_ROUTER, factory: CONTRACTS.ICECREAMSWAP_FACTORY },
  { name: 'PupSwap', router: CONTRACTS.PUPSWAP_ROUTER, factory: CONTRACTS.PUPSWAP_FACTORY },
  { name: 'Bourbon Defi', router: CONTRACTS.BOURBONSWAP_ROUTER, factory: CONTRACTS.BOURBONSWAP_FACTORY },
] as const;
