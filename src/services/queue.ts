/**
 * Request Queue Service
 * Manages concurrent requests with rate limiting and queuing
 * Prevents overwhelming backend services and ensures stable performance
 */

interface QueueItem<T = any> {
  id: string;
  execute: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (error: any) => void;
  priority: number;
  timestamp: number;
  retryCount: number;
  maxRetries: number;
}

interface QueueConfig {
  maxConcurrent: number;
  maxQueueSize: number;
  requestsPerSecond: number;
  retryDelays: number[];
  defaultPriority: number;
  timeout: number;
}

export class RequestQueueService {
  private queue: QueueItem[] = [];
  private activeRequests = new Map<string, Promise<any>>();
  private requestCount = 0;
  private requestCountResetTime = 0;

  private config: QueueConfig = {
    maxConcurrent: 3,
    maxQueueSize: 100,
    requestsPerSecond: 10,
    retryDelays: [1000, 2000, 5000], // Exponential backoff
    defaultPriority: 5,
    timeout: 30000, // 30 seconds
  };

  // Metrics for monitoring
  private metrics = {
    totalRequests: 0,
    successfulRequests: 0,
    failedRequests: 0,
    retriedRequests: 0,
    queuedTime: [] as number[],
    executionTime: [] as number[],
  };

  constructor(config?: Partial<QueueConfig>) {
    if (config) {
      this.config = { ...this.config, ...config };
    }
  }

  /**
   * Add a request to the queue
   * @param execute Function that returns a promise
   * @param options Queue options
   * @returns Promise that resolves when the request completes
   */
  async add<T>(
    execute: () => Promise<T>,
    options: {
      priority?: number;
      maxRetries?: number;
      id?: string;
    } = {}
  ): Promise<T> {
    const {
      priority = this.config.defaultPriority,
      maxRetries = this.config.retryDelays.length,
      id = this.generateId(),
    } = options;

    // Check queue size limit
    if (this.queue.length >= this.config.maxQueueSize) {
      throw new Error(`Queue is full (max size: ${this.config.maxQueueSize})`);
    }

    return new Promise<T>((resolve, reject) => {
      const queueItem: QueueItem<T> = {
        id,
        execute,
        resolve,
        reject,
        priority,
        timestamp: Date.now(),
        retryCount: 0,
        maxRetries,
      };

      // Add to queue sorted by priority (higher priority first)
      const insertIndex = this.queue.findIndex((item) => item.priority < priority);
      if (insertIndex === -1) {
        this.queue.push(queueItem);
      } else {
        this.queue.splice(insertIndex, 0, queueItem);
      }

      console.log(`[RequestQueue] Added request ${id} to queue. Queue size: ${this.queue.length}`);

      // Start processing
      this.processQueue();
    });
  }

  /**
   * Process items in the queue
   */
  private async processQueue() {
    // Check if we can process more requests
    if (this.activeRequests.size >= this.config.maxConcurrent || this.queue.length === 0) {
      return;
    }

    // Check rate limiting
    if (!this.checkRateLimit()) {
      // Schedule retry after rate limit window
      const delay = this.getRateLimitDelay();
      console.log(`[RequestQueue] Rate limit reached, waiting ${delay}ms`);
      setTimeout(() => this.processQueue(), delay);
      return;
    }

    // Get next item from queue
    const item = this.queue.shift();
    if (!item) {
      return;
    }

    // Record metrics
    const queueTime = Date.now() - item.timestamp;
    this.metrics.queuedTime.push(queueTime);
    this.metrics.totalRequests++;

    console.log(`[RequestQueue] Processing request ${item.id} after ${queueTime}ms in queue`);

    // Execute the request
    this.executeRequest(item);

    // Continue processing queue
    if (this.queue.length > 0) {
      setImmediate(() => this.processQueue());
    }
  }

