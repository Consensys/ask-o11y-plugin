import React, { ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { lastValueFrom } from 'rxjs';
import { AppPluginMeta, PluginConfigPageProps, PluginMeta } from '@grafana/data';
import { config, getBackendSrv } from '@grafana/runtime';
import {
  Alert,
  Badge,
  Button,
  Combobox,
  type ComboboxOption,
  Field,
  FieldSet,
  Icon,
  Input,
  RadioButtonGroup,
  Spinner,
  Switch,
  Tab,
  TabsBar,
} from '@grafana/ui';
import { mcp } from '@grafana/llm';
import { testIds } from '../testIds';
import { ValidationService } from '../../services/validation';
import { PromptEditor } from './PromptEditor';
import { ManageToolsModal } from './ManageToolsModal';
import { mcpServerStatusService, type MCPServerStatus, type MCPTool } from '../../services/mcpServerStatus';
import type { AppPluginSettings, MCPServerConfig } from '../../types/plugin';
import { AgentTopologyResponse, getAgentTopology } from '../../services/agentTopologyClient';
import { ServiceGraphScene } from '../ServiceGraph/ServiceGraphScene';

type ServerStatusKind = MCPServerStatus['status'];
type SettingsTab = 'general' | 'agent-runtime' | 'mcp' | 'service-graph' | 'prompts';
type MCPServerType = NonNullable<MCPServerConfig['type']>;

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
  serviceGraphMaxNodes: number;
  serviceGraphMaxEdges: number;
  approvalPolicy: string;
  maxParallelToolCalls: number;
  agentEvalCaptureEnabled: boolean;
};

type ValidationErrors = {
  maxTotalTokens?: string;
  mcpServers: { [id: string]: { name?: string; url?: string } };
};

export interface AppConfigProps extends PluginConfigPageProps<AppPluginMeta<AppPluginSettings>> {}

const PROMPT_DEFAULTS_URL = '/api/plugins/consensys-asko11y-app/resources/api/prompt-defaults';
const DEFAULT_MAX_TOTAL_TOKENS = 128000;
const MIN_TOTAL_TOKENS = 1000;
const MAX_TOTAL_TOKENS = 200000;
const BUILTIN_MCP_SERVER_ID = 'mcp-grafana';
const DEFAULT_SERVICE_GRAPH_MAX_NODES = 100;
const DEFAULT_SERVICE_GRAPH_MAX_EDGES = 200;
const SERVICE_GRAPH_MAX_NODES_LIMIT = 500;
const SERVICE_GRAPH_MAX_EDGES_LIMIT = 1000;
const DEFAULT_TOPOLOGY_QUERY = 'service topology dependencies incidents upstream downstream';
const SETTINGS_TAB_STORAGE_KEY = 'ask-o11y.settings.activeTab';

const SETTINGS_TABS: Array<{ id: SettingsTab; label: string; icon: React.ComponentProps<typeof Tab>['icon'] }> = [
  { id: 'general', label: 'General', icon: 'sliders-v-alt' },
  { id: 'agent-runtime', label: 'Agent Runtime', icon: 'ai' },
  { id: 'mcp', label: 'MCP', icon: 'plug' },
  { id: 'service-graph', label: 'Service Graph', icon: 'sitemap' },
  { id: 'prompts', label: 'Prompts', icon: 'comment-alt-message' },
];

const MCP_TYPE_OPTIONS: Array<ComboboxOption<MCPServerType>> = [
  { label: 'OpenAPI', value: 'openapi' },
  { label: 'Standard MCP', value: 'standard' },
  { label: 'SSE', value: 'sse' },
  { label: 'Streamable HTTP', value: 'streamable-http' },
];

const GRAPHITI_SCAN_INTERVAL_OPTIONS: Array<ComboboxOption<string>> = [
  { label: 'Off', value: 'off' },
  { label: 'Every 5 minutes', value: '5m' },
  { label: 'Every 15 minutes', value: '15m' },
  { label: 'Every 30 minutes', value: '30m' },
  { label: 'Every hour', value: '1h' },
  { label: 'Every 3 hours', value: '3h' },
  { label: 'Every 12 hours', value: '12h' },
  { label: 'Every 24 hours', value: '24h' },
];

