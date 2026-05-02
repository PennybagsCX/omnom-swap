/**
 * Rate limiter for API calls and RPC requests
 * Prevents DoS attacks and manages RPC costs
 */

interface RateLimitEntry {
  timestamp: number;
}

export class RateLimiter {
  private calls: RateLimitEntry[] = [];
  private maxCalls: number;
  private periodMs: number;

  constructor(maxCalls: number, periodMs: number) {
    this.maxCalls = maxCalls;
    this.periodMs = periodMs;
  }

  /**
   * Check if call is allowed under rate limit
   * @throws {Error} If rate limit exceeded
   */
  async checkLimit(): Promise<void> {
    const now = Date.now();

    // Remove expired entries
    this.calls = this.calls.filter(entry => now - entry.timestamp < this.periodMs);

    // Check limit
    if (this.calls.length >= this.maxCalls) {
      const resetTime = this.calls[0].timestamp + this.periodMs;
      const waitTime = Math.max(0, resetTime - now);
      throw new Error(
        `Rate limit exceeded: ${this.maxCalls} calls per ${this.periodMs}ms. ` +
        `Please wait ${Math.ceil(waitTime / 1000)} seconds.`
      );
    }

    // Record this call
    this.calls.push({ timestamp: now });
  }

  /**
   * Get current usage statistics
   */
  getStats(): { used: number; remaining: number; resetAt: number } {
    const now = Date.now();
    this.calls = this.calls.filter(entry => now - entry.timestamp < this.periodMs);

    const resetAt = this.calls.length > 0
      ? this.calls[0].timestamp + this.periodMs
      : now;

    return {
      used: this.calls.length,
      remaining: this.maxCalls - this.calls.length,
      resetAt
    };
  }

  /**
   * Reset the rate limiter
   */
  reset(): void {
    this.calls = [];
  }
}

/**
 * Pre-configured rate limiters for different use cases
 */
export const rateLimiters = {
  // Tax detection: 10 calls per minute
  taxDetection: new RateLimiter(10, 60 * 1000),

  // Pre-flight validation: 5 calls per minute
  preFlightValidation: new RateLimiter(5, 60 * 1000),

  // RPC calls: 30 calls per minute
  rpcCalls: new RateLimiter(30, 60 * 1000),

  // API requests: 20 calls per minute
  apiRequests: new RateLimiter(20, 60 * 1000),
};

/**
 * Wrapper function to add rate limiting to any async function
 */
export const withRateLimit = async <T>(
  rateLimiter: RateLimiter,
  fn: () => Promise<T>
): Promise<T> => {
  await rateLimiter.checkLimit();
  return fn();
};
