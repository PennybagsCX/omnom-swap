/**
 * Standardized error types for OMNOM Swap
 * Provides consistent error handling across the application
 */

export class SwapError extends Error {
  constructor(
    public code: string,
    message: string,
    public recoverable: boolean = true
  ) {
    super(message);
    this.name = 'SwapError';
  }
}

export class NetworkError extends Error {
  constructor(message: string, public retryable: boolean = true) {
    super(message);
    this.name = 'NetworkError';
  }
}

export class ValidationError extends Error {
  constructor(public field: string, message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

/**
 * Standard error codes
 */
export const ERROR_CODES = {
  // Insufficient liquidity
  INSUFFICIENT_LIQUIDITY: 'INSUFFICIENT_LIQUIDITY',

  // Honeypot detection
  HONEYPOT_DETECTED: 'HONEYPOT_DETECTED',

  // Slippage exceeded
  SLIPPAGE_EXCEEDED: 'SLIPPAGE_EXCEEDED',

  // Invalid address
  INVALID_ADDRESS: 'INVALID_ADDRESS',

  // Rate limit exceeded
  RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',

  // Transaction failed
  TRANSACTION_FAILED: 'TRANSACTION_FAILED',

  // User rejected
  USER_REJECTED: 'USER_REJECTED',

  // Network error
  NETWORK_ERROR: 'NETWORK_ERROR',

  // Timeout
  TIMEOUT: 'TIMEOUT',

  // Unknown error
  UNKNOWN_ERROR: 'UNKNOWN_ERROR',
} as const;

/**
 * Create a SwapError with standard formatting
 */
export const createSwapError = (
  code: keyof typeof ERROR_CODES,
  message: string,
  recoverable: boolean = true
): SwapError => {
  return new SwapError(ERROR_CODES[code], message, recoverable);
};

/**
 * Check if error is recoverable (user can retry)
 */
export const isRecoverableError = (error: Error): boolean => {
  if (error instanceof SwapError) {
    return error.recoverable;
  }
  if (error instanceof NetworkError) {
    return error.retryable;
  }
  return false;
};

/**
 * Get user-friendly error message
 */
export const getUserMessage = (error: Error): string => {
  if (error instanceof SwapError) {
    switch (error.code) {
      case ERROR_CODES.INSUFFICIENT_LIQUIDITY:
        return 'Not enough liquidity to complete this swap. Try a smaller amount.';
      case ERROR_CODES.HONEYPOT_DETECTED:
        return 'This token cannot be sold (honeypot). Please choose a different token.';
      case ERROR_CODES.SLIPPAGE_EXCEEDED:
        return 'Price changed too much. Please try again with higher slippage tolerance.';
      case ERROR_CODES.INVALID_ADDRESS:
        return 'Invalid token address. Please check and try again.';
      case ERROR_CODES.RATE_LIMIT_EXCEEDED:
        return 'Too many requests. Please wait a moment and try again.';
      case ERROR_CODES.TRANSACTION_FAILED:
        return 'Transaction failed. Please check your balance and try again.';
      case ERROR_CODES.USER_REJECTED:
        return 'Transaction was rejected.';
      default:
        return error.message;
    }
  }
  if (error instanceof NetworkError) {
    return 'Network error. Please check your connection and try again.';
  }
  return 'An unexpected error occurred. Please try again.';
};
