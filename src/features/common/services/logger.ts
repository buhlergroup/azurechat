import { logger as appInsightsLogger } from '@/app/(authenticated)/application-insights-service';

/**
 * Centralized logging utility with cost-conscious production defaults
 * 
 * LOG LEVEL CONFIGURATION:
 * - Development: Logs all levels (debug, info, warn, error)
 * - Production: Only logs errors by default to minimize Application Insights costs
 * 
 * ENVIRONMENT VARIABLES:
 * - LOG_LEVEL or NEXT_PUBLIC_LOG_LEVEL: Override default behavior
 *   Values: 'error', 'warn', 'info', 'debug'
 *   Example: LOG_LEVEL=warn (logs error and warn only)
 * 
 * COST OPTIMIZATION:
 * - In production, only errors are sent to Application Insights
 * - Console logging still works for all levels in development
 */
export interface LogContext {
  [key: string]: any;
}

export interface LogLevel {
  DEBUG: 'debug';
  INFO: 'info';
  WARN: 'warn';
  ERROR: 'error';
}

export const LOG_LEVELS: LogLevel = {
  DEBUG: 'debug',
  INFO: 'info',
  WARN: 'warn',
  ERROR: 'error',
} as const;

type LogLevelType = typeof LOG_LEVELS[keyof typeof LOG_LEVELS];

class Logger {
  private isDevelopment = process.env.NODE_ENV === 'development';
  private isProduction = process.env.NODE_ENV === 'production';

  private formatMessage(level: LogLevelType, message: string, context?: LogContext): string {
    const timestamp = new Date().toISOString();
    const contextStr = context ? ` ${JSON.stringify(context)}` : '';
    return `[${timestamp}] [${level.toUpperCase()}] ${message}${contextStr}`;
  }

  private shouldLog(level: LogLevelType): boolean {
    // Check for explicit log level override from environment
    const logLevelOverride = process.env.LOG_LEVEL || process.env.NEXT_PUBLIC_LOG_LEVEL;
    
    if (logLevelOverride) {
      const allowedLevels: LogLevelType[] = [];
      switch (logLevelOverride.toLowerCase()) {
        case 'error':
          allowedLevels.push('error');
          break;
        case 'warn':
          allowedLevels.push('error', 'warn');
          break;
        case 'info':
          allowedLevels.push('error', 'warn', 'info');
          break;
        case 'debug':
          allowedLevels.push('error', 'warn', 'info', 'debug');
          break;
        default:
          // Invalid log level, fall back to default behavior
          break;
      }
      return allowedLevels.includes(level);
    }
    
    // In development, log everything
    if (this.isDevelopment) return true;
    
    // In production, only log errors by default to minimize costs
    if (this.isProduction) {
      return level === 'error';
    }
    
    return true;
  }

  private logToAppInsights(level: LogLevelType, message: string, context?: LogContext) {
    try {
      if (typeof window !== 'undefined' && appInsightsLogger) {
        // In production, only send errors to App Insights to minimize costs
        if (this.isProduction && level !== 'error') {
          return;
        }
        
        switch (level) {
          case 'error':
            appInsightsLogger.trackException({ error: new Error(message), properties: context });
            break;
          case 'warn':
            appInsightsLogger.trackTrace({ message, severityLevel: 2, properties: context });
            break;
          case 'info':
            appInsightsLogger.trackTrace({ message, severityLevel: 1, properties: context });
            break;
          case 'debug':
            appInsightsLogger.trackTrace({ message, severityLevel: 0, properties: context });
            break;
        }
      }
    } catch (error) {
      // Fallback to console if App Insights fails
      console.error('Failed to log to Application Insights:', error);
    }
  }

  debug(message: string, context?: LogContext): void {
    if (!this.shouldLog('debug')) return;
    
    const formattedMessage = this.formatMessage('debug', message, context);
    console.debug(formattedMessage);
    this.logToAppInsights('debug', message, context);
  }

  info(message: string, context?: LogContext): void {
    if (!this.shouldLog('info')) return;
    
    const formattedMessage = this.formatMessage('info', message, context);
    console.info(formattedMessage);
    this.logToAppInsights('info', message, context);
  }

  warn(message: string, context?: LogContext): void {
    if (!this.shouldLog('warn')) return;
    
    const formattedMessage = this.formatMessage('warn', message, context);
    console.warn(formattedMessage);
    this.logToAppInsights('warn', message, context);
  }

  error(message: string, context?: LogContext): void {
    if (!this.shouldLog('error')) return;
    
    const formattedMessage = this.formatMessage('error', message, context);
    console.error(formattedMessage);
    this.logToAppInsights('error', message, context);
  }

  // Convenience method for logging errors with error objects
  errorWithError(message: string, error: Error, context?: LogContext): void {
    const fullContext = {
      ...context,
      errorMessage: error.message,
      errorStack: error.stack,
      errorName: error.name,
    };
    this.error(message, fullContext);
  }

  // Method to log performance metrics
  metric(name: string, value: number, context?: LogContext): void {
    try {
      if (typeof window !== 'undefined' && appInsightsLogger) {
        appInsightsLogger.trackMetric({ name, average: value, properties: context });
      }
    } catch (error) {
      console.error('Failed to track metric:', error);
    }
  }

  // Method to log events
  event(name: string, context?: LogContext): void {
    try {
      if (typeof window !== 'undefined' && appInsightsLogger) {
        appInsightsLogger.trackEvent({ name, properties: context });
      }
    } catch (error) {
      console.error('Failed to track event:', error);
    }
  }
}

// Create a singleton instance
export const logger = new Logger();

// Export convenience functions for direct use
export const logDebug = (message: string, context?: LogContext) => logger.debug(message, context);
export const logInfo = (message: string, context?: LogContext) => logger.info(message, context);
export const logWarn = (message: string, context?: LogContext) => logger.warn(message, context);
export const logError = (message: string, context?: LogContext) => logger.error(message, context);
export const logErrorWithError = (message: string, error: Error, context?: LogContext) => logger.errorWithError(message, error, context);
export const logMetric = (name: string, value: number, context?: LogContext) => logger.metric(name, value, context);
export const logEvent = (name: string, context?: LogContext) => logger.event(name, context); 