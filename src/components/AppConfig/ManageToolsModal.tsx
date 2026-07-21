import React, { useMemo, useState } from 'react';
import { css, cx } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';
import { Button, IconButton, Modal, Switch, Input, useStyles2 } from '@grafana/ui';
import { testIds } from '../testIds';
import type { MCPTool } from '../../services/mcpServerStatus';

interface ManageToolsModalProps {
  serverId: string;
  serverName: string;
  tools: MCPTool[];
  loading?: boolean;
  serverEnabled: boolean;
  currentSelections?: Record<string, boolean>;
  isOpen: boolean;
  onDismiss: () => void;
  onSave: (serverId: string, selections: Record<string, boolean>) => void;
}

type ToolRiskKind = 'readOnly' | 'readWrite' | 'destructive';

interface ToolRisk {
  kind: ToolRiskKind;
  label: string;
}

// Tool is enabled by default unless user has explicitly disabled it.
const isEffectivelyEnabled = (toolName: string, selections: Record<string, boolean>) => selections[toolName] ?? true;

const getToolRisk = (tool: MCPTool): ToolRisk => {
  if (tool.annotations?.destructiveHint) {
    return { kind: 'destructive', label: 'Destructive' };
  }

  if (tool.annotations?.readOnlyHint) {
    return { kind: 'readOnly', label: 'Read-only' };
  }

  return { kind: 'readWrite', label: 'Read/write' };
};

