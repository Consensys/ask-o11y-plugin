import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const listPresetsMock = jest.fn();
const listDynamicServersMock = jest.fn();
const addPresetMock = jest.fn();
const removeDynamicServerMock = jest.fn();
const addGenericMock = jest.fn();

jest.mock('../../services/mcpProvisionerClient', () => ({
  listPresets: (...args: unknown[]) => listPresetsMock(...args),
  listDynamicServers: (...args: unknown[]) => listDynamicServersMock(...args),
  addPreset: (...args: unknown[]) => addPresetMock(...args),
  removeDynamicServer: (...args: unknown[]) => removeDynamicServerMock(...args),
  addGeneric: (...args: unknown[]) => addGenericMock(...args),
}));

import { ExternalMCPs } from './ExternalMCPs';
import { testIds } from '../testIds';

const githubPreset = {
  id: 'github-read',
  displayName: 'GitHub (read-only)',
  serverId: 'github-read',
  mcpUrl: 'https://api.githubcopilot.com/mcp/',
  transport: 'streamable-http',
  scopes: ['read:user'],
  dcrCapable: false,
};

const atlassianPreset = {
  id: 'atlassian',
  displayName: 'Atlassian (Jira + Confluence)',
  serverId: 'atlassian',
  mcpUrl: 'https://mcp.atlassian.com/v1/sse',
  transport: 'sse',
  scopes: ['offline_access'],
  dcrCapable: true,
};

describe('ExternalMCPs', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Grafana's Combobox measures option text on a canvas jsdom doesn't provide.
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
      configurable: true,
      value: () => ({
        measureText: () => ({ width: 100 }),
      }),
    });
    listPresetsMock.mockResolvedValue([githubPreset, atlassianPreset]);
    listDynamicServersMock.mockResolvedValue([]);
    addPresetMock.mockResolvedValue({ serverId: 'atlassian' });
    removeDynamicServerMock.mockResolvedValue(undefined);
  });

  it('provisions a DCR-capable preset with one click', async () => {
    render(<ExternalMCPs />);
    const addButton = await screen.findByTestId(testIds.appConfig.externalMcpPresetAddButton('atlassian'));
    fireEvent.click(addButton);
    await waitFor(() =>
      expect(addPresetMock).toHaveBeenCalledWith({ preset: 'atlassian', clientId: undefined, clientSecret: undefined })
    );
  });

  it('disables Add for non-DCR presets until a client ID is typed, then sends it', async () => {
    render(<ExternalMCPs />);
    const addButton = await screen.findByTestId(testIds.appConfig.externalMcpPresetAddButton('github-read'));
    expect(addButton).toBeDisabled();

    fireEvent.change(screen.getByTestId(testIds.appConfig.externalMcpPresetClientIdInput('github-read')), {
      target: { value: 'Iv1.client' },
    });
    expect(addButton).toBeEnabled();

    fireEvent.click(addButton);
    await waitFor(() =>
      expect(addPresetMock).toHaveBeenCalledWith({
        preset: 'github-read',
        clientId: 'Iv1.client',
        clientSecret: undefined,
      })
    );
  });

  it('shows Remove for already-provisioned presets', async () => {
    listDynamicServersMock.mockResolvedValue([
      {
        serverId: 'atlassian',
        displayName: 'Atlassian (Jira + Confluence)',
        mcpUrl: 'https://mcp.atlassian.com/v1/sse',
        transport: 'sse',
        presetId: 'atlassian',
      },
    ]);
    render(<ExternalMCPs />);
    const removeButton = await screen.findByTestId(testIds.appConfig.externalMcpPresetRemoveButton('atlassian'));
    fireEvent.click(removeButton);
    await waitFor(() => expect(removeDynamicServerMock).toHaveBeenCalledWith('atlassian'));
  });

  it('surfaces provisioning errors', async () => {
    addPresetMock.mockRejectedValue(new Error('discovery failed'));
    render(<ExternalMCPs />);
    fireEvent.click(await screen.findByTestId(testIds.appConfig.externalMcpPresetAddButton('atlassian')));
    expect(await screen.findByText('discovery failed')).toBeInTheDocument();
  });
});
