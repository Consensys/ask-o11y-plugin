import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { PromptEditor } from './PromptEditor';

type MockButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  children?: React.ReactNode;
};

type MockModalProps = {
  children?: React.ReactNode;
  isOpen?: boolean;
  onDismiss?: () => void;
  title?: string;
};

type MockTextAreaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement> & {
  invalid?: boolean;
};

jest.mock('@grafana/ui', () => ({
  Button: ({ children, ...props }: MockButtonProps) => <button {...props}>{children}</button>,
  Modal: ({ children, isOpen, onDismiss, title }: MockModalProps) =>
    isOpen ? (
      <div>
        <h2>{title}</h2>
        <button onClick={onDismiss} aria-label="Close">
          Close
        </button>
        {children}
      </div>
    ) : null,
  TextArea: ({ invalid, ...props }: MockTextAreaProps) => <textarea {...props} aria-invalid={invalid ? 'true' : 'false'} />,
}));

describe('PromptEditor', () => {
  const baseProps = {
    label: 'System Prompt',
    description: 'Edit prompt template',
    currentValue: 'Original prompt',
    defaultValue: 'Default prompt',
    testIdPrefix: 'prompt-editor',
    onSave: jest.fn(),
  };

  function openEditor() {
    render(<PromptEditor {...baseProps} />);
    fireEvent.click(screen.getByTestId('prompt-editor-edit-button'));
  }

  it.each(['{{ call .Fn}}', '{{- call .Fn}}'])(
    'blocks forbidden call action for template input: %s',
    (templateInput) => {
      openEditor();

      fireEvent.change(screen.getByTestId('prompt-editor-textarea'), {
        target: { value: templateInput },
      });

      expect(screen.getByText(/\(Forbidden template action: call\)/)).toBeInTheDocument();
      expect(screen.getByTestId('prompt-editor-save-button')).toBeDisabled();
    }
  );
});
