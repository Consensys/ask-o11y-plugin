import React, { ChangeEvent, useEffect, useRef, useState } from 'react';
import { lastValueFrom } from 'rxjs';
import { AppPluginMeta, PluginConfigPageProps, PluginMeta } from '@grafana/data';
import { getBackendSrv } from '@grafana/runtime';
import { Button, Field, FieldSet, Input, Icon, Switch, Alert, RadioButtonGroup, Select } from '@grafana/ui';
import { mcp } from '@grafana/llm';
import { testIds } from '../testIds';
import { ValidationService } from '../../services/validation';
import { PromptEditor } from './PromptEditor';
import { ManageToolsModal } from './ManageToolsModal';
import { mcpServerStatusService, type MCPServerStatus, type MCPTool } from '../../services/mcpServerStatus';
import type { AppPluginSettings, MCPServerConfig } from '../../types/plugin';

type ServerStatusKind = MCPServerStatus['status'];

const STATUS_LABELS: Record<ServerStatusKind, string> = {
  healthy: 'Healthy',
  degraded: 'Degraded',
  unhealthy: 'Unhealthy',
  disconnected: 'Disconnected',
  connecting: 'Connecting',
};

const STATUS_BADGE_CLASSES: Record<ServerStatusKind, string> = {
  healthy: 'bg-success text-success-text',
  degraded: 'bg-warning text-warning-text',
  unhealthy: 'bg-error text-error-text',
  disconnected: 'bg-error text-error-text',
  connecting: 'bg-info text-info-text',
};

