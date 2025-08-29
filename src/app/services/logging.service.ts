import { Injectable } from '@angular/core';
import { environment } from '../../environments/environment';

export enum LogLevel {
  ERROR = 0,
  WARN = 1,
  INFO = 2,
  DEBUG = 3
}

@Injectable({
  providedIn: 'root'
})
export class LoggingService {
  private currentLevel: LogLevel = environment.production ? LogLevel.WARN : LogLevel.DEBUG;

  constructor() { }

  private shouldLog(level: LogLevel): boolean {
    return level <= this.currentLevel;
  }

  private formatMessage(level: string, message: string, data?: any): string {
    const timestamp = new Date().toISOString();
    const baseMessage = `[${timestamp}] [${level}] ${message}`;
    
    if (data !== undefined) {
      return `${baseMessage} ${typeof data === 'object' ? JSON.stringify(data) : data}`;
    }
    
    return baseMessage;
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

  // Specific logging methods for common operations
  logApiCall(provider: string, operation: string, details?: any): void {
    this.debug(`API Call - ${provider}`, { operation, ...details });
  }

  logUserAction(action: string, details?: any): void {
    this.info(`User Action - ${action}`, details);
  }

  logPerformance(operation: string, startTime: number, details?: any): void {
    const duration = Date.now() - startTime;
    this.debug(`Performance - ${operation}`, { duration: `${duration}ms`, ...details });
  }
}