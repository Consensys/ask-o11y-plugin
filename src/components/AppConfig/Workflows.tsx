import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { lastValueFrom } from 'rxjs';

import {
  Badge,
  Button,
  Combobox,
  type ComboboxOption,
  Field,
  Input,
  LoadingPlaceholder,
  Switch,
  TextArea,
  useTheme2,
} from '@grafana/ui';
import { getBackendSrv, locationService } from '@grafana/runtime';

import { listSkills, type SkillInfo } from '../../services/skillsClient';
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

type WorkflowRun = {
  runId: string;
  sessionId?: string;
  status: string;
  skill?: string;
  createdAt: string;
  updatedAt: string;
  error?: string;
};

type WorkflowsTabProps = {
  savedWorkflows: WorkflowEntryUI[];
  onSaveWorkflows: (next: WorkflowEntryUI[]) => void;
  /** Opens the Skills tab with this skill's editor loaded. */
  onEditPrompt: (skill: string) => void;
};

const tickOutcomeColor = (outcome?: string) => {
  switch (outcome) {
    case 'executed':
      return 'green' as const;
    case 'skip_lock':
    case 'skip_identity':
      return 'blue' as const;
    default:
      return 'orange' as const;
  }
};

const runStatusColor = (status: string) => {
  switch (status) {
    case 'completed':
      return 'green' as const;
    case 'running':
      return 'blue' as const;
    case 'failed':
    case 'timeout':
      return 'orange' as const;
    default:
      return 'orange' as const;
  }
};

function formatTime(iso?: string): string {
  if (!iso) {
    return 'never';
  }
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) {
    return 'never';
  }
  return parsed.toLocaleTimeString();
}

const linesToList = (text: string): string[] =>
  text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

const listToLines = (list?: string[]): string => (list ?? []).join('\n');

const MODEL_OPTIONS: Array<ComboboxOption<string>> = [
  { label: 'Auto (skill decides)', value: '' },
  { label: 'Base', value: 'base' },
  { label: 'Large', value: 'large' },
];

