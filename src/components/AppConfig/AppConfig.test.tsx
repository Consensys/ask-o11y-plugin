import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { of } from 'rxjs';
import { PluginType } from '@grafana/data';
import AppConfig, { AppConfigProps } from './AppConfig';
import { testIds } from 'components/testIds';

jest.mock('@grafana/runtime', () => ({
  getBackendSrv: () => ({
    fetch: () =>
      of({
        data: {
          defaultSystemPrompt: 'mock system prompt',
          investigationPrompt: 'mock investigation prompt',
          performancePrompt: 'mock performance prompt',
        },
      }),
  }),
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

  test('renders the "LLM Settings" fieldset with max tokens input and button', () => {
    const plugin = { meta: { ...props.plugin.meta, enabled: false } };

    // @ts-ignore - We don't need to provide `addConfigPage()` and `setChannelSupport()` for these tests
    render(<AppConfig plugin={plugin} query={props.query} />);

    expect(screen.queryByRole('group', { name: /llm settings/i })).toBeInTheDocument();
    expect(screen.queryByTestId(testIds.appConfig.maxTotalTokens)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /save llm settings/i })).toBeInTheDocument();
    expect(screen.getByText(/maximum: 200000/i)).toBeInTheDocument();
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
    expect(window.sessionStorage.getItem('ask-o11y.settings.activeTab')).toBe('mcp');
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
    window.sessionStorage.setItem('ask-o11y.settings.activeTab', 'prompts');

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
});
