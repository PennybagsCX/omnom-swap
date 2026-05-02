/**
 * EducationPanel — educational materials about DEX aggregation, AMMs,
 * slippage, MEV, and DeFi risks. Accessible via the "?" button on the
 * aggregator swap screen.
 */

import { useState } from 'react';
import {
  BookOpen,
  ChevronDown,
  Route,
  TrendingDown,
  Layers,
  Database,
  ShieldAlert,
  Search,
  AlertTriangle,
} from 'lucide-react';

interface Topic {
  id: string;
  title: string;
  icon: React.ReactNode;
  content: React.ReactNode;
}

function TopicCard({ topic }: { topic: Topic }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="border border-outline-variant/10">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between p-3 cursor-pointer hover:bg-surface-container/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="text-primary">{topic.icon}</span>
          <span className="font-headline text-xs uppercase tracking-wider text-white font-bold">
            {topic.title}
          </span>
        </div>
        <ChevronDown className={`w-4 h-4 text-on-surface-variant transition-transform duration-300 ${open ? 'rotate-180' : ''}`} />
      </button>

      <div className={`overflow-hidden transition-all duration-300 ease-in-out ${open ? 'max-h-[500px] opacity-100' : 'max-h-0 opacity-0'}`}>
        <div className="px-3 pb-3 text-on-surface-variant text-xs font-body leading-relaxed border-t border-outline-variant/10 pt-3">
          {topic.content}
        </div>
      </div>
    </div>
  );
}

