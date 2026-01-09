/**
 * MCP Status Component
 * Displays real-time health status of MCP servers from the backend
 */

import React, { useState, useEffect } from 'react';
import { useTheme2, Badge, Tooltip, Icon, Button } from '@grafana/ui';
import { mcpServerStatusService, MCPServerStatus, SystemHealth } from '../../services/mcpServerStatus';
import { InlineLoading } from '../LoadingOverlay';

export interface MCPStatusProps {
  compact?: boolean;
  showDetails?: boolean;
  className?: string;
  onClose?: () => void;
}

export function MCPStatus({ compact = false, showDetails = true, className = '', onClose }: MCPStatusProps) {
  const theme = useTheme2();
  const [servers, setServers] = useState<MCPServerStatus[]>([]);
  const [systemHealth, setSystemHealth] = useState<SystemHealth>({
    overallStatus: 'healthy',
    healthy: 0,
    degraded: 0,
    unhealthy: 0,
    disconnected: 0,
    total: 0,
  });
  const [isExpanded, setIsExpanded] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  // Fetch server statuses from backend
  const fetchStatuses = async () => {
    const response = await mcpServerStatusService.fetchServerStatuses();
    setServers(response.servers);
    setSystemHealth(response.systemHealth);
    setIsLoading(false);
  };

  useEffect(() => {
    // Initial fetch
    fetchStatuses();

    // Poll every 30 seconds
    const interval = setInterval(fetchStatuses, 30000);

    return () => clearInterval(interval);
  }, []);

  const getStatusIcon = (status: MCPServerStatus['status']) => {
    switch (status) {
      case 'healthy':
        return 'check-circle';
      case 'degraded':
        return 'exclamation-triangle';
      case 'unhealthy':
      case 'disconnected':
        return 'times-circle';
      case 'connecting':
        return 'spinner';
      default:
        return 'question-circle';
    }
  };

  const getOverallStatusBadge = () => {
    const badgeColor =
      systemHealth.overallStatus === 'healthy' ? 'green' : systemHealth.overallStatus === 'degraded' ? 'orange' : 'red';

    return (
      <Badge
        text={systemHealth.overallStatus.toUpperCase()}
        color={badgeColor}
        icon={getStatusIcon(
          systemHealth.overallStatus === 'healthy'
            ? 'healthy'
            : systemHealth.overallStatus === 'degraded'
            ? 'degraded'
            : 'unhealthy'
        )}
      />
    );
  };

  if (isLoading) {
    return (
      <div className={`inline-flex items-center gap-2 ${className}`}>
        <InlineLoading size="sm" />
        <span className="text-xs text-secondary">Loading MCP status...</span>
      </div>
    );
  }

  if (compact) {
    return (
      <div className={`inline-flex items-center gap-2 ${className}`}>
        <Tooltip
          content={
            <div className="p-2">
              <div className="font-medium mb-2">MCP Server Status</div>
              <div className="text-xs space-y-1">
                <div>Healthy: {systemHealth.healthy}</div>
                <div>Degraded: {systemHealth.degraded}</div>
                <div>Unhealthy: {systemHealth.unhealthy}</div>
                <div>Disconnected: {systemHealth.disconnected}</div>
              </div>
            </div>
          }
        >
          <div className="flex items-center gap-2 cursor-help">
            <Icon
              name={getStatusIcon(
                systemHealth.overallStatus === 'healthy'
                  ? 'healthy'
                  : systemHealth.overallStatus === 'degraded'
                  ? 'degraded'
                  : 'unhealthy'
              )}
              size="sm"
              style={{
                color: getStatusColor(
                  systemHealth.overallStatus === 'healthy'
                    ? 'healthy'
                    : systemHealth.overallStatus === 'degraded'
                    ? 'degraded'
                    : 'unhealthy',
                  theme
                ),
              }}
            />
            <span className="text-xs text-secondary">
              {systemHealth.healthy}/{systemHealth.total} MCP
            </span>
          </div>
        </Tooltip>
      </div>
    );
  }

  return (
    <div
      className={`rounded-lg p-4 ${className}`}
      style={{
        backgroundColor: theme.colors.background.secondary,
        border: `1px solid ${theme.colors.border.weak}`,
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-medium">MCP Server Status</h3>
          {getOverallStatusBadge()}
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="secondary" icon="sync" onClick={fetchStatuses} aria-label="Refresh statuses">
            Refresh
          </Button>
          <Button
            size="sm"
            variant="secondary"
            icon={isExpanded ? 'angle-up' : 'angle-down'}
            onClick={() => setIsExpanded(!isExpanded)}
          >
            {isExpanded ? 'Hide' : 'Show'} Details
          </Button>
        </div>
      </div>

      {/* Summary Stats */}
      {showDetails && (
        <div className="grid grid-cols-4 gap-4 mb-4">
          <StatusCard
            label="Healthy"
            value={systemHealth.healthy}
            color={theme.colors.success.main}
            icon="check-circle"
          />
          <StatusCard
            label="Degraded"
            value={systemHealth.degraded}
            color={theme.colors.warning.main}
            icon="exclamation-triangle"
          />
          <StatusCard
            label="Unhealthy"
            value={systemHealth.unhealthy}
            color={theme.colors.error.main}
            icon="times-circle"
          />
          <StatusCard
            label="Disconnected"
            value={systemHealth.disconnected}
            color={theme.colors.text.disabled}
            icon="unlink"
          />
        </div>
      )}

      {/* Server List */}
      {isExpanded && (
        <div className="space-y-2 mt-4">
          {servers.length === 0 ? (
            <div className="text-center py-4 text-secondary">No MCP servers configured</div>
          ) : (
            servers.map((server) => <ServerStatusRow key={server.serverId} server={server} onRefresh={fetchStatuses} />)
          )}
        </div>
      )}
    </div>
  );
}

function StatusCard({ label, value, color, icon }: { label: string; value: number; color: string; icon: string }) {
  const theme = useTheme2();

  return (
    <div
      className="p-3 rounded"
      style={{
        backgroundColor: theme.colors.background.primary,
        border: `1px solid ${theme.colors.border.weak}`,
      }}
    >
      <div className="flex items-center gap-2 mb-1">
        <Icon name={icon as any} size="sm" style={{ color }} />
        <span className="text-xs text-secondary">{label}</span>
      </div>
      <div className="text-2xl font-bold" style={{ color }}>
        {value}
      </div>
    </div>
  );
}

function ServerStatusRow({ server, onRefresh }: { server: MCPServerStatus; onRefresh: () => void }) {
  const theme = useTheme2();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showTools, setShowTools] = useState(false);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await onRefresh();
    setTimeout(() => setIsRefreshing(false), 500);
  };

  return (
    <div
      className="rounded"
      style={{
        backgroundColor: theme.colors.background.primary,
        border: `1px solid ${theme.colors.border.weak}`,
      }}
    >
      <div className="p-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          {/* Status Icon */}
          {server.status === 'connecting' ? (
            <InlineLoading size="sm" />
          ) : (
            <Icon
              name={getStatusIcon(server.status) as any}
              size="lg"
              style={{ color: getStatusColor(server.status, theme) }}
            />
          )}

          {/* Server Info */}
          <div>
            <div className="font-medium">{server.name}</div>
            <div className="text-xs text-secondary">
              {server.type} • {server.url}
            </div>
            <div className="text-xs text-secondary">
              {server.status === 'healthy' && `${server.responseTime}ms response time`}
              {server.status === 'degraded' && `Slow response (${server.responseTime}ms)`}
              {server.status === 'unhealthy' && `${server.consecutiveFailures} failures`}
              {server.status === 'disconnected' && 'Connection lost'}
              {server.status === 'connecting' && 'Connecting...'}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Tool Count */}
          <Tooltip content={`${server.toolCount} tools available. Click to view.`}>
            <Button size="sm" variant="secondary" onClick={() => setShowTools(!showTools)}>
              {server.toolCount} {server.toolCount === 1 ? 'tool' : 'tools'}
            </Button>
          </Tooltip>

          {/* Success Rate */}
          {server.successRate !== undefined && (
            <Tooltip content={`Success rate: ${server.successRate.toFixed(1)}%`}>
              <Badge
                text={`${server.successRate.toFixed(0)}%`}
                color={server.successRate >= 95 ? 'green' : server.successRate >= 80 ? 'orange' : 'red'}
              />
            </Tooltip>
          )}

          {/* Last Check Time */}
          <Tooltip content={`Last checked: ${new Date(server.lastCheck).toLocaleTimeString()}`}>
            <span className="text-xs text-secondary">{getRelativeTime(new Date(server.lastCheck))}</span>
          </Tooltip>

          {/* Refresh Button */}
          <Button
            size="sm"
            variant="secondary"
            icon={isRefreshing ? 'spinner' : 'sync'}
            onClick={handleRefresh}
            disabled={isRefreshing}
            aria-label="Refresh status"
          />
        </div>
      </div>

      {/* Tools List */}
      {showTools && server.tools.length > 0 && (
        <div className="p-3 border-t" style={{ borderColor: theme.colors.border.weak }}>
          <div className="text-sm font-medium mb-2">Available Tools:</div>
          <div className="space-y-2">
            {server.tools.map((tool, idx) => (
              <div
                key={idx}
                className="text-xs p-2 rounded"
                style={{ backgroundColor: theme.colors.background.secondary }}
              >
                <div className="font-medium">{tool.name}</div>
                <div className="text-secondary">{tool.description}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function getRelativeTime(date: Date): string {
  const seconds = Math.floor((new Date().getTime() - date.getTime()) / 1000);

  if (seconds < 60) {
    return 'just now';
  }
  if (seconds < 3600) {
    return `${Math.floor(seconds / 60)}m ago`;
  }
  if (seconds < 86400) {
    return `${Math.floor(seconds / 3600)}h ago`;
  }
  return `${Math.floor(seconds / 86400)}d ago`;
}

function getStatusIcon(status: MCPServerStatus['status']): string {
  switch (status) {
    case 'healthy':
      return 'check-circle';
    case 'degraded':
      return 'exclamation-triangle';
    case 'unhealthy':
    case 'disconnected':
      return 'times-circle';
    case 'connecting':
      return 'spinner';
    default:
      return 'question-circle';
  }
}

function getStatusColor(status: MCPServerStatus['status'], theme: any): string {
  switch (status) {
    case 'healthy':
      return theme.colors.success.main;
    case 'degraded':
      return theme.colors.warning.main;
    case 'unhealthy':
    case 'disconnected':
      return theme.colors.error.main;
    case 'connecting':
      return theme.colors.info.main;
    default:
      return theme.colors.text.secondary;
  }
}
