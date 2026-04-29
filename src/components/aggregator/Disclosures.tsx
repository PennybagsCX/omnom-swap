/**
 * Disclosures — comprehensive SEC-required disclosures page.
 *
 * Covers: role, fees, route selection parameters, default logic, MEV risk,
 * cybersecurity, conflicts of interest, venue onboarding, and SEC registration status.
 *
 * Includes a prominent Legal Notice at the top (relocated from DisclaimerFooter).
 */

import { useState } from 'react';
import {
  Shield,
  DollarSign,
  Route,
  Settings,
  AlertTriangle,
  Lock,
  Users,
  Building2,
  Info,
  ChevronDown,
  AlertCircle,
  FileCode,
} from 'lucide-react';
import { NETWORK_INFO, CONTRACT_REFERENCE } from '../../lib/constants';

interface DisclosureSection {
  id: string;
  title: string;
  icon: React.ReactNode;
  content: React.ReactNode;
}

function DisclosureCard({ section }: { section: DisclosureSection }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="bg-surface-container-low border border-outline-variant/15">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between p-4 md:p-5 cursor-pointer min-h-[48px]"
      >
        <div className="flex items-center gap-3">
          <span className="text-primary shrink-0">{section.icon}</span>
          <span className="font-headline font-bold text-xs md:text-sm uppercase tracking-tighter text-white text-left">
            {section.title}
          </span>
        </div>
        <ChevronDown
          className={`w-5 h-5 text-on-surface-variant shrink-0 transition-transform duration-300 ${open ? 'rotate-180' : ''}`}
        />
      </button>

      <div
        className={`overflow-hidden transition-all duration-300 ease-in-out ${
          open ? 'max-h-[600px] opacity-100' : 'max-h-0 opacity-0'
        }`}
      >
        <div className="px-4 md:px-5 pb-4 md:pb-5 text-on-surface-variant text-xs md:text-sm font-body leading-relaxed space-y-3 border-t border-outline-variant/10 pt-4">
          {section.content}
        </div>
      </div>
    </div>
  );
}

