import React, { ChangeEvent, useState } from 'react';
import { lastValueFrom } from 'rxjs';
import { AppPluginMeta, PluginConfigPageProps, PluginMeta } from '@grafana/data';
import { getBackendSrv } from '@grafana/runtime';
import { Button, Field, FieldSet, Input, Icon, Switch, Alert, RadioButtonGroup, TextArea, Modal } from '@grafana/ui';
import { testIds } from '../testIds';
import { ValidationService } from '../../services/validation';
import { SYSTEM_PROMPT } from '../Chat/constants';
import type { AppPluginSettings, MCPServerConfig, SystemPromptMode } from '../../types/plugin';

const PROMPT_MODE_OPTIONS = [
  { label: 'Use default prompt', value: 'default' as SystemPromptMode },
  { label: 'Replace with custom prompt', value: 'replace' as SystemPromptMode },
  { label: 'Append to default prompt', value: 'append' as SystemPromptMode },
];

type State = {
  // Maximum total tokens for LLM requests
  maxTotalTokens: number;
  // MCP server configurations
  mcpServers: MCPServerConfig[];
  // System prompt configuration
  systemPromptMode: SystemPromptMode;
  customSystemPrompt: string;
  // Track which servers have advanced options expanded
  expandedAdvanced: Set<string>;
  // Display settings
  kioskModeEnabled: boolean;
  sidePanelPosition: 'left' | 'right';
};

type ValidationErrors = {
  maxTotalTokens?: string;
  mcpServers: { [id: string]: { name?: string; url?: string } };
  customSystemPrompt?: string;
};

export interface AppConfigProps extends PluginConfigPageProps<AppPluginMeta<AppPluginSettings>> {}

const AppConfig = ({ plugin }: AppConfigProps) => {
  const { enabled, pinned, jsonData } = plugin.meta;
  const [state, setState] = useState<State>({
    maxTotalTokens: jsonData?.maxTotalTokens || 50000,
    mcpServers: jsonData?.mcpServers || [],
    systemPromptMode: jsonData?.systemPromptMode || 'default',
    customSystemPrompt: jsonData?.customSystemPrompt || '',
    expandedAdvanced: new Set<string>(),
    kioskModeEnabled: jsonData?.kioskModeEnabled ?? true,
    sidePanelPosition: jsonData?.sidePanelPosition || 'right',
  });
  const [validationErrors, setValidationErrors] = useState<ValidationErrors>({
    mcpServers: {},
  });
  const [showDefaultPromptModal, setShowDefaultPromptModal] = useState(false);
  const [copySuccess, setCopySuccess] = useState(false);

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

    // Helper to normalize a key for comparison (trim and extract base from collision markers)
    const normalizeKey = (k: string): string => {
      let normalized = k.trim();
      if (normalized.includes('__collision_')) {
        normalized = normalized.split('__collision_')[0].trim();
      }
      return normalized;
    };

    // Helper to extract collision ID from a key, if present
    const getCollisionId = (k: string): string | null => {
      if (k.includes('__collision_')) {
        return k.split('__collision_')[1];
      }
      return null;
    };

    // If key changed
    let finalKey = newKey;
    if (oldKey !== newKey) {
      // Check if newKey would collide with an existing key (excluding the one we're editing)
      // Normalize keys to catch whitespace variants that would collide after save cleanup
      const normalizedNewKey = normalizeKey(newKey);
      const existingKeys = keyOrder.filter((k) => k !== oldKey);

      // Find which existing key(s) would conflict
      const conflictingKey = existingKeys.find((k) => normalizeKey(k) === normalizedNewKey);

      if (normalizedNewKey && conflictingKey) {
        // Collision detected - determine stable collision ID
        let uniquePart: string;

        // Priority for stable collision ID:
        // 1. If oldKey already has a collision marker, preserve its ID
        // 2. If the conflicting key has a collision marker, use a paired ID
        // 3. Otherwise generate a new stable ID based on the entry's identity
        const oldCollisionId = getCollisionId(oldKey);
        const conflictingCollisionId = getCollisionId(conflictingKey);

        if (oldCollisionId) {
          // Preserve existing collision ID when editing a collision-marked entry
          uniquePart = oldCollisionId;
        } else if (conflictingCollisionId) {
          // The other entry is marked - create a paired ID to show these two conflict
          uniquePart = `pair_${conflictingCollisionId}`;
        } else if (oldKey.startsWith('__new_header_')) {
          // Use the new header's unique ID
          uniquePart = oldKey.replace('__new_header_', '');
        } else {
          // Generate new ID based on the key content and timestamp
          uniquePart = `id_${oldKey.replace(/[^a-zA-Z0-9]/g, '_')}_${Date.now()}`;
        }

        finalKey = `${newKey}__collision_${uniquePart}`;
      }
    }

    // Rebuild headers preserving order - replace oldKey with finalKey at the same position
    const newHeaders: Record<string, string> = {};
    for (const k of keyOrder) {
      if (k === oldKey) {
        newHeaders[finalKey] = value;
      } else {
        newHeaders[k] = currentHeaders[k];
      }
    }

    updateMCPServer(serverId, { headers: newHeaders });
  };

  const removeHeader = (serverId: string, key: string) => {
    const server = state.mcpServers.find((s) => s.id === serverId);
    if (!server) {
      return;
    }

    const currentHeaders = { ...(server.headers || {}) };
    delete currentHeaders[key];

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

    // Clean up headers before saving - remove entries with empty or temp keys
    const cleanedServers = state.mcpServers.map((server) => {
      if (!server.headers) {
        return server;
      }

      const cleanedHeaders: Record<string, string> = {};
      for (const [key, value] of Object.entries(server.headers)) {
        let cleanKey = key.trim();
        // Skip empty keys and temp placeholder keys
        if (!cleanKey || cleanKey.startsWith('__new_header_')) {
          continue;
        }
        // Strip collision markers (shouldn't happen if validation above works)
        if (cleanKey.includes('__collision_')) {
          cleanKey = cleanKey.split('__collision_')[0].trim();
        }
        cleanedHeaders[cleanKey] = value;
      }

      return {
        ...server,
        headers: Object.keys(cleanedHeaders).length > 0 ? cleanedHeaders : undefined,
      };
    });

    updatePluginAndReload(plugin.meta.id, {
      enabled,
      pinned,
      jsonData: {
        ...jsonData,
        mcpServers: cleanedServers,
      },
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
                  Add custom HTTP headers to include with every request to this MCP server.
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
                          value={value}
                          placeholder="Header value"
                          onChange={(e) => updateHeader(server.id, key, key, e.currentTarget.value)}
                          data-testid={testIds.appConfig.mcpServerHeaderValueInput(server.id, index)}
                        />
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
          label="Side Panel Position"
          description="Choose where the side panel appears when displaying Grafana pages"
          data-testid={testIds.appConfig.sidePanelPositionField}
        >
          <RadioButtonGroup
            value={state.sidePanelPosition}
            options={[
              { label: 'Left', value: 'left' },
              { label: 'Right', value: 'right' },
            ]}
            onChange={(value) => setState({ ...state, sidePanelPosition: value as 'left' | 'right' })}
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
                  sidePanelPosition: state.sidePanelPosition,
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