export function ManageToolsModal({
  serverId,
  serverName,
  tools,
  loading = false,
  serverEnabled,
  currentSelections = {},
  isOpen,
  onDismiss,
  onSave,
}: ManageToolsModalProps) {
  const [draft, setDraft] = useState<Record<string, boolean>>(currentSelections);
  const [filter, setFilter] = useState('');
  const styles = useStyles2(getStyles);

  const visibleTools = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) {
      return tools;
    }
    return tools.filter((t) => t.name.toLowerCase().includes(q));
  }, [tools, filter]);

  const hasChanges = useMemo(
    () => tools.some((t) => isEffectivelyEnabled(t.name, draft) !== isEffectivelyEnabled(t.name, currentSelections)),
    [tools, draft, currentSelections]
  );

  const setAll = (value: boolean) => {
    const next: Record<string, boolean> = { ...draft };
    for (const t of tools) {
      next[t.name] = value;
    }
    setDraft(next);
  };

  return (
    <Modal
      title={`Tools — ${serverName}`}
      isOpen={isOpen}
      onDismiss={onDismiss}
      data-testid={testIds.appConfig.manageToolsModal}
    >
      <div className={styles.container}>
        {!serverEnabled && (
          <p className={styles.warningText}>
            Server is disabled. Selections can still be edited and will apply once the server is enabled.
          </p>
        )}

        {loading && tools.length === 0 ? (
          <p className={styles.emptyState}>Loading tools…</p>
        ) : tools.length === 0 ? (
          <p className={styles.emptyState}>No tools available for this server.</p>
        ) : (
          <>
            <div className={styles.toolbar}>
              <Input placeholder="Filter tools…" value={filter} onChange={(e) => setFilter(e.currentTarget.value)} />
              <Button variant="secondary" size="sm" onClick={() => setAll(true)}>
                Enable all
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setAll(false)}>
                Disable all
              </Button>
            </div>

            <div className={styles.tableHeader} aria-hidden="true">
              <span>Tool</span>
              <span>Risk</span>
              <span>Enabled</span>
            </div>

            <div className={styles.list}>
              {visibleTools.map((tool) => {
                const risk = getToolRisk(tool);
                const riskClass =
                  risk.kind === 'destructive'
                    ? styles.riskDestructive
                    : risk.kind === 'readOnly'
                    ? styles.riskReadOnly
                    : styles.riskReadWrite;

                return (
                  <div
                    key={tool.name}
                    data-testid={testIds.appConfig.manageToolsToolItem(tool.name)}
                    className={styles.row}
                  >
                    <div className={styles.toolCell}>
                      <span className={styles.toolName}>{tool.name}</span>
                      {tool.description && (
                        <IconButton
                          name="question-circle"
                          size="sm"
                          tooltip={tool.description}
                          tooltipPlacement="top"
                        />
                      )}
                    </div>
                    <span className={cx(styles.riskPill, riskClass)}>{risk.label}</span>
                    <div className={styles.switchCell}>
                      <Switch
                        aria-label={`Toggle ${tool.name}`}
                        value={isEffectivelyEnabled(tool.name, draft)}
                        onChange={(e) => {
                          const checked = (e.currentTarget ?? e.target)?.checked ?? false;
                          setDraft((prev) => ({ ...prev, [tool.name]: checked }));
                        }}
                      />
                    </div>
                  </div>
                );
              })}
              {visibleTools.length === 0 && <p className={styles.emptyState}>No tools match the filter.</p>}
            </div>

            <div className={styles.actions}>
              <Button variant="secondary" onClick={onDismiss}>
                Cancel
              </Button>
              <Button variant="primary" onClick={() => onSave(serverId, draft)} disabled={!hasChanges}>
                Apply
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

const getStyles = (theme: GrafanaTheme2) => ({
  container: css({
    padding: theme.spacing(1),
    width: 'min(780px, calc(100vw - 64px))',
    maxWidth: '100%',
  }),
  warningText: css({
    ...theme.typography.bodySmall,
    color: theme.colors.warning.text,
    margin: theme.spacing(0, 0, 2),
  }),
  toolbar: css({
    display: 'grid',
    gridTemplateColumns: 'minmax(220px, 1fr) auto auto',
    alignItems: 'center',
    gap: theme.spacing(1),
    marginBottom: theme.spacing(2),

    [theme.breakpoints.down('sm')]: {
      gridTemplateColumns: '1fr 1fr',

      '& > :first-child': {
        gridColumn: '1 / -1',
      },
    },
  }),
  tableHeader: css({
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) 112px 72px',
    gap: theme.spacing(2),
    alignItems: 'center',
    padding: theme.spacing(0, 1, 0.75),
    color: theme.colors.text.secondary,
    borderBottom: `1px solid ${theme.colors.border.weak}`,
    ...theme.typography.bodySmall,
    fontWeight: theme.typography.fontWeightMedium,

    '& > :nth-child(2)': {
      textAlign: 'center',
    },

    '& > :nth-child(3)': {
      textAlign: 'right',
    },
  }),
  list: css({
    maxHeight: '60vh',
    overflowY: 'auto',
    paddingRight: theme.spacing(0.5),
  }),
  row: css({
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) 112px 72px',
    gap: theme.spacing(2),
    alignItems: 'center',
    minHeight: 44,
    padding: theme.spacing(1, 1),
    borderBottom: `1px solid ${theme.colors.border.weak}`,

    '&:last-child': {
      borderBottom: 0,
    },
  }),
  toolCell: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(0.5),
    minWidth: 0,
  }),
  toolName: css({
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    color: theme.colors.text.primary,
    fontFamily: theme.typography.fontFamilyMonospace,
    fontSize: theme.typography.bodySmall.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
  }),
  riskPill: css({
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 24,
    padding: theme.spacing(0.25, 1),
    borderRadius: theme.shape.radius.default,
    border: '1px solid transparent',
    fontSize: theme.typography.bodySmall.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
    lineHeight: 1,
    whiteSpace: 'nowrap',
  }),
  riskReadOnly: css({
    color: theme.colors.info.text,
    background: theme.colors.info.transparent,
    borderColor: theme.colors.info.borderTransparent,
  }),
  riskReadWrite: css({
    color: theme.colors.warning.text,
    background: theme.colors.warning.transparent,
    borderColor: theme.colors.warning.borderTransparent,
  }),
  riskDestructive: css({
    color: theme.colors.error.text,
    background: theme.colors.error.transparent,
    borderColor: theme.colors.error.borderTransparent,
  }),
  switchCell: css({
    display: 'flex',
    justifyContent: 'flex-end',
  }),
  emptyState: css({
    ...theme.typography.bodySmall,
    color: theme.colors.text.secondary,
    padding: theme.spacing(3, 1),
    textAlign: 'center',
  }),
  actions: css({
    display: 'flex',
    gap: theme.spacing(1),
    justifyContent: 'flex-end',
    marginTop: theme.spacing(2),
  }),
});