export function Disclosures() {
  const sections: DisclosureSection[] = [
    {
      id: 'role',
      title: 'Role Disclosure',
      icon: <Info className="w-5 h-5" />,
      content: (
        <>
          <p>
            OmnomSwap is a <strong className="text-white">neutral routing interface</strong> that computes
            potential swap routes using publicly available on-chain data (pool reserves from UniswapV2-compatible
            AMM pools on Dogechain).
          </p>
          <p>
            Route computation is performed off-chain in your browser. Execution is handled by a smart contract
            ({'OmnomSwapAggregator'}) that atomically executes the selected route. OmnomSwap:
          </p>
          <ul className="list-disc list-inside space-y-1 ml-2">
            <li>Does NOT custody funds at any point</li>
            <li>Does NOT execute trades on behalf of users</li>
            <li>Does NOT act as a counterparty to any trade</li>
            <li>Does NOT provide investment advice or solicit transactions</li>
            <li>Does NOT exercise discretion over which route a user selects</li>
          </ul>
        </>
      ),
    },
    {
      id: 'fees',
      title: 'Fee Disclosure',
      icon: <DollarSign className="w-5 h-5" />,
      content: (
        <>
          <p>
            <strong className="text-white">Platform Fee:</strong> Aggregated swaps charge a <strong>0.25% (25 basis points)</strong> platform
            fee, deducted from the input amount before swap execution. This fee is sent to the protocol treasury.
          </p>
          <p>
            <strong className="text-white">Fee calculation:</strong>{' '}
            <code className="bg-surface-container px-2 py-0.5 text-primary text-xs break-all">feeAmount = (amountIn × 25) / 10000</code>
          </p>
          <p>
            <strong className="text-white">Fee neutrality:</strong> The fee is calculated identically regardless of which
            route is selected. No route receives a fee discount or penalty. The fee is applied before route computation,
            so it does not influence which routes are displayed or in what order.
          </p>
          <p>
            <strong className="text-white">Pool fee:</strong> Each DEX pool charges its own fee (typically 0.3% for
            UniswapV2 pools). This is embedded in the AMM constant-product formula and is reflected in the output amount shown.
          </p>
          <p>
            <strong className="text-white">Fee destination:</strong> Protocol fees are sent to the OmnomSwap treasury
            address, which is controlled by the contract owner. The fee amount is displayed before you confirm any transaction.
          </p>
        </>
      ),
    },
    {
      id: 'parameters',
      title: 'Route Selection Parameters',
      icon: <Route className="w-5 h-5" />,
      content: (
        <>
          <p>
            Routes are computed using a <strong className="text-white">Breadth-First Search (BFS)</strong> algorithm
            that enumerates all possible paths through the liquidity graph up to a maximum of <strong>4 hops</strong>.
          </p>
          <p>
            <strong className="text-white">Objective criteria used:</strong>
          </p>
          <ul className="list-disc list-inside space-y-1 ml-2">
            <li><strong className="text-white">Output amount:</strong> Calculated using the constant-product AMM formula: <code className="bg-surface-container px-1 text-primary text-xs break-all">amountOut = (R_out × amountIn × 997) / (R_in × 1000 + amountIn × 997)</code></li>
            <li><strong className="text-white">Number of hops:</strong> Each route's hop count is displayed. Routes are limited to 4 hops to balance gas costs with output.</li>
            <li><strong className="text-white">DEX per hop:</strong> For each hop, the DEX with the highest output for that specific pair is selected (objective, verifiable).</li>
          </ul>
          <p>
            All parameters are <strong className="text-white">pre-disclosed and independently verifiable</strong>. Users can
            verify output amounts by checking pool reserves on-chain and applying the constant-product formula.
          </p>
        </>
      ),
    },
    {
      id: 'defaults',
      title: 'Default Logic Disclosure',
      icon: <Settings className="w-5 h-5" />,
      content: (
        <>
          <p>
            <strong className="text-white">Default sort order:</strong> Routes are sorted by highest output amount (descending).
            This is an objective, verifiable criterion — the route with the highest numerical output appears first.
          </p>
          <p>
            <strong className="text-white">Default parameters:</strong>
          </p>
          <ul className="list-disc list-inside space-y-1 ml-2">
            <li>Slippage Tolerance: 0.5% (customizable: 0.1%, 0.5%, 1.0%, or custom)</li>
            <li>Transaction Deadline: 5 minutes (customizable)</li>
            <li>Platform Fee: 0.25% (25 bps, set by contract owner, not user-customizable)</li>
            <li>Maximum Hops: 4 (fixed, disclosed)</li>
          </ul>
          <p>
            <strong className="text-white">User customization:</strong> Users can change the sort order in the price comparison
            table, select any available route (not just the default), and customize slippage and deadline settings.
          </p>
        </>
      ),
    },
    {
      id: 'mev',
      title: 'MEV Risk Disclosure',
      icon: <AlertTriangle className="w-5 h-5" />,
      content: (
        <>
          <p>
            <strong className="text-white">Maximal Extractable Value (MEV)</strong> refers to the practice of extracting
            value from transactions by reordering, inserting, or censoring transactions within a block.
          </p>
          <p>
            <strong className="text-white">Risks include:</strong>
          </p>
          <ul className="list-disc list-inside space-y-1 ml-2">
            <li><strong className="text-white">Front-running:</strong> An observer may see your pending transaction and submit their own transaction with a higher gas price to execute ahead of you.</li>
            <li><strong className="text-white">Sandwich attacks:</strong> An attacker may place one transaction before yours (driving the price up) and one after (selling at the higher price), profiting at your expense.</li>
            <li><strong className="text-white">MEV extraction:</strong> Specialized bots constantly monitor the mempool for profitable arbitrage opportunities, which can result in less favorable execution prices.</li>
          </ul>
          <p>
            These risks exist on all public blockchains including Dogechain. Consider using MEV-protected transaction
            submission methods if available. Setting a appropriate slippage tolerance can help limit the impact of MEV extraction.
          </p>
        </>
      ),
    },
    {
      id: 'cybersecurity',
      title: 'Cybersecurity Disclosure',
      icon: <Lock className="w-5 h-5" />,
      content: (
        <>
          <p>
            <strong className="text-white">Smart contract risks:</strong> The OmnomSwap aggregator contract and all integrated
            DEX contracts are software that may contain bugs or vulnerabilities. The contract has undergone internal
            review, but no audit — internal or external — provides a guarantee against all possible exploits.
          </p>
          <p>
            <strong className="text-white">Frontend risks:</strong> This web interface could be compromised, tampered with,
            or impersonated. Always verify you are accessing the correct URL and consider bookmarking it.
          </p>
          <p>
            <strong className="text-white">Phishing:</strong> Malicious websites or applications may attempt to trick you into
            signing harmful transactions. Always verify transaction details before signing in your wallet.
          </p>
          <p>
            <strong className="text-white">No warranty:</strong> The OmnomSwap protocol is provided "as is" without warranty
            of any kind, express or implied. The development team does not guarantee the security, availability, or accuracy
            of the service.
          </p>
        </>
      ),
    },
    {
      id: 'conflicts',
      title: 'Conflict of Interest',
      icon: <Users className="w-5 h-5" />,
      content: (
        <>
          <p>
            <strong className="text-white">Protocol treasury:</strong> The OmnomSwap protocol treasury receives 0.25% of each
            swap's input amount as a platform fee. This creates a potential conflict of interest as higher trading volume benefits the treasury
            and, indirectly, the development team.
          </p>
          <p>
            <strong className="text-white">Route selection independence:</strong> Despite this financial incentive, route
            selection is performed entirely by an objective algorithm (BFS with constant-product AMM math). The protocol fee
            does NOT influence which routes are displayed or in what order. The fee is calculated before route computation and
            is identical for all routes.
          </p>
          <p>
            <strong className="text-white">Token holdings:</strong> The development team may hold OMNOM or other tokens
            available on the platform. This does not influence route computation or display.
          </p>
        </>
      ),
    },
    {
      id: 'venue',
      title: 'Venue Onboarding Criteria',
      icon: <Building2 className="w-5 h-5" />,
      content: (
        <>
          <p>
            DEXes are included in OmnomSwap's routing based on the following <strong className="text-white">objective, verifiable criteria</strong>:
          </p>
          <ul className="list-disc list-inside space-y-2 ml-2">
            <li><strong className="text-white">Deployed on Dogechain:</strong> The DEX must have its contracts deployed and operational on the Dogechain network.</li>
            <li><strong className="text-white">UniswapV2-compatible router:</strong> The DEX must implement the standard UniswapV2 router interface (<code className="bg-surface-container px-1 text-primary text-xs">getAmountsOut</code>, <code className="bg-surface-container px-1 text-primary text-xs">swapExactTokensForTokens</code>).</li>
            <li><strong className="text-white">Verifiable liquidity:</strong> The DEX must have liquidity pools with on-chain reserves that can be read via the standard pair contract interface (<code className="bg-surface-container px-1 text-primary text-xs">getReserves</code>).</li>
            <li><strong className="text-white">Functional factory:</strong> The DEX must have a factory contract that allows enumeration of created pairs.</li>
          </ul>
          <p>
            DEXes are NOT included or excluded based on subjective criteria. Any DEX meeting the above technical requirements
            can be added to the registry. The current DEX registry is hardcoded in the frontend and can be verified in the
            open-source code.
          </p>
          <p>
            <strong className="text-white">On-chain verification:</strong> Each DEX router is registered
            on-chain in the aggregator contract. Only registered routers can execute swaps through the
            aggregator, regardless of what appears in the frontend code. The aggregator contract address
            and treasury address are listed in the Contract Reference section below.
          </p>
        </>
      ),
    },
    {
      id: 'registration',
      title: 'Not SEC Registered',
      icon: <Shield className="w-5 h-5" />,
      content: (
        <>
          <p>
            <strong className="text-white">OmnomSwap is NOT registered</strong> with the U.S. Securities and Exchange Commission
            as a broker-dealer, exchange, or alternative trading system. It is not registered with any financial regulatory
            authority in any jurisdiction.
          </p>
          <p>
            OmnomSwap operates as a decentralized, self-custodial interface on the Dogechain network. Users interact directly
            with smart contracts and maintain full custody of their assets at all times.
          </p>
          <p>
            This service is provided pursuant to the SEC Division of Trading and Markets staff statement dated April 13, 2026
            regarding Covered User Interfaces. OmnomSwap is designed to comply with the requirements for Covered User Interfaces
            that do not trigger broker-dealer registration requirements.
          </p>
        </>
      ),
    },
  ];

  return (
    <div className="max-w-3xl mx-auto space-y-4 md:space-y-6">
      <div className="text-center mb-6 md:mb-8">
        <h2 className="font-headline font-black text-2xl md:text-4xl tracking-tighter uppercase text-white mb-2">
          <span className="text-primary">Disclosures</span>
        </h2>
        <p className="text-on-surface-variant font-body text-xs md:text-sm max-w-lg mx-auto px-4">
          Full disclosures required under the SEC Division of Trading and Markets staff statement
          dated April 13, 2026 regarding Covered User Interfaces.
        </p>
      </div>

      {/* ── Legal Notice (relocated from DisclaimerFooter) ── */}
      <div className="border-2 border-primary/30 bg-primary/5 p-4 md:p-6">
        <div className="flex items-center gap-2 mb-4">
          <AlertCircle className="w-5 h-5 text-primary shrink-0" />
          <span className="font-headline text-xs md:text-sm uppercase tracking-widest text-primary font-bold">
            Legal Notice
          </span>
        </div>

        <div className="space-y-3 text-on-surface-variant text-xs md:text-sm font-body leading-relaxed">
          <p>
            <strong className="text-white">OmnomSwap is NOT a registered broker-dealer, exchange, or alternative trading system.</strong>{' '}
            It is not registered with the U.S. Securities and Exchange Commission or any other regulatory authority.
          </p>

          <p>
            <strong className="text-white">This interface does not provide investment advice, solicit transactions, or exercise discretion over trades.</strong>{' '}
            All routing and display decisions are based on objective, pre-disclosed parameters.
          </p>

          <p>
            <strong className="text-white">All transactions are self-custodial.</strong>{' '}
            Users maintain full control of their funds at all times. OmnomSwap never takes custody of user assets.
          </p>

          <p>
            <strong className="text-white">Routes displayed are based on objective, pre-disclosed parameters</strong> (output amount, number of hops) and are independently verifiable.
            The default sort order is by highest output amount. Users can change the sort order and select any available route.
          </p>

          <p className="text-on-surface-variant/70 pt-2 border-t border-outline-variant/10">
            This service is provided pursuant to the SEC Division of Trading and Markets staff statement dated April 13, 2026 regarding Covered User Interfaces.
          </p>
        </div>
      </div>

      {/* ── Expandable Disclosure Sections ── */}
      <div className="space-y-3">
        {sections.map((section) => (
          <DisclosureCard key={section.id} section={section} />
        ))}
      </div>

      {/* ── Contract Reference ── */}
      <div className="mt-6 bg-surface-container-low border border-outline-variant/10 p-4 md:p-6">
        <div className="flex items-center gap-2 mb-4">
          <FileCode className="w-5 h-5 text-primary shrink-0" />
          <h3 className="font-headline font-bold text-xs uppercase tracking-widest text-on-surface-variant">Contract Reference</h3>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-2 text-xs font-mono">
          {CONTRACT_REFERENCE.map((entry) => {
            const href = entry.link === 'token'
              ? `${NETWORK_INFO.blockExplorer}/token/${entry.address}/token-transfers`
              : entry.link === 'address'
                ? `${NETWORK_INFO.blockExplorer}/address/${entry.address}`
                : undefined;
            return (
              <div key={entry.label} className="flex gap-4">
                <span className="text-on-surface-variant w-36 shrink-0">{entry.label}:</span>
                {href ? (
                  <a href={href} target="_blank" rel="noopener noreferrer" className="text-white hover:text-primary break-all">{entry.address}</a>
                ) : (
                  <span className="text-white break-all">{entry.address}</span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
