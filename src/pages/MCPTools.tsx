/**
 * MCP Tools Management Page
 * Displays user role-based access and allows enabling/disabling individual tools
 */

import React, { useState, useEffect, useMemo } from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  Combobox,
  Icon,
  Input,
  LoadingPlaceholder,
  Stack,
  useTheme2,
} from '@grafana/ui';
import { SelectableValue } from '@grafana/data';
import { PluginPage, config } from '@grafana/runtime';
import { css } from '@emotion/css';
import { backendMCPClient } from '../services/backendMCPClient';

interface Tool {
  name: string;
  description?: string;
  inputSchema?: any;
}

interface ToolSettings {
  [toolName: string]: boolean; // true = enabled, false = disabled
}

export function MCPToolsPage() {
  const theme = useTheme2();
  const [loading, setLoading] = useState(true);
  const [tools, setTools] = useState<Tool[]>([]);
  const [toolSettings, setToolSettings] = useState<ToolSettings>({});
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<SelectableValue>({ value: 'all', label: 'All Tools' });
  const [showAccessInfo, setShowAccessInfo] = useState(true);

  // Get user role from Grafana config
  const userRole = config.bootData.user.orgRole || 'Viewer';
  const userName = config.bootData.user.name || config.bootData.user.login || 'Unknown';

  // Load tools and settings
  useEffect(() => {
    loadToolsAndSettings();
  }, []);

  const loadToolsAndSettings = async () => {
    setLoading(true);
    try {
      // Fetch available tools from backend (already filtered by role)
      const fetchedTools = await backendMCPClient.listTools();
      setTools(fetchedTools);

      // Load tool settings from localStorage
      const savedSettings = localStorage.getItem('mcp-tool-settings');
      if (savedSettings) {
        setToolSettings(JSON.parse(savedSettings));
      } else {
        // Initialize all tools as enabled by default
        const defaultSettings: ToolSettings = {};
        fetchedTools.forEach((tool) => {
          defaultSettings[tool.name] = true;
        });
        setToolSettings(defaultSettings);
      }
    } catch (error) {
      console.error('[MCPToolsPage] Failed to load tools:', error);
    } finally {
      setLoading(false);
    }
  };

  // Save settings to localStorage
  const saveSettings = (newSettings: ToolSettings) => {
    setToolSettings(newSettings);
    localStorage.setItem('mcp-tool-settings', JSON.stringify(newSettings));
  };

  // Toggle tool enabled state
  const toggleTool = (toolName: string) => {
    const newSettings = {
      ...toolSettings,
      [toolName]: !toolSettings[toolName],
    };
    saveSettings(newSettings);
  };

  // Batch enable/disable
  const toggleAll = (enabled: boolean) => {
    const newSettings: ToolSettings = {};
    filteredTools.forEach((tool) => {
      newSettings[tool.name] = enabled;
    });
    saveSettings({ ...toolSettings, ...newSettings });
  };

  // Categorize tools
  const toolsByCategory = useMemo(() => {
    const categories: { [key: string]: Tool[] } = {
      grafana: [],
      other: [],
    };

    tools.forEach((tool) => {
      if (tool.name.startsWith('mcp-grafana_')) {
        categories.grafana.push(tool);
      } else {
        categories.other.push(tool);
      }
    });

    return categories;
  }, [tools]);

  // Filter tools
  const filteredTools = useMemo(() => {
    let filtered = tools;

    // Apply category filter
    if (categoryFilter.value === 'grafana') {
      filtered = toolsByCategory.grafana;
    } else if (categoryFilter.value === 'other') {
      filtered = toolsByCategory.other;
    }

    // Apply search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (tool) =>
          tool.name.toLowerCase().includes(query) ||
          (tool.description && tool.description.toLowerCase().includes(query))
      );
    }

    return filtered;
  }, [tools, toolsByCategory, categoryFilter, searchQuery]);

  // Calculate statistics
  const stats = useMemo(() => {
    const total = filteredTools.length;
    const enabled = filteredTools.filter((tool) => toolSettings[tool.name] !== false).length;
    const disabled = total - enabled;

    return { total, enabled, disabled };
  }, [filteredTools, toolSettings]);

  // Get role badge color
  const getRoleBadgeColor = (role: string): 'red' | 'orange' | 'blue' | 'green' | 'purple' => {
    switch (role) {
      case 'Admin':
        return 'red';
      case 'Editor':
        return 'orange';
      case 'Viewer':
        return 'blue';
      default:
        return 'blue';
    }
  };

  // Get role description
  const getRoleDescription = (role: string) => {
    switch (role) {
      case 'Admin':
        return 'Full access to all MCP tools including read and write operations';
      case 'Editor':
        return 'Full access to all MCP tools including read and write operations';
      case 'Viewer':
        return 'Read-only access to MCP tools. Write operations (create, update, delete) are restricted';
      default:
        return 'Unknown role permissions';
    }
  };

  if (loading) {
    return (
      <PluginPage>
        <div className="flex items-center justify-center h-full">
          <LoadingPlaceholder text="Loading MCP tools..." />
        </div>
      </PluginPage>
    );
  }

  return (
    <PluginPage>
      <div className="p-4">
        <Stack direction="column" gap={2}>
          {/* Header */}
          <div>
            <h2 className="text-2xl font-bold mb-2">MCP Tools Management</h2>
            <p className="text-secondary">
              Manage your Model Context Protocol tools. Enable or disable individual tools based on your needs.
            </p>
          </div>

          {/* Role Information */}
          {showAccessInfo && (
            <Alert title={`Access Level: ${userRole}`} severity="info" onRemove={() => setShowAccessInfo(false)}>
              <div className="space-y-2">
                <div>
                  <strong>User:</strong> {userName}
                </div>
                <div>
                  <strong>Role:</strong> <Badge text={userRole} color={getRoleBadgeColor(userRole)} />
                </div>
                <div>
                  <strong>Permissions:</strong> {getRoleDescription(userRole)}
                </div>
                <div className="text-xs text-secondary mt-2">
                  The tools shown below are filtered based on your role. You can further customize which tools are
                  enabled for use in the chat interface.
                </div>
              </div>
            </Alert>
          )}

          {/* Statistics */}
          <Card>
            <Card.Heading>Tool Statistics</Card.Heading>
            <Card.Description>
              <div className="grid grid-cols-3 gap-4 text-center">
                <div>
                  <div className="text-3xl font-bold">{stats.total}</div>
                  <div className="text-sm text-secondary">Total Available</div>
                </div>
                <div>
                  <div className="text-3xl font-bold" style={{ color: theme.colors.success.main }}>
                    {stats.enabled}
                  </div>
                  <div className="text-sm text-secondary">Enabled</div>
                </div>
                <div>
                  <div className="text-3xl font-bold" style={{ color: theme.colors.text.disabled }}>
                    {stats.disabled}
                  </div>
                  <div className="text-sm text-secondary">Disabled</div>
                </div>
              </div>
            </Card.Description>
          </Card>

          {/* Filters and Actions */}
          <Card>
            <Card.Heading>Filters and Actions</Card.Heading>
            <Card.Description>
              <Stack direction="column" gap={1}>
                <Stack direction="row" gap={1} justifyContent="space-between">
                  <Input
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.currentTarget.value)}
                    placeholder="Search tools..."
                    prefix={<Icon name="search" />}
                    width={40}
                  />
                  <Combobox
                    value={categoryFilter}
                    options={[
                      { value: 'all', label: 'All Tools', description: `${tools.length} tools` },
                      {
                        value: 'grafana',
                        label: 'Grafana Tools',
                        description: `${toolsByCategory.grafana.length} tools`,
                      },
                      {
                        value: 'other',
                        label: 'Other Tools',
                        description: `${toolsByCategory.other.length} tools`,
                      },
                    ]}
                    onChange={(option) => setCategoryFilter(option)}
                    width={30}
                  />
                </Stack>
                <Stack direction="row" gap={0.5}>
                  <Button size="sm" variant="secondary" onClick={() => toggleAll(true)} icon="check">
                    Enable All
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => toggleAll(false)} icon="times">
                    Disable All
                  </Button>
                  <Button size="sm" variant="secondary" onClick={loadToolsAndSettings} icon="sync">
                    Refresh
                  </Button>
                </Stack>
              </Stack>
            </Card.Description>
          </Card>

          {/* Tools List */}
          <Card>
            <Card.Heading>Available Tools ({filteredTools.length})</Card.Heading>
            <Card.Description>
              {filteredTools.length === 0 ? (
                <Alert title="No tools found" severity="info">
                  No tools match your search criteria
                </Alert>
              ) : (
                <div className="space-y-2">
                  {filteredTools.map((tool) => {
                    const isEnabled = toolSettings[tool.name] !== false;
                    const isGrafanaTool = tool.name.startsWith('mcp-grafana_');
                    const isWriteTool = /create|update|delete|patch|add/i.test(tool.name);

                    return (
                      <div
                        key={tool.name}
                        className={css`
                          padding: 12px;
                          border: 1px solid ${theme.colors.border.weak};
                          border-radius: 4px;
                          background: ${isEnabled
                            ? theme.colors.background.primary
                            : theme.colors.background.secondary};
                          opacity: ${isEnabled ? 1 : 0.6};
                          transition: all 0.2s;

                          &:hover {
                            border-color: ${theme.colors.border.strong};
                          }
                        `}
                      >
                        <div className="flex items-start gap-3">
                          <div className="flex items-center" style={{ minWidth: '24px' }}>
                            <Checkbox
                              value={isEnabled}
                              onChange={() => toggleTool(tool.name)}
                              aria-label={`Toggle ${tool.name}`}
                            />
                          </div>
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="font-medium">{tool.name}</span>
                              {isGrafanaTool && <Badge text="Grafana" color="blue" icon="grafana" />}
                              {isWriteTool && userRole !== 'Viewer' && (
                                <Badge text="Write" color="orange" icon="edit" />
                              )}
                            </div>
                            <p className="text-sm text-secondary">{tool.description}</p>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </Card.Description>
          </Card>
        </Stack>
      </div>
    </PluginPage>
  );
}

export default MCPToolsPage;
