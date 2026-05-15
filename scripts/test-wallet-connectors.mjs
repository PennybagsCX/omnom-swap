#!/usr/bin/env node

/**
 * Comprehensive wallet connector test script.
 *
 * Tests that:
 *  1. wagmi connectors can be imported
 *  2. Each connector type can be instantiated
 *  3. The wagmi config is structurally valid
 *  4. Required dependencies resolve correctly
 *  5. Environment variables are configured
 */

import { createRequire } from 'module';
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const require = createRequire(import.meta.url);

let passed = 0;
let failed = 0;
let skipped = 0;

function pass(msg) { console.log(`  ✅ PASS: ${msg}`); passed++; }
function fail(msg) { console.log(`  ❌ FAIL: ${msg}`); failed++; }
function skip(msg) { console.log(`  ⏭️  SKIP: ${msg}`); skipped++; }

console.log('\n🧪 Wallet Connector Tests\n');
console.log('─'.repeat(50));

// ─── Test 1: Module Resolution ──────────────────────────────────────────────
console.log('\n📦 Test 1: Module Resolution');

try {
  const wagmi = require('wagmi');
  pass('wagmi module resolves');
  
  if (typeof wagmi.createConfig === 'function') {
    pass('wagmi.createConfig is a function');
  } else {
    fail('wagmi.createConfig is not a function');
  }

  if (typeof wagmi.useConnect === 'function') {
    pass('wagmi.useConnect is a function');
  } else {
    fail('wagmi.useConnect is not a function');
  }

  if (typeof wagmi.useAccount === 'function') {
    pass('wagmi.useAccount is a function');
  } else {
    fail('wagmi.useAccount is not a function');
  }
} catch (err) {
  fail(`wagmi module failed to resolve: ${err.message}`);
}

try {
  const connectors = require('@wagmi/connectors');
  pass('@wagmi/connectors module resolves');

  if (typeof connectors.injected === 'function') {
    pass('injected connector is available');
  } else {
    fail('injected connector is not available');
  }

  if (typeof connectors.walletConnect === 'function') {
    pass('walletConnect connector is available');
  } else {
    fail('walletConnect connector is not available');
  }

  if (typeof connectors.coinbaseWallet === 'function') {
    pass('coinbaseWallet connector is available');
  } else {
    fail('coinbaseWallet connector is not available');
  }
} catch (err) {
  fail(`@wagmi/connectors module failed to resolve: ${err.message}`);
}

try {
  const viem = require('viem');
  pass('viem module resolves');
} catch (err) {
  fail(`viem module failed to resolve: ${err.message}`);
}

try {
  const reactQuery = require('@tanstack/react-query');
  pass('@tanstack/react-query module resolves');
} catch (err) {
  fail(`@tanstack/react-query module failed to resolve: ${err.message}`);
}

// ─── Test 2: Optional Dependencies ──────────────────────────────────────────
console.log('\n📦 Test 2: Optional Dependencies');

try {
  const coinbaseSdk = require('@coinbase/wallet-sdk');
  pass(`@coinbase/wallet-sdk resolves (version: ${coinbaseSdk.VERSION || 'unknown'})`);
} catch (err) {
  skip(`@coinbase/wallet-sdk not installed — coinbaseWallet() will fail at runtime: ${err.message}`);
}

try {
  const wcProvider = require('@walletconnect/ethereum-provider');
  pass('@walletconnect/ethereum-provider resolves');
} catch (err) {
  skip(`@walletconnect/ethereum-provider not installed — WalletConnect will fail at runtime: ${err.message}`);
}

// ─── Test 3: Connector Instantiation ────────────────────────────────────────
console.log('\n🔌 Test 3: Connector Instantiation');

// wagmi v2 connector factory functions return a storage/config object that
// createConfig() consumes — they are not Connector class instances.
// We verify the function doesn't throw and returns something truthy.

