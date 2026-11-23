/**
 * Unit tests for the Workflows AppConfig tab
 */

import React from 'react';
import { of, throwError } from 'rxjs';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { getBackendSrv } from '@grafana/runtime';
import { WorkflowsTab } from './Workflows';

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

type FetchCfg = {
  url: string;
  method?: string;
  data?: { workflows?: Array<Record<string, unknown>> };
};

/** Routes every backend call through `handler` and records the configs. */
const routeFetch = (handler: (cfg: FetchCfg) => unknown, requests: FetchCfg[] = []): FetchCfg[] => {
  fetchMock.mockImplementation(() => ({
    fetch: (cfg: FetchCfg) => {
      requests.push(cfg);
      return handler(cfg);
    },
  }));
  return requests;
};

const isWorkflowsSave = (cfg: FetchCfg) => cfg.method === 'PUT' && cfg.url.endsWith('/api/workflows');

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

const renderTab = (onEditPrompt: (skill: string) => void = jest.fn()) =>
  render(<WorkflowsTab onEditPrompt={onEditPrompt} />);

describe('WorkflowsTab', () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  it('seeds its rows from the GET on mount', async () => {
    const requests = routeFetch(() => of({ data: workflowsResponse() }));
    renderTab();

    // The name and skill cells share the value; both render on success.
    expect((await screen.findAllByText('noc-dispatch')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('noc-janitor').length).toBeGreaterThan(0);
    expect(screen.getByText(/3 \/ 2 \/ 1 \/ 0/)).toBeInTheDocument();
    expect(screen.getByText(/executed/)).toBeInTheDocument();

    // The tab self-sources: one GET, no settings read on its behalf.
    const workflowGets = requests.filter((cfg) => cfg.url.endsWith('/api/workflows') && !cfg.method);
    expect(workflowGets).toHaveLength(1);
    expect(requests.some((cfg) => cfg.url.endsWith('/settings'))).toBe(false);
  });

  it('renders the empty state when no workflows are configured', async () => {
    routeFetch(() => of({ data: { workflows: [] } }));
    renderTab();

    expect(await screen.findByText(/No workflows configured/i)).toBeInTheDocument();
  });

  it('shows a load error with retry', async () => {
    routeFetch(() => throwError(() => new Error('boom')));
    renderTab();

    expect(await screen.findByText(/Failed to load workflow status/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('expands a workflow, lists its runs, and opens a share link', async () => {
    routeFetch((cfg) => {
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
    });
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

  it('surfaces a failed share POST instead of failing silently', async () => {
    routeFetch((cfg) => {
      if (cfg.method === 'POST' && cfg.url.includes('/share')) {
        return throwError(() => new Error('boom'));
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
    });
    const { locationService } = jest.requireMock('@grafana/runtime');
    locationService.push.mockClear();
    renderTab();

    const sessionsButtons = await screen.findAllByRole('button', { name: 'Sessions' });
    fireEvent.click(sessionsButtons[0]);

    const open = await screen.findByRole('button', { name: 'Open' });
    fireEvent.click(open);

    expect(await screen.findByTestId('ac-workflow-share-error')).toHaveTextContent(
      /share link could not be created/i
    );
    expect(locationService.push).not.toHaveBeenCalled();
  });

  it('PUTs the edited entry list and closes the editor on success', async () => {
    const requests = routeFetch((cfg) => of({ data: isWorkflowsSave(cfg) ? workflowsResponse() : workflowsResponse() }));
    renderTab();

    const editButtons = await screen.findAllByRole('button', { name: 'Edit' });
    fireEvent.click(editButtons[0]);

    expect(screen.getByText('Edit noc-dispatch')).toBeInTheDocument();
    const nameInput = screen.getByDisplayValue('noc-dispatch');
    expect((nameInput as HTMLInputElement).disabled).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(requests.some(isWorkflowsSave)).toBe(true));
    const put = requests.find(isWorkflowsSave)!;
    const payload = put.data!.workflows!;
    expect(payload).toHaveLength(2);
    expect(payload[0]).toMatchObject({ name: 'noc-dispatch', skill: 'noc-dispatch', enabled: true });
    // Runtime state and the org never travel back in a save.
    expect(payload[0]).not.toHaveProperty('running');
    expect(payload[0]).not.toHaveProperty('status');
    expect(payload[0]).not.toHaveProperty('orgId');

    await waitFor(() => expect(screen.queryByTestId('ac-workflow-editor')).not.toBeInTheDocument());
  });

  it('jumps to the skill prompt editor', async () => {
    routeFetch(() => of({ data: workflowsResponse() }));
    const onEditPrompt = jest.fn();
    renderTab(onEditPrompt);

    const promptButtons = await screen.findAllByRole('button', { name: 'Prompt' });
    fireEvent.click(promptButtons[0]);
    expect(onEditPrompt).toHaveBeenCalledWith('noc-dispatch');
  });

  it('encodes workflow names with spaces and percent signs in the runs URL', async () => {
    const requests: FetchCfg[] = [];
    const base = workflowsResponse().workflows[0];
    routeFetch((cfg) => {
      if (cfg.url.includes('/runs')) {
        return of({ data: { runs: [] } });
      }
      return of({
        data: {
          workflows: [
            { ...base, name: 'Nightly RCA', skill: 'dispatch' },
            { ...base, name: '50% RCA', skill: 'dispatch' },
          ],
        },
      });
    }, requests);
    renderTab();

    const sessionsButtons = await screen.findAllByRole('button', { name: 'Sessions' });
    fireEvent.click(sessionsButtons[0]);
    await waitFor(() =>
      expect(requests.some((cfg) => cfg.url.endsWith('/Nightly%20RCA/runs?limit=100'))).toBe(true)
    );

    fireEvent.click(sessionsButtons[1]);
    await waitFor(() =>
      expect(requests.some((cfg) => cfg.url.endsWith('/50%25%20RCA/runs?limit=100'))).toBe(true)
    );
  });

  it('rejects an invalid workflow name inline and PUTs the trimmed name', async () => {
    const requests = routeFetch((cfg) =>
      of({ data: isWorkflowsSave(cfg) ? cfg.data : { workflows: [] } })
    );
    renderTab();

    fireEvent.click(await screen.findByRole('button', { name: 'New workflow' }));
    const nameInput = screen.getByLabelText('Name');
    const save = screen.getByRole('button', { name: 'Save' });

    // "/" is a route separator: the runs GET and the share POST would cut the
    // path at different places.
    fireEvent.change(nameInput, { target: { value: 'x/runs/y' } });
    expect(screen.getByTestId('ac-workflow-name-error')).toHaveTextContent('Name must not contain "/".');
    expect(save).toBeDisabled();
    expect(requests.some(isWorkflowsSave)).toBe(false);

    // A control character corrupts Redis keys and log lines.
    fireEvent.change(nameInput, { target: { value: 'a\u0000b' } });
    expect(screen.getByTestId('ac-workflow-name-error')).toHaveTextContent('control characters');

    // Spaces inside the name are legal.
    fireEvent.change(nameInput, { target: { value: '  Nightly RCA  ' } });
    expect(screen.queryByTestId('ac-workflow-name-error')).not.toBeInTheDocument();

    await waitFor(() =>
      expect(screen.getByLabelText('Skill').querySelectorAll('option').length).toBeGreaterThan(0)
    );
    fireEvent.change(screen.getByLabelText('Skill'), { target: { value: 'investigating-alerts' } });
    fireEvent.change(screen.getByLabelText('Tool allowlist'), { target: { value: 'irm_list_alert_groups' } });

    expect(save).not.toBeDisabled();
    fireEvent.click(save);

    await waitFor(() => expect(requests.some(isWorkflowsSave)).toBe(true));
    const payload = requests.find(isWorkflowsSave)!.data!.workflows!;
    expect(payload).toHaveLength(1);
    expect(payload[0]).toMatchObject({
      name: 'Nightly RCA',
      skill: 'investigating-alerts',
      toolAllowlist: ['irm_list_alert_groups'],
    });
    expect(payload[0]).not.toHaveProperty('orgId');
  });

  it('toggles a workflow through one PUT of the full entry list', async () => {
    const requests = routeFetch((cfg) =>
      of({ data: isWorkflowsSave(cfg) ? cfg.data : workflowsResponse() })
    );
    renderTab();

    const toggles = await screen.findAllByRole('checkbox');
    // First row is noc-dispatch (enabled); switching it off must persist the
    // whole list minus the runtime join.
    fireEvent.click(toggles[0]);

    await waitFor(() => expect(requests.some(isWorkflowsSave)).toBe(true));
    const payload = requests.find(isWorkflowsSave)!.data!.workflows!;
    expect(payload).toHaveLength(2);
    expect(payload[0]).toMatchObject({ name: 'noc-dispatch', enabled: false });
    expect(payload[1]).toMatchObject({ name: 'noc-janitor', enabled: false });
    expect(payload[0]).not.toHaveProperty('running');
    expect(payload[0]).not.toHaveProperty('status');
    expect(payload[0]).not.toHaveProperty('orgId');
  });

  it('deletes a workflow through the same PUT path', async () => {
    const requests = routeFetch((cfg) => {
      if (isWorkflowsSave(cfg)) {
        return of({ data: { workflows: [workflowsResponse().workflows[1]] } });
      }
      return of({ data: workflowsResponse() });
    });
    renderTab();

    const editButtons = await screen.findAllByRole('button', { name: 'Edit' });
    fireEvent.click(editButtons[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Delete workflow' }));

    await waitFor(() => expect(requests.some(isWorkflowsSave)).toBe(true));
    const payload = requests.find(isWorkflowsSave)!.data!.workflows!;
    expect(payload.map((entry) => entry.name)).toEqual(['noc-janitor']);

    // The read-back seeds the table: the removed row is gone, the editor closed.
    await waitFor(() => expect(screen.queryByText('noc-dispatch')).not.toBeInTheDocument());
    expect(screen.queryByTestId('ac-workflow-editor')).not.toBeInTheDocument();
    // The name renders in the name cell and again in the skill cell, so assert
    // on the remaining row instead of on the shared text.
    const tableRows = screen.getAllByRole('row');
    expect(tableRows).toHaveLength(2); // header + the one remaining workflow
    expect(tableRows[1]).toHaveTextContent('noc-janitor');
  });

  it('keeps the rows and the editor open and shows a 400 error inline', async () => {
    const requests = routeFetch((cfg) => {
      if (isWorkflowsSave(cfg)) {
        return throwError(() => ({
          status: 400,
          data: { errors: [{ name: 'Nightly RCA', error: 'name must not contain "/"' }] },
        }));
      }
      return of({ data: workflowsResponse() });
    });
    renderTab();

    const editButtons = await screen.findAllByRole('button', { name: 'Edit' });
    fireEvent.click(editButtons[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    const error = await screen.findByTestId('ac-workflow-save-error');
    expect(error).toHaveTextContent(/Nightly RCA: name must not contain/);
    expect(error.className).toContain('text-warning');
    // A rejected save is all-or-nothing: the editor stays, the rows do not move.
    expect(screen.getByTestId('ac-workflow-editor')).toBeInTheDocument();
    expect(screen.getAllByText('noc-dispatch').length).toBeGreaterThan(0);
    expect(screen.getByText(/3 \/ 2 \/ 1 \/ 0/)).toBeInTheDocument();
    expect(requests.filter(isWorkflowsSave)).toHaveLength(1);
  });

  it('replaces its rows with the PUT read-back on success', async () => {
    const updated = workflowsResponse();
    updated.workflows[0].status.started = 9;
    routeFetch((cfg) => of({ data: isWorkflowsSave(cfg) ? updated : workflowsResponse() }));
    renderTab();

    const toggles = await screen.findAllByRole('checkbox');
    fireEvent.click(toggles[0]);

    await waitFor(() => expect(screen.getByText(/9 \/ 2 \/ 1 \/ 0/)).toBeInTheDocument());
    expect(screen.queryByTestId('ac-workflow-save-error')).not.toBeInTheDocument();
  });

  it('never writes through the Grafana plugin settings URL', async () => {
    const requests = routeFetch((cfg) =>
      of({ data: isWorkflowsSave(cfg) ? cfg.data : workflowsResponse() })
    );
    renderTab();

    const toggles = await screen.findAllByRole('checkbox');
    fireEvent.click(toggles[0]);
    await waitFor(() => expect(requests.some(isWorkflowsSave)).toBe(true));

    const settingsCalls = requests.filter((cfg) => cfg.url.endsWith('/settings'));
    expect(settingsCalls).toHaveLength(0);
  });
});
