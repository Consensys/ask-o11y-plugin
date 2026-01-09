package mcp

import (
	"sync"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
)

// ServerStatus represents the status of an MCP server
type ServerStatus string

const (
	StatusHealthy      ServerStatus = "healthy"
	StatusDegraded     ServerStatus = "degraded"
	StatusUnhealthy    ServerStatus = "unhealthy"
	StatusDisconnected ServerStatus = "disconnected"
	StatusConnecting   ServerStatus = "connecting"
)

// ServerHealth represents the health status of an MCP server
type ServerHealth struct {
	ServerID            string       `json:"serverId"`
	Name                string       `json:"name"`
	URL                 string       `json:"url"`
	Type                string       `json:"type"`
	Status              ServerStatus `json:"status"`
	LastCheck           time.Time    `json:"lastCheck"`
	ResponseTime        int64        `json:"responseTime"` // milliseconds
	SuccessRate         float64      `json:"successRate"`
	ErrorCount          int          `json:"errorCount"`
	ConsecutiveFailures int          `json:"consecutiveFailures"`
	LastError           string       `json:"lastError,omitempty"`
	Tools               []Tool       `json:"tools"`
	ToolCount           int          `json:"toolCount"`
}

// HealthMonitor monitors the health of MCP servers
type HealthMonitor struct {
	proxy  *Proxy
	logger log.Logger
	mu     sync.RWMutex
	health map[string]*ServerHealth
	ticker *time.Ticker
	done   chan bool
}

// NewHealthMonitor creates a new health monitor
func NewHealthMonitor(proxy *Proxy, logger log.Logger) *HealthMonitor {
	return &HealthMonitor{
		proxy:  proxy,
		logger: logger,
		health: make(map[string]*ServerHealth),
		done:   make(chan bool),
	}
}

// Start begins health monitoring
func (hm *HealthMonitor) Start(interval time.Duration) {
	hm.ticker = time.NewTicker(interval)

	// Perform initial health check
	hm.checkAllServers()

	go func() {
		for {
			select {
			case <-hm.ticker.C:
				hm.checkAllServers()
			case <-hm.done:
				return
			}
		}
	}()

	hm.logger.Info("Health monitor started", "interval", interval)
}

// Stop stops health monitoring
func (hm *HealthMonitor) Stop() {
	if hm.ticker != nil {
		hm.ticker.Stop()
	}
	hm.done <- true
	hm.logger.Info("Health monitor stopped")
}

// checkAllServers performs health checks on all servers
func (hm *HealthMonitor) checkAllServers() {
	hm.proxy.mu.RLock()
	clients := make(map[string]*Client)
	for id, client := range hm.proxy.clients {
		clients[id] = client
	}
	hm.proxy.mu.RUnlock()

	hm.logger.Debug("Performing health check", "servers", len(clients))

	for id, client := range clients {
		hm.checkServer(id, client)
	}
}

// checkServer performs a health check on a single server
func (hm *HealthMonitor) checkServer(serverID string, client *Client) {
	startTime := time.Now()

	// List tools to check server health
	tools, err := client.ListTools()
	responseTime := time.Since(startTime).Milliseconds()

	hm.mu.Lock()
	defer hm.mu.Unlock()

	health, exists := hm.health[serverID]
	if !exists {
		health = &ServerHealth{
			ServerID:  serverID,
			Name:      client.config.Name,
			URL:       client.config.URL,
			Type:      client.config.Type,
			Status:    StatusConnecting,
			Tools:     []Tool{},
			ToolCount: 0,
		}
		hm.health[serverID] = health
	}

	health.LastCheck = time.Now()
	health.ResponseTime = responseTime

	if err != nil {
		// Server failed
		health.ErrorCount++
		health.ConsecutiveFailures++
		health.LastError = err.Error()

		// Determine status based on consecutive failures
		if health.ConsecutiveFailures >= 5 {
			health.Status = StatusDisconnected
		} else if health.ConsecutiveFailures >= 3 {
			health.Status = StatusUnhealthy
		} else {
			health.Status = StatusDegraded
		}

		hm.logger.Warn("Health check failed",
			"server", health.Name,
			"error", err,
			"consecutiveFailures", health.ConsecutiveFailures)

	} else {
		// Server succeeded
		health.ConsecutiveFailures = 0
		health.LastError = ""
		health.Tools = tools
		health.ToolCount = len(tools)

		// Determine status based on response time
		if responseTime > 2000 {
			health.Status = StatusDegraded
		} else {
			health.Status = StatusHealthy
		}

		// Calculate success rate (simple moving average over last checks)
		totalChecks := health.ErrorCount + 1 // +1 for current success
		successfulChecks := totalChecks - health.ErrorCount
		health.SuccessRate = float64(successfulChecks) / float64(totalChecks) * 100

		hm.logger.Debug("Health check succeeded",
			"server", health.Name,
			"responseTime", responseTime,
			"toolCount", len(tools))
	}
}

// GetAllHealth returns the health status of all servers
func (hm *HealthMonitor) GetAllHealth() []ServerHealth {
	hm.mu.RLock()
	defer hm.mu.RUnlock()

	result := make([]ServerHealth, 0, len(hm.health))
	for _, health := range hm.health {
		result = append(result, *health)
	}

	return result
}

// GetSystemHealth returns overall system health statistics
func (hm *HealthMonitor) GetSystemHealth() map[string]interface{} {
	hm.mu.RLock()
	defer hm.mu.RUnlock()

	stats := map[string]int{
		"healthy":      0,
		"degraded":     0,
		"unhealthy":    0,
		"disconnected": 0,
		"total":        len(hm.health),
	}

	overallStatus := "healthy"

	for _, health := range hm.health {
		switch health.Status {
		case StatusHealthy:
			stats["healthy"]++
		case StatusDegraded:
			stats["degraded"]++
		case StatusUnhealthy:
			stats["unhealthy"]++
		case StatusDisconnected:
			stats["disconnected"]++
		}
	}

	// Determine overall status
	if stats["unhealthy"] > 0 || stats["disconnected"] > 0 {
		overallStatus = "unhealthy"
	} else if stats["degraded"] > 0 {
		overallStatus = "degraded"
	}

	return map[string]interface{}{
		"overallStatus": overallStatus,
		"healthy":       stats["healthy"],
		"degraded":      stats["degraded"],
		"unhealthy":     stats["unhealthy"],
		"disconnected":  stats["disconnected"],
		"total":         stats["total"],
	}
}