try {
  const { injected } = require('@wagmi/connectors');
  const result = injected();
  
  if (result != null) {
    // wagmi connectors return a storage object with a unique key/id
    const id = result.key || result.id || (result._def ? result._def.key : null) || 'injected';
    pass(`injected() connector created (key: ${id})`);
  } else {
    fail('injected() returned null/undefined');
  }
} catch (err) {
  fail(`injected() instantiation failed: ${err.message}`);
}

try {
  const { walletConnect } = require('@wagmi/connectors');
  const result = walletConnect({
    projectId: 'test-project-id-for-verification',
    showQrModal: true
  });
  
  if (result != null) {
    const id = result.key || result.id || (result._def ? result._def.key : null) || 'walletConnect';
    pass(`walletConnect() connector created (key: ${id})`);
  } else {
    fail('walletConnect() returned null/undefined');
  }
} catch (err) {
  fail(`walletConnect() instantiation failed: ${err.message}`);
}

try {
  const { coinbaseWallet } = require('@wagmi/connectors');
  const result = coinbaseWallet({ appName: 'OMNOM Swap Test' });
  
  if (result != null) {
    const id = result.key || result.id || (result._def ? result._def.key : null) || 'coinbaseWallet';
    pass(`coinbaseWallet() connector created (key: ${id})`);
  } else {
    fail('coinbaseWallet() returned null/undefined');
  }
} catch (err) {
  fail(`coinbaseWallet() instantiation failed: ${err.message}`);
}

// ─── Test 4: Wagmi Config Creation ──────────────────────────────────────────
console.log('\n⚙️  Test 4: Wagmi Config Creation');

try {
  const { createConfig, http } = require('wagmi');
  const { injected, walletConnect, coinbaseWallet } = require('@wagmi/connectors');

  // Use a minimal chain-like object for testing (dogechain may not be in all viem versions)
  const testChain = {
    id: 2000,
    name: 'Dogechain',
    nativeCurrency: { name: 'Dogecoin', symbol: 'DOGE', decimals: 18 },
    rpcUrls: {
      default: { http: ['https://rpc.dogechain.dog'] },
    },
    blockExplorers: {
      default: { name: 'Dogechain Explorer', url: 'https://explorer.dogechain.dog' },
    },
  };

  const connectors = [
    injected(),
    walletConnect({ projectId: 'test-project-id', showQrModal: true }),
    coinbaseWallet({ appName: 'OMNOM Swap Test' }),
  ];

  const config = createConfig({
    chains: [testChain],
    connectors,
    transports: {
      [testChain.id]: http(),
    },
  });

  if (config && typeof config === 'object') {
    pass('createConfig() returned a config object');
  } else {
    fail('createConfig() returned unexpected value');
  }

  if (config.connectors && typeof config.connectors === 'object') {
    const connectorCount = Object.keys(config.connectors).length;
    pass(`Config has ${connectorCount} connector(s) registered`);
  } else {
    // wagmi v2 stores connectors differently
    if (config._internal?.connectors || config.state?.connectors) {
      pass('Config has connectors in internal state');
    } else {
      warn('Config connector structure may be different than expected');
    }
  }

  if (config.chains) {
    const chains = Array.isArray(config.chains) ? config.chains : [config.chains];
    pass(`Config has ${chains.length} chain(s) configured`);
  } else {
    fail('Config does not have chains configured');
  }
} catch (err) {
  fail(`createConfig() failed: ${err.message}`);
}

// ─── Test 5: Source Code Validation ─────────────────────────────────────────
console.log('\n📄 Test 5: Source Code Validation');

