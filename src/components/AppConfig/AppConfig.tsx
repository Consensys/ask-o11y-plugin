import React, { ChangeEvent, useEffect, useRef, useState } from 'react';
import { lastValueFrom } from 'rxjs';
import { AppPluginMeta, PluginConfigPageProps, PluginMeta } from '@grafana/data';
import { getBackendSrv } from '@grafana/runtime';
import { Button, Field, FieldSet, Input, Icon, Switch, Alert, RadioButtonGroup } from '@grafana/ui';
import { mcp } from '@grafana/llm';
import { testIds } from '../testIds';
import { ValidationService } from '../../services/validation';
import { PromptEditor } from './PromptEditor';
import type { AppPluginSettings, MCPServerConfig } from '../../types/plugin';

interface PromptDefaults {
  defaultSystemPrompt: string;
  investigationPrompt: string;
  performancePrompt: string;
}

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
  maxTotalTokens: number;
  mcpServers: MCPServerConfig[];
  useBuiltInMCP: boolean;
  builtInMCPAvailable: boolean | null;
  expandedAdvanced: Set<string>;
  kioskModeEnabled: boolean;
  chatPanelPosition: 'left' | 'right';
  defaultSystemPrompt: string;
  investigationPrompt: string;
  performancePrompt: string;
};

type ValidationErrors = {
  maxTotalTokens?: string;
  mcpServers: { [id: string]: { name?: string; url?: string } };
};

export interface AppConfigProps extends PluginConfigPageProps<AppPluginMeta<AppPluginSettings>> {}

const PROMPT_DEFAULTS_URL = '/api/plugins/consensys-asko11y-app/resources/api/prompt-defaults';

