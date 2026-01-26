import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { AppRootProps, PluginType } from '@grafana/data';
import { render, waitFor } from '@testing-library/react';
import App from './App';

// Mock the AppLoader
jest.mock('../AppLoader', () => ({
  AppLoader: ({ text }: { text?: string }) => <div data-testid="app-loader">{text || 'Loading...'}</div>,
}));

// Mock the Home page
jest.mock('../../pages/Home', () => ({
  __esModule: true,
  default: () => <div>Ask O11y Assistant</div>,
}));

// Mock the SharedSession page
jest.mock('../../pages/SharedSession', () => ({
  __esModule: true,
  default: () => <div>Shared Session</div>,
}));

// Mock the backend MCP client
jest.mock('../../services/backendMCPClient', () => ({
  backendMCPClient: {
    listTools: jest.fn().mockResolvedValue([]),
    callTool: jest.fn().mockResolvedValue({ content: [] }),
  },
}));

// Mock Grafana runtime hooks
jest.mock('@grafana/runtime', () => ({
  usePluginUserStorage: jest.fn(() => ({
    getItem: jest.fn().mockResolvedValue(null),
    setItem: jest.fn().mockResolvedValue(undefined),
  })),
  getDataSourceSrv: jest.fn(() => ({
    get: jest.fn().mockResolvedValue({}),
  })),
  getBackendSrv: jest.fn(() => ({
    fetch: jest.fn().mockResolvedValue({ data: {} }),
  })),
  config: {
    publicDashboardAccessToken: '',
    bootData: {
      user: {
        orgName: 'TestOrg',
      },
    },
  },
}));

describe('Components/App', () => {
  let props: AppRootProps;

  beforeEach(() => {
    jest.resetAllMocks();

    props = {
      basename: 'a/sample-app',
      meta: {
        id: 'sample-app',
        name: 'Sample App',
        type: PluginType.app,
        enabled: true,
        jsonData: {},
      },
      query: {},
      path: '',
      onNavChanged: jest.fn(),
    } as unknown as AppRootProps;
  });

  test('renders without an error"', async () => {
    const { queryByText } = render(
      <MemoryRouter>
        <App {...props} />
      </MemoryRouter>
    );

    // Application is lazy loaded, so we need to wait for the component and routes to be rendered
    await waitFor(() => expect(queryByText(/Ask O11y Assistant/i)).toBeInTheDocument(), { timeout: 2000 });
  });
});
