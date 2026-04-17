/**
 * Number formatting utilities that avoid scientific notation for large numbers.
 *
 * JavaScript's Number.prototype.toFixed() can produce scientific notation for
 * very large values. These helpers use toLocaleString('en-US') which always
 * produces human-readable decimal strings.
 */

/**
 * Format a number (or numeric string) as a human-readable balance string
 * with compact subscript notation for small values.
 *
 * Examples:
 *   formatBalance(22148627025.82)    → "22,148,627,025.82"
 *   formatBalance("0.005")           → "0.0₃5"
 *   formatBalance(0.000000001234)    → "0.0₈1234"
 *   formatBalance(0)                 → "0.00"
 */
export function formatBalance(value: number | string): string {
  const num = typeof value === 'string' ? Number(value) : value;
  if (isNaN(num) || num === 0) return '0.00';
  const abs = Math.abs(num);

  // Large values: comma-separated with 2 decimals
  if (abs >= 1) return num.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  // Medium-small: 2-4 decimals
  if (abs >= 0.01) return num.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  });
  // Very small: compact subscript notation
  return formatCompactAmount(num);
}

/**
 * Format a number (or numeric string) without comma separators.
 * Same as formatBalance but without thousands grouping — suitable for
 * inline contexts where commas are undesirable.
 *
 * Examples:
 *   formatBalancePlain(22148627025.82) → "22148627025.82"
 *   formatBalancePlain("0.005")        → "0.0₃5"
 */
export function formatBalancePlain(value: number | string): string {
  const num = typeof value === 'string' ? Number(value) : value;
  if (isNaN(num) || num === 0) return '0';
  const abs = Math.abs(num);

  if (abs >= 1) return num.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    useGrouping: false,
  });
  if (abs >= 0.01) return num.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
    useGrouping: false,
  });
  return formatCompactAmount(num);
}

// Unicode subscript digits for compact zero-count notation
const SUBSCRIPT_DIGITS: Record<number, string> = {
  0: '\u2080', 1: '\u2081', 2: '\u2082', 3: '\u2083', 4: '\u2084',
  5: '\u2085', 6: '\u2086', 7: '\u2087', 8: '\u2088', 9: '\u2089',
};

/**
 * Convert a number to its Unicode subscript representation.
 * e.g. 3 → "₃", 10 → "₁₀", 15 → "₁₅"
 */
function toSubscript(n: number): string {
  return String(n)
    .split('')
    .map(d => SUBSCRIPT_DIGITS[Number(d)] ?? d)
    .join('');
}

/**
 * Format a price with compact subscript zero notation for very small values.
 *
 * Examples:
 *   formatCompactPrice(0.000000001234) → "$0.0₈1234"
 *   formatCompactPrice(0.00004567)     → "$0.0₃4567"
 *   formatCompactPrice(0.1234)         → "$0.1234"
 *   formatCompactPrice(1.2345)         → "$1.2345"
 *   formatCompactPrice(null)           → "—"
 *   formatCompactPrice(0)              → "$0"
 *   formatCompactPrice(-0.000123)      → "-$0.0₃123"
 */
export function formatCompactPrice(value: number | null | undefined): string {
  if (value === null || value === undefined) return '\u2014';
  const n = typeof value === 'string' ? Number(value) : value;
  if (isNaN(n)) return '\u2014';
  if (n === 0) return '$0';

  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';

  // Large values: compact notation (displayed value always < 1000 of the unit)
  if (abs >= 1e12) return `${sign}$${(abs / 1e12).toFixed(2)}T`;
  if (abs >= 1e9)  return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6)  return `${sign}$${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3)  return `${sign}$${(abs / 1e3).toFixed(2)}K`;

  // Normal range: standard decimal formatting
  if (abs >= 1) return `${sign}$${abs.toFixed(2)}`;
  if (abs >= 0.01) return `${sign}$${abs.toFixed(4)}`;

  // Very small values: subscript zero notation
  // Convert to string without scientific notation
  const str = abs.toFixed(20);
  // str looks like "0.00004567000000000..."
  const dotIdx = str.indexOf('.');
  if (dotIdx === -1) return `${sign}$${abs}`;

  // Count leading zeros after the decimal point
  let zeroCount = 0;
  let i = dotIdx + 1;
  while (i < str.length && str[i] === '0') {
    zeroCount++;
    i++;
  }

  if (zeroCount === 0) {
    // No leading zeros after decimal — shouldn't happen here since abs < 0.01
    return `${sign}$${abs}`;
  }

  // Extract significant digits (4-6 digits)
  const significantStr = str.slice(i);
  const significantDigits = significantStr.slice(0, Math.min(6, significantStr.length));

  // Format: 0.0ₙ<significant_digits>
  const sub = toSubscript(zeroCount);
  return `${sign}$0.0${sub}${significantDigits}`;
}

/**
 * Format a compact price WITHOUT the $ prefix.
 * Same logic as formatCompactPrice but for non-USD token amounts/ratios.
 *
 * Examples:
 *   formatCompactAmount(0.000000001234) → "0.0₈1234"
 *   formatCompactAmount(0.00004567)     → "0.0₃4567"
 *   formatCompactAmount(1.2345)         → "1.2345"
 */
export function formatCompactAmount(value: number | null | undefined): string {
  const result = formatCompactPrice(value);
  if (result.startsWith('$')) return result.slice(1);
  if (result.startsWith('-$')) return '-' + result.slice(2);
  return result;
}
