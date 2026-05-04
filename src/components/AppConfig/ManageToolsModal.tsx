import React, { useMemo, useState } from 'react';
import { Button, Modal, Switch, Input } from '@grafana/ui';
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

// Tool is enabled by default unless user has explicitly disabled it.
const isEffectivelyEnabled = (toolName: string, selections: Record<string, boolean>) =>
  selections[toolName] ?? true;

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

  const visibleTools = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) {
      return tools;
    }
    return tools.filter(
      (t) => t.name.toLowerCase().includes(q) || (t.description ?? '').toLowerCase().includes(q)
    );
  }, [tools, filter]);

  const hasChanges = useMemo(
    () =>
      tools.some(
        (t) => isEffectivelyEnabled(t.name, draft) !== isEffectivelyEnabled(t.name, currentSelections)
      ),
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
      <div className="p-2">
        {!serverEnabled && (
          <p className="text-xs text-warning mb-3">
            Server is disabled. Selections can still be edited and will apply once the server is enabled.
          </p>
        )}

        {loading && tools.length === 0 ? (
          <p className="text-secondary text-sm py-6 text-center">Loading tools…</p>
        ) : tools.length === 0 ? (
          <p className="text-secondary text-sm py-4 text-center">No tools available for this server.</p>
        ) : (
          <>
            <div className="flex items-center gap-2 mb-3">
              <Input
                placeholder="Filter tools…"
                value={filter}
                onChange={(e) => setFilter(e.currentTarget.value)}
              />
              <Button variant="secondary" size="sm" onClick={() => setAll(true)}>
                Enable all
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setAll(false)}>
                Disable all
              </Button>
            </div>

            <div className="max-h-[60vh] overflow-y-auto pr-1">
              {visibleTools.map((tool) => (
                <div
                  key={tool.name}
                  data-testid={testIds.appConfig.manageToolsToolItem(tool.name)}
                  className="flex items-start justify-between gap-3 py-3 border-b border-weak last:border-b-0"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm">{tool.name}</span>
                      {tool.annotations?.readOnlyHint === true && (
                        <span className="inline-block px-1.5 rounded bg-info text-info-text text-xs">
                          Read-only
                        </span>
                      )}
                      {tool.annotations?.destructiveHint === true && (
                        <span className="inline-block px-1.5 rounded bg-error text-error-text text-xs">
                          Destructive
                        </span>
                      )}
                    </div>
                    {tool.description && (
                      <p className="text-xs text-secondary mt-0.5 line-clamp-2">{tool.description}</p>
                    )}
                  </div>
                  <Switch
                    value={isEffectivelyEnabled(tool.name, draft)}
                    onChange={(e) => {
                      const checked = (e.currentTarget ?? e.target)?.checked ?? false;
                      setDraft((prev) => ({ ...prev, [tool.name]: checked }));
                    }}
                  />
                </div>
              ))}
              {visibleTools.length === 0 && (
                <p className="text-secondary text-sm py-4 text-center">No tools match the filter.</p>
              )}
            </div>

            <div className="flex gap-2 mt-4 justify-end">
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
