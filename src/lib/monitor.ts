/**
 * OmnomMonitor — Performance monitoring utility for dev mode.
 *
 * Patches fetch() to track timing/status of all API and RPC calls.
 * Exposes window.__OMNOM_DEBUG for interactive console inspection.
 * Only active in development mode.
 */

export interface RequestLog {
  id: number;
  source: string;
  url: string;
  method: string;
  startTime: number;
  duration?: number;
  status?: number;
  size?: number;
  error?: string;
  slow: boolean;
  failed: boolean;
}

export interface QueryStateLog {
  queryKey: string;
  status: string;
  dataUpdatedAt: number;
  error?: string;
  timestamp: number;
}

const SLOW_THRESHOLD = 2000;
const MAX_LOGS = 200;

function classifySource(url: string): string {
  if (url.includes('rpc.dogechain') || url.includes('rpc.dog') || url.match(/\/rpc\/|\/json-rpc/)) return 'RPC';
  if (url.includes('dexscreener')) return 'DexScreener';
  if (url.includes('gecko') || url.includes('geckoterminal')) return 'GeckoTerminal';
  if (url.includes('mexc')) return 'MEXC';
  return 'Unknown';
}

class OmnomMonitor {
  private logs: RequestLog[] = [];
  private queryStates: QueryStateLog[] = [];
  private nextId = 1;
  private rpcResponseTimes: number[] = [];
  private lastLatencyWarning = 0;
  enabled = import.meta.env.DEV;

  install(): void {
    if (!this.enabled || typeof globalThis.fetch === 'undefined') return;

    const originalFetch = globalThis.fetch;
    const self = this;

    globalThis.fetch = function patchedFetch(input: RequestInfo | URL, init?: RequestInit) {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
      const method = init?.method || 'GET';
      const source = classifySource(url);
      const id = self.logRequest(source, url, method);
      const start = performance.now();

      return originalFetch.call(this, input, init).then(
        (response) => {
          const duration = Math.round(performance.now() - start);
          const size = response.headers.get('content-length');
          self.logResponse(id, response.status, duration, size ? parseInt(size, 10) : 0);
          return response;
        },
        (error) => {
          const duration = Math.round(performance.now() - start);
          self.logError(id, error instanceof Error ? error.message : String(error), duration);
          throw error;
        }
      );
    };

    // Expose debug API
    (globalThis as Record<string, unknown>).__OMNOM_DEBUG = {
      getLogs: () => this.logs,
      getSlow: () => this.logs.filter(l => l.slow),
      getFailed: () => this.logs.filter(l => l.failed),
      getQueries: () => this.queryStates,
      summary: () => this.printSummary(),
      slow: () => this.printSlow(),
      bySource: (s: string) => this.printBySource(s),
      avgTime: (s?: string) => this.getAverageTime(s),
      getRpcRollingAverage: () => this.getRpcRollingAverage(),
      clear: () => { this.logs = []; this.queryStates = []; this.rpcResponseTimes = []; },
    };

    console.log(
      '%c[OMNOM Monitor] Installed. Use window.__OMNOM_DEBUG for interactive inspection.',
      'color: #00ff88; font-weight: bold'
    );
  }

  logRequest(source: string, url: string, method: string): number {
    const id = this.nextId++;
    const entry: RequestLog = {
      id,
      source,
      url: url.length > 120 ? url.slice(0, 117) + '...' : url,
      method,
      startTime: Date.now(),
      slow: false,
      failed: false,
    };
    this.logs.push(entry);
    if (this.logs.length > MAX_LOGS) this.logs.shift();
    return id;
  }

  logResponse(id: number, status: number, duration: number, size: number): void {
    const entry = this.logs.find(l => l.id === id);
    if (!entry) return;
    entry.duration = duration;
    entry.status = status;
    entry.size = size;
    entry.slow = duration > SLOW_THRESHOLD;
    entry.failed = status < 200 || status >= 400;

    const color = entry.failed ? '#ff4444' : entry.slow ? '#ffaa00' : '#00ff88';
    const label = entry.failed ? 'FAIL' : entry.slow ? 'SLOW' : 'OK';
    console.log(
      `%c[${label}] %c${entry.source} %c${entry.method} ${entry.status} %c${duration}ms %c${formatBytes(size)}`,
      `color: ${color}; font-weight: bold`,
      'color: #88aaff',
      'color: #cccccc',
      `color: ${color}`,
      'color: #888888',
      `\n  ${entry.url}`
    );
  }

  logError(id: number, error: string, duration: number): void {
    const entry = this.logs.find(l => l.id === id);
    if (!entry) return;
    entry.duration = duration;
    entry.error = error;
    entry.failed = true;
    entry.slow = duration > SLOW_THRESHOLD;

    console.log(
      '%c[ERROR] %c%s %c%s %c%dms',
      'color: #ff4444; font-weight: bold',
      'color: #88aaff',
      entry.source,
      'color: #cccccc',
      entry.method,
      'color: #ff4444',
      duration,
      `\n  ${error}\n  ${entry.url}`
    );
  }

  logQueryState(queryKey: string, state: { status: string; dataUpdatedAt: number; error?: Error | null }): void {
    this.queryStates.push({
      queryKey,
      status: state.status,
      dataUpdatedAt: state.dataUpdatedAt,
      error: state.error?.message,
      timestamp: Date.now(),
    });
    if (this.queryStates.length > MAX_LOGS) this.queryStates.shift();
  }

