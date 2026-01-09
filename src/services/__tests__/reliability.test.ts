import { ReliabilityService } from '../reliability';

// Mock sessionStorage for testing
const mockSessionStorage = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: jest.fn((key: string) => store[key] || null),
    setItem: jest.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: jest.fn((key: string) => {
      delete store[key];
    }),
    clear: jest.fn(() => {
      store = {};
    }),
  };
})();

Object.defineProperty(window, 'sessionStorage', {
  value: mockSessionStorage,
});

describe('ReliabilityService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSessionStorage.clear();
    // Clear internal state between tests
    (ReliabilityService as any).rateLimitMap?.clear?.();
    (ReliabilityService as any).circuitBreakers?.clear?.();
  });

  describe('retryWithBackoff', () => {
    it('should return result on first successful attempt', async () => {
      const operation = jest.fn().mockResolvedValue('success');

      const result = await ReliabilityService.retryWithBackoff(operation, 'testOp', 3);

      expect(result).toBe('success');
      expect(operation).toHaveBeenCalledTimes(1);
    });

    it('should retry on retryable error and eventually succeed', async () => {
      const operation = jest
        .fn()
        .mockRejectedValueOnce(new Error('network error'))
        .mockResolvedValue('success');

      const result = await ReliabilityService.retryWithBackoff(operation, 'testOp', 3);

      expect(result).toBe('success');
      expect(operation).toHaveBeenCalledTimes(2);
    }, 10000);

    it('should throw after max retries', async () => {
      const operation = jest.fn().mockRejectedValue(new Error('timeout error'));

      await expect(ReliabilityService.retryWithBackoff(operation, 'testOp', 2)).rejects.toThrow('timeout error');
      expect(operation).toHaveBeenCalledTimes(2);
    }, 10000);

    it('should not retry on non-retryable error', async () => {
      const operation = jest.fn().mockRejectedValue(new Error('validation failed'));

      await expect(ReliabilityService.retryWithBackoff(operation, 'testOp', 3)).rejects.toThrow('validation failed');
      expect(operation).toHaveBeenCalledTimes(1);
    });

    it('should retry on 429 rate limit error', async () => {
      const operation = jest
        .fn()
        .mockRejectedValueOnce(new Error('429 Too Many Requests'))
        .mockResolvedValue('success');

      const result = await ReliabilityService.retryWithBackoff(operation, 'testOp', 3);

      expect(result).toBe('success');
      expect(operation).toHaveBeenCalledTimes(2);
    }, 10000);

    it('should retry on 503 service unavailable', async () => {
      const operation = jest
        .fn()
        .mockRejectedValueOnce(new Error('503 Service Unavailable'))
        .mockResolvedValue('success');

      const result = await ReliabilityService.retryWithBackoff(operation, 'testOp', 3);

      expect(result).toBe('success');
      expect(operation).toHaveBeenCalledTimes(2);
    }, 10000);
  });

  describe('categorizeError', () => {
    it('should categorize network errors', () => {
      const result = ReliabilityService.categorizeError(new Error('network connection failed'));

      expect(result.type).toBe('network');
      expect(result.retryable).toBe(true);
    });

    it('should categorize fetch errors', () => {
      const result = ReliabilityService.categorizeError(new TypeError('fetch failed'));

      expect(result.type).toBe('network');
      expect(result.retryable).toBe(true);
    });

    it('should categorize timeout errors', () => {
      const result = ReliabilityService.categorizeError(new Error('timeout'));

      expect(result.type).toBe('network');
      expect(result.retryable).toBe(true);
    });

    it('should categorize ECONNREFUSED errors', () => {
      const result = ReliabilityService.categorizeError(new Error('ECONNREFUSED'));

      expect(result.type).toBe('network');
      expect(result.retryable).toBe(true);
    });

    it('should categorize rate limit errors', () => {
      const result = ReliabilityService.categorizeError(new Error('rate limit exceeded'));

      expect(result.type).toBe('api');
      expect(result.retryable).toBe(true);
    });

    it('should categorize 429 errors', () => {
      const result = ReliabilityService.categorizeError(new Error('429 Too Many Requests'));

      expect(result.type).toBe('api');
      expect(result.retryable).toBe(true);
    });

    it('should categorize 500 errors', () => {
      const result = ReliabilityService.categorizeError(new Error('500 Internal Server Error'));

      expect(result.type).toBe('api');
      expect(result.retryable).toBe(true);
    });

    it('should categorize 502 errors', () => {
      const result = ReliabilityService.categorizeError(new Error('502 Bad Gateway'));

      expect(result.type).toBe('api');
      expect(result.retryable).toBe(true);
    });

    it('should categorize 503 errors', () => {
      const result = ReliabilityService.categorizeError(new Error('503 Service Unavailable'));

      expect(result.type).toBe('api');
      expect(result.retryable).toBe(true);
    });

    it('should categorize tool errors', () => {
      const result = ReliabilityService.categorizeError(new Error('tool execution failed'));

      expect(result.type).toBe('tool');
      expect(result.retryable).toBe(false);
    });

    it('should categorize function errors', () => {
      const result = ReliabilityService.categorizeError(new Error('function call failed'));

      expect(result.type).toBe('tool');
      expect(result.retryable).toBe(false);
    });

    it('should categorize validation errors', () => {
      const result = ReliabilityService.categorizeError(new Error('validation failed'));

      expect(result.type).toBe('validation');
      expect(result.retryable).toBe(false);
    });

    it('should categorize invalid errors', () => {
      const result = ReliabilityService.categorizeError(new Error('invalid input'));

      expect(result.type).toBe('validation');
      expect(result.retryable).toBe(false);
    });

    it('should categorize storage errors', () => {
      const result = ReliabilityService.categorizeError(new Error('storage access denied'));

      expect(result.type).toBe('storage');
      expect(result.retryable).toBe(false);
    });

    it('should categorize quota errors', () => {
      const result = ReliabilityService.categorizeError(new Error('quota exceeded'));

      expect(result.type).toBe('storage');
      expect(result.retryable).toBe(false);
    });

    it('should categorize unknown errors', () => {
      const result = ReliabilityService.categorizeError(new Error('something went wrong'));

      expect(result.type).toBe('unknown');
      expect(result.retryable).toBe(false);
    });

    it('should handle non-Error objects', () => {
      const result = ReliabilityService.categorizeError('string error');

      expect(result.type).toBe('unknown');
      expect(result.message).toContain('string error');
    });

    it('should handle null/undefined errors', () => {
      const resultNull = ReliabilityService.categorizeError(null);
      const resultUndefined = ReliabilityService.categorizeError(undefined);

      expect(resultNull.type).toBe('unknown');
      expect(resultUndefined.type).toBe('unknown');
    });
  });

  describe('getUserFriendlyErrorMessage', () => {
    it('should return friendly message for network error', () => {
      const message = ReliabilityService.getUserFriendlyErrorMessage(new Error('network failed'));

      expect(message).toContain('Network error');
      expect(message).toContain('🌐');
    });

    it('should return friendly message for API error', () => {
      const message = ReliabilityService.getUserFriendlyErrorMessage(new Error('429 rate limit'));

      expect(message).toContain('temporarily unavailable');
      expect(message).toContain('⚠️');
    });

    it('should return friendly message for tool error', () => {
      const message = ReliabilityService.getUserFriendlyErrorMessage(new Error('tool failed'));

      expect(message).toContain('Tool error');
      expect(message).toContain('🔧');
    });

    it('should return friendly message for validation error', () => {
      const message = ReliabilityService.getUserFriendlyErrorMessage(new Error('invalid input'));

      expect(message).toContain('Validation error');
      expect(message).toContain('❌');
    });

    it('should return friendly message for storage error', () => {
      const message = ReliabilityService.getUserFriendlyErrorMessage(new Error('storage quota exceeded'));

      expect(message).toContain('Storage error');
      expect(message).toContain('💾');
    });

    it('should return friendly message for unknown error', () => {
      const message = ReliabilityService.getUserFriendlyErrorMessage(new Error('something happened'));

      expect(message).toContain('An error occurred');
      expect(message).toContain('❌');
    });
  });

  describe('saveRecoveryState', () => {
    it('should save recovery state to sessionStorage', () => {
      const state = { sessionId: 'test-session', lastMessageIndex: 5, wasGenerating: true };

      ReliabilityService.saveRecoveryState(state);

      expect(mockSessionStorage.setItem).toHaveBeenCalledWith(
        'grafana-o11y-chat-recovery',
        JSON.stringify(state)
      );
    });

    it('should handle null sessionId', () => {
      const state = { sessionId: null, lastMessageIndex: 0, wasGenerating: false };

      ReliabilityService.saveRecoveryState(state);

      expect(mockSessionStorage.setItem).toHaveBeenCalled();
    });
  });

  describe('loadRecoveryState', () => {
    it('should load recovery state from sessionStorage', () => {
      const state = { sessionId: 'test-session', lastMessageIndex: 5, wasGenerating: true };
      mockSessionStorage.getItem.mockReturnValue(JSON.stringify(state));

      const result = ReliabilityService.loadRecoveryState();

      expect(result).toEqual(state);
    });

    it('should return null when no state exists', () => {
      mockSessionStorage.getItem.mockReturnValue(null);

      const result = ReliabilityService.loadRecoveryState();

      expect(result).toBeNull();
    });

    it('should return null on parse error', () => {
      mockSessionStorage.getItem.mockReturnValue('invalid json');

      const result = ReliabilityService.loadRecoveryState();

      expect(result).toBeNull();
    });
  });

  describe('clearRecoveryState', () => {
    it('should remove recovery state from sessionStorage', () => {
      ReliabilityService.clearRecoveryState();

      expect(mockSessionStorage.removeItem).toHaveBeenCalledWith('grafana-o11y-chat-recovery');
    });
  });

  describe('hasRecoveryState', () => {
    it('should return true when state exists', () => {
      mockSessionStorage.getItem.mockReturnValue('{"sessionId": "test"}');

      expect(ReliabilityService.hasRecoveryState()).toBe(true);
    });

    it('should return false when no state exists', () => {
      mockSessionStorage.getItem.mockReturnValue(null);

      expect(ReliabilityService.hasRecoveryState()).toBe(false);
    });
  });

  describe('safeOperation', () => {
    it('should return result on success', async () => {
      const operation = jest.fn().mockResolvedValue('result');

      const result = await ReliabilityService.safeOperation(operation, 'fallback', 'testOp');

      expect(result).toBe('result');
    });

    it('should return fallback on error', async () => {
      const operation = jest.fn().mockRejectedValue(new Error('failed'));

      const result = await ReliabilityService.safeOperation(operation, 'fallback', 'testOp');

      expect(result).toBe('fallback');
    });
  });

  describe('validateToolCall', () => {
    it('should return valid for proper tool call', () => {
      const toolCall = {
        id: 'call-1',
        function: {
          name: 'test_tool',
          arguments: '{"key": "value"}',
        },
      };

      const result = ReliabilityService.validateToolCall(toolCall);

      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should return invalid when tool name is missing', () => {
      const toolCall = {
        id: 'call-1',
        function: {
          name: '',
          arguments: '{}',
        },
      };

      const result = ReliabilityService.validateToolCall(toolCall);

      expect(result.valid).toBe(false);
      expect(result.error).toBe('Tool name is missing');
    });

    it('should return invalid when function is undefined', () => {
      const toolCall = {
        id: 'call-1',
        function: undefined as any,
      };

      const result = ReliabilityService.validateToolCall(toolCall);

      expect(result.valid).toBe(false);
      expect(result.error).toBe('Tool name is missing');
    });

    it('should return invalid for malformed JSON arguments', () => {
      const toolCall = {
        id: 'call-1',
        function: {
          name: 'test_tool',
          arguments: 'not json',
        },
      };

      const result = ReliabilityService.validateToolCall(toolCall);

      expect(result.valid).toBe(false);
      expect(result.error).toBe('Invalid tool arguments JSON');
    });
  });

  describe('checkRateLimit', () => {
    it('should allow first request', () => {
      const result = ReliabilityService.checkRateLimit('test-key', 5, 60000);

      expect(result).toBe(true);
    });

    it('should allow requests within limit', () => {
      for (let i = 0; i < 5; i++) {
        expect(ReliabilityService.checkRateLimit('multi-key', 5, 60000)).toBe(true);
      }
    });

    it('should block requests over limit', () => {
      for (let i = 0; i < 5; i++) {
        ReliabilityService.checkRateLimit('limit-key', 5, 60000);
      }

      expect(ReliabilityService.checkRateLimit('limit-key', 5, 60000)).toBe(false);
    });

    it('should reset after window expires', async () => {
      // Exceed the limit
      for (let i = 0; i < 5; i++) {
        ReliabilityService.checkRateLimit('expire-key', 5, 10); // 10ms window
      }

      // Wait for window to expire
      await new Promise((resolve) => setTimeout(resolve, 20));

      // Should be allowed again
      expect(ReliabilityService.checkRateLimit('expire-key', 5, 10)).toBe(true);
    });
  });

  describe('checkCircuitBreaker', () => {
    it('should allow first request', () => {
      const result = ReliabilityService.checkCircuitBreaker('test-circuit');

      expect(result).toBe(true);
    });

    it('should stay closed on few failures', () => {
      for (let i = 0; i < 3; i++) {
        ReliabilityService.recordCircuitBreakerFailure('few-failures');
      }

      expect(ReliabilityService.checkCircuitBreaker('few-failures')).toBe(true);
    });

    it('should open after threshold failures', () => {
      for (let i = 0; i < 5; i++) {
        ReliabilityService.recordCircuitBreakerFailure('many-failures');
      }

      expect(ReliabilityService.checkCircuitBreaker('many-failures')).toBe(false);
    });

    it('should close after success', () => {
      // Record some failures (but not enough to open)
      for (let i = 0; i < 3; i++) {
        ReliabilityService.recordCircuitBreakerFailure('recover-circuit');
      }

      // Record a success
      ReliabilityService.recordCircuitBreakerSuccess('recover-circuit');

      // Check that new failures are being counted from 0
      expect(ReliabilityService.checkCircuitBreaker('recover-circuit')).toBe(true);
    });

    it('should allow request when circuit is half-open after timeout', async () => {
      // Open the circuit
      for (let i = 0; i < 5; i++) {
        ReliabilityService.recordCircuitBreakerFailure('timeout-circuit');
      }
      expect(ReliabilityService.checkCircuitBreaker('timeout-circuit')).toBe(false);

      // Manually set the lastFailure to simulate timeout
      const breaker = (ReliabilityService as any).circuitBreakers.get('timeout-circuit');
      breaker.lastFailure = Date.now() - 61000; // 61 seconds ago

      // Should allow request (half-open state)
      expect(ReliabilityService.checkCircuitBreaker('timeout-circuit')).toBe(true);
    });
  });

  describe('recordCircuitBreakerSuccess', () => {
    it('should reset circuit breaker on success', () => {
      // Record some failures
      for (let i = 0; i < 3; i++) {
        ReliabilityService.recordCircuitBreakerFailure('success-circuit');
      }

      // Record success
      ReliabilityService.recordCircuitBreakerSuccess('success-circuit');

      // Now we should be able to add more failures without opening
      for (let i = 0; i < 4; i++) {
        ReliabilityService.recordCircuitBreakerFailure('success-circuit');
      }

      // Should still be closed (4 failures, not 5)
      expect(ReliabilityService.checkCircuitBreaker('success-circuit')).toBe(true);
    });

    it('should handle success for unknown circuit', () => {
      // Should not throw
      expect(() => {
        ReliabilityService.recordCircuitBreakerSuccess('unknown-circuit');
      }).not.toThrow();
    });
  });
});
