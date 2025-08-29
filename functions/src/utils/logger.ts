export enum LogLevel {
  ERROR = 0,
  WARN = 1,
  INFO = 2,
  DEBUG = 3
}

const isEmulator = process.env.FUNCTIONS_EMULATOR === 'true';

class Logger {
  private currentLevel: LogLevel = isEmulator ? LogLevel.DEBUG : LogLevel.INFO;

  private shouldLog(level: LogLevel): boolean {
    return level <= this.currentLevel;
  }

  private formatMessage(level: string, message: string, data?: any): string {
    const timestamp = new Date().toISOString();
    const prefix = `[${timestamp}] [${level}]`;
    
    if (data !== undefined) {
      const sanitized = this.sanitizeData(data);
      return `${prefix} ${message} ${typeof sanitized === 'object' ? JSON.stringify(sanitized) : sanitized}`;
    }
    
    return `${prefix} ${message}`;
  }

  private sanitizeData(data: any): any {
    if (!data || typeof data !== 'object') {
      return data;
    }

    const sensitiveKeys = ['key', 'token', 'secret', 'password', 'authorization'];
    const sanitized = { ...data };

    for (const key of Object.keys(sanitized)) {
      const lowerKey = key.toLowerCase();
      if (sensitiveKeys.some(sensitive => lowerKey.includes(sensitive))) {
        if (typeof sanitized[key] === 'string' && sanitized[key].length > 10) {
          sanitized[key] = sanitized[key].substring(0, 10) + '...';
        } else {
          sanitized[key] = '[REDACTED]';
        }
      }
    }

    return sanitized;
  }

  error(message: string, data?: any): void {
    if (this.shouldLog(LogLevel.ERROR)) {
      console.error(this.formatMessage('ERROR', message, data));
    }
  }

  warn(message: string, data?: any): void {
    if (this.shouldLog(LogLevel.WARN)) {
      console.warn(this.formatMessage('WARN', message, data));
    }
  }

  info(message: string, data?: any): void {
    if (this.shouldLog(LogLevel.INFO)) {
      console.info(this.formatMessage('INFO', message, data));
    }
  }

  debug(message: string, data?: any): void {
    if (this.shouldLog(LogLevel.DEBUG)) {
      console.debug(this.formatMessage('DEBUG', message, data));
    }
  }

  // Specialized logging methods
  logApiCall(provider: string, operation: string, details?: any): void {
    this.debug(`API Call - ${provider} ${operation}`, this.sanitizeData(details));
  }

  logUserOperation(operation: string, userId: string, details?: any): void {
    this.info(`User Operation - ${operation}`, { userId, ...details });
  }

  logPerformance(operation: string, startTime: number, details?: any): void {
    const duration = Date.now() - startTime;
    this.info(`Performance - ${operation}`, { duration: `${duration}ms`, ...details });
  }

  logFunctionStart(functionName: string, params?: any): void {
    this.debug(`Function Start - ${functionName}`, this.sanitizeData(params));
  }

  logFunctionEnd(functionName: string, result?: any): void {
    this.debug(`Function End - ${functionName}`, this.sanitizeData(result));
  }
}

export const logger = new Logger();