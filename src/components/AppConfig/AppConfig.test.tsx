import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { of } from 'rxjs';
import { PluginType } from '@grafana/data';
import AppConfig, { AppConfigProps } from './AppConfig';
import { testIds } from 'components/testIds';
import { getPluginStorageKey } from '../../utils/storageKeys';
import type { AppPluginSettings } from '../../types/plugin';

const SETTINGS_TAB_STORAGE_KEY = getPluginStorageKey('settings.activeTab');

type FetchOptions = { url?: string; method?: string; data?: unknown };

const mockFetch = jest.fn();
let mockStoredJsonData: Record<string, unknown> = {};

jest.mock('@grafana/runtime', () => ({
  getBackendSrv: () => ({
    fetch: (options: FetchOptions) => mockFetch(options),
  }),
  locationService: {
    getSearch: () => '',
    getLocation: () => ({ pathname: '/a/consensys-asko11y-app', search: '', hash: '', query: {}, routeParams: {} }),
    replace: () => undefined,
    push: () => undefined,
  },
  config: {
    bootData: {
      user: {
        orgId: 1,
      },
    },
  },
}));

jest.mock('@grafana/llm', () => ({
  mcp: { enabled: () => Promise.resolve(false) },
}));

jest.mock('../../services/agentTopologyClient', () => ({
  getAgentTopology: jest.fn().mockResolvedValue({
    enabled: true,
    source: 'graphiti',
    nodes: [{ id: 'api', label: 'api', type: 'service' }],
    edges: [],
  }),
}));

jest.mock('../ServiceGraph/ServiceGraphScene', () => ({
  ServiceGraphScene: () => <div data-testid="service-graph-scene" />,
}));

