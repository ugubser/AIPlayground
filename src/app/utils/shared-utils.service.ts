import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class SharedUtilsService {

  constructor() { }

  /**
   * Formats file size from bytes to human readable format
   */
  formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  /**
   * Abbreviates text to specified length with ellipsis
   */
  abbreviateText(text: string, maxLength: number): string {
    const cleaned = text.trim().replace(/\s+/g, ' ');
    
    if (cleaned.length <= maxLength) {
      return cleaned;
    }
    
    return cleaned.substring(0, maxLength).trim() + '...';
  }

  /**
   * Validates file type against expected type
   */
  validateFileType(file: File, expectedType: string): boolean {
    return file.type === expectedType || file.type.startsWith(expectedType);
  }

  /**
   * Creates a delay promise for async operations
   */
  delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Sanitizes data for logging (removes sensitive information)
   */
  sanitizeForLogging(data: any): any {
    if (!data || typeof data !== 'object') {
      return data;
    }

    const sensitiveKeys = ['password', 'token', 'key', 'secret', 'auth', 'api_key', 'apikey'];
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
}