import React, { useState, useMemo } from 'react';
import { Button, Modal, TextArea } from '@grafana/ui';

interface PromptEditorProps {
  label: string;
  description: string;
  currentValue: string;
  defaultValue: string;
  onSave: (value: string) => void;
  testIdPrefix: string;
}

const MAX_PROMPT_LENGTH = 15000;

const BLOCKED_TEMPLATE_ACTIONS = /\{\{\s*(call|template|define|block)\b/;

function validateTemplateSyntax(text: string): string | null {
  const blocked = text.match(BLOCKED_TEMPLATE_ACTIONS);
  if (blocked) {
    return `Forbidden template action: ${blocked[1]}`;
  }
  let depth = 0;
  for (let i = 0; i < text.length - 1; i++) {
    if (text[i] === '{' && text[i + 1] === '{') {
      depth++;
      i++;
    } else if (text[i] === '}' && text[i + 1] === '}') {
      depth--;
      i++;
      if (depth < 0) {
        return 'Unexpected closing }}';
      }
    }
  }
  return depth !== 0 ? 'Unmatched {{ in template' : null;
}

export function PromptEditor({
  label,
  description,
  currentValue,
  defaultValue,
  onSave,
  testIdPrefix,
}: PromptEditorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [draft, setDraft] = useState(currentValue);

  function openModal() {
    setDraft(currentValue);
    setIsOpen(true);
  }

  function handleSave() {
    onSave(draft === defaultValue ? '' : draft);
    setIsOpen(false);
  }

  const isOverLimit = draft.length > MAX_PROMPT_LENGTH;
  const templateError = useMemo(() => validateTemplateSyntax(draft), [draft]);
  const isDefault = draft === defaultValue;
  const hasChanges = draft !== currentValue;
  const canSave = hasChanges && !isOverLimit && !templateError;

  return (
    <>
      <div className="mb-4">
        <div className="flex items-center justify-between mb-1">
          <span className="font-medium text-sm">{label}</span>
          {currentValue !== defaultValue && <span className="text-xs text-info">Customized</span>}
        </div>
        <p className="text-xs text-secondary mb-2">{description}</p>
        <Button
          variant="secondary"
          size="sm"
          icon="pen"
          onClick={openModal}
          data-testid={`${testIdPrefix}-edit-button`}
        >
          Edit Prompt
        </Button>
      </div>

      <Modal title={`Edit ${label}`} isOpen={isOpen} onDismiss={() => setIsOpen(false)}>
        <div className="p-2">
          <TextArea
            value={draft}
            onChange={(e) => setDraft(e.currentTarget.value)}
            rows={16}
            data-testid={`${testIdPrefix}-textarea`}
            invalid={isOverLimit || !!templateError}
            style={{ fontFamily: 'monospace', fontSize: '13px' }}
          />

          <div className="flex items-center justify-between mt-2">
            <span className="text-xs text-secondary">
              {draft.length} / {MAX_PROMPT_LENGTH} characters
              {isOverLimit && <span className="text-error ml-1">(over limit)</span>}
              {templateError && <span className="text-error ml-1">({templateError})</span>}
            </span>
            {isDefault && <span className="text-xs text-secondary">Using default template</span>}
          </div>

          <div className="flex gap-2 mt-4 justify-end">
            <Button
              variant="secondary"
              onClick={() => setDraft(defaultValue)}
              disabled={isDefault}
              data-testid={`${testIdPrefix}-reset-button`}
            >
              Reset to Default
            </Button>
            <Button
              variant="primary"
              onClick={handleSave}
              disabled={!canSave}
              data-testid={`${testIdPrefix}-save-button`}
            >
              Save
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
