/**
 * useAggregatorContract — reads aggregator contract state.
 *
 * Returns owner, treasury, feeBps, paused status, and supported routers.
 *
 * M-10: Exposes error states so consumers can distinguish between
 * "contract not deployed" and "RPC error".
 */

import { useReadContract } from 'wagmi';
import { OMNOMSWAP_AGGREGATOR_ADDRESS, OMNOMSWAP_AGGREGATOR_ABI, isAggregatorDeployed, AGGREGATOR_KNOWN_STATE } from '../../lib/constants';

export function useAggregatorContract() {
  const deployed = isAggregatorDeployed();

  const owner = useReadContract({
    address: deployed ? OMNOMSWAP_AGGREGATOR_ADDRESS : undefined,
    abi: OMNOMSWAP_AGGREGATOR_ABI,
    functionName: 'owner',
    query: { enabled: deployed },
  });

  const treasury = useReadContract({
    address: deployed ? OMNOMSWAP_AGGREGATOR_ADDRESS : undefined,
    abi: OMNOMSWAP_AGGREGATOR_ABI,
    functionName: 'treasury',
    query: { enabled: deployed },
  });

  const feeBps = useReadContract({
    address: deployed ? OMNOMSWAP_AGGREGATOR_ADDRESS : undefined,
    abi: OMNOMSWAP_AGGREGATOR_ABI,
    functionName: 'protocolFeeBps',
    query: { enabled: deployed },
  });

  const paused = useReadContract({
    address: deployed ? OMNOMSWAP_AGGREGATOR_ADDRESS : undefined,
    abi: OMNOMSWAP_AGGREGATOR_ABI,
    functionName: 'paused',
    query: { enabled: deployed },
  });

  const routerCount = useReadContract({
    address: deployed ? OMNOMSWAP_AGGREGATOR_ADDRESS : undefined,
    abi: OMNOMSWAP_AGGREGATOR_ABI,
    functionName: 'getRouterCount',
    query: { enabled: deployed },
  });

  // M-10: Collect any read errors
  const errors = [owner.error, treasury.error, feeBps.error, paused.error, routerCount.error].filter(Boolean);
  const hasError = !deployed || errors.length > 0;

  // When the contract is deployed but on-chain reads return no data (e.g. RPC
  // unreachable, wallet on wrong chain), fall back to the known deployed state
  // so the TreasuryDashboard never shows "Not deployed" for a live contract.
  const resolvedTreasury = (treasury.data as string | undefined) ?? (deployed ? AGGREGATOR_KNOWN_STATE.treasury : undefined);
  const resolvedFeeBps = (feeBps.data as bigint | undefined) ?? (deployed ? AGGREGATOR_KNOWN_STATE.protocolFeeBps : undefined);

  return {
    owner: owner.data as string | undefined,
    treasury: resolvedTreasury,
    feeBps: resolvedFeeBps,
    paused: paused.data as boolean | undefined,
    routerCount: routerCount.data as bigint | undefined,
    isLoading: deployed && (owner.isLoading || treasury.isLoading || feeBps.isLoading),
    /** M-10: Whether the contract reads failed (not deployed or RPC error) */
    hasError,
    /** M-10: Error details if reads failed */
    error: !deployed
      ? 'Aggregator contract not deployed (placeholder address)'
      : errors[0]?.message ?? null,
  };
}
