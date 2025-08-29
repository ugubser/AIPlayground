"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = exports.LogLevel = void 0;
var LogLevel;
(function (LogLevel) {
    LogLevel[LogLevel["ERROR"] = 0] = "ERROR";
    LogLevel[LogLevel["WARN"] = 1] = "WARN";
    LogLevel[LogLevel["INFO"] = 2] = "INFO";
    LogLevel[LogLevel["DEBUG"] = 3] = "DEBUG";
})(LogLevel || (exports.LogLevel = LogLevel = {}));
const isEmulator = process.env.FUNCTIONS_EMULATOR === 'true';
class Logger {
    constructor() {
        this.currentLevel = isEmulator ? LogLevel.DEBUG : LogLevel.INFO;
    }
    shouldLog(level) {
        return level <= this.currentLevel;
    }
    formatMessage(level, message, data) {
        const timestamp = new Date().toISOString();
        const prefix = `[${timestamp}] [${level}]`;
        if (data !== undefined) {
            const sanitized = this.sanitizeData(data);
            return `${prefix} ${message} ${typeof sanitized === 'object' ? JSON.stringify(sanitized) : sanitized}`;
        }
        return `${prefix} ${message}`;
    }
    sanitizeData(data) {
        if (!data || typeof data !== 'object') {
            return data;
        }
        const sensitiveKeys = ['key', 'token', 'secret', 'password', 'authorization'];
        const sanitized = Object.assign({}, data);
        for (const key of Object.keys(sanitized)) {
            const lowerKey = key.toLowerCase();
            if (sensitiveKeys.some(sensitive => lowerKey.includes(sensitive))) {
                if (typeof sanitized[key] === 'string' && sanitized[key].length > 10) {
                    sanitized[key] = sanitized[key].substring(0, 10) + '...';
                }
                else {
                    sanitized[key] = '[REDACTED]';
                }
            }
        }
        return sanitized;
    }
    error(message, data) {
        if (this.shouldLog(LogLevel.ERROR)) {
            console.error(this.formatMessage('ERROR', message, data));
        }
    }
    warn(message, data) {
        if (this.shouldLog(LogLevel.WARN)) {
            console.warn(this.formatMessage('WARN', message, data));
        }
    }
    info(message, data) {
        if (this.shouldLog(LogLevel.INFO)) {
            console.info(this.formatMessage('INFO', message, data));
        }
    }
    debug(message, data) {
        if (this.shouldLog(LogLevel.DEBUG)) {
            console.debug(this.formatMessage('DEBUG', message, data));
        }
    }
    // Specialized logging methods
    logApiCall(provider, operation, details) {
        this.debug(`API Call - ${provider} ${operation}`, this.sanitizeData(details));
    }
    logUserOperation(operation, userId, details) {
        this.info(`User Operation - ${operation}`, Object.assign({ userId }, details));
    }
    logPerformance(operation, startTime, details) {
        const duration = Date.now() - startTime;
        this.info(`Performance - ${operation}`, Object.assign({ duration: `${duration}ms` }, details));
    }
    logFunctionStart(functionName, params) {
        this.debug(`Function Start - ${functionName}`, this.sanitizeData(params));
    }
    logFunctionEnd(functionName, result) {
        this.debug(`Function End - ${functionName}`, this.sanitizeData(result));
    }
}
exports.logger = new Logger();
//# sourceMappingURL=logger.js.map