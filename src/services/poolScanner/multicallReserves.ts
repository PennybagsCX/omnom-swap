/**
 * Multicall3 Reserves Fetcher — Batch-fetches pool state via viem's multicall.
 *
 * Uses viem's built-in multicall (which calls Multicall3 aggregate3 internally)
 * to batch hundreds of getReserves() + totalSupply() calls into single requests.
 * Checks all 176 hardcoded pools in ~2 seconds instead of minutes.
 */

import {
  createPublicClient,
  http,
  parseAbi,
  type Address,
} from 'viem';
import { dogechain } from 'wagmi/chains';

const pairAbi = parseAbi([
  'function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
  'function totalSupply() external view returns (uint256)',
]);

export interface PoolReserves {
  pairAddress: string;
  reserve0: bigint;
  reserve1: bigint;
  totalSupply: bigint;
  hasLiquidity: boolean;
  category: 'active' | 'abandoned';
}

const client = createPublicClient({
  chain: dogechain,
  transport: http(),
  batch: { multicall: true },
});

const MULTICALL_BATCH_SIZE = 100;

export async function fetchAllReserves(pairAddresses: string[]): Promise<PoolReserves[]> {
  if (pairAddresses.length === 0) return [];

  const results: PoolReserves[] = [];

  for (let i = 0; i < pairAddresses.length; i += MULTICALL_BATCH_SIZE) {
    const batch = pairAddresses.slice(i, i + MULTICALL_BATCH_SIZE);

    // Build multicall contracts: 2 calls per pool (getReserves + totalSupply)
    const contracts = batch.flatMap(addr => {
      const pairAddr = addr as Address;
      return [
        {
          address: pairAddr,
          abi: pairAbi,
          functionName: 'getReserves' as const,
        },
        {
          address: pairAddr,
          abi: pairAbi,
          functionName: 'totalSupply' as const,
        },
      ];
    });

    const multicallResult = await client.multicall({ contracts, allowFailure: true });

    for (let j = 0; j < batch.length; j++) {
      const reservesResult = multicallResult[j * 2];
      const supplyResult = multicallResult[j * 2 + 1];

      let reserve0 = 0n;
      let reserve1 = 0n;
      let totalSupply = 0n;

      if (reservesResult.status === 'success' && reservesResult.result) {
        const decoded = reservesResult.result as [bigint, bigint, number];
        reserve0 = decoded[0];
        reserve1 = decoded[1];
      }

      if (supplyResult.status === 'success' && supplyResult.result) {
        totalSupply = supplyResult.result as bigint;
      }

      const hasLiquidity = reserve0 > 0n || reserve1 > 0n;

      results.push({
        pairAddress: batch[j],
        reserve0,
        reserve1,
        totalSupply,
        hasLiquidity,
        category: hasLiquidity ? 'active' : 'abandoned',
      });
    }
  }

  return results;
}
