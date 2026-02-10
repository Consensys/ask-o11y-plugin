package plugin

import "time"

const (
	ShareRateLimitPerHour = 50
	ShareRateLimitWindow  = 1 * time.Hour
	DefaultShareMaxTTL    = 365 * 24 * time.Hour
	ShareIDBytes          = 32
	ShareCleanupInterval  = 1 * time.Hour
)

const (
	RedisOpTimeout         = 3 * time.Second
	RedisBulkOpTimeout     = 10 * time.Second
	RedisConnectionTimeout = 5 * time.Second
)

const (
	MCPHealthMonitoringInterval = 30 * time.Second
	HealthCheckTimeout          = 2 * time.Second
)

const (
	AgentMaxIterations = 25
)