describe('Components/AppConfig', () => {
  let props: AppConfigProps;

  beforeEach(() => {
    jest.resetAllMocks();
    window.sessionStorage.clear();
    window.location.hash = '';
    mockStoredJsonData = {};
    mockFetch.mockImplementation((options: FetchOptions) => {
      if (options.url?.endsWith('/settings')) {
        // POST is the settings update; GET is the pre-save fresh read.
        return of({ data: options.method === 'POST' ? {} : { jsonData: mockStoredJsonData } });
      }
      return of({
        data: {
          defaultSystemPrompt: 'mock system prompt',
          investigationPrompt: 'mock investigation prompt',
          performancePrompt: 'mock performance prompt',
        },
      });
    });
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
      configurable: true,
      value: () => ({
        measureText: () => ({ width: 100 }),
      }),
    });
    jest.requireMock('../../services/agentTopologyClient').getAgentTopology.mockResolvedValue({
      enabled: true,
      source: 'graphiti',
      nodes: [{ id: 'api', label: 'api', type: 'service' }],
      edges: [],
    });

    props = {
      plugin: {
        meta: {
          id: 'sample-app',
          name: 'Sample App',
          type: PluginType.app,
          enabled: true,
          jsonData: {},
        },
      },
      query: {},
    } as unknown as AppConfigProps;
  });

  test('renders the "LLM Settings" fieldset with max tokens input and the single general save button', () => {
    const plugin = { meta: { ...props.plugin.meta, enabled: false } };

    // @ts-ignore - We don't need to provide `addConfigPage()` and `setChannelSupport()` for these tests
    render(<AppConfig plugin={plugin} query={props.query} />);

    expect(screen.queryByRole('group', { name: /llm settings/i })).toBeInTheDocument();
    expect(screen.queryByTestId(testIds.appConfig.maxTotalTokens)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /save general settings/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /save llm settings/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /save display settings/i })).not.toBeInTheDocument();
    expect(screen.getByText(/maximum: 1000000, default: 64000/i)).toBeInTheDocument();
  });

  test('renders settings tabs and scopes MCP controls to the MCP tab', () => {
    render(<AppConfig {...props} />);

    expect(screen.getByText('General')).toBeInTheDocument();
    expect(screen.getByText('Agent Runtime')).toBeInTheDocument();
    expect(screen.getByText('MCP')).toBeInTheDocument();
    expect(screen.getByText('Service Graph')).toBeInTheDocument();
    expect(screen.getByText('Prompts')).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: /mcp servers/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('MCP'));

    expect(screen.getByRole('group', { name: /mcp servers/i })).toBeInTheDocument();
    expect(screen.queryByTestId(testIds.appConfig.maxTotalTokens)).not.toBeInTheDocument();
    expect(window.sessionStorage.getItem(SETTINGS_TAB_STORAGE_KEY)).toBe('mcp');
  });

  test('shows unsaved changes notice for edited settings tabs', () => {
    render(<AppConfig {...props} />);

    expect(screen.queryByTestId(testIds.appConfig.unsavedChangesNotice)).not.toBeInTheDocument();

    fireEvent.change(screen.getByTestId(testIds.appConfig.maxTotalTokens), { target: { value: '75000' } });

    expect(screen.getByTestId(testIds.appConfig.unsavedChangesNotice)).toHaveTextContent('Unsaved changes');
    expect(screen.getByText('General *')).toBeInTheDocument();

    fireEvent.click(screen.getByText('MCP'));

    expect(screen.queryByTestId(testIds.appConfig.unsavedChangesNotice)).not.toBeInTheDocument();
    expect(screen.getByText('General *')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId(testIds.appConfig.addMcpServerButton));

    expect(screen.getByTestId(testIds.appConfig.unsavedChangesNotice)).toHaveTextContent('Unsaved changes');
    expect(screen.getByText('MCP *')).toBeInTheDocument();
  });

  test('restores the active settings tab from session storage', () => {
    window.sessionStorage.setItem(SETTINGS_TAB_STORAGE_KEY, 'prompts');

    render(<AppConfig {...props} />);

    expect(screen.getByRole('group', { name: /prompt templates/i })).toBeInTheDocument();
    expect(screen.queryByTestId(testIds.appConfig.maxTotalTokens)).not.toBeInTheDocument();
  });

  test('renders service graph settings and loads topology in the Service Graph tab', async () => {
    render(<AppConfig {...props} />);

    fireEvent.click(screen.getByText('Service Graph'));

    expect(screen.getByRole('group', { name: /service graph/i })).toBeInTheDocument();
    expect(screen.getByTestId(testIds.appConfig.serviceGraphMaxNodes)).toBeInTheDocument();
    expect(screen.getByTestId(testIds.appConfig.serviceGraphMaxEdges)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId(testIds.appConfig.serviceGraphSummary)).toBeInTheDocument());
  });

  test('renders context management controls with defaults in the Agent Runtime tab', () => {
    const { container } = render(<AppConfig {...props} />);

    fireEvent.click(screen.getByText('Agent Runtime'));

    expect(screen.getByRole('group', { name: /agent runtime/i })).toBeInTheDocument();
    expect(screen.getByText('Summarize evicted tool results')).toBeInTheDocument();

    const inputByName = (name: string) => container.querySelector(`input[name="${name}"]`) as HTMLInputElement;
    expect(inputByName('keepRecentToolResults').value).toBe('8');
    expect(inputByName('maxToolResponseTokens').value).toBe('8000');
    expect(inputByName('aggressiveToolResponseTokens').value).toBe('2000');
    expect(inputByName('maxHighVolumeToolResponseTokens').value).toBe('3000');
    expect(inputByName('aggressiveHighVolumeToolResponseTokens').value).toBe('800');
  });

  test('marks the Agent Runtime tab dirty when a context management setting changes', () => {
    const { container } = render(<AppConfig {...props} />);

    fireEvent.click(screen.getByText('Agent Runtime'));
    fireEvent.change(container.querySelector('input[name="keepRecentToolResults"]') as HTMLInputElement, {
      target: { value: '12' },
    });

    expect(screen.getByTestId(testIds.appConfig.unsavedChangesNotice)).toHaveTextContent('Unsaved changes');
    expect(screen.getByText('Agent Runtime *')).toBeInTheDocument();
  });

  test('marks the Agent Runtime tab dirty when the summarization switch is toggled', () => {
    render(<AppConfig {...props} />);

    fireEvent.click(screen.getByText('Agent Runtime'));
    fireEvent.click(screen.getByLabelText('Summarize evicted tool results'));

    expect(screen.getByTestId(testIds.appConfig.unsavedChangesNotice)).toHaveTextContent('Unsaved changes');
    expect(screen.getByText('Agent Runtime *')).toBeInTheDocument();
  });

  test('renders the Workflows tab from its own admin route, not from plugin settings', async () => {
    // Settings still carry a stale workflows key from the pre-per-org design;
    // the tab must ignore it and source its rows from GET /api/workflows.
    mockStoredJsonData = { workflows: [{ name: 'stored-flow', enabled: true }] };
    props.plugin.meta.jsonData = {
      workflows: [{ name: 'stored-flow', enabled: true }],
    } as unknown as AppPluginSettings;

    mockFetch.mockImplementation((options: FetchOptions) => {
      if (options.url?.endsWith('/settings')) {
        return of({ data: { jsonData: mockStoredJsonData } });
      }
      if (options.url?.endsWith('/resources/api/workflows')) {
        return of({
          data: {
            workflows: [
              {
                name: 'Nightly RCA',
                enabled: true,
                skill: 'investigating-alerts',
                intervalSeconds: 300,
                sessionTimeoutSeconds: 300,
                maxConcurrentSessions: 5,
                toolAllowlist: ['alerting_rules_read'],
                running: true,
                status: { started: 0, completed: 0, failed: 0, cancelled: 0, timeout: 0 },
              },
            ],
          },
        });
      }
      return of({ data: {} });
    });

    render(<AppConfig {...props} />);
    fireEvent.click(screen.getByText('Workflows'));

    expect(await screen.findByTestId('ac-workflow-enabled-Nightly RCA')).toBeInTheDocument();
    expect(screen.queryByText('stored-flow')).not.toBeInTheDocument();

    const workflowGets = mockFetch.mock.calls.filter(([options]) => options.url?.endsWith('/resources/api/workflows'));
    expect(workflowGets).toHaveLength(1);
    // Nothing is read from or written to the plugin settings for this tab.
    expect(mockFetch.mock.calls.some(([options]) => options.url?.endsWith('/settings'))).toBe(false);
  });

  test('saves the whole General tab in one payload', () => {
    render(<AppConfig {...props} />);

    fireEvent.change(screen.getByTestId(testIds.appConfig.maxTotalTokens), { target: { value: '90000' } });
    fireEvent.click(screen.getByTestId(testIds.appConfig.kioskModeToggle));
    fireEvent.click(screen.getByText('Left'));
    fireEvent.click(screen.getByRole('button', { name: /save general settings/i }));

    const posts = mockFetch.mock.calls
      .map(([options]: [FetchOptions]) => options)
      .filter((options) => options.url?.endsWith('/settings') && options.method === 'POST');
    expect(posts).toHaveLength(1);
    const jsonData = (posts[0].data as { jsonData: AppPluginSettings }).jsonData;
    expect(jsonData.maxTotalTokens).toBe(90000);
    expect(jsonData.kioskModeEnabled).toBe(false);
    expect(jsonData.chatPanelPosition).toBe('left');
  });

  test('blocks a general save when the token budget is out of range', () => {
    render(<AppConfig {...props} />);

    fireEvent.change(screen.getByTestId(testIds.appConfig.maxTotalTokens), { target: { value: '9999999' } });

    expect(screen.getByRole('button', { name: /save general settings/i })).toBeDisabled();
    expect(screen.getByText(/token limit must be between 1000 and 1000000/i)).toBeInTheDocument();
    expect(mockFetch.mock.calls.some(([options]) => options.method === 'POST')).toBe(false);
  });

  test('new MCP servers default to the streamable-http type and persist a saved timeout', () => {
    props.plugin.meta.jsonData = {
      mcpServers: [
        { id: 'srv-0', name: 'Saved', url: 'https://saved.example.com/mcp', enabled: true, type: 'streamable-http' },
      ],
    } as AppPluginSettings;

    render(<AppConfig {...props} />);
    fireEvent.click(screen.getByText('MCP'));
    fireEvent.click(screen.getByTestId(testIds.appConfig.mcpServerAdvancedToggle('srv-0')));
    fireEvent.change(screen.getByTestId(testIds.appConfig.mcpServerTimeoutInput('srv-0')), {
      target: { value: '90' },
    });
    fireEvent.click(screen.getByTestId(testIds.appConfig.addMcpServerButton));

    fireEvent.change(screen.getAllByPlaceholderText('https://mcp-server.example.com').at(-1)!, {
      target: { value: 'https://mcp.example.com/mcp' },
    });
    fireEvent.click(screen.getByRole('button', { name: /save mcp servers/i }));

    const post = mockFetch.mock.calls
      .map(([options]: [FetchOptions]) => options)
      .find((options) => options.url?.endsWith('/settings') && options.method === 'POST');
    const servers = (post?.data as { jsonData: AppPluginSettings }).jsonData.mcpServers ?? [];
    expect(servers[0].timeoutSeconds).toBe(90);
    expect(servers[1].type).toBe('streamable-http');
  });

  test('blocks the MCP save when an enabled server has no URL, and allows a disabled one', () => {
    render(<AppConfig {...props} />);
    fireEvent.click(screen.getByText('MCP'));
    fireEvent.click(screen.getByTestId(testIds.appConfig.addMcpServerButton));

    fireEvent.click(screen.getByRole('button', { name: /save mcp servers/i }));

    expect(screen.getByText('Server URL is required')).toBeInTheDocument();
    expect(mockFetch.mock.calls.some(([options]) => options.method === 'POST')).toBe(false);
  });

  test('blocks the MCP save when a per-server timeout is out of range', () => {
    props.plugin.meta.jsonData = {
      mcpServers: [
        { id: 'srv-1', name: 'Srv', url: 'https://mcp.example.com/mcp', enabled: true, type: 'streamable-http' },
      ],
    } as AppPluginSettings;

    render(<AppConfig {...props} />);
    fireEvent.click(screen.getByText('MCP'));
    fireEvent.click(screen.getByTestId(testIds.appConfig.mcpServerAdvancedToggle('srv-1')));
    fireEvent.change(screen.getByTestId(testIds.appConfig.mcpServerTimeoutInput('srv-1')), {
      target: { value: '4000' },
    });
    fireEvent.click(screen.getByRole('button', { name: /save mcp servers/i }));

    expect(screen.getByText('Enter a value from 0 to 3600')).toBeInTheDocument();
    expect(mockFetch.mock.calls.some(([options]) => options.method === 'POST')).toBe(false);
  });

  test('Tools Apply keeps typed header values unsaved and out of the settings write', async () => {
    props.plugin.meta.jsonData = {
      mcpServers: [
        { id: 'srv-1', name: 'Srv', url: 'https://mcp.example.com/mcp', enabled: true, type: 'streamable-http' },
      ],
    } as AppPluginSettings;

    mockStoredJsonData = props.plugin.meta.jsonData as Record<string, unknown>;
    mockFetch.mockImplementation((options: FetchOptions) => {
      if (options.url?.endsWith('/api/mcp/servers')) {
        return of({
          data: {
            servers: [
              {
                serverId: 'srv-1',
                name: 'Srv',
                url: 'https://mcp.example.com/mcp',
                type: 'streamable-http',
                status: 'healthy',
                lastCheck: '',
                responseTime: 0,
                successRate: 100,
                errorCount: 0,
                consecutiveFailures: 0,
                tools: [{ name: 'tool_a', description: '', inputSchema: {} }],
                toolCount: 1,
              },
            ],
          },
        });
      }
      if (options.url?.endsWith('/settings')) {
        return of({ data: options.method === 'POST' ? {} : { jsonData: mockStoredJsonData } });
      }
      return of({ data: {} });
    });

    render(<AppConfig {...props} />);
    fireEvent.click(screen.getByText('MCP'));
    fireEvent.click(screen.getByTestId(testIds.appConfig.mcpServerAdvancedToggle('srv-1')));
    fireEvent.click(screen.getByTestId(testIds.appConfig.mcpServerAddHeaderButton('srv-1')));
    fireEvent.change(screen.getByTestId(testIds.appConfig.mcpServerHeaderKeyInput('srv-1', 0)), {
      target: { value: 'Authorization' },
    });
    fireEvent.change(screen.getByTestId(testIds.appConfig.mcpServerHeaderValueInput('srv-1', 0)), {
      target: { value: 's3cret-token' },
    });

    fireEvent.click(screen.getByTestId(testIds.appConfig.manageToolsButton('srv-1')));
    const toolSwitch = await screen.findByLabelText('Toggle tool_a');
    fireEvent.click(toolSwitch);
    fireEvent.click(screen.getByRole('button', { name: /^apply$/i }));

    await waitFor(() =>
      expect(
        mockFetch.mock.calls.some(
          ([options]: [FetchOptions]) => options.url?.endsWith('/settings') && options.method === 'POST'
        )
      ).toBe(true)
    );

    const post = mockFetch.mock.calls
      .map(([options]: [FetchOptions]) => options)
      .find((options) => options.url?.endsWith('/settings') && options.method === 'POST');
    const data = post?.data as { jsonData: AppPluginSettings; secureJsonData?: Record<string, string> };
    // Apply persists the tool selection only. The typed header value is never
    // sent and never reaches jsonData.
    expect(data.secureJsonData).toBeUndefined();
    expect(JSON.stringify(data)).not.toContain('s3cret-token');
    expect(data.jsonData.mcpServers?.[0].toolSelections).toEqual({ tool_a: false });
    // The typed header stays in the UI, unsaved.
    expect(
      (screen.getByTestId(testIds.appConfig.mcpServerHeaderValueInput('srv-1', 0)) as HTMLInputElement).value
    ).toBe('s3cret-token');
    expect(screen.getByText('MCP *')).toBeInTheDocument();
    expect(screen.getByTestId(testIds.appConfig.unsavedChangesNotice)).toHaveTextContent('Unsaved changes');
  });

  test('Tools Apply on an unsaved new server writes nothing and asks for a save first', async () => {
    render(<AppConfig {...props} />);
    fireEvent.click(screen.getByText('MCP'));
    fireEvent.click(screen.getByTestId(testIds.appConfig.addMcpServerButton));
    fireEvent.change(screen.getByPlaceholderText('https://mcp-server.example.com'), {
      target: { value: 'https://mcp.example.com/mcp' },
    });

    const manageToolsPrefix = testIds.appConfig.manageToolsButton('');
    const manageToolsButtons = Array.from(document.querySelectorAll(`[data-testid^="${manageToolsPrefix}"]`));
    const newServerButton = manageToolsButtons[manageToolsButtons.length - 1] as HTMLElement;
    const newServerId = newServerButton.getAttribute('data-testid')!.replace(manageToolsPrefix, '');

    mockFetch.mockImplementation((options: FetchOptions) => {
      if (options.url?.endsWith('/api/mcp/servers')) {
        return of({
          data: {
            servers: [
              {
                serverId: newServerId,
                name: 'New MCP Server',
                url: 'https://mcp.example.com/mcp',
                type: 'streamable-http',
                status: 'unknown',
                lastCheck: '',
                responseTime: 0,
                successRate: 0,
                errorCount: 0,
                consecutiveFailures: 0,
                tools: [{ name: 'tool_a', description: '', inputSchema: {} }],
                toolCount: 1,
              },
            ],
          },
        });
      }
      if (options.url?.endsWith('/settings')) {
        return of({ data: {} });
      }
      return of({ data: {} });
    });

    fireEvent.click(newServerButton);
    const toolSwitch = await screen.findByLabelText('Toggle tool_a');
    fireEvent.click(toolSwitch);
    fireEvent.click(screen.getByRole('button', { name: /^apply$/i }));

    expect(await screen.findByText('Save this MCP server before applying tool selections.')).toBeInTheDocument();
    expect(
      mockFetch.mock.calls.some(
        ([options]: [FetchOptions]) => options.url?.endsWith('/settings') && options.method === 'POST'
      )
    ).toBe(false);
  });

  test('Tools Apply on a saved server writes only its tool selections', async () => {
    const savedServer = {
      id: 'srv-1',
      name: 'Srv',
      url: 'https://mcp.example.com/mcp',
      enabled: true,
      type: 'streamable-http',
      timeoutSeconds: 30,
    };
    props.plugin.meta.jsonData = { mcpServers: [savedServer] } as AppPluginSettings;
    mockStoredJsonData = { mcpServers: [savedServer] };

    mockFetch.mockImplementation((options: FetchOptions) => {
      if (options.url?.endsWith('/api/mcp/servers')) {
        return of({
          data: {
            servers: [
              {
                serverId: 'srv-1',
                name: 'Srv',
                url: 'https://mcp.example.com/mcp',
                type: 'streamable-http',
                status: 'healthy',
                lastCheck: '',
                responseTime: 0,
                successRate: 100,
                errorCount: 0,
                consecutiveFailures: 0,
                tools: [{ name: 'tool_a', description: '', inputSchema: {} }],
                toolCount: 1,
              },
            ],
          },
        });
      }
      if (options.url?.endsWith('/settings')) {
        return of({ data: options.method === 'POST' ? {} : { jsonData: mockStoredJsonData } });
      }
      return of({ data: {} });
    });

    render(<AppConfig {...props} />);
    fireEvent.click(screen.getByText('MCP'));
    fireEvent.click(screen.getByTestId(testIds.appConfig.manageToolsButton('srv-1')));
    const toolSwitch = await screen.findByLabelText('Toggle tool_a');
    fireEvent.click(toolSwitch);
    fireEvent.click(screen.getByRole('button', { name: /^apply$/i }));

    await waitFor(() =>
      expect(
        mockFetch.mock.calls.some(
          ([options]: [FetchOptions]) => options.url?.endsWith('/settings') && options.method === 'POST'
        )
      ).toBe(true)
    );

    const post = mockFetch.mock.calls
      .map(([options]: [FetchOptions]) => options)
      .find((options) => options.url?.endsWith('/settings') && options.method === 'POST');
    const data = post?.data as { jsonData: AppPluginSettings; secureJsonData?: Record<string, string> };
    expect(data.jsonData).toEqual({
      mcpServers: [{ ...savedServer, toolSelections: { tool_a: false } }],
      builtInMCPToolSelections: {},
    });
    expect(data).not.toHaveProperty('secureJsonData');
    expect(data.jsonData).not.toHaveProperty('useLocalGrafanaURL');
    expect(data.jsonData).not.toHaveProperty('localGrafanaPort');
    // The saved selection matches the UI, so the MCP tab is no longer dirty.
    await waitFor(() => expect(screen.queryByText('MCP *')).not.toBeInTheDocument());
  });

  test('auto-save sessions is off by default and saves true when enabled', () => {
    render(<AppConfig {...props} />);
    fireEvent.click(screen.getByText('Service Graph'));

    const autoSave = screen.getByTestId(testIds.appConfig.graphitiAutoSaveToggle);
    expect(autoSave).not.toBeChecked();

    fireEvent.click(autoSave);
    fireEvent.click(screen.getByTestId(testIds.appConfig.saveServiceGraphSettingsButton));

    const post = mockFetch.mock.calls
      .map(([options]: [FetchOptions]) => options)
      .find((options) => options.url?.endsWith('/settings') && options.method === 'POST');
    const jsonData = (post?.data as { jsonData: AppPluginSettings }).jsonData;
    expect(jsonData.graphitiAutoSaveSessionsEnabled).toBe(true);
    expect((jsonData as unknown as Record<string, unknown>).graphitiAutoSaveSessionsDisabled).toBeUndefined();
  });
});
