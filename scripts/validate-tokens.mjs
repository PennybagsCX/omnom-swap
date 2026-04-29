#!/usr/bin/env node

/**
 * validate-tokens.mjs — Validates the Dogechain token list JSON.
 *
 * Run:  node scripts/validate-tokens.mjs
 *       npm run validate-tokens
 *
 * Checks:
 *  - Valid JSON
 *  - Each entry has required fields (address, symbol, name, decimals)
 *  - Addresses are valid hex (0x + 40 chars)
 *  - Decimals is a number between 0–18
 *  - No duplicate addresses (case-insensitive)
 *  - WWDOGE is present (required for native token handling)
 *  - Warns about suspicious entries (missing symbol, very long names)
 */

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TOKEN_PATH = resolve(__dirname, '../src/data/dogechain-tokens.json');

const WWDOGE = '0xb7ddc6414bf4f5515b52d8bdd69973ae205ff101';
const REQUIRED_FIELDS = ['address', 'symbol', 'name', 'decimals'];

let errors = 0;
let warnings = 0;

function error(msg) { errors++; console.error(`  ERROR: ${msg}`); }
function warn(msg) { warnings++; console.warn(`  WARN:  ${msg}`); }

// Load
let tokens;
try {
  const raw = readFileSync(TOKEN_PATH, 'utf8');
  tokens = JSON.parse(raw);
} catch (e) {
  console.error(`Failed to read/parse token list: ${e.message}`);
  process.exit(1);
}

if (!Array.isArray(tokens)) {
  console.error('Token list must be a JSON array');
  process.exit(1);
}

console.log(`\nValidating ${tokens.length} tokens...\n`);

const seenAddresses = new Set();
let hasWwdoge = false;

for (let i = 0; i < tokens.length; i++) {
  const t = tokens[i];
  const label = `#${i} (${t.symbol || t.address || 'unknown'})`;

  // Required fields
  for (const field of REQUIRED_FIELDS) {
    if (t[field] === undefined || t[field] === null || t[field] === '') {
      error(`${label}: missing required field "${field}"`);
    }
  }

  // Address format
  if (t.address) {
    const addr = t.address.toLowerCase();
    if (!/^0x[0-9a-f]{40}$/.test(addr)) {
      error(`${label}: invalid address format "${t.address}"`);
    }
    if (seenAddresses.has(addr)) {
      error(`${label}: duplicate address "${addr}"`);
    }
    seenAddresses.add(addr);

    if (addr === WWDOGE) hasWwdoge = true;
  }

  // Decimals
  if (t.decimals !== undefined) {
    if (typeof t.decimals !== 'number' || !Number.isInteger(t.decimals) || t.decimals < 0 || t.decimals > 18) {
      error(`${label}: decimals must be integer 0–18, got "${t.decimals}"`);
    }
  }

  // Warnings
  if (t.symbol && t.symbol.length > 20) warn(`${label}: symbol is very long (${t.symbol.length} chars)`);
  if (t.name && t.name.length > 100) warn(`${label}: name is very long (${t.name.length} chars)`);
  if (t.symbol && t.symbol !== t.symbol.trim()) warn(`${label}: symbol has leading/trailing whitespace "${t.symbol}"`);
  if (t.name && t.name !== t.name.trim()) warn(`${label}: name has leading/trailing whitespace "${t.name}"`);
}

if (!hasWwdoge) {
  error(`WWDOGE (${WWDOGE}) must be in the token list — it is required for native token handling`);
}

// Summary
console.log(`\n${'='.repeat(50)}`);
console.log(`Tokens:  ${tokens.length}`);
console.log(`Errors:  ${errors}`);
console.log(`Warnings: ${warnings}`);
console.log(`${'='.repeat(50)}\n`);

if (errors > 0) {
  console.error('VALIDATION FAILED — fix errors before deploying.\n');
  process.exit(1);
} else {
  console.log('All checks passed.\n');
}