  logRpcCall(method: string, duration: number, success: boolean): void {
    const id = this.nextId++;
    const entry: RequestLog = {
      id,
      source: 'RPC',
      url: method,
      method: 'CALL',
      startTime: Date.now(),
      duration,
      slow: duration > SLOW_THRESHOLD,
      failed: !success,
    };
    this.logs.push(entry);
    if (this.logs.length > MAX_LOGS) this.logs.shift();

    // Track RPC response times for rolling average
    this.rpcResponseTimes.push(duration);
    if (this.rpcResponseTimes.length > 50) {
      this.rpcResponseTimes = this.rpcResponseTimes.slice(-50);
    }

    // Check for high latency warning
    const avgTime = this.getAverageTime('RPC');
    if (avgTime > SLOW_THRESHOLD) {
      const now = Date.now();
      if (now - this.lastLatencyWarning > 30_000) {
        console.warn(`[Monitor] RPC latency warning: ${avgTime}ms average (threshold: ${SLOW_THRESHOLD}ms)`);
        this.lastLatencyWarning = now;
      }
    }

    const color = entry.failed ? '#ff4444' : entry.slow ? '#ffaa00' : '#00ccff';
    console.log(
      `%c[RPC] %c${method} %c${duration}ms %c${success ? 'OK' : 'FAIL'}`,
      `color: ${color}; font-weight: bold`,
      'color: #cccccc',
      `color: ${color}`,
      `color: ${color}`,
    );
  }

  printSummary(): void {
    const total = this.logs.length;
    const completed = this.logs.filter(l => l.duration !== undefined);
    const failed = this.logs.filter(l => l.failed);
    const slow = this.logs.filter(l => l.slow);
    const avgTime = completed.length > 0
      ? Math.round(completed.reduce((s, l) => s + (l.duration || 0), 0) / completed.length)
      : 0;

    const bySource: Record<string, { count: number; avg: number; failed: number }> = {};
    for (const l of completed) {
      if (!bySource[l.source]) bySource[l.source] = { count: 0, avg: 0, failed: 0 };
      bySource[l.source].count++;
      bySource[l.source].avg += l.duration || 0;
      if (l.failed) bySource[l.source].failed++;
    }
    for (const s of Object.values(bySource)) {
      s.avg = s.count > 0 ? Math.round(s.avg / s.count) : 0;
    }

    console.group('%c[OMNOM Monitor] Summary', 'color: #00ff88; font-weight: bold; font-size: 14px');
    console.log(`Total: ${total} | Failed: ${failed.length} | Slow: ${slow.length} | Avg: ${avgTime}ms`);
    console.table(bySource);
    console.groupEnd();
  }

  printSlow(): void {
    const slow = this.logs.filter(l => l.slow || l.failed);
    if (slow.length === 0) {
      console.log('%c[OMNOM] No slow/failed requests', 'color: #00ff88');
      return;
    }
    console.group('%c[OMNOM] Slow & Failed Requests', 'color: #ffaa00; font-weight: bold');
    console.table(slow.map(l => ({
      source: l.source,
      url: l.url.slice(0, 80),
      status: l.status ?? 'ERR',
      duration: `${l.duration}ms`,
      error: l.error || '',
    })));
    console.groupEnd();
  }

  printBySource(source: string): void {
    const filtered = this.logs.filter(l => l.source === source);
    if (filtered.length === 0) {
      console.log(`%c[OMNOM] No requests for source: ${source}`, 'color: #888');
      return;
    }
    console.group(`%c[OMNOM] Requests: ${source}`, 'color: #88aaff; font-weight: bold');
    console.table(filtered.map(l => ({
      url: l.url.slice(0, 80),
      method: l.method,
      status: l.status ?? '...',
      duration: l.duration ? `${l.duration}ms` : 'pending',
      slow: l.slow,
      failed: l.failed,
    })));
    console.groupEnd();
  }

  getAverageTime(source?: string): number {
    const completed = this.logs.filter(l => l.duration !== undefined && (!source || l.source === source));
    return completed.length > 0
      ? Math.round(completed.reduce((s, l) => s + (l.duration || 0), 0) / completed.length)
      : 0;
  }

  getLogs(): RequestLog[] { return this.logs; }
  getSlowRequests(): RequestLog[] { return this.logs.filter(l => l.slow); }
  getFailedRequests(): RequestLog[] { return this.logs.filter(l => l.failed); }

  clear(): void {
    this.logs = [];
    this.queryStates = [];
  }

  getSummary() {
    const completed = this.logs.filter(l => l.duration !== undefined);
    const avgMs = this.getAverageTime();
    const rpcAvgMs = this.getAverageTime('RPC');
    return {
      total: this.logs.length,
      failed: this.logs.filter(l => l.failed).length,
      slow: this.logs.filter(l => l.slow).length,
      avgMs,
      rpcAvgMs,
      rpcSlow: rpcAvgMs > SLOW_THRESHOLD,
      bySource: Object.fromEntries(
        [...new Set(completed.map(l => l.source))].map(s => [s, {
          count: completed.filter(l => l.source === s).length,
          avgMs: this.getAverageTime(s),
          failed: completed.filter(l => l.source === s && l.failed).length,
        }])
      ),
    };
  }

  /** Get rolling average of RPC response times. */
  getRpcRollingAverage(): number {
    if (this.rpcResponseTimes.length === 0) return 0;
    return Math.round(this.rpcResponseTimes.reduce((a, b) => a + b, 0) / this.rpcResponseTimes.length);
  }
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0B';
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

export const monitor = new OmnomMonitor();
