import React, { useCallback, useEffect, useState } from 'react';
import { lastValueFrom } from 'rxjs';

import {
  Badge,
  Button,
  LoadingPlaceholder,
  Switch,
  useTheme2,
} from '@grafana/ui';
import { getBackendSrv } from '@grafana/runtime';

import type { WorkflowEntryUI } from '../../types/plugin';

const WORKFLOWS_URL = '/api/plugins/consensys-asko11y-app/resources/api/workflows';

type WorkflowRow = WorkflowEntryUI & {
  running: boolean;
  status: {
    lastTickAt?: string;
    lastTickOutcome?: string;
    started: number;
    completed: number;
    failed: number;
    cancelled: number;
    timeout: number;
    lastError?: string;
  };
};

type WorkflowsTabProps = {
  savedWorkflows: WorkflowEntryUI[];
  onSaveWorkflows: (next: WorkflowEntryUI[]) => void;
};

const tickOutcomeSeverity = (outcome?: string) => {
  switch (outcome) {
    case 'executed':
      return 'success' as const;
    case 'skip_lock':
    case 'skip_identity':
      return 'info' as const;
    default:
      return 'warning' as const;
  }
};

function formatTickTime(iso?: string): string {
  if (!iso) {
    return 'never';
  }
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) {
    return 'never';
  }
  return parsed.toLocaleTimeString();
}

export function WorkflowsTab({ savedWorkflows, onSaveWorkflows }: WorkflowsTabProps): React.ReactElement {
  const theme = useTheme2();
  const [rows, setRows] = useState<WorkflowRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await lastValueFrom(
        getBackendSrv().fetch<{ workflows: WorkflowRow[] }>({ url: WORKFLOWS_URL })
      );
      setRows(res.data.workflows ?? []);
      setLoadError(null);
    } catch {
      setLoadError('Failed to load workflow status. Is the plugin running with Redis configured?');
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleWorkflow = async (row: WorkflowRow, enabled: boolean) => {
    // The API row carries every configured field, so the next array is
    // lossless: strip the runtime join, apply the toggle, save, reload (the
    // schedulers restart with the plugin instance).
    const next = (rows ?? []).map((r) => {
      const { running: _running, status: _status, ...entry } = r;
      return entry.name === row.name ? { ...entry, enabled } : entry;
    });
    onSaveWorkflows(next);
    void load();
  };

  if (rows === null && !loadError) {
    return <LoadingPlaceholder text="Loading workflows..." />;
  }

  if (loadError && rows === null) {
    return (
      <div>
        <p className="text-sm text-secondary mb-2">{loadError}</p>
        <Button variant="secondary" onClick={() => void load()}>
          Retry
        </Button>
      </div>
    );
  }

  if ((rows ?? []).length === 0) {
    return (
      <p className="text-sm text-secondary">
        No workflows configured. Workflow entries are provisioned in the plugin settings
        (jsonData.workflows) or the provisioning file — see the Workflows section in the plugin
        README for the full field reference.
      </p>
    );
  }

  return (
    <div>
      <p className="text-sm text-secondary mb-2">
        Tick and session counters are reported by this Grafana instance only; each replica runs its
        own schedulers behind a shared Redis tick lock. Toggling a workflow saves immediately and
        restarts the plugin instance.
      </p>
      <table className="w-full text-sm" style={{ borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ textAlign: 'left', borderBottom: `1px solid ${theme.colors.border.weak}` }}>
            <th className="p-1">Workflow</th>
            <th className="p-1">Skill</th>
            <th className="p-1">Enabled</th>
            <th className="p-1">Interval</th>
            <th className="p-1">Last tick</th>
            <th className="p-1">Sessions started / done / failed / timeout</th>
          </tr>
        </thead>
        <tbody>
          {(rows ?? []).map((row) => (
            <tr key={row.name} style={{ borderBottom: `1px solid ${theme.colors.border.weak}` }}>
              <td className="p-1">
                <span className="mr-1">{row.name}</span>
                {row.running ? (
                  <Badge text="running" color="green" />
                ) : (
                  <Badge text="stopped" color="orange" />
                )}
              </td>
              <td className="p-1">{row.skill}</td>
              <td className="p-1">
                <Switch
                  value={row.enabled}
                  onChange={(e) => void toggleWorkflow(row, e.currentTarget.checked)}
                  data-testid={`ac-workflow-enabled-${row.name}`}
                />
              </td>
              <td className="p-1">{row.intervalSeconds ?? 300}s</td>
              <td className="p-1" title={row.status?.lastError ?? undefined}>
                {row.status?.lastTickOutcome ? (
                  <Badge
                    text={`${row.status.lastTickOutcome} ${formatTickTime(row.status.lastTickAt)}`}
                    color={tickOutcomeSeverity(row.status.lastTickOutcome) === 'success' ? 'green' : tickOutcomeSeverity(row.status.lastTickOutcome) === 'info' ? 'blue' : 'orange'}
                  />
                ) : (
                  <span className="text-secondary">never</span>
                )}
              </td>
              <td className="p-1">
                {row.status?.started ?? 0} / {row.status?.completed ?? 0} /{' '}
                {row.status?.failed ?? 0} / {row.status?.timeout ?? 0}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-2">
        <Button variant="secondary" disabled={refreshing} onClick={() => void load()}>
          Refresh
        </Button>
        {loadError && <span className="ml-2 text-warning">{loadError}</span>}
        {savedWorkflows.length === 0 && (
          <span className="ml-2 text-secondary">
            Note: the saved settings carry no workflow entries; the rows above come from the running
            instance only.
          </span>
        )}
      </div>
    </div>
  );
}
