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
  locationService: { push: jest.fn(), replace: jest.fn(), getLocation: () => ({}), getSearch: () => '' },
}));

jest.mock('@grafana/ui', () => ({
  Badge: ({ text }: { text: string }) => <span data-testid={`badge-${text.split(' ')[0]}`}>({text})</span>,
  Button: ({ children, onClick, disabled }: { children: React.ReactNode; onClick?: () => void; disabled?: boolean }) => (
    <button type="button" onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
  Field: ({ label, children }: { label: string; children: React.ReactNode }) => (
    <label>
      <span>{label}</span>
      {children}
    </label>
  ),
  Input: ({ value, onChange, disabled, type }: { value?: string | number; onChange?: (e: { currentTarget: { value: string } }) => void; disabled?: boolean; type?: string }) => (
    <input type={type ?? 'text'} value={value} disabled={disabled} onChange={onChange} />
  ),
  LoadingPlaceholder: ({ text }: { text: string }) => <span>{text}</span>,
  Combobox: ({ options, value, onChange }: { options: Array<{ label: string; value: string }>; value?: string; onChange?: (o: { value?: string }) => void }) => (
    <select value={value ?? ''} onChange={(e) => onChange?.({ value: e.currentTarget.value })}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  ),
  Switch: ({ value, onChange }: { value: boolean; onChange: (e: { currentTarget: { checked: boolean } }) => void }) => (
    <input
      type="checkbox"
      checked={value}
      onChange={(e) => onChange({ currentTarget: { checked: e.currentTarget.checked } })}
      aria-label="workflow enabled"
    />
  ),
  TextArea: ({ value, onChange, rows }: { value?: string; onChange?: (e: { currentTarget: { value: string } }) => void; rows?: number }) => (
    <textarea rows={rows} value={value} onChange={onChange} />
  ),
  useTheme2: () => ({ colors: { border: { weak: '#ddd' } } }),
}));

jest.mock('../../services/skillsClient', () => ({
  listSkills: jest.fn(() => Promise.resolve([{ name: 'investigating-alerts', description: 'x', source: 'bundled', customized: false, enabled: true, hidden: false, hasUserPrompt: false }])),
}));

const fetchMock = getBackendSrv as jest.Mock;

const workflowsResponse = () => ({
  workflows: [
    {
      name: 'noc-dispatch',
      enabled: true,
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
      skill: 'noc-janitor',
      intervalSeconds: 300,
      sessionTimeoutSeconds: 240,
      toolAllowlist: ['irm_list_alert_groups'],
      running: false,
      status: { started: 0, completed: 0, failed: 0, cancelled: 0, timeout: 0 },
    },
  ],
});

const renderTab = (onSave: (next: WorkflowEntryUI[]) => void = jest.fn(), onEditPrompt: (skill: string) => void = jest.fn()) =>
  render(<WorkflowsTab savedWorkflows={[]} onSaveWorkflows={onSave} onEditPrompt={onEditPrompt} />);

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

  it('expands a workflow, lists its runs, and opens a share link', async () => {
    fetchMock.mockImplementation(() => ({
      fetch: (cfg: { url: string; method?: string }) => {
        if (cfg.method === 'POST' && cfg.url.includes('/share')) {
          return of({ data: { shareUrl: '/a/consensys-asko11y-app/shared/abc?orgId=1' } });
        }
        return of(
          cfg.url.includes('/runs')
            ? {
                data: {
                  runs: [
                    {
                      runId: 'run-9',
                      sessionId: 'sess-9',
                      status: 'completed',
                      createdAt: '2026-11-20T17:00:00Z',
                      updatedAt: '2026-11-20T17:01:00Z',
                    },
                  ],
                },
              }
            : { data: workflowsResponse() }
        );
      },
    }));
    const { locationService } = jest.requireMock('@grafana/runtime');
    renderTab();

    const sessionsButtons = await screen.findAllByRole('button', { name: 'Sessions' });
    fireEvent.click(sessionsButtons[0]); // first row: noc-dispatch

    expect(await screen.findByText('run-9')).toBeInTheDocument();
    const open = await screen.findByRole('button', { name: 'Open' });
    fireEvent.click(open);

    await waitFor(() =>
      expect(locationService.push).toHaveBeenCalledWith('/a/consensys-asko11y-app/shared/abc?orgId=1')
    );
  });

  it('opens the editor for a row and saves an edited entry', async () => {
    fetchMock.mockImplementation(() => ({ fetch: () => of({ data: workflowsResponse() }) }));
    const onSave = jest.fn();
    renderTab(onSave);

    const editButtons = await screen.findAllByRole('button', { name: 'Edit' });
    fireEvent.click(editButtons[0]);

    expect(screen.getByText('Edit noc-dispatch')).toBeInTheDocument();
    const nameInput = screen.getByDisplayValue('noc-dispatch');
    expect((nameInput as HTMLInputElement).disabled).toBe(true);

    const save = screen.getByRole('button', { name: 'Save and reload' });
    fireEvent.click(save);
    expect(onSave).toHaveBeenCalledTimes(1);
    const saved = onSave.mock.calls[0][0] as Array<Record<string, unknown>>;
    expect(saved[0]).toMatchObject({ name: 'noc-dispatch', skill: 'noc-dispatch' });
    expect(saved[0]).not.toHaveProperty('running');
  });

  it('jumps to the skill prompt editor', async () => {
    fetchMock.mockImplementation(() => ({ fetch: () => of({ data: workflowsResponse() }) }));
    const onEditPrompt = jest.fn();
    renderTab(jest.fn(), onEditPrompt);

    const promptButtons = await screen.findAllByRole('button', { name: 'Prompt' });
    fireEvent.click(promptButtons[0]);
    expect(onEditPrompt).toHaveBeenCalledWith('noc-dispatch');
  });

  it('toggles a workflow and saves the full entry list', async () => {
    fetchMock.mockImplementation(() => ({ fetch: () => of({ data: workflowsResponse() }) }));
    const onSave = jest.fn();
    renderTab(onSave);

    const toggles = await screen.findAllByRole('checkbox');
    // First row is noc-dispatch (enabled); switching it off must persist the
    // whole list minus the runtime join.
    fireEvent.click(toggles[0]);

    // The save path reloads the page; the component must not refetch status
    // on its own, which would race the restart.
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const saved = onSave.mock.calls[0][0] as Array<Record<string, unknown>>;
    expect(saved).toHaveLength(2);
    expect(saved[0]).toMatchObject({ name: 'noc-dispatch', enabled: false });
    expect(saved[1]).toMatchObject({ name: 'noc-janitor', enabled: false });
    expect(saved[0]).not.toHaveProperty('running');
    expect(saved[0]).not.toHaveProperty('status');
  });
});