const AppConfig = ({ plugin }: AppConfigProps) => {
  const { enabled, pinned, jsonData } = plugin.meta;
  const [promptDefaults, setPromptDefaults] = useState<PromptDefaults | null>(null);
  const [state, setState] = useState<State>({
    maxTotalTokens: jsonData?.maxTotalTokens || 180000,
    mcpServers: jsonData?.mcpServers || [],
    useBuiltInMCP: jsonData?.useBuiltInMCP ?? false,
    builtInMCPAvailable: null,
    expandedAdvanced: new Set<string>(),
    kioskModeEnabled: jsonData?.kioskModeEnabled ?? true,
    chatPanelPosition: jsonData?.chatPanelPosition || 'right',
    defaultSystemPrompt: jsonData?.defaultSystemPrompt || '',
    investigationPrompt: jsonData?.investigationPrompt || '',
    performancePrompt: jsonData?.performancePrompt || '',
  });
  const [validationErrors, setValidationErrors] = useState<ValidationErrors>({
    mcpServers: {},
  });

  useEffect(() => {
    const init = async () => {
      const [available, defaults] = await Promise.all([
        mcp.enabled().catch(() => false),
        lastValueFrom(getBackendSrv().fetch<PromptDefaults>({ url: PROMPT_DEFAULTS_URL }))
          .then((res) => res.data)
          .catch(() => null),
      ]);

      setState((prev) => ({
        ...prev,
        builtInMCPAvailable: available,
        defaultSystemPrompt: prev.defaultSystemPrompt || defaults?.defaultSystemPrompt || '',
        investigationPrompt: prev.investigationPrompt || defaults?.investigationPrompt || '',
        performancePrompt: prev.performancePrompt || defaults?.performancePrompt || '',
      }));
      if (defaults) {
        setPromptDefaults(defaults);
      }
    };

    init();
  }, []);

  const isLLMSettingsDisabled = Boolean(!state.maxTotalTokens || state.maxTotalTokens < 1000);

  function onChange(event: ChangeEvent<HTMLInputElement>) {
    const { name, value, type } = event.target;
    const parsedValue = type === 'number' ? parseInt(value, 10) || 0 : value.trim();

    setState({
      ...state,
      [name]: parsedValue,
    });

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
  }

  function addMCPServer() {
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
  }

  function updateMCPServer(id: string, updates: Partial<MCPServerConfig>) {
    setState({
      ...state,
      mcpServers: state.mcpServers.map((server) => (server.id === id ? { ...server, ...updates } : server)),
    });

    const newErrors = { ...validationErrors.mcpServers };

    if (updates.url !== undefined) {
      if (updates.url.trim()) {
        try {
          ValidationService.validateMCPServerURL(updates.url);
          if (newErrors[id]) {
            delete newErrors[id].url;
            if (Object.keys(newErrors[id]).length === 0) {
              delete newErrors[id];
            }
          }
        } catch (error) {
          if (!newErrors[id]) {
            newErrors[id] = {};
          }
          newErrors[id].url = error instanceof Error ? error.message : 'Invalid URL';
        }
      }
    }

    if (updates.name !== undefined) {
      if (!updates.name.trim()) {
        if (!newErrors[id]) {
          newErrors[id] = {};
        }
        newErrors[id].name = 'Server name is required';
      } else {
        if (newErrors[id]) {
          delete newErrors[id].name;
          if (Object.keys(newErrors[id]).length === 0) {
            delete newErrors[id];
          }
        }
      }
    }

    setValidationErrors((prev) => ({ ...prev, mcpServers: newErrors }));
  }

  function removeMCPServer(id: string) {
    setState({
      ...state,
      mcpServers: state.mcpServers.filter((server) => server.id !== id),
    });
  }

  function toggleAdvancedOptions(id: string) {
    setState((prev) => {
      const newExpanded = new Set(prev.expandedAdvanced);
      if (newExpanded.has(id)) {
        newExpanded.delete(id);
      } else {
        newExpanded.add(id);
      }
      return { ...prev, expandedAdvanced: newExpanded };
    });
  }

  const headerIdCounterRef = useRef(0);

  function addHeader(serverId: string) {
    const server = state.mcpServers.find((s) => s.id === serverId);
    if (!server) {
      return;
    }

    const currentHeaders = server.headers || {};
    const headerCount = Object.keys(currentHeaders).length;

    if (headerCount >= 10) {
      return;
    }

    headerIdCounterRef.current += 1;
    const tempKey = `__new_header_${Date.now()}_${headerIdCounterRef.current}`;

    updateMCPServer(serverId, {
      headers: { ...currentHeaders, [tempKey]: '' },
    });
  }

  function updateHeader(serverId: string, oldKey: string, newKey: string, value: string) {
    const server = state.mcpServers.find((s) => s.id === serverId);
    if (!server) {
      return;
    }

    const currentHeaders = server.headers || {};
    const keyOrder = Object.keys(currentHeaders);

    const finalKey = computeFinalHeaderKey(oldKey, newKey, keyOrder);

    const newHeaders: Record<string, string> = {};
    for (const k of keyOrder) {
      if (k === oldKey) {
        newHeaders[finalKey] = value;
      } else {
        newHeaders[k] = currentHeaders[k];
      }
    }

    updateMCPServer(serverId, { headers: newHeaders });
  }

  function computeFinalHeaderKey(oldKey: string, newKey: string, existingKeys: string[]): string {
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
    if (oldCollisionId) {
      return `${newKey}__collision_${oldCollisionId}`;
    }

    const conflictingCollisionId = getCollisionId(conflictingKey);
    if (conflictingCollisionId) {
      return `${newKey}__collision_pair_${conflictingCollisionId}`;
    }

    if (oldKey.startsWith('__new_header_')) {
      const uniquePart = oldKey.replace('__new_header_', '');
      return `${newKey}__collision_${uniquePart}`;
    }

    const sanitizedKey = oldKey.replace(/[^a-zA-Z0-9]/g, '_');
    return `${newKey}__collision_id_${sanitizedKey}_${Date.now()}`;
  }

  function removeHeader(serverId: string, key: string) {
    const server = state.mcpServers.find((s) => s.id === serverId);
    if (!server) {
      return;
    }

    const currentHeaders = { ...(server.headers || {}) };
    delete currentHeaders[key];

    updateMCPServer(serverId, { headers: currentHeaders });
  }

  function savePrompt(field: 'defaultSystemPrompt' | 'investigationPrompt' | 'performancePrompt', value: string) {
    if (value.length > 15000) {
      return;
    }
    updatePluginAndReload(plugin.meta.id, {
      enabled,
      pinned,
      jsonData: {
        ...jsonData,
        [field]: value,
      },
    });
  }

  function onSubmitLLMSettings() {
    if (isLLMSettingsDisabled || validationErrors.maxTotalTokens) {
      return;
    }

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
  }

  function onSubmitMCPMode() {
    updatePluginAndReload(plugin.meta.id, {
      enabled,
      pinned,
      jsonData: {
        ...jsonData,
        useBuiltInMCP: state.useBuiltInMCP,
      },
    });
  }

  function onSubmitMCPServers() {
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

    const hasDuplicateHeaders = state.mcpServers.some(
      (server) => server.headers && Object.keys(server.headers).some((key) => key.includes('__collision_'))
    );
    if (hasDuplicateHeaders) {
      return;
    }

    const cleanedServers = state.mcpServers.map((server) => {
      if (!server.headers) {
        return server;
      }

      const cleanedHeaders: Record<string, string> = {};
      for (const [key, value] of Object.entries(server.headers)) {
        let cleanKey = key.trim();
        if (!cleanKey || cleanKey.startsWith('__new_header_')) {
          continue;
        }
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
  }

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
            placeholder="180000"
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
            className="p-4 mb-3 rounded border border-medium bg-secondary"
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

            <div className="mt-3">
              <button
                type="button"
                onClick={() => toggleAdvancedOptions(server.id)}
                className="flex items-center gap-1 text-sm text-link cursor-pointer bg-transparent border-none p-0"
                data-testid={testIds.appConfig.mcpServerAdvancedToggle(server.id)}
              >
                <Icon name={state.expandedAdvanced.has(server.id) ? 'angle-down' : 'angle-right'} />
                Advanced Options
                {server.headers && Object.keys(server.headers).length > 0 && (
                  <span className="ml-1 text-xs text-secondary">
                    ({Object.keys(server.headers).length} header{Object.keys(server.headers).length !== 1 ? 's' : ''})
                  </span>
                )}
              </button>
            </div>

            {state.expandedAdvanced.has(server.id) && (
              <div className="mt-2 p-3 rounded bg-canvas border border-weak">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium">Custom Headers</span>
                  <span className="text-xs text-secondary">
                    {Object.keys(server.headers || {}).length}/10
                  </span>
                </div>
                <p className="text-xs text-secondary mb-2">
                  Add custom HTTP headers to include with every request to this MCP server.
                </p>

                {Object.entries(server.headers || {}).map(([key, value], index) => {
                  let displayKey = key;
                  if (key.startsWith('__new_header_')) {
                    displayKey = '';
                  } else if (key.includes('__collision_')) {
                    displayKey = key.split('__collision_')[0];
                  }
                  const hasCollision = key.includes('__collision_');
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
                        <span className="text-xs text-error mt-1 block">
                          Duplicate key name
                        </span>
                      )}
                    </div>
                  );
                })}

                {Object.keys(server.headers || {}).length < 10 && (
                  <Button
                    variant="secondary"
                    size="sm"
                    icon="plus"
                    onClick={() => addHeader(server.id)}
                    disabled={Object.keys(server.headers || {}).some(
                      (key) => key.startsWith('__new_header_') || !key.trim() || key.includes('__collision_')
                    )}
                    data-testid={testIds.appConfig.mcpServerAddHeaderButton(server.id)}
                  >
                    Add Header
                  </Button>
                )}
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

      {promptDefaults && (
        <FieldSet label="Prompt Templates" className="mt-4">
          <p className="text-sm text-secondary mb-3">
            Customize the prompt templates used by the AI assistant. Templates use Go text/template syntax.
            Variables like {'{{.AlertName}}'} and {'{{.Target}}'} are replaced at runtime.
          </p>

          <PromptEditor
            label="System Prompt"
            description="Base instructions for the AI assistant across all conversation types."
            currentValue={state.defaultSystemPrompt}
            defaultValue={promptDefaults.defaultSystemPrompt}
            onSave={(value) => savePrompt('defaultSystemPrompt', value)}
            testIdPrefix={testIds.appConfig.promptEditor.system}
          />

          <PromptEditor
            label="Investigation Prompt"
            description="Template for alert investigation workflows. Use {{.AlertName}} for the alert name."
            currentValue={state.investigationPrompt}
            defaultValue={promptDefaults.investigationPrompt}
            onSave={(value) => savePrompt('investigationPrompt', value)}
            testIdPrefix={testIds.appConfig.promptEditor.investigation}
          />

          <PromptEditor
            label="Performance Prompt"
            description="Template for performance analysis workflows. Use {{.Target}} for the target system."
            currentValue={state.performancePrompt}
            defaultValue={promptDefaults.performancePrompt}
            onSave={(value) => savePrompt('performancePrompt', value)}
            testIdPrefix={testIds.appConfig.promptEditor.performance}
          />
        </FieldSet>
      )}

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
              { label: 'Left', value: 'left' as const },
              { label: 'Right', value: 'right' as const },
            ]}
            onChange={(value) => setState({ ...state, chatPanelPosition: value })}
          />
        </Field>

        <div className="mt-4">
          <Button
            onClick={() => {
              updatePluginAndReload(plugin.meta.id, {
                enabled,
                pinned,
                jsonData: {
                  ...jsonData,
                  kioskModeEnabled: state.kioskModeEnabled,
                  chatPanelPosition: state.chatPanelPosition,
                },
              });
            }}
            variant="primary"
            data-testid={testIds.appConfig.saveDisplaySettingsButton}
          >
            Save Display Settings
          </Button>
        </div>
      </FieldSet>
    </div>
  );
};

export default AppConfig;

const updatePluginAndReload = async (pluginId: string, data: Partial<PluginMeta<AppPluginSettings>>) => {
  try {
    await updatePlugin(pluginId, data);
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
