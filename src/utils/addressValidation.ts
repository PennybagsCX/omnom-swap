import { isAddress, getAddress } from 'viem';

/**
 * Validates and normalizes a token address
 * @throws {Error} If address is invalid format or zero address
 */
export const validateTokenAddress = (addr: string): string => {
  if (!addr) {
    throw new Error('Address is required');
  }

  if (!isAddress(addr)) {
    throw new Error('Invalid address format');
  }

  const checksummed = getAddress(addr);

  if (checksummed === '0x0000000000000000000000000000000000000000') {
    throw new Error('Zero address not allowed');
  }

  return checksummed;
};

/**
 * Validates aggregator contract address with enhanced security
 * @throws {Error} If address is invalid
 */
export const validateAggregatorAddress = (addr: string | undefined): string | undefined => {
  if (!addr) return undefined;

  if (!isAddress(addr)) {
    throw new Error('Invalid aggregator address format');
  }

  return getAddress(addr);
};

/**
 * Type guard to check if a value is a valid address
 */
export const isValidAddress = (value: unknown): value is `0x${string}` => {
  return typeof value === 'string' && isAddress(value);
};
