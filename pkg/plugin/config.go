package plugin

import "time"

// Configuration constants for the plugin

// Share-related constants
const (
	// ShareRateLimitPerHour is the maximum number of shares a user can create per hour
	ShareRateLimitPerHour = 50

	// ShareRateLimitWindow is the time window for rate limiting
	ShareRateLimitWindow = 1 * time.Hour

	// DefaultShareMaxTTL is the default maximum time-to-live for shares without explicit expiration
	DefaultShareMaxTTL = 365 * 24 * time.Hour // 1 year

	// ShareIDBytes is the number of random bytes used to generate share IDs
	ShareIDBytes = 32

	// ShareCleanupInterval is how often expired shares are cleaned up (for in-memory store)
	ShareCleanupInterval = 1 * time.Hour
)

// Redis operation timeout constants
const (
	// RedisOpTimeout is the timeout for single Redis operations
	RedisOpTimeout = 3 * time.Second

	// RedisBulkOpTimeout is the timeout for bulk Redis operations (MGET, SMEMBERS, etc.)
	RedisBulkOpTimeout = 10 * time.Second

	// RedisConnectionTimeout is the timeout for Redis connection attempts
	RedisConnectionTimeout = 5 * time.Second
)

// Health check constants
const (
	// MCPHealthMonitoringInterval is how often to check MCP server health
	MCPHealthMonitoringInterval = 30 * time.Second

	// HealthCheckTimeout is the timeout for health check operations
	HealthCheckTimeout = 2 * time.Second
)
