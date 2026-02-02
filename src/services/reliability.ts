/**
 * Reliability service for error handling, retry logic, and state recovery
 */
export class ReliabilityService {
  private static readonly MAX_RETRIES = 3;
  private static readonly RETRY_DELAYS = [1000, 2000, 4000]; // Exponential backoff in ms

  /**
   * Retry a promise-based operation with exponential backoff
   */
  static async retryWithBackoff<T>(
    operation: () => Promise<T>,
    operationName: string,
    maxRetries: number = this.MAX_RETRIES
  ): Promise<T> {
    let lastError: Error | unknown;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;

        // Check if error is retryable
        if (!this.isRetryableError(error)) {
          throw error;
        }

        // If not the last attempt, wait before retrying
        if (attempt < maxRetries - 1) {
          const delay = this.RETRY_DELAYS[attempt] || this.RETRY_DELAYS[this.RETRY_DELAYS.length - 1];
          await this.sleep(delay);
        }
      }
    }

    throw lastError;
  }

  /**
   * Determine if an error should trigger a retry
   */
  private static isRetryableError(error: unknown): boolean {
    if (!error) {
      return false;
    }

    // Network errors
    if (error instanceof TypeError && error.message.includes('fetch')) {
      return true;
    }

    // Check error message for common retryable patterns
    const errorMessage = String(error).toLowerCase();

    const retryablePatterns = [
      'network',
      'timeout',
      'econnrefused',
      'enotfound',
      'rate limit',
      '429',
      '500',
      '502',
      '503',
      '504',
      'temporarily unavailable',
      'too many requests',
    ];

    return retryablePatterns.some((pattern) => errorMessage.includes(pattern));
  }

  /**
   * Sleep utility for retry delays
   */
  private static sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Categorize error types for better handling
   */
  static categorizeError(error: unknown): {
    type: 'network' | 'api' | 'tool' | 'validation' | 'storage' | 'unknown';
    message: string;
    retryable: boolean;
  } {
    const errorStr = String(error).toLowerCase();
    const errorMessage = error instanceof Error ? error.message : String(error);

    // Network errors
    if (
      errorStr.includes('network') ||
      errorStr.includes('fetch') ||
      errorStr.includes('econnrefused') ||
      errorStr.includes('timeout')
    ) {
      return {
        type: 'network',
        message: 'Network connection error. Please check your connection and try again.',
        retryable: true,
      };
    }

    // API errors (rate limits, server errors)
    if (
      errorStr.includes('rate limit') ||
      errorStr.includes('429') ||
      errorStr.includes('500') ||
      errorStr.includes('502') ||
      errorStr.includes('503')
    ) {
      return {
        type: 'api',
        message: 'API request failed. The service may be temporarily unavailable.',
        retryable: true,
      };
    }

    // Tool execution errors
    if (errorStr.includes('tool') || errorStr.includes('function')) {
      return {
        type: 'tool',
        message: `Tool execution failed: ${errorMessage}`,
        retryable: false,
      };
    }

    // Validation errors
    if (errorStr.includes('validation') || errorStr.includes('invalid')) {
      return {
        type: 'validation',
        message: `Validation error: ${errorMessage}`,
        retryable: false,
      };
    }

    // Storage errors
    if (errorStr.includes('storage') || errorStr.includes('quota')) {
      return {
        type: 'storage',
        message: 'Storage error. Your browser storage may be full.',
        retryable: false,
      };
    }

    return {
      type: 'unknown',
      message: errorMessage,
      retryable: false,
    };
  }

  /**
   * Create a user-friendly error message
   */
  static getUserFriendlyErrorMessage(error: unknown): string {
    const categorized = this.categorizeError(error);

    switch (categorized.type) {
      case 'network':
        return '🌐 Network error: Unable to connect. Please check your internet connection and try again.';
      case 'api':
        return '⚠️ Service temporarily unavailable: The API is currently experiencing issues. Please try again in a moment.';
      case 'tool':
        return `🔧 Tool error: ${categorized.message}`;
      case 'validation':
        return `❌ Validation error: ${categorized.message}`;
      case 'storage':
        return '💾 Storage error: Unable to save data. Your browser storage may be full. Consider clearing old conversations.';
      default:
        return `❌ An error occurred: ${categorized.message}`;
    }
  }

  /**
   * State recovery: Save and restore conversation state
   */
  private static readonly RECOVERY_KEY = 'grafana-o11y-chat-recovery';

  static saveRecoveryState(data: { sessionId: string | null; lastMessageIndex: number; wasGenerating: boolean }): void {
    try {
      sessionStorage.setItem(this.RECOVERY_KEY, JSON.stringify(data));
    } catch (error) {
      console.error('Failed to save recovery state:', error);
    }
  }

  static loadRecoveryState(): {
    sessionId: string | null;
    lastMessageIndex: number;
    wasGenerating: boolean;
  } | null {
    try {
      const data = sessionStorage.getItem(this.RECOVERY_KEY);
      return data ? JSON.parse(data) : null;
    } catch (error) {
      console.error('Failed to load recovery state:', error);
      return null;
    }
  }

  static clearRecoveryState(): void {
    try {
      sessionStorage.removeItem(this.RECOVERY_KEY);
    } catch (error) {
      console.error('Failed to clear recovery state:', error);
    }
  }

  /**
   * Check if a recovery is available
   */
  static hasRecoveryState(): boolean {
    return sessionStorage.getItem(this.RECOVERY_KEY) !== null;
  }

  /**
   * Safe operation wrapper that catches and logs errors
   */
  static async safeOperation<T>(operation: () => Promise<T>, fallback: T, operationName: string): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      console.error(`[Reliability] Safe operation "${operationName}" failed:`, error);
      return fallback;
    }
  }

  /**
   * Validate tool call before execution
   */
  static validateToolCall(toolCall: { function: { name: string; arguments: string }; id: string }): {
    valid: boolean;
    error?: string;
  } {
    if (!toolCall.function?.name) {
      return { valid: false, error: 'Tool name is missing' };
    }

    try {
      // Try to parse arguments
      JSON.parse(toolCall.function.arguments);
      return { valid: true };
    } catch (error) {
      return { valid: false, error: 'Invalid tool arguments JSON' };
    }
  }

  /**
   * Rate limiter for API calls
   */
  private static rateLimitMap = new Map<string, { count: number; resetTime: number }>();

  static checkRateLimit(key: string, maxCalls: number, windowMs: number): boolean {
    const now = Date.now();
    const record = this.rateLimitMap.get(key);

    if (!record || now > record.resetTime) {
      // Reset or initialize
      this.rateLimitMap.set(key, { count: 1, resetTime: now + windowMs });
      return true;
    }

    if (record.count >= maxCalls) {
      return false; // Rate limit exceeded
    }

    record.count++;
    return true;
  }

  /**
   * Circuit breaker pattern for failing operations
   */
  private static circuitBreakers = new Map<
    string,
    { failures: number; lastFailure: number; state: 'closed' | 'open' | 'half-open' }
  >();

  private static readonly CIRCUIT_BREAKER_THRESHOLD = 5;
  private static readonly CIRCUIT_BREAKER_TIMEOUT = 60000; // 1 minute

  static checkCircuitBreaker(key: string): boolean {
    const breaker = this.circuitBreakers.get(key);
    const now = Date.now();

    if (!breaker) {
      this.circuitBreakers.set(key, { failures: 0, lastFailure: 0, state: 'closed' });
      return true;
    }

    // If open, check if timeout has passed
    if (breaker.state === 'open') {
      if (now - breaker.lastFailure > this.CIRCUIT_BREAKER_TIMEOUT) {
        breaker.state = 'half-open';
        return true;
      }
      return false; // Circuit is still open
    }

    return true; // Closed or half-open
  }

  static recordCircuitBreakerFailure(key: string): void {
    const breaker = this.circuitBreakers.get(key);
    const now = Date.now();

    if (!breaker) {
      this.circuitBreakers.set(key, { failures: 1, lastFailure: now, state: 'closed' });
      return;
    }

    breaker.failures++;
    breaker.lastFailure = now;

    if (breaker.failures >= this.CIRCUIT_BREAKER_THRESHOLD) {
      breaker.state = 'open';
    }
  }

  static recordCircuitBreakerSuccess(key: string): void {
    const breaker = this.circuitBreakers.get(key);
    if (breaker) {
      breaker.failures = 0;
      breaker.state = 'closed';
    }
  }
}
