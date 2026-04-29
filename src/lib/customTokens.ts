/**
 * customTokens — manage user-imported ERC-20 tokens.
 *
 * Users can manually add tokens by contract address.
 * Tokens are persisted in localStorage with metadata.
 */

import type { PublicClient } from 'viem';
import { NETWORK_INFO } from './constants';

export interface CustomToken {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  balance: number;
  icon?: string;
  isImage?: boolean;
  isNative?: boolean;
  isCustom: true;
  addedAt: number;
}

const CUSTOM_TOKENS_KEY = 'omnom_custom_tokens';

// Get custom tokens from localStorage
export function getCustomTokens(): CustomToken[] {
  if (typeof window === 'undefined') return [];
  try {
    const stored = localStorage.getItem(CUSTOM_TOKENS_KEY);
    if (!stored) return [];
    const parsed = JSON.parse(stored);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// Save custom token to localStorage
export function saveCustomToken(token: CustomToken): void {
  if (typeof window === 'undefined') return;
  const existing = getCustomTokens();
  const filtered = existing.filter(t => t.address.toLowerCase() !== token.address.toLowerCase());
  filtered.push(token);
  localStorage.setItem(CUSTOM_TOKENS_KEY, JSON.stringify(filtered));
}

// Remove custom token from localStorage
export function removeCustomToken(address: string): void {
  if (typeof window === 'undefined') return;
  const existing = getCustomTokens();
  const filtered = existing.filter(t => t.address.toLowerCase() !== address.toLowerCase());
  localStorage.setItem(CUSTOM_TOKENS_KEY, JSON.stringify(filtered));
}

// Validate Ethereum address format
export function isValidAddress(address: string): boolean {
  if (!address) return false;
  const regex = /^0x[a-fA-F0-9]{40}$/;
  return regex.test(address);
}

// ERC-20 function selectors
const SYMBOL_SELECTOR = '0x95d89b41';
const NAME_SELECTOR = '0x06fdde03';
const DECIMALS_SELECTOR = '0x313ce567';

// Fetch ERC-20 metadata from contract using raw JSON-RPC
export async function fetchTokenMetadata(
  address: string,
  _publicClient?: PublicClient,
): Promise<{ symbol: string; name: string; decimals: number } | null> {
  try {
    const addr = address.toLowerCase();
    const rpcBody = (data: string) => ({
      jsonrpc: '2.0',
      method: 'eth_call',
      params: [{ to: addr, data }, 'latest'],
      id: 1,
    });

    const [symbolRes, nameRes, decimalsRes] = await Promise.all([
      fetch(NETWORK_INFO.rpcUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(rpcBody(SYMBOL_SELECTOR)) }).then(r => r.json()),
      fetch(NETWORK_INFO.rpcUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(rpcBody(NAME_SELECTOR)) }).then(r => r.json()),
      fetch(NETWORK_INFO.rpcUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(rpcBody(DECIMALS_SELECTOR)) }).then(r => r.json()),
    ]);

    const symbol = decodeABIString(symbolRes?.result);
    const name = decodeABIString(nameRes?.result);
    const decimalsHex = decimalsRes?.result;

    if (!symbol || !name || !decimalsHex || decimalsHex === '0x') return null;

    const decimals = parseInt(decimalsHex, 16);
    return { symbol, name, decimals };
  } catch (err) {
    console.error('[fetchTokenMetadata] error:', err);
    return null;
  }
}

function decodeABIString(hex: string | undefined): string | null {
  if (!hex || hex === '0x' || hex.length < 130) return null;
  try {
    const len = parseInt(hex.slice(66, 130), 16);
    if (len === 0) return null;
    const strHex = hex.slice(130, 130 + len * 2);
    return decodeURIComponent(strHex.replace(/../g, '%$&'));
  } catch {
    return null;
  }
}

// Check if a token is already in the custom tokens list
export function isCustomToken(address: string): boolean {
  const customTokens = getCustomTokens();
  return customTokens.some(t => t.address.toLowerCase() === address.toLowerCase());
}
