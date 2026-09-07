import React, { useMemo, useState } from 'react';
import { Button, Modal, TextArea, useTheme2 } from '@grafana/ui';
import { testIds } from '../testIds';

interface SkillEditorProps {
  /** null when creating a new skill. */
  skillName: string | null;
  existingNames: string[];
  initialContent: string;
  onSave: (name: string, content: string) => void;
  onDismiss: () => void;
}

const MAX_SKILL_LENGTH = 15000;
const SKILL_NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const BLOCKED_TEMPLATE_ACTIONS = /\{\{-?\s*(call|template|define|block)\b/;

interface FrontmatterCheck {
  name: string;
  error: string | null;
}

/**
 * Lightweight frontmatter validation (name line + delimiters + template
 * guard). Full YAML validation happens in the Go registry and is surfaced
 * back through GET /api/skills as invalid/invalidReason after saving.
 */
function checkFrontmatter(content: string, skillName: string | null, existingNames: string[]): FrontmatterCheck {
  const text = content.replace(/^\s+/, '');
  const lines = text.split('\n');
  if (lines[0]?.trim() !== '---') {
    return { name: '', error: "SKILL.md must start with a '---' frontmatter delimiter" };
  }
  const closing = lines.findIndex((line, index) => index > 0 && line.trim() === '---');
  if (closing < 0) {
    return { name: '', error: "Frontmatter is not closed by a '---' delimiter" };
  }
  const nameLine = lines.slice(1, closing).find((line) => /^name:/.test(line.trim()));
  if (!nameLine) {
    return { name: '', error: "Frontmatter must contain a 'name:' field" };
  }
  const name = nameLine.replace(/^name:\s*/, '').trim().replace(/^['"]|['"]$/g, '');
  if (!name || name.length > 64 || !SKILL_NAME_PATTERN.test(name)) {
    return { name, error: 'Invalid name: 1-64 chars, lowercase letters, numbers, and single hyphens only' };
  }
  if (!lines.slice(1, closing).some((line) => /^description:/.test(line.trim()))) {
    return { name, error: "Frontmatter must contain a 'description:' field" };
  }
  if (skillName === null && existingNames.includes(name)) {
    return { name, error: `A skill named "${name}" already exists` };
  }
  if (skillName !== null && skillName !== name) {
    return { name, error: `The frontmatter name must stay "${skillName}" (renaming creates a new skill)` };
  }
  return { name, error: null };
}

export function SkillEditor({ skillName, existingNames, initialContent, onSave, onDismiss }: SkillEditorProps) {
  const theme = useTheme2();
  const [draft, setDraft] = useState(initialContent);

  const check = useMemo(() => checkFrontmatter(draft, skillName, existingNames), [draft, skillName, existingNames]);
  const templateError = useMemo(() => {
    const blocked = draft.match(BLOCKED_TEMPLATE_ACTIONS);
    return blocked ? `Forbidden template action: ${blocked[1]}` : null;
  }, [draft]);

  const isOverLimit = draft.length > MAX_SKILL_LENGTH;
  const hasChanges = draft !== initialContent;
  const canSave = hasChanges && !isOverLimit && !check.error && !templateError;

  return (
    <Modal
      title={skillName ? `Edit skill: ${skillName}` : 'Add skill'}
      isOpen
      onDismiss={onDismiss}
      data-testid={testIds.appConfig.skills.editorModal}
    >
      <div className="p-2">
        <p className="text-xs text-secondary mb-2">
          Agent Skills format: YAML frontmatter (name, description, metadata) followed by Markdown instructions.
          Metadata keys: model (base/large), max-iterations, triggers (regex), user-prompt (template for the legacy
          investigation/performance types), visibility (public/hidden), version.
        </p>
        <TextArea
          value={draft}
          onChange={(e) => setDraft(e.currentTarget.value)}
          rows={20}
          data-testid={testIds.appConfig.skills.editorTextarea}
          invalid={isOverLimit || !!check.error || !!templateError}
          style={{
            fontFamily: theme.typography.fontFamilyMonospace,
            fontSize: theme.typography.bodySmall.fontSize,
          }}
        />

        <div className="flex items-center justify-between mt-2">
          <span className="text-xs text-secondary">
            {draft.length} / {MAX_SKILL_LENGTH} characters
            {isOverLimit && <span className="text-error ml-1">(over limit)</span>}
            {(check.error || templateError) && (
              <span className="text-error ml-1">({check.error || templateError})</span>
            )}
          </span>
          {hasChanges && (
            <span className="text-xs text-warning" role="status">
              Unsaved changes
            </span>
          )}
        </div>

        <div className="flex gap-2 mt-4 justify-end">
          <Button variant="secondary" onClick={() => setDraft(initialContent)} disabled={!hasChanges}>
            Revert edits
          </Button>
          <Button
            variant="primary"
            onClick={() => onSave(check.name, draft)}
            disabled={!canSave}
            data-testid={testIds.appConfig.skills.editorSaveButton}
          >
            Save
          </Button>
        </div>
      </div>
    </Modal>
  );
}