function StatusBadge({ status }: { status?: ServerStatusKind }) {
  if (!status) {
    return <span className="text-xs text-secondary">Status unknown</span>;
  }
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${STATUS_BADGE_CLASSES[status]}`}>
      {STATUS_LABELS[status]}
    </span>
  );
}

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
  builtInMCPToolSelections: Record<string, boolean>;
  expandedAdvanced: Set<string>;
  kioskModeEnabled: boolean;
  chatPanelPosition: 'left' | 'right';
  defaultSystemPrompt: string;
  investigationPrompt: string;
  performancePrompt: string;
  graphitiScanInterval: string;
  graphitiConnected: boolean | null;
  graphitiDiscovering: boolean;
  graphitiRunId: string | null;
  graphitiToolCount: number;
  graphitiError: string | null;
};

type ValidationErrors = {
  maxTotalTokens?: string;
  mcpServers: { [id: string]: { name?: string; url?: string } };
};

export interface AppConfigProps extends PluginConfigPageProps<AppPluginMeta<AppPluginSettings>> {}

const PROMPT_DEFAULTS_URL = '/api/plugins/consensys-asko11y-app/resources/api/prompt-defaults';
const DEFAULT_MAX_TOTAL_TOKENS = 128000;
const BUILTIN_MCP_SERVER_ID = 'mcp-grafana';

const AppConfig = ({ plugin }: AppConfigProps) => {
  const { enabled, pinned, jsonData } = plugin.meta;
  const secureJsonFields: Record<string, boolean> =
    (plugin.meta as unknown as { secureJsonFields?: Record<string, boolean> }).secureJsonFields || {};
  const [promptDefaults, setPromptDefaults] = useState<PromptDefaults | null>(null);
  const [state, setState] = useState<State>({
    maxTotalTokens: jsonData?.maxTotalTokens || DEFAULT_MAX_TOTAL_TOKENS,
    mcpServers: jsonData?.mcpServers || [],
    useBuiltInMCP: jsonData?.useBuiltInMCP ?? false,
    builtInMCPAvailable: null,
    builtInMCPToolSelections: jsonData?.builtInMCPToolSelections ?? {},
    expandedAdvanced: new Set<string>(),
    kioskModeEnabled: jsonData?.kioskModeEnabled ?? true,
    chatPanelPosition: jsonData?.chatPanelPosition || 'right',
    defaultSystemPrompt: jsonData?.defaultSystemPrompt || '',
    investigationPrompt: jsonData?.investigationPrompt || '',
    performancePrompt: jsonData?.performancePrompt || '',
    graphitiScanInterval: jsonData?.graphitiScanInterval || 'off',
    graphitiConnected: null,
    graphitiDiscovering: false,
    graphitiRunId: null,
    graphitiToolCount: 0,
    graphitiError: null,
  });
  const [validationErrors, setValidationErrors] = useState<ValidationErrors>({
    mcpServers: {},
  });
  const [resetSecureKeys, setResetSecureKeys] = useState<Set<string>>(new Set());
  const [deletedSecureKeys, setDeletedSecureKeys] = useState<Set<string>>(new Set());

  // Manage Tools modal state
  const [modalServerId, setModalServerId] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [serverTools, setServerTools] = useState<MCPTool[]>([]);
  const [serverToolsLoading, setServerToolsLoading] = useState(false);

  // Per-server health status, keyed by serverId. Refreshed on mount and periodically.
  const [serverStatuses, setServerStatuses] = useState<Record<string, ServerStatusKind>>({});

  useEffect(() => {
    let cancelled = false;
    const fetchStatuses = async () => {
      try {
        const response = await mcpServerStatusService.fetchServerStatuses();
        if (cancelled) {
          return;
        }
        const next: Record<string, ServerStatusKind> = {};
        for (const s of response.servers) {
          next[s.serverId] = s.status;
        }
        setServerStatuses(next);
      } catch {
        // status fetch is best-effort; UI shows "Status unknown"
      }
    };
    fetchStatuses();
    const id = window.setInterval(fetchStatuses, 15000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

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
    const server = state.mcpServers.find((s) => s.id === id);
    if (server?.headers) {
      const keysToDelete = new Set(deletedSecureKeys);
      for (const headerKey of Object.keys(server.headers)) {
        const cleanKey = normalizeHeaderKey(headerKey);
        if (cleanKey && !cleanKey.startsWith('__new_header_')) {
          keysToDelete.add(`mcpServerHeader.${id}.${cleanKey}`);
        }
      }
      setDeletedSecureKeys(keysToDelete);
    }
    setState({
      ...state,
      mcpServers: state.mcpServers.filter((s) => s.id !== id),
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

    if (oldKey !== finalKey) {
      const oldCleanKey = normalizeHeaderKey(oldKey);
      if (oldCleanKey && !oldCleanKey.startsWith('__new_header_')) {
        const oldSecureKey = `mcpServerHeader.${serverId}.${oldCleanKey}`;
        if (secureJsonFields[oldSecureKey]) {
          setDeletedSecureKeys((prev) => new Set(prev).add(oldSecureKey));
        }
      }
    }

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

    const cleanKey = normalizeHeaderKey(key);
    const secureKey = `mcpServerHeader.${serverId}.${cleanKey}`;
    if (secureJsonFields[secureKey]) {
      setDeletedSecureKeys((prev) => new Set(prev).add(secureKey));
    }

    const currentHeaders = { ...(server.headers || {}) };
    delete currentHeaders[key];

    updateMCPServer(serverId, { headers: currentHeaders });
  }

  async function openManageTools(serverId: string) {
    setServerTools([]);
    setServerToolsLoading(true);
    setModalServerId(serverId);
    setModalOpen(true);
    try {
      const response = await mcpServerStatusService.fetchServerStatuses();
      const statusInfo = response.servers.find((s) => s.serverId === serverId);
      setServerTools(statusInfo?.tools ?? []);
    } catch {
      setServerTools([]);
    } finally {
      setServerToolsLoading(false);
    }
  }

  async function handleSaveToolSelections(serverId: string, selections: Record<string, boolean>) {
    const nextBuiltInSelections =
      serverId === BUILTIN_MCP_SERVER_ID ? selections : state.builtInMCPToolSelections;
    const nextServers =
      serverId === BUILTIN_MCP_SERVER_ID
        ? state.mcpServers
        : state.mcpServers.map((s) => (s.id === serverId ? { ...s, toolSelections: selections } : s));

    setState((prev) => ({
      ...prev,
      builtInMCPToolSelections: nextBuiltInSelections,
      mcpServers: nextServers,
    }));
    setModalOpen(false);
    setModalServerId(null);

    // Persist all MCP-related fields from the latest local state so successive
    // Apply calls don't overwrite each other's prior changes via stale jsonData.
    const nextJsonData: AppPluginSettings = {
      ...jsonData,
      useBuiltInMCP: state.useBuiltInMCP,
      builtInMCPToolSelections: nextBuiltInSelections,
      mcpServers: nextServers,
    };

    try {
      await updatePlugin(plugin.meta.id, { enabled, pinned, jsonData: nextJsonData });
    } catch {
      // Persist error: local state already updated; user can retry via the main Save button.
    }
  }

  useEffect(() => {
    setState((prev) => ({ ...prev, graphitiConnected: null }));
    lastValueFrom(
      getBackendSrv().fetch<{ connected: boolean }>({
        url: `/api/plugins/consensys-asko11y-app/resources/api/graphiti/status`,
      })
    )
      .then((res) => setState((prev) => ({ ...prev, graphitiConnected: res.data.connected })))
      .catch(() => setState((prev) => ({ ...prev, graphitiConnected: false })));
  }, []);

  useEffect(() => {
    if (!state.graphitiRunId) {
      return;
    }
    const runId = state.graphitiRunId;
    const interval = setInterval(async () => {
      try {
        const res = await lastValueFrom(
          getBackendSrv().fetch<{ status: string; events?: Array<{ type: string }> }>({
            url: `/api/plugins/consensys-asko11y-app/resources/api/agent/runs/${runId}`,
          })
        );
        const { status, events = [] } = res.data;
        const toolCount = events.filter((e) => e.type === 'tool_call_result').length;
        if (status === 'running') {
          setState((prev) => ({ ...prev, graphitiToolCount: toolCount }));
        } else {
          clearInterval(interval);
          setState((prev) => ({
            ...prev,
            graphitiDiscovering: false,
            graphitiRunId: null,
            graphitiToolCount: toolCount,
            graphitiError: status === 'failed' ? 'Discovery run failed' : null,
          }));
        }
      } catch {
        clearInterval(interval);
        setState((prev) => ({ ...prev, graphitiDiscovering: false, graphitiError: 'Failed to poll discovery status' }));
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [state.graphitiRunId]);

  function onSubmitGraphitiSettings() {
    updatePluginAndReload(plugin.meta.id, {
      enabled,
      pinned,
      jsonData: {
        ...jsonData,
        graphitiScanInterval: state.graphitiScanInterval,
      },
    });
  }

  async function onBuildKnowledgeGraph() {
    setState((prev) => ({ ...prev, graphitiDiscovering: true, graphitiRunId: null, graphitiToolCount: 0, graphitiError: null }));
    try {
      const res = await lastValueFrom(
        getBackendSrv().fetch<{ runId: string; status: string }>({
          url: `/api/plugins/consensys-asko11y-app/resources/api/graphiti/discover`,
          method: 'POST',
          data: {},
        })
      );
      setState((prev) => ({ ...prev, graphitiRunId: res.data.runId }));
    } catch (err) {
      setState((prev) => ({
        ...prev,
        graphitiDiscovering: false,
        graphitiError: err instanceof Error ? err.message : 'Discovery run failed',
      }));
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

    const secureJsonData: Record<string, string> = {};

    const cleanedServers = state.mcpServers.map((server) => {
      if (!server.headers) {
        return server;
      }

      const headerKeys: Record<string, string> = {};
      for (const [key, value] of Object.entries(server.headers)) {
        let cleanKey = key.trim();
        if (!cleanKey || cleanKey.startsWith('__new_header_')) {
          continue;
        }
        if (cleanKey.includes('__collision_')) {
          cleanKey = cleanKey.split('__collision_')[0].trim();
        }
        headerKeys[cleanKey] = '';
        const secureKey = `mcpServerHeader.${server.id}.${cleanKey}`;
        if (value) {
          secureJsonData[secureKey] = value;
        } else if (resetSecureKeys.has(secureKey)) {
          secureJsonData[secureKey] = '';
        }
      }

      return {
        ...server,
        headers: Object.keys(headerKeys).length > 0 ? headerKeys : undefined,
      };
    });

    for (const key of deletedSecureKeys) {
      if (!(key in secureJsonData)) {
        secureJsonData[key] = '';
      }
    }

    const hasSecureChanges = Object.keys(secureJsonData).length > 0;
    updatePluginAndReload(plugin.meta.id, {
      enabled,
      pinned,
      jsonData: {
        ...jsonData,
        mcpServers: cleanedServers,
        useBuiltInMCP: state.useBuiltInMCP,
        builtInMCPToolSelections: state.builtInMCPToolSelections,
      },
      ...(hasSecureChanges ? { secureJsonData } : {}),
    });
  }

  return (
    <div>
      <FieldSet label="LLM Settings">
        <Field
          label="Max Total Tokens"
          description="Maximum prompt-plus-completion budget per LLM call (minimum: 1000, default: 128000, recommended: 20000-128000)"
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
            placeholder={String(DEFAULT_MAX_TOTAL_TOKENS)}
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

      <FieldSet label="MCP Servers" className="mt-4">
        <p className="text-sm text-secondary mb-3">
          MCP (Model Context Protocol) servers provide tools the agent can call. The built-in Grafana MCP is bundled
          with the grafana-llm-app plugin; external servers extend the toolset.
        </p>

        {state.builtInMCPAvailable === false && (
          <Alert severity="warning" title="Built-in MCP unavailable" className="mb-3">
            The grafana-llm-app plugin is not installed or MCP is not enabled. To use the built-in Grafana MCP, install
            and configure grafana-llm-app.
          </Alert>
        )}

        <div
          data-testid={testIds.appConfig.mcpServerCard(BUILTIN_MCP_SERVER_ID)}
          className="p-4 mb-3 rounded border border-medium bg-secondary"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 min-w-0">
              <Icon name="plug" />
              <span className="font-medium">Grafana Built-in MCP</span>
              <StatusBadge status={serverStatuses[BUILTIN_MCP_SERVER_ID]} />
            </div>
            <div className="flex items-center gap-2">
              <Switch
                value={state.useBuiltInMCP}
                onChange={(e) => {
                  const checked = (e.currentTarget ?? e.target)?.checked ?? false;
                  setState((prev) => ({ ...prev, useBuiltInMCP: checked }));
                }}
                disabled={state.builtInMCPAvailable === false}
                data-testid={testIds.appConfig.useBuiltInMCPToggle}
              />
              <Button
                variant="secondary"
                size="sm"
                icon="wrench"
                onClick={() => openManageTools(BUILTIN_MCP_SERVER_ID)}
                disabled={!state.useBuiltInMCP || state.builtInMCPAvailable === false}
                data-testid={testIds.appConfig.manageToolsButton(BUILTIN_MCP_SERVER_ID)}
              >
                Tools
              </Button>
            </div>
          </div>
        </div>

        {state.mcpServers.map((server) => (
          <div
            key={server.id}
            data-testid={testIds.appConfig.mcpServerCard(server.id)}
            className="p-4 mb-3 rounded border border-medium bg-secondary"
          >
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2 min-w-0">
                <Icon name="plug" />
                <span className="font-medium">{server.name || 'Unnamed Server'}</span>
                <StatusBadge status={serverStatuses[server.id]} />
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  value={server.enabled}
                  onChange={(e) => updateMCPServer(server.id, { enabled: e.currentTarget.checked })}
                />
                <Button
                  variant="secondary"
                  size="sm"
                  icon="wrench"
                  onClick={() => openManageTools(server.id)}
                  data-testid={testIds.appConfig.manageToolsButton(server.id)}
                >
                  Tools
                </Button>
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
              <Select
                value={server.type || 'openapi'}
                onChange={(v) =>
                  updateMCPServer(server.id, {
                    type: v.value as 'openapi' | 'standard' | 'sse' | 'streamable-http',
                  })
                }
                options={[
                  { label: 'OpenAPI', value: 'openapi' },
                  { label: 'Standard MCP', value: 'standard' },
                  { label: 'SSE', value: 'sse' },
                  { label: 'Streamable HTTP', value: 'streamable-http' },
                ]}
                width={30}
              />
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
                  const cleanKey = normalizeHeaderKey(key);
                  const secureKey = `mcpServerHeader.${server.id}.${cleanKey}`;
                  const isConfigured =
                    secureJsonFields[secureKey] && !resetSecureKeys.has(secureKey) && !value;
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
                        {isConfigured ? (
                          <>
                            <Input
                              width={30}
                              value=""
                              placeholder="Configured"
                              disabled
                              type="password"
                              data-testid={testIds.appConfig.mcpServerHeaderValueInput(server.id, index)}
                            />
                            <Button
                              variant="secondary"
                              size="sm"
                              icon="edit"
                              onClick={() =>
                                setResetSecureKeys((prev) => new Set(prev).add(secureKey))
                              }
                              aria-label="Reset header value"
                            />
                          </>
                        ) : (
                          <Input
                            width={30}
                            value={value}
                            placeholder="Header value"
                            type="password"
                            onChange={(e) => updateHeader(server.id, key, key, e.currentTarget.value)}
                            data-testid={testIds.appConfig.mcpServerHeaderValueInput(server.id, index)}
                          />
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
            Save MCP Servers
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

      <FieldSet label="Knowledge Graph" className="mt-4">
        <p className="text-sm text-secondary mb-3">
          Graphiti knowledge graph integration is configured via the MCP server provisioning. The agent uses
          read-only graph tools during regular sessions; Scout and discover sessions can also write to the graph.
        </p>

        <Field
          label="Auto-scan interval"
          description="How often the Scout agent discovers services via MCP tools and updates the knowledge graph. Each scan covers the corresponding time window."
        >
          <Select
            width={20}
            value={state.graphitiScanInterval}
            onChange={(v) => setState({ ...state, graphitiScanInterval: v.value ?? 'off' })}
            options={[
              { label: 'Off', value: 'off' },
              { label: 'Every 5 minutes', value: '5m' },
              { label: 'Every 15 minutes', value: '15m' },
              { label: 'Every 30 minutes', value: '30m' },
              { label: 'Every hour', value: '1h' },
              { label: 'Every 3 hours', value: '3h' },
              { label: 'Every 12 hours', value: '12h' },
              { label: 'Every 24 hours', value: '24h' },
            ]}
          />
        </Field>

        <Field label="Status">
          {state.graphitiConnected === null ? (
            <span className="text-secondary text-sm">
              <Icon name="fa fa-spinner" /> Checking…
            </span>
          ) : state.graphitiConnected ? (
            <span className="text-success text-sm">
              <Icon name="check-circle" /> Connected
            </span>
          ) : (
            <span className="text-error text-sm">
              <Icon name="exclamation-triangle" /> Unreachable — ensure the graphiti MCP server is provisioned and running
            </span>
          )}
        </Field>

        <div className="mt-3 flex gap-2">
          <Button onClick={onSubmitGraphitiSettings} variant="primary">
            Save Knowledge Graph settings
          </Button>

          <Button
            onClick={onBuildKnowledgeGraph}
            variant="secondary"
            disabled={state.graphitiDiscovering || !state.graphitiConnected}
            icon={state.graphitiDiscovering ? 'fa fa-spinner' : 'database'}
          >
            {state.graphitiDiscovering
              ? `Building… (${state.graphitiToolCount} tool calls)`
              : 'Build Knowledge Graph'}
          </Button>
        </div>
        {state.graphitiError && (
          <div className="mt-2 text-error text-sm">{state.graphitiError}</div>
        )}
        {!state.graphitiDiscovering && !state.graphitiError && state.graphitiToolCount > 0 && (
          <div className="mt-2 text-success text-sm">
            <Icon name="check" /> Build complete — {state.graphitiToolCount} tool calls processed
          </div>
        )}
      </FieldSet>

      {modalServerId && (
        <ManageToolsModal
          key={modalServerId}
          serverId={modalServerId}
          serverName={
            modalServerId === BUILTIN_MCP_SERVER_ID
              ? 'Grafana Built-in MCP'
              : state.mcpServers.find((s) => s.id === modalServerId)?.name || modalServerId
          }
          tools={serverTools}
          loading={serverToolsLoading}
          serverEnabled={
            modalServerId === BUILTIN_MCP_SERVER_ID
              ? state.useBuiltInMCP
              : state.mcpServers.find((s) => s.id === modalServerId)?.enabled ?? true
          }
          currentSelections={
            modalServerId === BUILTIN_MCP_SERVER_ID
              ? state.builtInMCPToolSelections
              : state.mcpServers.find((s) => s.id === modalServerId)?.toolSelections
          }
          isOpen={modalOpen}
          onDismiss={() => {
            setModalOpen(false);
            setModalServerId(null);
          }}
          onSave={handleSaveToolSelections}
        />
      )}
    </div>
  );
};

export default AppConfig;

interface PluginUpdatePayload extends Partial<PluginMeta<AppPluginSettings>> {
  secureJsonData?: Record<string, string>;
}

const updatePluginAndReload = async (pluginId: string, data: PluginUpdatePayload) => {
  try {
    await updatePlugin(pluginId, data);
    window.location.reload();
  } catch {
    // Plugin update failed; reload did not occur so the user remains on the config page
  }
};

const updatePlugin = async (pluginId: string, data: PluginUpdatePayload) => {
  const response = await getBackendSrv().fetch({
    url: `/api/plugins/${pluginId}/settings`,
    method: 'POST',
    data,
  });

  return lastValueFrom(response);
};
