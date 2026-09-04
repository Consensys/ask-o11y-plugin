package plugin

import (
	"fmt"
	"time"
)

func orgGroupID(orgID int64) string {
	return fmt.Sprintf("org_%d", orgID)
}

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
	AgentMaxIterations        = 50
	AlertInvestigationMaxIter = 60
	RunMaxAge                 = 1 * time.Hour
	RunCleanupInterval        = 5 * time.Minute
	RunMaxEventsPerRun        = 500
)

const (
	SessionMaxPerUserOrg = 50
)

const (
	GraphitiDiscoveryMaxIter = 50
	// GraphitiRetentionInterval paces Scout.RunRetention (community build +
	// episode prune), independent of GraphitiScanInterval so retention still
	// runs when discovery auto-scan is off.
	GraphitiRetentionInterval = 1 * time.Hour
)

// Retention defaults, used when the corresponding PluginSettings field is
// unset (0). Both are user-configurable per org since auto-saving every
// session to the knowledge graph (see autoSaveSessionToGraphiti) makes both
// stores grow much faster than when ingestion was an opt-in button click.
const (
	DefaultSessionTTLDays         = 90
	DefaultGraphitiEpisodeTTLDays = 30
)

// resolveTTLDays converts a user-configured retention window (in days, 0
// meaning "use the default") into a duration.
func resolveTTLDays(days, defaultDays int) time.Duration {
	if days <= 0 {
		days = defaultDays
	}
	return time.Duration(days) * 24 * time.Hour
}