const configPath = resolve(ROOT, 'src/lib/web3/config.ts');
if (existsSync(configPath)) {
  const configSrc = readFileSync(configPath, 'utf-8');

  if (configSrc.includes('injected()')) {
    pass('config.ts includes injected() connector');
  } else {
    fail('config.ts is missing injected() connector');
  }

  if (configSrc.includes('walletConnect(')) {
    pass('config.ts includes walletConnect() connector');
  } else {
    fail('config.ts is missing walletConnect() connector');
  }

  if (configSrc.includes('coinbaseWallet(')) {
    pass('config.ts includes coinbaseWallet() connector');
  } else {
    fail('config.ts is missing coinbaseWallet() connector');
  }

  if (configSrc.includes('dogechain')) {
    pass('config.ts references dogechain chain');
  } else {
    fail('config.ts does not reference dogechain chain');
  }

  if (configSrc.includes('createConfig(')) {
    pass('config.ts calls createConfig()');
  } else {
    fail('config.ts does not call createConfig()');
  }
} else {
  fail('config.ts not found at expected path');
}

const walletModalPath = resolve(ROOT, 'src/components/WalletModal.tsx');
if (existsSync(walletModalPath)) {
  const modalSrc = readFileSync(walletModalPath, 'utf-8');

  if (modalSrc.includes('trust-virtual')) {
    pass('WalletModal.tsx has Trust Wallet virtual entry');
  } else {
    fail('WalletModal.tsx is missing Trust Wallet virtual entry');
  }

  if (modalSrc.includes('EIP6963_WALLET_MAP') || modalSrc.includes('EIP-6963')) {
    pass('WalletModal.tsx has EIP-6963 wallet mapping');
  } else {
    fail('WalletModal.tsx is missing EIP-6963 wallet mapping');
  }

  if (modalSrc.includes('detectInjectedProvider')) {
    pass('WalletModal.tsx has injected provider detection');
  } else {
    fail('WalletModal.tsx is missing injected provider detection');
  }

  if (modalSrc.includes('deduplicatedConnectors')) {
    pass('WalletModal.tsx has connector deduplication logic');
  } else {
    fail('WalletModal.tsx is missing connector deduplication logic');
  }
} else {
  fail('WalletModal.tsx not found at expected path');
}

// ─── Test 6: Environment Configuration ──────────────────────────────────────
console.log('\n🌍 Test 6: Environment Configuration');

const envExamplePath = resolve(ROOT, '.env.example');
if (existsSync(envExamplePath)) {
  const envSrc = readFileSync(envExamplePath, 'utf-8');

  if (envSrc.includes('VITE_WALLETCONNECT_PROJECT_ID')) {
    pass('.env.example documents VITE_WALLETCONNECT_PROJECT_ID');
  } else {
    fail('.env.example does not document VITE_WALLETCONNECT_PROJECT_ID');
  }
} else {
  skip('.env.example not found');
}

const envPath = resolve(ROOT, '.env');
if (existsSync(envPath)) {
  const envSrc = readFileSync(envPath, 'utf-8');
  
  const hasWcId = envSrc.match(/VITE_WALLETCONNECT_PROJECT_ID\s*=\s*.+/);
  if (hasWcId && !hasWcId[0].includes('your_') && !hasWcId[0].includes('xxx')) {
    pass('VITE_WALLETCONNECT_PROJECT_ID is configured in .env');
  } else if (hasWcId) {
    skip('VITE_WALLETCONNECT_PROJECT_ID appears to be a placeholder');
  } else {
    skip('VITE_WALLETCONNECT_PROJECT_ID not set in .env — WalletConnect will be disabled');
  }
} else {
  skip('.env file not found — WalletConnect will be disabled without project ID');
}

// ─── Summary ────────────────────────────────────────────────────────────────
console.log('\n' + '─'.repeat(50));
console.log(`\n📊 Results: ${passed} passed, ${failed} failed, ${skipped} skipped\n`);

if (failed > 0) {
  console.log('❌ Some tests FAILED — review errors above.\n');
  process.exit(1);
} else {
  console.log('✅ All tests passed — wallet connectors are correctly configured.\n');
  process.exit(0);
}
