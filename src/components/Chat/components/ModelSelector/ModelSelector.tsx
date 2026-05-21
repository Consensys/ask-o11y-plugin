import React from 'react';
import { Combobox } from '@grafana/ui';
import type { LLMModel, LLMModelOption } from '../../../../services/llmModels';

interface ModelSelectorProps {
  options: LLMModelOption[];
  value?: LLMModel;
  disabled?: boolean;
  onChange: (model: LLMModel) => void;
}

export function ModelSelector({ options, value, disabled, onChange }: ModelSelectorProps): React.ReactElement | null {
  if (options.length === 0) {
    return null;
  }

  return (
    <div className="min-w-[180px]" data-testid="chat-model-selector">
      <span id="chat-model-selector-label" className="sr-only">
        Chat model
      </span>
      <Combobox<LLMModel>
        aria-labelledby="chat-model-selector-label"
        width={28}
        value={value}
        options={options.map((option) => ({
          label: option.isDefault ? `${option.label} (default)` : option.label,
          value: option.value,
        }))}
        onChange={(selected) => {
          onChange(selected.value);
        }}
        disabled={disabled}
      />
    </div>
  );
}
