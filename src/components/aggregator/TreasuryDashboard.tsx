/**
 * TreasuryDashboard — shows treasury wallet, protocol fee, and admin info.
 *
 * Simplified: merges Owner & Treasury into a unified display.
 * If they are the same address, shows as one combined entry.
 * If different, shows Treasury prominently with Owner as secondary detail.
 */

import { Wallet, Percent, Building2, ExternalLink, Shield, Coins } from 'lucide-react';
import { useReadContract, useBalance } from 'wagmi';
import { erc20Abi, formatUnits } from 'viem';
import { NETWORK_INFO, CONTRACTS } from '../../lib/constants';
import { formatCompactAmount } from '../../lib/format';
import { useAggregatorContract } from '../../hooks/useAggregator/useAggregatorContract';

const TREASURY_ADDRESS = '0x628f3F4A82791D1d6dEC2Aebe7d648e53fF4FA88' as const;

export function TreasuryDashboard() {
  const { owner, treasury, feeBps, isLoading } = useAggregatorContract();

  // Read native DOGE balance of the treasury wallet
  const { data: nativeBalance } = useBalance({
    address: TREASURY_ADDRESS,
    chainId: NETWORK_INFO.chainId,
  });

  // Read WWDOGE (ERC20) balance of the treasury wallet
  const { data: wwdogeRawBalance } = useReadContract({
    address: CONTRACTS.WWDOGE as `0x${string}`,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [TREASURY_ADDRESS],
  });

  // Read OMNOM token balance of the treasury wallet
  const { data: omnomRawBalance } = useReadContract({
    address: CONTRACTS.OMNOM_TOKEN as `0x${string}`,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [TREASURY_ADDRESS],
  });

  const dogeBalance =
    nativeBalance !== undefined
      ? formatCompactAmount(Number(formatUnits(nativeBalance.value, nativeBalance.decimals)))
      : '\u2014';

  const wwdogeBalance =
    wwdogeRawBalance !== undefined
      ? formatCompactAmount(Number(formatUnits(wwdogeRawBalance as bigint, 18)))
      : '\u2014';

  const omnomBalance =
    omnomRawBalance !== undefined
      ? formatCompactAmount(Number(formatUnits(omnomRawBalance as bigint, 18)))
      : '\u2014';

  const explorerUrl = (address: string) => `${NETWORK_INFO.blockExplorer}/address/${address}`;

  const sameAddress = owner && treasury && owner.toLowerCase() === treasury.toLowerCase();
  const displayAddress = treasury || owner;

  return (
    <div className="bg-surface-container-low border border-outline-variant/15 p-4 md:p-6">
      <div className="flex items-center gap-2 mb-4">
        <Building2 className="w-5 h-5 text-primary" />
        <h3 className="font-headline font-bold text-lg uppercase tracking-tighter text-white">
          Treasury & Protocol
        </h3>
      </div>

      {isLoading ? (
        <div className="text-on-surface-variant font-body text-sm animate-pulse">
          Loading contract state...
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Treasury Wallet — prominent display */}
          <div className="bg-surface-container p-4 border border-primary/20 flex flex-col items-center justify-center text-center sm:col-span-2">
            <div className="flex items-center justify-center gap-2 mb-2">
              <Wallet className="w-4 h-4 text-primary" />
              <span className="font-headline text-xs uppercase tracking-wider text-primary">
                {sameAddress ? 'Treasury & Admin' : 'Treasury Wallet'}
              </span>
            </div>
            <div className="text-white font-body text-sm break-all">
              {displayAddress ? (
                <a
                  href={explorerUrl(displayAddress)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline inline-flex items-center gap-1"
                >
                  {displayAddress.slice(0, 10)}...{displayAddress.slice(-8)}
                  <ExternalLink className="w-3 h-3" />
                </a>
              ) : (
                <span className="text-on-surface-variant">Not deployed</span>
              )}
            </div>
            {sameAddress && displayAddress && (
              <div className="text-on-surface-variant text-[10px] font-body mt-1 uppercase tracking-wider">
                Fee collection & contract administration
              </div>
            )}
            {/* Token balance tiles */}
            <div className="grid grid-cols-3 gap-3 mt-3 pt-3 border-t border-outline-variant/10 w-full">
              {/* Native DOGE */}
              <div className="flex flex-col items-center gap-1">
                <div className="flex items-center gap-1">
                  <Coins className="w-3 h-3 text-primary" />
                  <span className="font-headline text-[10px] uppercase tracking-wider text-on-surface-variant">DOGE</span>
                </div>
                <span className="text-white font-semibold font-body text-xs">{dogeBalance}</span>
              </div>
              {/* WWDOGE */}
              <div className="flex flex-col items-center gap-1">
                <div className="flex items-center gap-1">
                  <Coins className="w-3 h-3 text-primary" />
                  <span className="font-headline text-[10px] uppercase tracking-wider text-on-surface-variant">WWDOGE</span>
                </div>
                <span className="text-white font-semibold font-body text-xs">{wwdogeBalance}</span>
              </div>
              {/* OMNOM */}
              <div className="flex flex-col items-center gap-1">
                <div className="flex items-center gap-1">
                  <Coins className="w-3 h-3 text-primary" />
                  <span className="font-headline text-[10px] uppercase tracking-wider text-on-surface-variant">OMNOM</span>
                </div>
                <span className="text-white font-semibold font-body text-xs">{omnomBalance}</span>
              </div>
            </div>
          </div>

          {/* Protocol Fee */}
          <div className="bg-surface-container p-4 border border-outline-variant/10 flex flex-col items-center justify-center text-center">
            <div className="flex items-center justify-center gap-2 mb-2">
              <Percent className="w-4 h-4 text-primary" />
              <span className="font-headline text-xs uppercase tracking-wider text-on-surface-variant">Protocol Fee</span>
            </div>
            <div className="text-white font-body text-2xl font-bold">
              {feeBps !== undefined ? `${Number(feeBps) / 100}%` : '\u2014'}
            </div>
            <div className="text-on-surface-variant text-xs font-body mt-1">
              {feeBps !== undefined ? `${feeBps} basis points` : 'Not deployed'}
            </div>
          </div>

          {/* Contract Owner — secondary info, only shown if different from treasury */}
          {!sameAddress && owner && (
            <div className="bg-surface-container p-3 border border-outline-variant/10 flex flex-col items-center justify-center text-center">
              <div className="flex items-center justify-center gap-2 mb-1">
                <Shield className="w-3 h-3 text-on-surface-variant" />
                <span className="font-headline text-[10px] uppercase tracking-wider text-on-surface-variant">Contract Owner</span>
              </div>
              <div className="font-body text-xs break-all">
                <a
                  href={explorerUrl(owner)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-on-surface-variant hover:text-primary inline-flex items-center gap-1"
                >
                  {owner.slice(0, 10)}...{owner.slice(-8)}
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
