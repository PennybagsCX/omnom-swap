/**
 * Aggregator Router Registration Script
 *
 * Registers DEX routers in the on-chain aggregator contract.
 * Must be run with the contract owner's private key.
 *
 * Usage:
 *   PRIVATE_KEY=0x... npx tsx scripts/register-routers.ts
 *   PRIVATE_KEY=0x... npx tsx scripts/register-routers.ts --fraxswap --toolswap --icecreamswap
 *   PRIVATE_KEY=0x... npx tsx scripts/register-routers.ts --all-unregistered
 *   PRIVATE_KEY=0x... npx tsx scripts/register-routers.ts --list
 */

import { createWalletClient, createPublicClient, http, parseAbi, type Address } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { dogechain } from 'wagmi/chains';

// ─── Config ────────────────────────────────────────────────────────────────

const AGGREGATOR_ADDRESS = '0x88F81031b258A0Fb789AC8d3A8071533BFADeC14' as Address;

const AGGREGATOR_ABI = parseAbi([
  'function owner() view returns (address)',
  'function supportedRouters(address) view returns (bool)',
  'function getRouterCount() view returns (uint256)',
  'function routerList(uint256) view returns (address)',
  'function addRouter(address router) external',
  'function removeRouter(address router) external',
]);

const KNOWN_ROUTERS: Record<string, { name: string; address: Address }> = {
  dogeswap:   { name: 'DogeSwap',   address: '0xa4EE06Ce40cb7e8c04E127c1F7D3dFB7F7039C81' },
  dogeshrk:   { name: 'DogeShrk',   address: '0x45AFCf57F7e3F3B9cA70335E5E85e4F77DcC5087' },
  wojak:      { name: 'WOJAK',      address: '0x9695906B4502D5397E6D21ff222e2C1a9e5654a9' },
  kibble:     { name: 'KibbleSwap', address: '0x6258c967337D3faF0C2ba3ADAe5656bA95419d5f' },
  yode:       { name: 'YodeSwap',   address: '0x72d85Ab47fBfc5E7E04a8bcfCa1601D8f8cE1a50' },
  fraxswap:   { name: 'FraxSwap',   address: '0x0f6A5c5F341791e897eB1FB8fE8B4e30EC4F9bDf' },
  toolswap:   { name: 'ToolSwap',   address: '0x9BBF70e64fbe8Fc7afE8a5Ae90F2DB1165013F93' },
  icecreamswap: { name: 'IceCreamSwap', address: '0xBb5e1777A331ED93E07cF043363e48d320eb96c4' },
  pupswap:    { name: 'PupSwap',    address: '0x05F2a20AF837268Be340a3bF82BB87069cF4a8C3' },
  bourbonswap: { name: 'Bourbon Defi', address: '0x6B172911a5Af8C9Eb2B7759688204624CcC9b0Ee' },
};

// ─── Main ──────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);

  const publicClient = createPublicClient({ chain: dogechain, transport: http() });

  // --list: just show current state and exit
  if (args.includes('--list')) {
    await showStatus(publicClient);
    return;
  }

  // Need private key for write operations
  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) {
    console.error('Error: PRIVATE_KEY env var required for write operations.');
    console.error('Usage: PRIVATE_KEY=0x... npx tsx scripts/register-routers.ts --fraxswap');
    process.exit(1);
  }

  const account = privateKeyToAccount(privateKey as `0x${string}`);
  const walletClient = createWalletClient({ account, chain: dogechain, transport: http() });

  // Verify caller is the contract owner
  const owner = await publicClient.readContract({
    address: AGGREGATOR_ADDRESS,
    abi: AGGREGATOR_ABI,
    functionName: 'owner',
  });

  if (owner.toLowerCase() !== account.address.toLowerCase()) {
    console.error(`Error: ${account.address} is not the contract owner (${owner})`);
    process.exit(1);
  }

  console.log(`Owner verified: ${account.address}\n`);

  // Determine which routers to register
  let targets: string[] = [];

  if (args.includes('--all-unregistered')) {
    for (const [_key, router] of Object.entries(KNOWN_ROUTERS)) {
      const registered = await publicClient.readContract({
        address: AGGREGATOR_ADDRESS,
        abi: AGGREGATOR_ABI,
        functionName: 'supportedRouters',
        args: [router.address],
      });
      if (!registered) targets.push(_key);
    }
  } else {
    // Parse specific flags like --fraxswap --toolswap
    for (const arg of args) {
      const key = arg.replace(/^--/, '').toLowerCase();
      if (KNOWN_ROUTERS[key]) targets.push(key);
    }
  }

  if (targets.length === 0) {
    console.log('No routers specified. Use --fraxswap, --toolswap, or --all-unregistered');
    await showStatus(publicClient);
    return;
  }

  // Register each router
  for (const key of targets) {
    const router = KNOWN_ROUTERS[key];
    const alreadyRegistered = await publicClient.readContract({
      address: AGGREGATOR_ADDRESS,
      abi: AGGREGATOR_ABI,
      functionName: 'supportedRouters',
      args: [router.address],
    });

    if (alreadyRegistered) {
      console.log(`[${router.name}] Already registered — skipping`);
      continue;
    }

    console.log(`[${router.name}] Registering ${router.address}...`);

    const { request } = await publicClient.simulateContract({
      address: AGGREGATOR_ADDRESS,
      abi: AGGREGATOR_ABI,
      functionName: 'addRouter',
      args: [router.address],
      account,
    });

    const hash = await walletClient.writeContract(request);
    console.log(`[${router.name}] TX sent: ${hash}`);

    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status === 'success') {
      console.log(`[${router.name}] Registered in block ${receipt.blockNumber}`);
    } else {
      console.error(`[${router.name}] TX reverted!`);
    }
  }

  console.log('\nDone. Updated router status:');
  await showStatus(publicClient);
}

async function showStatus(client: ReturnType<typeof createPublicClient>) {
  const count = await client.readContract({
    address: AGGREGATOR_ADDRESS,
    abi: AGGREGATOR_ABI,
    functionName: 'getRouterCount',
  });

  console.log(`\nAggregator: ${AGGREGATOR_ADDRESS}`);
  console.log(`Registered routers: ${count}\n`);

  for (const [_key, router] of Object.entries(KNOWN_ROUTERS)) {
    const registered = await client.readContract({
      address: AGGREGATOR_ADDRESS,
      abi: AGGREGATOR_ABI,
      functionName: 'supportedRouters',
      args: [router.address],
    });
    const status = registered ? 'REGISTERED' : 'NOT REGISTERED';
    console.log(`  ${router.name.padEnd(12)} ${router.address}  ${status}`);
  }
  console.log('');
}

main().catch(e => {
  console.error('Fatal:', e.message);
  process.exit(1);
});
