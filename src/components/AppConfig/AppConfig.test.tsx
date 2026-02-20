import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { of } from 'rxjs';
import { PluginType } from '@grafana/data';
import AppConfig, { AppConfigProps } from './AppConfig';
import { testIds } from 'components/testIds';

const mockFetch = jest.fn();

jest.mock('@grafana/runtime', () => ({
  getBackendSrv: () => ({
    fetch: mockFetch,
  }),
}));

jest.mock('@grafana/llm', () => ({
  mcp: { enabled: () => Promise.resolve(false) },
}));

describe('Components/AppConfig', () => {
  const getUpdatePayload = () => {
    const call = mockFetch.mock.calls.find(
      (args) => args[0]?.url === '/api/plugins/sample-app/settings' && args[0]?.method === 'POST'
    );
    expect(call).toBeDefined();
    return call?.[0]?.data;
  };

  const createProps = (overrides?: {
    mcpServers?: Array<Record<string, unknown>>;
    secureJsonFields?: Record<string, boolean>;
  }): AppConfigProps => {
    return {
      plugin: {
        meta: {
          id: 'sample-app',
          name: 'Sample App',
          type: PluginType.app,
          enabled: true,
          jsonData: {
            mcpServers: overrides?.mcpServers || [],
          },
          secureJsonFields: overrides?.secureJsonFields || {},
        },
      },
      query: {},
    } as unknown as AppConfigProps;
  };

  beforeEach(() => {
    jest.resetAllMocks();
    jest.spyOn(console, 'error').mockImplementation(() => {});
    mockFetch.mockImplementation(({ url }) =>
      of({
        data: url === '/api/plugins/consensys-asko11y-app/resources/api/prompt-defaults'
          ? {
              defaultSystemPrompt: 'mock system prompt',
              investigationPrompt: 'mock investigation prompt',
              performancePrompt: 'mock performance prompt',
            }
          : {},
      })
    );
  });

  test('renders the "LLM Settings" fieldset with max tokens input and button', () => {
    const props = createProps();
    const plugin = { meta: { ...props.plugin.meta, enabled: false } };

    // @ts-ignore - We don't need to provide `addConfigPage()` and `setChannelSupport()` for these tests
    render(<AppConfig plugin={plugin} query={props.query} />);

    expect(screen.queryByRole('group', { name: /llm settings/i })).toBeInTheDocument();
    expect(screen.queryByTestId(testIds.appConfig.maxTotalTokens)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /save llm settings/i })).toBeInTheDocument();
  });

  test('does not send empty secureJsonData when secure headers are masked', async () => {
    const props = createProps({
      mcpServers: [
        {
          id: 'server-1',
          name: 'Server 1',
          url: 'https://example.com/mcp',
          enabled: true,
          type: 'streamable-http',
        },
      ],
      secureJsonFields: {
        'server-1__headers': true,
      },
    });

    render(<AppConfig plugin={props.plugin} query={props.query} />);

    fireEvent.click(screen.getByTestId(testIds.appConfig.saveMcpServersButton));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        expect.objectContaining({
          url: '/api/plugins/sample-app/settings',
          method: 'POST',
        })
      );
    });

    const updatePayload = getUpdatePayload();
    expect(updatePayload).not.toHaveProperty('secureJsonData');
  });

  test('sends secureJsonData when headers are present in memory', async () => {
    const props = createProps({
      mcpServers: [
        {
          id: 'server-1',
          name: 'Server 1',
          url: 'https://example.com/mcp',
          enabled: true,
          type: 'streamable-http',
          headers: {
            Authorization: 'Bearer token',
            'X-API-Key': 'secret',
          },
        },
      ],
    });

    render(<AppConfig plugin={props.plugin} query={props.query} />);

    fireEvent.click(screen.getByTestId(testIds.appConfig.saveMcpServersButton));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        expect.objectContaining({
          url: '/api/plugins/sample-app/settings',
          method: 'POST',
        })
      );
    });

    const updatePayload = getUpdatePayload();
    expect(updatePayload.secureJsonData).toEqual({
      'server-1__headers': JSON.stringify({
        Authorization: 'Bearer token',
        'X-API-Key': 'secret',
      }),
    });
    expect(updatePayload.jsonData.mcpServers[0]).not.toHaveProperty('headers');
    expect(updatePayload.jsonData.mcpServers[0]).not.toHaveProperty('hasSecureHeaders');
  });
});