export function WorkflowsTab({ savedWorkflows, onSaveWorkflows, onEditPrompt }: WorkflowsTabProps): React.ReactElement {
  const theme = useTheme2();
  const [rows, setRows] = useState<WorkflowRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [runs, setRuns] = useState<Record<string, WorkflowRun[]>>({});
  const [runsError, setRunsError] = useState<Record<string, string | null>>({});
  const [skills, setSkills] = useState<SkillInfo[] | null>(null);
  const [skillsError, setSkillsError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ original: string | null; entry: WorkflowEntryUI } | null>(null);

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

  const loadRuns = useCallback(async (name: string) => {
    try {
      const res = await lastValueFrom(
        getBackendSrv().fetch<{ runs: WorkflowRun[] }>({ url: `${WORKFLOWS_URL}/${name}/runs?limit=20` })
      );
      setRuns((prev) => ({ ...prev, [name]: res.data.runs ?? [] }));
      setRunsError((prev) => ({ ...prev, [name]: null }));
    } catch {
      // A failed listing must read as an error, not as an empty history.
      setRuns((prev) => ({ ...prev, [name]: [] }));
      setRunsError((prev) => ({ ...prev, [name]: 'Failed to load sessions for this workflow.' }));
    }
  }, []);

  useEffect(() => {
    void load();
    listSkills()
      .then((list) => {
        setSkills(list.filter((s) => s.enabled && !s.hidden && !s.invalid));
        setSkillsError(null);
      })
      .catch(() => {
        // An unavailable skill list must read as an error, not as zero skills.
        setSkills([]);
        setSkillsError('Failed to load skills; pickers show no options.');
      });
  }, [load]);

  const toggleWorkflow = async (row: WorkflowRow, enabled: boolean) => {
    // No refetch: the save reloads the page (saveAndReload), which remounts
    // this tab and loads fresh status.
    const next = (rows ?? []).map((r) => {
      const { running: _running, status: _status, ...entry } = r;
      return entry.name === row.name ? { ...entry, enabled } : entry;
    });
    onSaveWorkflows(next);
  };

  const persistEntry = (original: string | null, rawEntry: WorkflowEntryUI) => {
    // The backend keys schedulers and session owners by the trimmed name;
    // persist trimmed so UI lookups and runs fetches match.
    const entry = { ...rawEntry, name: rawEntry.name.trim() };
    const base = (rows ?? []).map((r) => {
      const { running: _running, status: _status, ...saved } = r;
      return saved;
    });
    let next: WorkflowEntryUI[];
    if (original === null) {
      next = [...base, entry];
    } else {
      next = base.map((saved) => (saved.name === original ? entry : saved));
    }
    onSaveWorkflows(next);
  };

  const deleteEntry = (name: string) => {
    const base = (rows ?? []).map((r) => {
      const { running: _running, status: _status, ...saved } = r;
      return saved;
    });
    onSaveWorkflows(base.filter((saved) => saved.name !== name));
  };

  const openSession = (run: WorkflowRun) => {
    if (run.sessionId) {
      locationService.push(`/a/consensys-asko11y-app?sessionId=${run.sessionId}`);
    }
  };

  const skillOptions: Array<ComboboxOption<string>> = useMemo(
    () => (skills ?? []).map((s) => ({ label: s.name, value: s.name, description: s.description })),
    [skills]
  );

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

  const border = { borderBottom: `1px solid ${theme.colors.border.weak}` };

  return (
    <div>
      <p className="text-sm text-secondary mb-2">
        Tick and session counters are reported by this Grafana instance only; each replica runs its own schedulers
        behind a shared Redis tick lock. Every save reloads the plugin instance, which restarts the schedulers.
      </p>

      {editing && (
        <div className="mb-4 p-3" style={{ border: `1px solid ${theme.colors.border.weak}` }} data-testid="ac-workflow-editor">
          <h3 className="text-base mb-2">{editing.original === null ? 'New workflow' : `Edit ${editing.original}`}</h3>
          {skillsError && <p className="text-warning text-sm mb-2">{skillsError}</p>}
          <div className="grid grid-cols-2 gap-2 mb-2">
            <Field label="Name" description={editing.original === null ? 'Stable identifier; renaming later orphans its sessions' : undefined}>
              <Input
                value={editing.entry.name}
                disabled={editing.original !== null}
                onChange={(e) => setEditing({ ...editing, entry: { ...editing.entry, name: e.currentTarget.value } })}
              />
            </Field>
            <Field label="Skill" description="Enabled public skill the sessions run">
              <Combobox<string>
                options={skillOptions}
                value={editing.entry.skill || undefined}
                onChange={(o) => setEditing({ ...editing, entry: { ...editing.entry, skill: o.value ?? '' } })}
                width={30}
              />
            </Field>
            <Field label="Model">
              <Combobox<string>
                options={MODEL_OPTIONS}
                value={editing.entry.model ?? ''}
                onChange={(o) => setEditing({ ...editing, entry: { ...editing.entry, model: o.value ?? '' } })}
                width={30}
              />
            </Field>
            <Field label="Interval (seconds)" description="Minimum 60, default 300">
              <Input
                type="number"
                value={editing.entry.intervalSeconds ?? 300}
                onChange={(e) =>
                  setEditing({ ...editing, entry: { ...editing.entry, intervalSeconds: Number(e.currentTarget.value) } })
                }
              />
            </Field>
            <Field label="Session timeout (seconds)" description="Watchdog budget, minimum 60, default 300">
              <Input
                type="number"
                value={editing.entry.sessionTimeoutSeconds ?? 300}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    entry: { ...editing.entry, sessionTimeoutSeconds: Number(e.currentTarget.value) },
                  })
                }
              />
            </Field>
            <Field label="Max concurrent sessions" description="Cross-replica cap for spawned sessions, default 5">
              <Input
                type="number"
                value={editing.entry.maxConcurrentSessions ?? 5}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    entry: { ...editing.entry, maxConcurrentSessions: Number(e.currentTarget.value) },
                  })
                }
              />
            </Field>
            <Field label="Max iterations" description="Optional; the skill budget applies when unset">
              <Input
                type="number"
                value={editing.entry.maxIterations ?? 0}
                onChange={(e) =>
                  setEditing({ ...editing, entry: { ...editing.entry, maxIterations: Number(e.currentTarget.value) } })
                }
              />
            </Field>
            <Field label="Spawnable skills" description="One per line; skills the dispatcher may spawn">
              <TextArea
                rows={2}
                value={listToLines(editing.entry.spawnableSkills)}
                onChange={(e) =>
                  setEditing({ ...editing, entry: { ...editing.entry, spawnableSkills: linesToList(e.currentTarget.value) } })
                }
              />
            </Field>
            <Field label="Fallback skill" description="Runs once after a failed or timed-out session">
              <Combobox<string>
                options={[{ label: 'None', value: '' }, ...skillOptions]}
                value={editing.entry.fallbackSkill ?? ''}
                onChange={(o) => setEditing({ ...editing, entry: { ...editing.entry, fallbackSkill: o.value ?? '' } })}
                width={30}
              />
            </Field>
          </div>
          <Field label="Tick message" description="First message of every tick session; defaults to a run-the-skill line">
            <TextArea
              rows={2}
              value={editing.entry.message ?? ''}
              onChange={(e) => setEditing({ ...editing, entry: { ...editing.entry, message: e.currentTarget.value } })}
            />
          </Field>
          <Field label="Tool allowlist" description="One MCP tool name per line; the sessions see nothing else">
            <TextArea
              rows={3}
              value={listToLines(editing.entry.toolAllowlist)}
              onChange={(e) =>
                setEditing({ ...editing, entry: { ...editing.entry, toolAllowlist: linesToList(e.currentTarget.value) } })
              }
            />
          </Field>
          <div className="flex items-center gap-2 mt-2">
            <Button
              variant="primary"
              disabled={!editing.entry.name.trim() || !editing.entry.skill || editing.entry.toolAllowlist.length === 0}
              onClick={() => persistEntry(editing.original, editing.entry)}
            >
              Save and reload
            </Button>
            {editing.entry.skill && (
              <Button variant="secondary" onClick={() => onEditPrompt(editing.entry.skill ?? '')}>
                Edit prompt
              </Button>
            )}
            {editing.original !== null && (
              <Button
                variant="destructive"
                onClick={() => {
                  if (editing.original) {
                    deleteEntry(editing.original);
                  }
                }}
              >
                Delete workflow
              </Button>
            )}
            <Button variant="secondary" onClick={() => setEditing(null)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      <div className="mb-2 flex gap-2">
        <Button
          variant="primary"
          onClick={() =>
            setEditing({
              original: null,
              entry: {
                name: '',
                enabled: true,
                skill: '',
                toolAllowlist: [],
                intervalSeconds: 300,
                sessionTimeoutSeconds: 300,
                maxConcurrentSessions: 5,
              },
            })
          }
        >
          New workflow
        </Button>
        <Button variant="secondary" disabled={refreshing} onClick={() => void load()}>
          Refresh
        </Button>
        {loadError && <span className="text-warning self-center">{loadError}</span>}
      </div>

      {(rows ?? []).length === 0 ? (
        <p className="text-sm text-secondary">
          No workflows configured. Create one above, or provision entries in the plugin settings
          (jsonData.workflows) — see the Workflows section in the plugin README.
        </p>
      ) : (
        <table className="w-full text-sm" style={{ borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: `1px solid ${theme.colors.border.weak}` }}>
              <th className="p-1">Workflow</th>
              <th className="p-1">Skill</th>
              <th className="p-1">Enabled</th>
              <th className="p-1">Interval</th>
              <th className="p-1">Last tick</th>
              <th className="p-1">Sessions started / done / failed / timeout</th>
              <th className="p-1">Actions</th>
            </tr>
          </thead>
          <tbody>
            {(rows ?? []).map((row) => (
              <React.Fragment key={row.name}>
                <tr style={border}>
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
                  <td className="p-1">{row.intervalSeconds || 300}s</td>
                  <td className="p-1" title={row.status?.lastError ?? undefined}>
                    {row.status?.lastTickOutcome ? (
                      <Badge
                        text={`${row.status.lastTickOutcome} ${formatTime(row.status.lastTickAt)}`}
                        color={tickOutcomeColor(row.status.lastTickOutcome)}
                      />
                    ) : (
                      <span className="text-secondary">never</span>
                    )}
                  </td>
                  <td className="p-1">
                    {row.status?.started ?? 0} / {row.status?.completed ?? 0} / {row.status?.failed ?? 0} /{' '}
                    {row.status?.timeout ?? 0}
                  </td>
                  <td className="p-1">
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        const next = expanded === row.name ? null : row.name;
                        setExpanded(next);
                        if (next) {
                          void loadRuns(next);
                        }
                      }}
                    >
                      {expanded === row.name ? 'Hide sessions' : 'Sessions'}
                    </Button>{' '}
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        const { running: _r, status: _s, ...entry } = row;
                        setEditing({ original: row.name, entry });
                      }}
                    >
                      Edit
                    </Button>{' '}
                    <Button size="sm" variant="secondary" onClick={() => onEditPrompt(row.skill)}>
                      Prompt
                    </Button>
                  </td>
                </tr>
                {expanded === row.name && (
                  <tr style={border}>
                    <td colSpan={7} className="p-2" data-testid={`ac-workflow-runs-${row.name}`}>
                      {runsError[row.name] ? (
                        <span className="text-warning">{runsError[row.name]}</span>
                      ) : (runs[row.name] ?? []).length === 0 ? (
                        <span className="text-secondary">No sessions recorded yet on this instance.</span>
                      ) : (
                        (runs[row.name] ?? []).map((run) => (
                          <div key={run.runId} className="flex items-center gap-2 py-1">
                            <Badge text={run.status} color={runStatusColor(run.status)} />
                            <span className="text-secondary">{run.runId.slice(0, 8)}</span>
                            <span className="text-secondary">{formatTime(run.createdAt)}</span>
                            {run.error && <span className="text-warning">{run.error}</span>}
                            {run.sessionId && (
                              <Button size="sm" variant="primary" onClick={() => openSession(run)}>
                                Open
                              </Button>
                            )}
                          </div>
                        ))
                      )}
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      )}
      {savedWorkflows.length === 0 && (rows ?? []).length > 0 && (
        <span className="text-secondary text-sm mt-2 block">
          Note: the saved settings carry no workflow entries; the rows above come from the running instance only.
        </span>
      )}
    </div>
  );
}
