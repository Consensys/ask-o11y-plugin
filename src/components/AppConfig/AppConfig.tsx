import React, { ChangeEvent, useState, useEffect } from 'react';
import { lastValueFrom } from 'rxjs';
import { AppPluginMeta, PluginConfigPageProps, PluginMeta } from '@grafana/data';
import { getBackendSrv } from '@grafana/runtime';
import { Button, Field, FieldSet, Input, Icon, Switch, Alert, RadioButtonGroup, TextArea, Modal } from '@grafana/ui';
import { mcp } from '@grafana/llm';
import { testIds } from '../testIds';
import { ValidationService } from '../../services/validation';
import { SYSTEM_PROMPT } from '../Chat/constants';
import { getSecureHeaderKey, type AppPluginSettings, type MCPServerConfig, type SystemPromptMode } from '../../types/plugin';

const PROMPT_MODE_OPTIONS = [
  { label: 'Use default prompt', value: 'default' as SystemPromptMode },
  { label: 'Replace with custom prompt', value: 'replace' as SystemPromptMode },
  { label: 'Append to default prompt', value: 'append' as SystemPromptMode },
];

function normalizeHeaderKey(key: string): string {
  const trimmed = key.trim();
  if (trimmed.includes('__collision_')) {
    return trimmed.split('__collision_')[0].trim();
  }
  return trimmed;
}

function getCollisionId(key: string): string | null {
  if (key.includes('__collision_')) {
    return key.split('__collision_')[1];
  }
  return null;
}

type State = {
  // Maximum total tokens for LLM requests
  maxTotalTokens: number;
  // MCP server configurations
  mcpServers: MCPServerConfig[];
  // Built-in MCP configuration
  useBuiltInMCP: boolean;
  builtInMCPAvailable: boolean | null; // null = checking, true/false = result
  // System prompt configuration
  systemPromptMode: SystemPromptMode;
  customSystemPrompt: string;
  // Track which servers have advanced options expanded
  expandedAdvanced: Set<string>;
  // Display settings
  kioskModeEnabled: boolean;
  chatPanelPosition: 'left' | 'right';
  // Track modified header values (secureJsonData key -> value)
  // Only headers that have been modified by the user are stored here
  modifiedHeaderValues: Record<string, string>;
  // Track headers that should be cleared from secureJsonData
  clearedHeaders: Set<string>;
};

type ValidationErrors = {
  maxTotalTokens?: string;
  mcpServers: { [id: string]: { name?: string; url?: string } };
  customSystemPrompt?: string;
};

export interface AppConfigProps extends PluginConfigPageProps<AppPluginMeta<AppPluginSettings>> {}

/**
 * Normalizes MCP server configs to handle both old `headers` format and new `headerKeys` format.
 * Converts headerKeys back to a headers Record for UI display (values are empty placeholders).
 */
function normalizeMCPServers(servers: MCPServerConfig[] | undefined): MCPServerConfig[] {
  if (!servers) {
    return [];
  }

  return servers.map((server) => {
    // If server has headerKeys but no headers, create headers from headerKeys
    if (server.headerKeys && server.headerKeys.length > 0 && !server.headers) {
      const headers: Record<string, string> = {};
      for (const key of server.headerKeys) {
        headers[key] = ''; // Empty value, actual values are in secureJsonData
      }
      return { ...server, headers };
    }

    // If server has both (migration scenario), prefer headerKeys
    if (server.headerKeys && server.headerKeys.length > 0 && server.headers) {
      const headers: Record<string, string> = {};
      for (const key of server.headerKeys) {
        // Try to get value from existing headers, otherwise empty
        headers[key] = server.headers[key] || '';
      }
      return { ...server, headers };
    }

    return server;
  });
}

