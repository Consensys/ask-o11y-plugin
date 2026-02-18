import React from 'react';
import { render, screen } from '@testing-library/react';
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
}));

jest.mock('@grafana/llm', () => ({
  mcp: { enabled: () => Promise.resolve(false) },
}));

describe('Components/AppConfig', () => {
  let props: AppConfigProps;

  beforeEach(() => {
    jest.resetAllMocks();

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
  });
});
