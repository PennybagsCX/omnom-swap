/**
 * Environment-based logging for OMNOM Swap
 * Only logs in development mode to avoid performance impact in production
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  level: LogLevel;
  timestamp: string;
  context: string;
  message: string;
  data?: unknown;
}

class Logger {
  private isDev = import.meta.env.DEV;
  private logHistory: LogEntry[] = [];
  private maxHistory = 100;

  private formatMessage(level: LogLevel, context: string, message: string, data?: unknown): string {
    const timestamp = new Date().toISOString();
    const dataStr = data ? ` ${JSON.stringify(data)}` : '';
    return `[${timestamp}] [${level.toUpperCase()}] [${context}] ${message}${dataStr}`;
  }

  private addToHistory(entry: LogEntry): void {
    this.logHistory.push(entry);
    if (this.logHistory.length > this.maxHistory) {
      this.logHistory.shift();
    }
  }

  debug(context: string, message: string, data?: unknown): void {
    if (!this.isDev) return;

    const entry: LogEntry = {
      level: 'debug',
      timestamp: new Date().toISOString(),
      context,
      message,
      data
    };

    this.addToHistory(entry);
    console.log(this.formatMessage('debug', context, message, data));
  }

  info(context: string, message: string, data?: unknown): void {
    const entry: LogEntry = {
      level: 'info',
      timestamp: new Date().toISOString(),
      context,
      message,
      data
    };

    this.addToHistory(entry);

    if (this.isDev) {
      console.info(this.formatMessage('info', context, message, data));
    }
  }

  warn(context: string, message: string, data?: unknown): void {
    const entry: LogEntry = {
      level: 'warn',
      timestamp: new Date().toISOString(),
      context,
      message,
      data
    };

    this.addToHistory(entry);
    console.warn(this.formatMessage('warn', context, message, data));
  }

  error(context: string, message: string, error?: Error | unknown): void {
    const entry: LogEntry = {
      level: 'error',
      timestamp: new Date().toISOString(),
      context,
      message,
      data: error instanceof Error ? {
        name: error.name,
        message: error.message,
        stack: this.isDev ? error.stack : undefined
      } : error
    };

    this.addToHistory(entry);
    console.error(this.formatMessage('error', context, message, entry.data));
  }

  /**
   * Get log history (useful for debugging)
   */
  getHistory(level?: LogLevel): LogEntry[] {
    if (level) {
      return this.logHistory.filter(entry => entry.level === level);
    }
    return [...this.logHistory];
  }

  /**
   * Clear log history
   */
  clearHistory(): void {
    this.logHistory = [];
  }

  /**
   * Export logs as text
   */
  exportLogs(): string {
    return this.logHistory
      .map(entry => this.formatMessage(entry.level, entry.context, entry.message, entry.data))
      .join('\n');
  }
}

/**
 * Global logger instance
 */
export const logger = new Logger();

/**
 * Convenience functions for context-specific logging
 */
export const createLogger = (context: string) => ({
  debug: (message: string, data?: unknown) => logger.debug(context, message, data),
  info: (message: string, data?: unknown) => logger.info(context, message, data),
  warn: (message: string, data?: unknown) => logger.warn(context, message, data),
  error: (message: string, error?: Error | unknown) => logger.error(context, message, error),
});

/**
 * Legacy log object for gradual migration
 * @deprecated Use createLogger() or logger directly instead
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
export const log = {
  debug: (...args: any[]) => logger.debug('Legacy', args.join(' ')),
  info: (...args: any[]) => logger.info('Legacy', args.join(' ')),
  error: (...args: any[]) => logger.error('Legacy', args.join(' ')),
  warn: (...args: any[]) => logger.warn('Legacy', args.join(' ')),
};
/* eslint-enable @typescript-eslint/no-explicit-any */
