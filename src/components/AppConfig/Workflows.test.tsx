/**
 * Unit tests for the Workflows AppConfig tab
 */

import React from 'react';
import { of, throwError } from 'rxjs';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { getBackendSrv } from '@grafana/runtime';
import { WorkflowsTab } from './Workflows';
import type { WorkflowEntryUI } from '../../types/plugin';

jest.mock('@grafana/runtime', () => ({
  getBackendSrv: jest.fn(),
}));

jest.mock('@grafana/ui', () => ({
  Badge: ({ text }: { text: string }) => <span data-testid={`badge-${text.split(' ')[0]}`}>({text})</span>,
  Button: ({ children, onClick, disabled }: { children: React.ReactNode; onClick?: () => void; disabled?: boolean }) => (
    <button type="button" onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
  LoadingPlaceholder: ({ text }: { text: string }) => <span>{text}</span>,
  Switch: ({ value, onChange }: { value: boolean; onChange: (e: { currentTarget: { checked: boolean } }) => void }) => (
    <input
      type="checkbox"
      checked={value}
      onChange={(e) => onChange({ currentTarget: { checked: e.currentTarget.checked } })}
      aria-label="workflow enabled"
    />
  ),
  useTheme2: () => ({ colors: { border: { weak: '#ddd' } } }),
}));

const fetchMock = getBackendSrv as jest.Mock;

const workflowsResponse = () => ({
  workflows: [
    {
      name: 'noc-dispatch',
      enabled: true,
      orgId: 1,
      skill: 'noc-dispatch',
      intervalSeconds: 300,
      sessionTimeoutSeconds: 420,
      maxConcurrentSessions: 5,
      toolAllowlist: ['irm_list_alert_groups'],
      running: true,
      status: {
        lastTickAt: '2026-11-20T17:00:00Z',
        lastTickOutcome: 'executed',
        started: 3,
        completed: 2,
        failed: 1,
        cancelled: 0,
        timeout: 0,
      },
    },
    {
      name: 'noc-janitor',
      enabled: false,
      orgId: 1,
      skill: 'noc-janitor',
      intervalSeconds: 300,
      sessionTimeoutSeconds: 240,
      toolAllowlist: ['irm_list_alert_groups'],
      running: false,
      status: { started: 0, completed: 0, failed: 0, cancelled: 0, timeout: 0 },
    },
  ],
});

const renderTab = (onSave: (next: WorkflowEntryUI[]) => void = jest.fn()) =>
  render(<WorkflowsTab savedWorkflows={[]} onSaveWorkflows={onSave} />);

describe('WorkflowsTab', () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  it('renders the fetched workflows with status', async () => {
    fetchMock.mockImplementation(() => ({ fetch: () => of({ data: workflowsResponse() }) }));
    renderTab();

    // The name and skill cells share the value; both render on success.
    expect((await screen.findAllByText('noc-dispatch')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('noc-janitor').length).toBeGreaterThan(0);
    expect(screen.getByText(/3 \/ 2 \/ 1 \/ 0/)).toBeInTheDocument();
    expect(screen.getByText(/executed/)).toBeInTheDocument();
  });

  it('renders the empty state when no workflows are configured', async () => {
    fetchMock.mockImplementation(() => ({ fetch: () => of({ data: { workflows: [] } }) }));
    renderTab();

    expect(await screen.findByText(/No workflows configured/i)).toBeInTheDocument();
  });

  it('shows a load error with retry', async () => {
    fetchMock.mockImplementation(() => ({ fetch: () => throwError(() => new Error('boom')) }));
    renderTab();

    expect(await screen.findByText(/Failed to load workflow status/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('toggles a workflow and saves the full entry list', async () => {
    fetchMock.mockImplementation(() => ({ fetch: () => of({ data: workflowsResponse() }) }));
    const onSave = jest.fn();
    renderTab(onSave);

    const toggles = await screen.findAllByRole('checkbox');
    // First row is noc-dispatch (enabled); switching it off must persist the
    // whole list minus the runtime join.
    fireEvent.click(toggles[0]);

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const saved = onSave.mock.calls[0][0] as Array<Record<string, unknown>>;
    expect(saved).toHaveLength(2);
    expect(saved[0]).toMatchObject({ name: 'noc-dispatch', enabled: false });
    expect(saved[1]).toMatchObject({ name: 'noc-janitor', enabled: false });
    expect(saved[0]).not.toHaveProperty('running');
    expect(saved[0]).not.toHaveProperty('status');
  });
});
