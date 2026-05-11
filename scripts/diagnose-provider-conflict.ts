/**
 * OMNOM SWAP — Browser Provider Conflict Diagnostic
 *
 * Standalone script that can be pasted into the browser console to diagnose
 * wallet provider conflicts. Detects all injected providers on `window`,
 * identifies MetaMask and other wallet extensions, checks if `w.ethereum`
 * is a getter or regular property, and reports the conflict situation.
 *
 * Usage:
 *   1. Open the browser DevTools console (F12 → Console)
 *   2. Copy and paste this entire script
 *   3. Press Enter to run
 *
 * Or load as a file:
 *   - In the console: fetch('/scripts/diagnose-provider-conflict.ts').then(r => r.text()).then(eval)
 *   - Or compile to JS and include as a <script> tag
 *
 * This is a pure browser-console script — it does NOT use Viem, Node.js, or
 * any server-side dependencies. It only inspects `window` objects.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
declare const getEventListeners: any;

(function diagnoseProviderConflict() {
  'use strict';

  // Typed window reference for browser-only properties (ethereum, ethereumproviders)
  const w = window as any;

  // ═══════════════════════════════════════════════════════════════════════
  // Utility Helpers
  // ═══════════════════════════════════════════════════════════════════════

  const SEPARATOR = '─'.repeat(60);
  const HEADER = '═'.repeat(60);

  function logHeader(title: string) {
    console.log(`\n${HEADER}`);
    console.log(`  ${title}`);
    console.log(`${HEADER}`);
  }

  function logSection(title: string) {
    console.log(`\n${SEPARATOR}`);
    console.log(`  ${title}`);
    console.log(`${SEPARATOR}`);
  }

  function logResult(label: string, value: string, status: string) {
    const icon = status === 'ok' ? '✅' : status === 'warn' ? '⚠️' : status === 'fail' ? '❌' : 'ℹ️';
    console.log(`  ${icon} ${label}: ${value}`);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Known Wallet Providers
  // ═══════════════════════════════════════════════════════════════════════

  const KNOWN_WALLETS = [
    { name: 'MetaMask',       flag: 'isMetaMask' },
    { name: 'Rabby',          flag: 'isRabby' },
    { name: 'Trust Wallet',   flag: 'isTrust' },
    { name: 'Coinbase',       flag: 'isCoinbaseWallet' },
    { name: 'Brave Wallet',   flag: 'isBraveWallet' },
    { name: 'Opera Wallet',   flag: 'isOpera' },
    { name: 'Frame',          flag: 'isFrame' },
    { name: 'Tokenary',       flag: 'isTokenary' },
    { name: 'Exodus',         flag: 'isExodus' },
    { name: 'OKEx Wallet',    flag: 'isOkexWallet' },
    { name: 'BitKeep',        flag: 'isBitKeep' },
    { name: 'MathWallet',     flag: 'isMathWallet' },
    { name: 'SafePal',        flag: 'isSafePal' },
    { name: 'OneInch',        flag: 'isOneInch' },
    { name: 'Ledger',         flag: 'isLedger' },
    { name: 'WalletConnect',  flag: 'isWalletConnect' },
  ];

  // ═══════════════════════════════════════════════════════════════════════
  // Phase 1: Detect All Injected Providers
  // ═══════════════════════════════════════════════════════════════════════

  logHeader('OMNOM SWAP — Browser Provider Conflict Diagnostic');

  logSection('Phase 1: Injected Provider Detection');

  // Check w.ethereum
  const hasEthereum = typeof w.ethereum !== 'undefined';
  logResult('w.ethereum exists', hasEthereum ? 'YES' : 'NO', hasEthereum ? 'ok' : 'fail');

  if (hasEthereum) {
    // Check if w.ethereum is a getter or regular property
    const descriptor = Object.getOwnPropertyDescriptor(window, 'ethereum');
    if (descriptor) {
      const isGetter = typeof descriptor.get === 'function';
      const isSetter = typeof descriptor.set === 'function';
      logResult('w.ethereum is getter', isGetter ? 'YES' : 'NO', isGetter ? 'warn' : 'info');
      if (isGetter) {
        console.log('    → A getter means a wallet extension is intercepting access');
        console.log('    → This can cause conflicts when multiple wallets are installed');
      }
      logResult('w.ethereum is setter', isSetter ? 'YES' : 'NO', 'info');
      logResult('w.ethereum is configurable', descriptor.configurable ? 'YES' : 'NO', 'info');
    } else {
      logResult('w.ethereum property descriptor', 'NOT FOUND (inherited)', 'warn');
    }
  }

  // Check w.ethereumproviders (plural, used by some extensions)
  const hasEthereumProviders = typeof w.ethereumproviders !== 'undefined';
  logResult('w.ethereumproviders exists', hasEthereumProviders ? 'YES' : 'NO', hasEthereumProviders ? 'warn' : 'info');

  if (hasEthereumProviders) {
    const providers = w.ethereumproviders;
    if (Array.isArray(providers)) {
      console.log(`    → ${providers.length} provider(s) detected:`);
      providers.forEach((p, i) => {
        console.log(`      [${i}] ${identifyProvider(p)}`);
      });
    } else if (typeof providers === 'object') {
      console.log('    → Type:', typeof providers, Object.keys(providers));
    }
  }

  // Check for provider events
  if (hasEthereum && w.ethereum.providers) {
    logResult('w.ethereum.providers array', `${w.ethereum.providers.length} provider(s)`, 'warn');
    w.ethereum.providers.forEach((p: any, i: number) => {
      console.log(`    [${i}] ${identifyProvider(p)}`);
    });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Phase 2: Identify Specific Wallets
  // ═══════════════════════════════════════════════════════════════════════

  logSection('Phase 2: Wallet Identification');

  const detectedWallets = [];

  if (hasEthereum) {
    for (const wallet of KNOWN_WALLETS) {
      const isPresent = !!w.ethereum[wallet.flag];
      if (isPresent) {
        detectedWallets.push(wallet.name);
        logResult(wallet.name, `detected (${wallet.flag} = true)`, 'warn');
      }
    }

    if (detectedWallets.length === 0) {
      logResult('Known wallets', 'none detected via standard flags', 'info');
      // Check for non-standard providers
      const extraFlags = Object.keys(w.ethereum).filter(k => k.startsWith('is'));
      if (extraFlags.length > 0) {
        console.log('    → Non-standard flags found:', extraFlags.join(', '));
        extraFlags.forEach(flag => {
          if (w.ethereum[flag] === true) {
            console.log(`      ${flag} = true`);
          }
        });
      }
    }

    if (detectedWallets.length > 1) {
      logResult('CONFLICT', `${detectedWallets.length} wallets detected simultaneously!`, 'fail');
      console.log('    → Multiple wallets can override each other\'s provider');
      console.log('    → This is a common cause of transaction failures and wrong chain issues');
    }
  } else {
    logResult('No wallets', 'w.ethereum is not available', 'fail');
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Phase 3: Provider Details
  // ═══════════════════════════════════════════════════════════════════════

  logSection('Phase 3: Provider Details');

  if (hasEthereum) {
    const provider = w.ethereum;

    // Chain ID
    if (provider.chainId) {
      const chainIdDecimal = parseInt(provider.chainId, 16);
      const isDogechain = chainIdDecimal === 2000;
      logResult('chainId', `${provider.chainId} (decimal: ${chainIdDecimal})`, isDogechain ? 'ok' : 'fail');
      if (!isDogechain) {
        console.log('    → Expected Dogechain (2000 / 0x7d0). Wrong chain!');
      }
    } else {
      logResult('chainId', 'not available', 'warn');
    }

    // Connected accounts
    if (provider.selectedAddress) {
      logResult('selectedAddress', provider.selectedAddress, 'ok');
    } else {
      logResult('selectedAddress', 'not connected (null)', 'warn');
    }

    // Network version
    if (provider.networkVersion) {
      logResult('networkVersion', provider.networkVersion, 'info');
    }

    // Check for request method (EIP-1193)
    logResult('EIP-1193 request()', typeof provider.request === 'function' ? 'available' : 'missing', typeof provider.request === 'function' ? 'ok' : 'fail');

    // Check for event listeners
    logResult('on() method', typeof provider.on === 'function' ? 'available' : 'missing', 'info');
    logResult('removeListener()', typeof provider.removeListener === 'function' ? 'available' : 'missing', 'info');

    // Check for deprecated methods
    const deprecatedMethods = ['sendAsync', 'send', 'enable'];
    deprecatedMethods.forEach(method => {
      if (typeof provider[method] === 'function') {
        logResult(`Deprecated: ${method}()`, 'still available', 'warn');
      }
    });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Phase 4: Event Listener Check
  // ═══════════════════════════════════════════════════════════════════════

  logSection('Phase 4: Event Listener Analysis');

  if (hasEthereum) {
    // Check for chainChanged listeners
    const chainListeners = getEventListeners?.(w.ethereum, 'chainChanged') || [];
    logResult('chainChanged listeners', `${chainListeners.length} registered`, chainListeners.length > 0 ? 'ok' : 'warn');

    // Check for accountsChanged listeners
    const accountListeners = getEventListeners?.(w.ethereum, 'accountsChanged') || [];
    logResult('accountsChanged listeners', `${accountListeners.length} registered`, accountListeners.length > 0 ? 'ok' : 'warn');

    // Check for disconnect listeners
    const disconnectListeners = getEventListeners?.(w.ethereum, 'disconnect') || [];
    logResult('disconnect listeners', `${disconnectListeners.length} registered`, 'info');

    if (typeof getEventListeners !== 'function') {
      console.log('  ℹ️  getEventListeners() not available (only in Chrome DevTools)');
      console.log('     To check manually: getEventListeners(w.ethereum)');
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Phase 5: Async Provider Test
  // ═══════════════════════════════════════════════════════════════════════

  logSection('Phase 5: Async Provider Test');

  if (hasEthereum && typeof w.ethereum.request === 'function') {
    // Test eth_chainId
    w.ethereum.request({ method: 'eth_chainId' })
      .then((chainId: any) => {
        const decimal = parseInt(chainId, 16);
        logResult('eth_chainId (async)', `${chainId} (decimal: ${decimal})`, decimal === 2000 ? 'ok' : 'fail');
      })
      .catch((err: any) => {
        logResult('eth_chainId (async)', `FAILED: ${err.message}`, 'fail');
      });

    // Test eth_accounts
    w.ethereum.request({ method: 'eth_accounts' })
      .then((accounts: any) => {
        logResult('eth_accounts', accounts.length > 0 ? accounts[0] : 'no accounts connected', accounts.length > 0 ? 'ok' : 'warn');
      })
      .catch((err: any) => {
        logResult('eth_accounts', `FAILED: ${err.message}`, 'fail');
      });

    // Test net_version
    w.ethereum.request({ method: 'net_version' })
      .then((version: any) => {
        logResult('net_version', version, version === '2000' ? 'ok' : 'fail');
      })
      .catch((err: any) => {
        logResult('net_version', `FAILED: ${err.message}`, 'fail');
      });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Phase 6: Report & Recommendations
  // ═══════════════════════════════════════════════════════════════════════

  logSection('Phase 6: Diagnostic Report & Recommendations');

  const issues = [];
  const recommendations = [];

  if (!hasEthereum) {
    issues.push('No Ethereum provider detected on w.ethereum');
    recommendations.push('Install MetaMask or another compatible wallet extension');
  }

  if (detectedWallets.length > 1) {
    issues.push(`Multiple wallets detected: ${detectedWallets.join(', ')}`);
    recommendations.push(`Priority recommendation: Use ${detectedWallets[0]} as the primary wallet`);
    recommendations.push('Disable other wallet extensions to prevent provider conflicts');
    recommendations.push('Or use the wallet-specific provider directly instead of w.ethereum');
  }

  if (hasEthereum) {
    const descriptor = Object.getOwnPropertyDescriptor(window, 'ethereum');
    if (descriptor && typeof descriptor.get === 'function') {
      issues.push('w.ethereum is a getter — last-loaded wallet wins');
      recommendations.push('The wallet that loads last overrides w.ethereum');
      recommendations.push('Consider using wallet-specific APIs (e.g., w.ethereum.providers[0])');
    }
  }

  if (hasEthereum && w.ethereum.chainId) {
    const chainIdDecimal = parseInt(w.ethereum.chainId, 16);
    if (chainIdDecimal !== 2000) {
      issues.push(`Wrong chain: connected to chain ${chainIdDecimal}, expected 2000 (Dogechain)`);
      recommendations.push('Switch to Dogechain network in your wallet');
      recommendations.push('Use wallet_switchEthereumChain or wallet_addEthereumChain RPC methods');
    }
  }

  if (hasEthereum && !w.ethereum.selectedAddress) {
    issues.push('Wallet not connected — no account selected');
    recommendations.push('Call eth_requestAccounts to connect the wallet');
  }

  // Print report
  if (issues.length === 0) {
    console.log('\n  ✅ No provider conflicts detected!');
    console.log('     The wallet provider appears to be correctly configured.');
  } else {
    console.log('\n  ❌ Issues Found:');
    issues.forEach((issue, i) => {
      console.log(`     ${i + 1}. ${issue}`);
    });

    console.log('\n  💡 Recommendations:');
    recommendations.forEach((rec, i) => {
      console.log(`     ${i + 1}. ${rec}`);
    });
  }

  // Provider priority suggestion
  console.log('\n  📋 Provider Priority Guide:');
  console.log('     1. MetaMask — recommended for OMNOM SWAP (best Wagmi compatibility)');
  console.log('     2. Rabby — good alternative with better security features');
  console.log('     3. Trust Wallet — mobile-first, may have different provider behavior');
  console.log('     4. Coinbase Wallet — uses different connection flow');
  console.log('');
  console.log('  🔧 To force a specific provider:');
  console.log('     w.ethereum = w.ethereum.providers.find(p => p.isMetaMask);');
  console.log('');

  // ═══════════════════════════════════════════════════════════════════════
  // Helper: Identify a provider object
  // ═══════════════════════════════════════════════════════════════════════

  function identifyProvider(provider: any) {
    if (!provider || typeof provider !== 'object') {
      return 'Unknown (not an object)';
    }

    const flags = KNOWN_WALLETS.filter(w => provider[w.flag]).map(w => w.name);
    if (flags.length > 0) {
      return flags.join(' + ');
    }

    // Check non-standard is* flags
    const extraFlags = Object.keys(provider)
      .filter(k => k.startsWith('is') && provider[k] === true)
      .map(k => k.replace(/^is/, ''));

    if (extraFlags.length > 0) {
      return `Unknown (${extraFlags.join(', ')})`;
    }

    return 'Unknown provider';
  }

  console.log(HEADER);
  console.log('  Diagnostic complete. Copy results for support.');
  console.log(HEADER + '\n');

})();