export function EducationPanel() {
  const topics: Topic[] = [
    {
      id: 'aggregator',
      title: 'What is a DEX aggregator?',
      icon: <Route className="w-4 h-4" />,
      content: (
        <div className="space-y-2">
          <p>
            A DEX aggregator is an interface that computes swap routes across multiple decentralized
            exchanges (DEXes) to find routes with different output amounts. Unlike a single DEX, an
            aggregator routes trades across multiple venues to find the best available price.
          </p>
          <p>
            <strong className="text-white">How OmnomSwap works:</strong>
          </p>
          <ol className="list-decimal list-inside space-y-1 ml-2">
            <li>Reads pool reserves from all DEXes on Dogechain</li>
            <li>Builds a liquidity graph connecting all tokens</li>
            <li>Uses BFS to enumerate all possible routes up to 4 hops</li>
            <li>Calculates expected output for each route using the AMM formula</li>
            <li>Displays all viable routes sorted by output amount</li>
            <li>User selects a route and signs the transaction</li>
          </ol>
          <p>
            Route computation happens <strong className="text-white">off-chain</strong> in your browser.
            Execution happens <strong className="text-white">on-chain</strong> via a smart contract that
            atomically executes all hops in a single transaction.
          </p>
          <p className="text-on-surface-variant/80 border-t border-outline-variant/10 pt-2 mt-2">
            <strong className="text-yellow-400">⚠️ Known limitation:</strong> The aggregator only supports{' '}
            <strong className="text-white">exact-input</strong> swaps (you specify the amount to sell).
            Exact-output swaps (specifying the amount to buy) are not supported. The contract
            uses <code className="text-white bg-surface-container-highest px-1">swapExactTokensForTokensSupportingFeeOnTransferTokens</code>{' '}
            for all swaps, which handles fee-on-transfer tokens correctly — native DOGE must be wrapped to WWDOGE first.
          </p>
        </div>
      ),
    },
    {
      id: 'slippage',
      title: 'What is slippage and how to set it?',
      icon: <TrendingDown className="w-4 h-4" />,
      content: (
        <div className="space-y-2">
          <p>
            <strong className="text-white">Slippage</strong> is the difference between the expected output
            of a trade and the actual output when the transaction is executed on-chain. It occurs because
            pool reserves change between when you submit a transaction and when it is mined.
          </p>
          <p>
            <strong className="text-white">Slippage tolerance</strong> is the maximum acceptable difference.
            If the actual output would be less than (expected output × (1 - slippage%)), the transaction
            may revert.
          </p>
          <p>
            <strong className="text-white">How to set it:</strong>
          </p>
          <ul className="list-disc list-inside space-y-1 ml-2">
            <li><strong className="text-white">0.1% – 0.5%:</strong> For liquid pairs with large reserves. Lower risk of unfavorable execution.</li>
            <li><strong className="text-white">0.5% – 1.0%:</strong> For moderately liquid pairs. Good balance of protection and execution rate.</li>
            <li><strong className="text-white">1.0%+:</strong> For illiquid pairs or large trades relative to pool size. Higher risk of unfavorable execution.</li>
          </ul>
          <p>
            A higher slippage tolerance means your transaction is more likely to succeed, but you may
            receive fewer tokens than expected. A lower tolerance protects against unfavorable execution
            but may cause more transaction failures.
          </p>
        </div>
      ),
    },
    {
      id: 'multihop',
      title: 'What are multi-hop routes?',
      icon: <Layers className="w-4 h-4" />,
      content: (
        <div className="space-y-2">
          <p>
            A <strong className="text-white">multi-hop route</strong> is a swap path that goes through
            one or more intermediate tokens before reaching the destination. For example, swapping
            Token A → Token B → Token C instead of a direct A → C swap.
          </p>
          <p>
            Multi-hop routes can yield a higher output than direct swaps when:
          </p>
          <ul className="list-disc list-inside space-y-1 ml-2">
            <li>There is no direct pool for the desired pair</li>
            <li>The direct pool has low liquidity</li>
            <li>The intermediate pools offer a more favorable combined rate</li>
          </ul>
          <p>
            OmnomSwap explores routes up to <strong className="text-white">4 hops</strong> and displays
            all viable options. Each additional hop incurs gas costs and pool fees (0.3% per hop), which
            are factored into the output calculation.
          </p>
        </div>
      ),
    },
    {
      id: 'amm',
      title: 'What is an AMM?',
      icon: <Database className="w-4 h-4" />,
      content: (
        <div className="space-y-2">
          <p>
            An <strong className="text-white">Automated Market Maker (AMM)</strong> is a type of decentralized
            exchange that uses a mathematical formula to price assets, instead of an order book.
          </p>
          <p>
            <strong className="text-white">Constant-product formula:</strong> The most common AMM model (used by
            UniswapV2 and the DEXes on Dogechain) uses the formula:
          </p>
          <div className="bg-surface-container p-3 text-center font-mono text-primary text-sm">
            x × y = k
          </div>
          <p>
            Where <code className="text-primary">x</code> and <code className="text-primary">y</code> represent
            the reserves of two tokens in a pool, and <code className="text-primary">k</code> is a constant.
            When you swap token X for token Y, you add X to the pool and remove Y, keeping the product constant.
          </p>
          <p>
            <strong className="text-white">Output calculation with 0.3% fee:</strong>
          </p>
          <div className="bg-surface-container p-3 text-center font-mono text-primary text-xs">
            amountOut = (R_out × amountIn × 997) / (R_in × 1000 + amountIn × 997)
          </div>
          <p>
            This formula is used by OmnomSwap to calculate expected outputs. The same formula can be used
            to independently verify any quoted amount by checking the on-chain reserves.
          </p>
        </div>
      ),
    },
    {
      id: 'mev',
      title: 'What is MEV and front-running?',
      icon: <ShieldAlert className="w-4 h-4" />,
      content: (
        <div className="space-y-2">
          <p>
            <strong className="text-white">Maximal Extractable Value (MEV)</strong> is the maximum value
            that can be extracted from block production by including, excluding, or reordering transactions.
            MEV bots monitor the public mempool and exploit visible swap transactions for profit.
          </p>
          <p>
            <strong className="text-white">Common MEV attacks on swaps:</strong>
          </p>
          <ul className="list-disc list-inside space-y-1 ml-2">
            <li><strong className="text-white">Front-running:</strong> A bot sees your pending swap in the mempool and submits the same swap with higher gas to execute first, moving the price against you.</li>
            <li><strong className="text-white">Sandwich attack:</strong> A bot places a buy order before your swap and a sell order after, profiting from the price movement your trade causes.</li>
          </ul>
          <p>
            <strong className="text-white">How slippage tolerance protects you:</strong> Setting an
            appropriate slippage tolerance limits the maximum loss from MEV. A lower slippage tolerance
            provides more protection but may cause more failed transactions.
          </p>
          <p>
            <strong className="text-white">Why unlimited approvals are standard:</strong> OmnomSwap
            approves an unlimited allowance (uint256 max) for the aggregator contract, the same pattern
            used by all major DEXes (Uniswap, 1inch, SushiSwap). This means subsequent swaps only require
            one wallet confirmation instead of two. You can revoke approval at any time via the block explorer
            or token approval management tools.
          </p>
          <p className="text-yellow-400 border-t border-outline-variant/10 pt-2 mt-2">
            ⚠️ <strong>Dogechain currently has no MEV protection infrastructure</strong> (no Flashbots,
            no private mempools). All transactions are broadcast to the public mempool.
          </p>
          <p>
            <strong className="text-white">Tips to reduce MEV exposure:</strong>
          </p>
          <ul className="list-disc list-inside space-y-1 ml-2">
            <li>Use conservative slippage settings (0.5% or lower)</li>
            <li>Avoid large single trades — split into smaller swaps if needed</li>
            <li>Trade during periods of lower network activity when MEV bots are less active</li>
          </ul>
        </div>
      ),
    },
    {
      id: 'verify',
      title: 'How to verify routes independently',
      icon: <Search className="w-4 h-4" />,
      content: (
        <div className="space-y-2">
          <p>
            All route calculations in OmnomSwap are based on publicly available on-chain data and standard
            mathematical formulas. You can verify any quoted output:
          </p>
          <ol className="list-decimal list-inside space-y-2 ml-2">
            <li>
              <strong className="text-white">Check pool reserves:</strong> Look up the pair contract on the
              Dogechain block explorer and call <code className="text-primary">getReserves()</code> to get
              current reserves.
            </li>
            <li>
              <strong className="text-white">Apply the formula:</strong> Use the constant-product formula
              with the 0.3% fee to calculate the expected output:
              <div className="bg-surface-container p-2 mt-1 text-center font-mono text-primary text-xs">
                amountOut = (R_out × amountIn × 997) / (R_in × 1000 + amountIn × 997)
              </div>
            </li>
            <li>
              <strong className="text-white">Account for the platform fee:</strong> The input amount is
              reduced by 0.25% before route computation:
              <div className="bg-surface-container p-2 mt-1 text-center font-mono text-primary text-xs">
                swapAmount = amountIn - (amountIn × 25 / 10000)
              </div>
            </li>
            <li>
              <strong className="text-white">Compare:</strong> Your independently calculated result should
              closely match the output displayed by OmnomSwap (small differences may occur due to reserve
              changes between queries).
            </li>
          </ol>
        </div>
      ),
    },
    {
      id: 'risks',
      title: 'Risks of DeFi trading',
      icon: <AlertTriangle className="w-4 h-4" />,
      content: (
        <div className="space-y-2">
          <p>
            Trading in decentralized finance (DeFi) carries significant risks. By using OmnomSwap, you
            acknowledge and accept the following:
          </p>
          <ul className="list-disc list-inside space-y-1 ml-2">
            <li><strong className="text-white">Smart contract risk:</strong> Bugs or vulnerabilities in the aggregator contract, DEX contracts, or token contracts could result in loss of funds.</li>
            <li><strong className="text-white">Price volatility:</strong> Token prices can change rapidly. The output displayed may differ from the actual execution due to market movements.</li>
            <li><strong className="text-white">Impermanent loss:</strong> If you provide liquidity to pools, you may experience impermanent loss when token prices diverge.</li>
            <li><strong className="text-white">Liquidity risk:</strong> Pools may have insufficient liquidity for large trades, resulting in high price impact.</li>
            <li><strong className="text-white">Network risk:</strong> Dogechain network congestion or outages may delay or prevent transaction execution.</li>
            <li><strong className="text-white">MEV risk:</strong> Your transactions may be subject to front-running or sandwich attacks by MEV bots.</li>
            <li><strong className="text-white">No recourse:</strong> Transactions on the blockchain are irreversible. There is no customer support or dispute resolution process.</li>
          </ul>
          <p>
            Only trade with funds you can afford to lose. This interface does not provide investment advice.
          </p>
        </div>
      ),
    },
  ];

  return (
    <div className="bg-surface-container border border-outline-variant/10 p-4">
      <div className="flex items-center gap-2 mb-3">
        <BookOpen className="w-4 h-4 text-primary" />
        <span className="font-headline text-xs uppercase tracking-widest text-on-surface-variant font-bold">
          Learn
        </span>
      </div>
      <div className="space-y-1">
        {topics.map((topic) => (
          <TopicCard key={topic.id} topic={topic} />
        ))}
      </div>
    </div>
  );
}
