import { RequestQueueService, llmRequestQueue, toolRequestQueue, storageRequestQueue } from '../queue';

// Polyfill setImmediate for Jest
if (typeof setImmediate === 'undefined') {
  (global as any).setImmediate = (fn: () => void) => setTimeout(fn, 0);
}

describe('RequestQueueService', () => {
  let queueService: RequestQueueService;

  beforeEach(() => {
    queueService = new RequestQueueService({
      maxConcurrent: 2,
      maxQueueSize: 10,
      requestsPerSecond: 100,
      retryDelays: [10, 20],
      timeout: 30000,
    });
  });

  afterEach(() => {
    queueService.clear();
  });

  describe('constructor', () => {
    it('should create with default config', () => {
      const service = new RequestQueueService();
      const status = service.getStatus();
      expect(status.maxConcurrent).toBe(3);
      expect(status.maxQueueSize).toBe(100);
      expect(status.requestsPerSecond).toBe(10);
    });

    it('should create with custom config', () => {
      const status = queueService.getStatus();
      expect(status.maxConcurrent).toBe(2);
      expect(status.maxQueueSize).toBe(10);
      expect(status.requestsPerSecond).toBe(100);
    });
  });

  describe('add', () => {
    it('should execute a simple request', async () => {
      const mockFn = jest.fn().mockResolvedValue('result');
      
      const result = await queueService.add(mockFn);
      
      expect(result).toBe('result');
      expect(mockFn).toHaveBeenCalled();
    });

    it('should use custom id when provided', async () => {
      const result = await queueService.add(() => Promise.resolve('done'), { id: 'custom-id' });
      
      expect(result).toBe('done');
      expect(queueService.getStatus().queueLength).toBe(0);
    });

    it('should throw when queue is full', async () => {
      const smallQueue = new RequestQueueService({
        maxConcurrent: 1,
        maxQueueSize: 2,
        requestsPerSecond: 100,
        timeout: 30000,
      });

      // Fill up the queue by adding slow tasks
      const slow = () => new Promise((resolve) => setTimeout(resolve, 200));
      
      // Add tasks to fill up the queue (1 active + 2 in queue = 3 total, but maxQueueSize is 2)
      const p1 = smallQueue.add(slow); // Goes active immediately
      const p2 = smallQueue.add(slow); // Goes to queue position 0
      const p3 = smallQueue.add(slow); // Goes to queue position 1
      
      // Fourth task should throw queue full error since queue has 2 items
      await expect(smallQueue.add(slow)).rejects.toThrow('Queue is full');
      
      // Clean up
      await Promise.allSettled([p1, p2, p3]);
    });

    it('should insert by priority (higher priority first)', async () => {
      const slowQueue = new RequestQueueService({
        maxConcurrent: 1,
        maxQueueSize: 10,
        requestsPerSecond: 100,
        timeout: 30000,
      });

      const results: number[] = [];
      const fastFn = (n: number) => async () => {
        results.push(n);
        return n;
      };

      // Start one request to block the queue
      const blocking = slowQueue.add(() => new Promise((resolve) => setTimeout(() => resolve(0), 50)));
      
      // Add low priority, then high priority
      const p1 = slowQueue.add(fastFn(1), { priority: 1 });
      const p2 = slowQueue.add(fastFn(2), { priority: 10 }); // Higher priority should run first
      
      await blocking;
      await Promise.all([p1, p2]);
      
      // High priority (2) should execute before low priority (1)
      expect(results[0]).toBe(2);
      expect(results[1]).toBe(1);
    });
  });

  describe('getStatus', () => {
    it('should return current queue status', () => {
      const status = queueService.getStatus();
      
      expect(status).toHaveProperty('queueLength');
      expect(status).toHaveProperty('activeRequests');
      expect(status).toHaveProperty('maxConcurrent');
      expect(status).toHaveProperty('maxQueueSize');
      expect(status).toHaveProperty('requestsPerSecond');
    });

    it('should report initial empty state', () => {
      const status = queueService.getStatus();
      expect(status.queueLength).toBe(0);
      expect(status.activeRequests).toBe(0);
    });
  });

  describe('getMetrics', () => {
    it('should return initial metrics with zeros', () => {
      const metrics = queueService.getMetrics();
      
      expect(metrics.totalRequests).toBe(0);
      expect(metrics.successfulRequests).toBe(0);
      expect(metrics.failedRequests).toBe(0);
      expect(metrics.retriedRequests).toBe(0);
      expect(metrics.successRate).toBe(0);
      expect(metrics.avgQueueTime).toBe(0);
      expect(metrics.avgExecutionTime).toBe(0);
    });

    it('should track successful requests', async () => {
      await queueService.add(() => Promise.resolve('done'));

      const metrics = queueService.getMetrics();
      expect(metrics.totalRequests).toBe(1);
      expect(metrics.successfulRequests).toBe(1);
      expect(metrics.successRate).toBe(100);
    });

    it('should track failed requests after max retries', async () => {
      const failingFn = jest.fn().mockRejectedValue(new Error('permanent error'));
      
      await expect(queueService.add(failingFn, { maxRetries: 0 })).rejects.toThrow('permanent error');
      
      const metrics = queueService.getMetrics();
      expect(metrics.failedRequests).toBe(1);
    });

    it('should track pending and completed requests', async () => {
      await queueService.add(() => Promise.resolve('done'));
      
      const metrics = queueService.getMetrics();
      expect(metrics.completedRequests).toBe(1);
      expect(metrics.pendingRequests).toBe(0);
    });
  });

  describe('clear', () => {
    it('should empty the queue', () => {
      queueService.clear();
      expect(queueService.getStatus().queueLength).toBe(0);
    });

    it('should reject pending items when cleared', async () => {
      const slowQueue = new RequestQueueService({
        maxConcurrent: 1,
        maxQueueSize: 10,
        requestsPerSecond: 100,
        timeout: 30000,
      });

      // Add a blocking request
      const blocking = slowQueue.add(() => new Promise((resolve) => setTimeout(resolve, 100)));
      
      // Add a request that will be in the queue
      const pendingPromise = slowQueue.add(() => Promise.resolve('pending'));
      
      // Clear the queue - this should reject the pending item
      slowQueue.clear();
      
      await expect(pendingPromise).rejects.toThrow('Queue cleared');
      await blocking; // Wait for blocking to complete
    });
  });

  describe('retry logic', () => {
    it('should retry failed requests', async () => {
      let attempts = 0;
      const failTwiceThenSucceed = jest.fn().mockImplementation(() => {
        attempts++;
        if (attempts < 3) {
          return Promise.reject(new Error('temporary failure'));
        }
        return Promise.resolve('success');
      });

      const result = await queueService.add(failTwiceThenSucceed, { maxRetries: 3 });
      
      expect(result).toBe('success');
      expect(failTwiceThenSucceed).toHaveBeenCalledTimes(3);
    }, 10000);

    it('should track retried requests in metrics', async () => {
      let attempts = 0;
      const failOnceThenSucceed = jest.fn().mockImplementation(() => {
        attempts++;
        if (attempts === 1) {
          return Promise.reject(new Error('temp failure'));
        }
        return Promise.resolve('ok');
      });

      await queueService.add(failOnceThenSucceed, { maxRetries: 2 });
      
      const metrics = queueService.getMetrics();
      expect(metrics.retriedRequests).toBeGreaterThan(0);
    }, 10000);
  });

  describe('updateConfig', () => {
    it('should update configuration', () => {
      queueService.updateConfig({ maxConcurrent: 5 });
      expect(queueService.getStatus().maxConcurrent).toBe(5);
    });

    it('should merge with existing config', () => {
      queueService.updateConfig({ maxConcurrent: 5 });
      expect(queueService.getStatus().maxQueueSize).toBe(10); // Original value preserved
    });
  });

  describe('waitForAll', () => {
    it('should resolve when no active requests', async () => {
      await queueService.waitForAll();
      expect(queueService.getStatus().activeRequests).toBe(0);
    });
  });

  describe('singleton instances', () => {
    it('should export llmRequestQueue with correct config', () => {
      const status = llmRequestQueue.getStatus();
      expect(status.maxConcurrent).toBe(1);
      expect(status.requestsPerSecond).toBe(5);
    });

    it('should export toolRequestQueue with correct config', () => {
      const status = toolRequestQueue.getStatus();
      expect(status.maxConcurrent).toBe(3);
      expect(status.requestsPerSecond).toBe(20);
    });

    it('should export storageRequestQueue with correct config', () => {
      const status = storageRequestQueue.getStatus();
      expect(status.maxConcurrent).toBe(5);
      expect(status.requestsPerSecond).toBe(50);
    });
  });
});