  /**
   * Execute a queued request with retries and timeout
   */
  private async executeRequest<T>(item: QueueItem<T>) {
    const startTime = Date.now();
    const timeoutId = setTimeout(() => {
      if (this.activeRequests.has(item.id)) {
        item.reject(new Error(`Request ${item.id} timed out after ${this.config.timeout}ms`));
        this.activeRequests.delete(item.id);
        this.metrics.failedRequests++;
      }
    }, this.config.timeout);

    try {
      // Track active request
      const requestPromise = item.execute();
      this.activeRequests.set(item.id, requestPromise);

      // Update rate limiting counters
      this.recordRequest();

      // Wait for completion
      const result = await requestPromise;

      clearTimeout(timeoutId);
      this.activeRequests.delete(item.id);

      // Record success metrics
      const executionTime = Date.now() - startTime;
      this.metrics.executionTime.push(executionTime);
      this.metrics.successfulRequests++;

      console.log(`[RequestQueue] Request ${item.id} completed in ${executionTime}ms`);

      item.resolve(result);

      // Process next item in queue
      this.processQueue();
    } catch (error) {
      clearTimeout(timeoutId);
      this.activeRequests.delete(item.id);

      // Check if we should retry
      if (item.retryCount < item.maxRetries) {
        const retryDelay = this.config.retryDelays[item.retryCount] || 5000;
        item.retryCount++;

        console.log(
          `[RequestQueue] Request ${item.id} failed, retrying (${item.retryCount}/${item.maxRetries}) after ${retryDelay}ms`,
          error
        );

        this.metrics.retriedRequests++;

        // Re-add to queue with delay
        setTimeout(() => {
          // Re-add with same priority but at the front of that priority group
          const insertIndex = this.queue.findIndex((i) => i.priority < item.priority);
          if (insertIndex === -1) {
            this.queue.push(item);
          } else {
            this.queue.splice(insertIndex, 0, item);
          }
          this.processQueue();
        }, retryDelay);
      } else {
        // Max retries reached, reject the promise
        console.error(`[RequestQueue] Request ${item.id} failed after ${item.retryCount} retries`, error);
        this.metrics.failedRequests++;
        item.reject(error);

        // Process next item
        this.processQueue();
      }
    }
  }

  /**
   * Check if we're within rate limits
   */
  private checkRateLimit(): boolean {
    const now = Date.now();

    // Reset counter every second
    if (now - this.requestCountResetTime > 1000) {
      this.requestCount = 0;
      this.requestCountResetTime = now;
    }

    return this.requestCount < this.config.requestsPerSecond;
  }

  /**
   * Get delay until rate limit resets
   */
  private getRateLimitDelay(): number {
    const now = Date.now();
    const timeSinceReset = now - this.requestCountResetTime;
    return Math.max(0, 1000 - timeSinceReset);
  }

  /**
   * Record a request for rate limiting
   */
  private recordRequest() {
    this.requestCount++;
  }

  /**
   * Generate unique ID for request
   */
  private generateId(): string {
    return `req-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * Clear the queue
   */
  clear() {
    // Reject all pending items
    for (const item of this.queue) {
      item.reject(new Error('Queue cleared'));
    }
    this.queue = [];

    console.log('[RequestQueue] Queue cleared');
  }

  /**
   * Get queue status
   */
  getStatus() {
    return {
      queueLength: this.queue.length,
      activeRequests: this.activeRequests.size,
      maxConcurrent: this.config.maxConcurrent,
      maxQueueSize: this.config.maxQueueSize,
      requestsPerSecond: this.config.requestsPerSecond,
    };
  }

  /**
   * Get queue metrics
   */
  getMetrics() {
    const avgQueueTime =
      this.metrics.queuedTime.length > 0
        ? this.metrics.queuedTime.reduce((a, b) => a + b, 0) / this.metrics.queuedTime.length
        : 0;

    const avgExecutionTime =
      this.metrics.executionTime.length > 0
        ? this.metrics.executionTime.reduce((a, b) => a + b, 0) / this.metrics.executionTime.length
        : 0;

    return {
      totalRequests: this.metrics.totalRequests,
      successfulRequests: this.metrics.successfulRequests,
      failedRequests: this.metrics.failedRequests,
      retriedRequests: this.metrics.retriedRequests,
      successRate:
        this.metrics.totalRequests > 0 ? (this.metrics.successfulRequests / this.metrics.totalRequests) * 100 : 0,
      avgQueueTime: Math.round(avgQueueTime),
      avgExecutionTime: Math.round(avgExecutionTime),
      activeRequests: this.activeRequests.size,
      pendingRequests: this.queue.length,
      completedRequests: this.metrics.successfulRequests,
    };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<QueueConfig>) {
    this.config = { ...this.config, ...config };
    console.log('[RequestQueue] Configuration updated:', this.config);
  }

  /**
   * Wait for all active requests to complete
   */
  async waitForAll(): Promise<void> {
    const promises = Array.from(this.activeRequests.values());
    await Promise.allSettled(promises);
  }
}

// Create singleton instances for different request types
export const llmRequestQueue = new RequestQueueService({
  maxConcurrent: 1, // LLM requests are expensive, limit to 1 at a time
  requestsPerSecond: 5,
  timeout: 60000, // 60 seconds for LLM
});

export const toolRequestQueue = new RequestQueueService({
  maxConcurrent: 3, // Tools can run in parallel
  requestsPerSecond: 20,
  timeout: 30000, // 30 seconds for tools
});

export const storageRequestQueue = new RequestQueueService({
  maxConcurrent: 5, // Storage operations can be more parallel
  requestsPerSecond: 50,
  timeout: 10000, // 10 seconds for storage
});

// Export default instance for general use
export default new RequestQueueService();