type DirtyTabMap = Record<SettingsTab, boolean>;

const cleanObject = <T extends Record<string, unknown> | undefined>(value: T): Record<string, unknown> => {
  if (!value) {
    return {};
  }

  return Object.keys(value)
    .sort()
    .reduce<Record<string, unknown>>((acc, key) => {
      const nextValue = value[key];
      if (nextValue !== undefined) {
        acc[key] = nextValue;
      }
      return acc;
    }, {});
};

const stableStringify = (value: unknown): string =>
  JSON.stringify(value, (_key, currentValue) => {
    if (currentValue && typeof currentValue === 'object' && !Array.isArray(currentValue)) {
      return cleanObject(currentValue as Record<string, unknown>);
    }
    return currentValue;
  });

function normalizeMCPServersForDirty(settings: AppPluginSettings): unknown[] {
  const trustedServers = settings.trustedMCPServers ?? {};

  return (settings.mcpServers ?? []).map((server) => ({
    id: server.id,
    name: server.name,
    url: server.url,
    enabled: server.enabled,
    type: server.type || 'openapi',
    trusted: server.trusted ?? trustedServers[server.id] ?? false,
    headers: cleanObject(server.headers),
    toolSelections: cleanObject(server.toolSelections),
    riskOverrides: cleanObject(server.riskOverrides),
  }));
}

function getPromptValue(
  settings: AppPluginSettings,
  defaults: PromptDefaults | null,
  field: keyof PromptDefaults
): string {
  return settings[field] || defaults?.[field] || '';
}

function isSettingsTab(value: string | null): value is SettingsTab {
  return SETTINGS_TABS.some((tab) => tab.id === value);
}

