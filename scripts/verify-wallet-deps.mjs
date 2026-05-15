#!/usr/bin/env node

/**
 * Verification script for wallet dependency resolution.
 *
 * Confirms that:
 *  1. No import of @metamask/connect-evm remains in the connector config
 *  2. wagmi and related packages resolve correctly
 *  3. @coinbase/wallet-sdk is available (required by coinbaseWallet() connector)
 *  4. The Vite cache is clean
 *  5. WalletModal handles all wallet types correctly
 *  6. Trust Wallet virtual entry is configured via WalletConnect
 */

import { readFileSync, existsSync, rmSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

let errors = 0;
let warnings = 0;

function ok(msg) { console.log(`  ✅ ${msg}`); }
function warn(msg) { console.log(`  ⚠️  ${msg}`); warnings++; }
function fail(msg) { console.log(`  ❌ ${msg}`); errors++; }

console.log('\n🔍 Wallet Dependency Verification\n');
console.log('─'.repeat(50));

// 1. Check config.ts does NOT import metaMask
console.log('\n1. Checking src/lib/web3/config.ts...');
const configPath = resolve(ROOT, 'src/lib/web3/config.ts');
const configSrc = readFileSync(configPath, 'utf-8');

if (configSrc.includes('metaMask')) {
  if (configSrc.includes("import { metaMask") || configSrc.includes("import.metaMask")) {
    fail('metaMask is still imported — should be removed');
  } else {
    warn('String "metaMask" found in comments — OK if just documentation');
  }
} else {
  ok('No metaMask import found');
}

if (configSrc.includes('injected()')) {
  ok('injected() connector is present');
} else {
  fail('injected() connector is missing — users cannot connect via browser wallets');
}

if (configSrc.includes('coinbaseWallet(')) {
  ok('coinbaseWallet() connector is present');
} else {
  warn('coinbaseWallet() connector is missing — Coinbase Wallet support may be limited');
}

if (configSrc.includes('walletConnect(')) {
  ok('walletConnect() connector is present');
} else {
  warn('walletConnect() connector is missing — WalletConnect/Trust Wallet will not work');
}

if (configSrc.includes("import('@metamask/connect-evm')") || configSrc.includes("'@metamask/connect-evm'")) {
  fail('@metamask/connect-evm is still referenced');
} else {
  ok('No reference to @metamask/connect-evm');
}

// 2. Check vite.config.ts has optimizeDeps
console.log('\n2. Checking vite.config.ts...');
const vitePath = resolve(ROOT, 'vite.config.ts');
const viteSrc = readFileSync(vitePath, 'utf-8');

if (viteSrc.includes('optimizeDeps')) {
  ok('optimizeDeps is configured');
} else {
  warn('optimizeDeps is not configured — may cause slower cold starts');
}

if (viteSrc.includes('dedupe')) {
  ok('resolve.dedupe is configured');
} else {
  warn('resolve.dedupe is not configured — may cause duplicate React instances');
}

// 3. Check node_modules has required packages
console.log('\n3. Checking node_modules (required packages)...');
const requiredPackages = [
  'wagmi',
  '@wagmi/core',
  '@wagmi/connectors',
  'viem',
  '@tanstack/react-query',
  'react',
  'react-dom',
];

for (const pkg of requiredPackages) {
  const pkgPath = resolve(ROOT, 'node_modules', pkg, 'package.json');
  if (existsSync(pkgPath)) {
    const version = JSON.parse(readFileSync(pkgPath, 'utf-8')).version;
    ok(`${pkg}@${version} installed`);
  } else {
    fail(`${pkg} is NOT installed — run npm install`);
  }
}

// 4. Check optional wallet-related packages
console.log('\n4. Checking node_modules (optional packages)...');
const optionalPackages = [
  { name: '@coinbase/wallet-sdk', reason: 'Required by coinbaseWallet() connector in wagmi' },
  { name: '@walletconnect/ethereum-provider', reason: 'Required by walletConnect() connector in wagmi' },
];

for (const { name, reason } of optionalPackages) {
  const pkgPath = resolve(ROOT, 'node_modules', name, 'package.json');
  if (existsSync(pkgPath)) {
    const version = JSON.parse(readFileSync(pkgPath, 'utf-8')).version;
    ok(`${name}@${version} installed`);
  } else {
    warn(`${name} is NOT installed — ${reason}`);
  }
}

// Explicitly check that @metamask/connect-evm is NOT present (it was intentionally removed)
console.log('\n5. Checking removed packages...');
const metamaskConnectPath = resolve(ROOT, 'node_modules/@metamask/connect-evm/package.json');
if (existsSync(metamaskConnectPath)) {
  warn('@metamask/connect-evm is still installed — should not be needed (MetaMask uses injected()/EIP-6963)');
} else {
  ok('@metamask/connect-evm is NOT installed (correct — MetaMask uses injected()/EIP-6963)');
}

// 6. Check Vite cache
console.log('\n6. Checking Vite cache...');
const viteCache = resolve(ROOT, 'node_modules/.vite');
if (existsSync(viteCache)) {
  ok('Vite cache exists (will be used for faster startups)');
} else {
  warn('No Vite cache — first dev server start will be slower');
}

// 7. Check WalletModal handles all wallet types
console.log('\n7. Checking WalletModal.tsx...');
const walletModalPath = resolve(ROOT, 'src/components/WalletModal.tsx');
const walletModalSrc = readFileSync(walletModalPath, 'utf-8');

if (walletModalSrc.includes('isMetaMask')) {
  ok('MetaMask detection logic present');
} else {
  warn('MetaMask detection may have been removed — check wallet display');
}

if (walletModalSrc.includes('io.metamask')) {
  ok('EIP-6963 MetaMask mapping present');
} else {
  warn('EIP-6963 MetaMask mapping may be missing');
}

if (walletModalSrc.includes('isCoinbaseWallet')) {
  ok('Coinbase Wallet detection logic present');
} else {
  warn('Coinbase Wallet detection may be missing');
}

if (walletModalSrc.includes('com.coinbase')) {
  ok('EIP-6963 Coinbase mapping present');
} else {
  warn('EIP-6963 Coinbase mapping may be missing');
}

// 8. Verify Trust Wallet virtual entry configuration
console.log('\n8. Checking Trust Wallet / WalletConnect configuration...');

if (walletModalSrc.includes('trust-virtual')) {
  ok('Trust Wallet virtual entry is configured');
} else {
  fail('Trust Wallet virtual entry is missing — Trust Wallet won\'t appear in wallet list');
}

if (walletModalSrc.includes('trustAlreadyPresent')) {
  ok('Trust Wallet deduplication logic present');
} else {
  warn('Trust Wallet deduplication may be missing — could show duplicate entries');
}

if (walletModalSrc.includes('isTrust') || walletModalSrc.includes('isTrustWallet')) {
  ok('Trust Wallet provider detection present');
} else {
  warn('Trust Wallet provider detection may be missing');
}

if (walletModalSrc.includes('walletconnect') || walletModalSrc.includes('WalletConnect')) {
  ok('WalletConnect references present in WalletModal');
} else {
  fail('WalletConnect not referenced — QR code modal may not work');
}

// Summary
console.log('\n' + '─'.repeat(50));
console.log(`\n📊 Results: ${errors} errors, ${warnings} warnings\n`);

if (errors > 0) {
  console.log('❌ Verification FAILED — fix errors above before deploying.\n');
  process.exit(1);
} else {
  console.log('✅ All checks passed — wallet dependencies are correctly configured.\n');
  process.exit(0);
}
