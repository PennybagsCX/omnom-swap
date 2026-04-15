import { useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useWatchContractEvent } from 'wagmi';
import { CONTRACTS } from '../lib/constants';
import { useToast } from '../components/ToastContext';

// ── Minimal ABI fragment for UniswapV2 factory PairCreated event ──
const FACTORY_ABI = [
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: 'token0', type: 'address' },
      { indexed: true, name: 'token1', type: 'address' },
      { indexed: false, name: 'pair', type: 'address' },
      { indexed: false, name: '', type: 'uint256' },
    ],
    name: 'PairCreated',
    type: 'event',
  },
] as const;

// ── Factory addresses to monitor for new OMNOM pairs ──
const FACTORIES = [
  { name: 'DogeSwap', address: CONTRACTS.DOGEWAP_FACTORY as `0x${string}` },
  { name: 'DogeShrk', address: CONTRACTS.DOGESHRK_FACTORY as `0x${string}` },
  { name: 'WOJAK', address: CONTRACTS.WOJAK_FACTORY as `0x${string}` },
  { name: 'Bourbon', address: CONTRACTS.BOURBON_FACTORY as `0x${string}` },
  { name: 'KibbleSwap', address: CONTRACTS.KIBBLESWAP_FACTORY as `0x${string}` },
  { name: 'YodeSwap', address: CONTRACTS.YODESWAP_FACTORY as `0x${string}` },
] as const;

// Normalised OMNOM address for comparison
const OMNOM = CONTRACTS.OMNOM_TOKEN.toLowerCase() as `0x${string}`;

/**
 * useNewPairMonitor
 *
 * Watches `PairCreated` events on all known UniswapV2-compatible factories.
 * When a new pair containing OMNOM is detected, it:
 *   1. Invalidates the pools query to trigger a full GeckoTerminal refetch
 *   2. Shows a toast notification to the user
 *
 * This supplements the 60-second GeckoTerminal polling with near-instant
 * on-chain detection of new OMNOM pools.
 */
export function useNewPairMonitor() {
  const queryClient = useQueryClient();
  const { addToast } = useToast();

  // Ref to avoid showing duplicate toasts for the same pair
  const seenPairs = useRef<Set<string>>(new Set());

  // Shared handler for all factory event logs
  const handleLogs = (factoryName: string) =>
    (logs: readonly unknown[]) => {
      try {
        for (const log of logs) {
          // Destructure the decoded log — viem decodes args when ABI is provided
          const args = (log as { args?: Record<string, unknown> }).args;
          if (!args) continue;

          const token0 = String(args.token0 ?? '').toLowerCase();
          const token1 = String(args.token1 ?? '').toLowerCase();
          const pair = String(args.pair ?? '').toLowerCase();

          // Skip if we've already seen this pair address
          if (seenPairs.current.has(pair)) continue;

          // Check if either token is OMNOM
          if (token0 === OMNOM || token1 === OMNOM) {
            seenPairs.current.add(pair);

            console.log(`[useNewPairMonitor] New OMNOM pair on ${factoryName}: ${pair}`);

            // Invalidate all OMNOM-related queries so GeckoTerminal data refreshes
            queryClient.invalidateQueries({ queryKey: ['omnomPoolsList'] });
            queryClient.invalidateQueries({ queryKey: ['omnomPool'] });

            addToast({
              type: 'success',
              title: 'New OMNOM Pool Detected!',
              message: `Found on ${factoryName}. Refreshing pool data...`,
            });
          }
        }
      } catch (err) {
        // Log but don't crash — GeckoTerminal polling is the fallback
        console.error('[useNewPairMonitor] Error processing logs:', err);
      }
    };

  // Watch all four factories. Each call returns a cleanup function via useEffect.
  // We call the hook unconditionally (rules of hooks) — if the address is undefined
  // the hook simply won't subscribe.
  useWatchContractEvent({
    address: FACTORIES[0].address,
    abi: FACTORY_ABI,
    eventName: 'PairCreated',
    onLogs: handleLogs(FACTORIES[0].name),
    pollingInterval: 4_000, // Poll every 4s since we use HTTP transport (not WebSocket)
  });

  useWatchContractEvent({
    address: FACTORIES[1].address,
    abi: FACTORY_ABI,
    eventName: 'PairCreated',
    onLogs: handleLogs(FACTORIES[1].name),
    pollingInterval: 4_000,
  });

  useWatchContractEvent({
    address: FACTORIES[2].address,
    abi: FACTORY_ABI,
    eventName: 'PairCreated',
    onLogs: handleLogs(FACTORIES[2].name),
    pollingInterval: 4_000,
  });

  useWatchContractEvent({
    address: FACTORIES[3].address,
    abi: FACTORY_ABI,
    eventName: 'PairCreated',
    onLogs: handleLogs(FACTORIES[3].name),
    pollingInterval: 4_000,
  });

  useWatchContractEvent({
    address: FACTORIES[4].address,
    abi: FACTORY_ABI,
    eventName: 'PairCreated',
    onLogs: handleLogs(FACTORIES[4].name),
    pollingInterval: 4_000,
  });

  useWatchContractEvent({
    address: FACTORIES[5].address,
    abi: FACTORY_ABI,
    eventName: 'PairCreated',
    onLogs: handleLogs(FACTORIES[5].name),
    pollingInterval: 4_000,
  });
}
