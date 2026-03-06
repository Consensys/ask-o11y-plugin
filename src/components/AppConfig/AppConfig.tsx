import React, { ChangeEvent, useEffect, useState } from 'react';
import { lastValueFrom } from 'rxjs';
import { AppPluginMeta, PluginConfigPageProps, PluginMeta } from '@grafana/data';
import { getBackendSrv } from '@grafana/runtime';
import { Button, Field, FieldSet, Input, Icon, Switch, Alert, RadioButtonGroup, Tooltip } from '@grafana/ui';
import { mcp } from '@grafana/llm';
import { testIds } from '../testIds';
import { ValidationService } from '../../services/validation';
import { PromptEditor } from './PromptEditor';
import { MCPServerModal } from './MCPServerModal';
import type { AppPluginSettings, MCPServerConfig } from '../../types/plugin';

interface PromptDefaults {
  defaultSystemPrompt: string;
  investigationPrompt: string;
  performancePrompt: string;
}

type State = {
  maxTotalTokens: number;
  mcpServers: MCPServerConfig[];
  useBuiltInMCP: boolean;
  builtInMCPAvailable: boolean | null;
  editingServer: MCPServerConfig | null;
  isModalOpen: boolean;
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

const getServerHeadersSecureFieldKey = (serverId: string) => `${serverId}__headers`;

const hydrateMCPServers = (
  mcpServers: MCPServerConfig[] | undefined,
  secureJsonFields?: Record<string, boolean>
): MCPServerConfig[] => {
  return (mcpServers || []).map((server) => ({
    ...server,
    hasSecureHeaders:
      Boolean(server.headers && Object.keys(server.headers).length > 0) ||
      Boolean(secureJsonFields?.[getServerHeadersSecureFieldKey(server.id)]),
  }));
};

const AppConfig = ({ plugin }: AppConfigProps) => {
  const { enabled, pinned, jsonData, secureJsonFields } = plugin.meta;
  const [promptDefaults, setPromptDefaults] = useState<PromptDefaults | null>(null);
  const [state, setState] = useState<State>({
    maxTotalTokens: jsonData?.maxTotalTokens || 180000,
    mcpServers: hydrateMCPServers(jsonData?.mcpServers, secureJsonFields),
    useBuiltInMCP: jsonData?.useBuiltInMCP ?? false,
    builtInMCPAvailable: null,
    editingServer: null,
    isModalOpen: false,
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

  function openEditModal(server: MCPServerConfig) {
    setState({
      ...state,
      editingServer: server,
      isModalOpen: true,
    });
  }

  function openAddModal() {
    setState({
      ...state,
      editingServer: null,
      isModalOpen: true,
    });
  }

  function closeModal() {
    setState({
      ...state,
      editingServer: null,
      isModalOpen: false,
    });
  }

  function handleSaveServer(updatedServer: MCPServerConfig) {
    const serverIndex = state.mcpServers.findIndex((s) => s.id === updatedServer.id);
    const existingServer = serverIndex >= 0 ? state.mcpServers[serverIndex] : undefined;
    const hasVisibleHeaders = Boolean(updatedServer.headers && Object.keys(updatedServer.headers).length > 0);
    const hasOpaqueSecureHeaders = Boolean(
      existingServer?.hasSecureHeaders && !existingServer.headers && !updatedServer.headers
    );
    const serverWithSecureState: MCPServerConfig = {
      ...updatedServer,
      hasSecureHeaders: hasVisibleHeaders || hasOpaqueSecureHeaders,
    };

    if (serverIndex >= 0) {
      // Update existing server
      const updatedServers = [...state.mcpServers];
      updatedServers[serverIndex] = serverWithSecureState;
      setState({
        ...state,
        mcpServers: updatedServers,
        editingServer: null,
        isModalOpen: false,
      });
    } else {
      // Add new server
      setState({
        ...state,
        mcpServers: [...state.mcpServers, serverWithSecureState],
        editingServer: null,
        isModalOpen: false,
      });
    }
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

    // Separate headers from server configs
    const publicConfigs = state.mcpServers.map((server) => ({
      id: server.id,
      name: server.name,
      url: server.url,
      enabled: server.enabled,
      type: server.type,
    }));

    // Build secureJsonData with headers
    const secureData: Record<string, string> = {};
    for (const server of state.mcpServers) {
      if (server.headers && Object.keys(server.headers).length > 0) {
        secureData[getServerHeadersSecureFieldKey(server.id)] = JSON.stringify(server.headers);
      }
    }

    const payload: Partial<PluginMeta<AppPluginSettings>> = {
      enabled,
      pinned,
      jsonData: {
        ...jsonData,
        mcpServers: publicConfigs,
      },
    };

    if (Object.keys(secureData).length > 0) {
      payload.secureJsonData = secureData;
    }

    updatePluginAndReload(plugin.meta.id, payload);
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

        {state.mcpServers.length > 0 && (
          <div className="mb-3">
            <table className="w-full border-collapse" style={{ width: '100%' }}>
              <thead>
                <tr className="border-b border-medium">
                  <th className="text-left py-2 px-2 text-sm font-medium" style={{ width: '80px' }}>
                    Status
                  </th>
                  <th className="text-left py-2 px-2 text-sm font-medium" style={{ width: '200px' }}>
                    Name
                  </th>
                  <th className="text-left py-2 px-2 text-sm font-medium">URL</th>
                  <th className="text-left py-2 px-2 text-sm font-medium" style={{ width: '150px' }}>
                    Type
                  </th>
                  <th className="text-left py-2 px-2 text-sm font-medium" style={{ width: '150px' }}>
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {state.mcpServers.map((server) => {
                  const hasHeaders = Boolean(
                    server.hasSecureHeaders || (server.headers && Object.keys(server.headers).length > 0)
                  );
                  const truncatedUrl = server.url.length > 50 ? `${server.url.substring(0, 47)}...` : server.url;

                  return (
                    <tr key={server.id} className="border-b border-weak" data-testid={testIds.appConfig.mcpServerCard(server.id)}>
                      <td className="py-2 px-2">
                        <Switch
                          value={server.enabled}
                          onChange={(e) => updateMCPServer(server.id, { enabled: e.currentTarget.checked })}
                          data-testid={`mcp-server-status-${server.id}`}
                        />
                      </td>
                      <td className="py-2 px-2 text-sm">
                        <div className="flex items-center gap-1">
                          <Icon name="plug" size="sm" />
                          <span>{server.name || 'Unnamed Server'}</span>
                        </div>
                      </td>
                      <td className="py-2 px-2 text-sm">
                        <Tooltip content={server.url}>
                          <span>{truncatedUrl}</span>
                        </Tooltip>
                      </td>
                      <td className="py-2 px-2 text-sm">{server.type || 'openapi'}</td>
                      <td className="py-2 px-2">
                        <div className="flex items-center gap-1">
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => openEditModal(server)}
                            data-testid={`mcp-server-edit-${server.id}`}
                          >
                            Edit
                          </Button>
                          {hasHeaders && (
                            <Tooltip content="This server has headers configured">
                              <Icon name="lock" size="sm" className="text-warning" />
                            </Tooltip>
                          )}
                          <Button
                            variant="secondary"
                            size="sm"
                            icon="trash-alt"
                            onClick={() => removeMCPServer(server.id)}
                            data-testid={testIds.appConfig.mcpServerRemoveButton(server.id)}
                            aria-label="Remove server"
                          />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <Button
          variant="secondary"
          icon="plus"
          onClick={openAddModal}
          data-testid={testIds.appConfig.addMcpServerButton}
        >
          Add MCP Server
        </Button>

        <MCPServerModal
          server={state.editingServer}
          isOpen={state.isModalOpen}
          onClose={closeModal}
          onSave={handleSaveServer}
        />

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
