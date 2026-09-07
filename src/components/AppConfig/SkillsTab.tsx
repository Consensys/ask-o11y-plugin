import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Button, FieldSet, Spinner, Switch, useTheme2 } from '@grafana/ui';
import { listSkillsWithContent, type SkillInfo } from '../../services/skillsClient';
import { testIds } from '../testIds';
import type { SkillEntry } from '../../types/plugin';
import { SkillEditor } from './SkillEditor';

interface SkillsTabProps {
  /** Entries currently persisted in plugin jsonData. */
  savedEntries: Record<string, SkillEntry>;
  /** Persists new entries through the plugin admin API and reloads. */
  onSaveEntries: (entries: Record<string, SkillEntry>) => void;
  /** Bundled skills still driven by legacy pre-skills prompt fields. */
  legacyPromptSkills?: string[];
}

const NEW_SKILL_TEMPLATE = `---
name: my-new-skill
description: >-
  Describe what this skill does and when to use it. Use when the user asks
  about ... (third person, include trigger keywords).
metadata:
  version: "1.0"
---

## Workflow

1. First step
2. Second step
`;

export function SkillsTab({ savedEntries, onSaveEntries, legacyPromptSkills = [] }: SkillsTabProps): React.ReactElement {
  const theme = useTheme2();
  const [skills, setSkills] = useState<SkillInfo[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ name: string | null; content: string; bundledDefault?: string } | null>(
    null
  );

  useEffect(() => {
    let cancelled = false;
    listSkillsWithContent()
      .then((list) => {
        if (!cancelled) {
          setSkills(list);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : 'Failed to load skills');
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const entries = useMemo(() => savedEntries ?? {}, [savedEntries]);

  const persist = (next: Record<string, SkillEntry>) => {
    onSaveEntries(next);
  };

  const setEntry = (name: string, entry: SkillEntry | null) => {
    const next = { ...entries };
    if (entry === null || (entry.content === undefined && entry.enabled === undefined)) {
      delete next[name];
    } else {
      next[name] = entry;
    }
    persist(next);
  };

  const handleToggle = (info: SkillInfo, enabled: boolean) => {
    const existing = entries[info.name];
    if (info.source === 'bundled') {
      // Toggling a pristine bundled skill only needs the enabled flag; keep
      // any existing override content intact.
      setEntry(info.name, { content: existing?.content, enabled });
    } else {
      setEntry(info.name, { content: existing?.content ?? info.raw ?? '', enabled });
    }
  };

  const handleSave = (name: string, content: string) => {
    const existing = entries[name];
    setEntry(name, { content, enabled: existing?.enabled });
    setEditing(null);
  };

  const handleReset = (info: SkillInfo) => {
    // Removing the entry restores the shipped bundled skill (enabled).
    setEntry(info.name, null);
  };

  const handleDelete = (info: SkillInfo) => {
    setEntry(info.name, null);
  };

  const openEditor = (info: SkillInfo) => {
    setEditing({ name: info.name, content: info.raw ?? '' });
  };

  if (loadError) {
    return (
      <FieldSet label="Skills">
        <Alert title="Failed to load skills" severity="error">
          {loadError}
        </Alert>
      </FieldSet>
    );
  }

  if (!skills) {
    return (
      <FieldSet label="Skills">
        <div className="flex items-center gap-2 text-secondary text-sm">
          <Spinner />
          <span>Loading skills...</span>
        </div>
      </FieldSet>
    );
  }

  return (
    <FieldSet label="Skills" data-testid={testIds.appConfig.skills.section}>
      <p className="text-sm text-secondary mb-4">
        Skills are modular SKILL.md instruction sets (Agent Skills format) the assistant activates per request —
        explicitly from the chat input slash commands, automatically via trigger keywords, or on demand through its
        load_skill tool. Bundled skills ship with the plugin; edit one to customize it for your organization, disable
        it, or add your own.
      </p>

      {legacyPromptSkills.length > 0 && (
        <Alert title="Legacy prompt templates are still set" severity="info" className="mb-4">
          Pre-skills prompt fields still apply to: {legacyPromptSkills.join(', ')}. Editing or disabling those skills
          here takes precedence over the legacy fields.
        </Alert>
      )}

      <div className="flex flex-col gap-3">
        {skills.map((info) => {
          const entry = entries[info.name];
          const overridden = info.source === 'bundled' && (entry?.content !== undefined || info.customized);
          return (
            <div
              key={info.name}
              data-testid={testIds.appConfig.skills.card(info.name)}
              className="rounded-lg p-4"
              style={{
                backgroundColor: theme.colors.background.secondary,
                border: `1px solid ${info.invalid ? theme.colors.error.main : theme.colors.border.weak}`,
              }}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium" style={{ color: theme.colors.text.primary }}>
                      {info.name}
                    </span>
                    <span
                      className="text-xs px-1.5 py-0.5 rounded"
                      style={{ backgroundColor: theme.colors.background.primary, color: theme.colors.text.secondary }}
                    >
                      {info.source === 'bundled' ? (overridden ? 'Bundled · customized' : 'Bundled') : 'Custom'}
                    </span>
                    {info.version && <span className="text-xs text-secondary">v{info.version}</span>}
                    {info.hidden && <span className="text-xs text-secondary">hidden</span>}
                  </div>
                  <p className="text-sm mt-1 break-words" style={{ color: theme.colors.text.secondary }}>
                    {info.description || (info.invalid ? 'Invalid skill — not active' : '')}
                  </p>
                  {info.invalid && info.invalidReason && (
                    <p className="text-xs mt-1" style={{ color: theme.colors.error.main }}>
                      {info.invalidReason}
                    </p>
                  )}
                  {(info.model || info.maxIterations || info.triggers) && (
                    <p className="text-xs mt-1 text-secondary">
                      {[
                        info.model && `model: ${info.model}`,
                        info.maxIterations && `max-iterations: ${info.maxIterations}`,
                        info.triggers && `triggers: ${info.triggers}`,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Switch
                    value={info.enabled}
                    onChange={(e) => handleToggle(info, e.currentTarget.checked)}
                    aria-label={`Enable ${info.name}`}
                    data-testid={testIds.appConfig.skills.toggle(info.name)}
                  />
                  <Button
                    size="sm"
                    variant="secondary"
                    icon="pen"
                    onClick={() => openEditor(info)}
                    data-testid={testIds.appConfig.skills.editButton(info.name)}
                  >
                    Edit
                  </Button>
                  {overridden && (
                    <Button
                      size="sm"
                      variant="secondary"
                      icon="history"
                      onClick={() => handleReset(info)}
                      data-testid={testIds.appConfig.skills.resetButton(info.name)}
                    >
                      Reset
                    </Button>
                  )}
                  {info.source === 'custom' && (
                    <Button
                      size="sm"
                      variant="destructive"
                      icon="trash-alt"
                      onClick={() => handleDelete(info)}
                      data-testid={testIds.appConfig.skills.deleteButton(info.name)}
                    >
                      Delete
                    </Button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-4">
        <Button
          icon="plus"
          onClick={() => setEditing({ name: null, content: NEW_SKILL_TEMPLATE })}
          data-testid={testIds.appConfig.skills.addButton}
        >
          Add skill
        </Button>
      </div>

      {editing && (
        <SkillEditor
          key={editing.name ?? 'new'}
          skillName={editing.name}
          existingNames={skills.map((skill) => skill.name)}
          initialContent={editing.content}
          onSave={handleSave}
          onDismiss={() => setEditing(null)}
        />
      )}
    </FieldSet>
  );
}