const AppConfig = ({ plugin }: AppConfigProps) => {
  const { enabled, pinned, jsonData, secureJsonFields } = plugin.meta;
  const [state, setState] = useState<State>({
    maxTotalTokens: jsonData?.maxTotalTokens || 50000,
    mcpServers: normalizeMCPServers(jsonData?.mcpServers),
    useBuiltInMCP: jsonData?.useBuiltInMCP ?? false,
    builtInMCPAvailable: null,
    systemPromptMode: jsonData?.systemPromptMode || 'default',
    customSystemPrompt: jsonData?.customSystemPrompt || '',
    expandedAdvanced: new Set<string>(),
    kioskModeEnabled: jsonData?.kioskModeEnabled ?? true,
    chatPanelPosition: jsonData?.chatPanelPosition || 'right',
    modifiedHeaderValues: {},
    clearedHeaders: new Set<string>(),
  });

  // Helper to check if a header value is configured in secureJsonData
  const isHeaderConfigured = (serverId: string, headerKey: string): boolean => {
    const secureKey = getSecureHeaderKey(serverId, headerKey);
    // Check if it's in secureJsonFields and not marked for clearing
    return Boolean(secureJsonFields?.[secureKey]) && !state.clearedHeaders.has(secureKey);
  };

  // Helper to check if a header value has been modified (user entered a new value)
  const isHeaderModified = (serverId: string, headerKey: string): boolean => {
    const secureKey = getSecureHeaderKey(serverId, headerKey);
    return secureKey in state.modifiedHeaderValues;
  };

  // Get the display value for a header (empty if configured but not modified)
  const getHeaderDisplayValue = (serverId: string, headerKey: string, originalValue: string): string => {
    const secureKey = getSecureHeaderKey(serverId, headerKey);
    // If modified, show the modified value
    if (secureKey in state.modifiedHeaderValues) {
      return state.modifiedHeaderValues[secureKey];
    }
    // If configured in secureJsonData, show empty (placeholder will show "Configured")
    if (isHeaderConfigured(serverId, headerKey)) {
      return '';
    }
    // Otherwise show the original value (for backwards compatibility with old headers)
    return originalValue;
  };
  const [validationErrors, setValidationErrors] = useState<ValidationErrors>({
    mcpServers: {},
  });
  const [showDefaultPromptModal, setShowDefaultPromptModal] = useState(false);
  const [copySuccess, setCopySuccess] = useState(false);

  // Check built-in MCP availability on mount
  useEffect(() => {
    const checkAvailability = async () => {
      try {
        const available = await mcp.enabled();
        setState((prev) => ({ ...prev, builtInMCPAvailable: available }));
      } catch (error) {
        console.error('Error checking built-in MCP availability:', error);
        setState((prev) => ({ ...prev, builtInMCPAvailable: false }));
      }
    };

    checkAvailability();
  }, []);

  const isLLMSettingsDisabled = Boolean(!state.maxTotalTokens || state.maxTotalTokens < 1000);

  const onChange = (event: ChangeEvent<HTMLInputElement>) => {
    const { name, value, type } = event.target;
    const parsedValue = type === 'number' ? parseInt(value, 10) || 0 : value.trim();

    setState({
      ...state,
      [name]: parsedValue,
    });

    // Validate token limit
    if (name === 'maxTotalTokens') {
      try {
        ValidationService.validateConfigValue('tokenLimit', parsedValue);
        setValidationErrors((prev) => ({ ...prev, maxTotalTokens: undefined }));
      } catch (error) {
        setValidationErrors((prev) => ({
          ...prev,
          maxTotalTokens: error instanceof Error ? error.message : 'Invalid value',
        }));
      }
    }
  };

  const addMCPServer = () => {
    const newServer: MCPServerConfig = {
      id: `mcp-${Date.now()}`,
      name: 'New MCP Server',
      url: '',
      enabled: true,
      type: 'openapi',
    };
    setState({
      ...state,
      mcpServers: [...state.mcpServers, newServer],
    });
  };

  const updateMCPServer = (id: string, updates: Partial<MCPServerConfig>) => {
    // Update state
    setState({
      ...state,
      mcpServers: state.mcpServers.map((server) => (server.id === id ? { ...server, ...updates } : server)),
    });

    // Validate the updates
    const newErrors = { ...validationErrors.mcpServers };

    if (updates.url !== undefined) {
      if (updates.url.trim()) {
        try {
          ValidationService.validateMCPServerURL(updates.url);
          // Clear URL error for this server
          if (newErrors[id]) {
            delete newErrors[id].url;
            if (Object.keys(newErrors[id]).length === 0) {
              delete newErrors[id];
            }
          }
        } catch (error) {
          // Set URL error for this server
          if (!newErrors[id]) {
            newErrors[id] = {};
          }
          newErrors[id].url = error instanceof Error ? error.message : 'Invalid URL';
        }
      }
    }

    if (updates.name !== undefined) {
      if (!updates.name.trim()) {
        // Set name error for this server
        if (!newErrors[id]) {
          newErrors[id] = {};
        }
        newErrors[id].name = 'Server name is required';
      } else {
        // Clear name error for this server
        if (newErrors[id]) {
          delete newErrors[id].name;
          if (Object.keys(newErrors[id]).length === 0) {
            delete newErrors[id];
          }
        }
      }
    }

    setValidationErrors((prev) => ({ ...prev, mcpServers: newErrors }));
  };

  const removeMCPServer = (id: string) => {
    setState({
      ...state,
      mcpServers: state.mcpServers.filter((server) => server.id !== id),
    });
  };

  const toggleAdvancedOptions = (id: string) => {
    setState((prev) => {
      const newExpanded = new Set(prev.expandedAdvanced);
      if (newExpanded.has(id)) {
        newExpanded.delete(id);
      } else {
        newExpanded.add(id);
      }
      return { ...prev, expandedAdvanced: newExpanded };
    });
  };

  // Counter for generating unique header IDs (survives rapid clicks within same millisecond)
  const headerIdCounterRef = React.useRef(0);

  const addHeader = (serverId: string) => {
    const server = state.mcpServers.find((s) => s.id === serverId);
    if (!server) {
      return;
    }

    const currentHeaders = server.headers || {};
    const headerCount = Object.keys(currentHeaders).length;

    // Max 10 headers
    if (headerCount >= 10) {
      return;
    }

    // Use a combination of timestamp and counter to ensure uniqueness even with rapid clicks
    headerIdCounterRef.current += 1;
    const tempKey = `__new_header_${Date.now()}_${headerIdCounterRef.current}`;

    updateMCPServer(serverId, {
      headers: { ...currentHeaders, [tempKey]: '' },
    });
  };

  const updateHeader = (serverId: string, oldKey: string, newKey: string, value: string) => {
    const server = state.mcpServers.find((s) => s.id === serverId);
    if (!server) {
      return;
    }

    const currentHeaders = server.headers || {};
    const keyOrder = Object.keys(currentHeaders);

    const finalKey = computeFinalHeaderKey(oldKey, newKey, keyOrder);

    // Rebuild headers preserving order - replace oldKey with finalKey at the same position
    const newHeaders: Record<string, string> = {};
    for (const k of keyOrder) {
      if (k === oldKey) {
        newHeaders[finalKey] = value;
      } else {
        newHeaders[k] = currentHeaders[k];
      }
    }

    // Track the header value modification for secureJsonData
    const normalizedFinalKey = normalizeHeaderKey(finalKey);
    if (normalizedFinalKey && !normalizedFinalKey.startsWith('__new_header_')) {
      const secureKey = getSecureHeaderKey(serverId, normalizedFinalKey);
      const oldSecureKey = oldKey !== finalKey ? getSecureHeaderKey(serverId, normalizeHeaderKey(oldKey)) : null;

      setState((prev) => {
        const newModifiedValues = { ...prev.modifiedHeaderValues };
        const newClearedHeaders = new Set(prev.clearedHeaders);

        // If key changed, remove old key from modified values and mark for clearing
        if (oldSecureKey && oldSecureKey !== secureKey) {
          delete newModifiedValues[oldSecureKey];
          // Mark old key for clearing if it was configured
          if (secureJsonFields?.[oldSecureKey]) {
            newClearedHeaders.add(oldSecureKey);
          }
        }

        // Track the new value
        if (value !== '') {
          newModifiedValues[secureKey] = value;
          // If we're setting a new value, remove from cleared set
          newClearedHeaders.delete(secureKey);
        }

        return {
          ...prev,
          mcpServers: prev.mcpServers.map((s) => (s.id === serverId ? { ...s, headers: newHeaders } : s)),
          modifiedHeaderValues: newModifiedValues,
          clearedHeaders: newClearedHeaders,
        };
      });
      return;
    }

    updateMCPServer(serverId, { headers: newHeaders });
  };

  const computeFinalHeaderKey = (oldKey: string, newKey: string, existingKeys: string[]): string => {
    if (oldKey === newKey) {
      return newKey;
    }

    const normalizedNewKey = normalizeHeaderKey(newKey);
    const otherKeys = existingKeys.filter((k) => k !== oldKey);
    const conflictingKey = otherKeys.find((k) => normalizeHeaderKey(k) === normalizedNewKey);

    if (!normalizedNewKey || !conflictingKey) {
      return newKey;
    }

    const oldCollisionId = getCollisionId(oldKey);
    const conflictingCollisionId = getCollisionId(conflictingKey);

    let uniquePart: string;
    if (oldCollisionId) {
      uniquePart = oldCollisionId;
    } else if (conflictingCollisionId) {
      uniquePart = `pair_${conflictingCollisionId}`;
    } else if (oldKey.startsWith('__new_header_')) {
      uniquePart = oldKey.replace('__new_header_', '');
    } else {
      uniquePart = `id_${oldKey.replace(/[^a-zA-Z0-9]/g, '_')}_${Date.now()}`;
    }

    return `${newKey}__collision_${uniquePart}`;
  };

  const removeHeader = (serverId: string, key: string) => {
    const server = state.mcpServers.find((s) => s.id === serverId);
    if (!server) {
      return;
    }

    const currentHeaders = { ...(server.headers || {}) };
    delete currentHeaders[key];

    // Mark the header for clearing from secureJsonData
    const normalizedKey = normalizeHeaderKey(key);
    if (normalizedKey && !normalizedKey.startsWith('__new_header_')) {
      const secureKey = getSecureHeaderKey(serverId, normalizedKey);

      setState((prev) => {
        const newModifiedValues = { ...prev.modifiedHeaderValues };
        const newClearedHeaders = new Set(prev.clearedHeaders);

        // Remove from modified values
        delete newModifiedValues[secureKey];

        // Mark for clearing if it was configured in secureJsonData
        if (secureJsonFields?.[secureKey]) {
          newClearedHeaders.add(secureKey);
        }

        return {
          ...prev,
          mcpServers: prev.mcpServers.map((s) => (s.id === serverId ? { ...s, headers: currentHeaders } : s)),
          modifiedHeaderValues: newModifiedValues,
          clearedHeaders: newClearedHeaders,
        };
      });
      return;
    }

    updateMCPServer(serverId, { headers: currentHeaders });
  };

  const onSystemPromptModeChange = (mode: SystemPromptMode) => {
    setState({
      ...state,
      systemPromptMode: mode,
    });

    // Clear validation error when switching back to default
    if (mode === 'default') {
      setValidationErrors((prev) => ({ ...prev, customSystemPrompt: undefined }));
    } else {
      // Validate existing custom prompt when switching to replace/append
      validateCustomPrompt(state.customSystemPrompt, mode);
    }
  };

  const onCustomSystemPromptChange = (value: string) => {
    setState({
      ...state,
      customSystemPrompt: value,
    });
    validateCustomPrompt(value, state.systemPromptMode);
  };

  const validateCustomPrompt = (value: string, mode: SystemPromptMode) => {
    if (mode === 'default') {
      setValidationErrors((prev) => ({ ...prev, customSystemPrompt: undefined }));
      return true;
    }

    const isRequired = mode === 'replace' || mode === 'append';

    try {
      ValidationService.validateCustomSystemPrompt(value, isRequired);
      setValidationErrors((prev) => ({ ...prev, customSystemPrompt: undefined }));
      return true;
    } catch (error) {
      setValidationErrors((prev) => ({
        ...prev,
        customSystemPrompt: error instanceof Error ? error.message : 'Invalid system prompt',
      }));
      return false;
    }
  };

  const onSubmitSystemPrompt = () => {
    if (!validateCustomPrompt(state.customSystemPrompt, state.systemPromptMode)) {
      return;
    }

    updatePluginAndReload(plugin.meta.id, {
      enabled,
      pinned,
      jsonData: {
        ...jsonData,
        systemPromptMode: state.systemPromptMode,
        customSystemPrompt: state.customSystemPrompt,
      },
    });
  };

  const isSystemPromptSaveDisabled =
    state.systemPromptMode !== 'default' && (!state.customSystemPrompt.trim() || !!validationErrors.customSystemPrompt);

  const onSubmitLLMSettings = () => {
    if (isLLMSettingsDisabled || validationErrors.maxTotalTokens) {
      return;
    }

    // Validate before saving
    try {
      ValidationService.validateConfigValue('tokenLimit', state.maxTotalTokens);
    } catch (error) {
      setValidationErrors((prev) => ({
        ...prev,
        maxTotalTokens: error instanceof Error ? error.message : 'Invalid value',
      }));
      return;
    }

    updatePluginAndReload(plugin.meta.id, {
      enabled,
      pinned,
      jsonData: {
        ...jsonData,
        maxTotalTokens: state.maxTotalTokens,
      },
    });
  };

  const onSubmitMCPMode = () => {
    updatePluginAndReload(plugin.meta.id, {
      enabled,
      pinned,
      jsonData: {
        ...jsonData,
        useBuiltInMCP: state.useBuiltInMCP,
      },
    });
  };

  const onSubmitMCPServers = () => {
    // Validate all MCP servers before saving
    const errors: ValidationErrors['mcpServers'] = {};
    let hasErrors = false;

    state.mcpServers.forEach((server) => {
      const serverErrors: { name?: string; url?: string } = {};

      if (!server.name.trim()) {
        serverErrors.name = 'Server name is required';
        hasErrors = true;
      }

      if (server.url.trim()) {
        try {
          ValidationService.validateMCPServerURL(server.url);
        } catch (error) {
          serverErrors.url = error instanceof Error ? error.message : 'Invalid URL';
          hasErrors = true;
        }
      }

      if (Object.keys(serverErrors).length > 0) {
        errors[server.id] = serverErrors;
      }
    });

    if (hasErrors) {
      setValidationErrors((prev) => ({ ...prev, mcpServers: errors }));
      return;
    }

    // Check for collision markers (duplicate header keys)
    const hasDuplicateHeaders = state.mcpServers.some(
      (server) => server.headers && Object.keys(server.headers).some((key) => key.includes('__collision_'))
    );
    if (hasDuplicateHeaders) {
      // Don't save - the duplicate headers are already highlighted in red
      return;
    }

    // Build secureJsonData for header values
    const secureJsonData: Record<string, string> = {};

    // Process servers to extract header keys and values
    const cleanedServers = state.mcpServers.map((server) => {
      const headerKeys: string[] = [];

      if (server.headers) {
        for (const [key] of Object.entries(server.headers)) {
          let cleanKey = key.trim();
          // Skip empty keys and temp placeholder keys
          if (!cleanKey || cleanKey.startsWith('__new_header_')) {
            continue;
          }
          // Strip collision markers (shouldn't happen if validation above works)
          if (cleanKey.includes('__collision_')) {
            cleanKey = cleanKey.split('__collision_')[0].trim();
          }

          headerKeys.push(cleanKey);

          // Add header value to secureJsonData if modified
          const secureKey = getSecureHeaderKey(server.id, cleanKey);
          if (secureKey in state.modifiedHeaderValues) {
            secureJsonData[secureKey] = state.modifiedHeaderValues[secureKey];
          }
        }
      }

      // Return server config with headerKeys (not headers with values)
      // Keep headers temporarily for display purposes, but values will be in secureJsonData
      const { headers: _, ...serverWithoutHeaders } = server;
      return {
        ...serverWithoutHeaders,
        headerKeys: headerKeys.length > 0 ? headerKeys : undefined,
      };
    });

    // Mark cleared headers by setting them to empty string (Grafana convention for clearing secureJsonData)
    for (const secureKey of state.clearedHeaders) {
      secureJsonData[secureKey] = '';
    }

    updatePluginAndReload(plugin.meta.id, {
      enabled,
      pinned,
      jsonData: {
        ...jsonData,
        mcpServers: cleanedServers,
      },
      // Only send secureJsonData if there are values to update or clear
      ...(Object.keys(secureJsonData).length > 0 ? { secureJsonData } : {}),
    });
  };

  return (
    <div>
      <FieldSet label="LLM Settings">
        <Field
          label="Max Total Tokens"
          description="Maximum number of tokens for LLM requests (minimum: 1000, recommended: 50000-200000)"
          invalid={!!validationErrors.maxTotalTokens}
          error={validationErrors.maxTotalTokens}
        >
          <Input
            width={60}
            name="maxTotalTokens"
            id="config-max-tokens"
            data-testid={testIds.appConfig.maxTotalTokens}
            type="number"
            value={state.maxTotalTokens}
            placeholder="50000"
            min={1000}
            max={200000}
            onChange={onChange}
            invalid={!!validationErrors.maxTotalTokens}
          />
        </Field>

        <div className="mt-3">
          <Button
            onClick={onSubmitLLMSettings}
            data-testid={testIds.appConfig.submit}
            disabled={isLLMSettingsDisabled || !!validationErrors.maxTotalTokens}
          >
            Save LLM settings
          </Button>
        </div>
      </FieldSet>

      <FieldSet label="MCP Mode" className="mt-4">
        <p className="text-sm text-secondary mb-3">
          Choose how to connect to MCP (Model Context Protocol) tools. Built-in mode uses Grafana&apos;s integrated MCP
          server, while External mode connects to custom MCP servers you configure.
        </p>

        {state.builtInMCPAvailable === null && (
          <Alert severity="info" title="Checking availability">
            Checking if built-in MCP is available...
          </Alert>
        )}

        {state.builtInMCPAvailable === false && (
          <Alert severity="warning" title="Built-in MCP unavailable">
            The grafana-llm-app plugin is not installed or MCP is not enabled. To use built-in MCP, install and
            configure grafana-llm-app.
          </Alert>
        )}

        <Field
          label="Use Built-in Grafana MCP"
          description={
            state.useBuiltInMCP
              ? "Enable Grafana's built-in MCP server. Can be used together with external servers below."
              : 'Using external MCP servers configured below. Built-in MCP is disabled.'
          }
          data-testid={testIds.appConfig.useBuiltInMCPField}
        >
          <Switch
            value={state.useBuiltInMCP}
            onChange={(e) => setState({ ...state, useBuiltInMCP: e.currentTarget.checked })}
            disabled={state.builtInMCPAvailable === false}
            data-testid={testIds.appConfig.useBuiltInMCPToggle}
          />
        </Field>

        {state.useBuiltInMCP && state.builtInMCPAvailable && !state.mcpServers.some((s) => s.enabled) && (
          <Alert severity="info" title="Built-in MCP enabled" className="mt-2">
            Using Grafana&apos;s built-in MCP server with observability tools. You can also configure external servers
            below - all tools will be available together.
          </Alert>
        )}

        {state.useBuiltInMCP && state.builtInMCPAvailable && state.mcpServers.some((s) => s.enabled) && (
          <Alert severity="success" title="Combined mode active" className="mt-2">
            Using both built-in Grafana MCP and {state.mcpServers.filter((s) => s.enabled).length} external server(s).
            All tools available in chat.
          </Alert>
        )}

        <div className="mt-3">
          <Button
            onClick={onSubmitMCPMode}
            variant="primary"
            disabled={
              state.builtInMCPAvailable === null ||
              (state.useBuiltInMCP && state.builtInMCPAvailable === false)
            }
            data-testid={testIds.appConfig.saveMCPModeButton}
          >
            Save MCP Mode
          </Button>
        </div>
      </FieldSet>

      <FieldSet label="MCP Server Connections" className="mt-4">
        <p className="text-sm text-secondary mb-3">
          Configure additional MCP (Model Context Protocol) servers to extend tool capabilities. Supports OpenAPI-based
          servers like{' '}
          <a href="https://github.com/open-webui/mcpo" target="_blank" rel="noopener noreferrer">
            MCPO
          </a>
          .
        </p>

        {state.mcpServers.map((server) => (
          <div
            key={server.id}
            data-testid={testIds.appConfig.mcpServerCard(server.id)}
            className="p-4 mb-3 rounded border"
            style={{
              borderColor: 'var(--grafana-border-medium)',
              backgroundColor: 'var(--grafana-background-secondary)',
            }}
          >
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Icon name="plug" />
                <span className="font-medium">{server.name || 'Unnamed Server'}</span>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  value={server.enabled}
                  onChange={(e) => updateMCPServer(server.id, { enabled: e.currentTarget.checked })}
                />
                <Button
                  variant="secondary"
                  size="sm"
                  icon="trash-alt"
                  onClick={() => removeMCPServer(server.id)}
                  data-testid={testIds.appConfig.mcpServerRemoveButton(server.id)}
                >
                  Remove
                </Button>
              </div>
            </div>

            <Field
              label="Server Name"
              invalid={!!validationErrors.mcpServers[server.id]?.name}
              error={validationErrors.mcpServers[server.id]?.name}
            >
              <Input
                width={60}
                value={server.name}
                placeholder="My MCP Server"
                onChange={(e) => updateMCPServer(server.id, { name: e.currentTarget.value })}
                invalid={!!validationErrors.mcpServers[server.id]?.name}
                data-testid={testIds.appConfig.mcpServerNameInput(server.id)}
              />
            </Field>

            <Field
              label="Server URL"
              className="mt-2"
              invalid={!!validationErrors.mcpServers[server.id]?.url}
              error={validationErrors.mcpServers[server.id]?.url}
            >
              <Input
                width={60}
                value={server.url}
                placeholder="https://mcp-server.example.com"
                onChange={(e) => updateMCPServer(server.id, { url: e.currentTarget.value })}
                invalid={!!validationErrors.mcpServers[server.id]?.url}
                data-testid={testIds.appConfig.mcpServerUrlInput(server.id)}
              />
            </Field>

            <Field label="Type" className="mt-2">
              <select
                className="gf-form-input"
                value={server.type || 'openapi'}
                onChange={(e) =>
                  updateMCPServer(server.id, {
                    type: e.target.value as 'openapi' | 'standard' | 'sse' | 'streamable-http',
                  })
                }
                style={{ width: '240px', height: '32px' }}
              >
                <option value="openapi">OpenAPI</option>
                <option value="standard">Standard MCP</option>
                <option value="sse">SSE</option>
                <option value="streamable-http">Streamable HTTP</option>
              </select>
            </Field>

            {/* Advanced Options Toggle */}
            <div className="mt-3">
              <button
                type="button"
                onClick={() => toggleAdvancedOptions(server.id)}
                className="flex items-center gap-1 text-sm cursor-pointer bg-transparent border-none p-0"
                style={{ color: 'var(--grafana-text-link)' }}
                data-testid={testIds.appConfig.mcpServerAdvancedToggle(server.id)}
              >
                <Icon name={state.expandedAdvanced.has(server.id) ? 'angle-down' : 'angle-right'} />
                Advanced Options
                {server.headers && Object.keys(server.headers).length > 0 && (
                  <span className="ml-1 text-xs" style={{ color: 'var(--grafana-text-secondary)' }}>
                    ({Object.keys(server.headers).length} header{Object.keys(server.headers).length !== 1 ? 's' : ''})
                  </span>
                )}
              </button>
            </div>

            {/* Advanced Options Content */}
            {state.expandedAdvanced.has(server.id) && (
              <div
                className="mt-2 p-3 rounded"
                style={{
                  backgroundColor: 'var(--grafana-background-canvas)',
                  border: '1px solid var(--grafana-border-weak)',
                }}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium">Custom Headers</span>
                  <span className="text-xs" style={{ color: 'var(--grafana-text-secondary)' }}>
                    {Object.keys(server.headers || {}).length}/10
                  </span>
                </div>
                <p className="text-xs mb-2" style={{ color: 'var(--grafana-text-secondary)' }}>
                  Add custom HTTP headers to include with every request to this MCP server. Header values
                  are stored securely and encrypted.
                </p>

                {/* Header List */}
                {Object.entries(server.headers || {}).map(([key, value], index) => {
                  // Display empty for temp keys, strip collision markers for display
                  let displayKey = key;
                  if (key.startsWith('__new_header_')) {
                    displayKey = '';
                  } else if (key.includes('__collision_')) {
                    displayKey = key.split('__collision_')[0];
                  }
                  const hasCollision = key.includes('__collision_');
                  const normalizedDisplayKey = normalizeHeaderKey(displayKey);

                  // Check if this header value is configured in secureJsonData
                  const isSecureConfigured =
                    normalizedDisplayKey && !normalizedDisplayKey.startsWith('__new_header_')
                      ? isHeaderConfigured(server.id, normalizedDisplayKey)
                      : false;
                  const isModified =
                    normalizedDisplayKey && !normalizedDisplayKey.startsWith('__new_header_')
                      ? isHeaderModified(server.id, normalizedDisplayKey)
                      : false;

                  // Get the display value - empty if configured but not modified (shows placeholder)
                  const displayValue =
                    normalizedDisplayKey && !normalizedDisplayKey.startsWith('__new_header_')
                      ? getHeaderDisplayValue(server.id, normalizedDisplayKey, value)
                      : value;

                  // Use index as key since we preserve order when updating headers
                  // This maintains focus when editing keys
                  return (
                    <div key={`${server.id}-header-${index}`} className="mb-2">
                      <div className="flex items-center gap-2">
                        <Input
                          width={20}
                          value={displayKey}
                          placeholder="Header key"
                          onChange={(e) => updateHeader(server.id, key, e.currentTarget.value, value)}
                          data-testid={testIds.appConfig.mcpServerHeaderKeyInput(server.id, index)}
                          invalid={hasCollision}
                        />
                        <Input
                          width={30}
                          type="password"
                          value={displayValue}
                          placeholder={isSecureConfigured && !isModified ? 'Configured ••••••••' : 'Header value'}
                          onChange={(e) => updateHeader(server.id, key, key, e.currentTarget.value)}
                          data-testid={testIds.appConfig.mcpServerHeaderValueInput(server.id, index)}
                        />
                        {isSecureConfigured && !isModified && (
                          <Icon name="lock" title="Value stored securely" />
                        )}
                        <Button
                          variant="secondary"
                          size="sm"
                          icon="times"
                          onClick={() => removeHeader(server.id, key)}
                          data-testid={testIds.appConfig.mcpServerHeaderRemoveButton(server.id, index)}
                          aria-label="Remove header"
                        />
                      </div>
                      {hasCollision && (
                        <span className="text-xs mt-1 block" style={{ color: 'var(--grafana-text-error)' }}>
                          Duplicate key name
                        </span>
                      )}
                      {isSecureConfigured && !isModified && (
                        <span className="text-xs mt-1 block" style={{ color: 'var(--grafana-text-secondary)' }}>
                          Enter a new value to update, or leave empty to keep the existing value
                        </span>
                      )}
                    </div>
                  );
                })}

                {/* Add Header Button */}
                {(() => {
                  const headers = server.headers || {};
                  const headerKeys = Object.keys(headers);
                  const atMaxHeaders = headerKeys.length >= 10;
                  // Check if any header has an empty, temp, or collision key
                  const hasIncompleteHeader = headerKeys.some(
                    (key) => key.startsWith('__new_header_') || !key.trim() || key.includes('__collision_')
                  );

                  if (atMaxHeaders) {
                    return null;
                  }

                  return (
                    <Button
                      variant="secondary"
                      size="sm"
                      icon="plus"
                      onClick={() => addHeader(server.id)}
                      disabled={hasIncompleteHeader}
                      data-testid={testIds.appConfig.mcpServerAddHeaderButton(server.id)}
                    >
                      Add Header
                    </Button>
                  );
                })()}
              </div>
            )}
          </div>
        ))}

        <Button
          variant="secondary"
          icon="plus"
          onClick={addMCPServer}
          data-testid={testIds.appConfig.addMcpServerButton}
        >
          Add MCP Server
        </Button>

        <div className="mt-3">
          {Object.keys(validationErrors.mcpServers).length > 0 && (
            <Alert severity="error" title="Validation errors" className="mb-3">
              Please fix the validation errors above before saving.
            </Alert>
          )}
          <Button
            onClick={onSubmitMCPServers}
            variant="primary"
            disabled={Object.keys(validationErrors.mcpServers).length > 0}
            data-testid={testIds.appConfig.saveMcpServersButton}
          >
            Save MCP Server Connections
          </Button>
        </div>
      </FieldSet>

      <FieldSet label="System Prompt" className="mt-4">
        <p className="text-sm text-secondary mb-3">
          Customize the system prompt that instructs the AI assistant. You can use the default observability-focused
          prompt, replace it entirely with your own, or append additional instructions to it.
        </p>

        <Field label="Prompt Mode" description="Choose how to configure the system prompt">
          <RadioButtonGroup
            options={PROMPT_MODE_OPTIONS}
            value={state.systemPromptMode}
            onChange={onSystemPromptModeChange}
            data-testid={testIds.appConfig.systemPromptModeSelector}
          />
        </Field>

        {state.systemPromptMode !== 'default' && (
          <Field
            label="Custom System Prompt"
            description={
              state.systemPromptMode === 'replace'
                ? 'Enter your complete custom system prompt'
                : 'Enter additional instructions to append to the default prompt'
            }
            className="mt-3"
            invalid={!!validationErrors.customSystemPrompt}
            error={validationErrors.customSystemPrompt}
          >
            <TextArea
              value={state.customSystemPrompt}
              onChange={(e) => onCustomSystemPromptChange(e.currentTarget.value)}
              rows={8}
              placeholder={
                state.systemPromptMode === 'replace'
                  ? 'You are a helpful assistant that...'
                  : 'Additional instructions:\n- Always provide code examples\n- Focus on performance optimization'
              }
              invalid={!!validationErrors.customSystemPrompt}
              data-testid={testIds.appConfig.customSystemPromptTextarea}
            />
          </Field>
        )}

        {state.systemPromptMode !== 'default' && (
          <p className="text-sm text-secondary mt-1" data-testid={testIds.appConfig.customSystemPromptCharCount}>
            Characters: {state.customSystemPrompt.length} / {ValidationService.MAX_SYSTEM_PROMPT_LENGTH}
            {state.customSystemPrompt.length > ValidationService.MAX_SYSTEM_PROMPT_LENGTH * 0.8 && (
              <span className="text-warning ml-2">(Approaching limit - long prompts may impact performance)</span>
            )}
          </p>
        )}

        <div className="mt-3 flex gap-2">
          <Button
            variant="secondary"
            onClick={() => setShowDefaultPromptModal(true)}
            icon="eye"
            data-testid={testIds.appConfig.viewDefaultPromptButton}
          >
            View Default Prompt
          </Button>
          <Button
            onClick={onSubmitSystemPrompt}
            variant="primary"
            disabled={isSystemPromptSaveDisabled}
            data-testid={testIds.appConfig.saveSystemPromptButton}
          >
            Save System Prompt
          </Button>
        </div>
      </FieldSet>

      {/* Display Settings */}
      <FieldSet label="Display Settings" data-testid={testIds.appConfig.displaySettings}>
        <Field
          label="Kiosk Mode"
          description="When enabled, embedded Grafana pages hide navigation bars for a cleaner view"
          data-testid={testIds.appConfig.kioskModeField}
        >
          <Switch
            value={state.kioskModeEnabled}
            onChange={(e) => setState({ ...state, kioskModeEnabled: e.currentTarget.checked })}
            data-testid={testIds.appConfig.kioskModeToggle}
          />
        </Field>

        <Field
          label="Chat Panel Position"
          description="Choose where the chat panel appears when displaying Grafana pages"
          data-testid={testIds.appConfig.chatPanelPositionField}
        >
          <RadioButtonGroup
            value={state.chatPanelPosition}
            options={[
              { label: 'Left', value: 'left' },
              { label: 'Right', value: 'right' },
            ]}
            onChange={(value) => setState({ ...state, chatPanelPosition: value as 'left' | 'right' })}
          />
        </Field>

        <div className="mt-4">
          <Button
            onClick={() => {
              const updateData = {
                enabled,
                pinned,
                jsonData: {
                  ...jsonData,
                  kioskModeEnabled: state.kioskModeEnabled,
                  chatPanelPosition: state.chatPanelPosition,
                },
              };
              updatePluginAndReload(plugin.meta.id, updateData);
            }}
            variant="primary"
            data-testid={testIds.appConfig.saveDisplaySettingsButton}
          >
            Save Display Settings
          </Button>
        </div>
      </FieldSet>

      <Modal
        title="Default System Prompt"
        isOpen={showDefaultPromptModal}
        onDismiss={() => setShowDefaultPromptModal(false)}
        data-testid={testIds.appConfig.defaultPromptModal}
      >
        <div className="p-2">
          <p className="text-sm text-secondary mb-3">
            This is the default system prompt used by the Observability Assistant. It instructs the AI to specialize in
            the Grafana LGTM stack and use MCP tools.
          </p>
          <pre
            className="p-3 rounded text-sm overflow-auto"
            style={{
              backgroundColor: 'var(--grafana-background-secondary)',
              border: '1px solid var(--grafana-border-weak)',
              maxHeight: '400px',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
            data-testid={testIds.appConfig.defaultPromptContent}
          >
            {SYSTEM_PROMPT}
          </pre>
          <div className="mt-3 flex justify-end gap-2">
            <Button
              variant="secondary"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(SYSTEM_PROMPT);
                  setCopySuccess(true);
                  setTimeout(() => setCopySuccess(false), 2000);
                } catch (err) {
                  console.error('Failed to copy system prompt:', err);
                }
              }}
              icon={copySuccess ? 'check' : 'copy'}
              data-testid={testIds.appConfig.copyDefaultPromptButton}
            >
              {copySuccess ? 'Copied!' : 'Copy to Clipboard'}
            </Button>
            <Button
              variant="primary"
              onClick={() => setShowDefaultPromptModal(false)}
              data-testid={testIds.appConfig.closeDefaultPromptButton}
            >
              Close
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
};

export default AppConfig;

const updatePluginAndReload = async (pluginId: string, data: Partial<PluginMeta<AppPluginSettings>>) => {
  try {
    await updatePlugin(pluginId, data);

    // Reloading the page as the changes made here wouldn't be propagated to the actual plugin otherwise.
    // This is not ideal, however unfortunately currently there is no supported way for updating the plugin state.
    window.location.reload();
  } catch (e) {
    console.error('Error while updating the plugin', e);
  }
};

const updatePlugin = async (pluginId: string, data: Partial<PluginMeta>) => {
  const response = await getBackendSrv().fetch({
    url: `/api/plugins/${pluginId}/settings`,
    method: 'POST',
    data,
  });

  return lastValueFrom(response);
};