function getInitialSettingsTab(): SettingsTab {
  if (typeof window === 'undefined') {
    return 'general';
  }

  const hashTab = window.location.hash.replace(/^#/, '');
  if (isSettingsTab(hashTab)) {
    return hashTab;
  }

  try {
    const storedTab = window.sessionStorage.getItem(SETTINGS_TAB_STORAGE_KEY);
    if (isSettingsTab(storedTab)) {
      return storedTab;
    }
  } catch {
    // Browser storage can be unavailable in private or embedded contexts.
  }

  return 'general';
}

function rememberSettingsTab(tab: SettingsTab) {
  const nextUrl = `${window.location.pathname}${window.location.search}#${tab}`;
  if (window.location.hash !== `#${tab}`) {
    window.history.replaceState(window.history.state, '', nextUrl);
  }

  try {
    window.sessionStorage.setItem(SETTINGS_TAB_STORAGE_KEY, tab);
  } catch {
    // Tab persistence is best-effort.
  }
}

const AppConfig = ({ plugin }: AppConfigProps) => {
  const { enabled, pinned, jsonData } = plugin.meta;
  const secureJsonFields: Record<string, boolean> =
    (plugin.meta as unknown as { secureJsonFields?: Record<string, boolean> }).secureJsonFields || {};
  const [promptDefaults, setPromptDefaults] = useState<PromptDefaults | null>(null);
  const [activeTab, setActiveTab] = useState<SettingsTab>(getInitialSettingsTab);
  const [savedJsonData, setSavedJsonData] = useState<AppPluginSettings>(jsonData ?? {});
  const [topology, setTopology] = useState<AgentTopologyResponse | null>(null);
  const [topologyLoading, setTopologyLoading] = useState(false);
  const [topologyError, setTopologyError] = useState<string | null>(null);
  const [state, setState] = useState<State>({
    maxTotalTokens: jsonData?.maxTotalTokens || DEFAULT_MAX_TOTAL_TOKENS,
    mcpServers: (jsonData?.mcpServers || []).map((server) => ({
      ...server,
      trusted: server.trusted ?? jsonData?.trustedMCPServers?.[server.id] ?? false,
    })),
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
    serviceGraphMaxNodes: jsonData?.serviceGraphMaxNodes || DEFAULT_SERVICE_GRAPH_MAX_NODES,
    serviceGraphMaxEdges: jsonData?.serviceGraphMaxEdges || DEFAULT_SERVICE_GRAPH_MAX_EDGES,
    approvalPolicy: jsonData?.approvalPolicy || 'approval-gated-writes',
    maxParallelToolCalls: jsonData?.maxParallelToolCalls || 4,
    agentEvalCaptureEnabled: jsonData?.agentEvalCaptureEnabled ?? false,
  });
  const [validationErrors, setValidationErrors] = useState<ValidationErrors>({
    mcpServers: {},
  });
  const [resetSecureKeys, setResetSecureKeys] = useState<Set<string>>(new Set());
  const [deletedSecureKeys, setDeletedSecureKeys] = useState<Set<string>>(new Set());
  const suppressBeforeUnloadRef = useRef(false);

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

  const isLLMSettingsDisabled = Boolean(
    !state.maxTotalTokens || state.maxTotalTokens < MIN_TOTAL_TOKENS || state.maxTotalTokens > MAX_TOTAL_TOKENS
  );
  const isAgentRuntimeDisabled = state.maxParallelToolCalls < 1 || state.maxParallelToolCalls > 16;
  const isServiceGraphSettingsDisabled =
    state.serviceGraphMaxNodes < 1 ||
    state.serviceGraphMaxNodes > SERVICE_GRAPH_MAX_NODES_LIMIT ||
    state.serviceGraphMaxEdges < 1 ||
    state.serviceGraphMaxEdges > SERVICE_GRAPH_MAX_EDGES_LIMIT;
  const orgId = String(config.bootData?.user?.orgId || '1');

  const dirtyTabs = useMemo<DirtyTabMap>(() => {
    const savedMCPSettings: AppPluginSettings = {
      mcpServers: savedJsonData.mcpServers,
      trustedMCPServers: savedJsonData.trustedMCPServers,
    };
    const currentMCPSettings: AppPluginSettings = {
      mcpServers: state.mcpServers,
      trustedMCPServers: state.mcpServers.reduce<Record<string, boolean>>((acc, server) => {
        if (server.trusted) {
          acc[server.id] = true;
        }
        return acc;
      }, {}),
    };

    const mcpDirty =
      state.useBuiltInMCP !== (savedJsonData.useBuiltInMCP ?? false) ||
      stableStringify(cleanObject(state.builtInMCPToolSelections)) !==
        stableStringify(cleanObject(savedJsonData.builtInMCPToolSelections)) ||
      stableStringify(normalizeMCPServersForDirty(currentMCPSettings)) !==
        stableStringify(normalizeMCPServersForDirty(savedMCPSettings)) ||
      resetSecureKeys.size > 0 ||
      deletedSecureKeys.size > 0;

    return {
      general:
        state.maxTotalTokens !== (savedJsonData.maxTotalTokens || DEFAULT_MAX_TOTAL_TOKENS) ||
        state.kioskModeEnabled !== (savedJsonData.kioskModeEnabled ?? true) ||
        state.chatPanelPosition !== (savedJsonData.chatPanelPosition || 'right'),
      'agent-runtime':
        state.approvalPolicy !== (savedJsonData.approvalPolicy || 'approval-gated-writes') ||
        state.maxParallelToolCalls !== (savedJsonData.maxParallelToolCalls || 4) ||
        state.agentEvalCaptureEnabled !== (savedJsonData.agentEvalCaptureEnabled ?? false),
      mcp: mcpDirty,
      'service-graph':
        state.graphitiScanInterval !== (savedJsonData.graphitiScanInterval || 'off') ||
        state.serviceGraphMaxNodes !== (savedJsonData.serviceGraphMaxNodes || DEFAULT_SERVICE_GRAPH_MAX_NODES) ||
        state.serviceGraphMaxEdges !== (savedJsonData.serviceGraphMaxEdges || DEFAULT_SERVICE_GRAPH_MAX_EDGES),
      prompts:
        state.defaultSystemPrompt !== getPromptValue(savedJsonData, promptDefaults, 'defaultSystemPrompt') ||
        state.investigationPrompt !== getPromptValue(savedJsonData, promptDefaults, 'investigationPrompt') ||
        state.performancePrompt !== getPromptValue(savedJsonData, promptDefaults, 'performancePrompt'),
    };
  }, [deletedSecureKeys, promptDefaults, resetSecureKeys, savedJsonData, state]);

  const hasUnsavedChanges = Object.values(dirtyTabs).some(Boolean);

  const loadTopology = useCallback(async () => {
    setTopologyLoading(true);
    setTopologyError(null);
    try {
      const nextTopology = await getAgentTopology(DEFAULT_TOPOLOGY_QUERY, orgId, {
        maxNodes: state.serviceGraphMaxNodes,
        maxEdges: state.serviceGraphMaxEdges,
      });
      setTopology(nextTopology);
    } catch (err) {
      setTopologyError(err instanceof Error ? err.message : 'Failed to load service graph');
    } finally {
      setTopologyLoading(false);
    }
  }, [orgId, state.serviceGraphMaxEdges, state.serviceGraphMaxNodes]);

  useEffect(() => {
    if (activeTab === 'service-graph' && !topology && !topologyLoading && !topologyError) {
      loadTopology();
    }
  }, [activeTab, loadTopology, topology, topologyError, topologyLoading]);

  useEffect(() => {
    rememberSettingsTab(activeTab);
  }, [activeTab]);

  useEffect(() => {
    if (!hasUnsavedChanges) {
      return;
    }

    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (suppressBeforeUnloadRef.current) {
        return;
      }
      event.preventDefault();
    };

    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [hasUnsavedChanges]);

  function activateSettingsTab(tab: SettingsTab) {
    rememberSettingsTab(tab);
    setActiveTab(tab);
  }

  const saveAndReload = useCallback(
    (data: PluginUpdatePayload) => {
      suppressBeforeUnloadRef.current = true;
      void updatePluginAndReload(plugin.meta.id, data).then((didReload) => {
        if (!didReload) {
          suppressBeforeUnloadRef.current = false;
        }
      });
    },
    [plugin.meta.id]
  );

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
    const nextBuiltInSelections = serverId === BUILTIN_MCP_SERVER_ID ? selections : state.builtInMCPToolSelections;
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
      ...savedJsonData,
      useBuiltInMCP: state.useBuiltInMCP,
      builtInMCPToolSelections: nextBuiltInSelections,
      mcpServers: nextServers,
      trustedMCPServers: nextServers.reduce<Record<string, boolean>>((acc, server) => {
        if (server.trusted) {
          acc[server.id] = true;
        }
        return acc;
      }, {}),
    };

    try {
      await updatePlugin(plugin.meta.id, { enabled, pinned, jsonData: nextJsonData });
      setSavedJsonData(nextJsonData);
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
    if (isServiceGraphSettingsDisabled) {
      return;
    }

    saveAndReload({
      enabled,
      pinned,
      jsonData: {
        ...savedJsonData,
        graphitiScanInterval: state.graphitiScanInterval,
        serviceGraphMaxNodes: state.serviceGraphMaxNodes,
        serviceGraphMaxEdges: state.serviceGraphMaxEdges,
      },
    });
  }

  async function onBuildKnowledgeGraph() {
    setState((prev) => ({
      ...prev,
      graphitiDiscovering: true,
      graphitiRunId: null,
      graphitiToolCount: 0,
      graphitiError: null,
    }));
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
    saveAndReload({
      enabled,
      pinned,
      jsonData: {
        ...savedJsonData,
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

    saveAndReload({
      enabled,
      pinned,
      jsonData: {
        ...savedJsonData,
        maxTotalTokens: state.maxTotalTokens,
      },
    });
  }

  function onSubmitAgentRuntimeSettings() {
    if (isAgentRuntimeDisabled) {
      return;
    }

    saveAndReload({
      enabled,
      pinned,
      jsonData: {
        ...savedJsonData,
        approvalPolicy: state.approvalPolicy,
        maxParallelToolCalls: state.maxParallelToolCalls,
        agentEvalCaptureEnabled: state.agentEvalCaptureEnabled,
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

    const trustedMCPServers = cleanedServers.reduce<Record<string, boolean>>((acc, server) => {
      if (server.trusted) {
        acc[server.id] = true;
      }
      return acc;
    }, {});

    const hasSecureChanges = Object.keys(secureJsonData).length > 0;
    saveAndReload({
      enabled,
      pinned,
      jsonData: {
        ...savedJsonData,
        mcpServers: cleanedServers,
        useBuiltInMCP: state.useBuiltInMCP,
        builtInMCPToolSelections: state.builtInMCPToolSelections,
        trustedMCPServers,
      },
      ...(hasSecureChanges ? { secureJsonData } : {}),
    });
  }

  const topologyServiceCount = topology?.nodes.filter((node) => node.type === 'service').length ?? 0;
  const topologyHasTypedNodes = topology ? topologyServiceCount !== topology.nodes.length : false;

  return (
    <div>
      <TabsBar>
        {SETTINGS_TABS.map((tab) => (
          <Tab
            key={tab.id}
            label={dirtyTabs[tab.id] ? `${tab.label} *` : tab.label}
            icon={tab.icon}
            active={activeTab === tab.id}
            tooltip={dirtyTabs[tab.id] ? 'Unsaved changes' : undefined}
            data-testid={testIds.appConfig.settingsTab(tab.id)}
            onChangeTab={(event) => {
              event.preventDefault();
              activateSettingsTab(tab.id);
            }}
          />
        ))}
      </TabsBar>

      {dirtyTabs[activeTab] && (
        <Alert
          severity="warning"
          title="Unsaved changes"
          className="mt-4"
          data-testid={testIds.appConfig.unsavedChangesNotice}
        >
          Save this tab&apos;s settings before leaving or reloading the page.
        </Alert>
      )}

      <div className="mt-4" data-testid={testIds.appConfig.settingsTabPanel(activeTab)}>
        {activeTab === 'general' && (
          <FieldSet label="LLM Settings">
            <Field
              label="Max Total Tokens"
              description={`Maximum prompt-plus-completion budget per LLM call (minimum: ${MIN_TOTAL_TOKENS}, maximum: ${MAX_TOTAL_TOKENS}, default: ${DEFAULT_MAX_TOTAL_TOKENS})`}
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
                min={MIN_TOTAL_TOKENS}
                max={MAX_TOTAL_TOKENS}
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
        )}

        {activeTab === 'agent-runtime' && (
          <FieldSet label="Agent Runtime">
            <Field
              label="Approval policy"
              description="Controls whether risky tool calls pause until the user approves them."
            >
              <RadioButtonGroup
                value={state.approvalPolicy}
                onChange={(value) => setState({ ...state, approvalPolicy: value })}
                options={[
                  { label: 'Gate writes and external actions', value: 'approval-gated-writes' },
                  { label: 'Disabled', value: 'off' },
                ]}
              />
            </Field>

            <Field
              label="Max parallel tool calls"
              description="Upper bound reserved for the agent scheduler. The current runtime keeps tool execution sequential when a provider serializes tool calls."
              className="mt-2"
              invalid={isAgentRuntimeDisabled}
              error={isAgentRuntimeDisabled ? 'Enter a value from 1 to 16' : undefined}
            >
              <Input
                width={20}
                name="maxParallelToolCalls"
                type="number"
                min={1}
                max={16}
                value={state.maxParallelToolCalls}
                onChange={onChange}
                invalid={isAgentRuntimeDisabled}
              />
            </Field>

            <Field
              label="Capture eval traces"
              description="Stores experimental eval inputs and scores when eval routes are enabled."
              className="mt-2"
            >
              <Switch
                value={state.agentEvalCaptureEnabled}
                onChange={(e) => setState({ ...state, agentEvalCaptureEnabled: e.currentTarget.checked })}
              />
            </Field>

            <div className="mt-3">
              <Button onClick={onSubmitAgentRuntimeSettings} disabled={isAgentRuntimeDisabled}>
                Save agent runtime
              </Button>
            </div>
          </FieldSet>
        )}

        {activeTab === 'mcp' && (
          <FieldSet label="MCP Servers">
            <p className="text-sm text-secondary mb-3">
              MCP (Model Context Protocol) servers provide tools the agent can call. The built-in Grafana MCP is bundled
              with the grafana-llm-app plugin; external servers extend the toolset.
            </p>

            {state.builtInMCPAvailable === false && (
              <Alert severity="warning" title="Built-in MCP unavailable" className="mb-3">
                The grafana-llm-app plugin is not installed or MCP is not enabled. To use the built-in Grafana MCP,
                install and configure grafana-llm-app.
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
                  <Combobox<MCPServerType>
                    value={(server.type || 'openapi') as MCPServerType}
                    onChange={(option) =>
                      updateMCPServer(server.id, {
                        type: option.value,
                      })
                    }
                    options={MCP_TYPE_OPTIONS}
                    width={30}
                  />
                </Field>

                <Field
                  label="Trusted MCP server"
                  description="Trust this server's MCP annotations for read-only/destructive/open-world risk signals."
                  className="mt-2"
                >
                  <Switch
                    value={server.trusted ?? false}
                    onChange={(e) => updateMCPServer(server.id, { trusted: e.currentTarget.checked })}
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
                        ({Object.keys(server.headers).length} header
                        {Object.keys(server.headers).length !== 1 ? 's' : ''})
                      </span>
                    )}
                  </button>
                </div>

                {state.expandedAdvanced.has(server.id) && (
                  <div className="mt-2 p-3 rounded bg-canvas border border-weak">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium">Custom Headers</span>
                      <span className="text-xs text-secondary">{Object.keys(server.headers || {}).length}/10</span>
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
                      const isConfigured = secureJsonFields[secureKey] && !resetSecureKeys.has(secureKey) && !value;
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
                                  onClick={() => setResetSecureKeys((prev) => new Set(prev).add(secureKey))}
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
                          {hasCollision && <span className="text-xs text-error mt-1 block">Duplicate key name</span>}
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
        )}

        {activeTab === 'prompts' && promptDefaults && (
          <FieldSet label="Prompt Templates">
            <p className="text-sm text-secondary mb-3">
              Customize the prompt templates used by the AI assistant. Templates use Go text/template syntax. Variables
              like {'{{.AlertName}}'} and {'{{.Target}}'} are replaced at runtime.
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

        {activeTab === 'prompts' && !promptDefaults && (
          <FieldSet label="Prompt Templates">
            <div className="flex items-center gap-2 text-secondary text-sm">
              <Spinner />
              <span>Loading prompt templates...</span>
            </div>
          </FieldSet>
        )}

        {activeTab === 'general' && (
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
                  saveAndReload({
                    enabled,
                    pinned,
                    jsonData: {
                      ...savedJsonData,
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
        )}

        {activeTab === 'service-graph' && (
          <FieldSet label="Service Graph">
            <p className="text-sm text-secondary mb-3">
              Graphiti-backed service topology is used as RCA context. The graph below is trimmed by backend-enforced
              limits before rendering in Grafana.
            </p>

            <Field
              label="Auto-scan interval"
              description="How often the Scout agent discovers services via MCP tools and updates the knowledge graph. Each scan covers the corresponding time window."
            >
              <Combobox<string>
                width={20}
                value={state.graphitiScanInterval}
                onChange={(option) => setState({ ...state, graphitiScanInterval: option.value })}
                options={GRAPHITI_SCAN_INTERVAL_OPTIONS}
              />
            </Field>

            <Field label="Graphiti connection status">
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
                  <Icon name="exclamation-triangle" /> Unreachable — ensure the graphiti MCP server is provisioned and
                  running
                </span>
              )}
            </Field>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Field
                label="Max graph nodes"
                description={`Backend-enforced node limit. Default ${DEFAULT_SERVICE_GRAPH_MAX_NODES}, maximum ${SERVICE_GRAPH_MAX_NODES_LIMIT}.`}
                invalid={state.serviceGraphMaxNodes < 1 || state.serviceGraphMaxNodes > SERVICE_GRAPH_MAX_NODES_LIMIT}
                error={`Enter a value from 1 to ${SERVICE_GRAPH_MAX_NODES_LIMIT}`}
              >
                <Input
                  width={20}
                  name="serviceGraphMaxNodes"
                  type="number"
                  min={1}
                  max={SERVICE_GRAPH_MAX_NODES_LIMIT}
                  value={state.serviceGraphMaxNodes}
                  onChange={onChange}
                  invalid={state.serviceGraphMaxNodes < 1 || state.serviceGraphMaxNodes > SERVICE_GRAPH_MAX_NODES_LIMIT}
                  data-testid={testIds.appConfig.serviceGraphMaxNodes}
                />
              </Field>

              <Field
                label="Max graph edges"
                description={`Backend-enforced edge limit. Default ${DEFAULT_SERVICE_GRAPH_MAX_EDGES}, maximum ${SERVICE_GRAPH_MAX_EDGES_LIMIT}.`}
                invalid={state.serviceGraphMaxEdges < 1 || state.serviceGraphMaxEdges > SERVICE_GRAPH_MAX_EDGES_LIMIT}
                error={`Enter a value from 1 to ${SERVICE_GRAPH_MAX_EDGES_LIMIT}`}
              >
                <Input
                  width={20}
                  name="serviceGraphMaxEdges"
                  type="number"
                  min={1}
                  max={SERVICE_GRAPH_MAX_EDGES_LIMIT}
                  value={state.serviceGraphMaxEdges}
                  onChange={onChange}
                  invalid={state.serviceGraphMaxEdges < 1 || state.serviceGraphMaxEdges > SERVICE_GRAPH_MAX_EDGES_LIMIT}
                  data-testid={testIds.appConfig.serviceGraphMaxEdges}
                />
              </Field>
            </div>

            <div className="mt-3 flex gap-2">
              <Button
                onClick={onSubmitGraphitiSettings}
                variant="primary"
                disabled={isServiceGraphSettingsDisabled}
                data-testid={testIds.appConfig.saveServiceGraphSettingsButton}
              >
                Save Service Graph settings
              </Button>

              <Button
                onClick={loadTopology}
                variant="secondary"
                disabled={topologyLoading || isServiceGraphSettingsDisabled}
                icon="sync"
                data-testid={testIds.appConfig.refreshServiceGraphButton}
              >
                Refresh graph
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
            {state.graphitiError && <div className="mt-2 text-error text-sm">{state.graphitiError}</div>}
            {!state.graphitiDiscovering && !state.graphitiError && state.graphitiToolCount > 0 && (
              <div className="mt-2 text-success text-sm">
                <Icon name="check" /> Build complete — {state.graphitiToolCount} tool calls processed
              </div>
            )}

            <div className="mt-4">
              {topology && (
                <div
                  className="mb-3 flex flex-wrap items-center gap-2"
                  data-testid={testIds.appConfig.serviceGraphSummary}
                >
                  <Badge text={topology.source} color="blue" />
                  <span className="text-sm text-secondary">{topologyServiceCount} services</span>
                  {topologyHasTypedNodes && (
                    <span className="text-sm text-secondary">{topology.nodes.length} nodes</span>
                  )}
                  <span className="text-sm text-secondary">{topology.edges.length} links</span>
                </div>
              )}

              {topologyError && (
                <Alert title="Could not load service graph" severity="error" className="mb-3">
                  {topologyError}
                </Alert>
              )}

              {topology?.warnings?.map((warning) => (
                <Alert key={warning} title="Topology warning" severity="warning" className="mb-3">
                  {warning}
                </Alert>
              ))}

              {topologyLoading && (
                <div className="flex items-center justify-center gap-2 p-6 border border-weak rounded">
                  <Spinner />
                  <span className="text-sm text-secondary">Loading topology from Graphiti memory...</span>
                </div>
              )}

              {!topologyLoading && topology && <ServiceGraphScene topology={topology} height={460} />}
            </div>
          </FieldSet>
        )}
      </div>

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

const updatePluginAndReload = async (pluginId: string, data: PluginUpdatePayload): Promise<boolean> => {
  try {
    await updatePlugin(pluginId, data);
    window.location.reload();
    return true;
  } catch {
    // Plugin update failed; reload did not occur so the user remains on the config page
    return false;
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
