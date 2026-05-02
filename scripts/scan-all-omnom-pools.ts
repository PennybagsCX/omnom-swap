/**
 * Comprehensive OMNOM Pool Scanner
 *
 * Uses Multicall3 via viem to batch hundreds of RPC calls into single requests.
 * Enumerates ALL pairs from ALL factory contracts to find every OMNOM pair.
 *
 * Usage: npx tsx scripts/scan-all-omnom-pools.ts
 */

import { createPublicClient, http, parseAbi, getAddress } from 'viem';
import { dogechain } from 'wagmi/chains';

const OMNOM = '0xe3fca919883950c5cd468156392a6477ff5d18de'.toLowerCase();

const FACTORIES = [
  { name: 'DogeSwap', address: '0xd27d9d61590874bf9ee2a19b27e265399929c9c3' as `0x${string}`, dexId: 'dogeswap' },
  { name: 'DogeShrk', address: '0x7c10a3b7ecd42dd7d79c0b9d58ddb812f92b574a' as `0x${string}`, dexId: 'dogeshrek' },
  { name: 'WOJAK', address: '0xc7c86B4f940Ff1C13c736b697e3FbA5a6Bc979F9' as `0x${string}`, dexId: 'wojak' },
  { name: 'KibbleSwap', address: '0xF4bc79D32A7dEfd87c8A9C100FD83206bbF19Af5' as `0x${string}`, dexId: 'kibbleswap' },
  { name: 'YodeSwap', address: '0xaAa04462e35F3E40d798331657CA015169E005d7' as `0x${string}`, dexId: 'yodeswap' },
  { name: 'FraxSwap', address: '0x67b7DA7c0564c6aC080f0A6D9fB4675e52E6bF1d' as `0x${string}`, dexId: 'fraxswap' },
  { name: 'ToolSwap', address: '0xC3550497E591Ac6ed7a7E03ffC711CfB7412E57F' as `0x${string}`, dexId: 'toolswap' },
  { name: 'DMUSK', address: '0x4e5E0739231A3BdE1c51188aCfEabC19983541E6' as `0x${string}`, dexId: 'dmusk' },
  { name: 'IceCreamSwap', address: '0x9E6d21E759A7A288b80eef94E4737D313D31c13f' as `0x${string}`, dexId: 'icecreamswap' },
  { name: 'PupSwap', address: '0x0EBfEdC4A97D6B761a63Ad7c0a989e384ad59b3d' as `0x${string}`, dexId: 'pupswap' },
  { name: 'Bourbon Defi', address: '0x6B09Aa7a03d918b08C8924591fc792ce9d80CBb5' as `0x${string}`, dexId: 'bourbondefi' },
  { name: 'BreadFactory', address: '0xBeE74FA515808793Dc283f3Dd28720Ada56BAf17' as `0x${string}`, dexId: 'breadfactory' },
];

const factoryAbi = parseAbi([
  'function allPairsLength() external view returns (uint256)',
  'function allPairs(uint256) external view returns (address)',
]);

const pairAbi = parseAbi([
  'function token0() external view returns (address)',
  'function token1() external view returns (address)',
]);

const client = createPublicClient({
  chain: dogechain,
  transport: http(),
  batch: { multicall: { batchSize: 500 } },
});

interface OmnomPair {
  pairAddress: string;
  dexName: string;
  dexId: string;
  token0: string;
  token1: string;
  otherToken: string;
}

async function scanFactory(factory: typeof FACTORIES[number]): Promise<OmnomPair[]> {
  // Get total pair count
  const pairCount = await client.readContract({
    address: factory.address,
    abi: factoryAbi,
    functionName: 'allPairsLength',
  }) as bigint;

  console.log(`${factory.name}: ${pairCount} total pairs`);

  if (pairCount === 0n) return [];

  // Batch read all pair addresses via multicall
  const BATCH_SIZE = 500;
  const pairAddresses: string[] = [];

  for (let i = 0n; i < pairCount; i += BigInt(BATCH_SIZE)) {
    const end = i + BigInt(BATCH_SIZE) > pairCount ? pairCount : i + BigInt(BATCH_SIZE);
    const calls = [];
    for (let j = i; j < end; j++) {
      calls.push(
        client.readContract({
          address: factory.address,
          abi: factoryAbi,
          functionName: 'allPairs',
          args: [j],
        }) as Promise<string>
      );
    }
    const results = await Promise.all(calls);
    pairAddresses.push(...results.map((r: string) => r.toLowerCase()));
  }

  console.log(`  Got ${pairAddresses.length} pair addresses`);

  // Batch check token0/token1 for OMNOM
  const omnomPairs: OmnomPair[] = [];
  const TOKEN_BATCH = 200;

  for (let i = 0; i < pairAddresses.length; i += TOKEN_BATCH) {
    const batch = pairAddresses.slice(i, i + TOKEN_BATCH);
    const calls = batch.flatMap(addr => [
      client.readContract({
        address: getAddress(addr) as `0x${string}`,
        abi: pairAbi,
        functionName: 'token0',
      }) as Promise<string>,
      client.readContract({
        address: getAddress(addr) as `0x${string}`,
        abi: pairAbi,
        functionName: 'token1',
      }) as Promise<string>,
    ]);

    const results = await Promise.all(calls);

    for (let j = 0; j < batch.length; j++) {
      const t0 = (results[j * 2] as string).toLowerCase();
      const t1 = (results[j * 2 + 1] as string).toLowerCase();

      if (t0 === OMNOM || t1 === OMNOM) {
        omnomPairs.push({
          pairAddress: batch[j],
          dexName: factory.name,
          dexId: factory.dexId,
          token0: t0,
          token1: t1,
          otherToken: t0 === OMNOM ? t1 : t0,
        });
      }
    }
  }

  console.log(`  → ${omnomPairs.length} OMNOM pairs`);
  return omnomPairs;
}

async function main() {
  console.log('=== Comprehensive OMNOM Pool Scanner ===\n');
  console.log(`Scanning ${FACTORIES.length} factories for ALL OMNOM pairs...\n`);

  const allPools: OmnomPair[] = [];
  const seen = new Set<string>();

  for (const factory of FACTORIES) {
    try {
      const pools = await scanFactory(factory);
      for (const p of pools) {
        if (!seen.has(p.pairAddress)) {
          seen.add(p.pairAddress);
          allPools.push(p);
        }
      }
    } catch (e: any) {
      console.log(`  ERROR: ${e.message}`);
    }
  }

  console.log(`\n========================================`);
  console.log(`TOTAL: ${allPools.length} unique OMNOM pairs`);
  console.log(`========================================\n`);

  // Group by other token
  const byToken: Record<string, OmnomPair[]> = {};
  for (const p of allPools) {
    byToken[p.otherToken] = byToken[p.otherToken] || [];
    byToken[p.otherToken].push(p);
  }

  console.log('Pairs by other token:');
  for (const [token, pools] of Object.entries(byToken).sort((a, b) => b[1].length - a[1].length)) {
    console.log(`  ${token} (${pools.length} pool${pools.length > 1 ? 's' : ''}): ${pools.map(p => p.dexName).join(', ')}`);
  }

  console.log('\nAll pairs (JSON):');
  console.log(JSON.stringify(allPools, null, 2));
}

main().catch(console.error);
