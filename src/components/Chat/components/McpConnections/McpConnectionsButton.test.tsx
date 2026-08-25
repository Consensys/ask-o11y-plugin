import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const fetchServerStatusesMock = jest.fn();
const disconnectOAuthMock = jest.fn().mockResolvedValue(undefined);
const openOAuthPopupMock = jest.fn();
let callbackSubscriber: ((msg: unknown) => void) | undefined;

jest.mock('../../../../services/mcpServerStatus', () => ({
  mcpServerStatusService: {
    fetchServerStatuses: (...args: unknown[]) => fetchServerStatusesMock(...args),
  },
}));

jest.mock('../../../../services/oauthClient', () => ({
  disconnectOAuth: (...args: unknown[]) => disconnectOAuthMock(...args),
  openOAuthPopup: (...args: unknown[]) => openOAuthPopupMock(...args),
  startOAuthUrl: (id: string) => `/start/${id}`,
  onOAuthCallback: (cb: (msg: unknown) => void) => {
    callbackSubscriber = cb;
    return () => {
      callbackSubscriber = undefined;
    };
  },
}));

import { McpConnectionsButton } from './McpConnectionsButton';
import { testIds } from '../../../testIds';

const serverEntry = (overrides: Record<string, unknown> = {}) => ({
  serverId: 'atlassian',
  name: 'Atlassian',
  url: 'https://mcp.atlassian.com/v1/sse',
  type: 'sse',
  status: 'healthy',
  lastCheck: '',
  responseTime: 0,
  successRate: 100,
  errorCount: 0,
  consecutiveFailures: 0,
  tools: [],
  toolCount: 0,
  ...overrides,
});

describe('McpConnectionsButton', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    callbackSubscriber = undefined;
  });

  it('renders nothing when no server has OAuth configured', async () => {
    fetchServerStatusesMock.mockResolvedValue({ servers: [serverEntry()], systemHealth: {}, oauth: {} });
    const { container } = render(<McpConnectionsButton />);
    await waitFor(() => expect(fetchServerStatusesMock).toHaveBeenCalled());
    expect(container.firstChild).toBeNull();
  });

  it('shows the button with disconnected count and opens the connect popup', async () => {
    fetchServerStatusesMock.mockResolvedValue({
      servers: [serverEntry()],
      systemHealth: {},
      oauth: { atlassian: { configured: true, connected: false } },
    });
    openOAuthPopupMock.mockReturnValue({});

    render(<McpConnectionsButton />);
    const button = await screen.findByTestId(testIds.chat.mcpConnectionsButton);
    expect(button).toHaveTextContent('Connections (1)');

    fireEvent.click(button);
    const connect = await screen.findByTestId(testIds.chat.mcpConnectionConnect('atlassian'));
    fireEvent.click(connect);
    expect(openOAuthPopupMock).toHaveBeenCalledWith('atlassian');
  });

  it('disconnects a connected server and refreshes', async () => {
    fetchServerStatusesMock.mockResolvedValue({
      servers: [serverEntry()],
      systemHealth: {},
      oauth: { atlassian: { configured: true, connected: true } },
    });

    render(<McpConnectionsButton />);
    fireEvent.click(await screen.findByTestId(testIds.chat.mcpConnectionsButton));
    fireEvent.click(await screen.findByTestId(testIds.chat.mcpConnectionDisconnect('atlassian')));

    await waitFor(() => expect(disconnectOAuthMock).toHaveBeenCalledWith('atlassian'));
    await waitFor(() => expect(fetchServerStatusesMock).toHaveBeenCalledTimes(2));
  });

  it('refreshes when the OAuth popup reports back', async () => {
    fetchServerStatusesMock.mockResolvedValue({
      servers: [serverEntry()],
      systemHealth: {},
      oauth: { atlassian: { configured: true, connected: false } },
    });

    render(<McpConnectionsButton />);
    await screen.findByTestId(testIds.chat.mcpConnectionsButton);
    expect(callbackSubscriber).toBeDefined();

    callbackSubscriber?.({ source: 'asko11y-oauth', serverID: 'atlassian', success: true });
    await waitFor(() => expect(fetchServerStatusesMock).toHaveBeenCalledTimes(2));
  });
});
