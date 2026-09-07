import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { SkillEditor } from './SkillEditor';

jest.mock('@grafana/ui', () => ({
  Button: ({ children, onClick, disabled, ...rest }: any) => (
    <button onClick={onClick} disabled={disabled} {...rest}>
      {children}
    </button>
  ),
  Modal: ({ title, children }: any) => (
    <div>
      <h2>{title}</h2>
      <div>{children}</div>
    </div>
  ),
  TextArea: ({ value, onChange, invalid, ...rest }: any) => (
    <textarea value={value} onChange={onChange} data-invalid={invalid} {...rest} />
  ),
  useTheme2: () => ({ typography: { fontFamilyMonospace: 'mono', bodySmall: { fontSize: '12px' } } }),
}));

const validContent = [
  '---',
  'name: my-team-skill',
  'description: >-',
  '  Does team-specific things. Use when the user asks about our runbooks.',
  'metadata:',
  '  version: "1.0"',
  '---',
  '',
  '## Workflow',
  '',
  '1. Step one',
  '',
].join('\n');

describe('SkillEditor', () => {
  const onSave = jest.fn();
  const onDismiss = jest.fn();
  const defaultProps = {
    skillName: null as string | null,
    existingNames: ['investigating-alerts'],
    initialContent: validContent,
    onSave,
    onDismiss,
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('blocks saving when content is unchanged', () => {
    render(<SkillEditor {...defaultProps} />);
    expect(screen.getByTestId('data-testid ac-skill-editor-save')).toBeDisabled();
  });

  it('enables saving for a valid new skill and passes the parsed name', () => {
    render(<SkillEditor {...defaultProps} />);
    fireEvent.change(screen.getByTestId('data-testid ac-skill-editor-textarea'), {
      target: { value: validContent.replace('Step one', 'Step one changed') },
    });
    const save = screen.getByTestId('data-testid ac-skill-editor-save');
    expect(save).toBeEnabled();
    fireEvent.click(save);
    expect(onSave).toHaveBeenCalledWith('my-team-skill', expect.stringContaining('Step one changed'));
  });

  it('rejects content without frontmatter delimiters', () => {
    render(<SkillEditor {...defaultProps} />);
    fireEvent.change(screen.getByTestId('data-testid ac-skill-editor-textarea'), { target: { value: '# no frontmatter' } });
    expect(screen.getByTestId('data-testid ac-skill-editor-save')).toBeDisabled();
    expect(screen.getByText(/frontmatter delimiter/i)).toBeInTheDocument();
  });

  it('rejects a name that collides with an existing skill', () => {
    render(<SkillEditor {...defaultProps} />);
    fireEvent.change(screen.getByTestId('data-testid ac-skill-editor-textarea'), {
      target: { value: validContent.replace('my-team-skill', 'investigating-alerts') },
    });
    expect(screen.getByText(/already exists/i)).toBeInTheDocument();
    expect(screen.getByTestId('data-testid ac-skill-editor-save')).toBeDisabled();
  });

  it('rejects an invalid skill name', () => {
    render(<SkillEditor {...defaultProps} />);
    fireEvent.change(screen.getByTestId('data-testid ac-skill-editor-textarea'), {
      target: { value: validContent.replace('my-team-skill', 'Bad_Name') },
    });
    expect(screen.getByText(/Invalid name/i)).toBeInTheDocument();
    expect(screen.getByTestId('data-testid ac-skill-editor-save')).toBeDisabled();
  });

  it('rejects renaming an existing skill via the editor', () => {
    render(<SkillEditor {...defaultProps} skillName="my-team-skill" />);
    fireEvent.change(screen.getByTestId('data-testid ac-skill-editor-textarea'), {
      target: { value: validContent.replace('my-team-skill', 'another-name') },
    });
    expect(screen.getByText(/must stay/i)).toBeInTheDocument();
    expect(screen.getByTestId('data-testid ac-skill-editor-save')).toBeDisabled();
  });

  it('rejects blocked template actions', () => {
    render(<SkillEditor {...defaultProps} />);
    fireEvent.change(screen.getByTestId('data-testid ac-skill-editor-textarea'), {
      target: { value: validContent.replace('Step one', 'Step one {{call .X}}') },
    });
    expect(screen.getByText(/Forbidden template action/i)).toBeInTheDocument();
    expect(screen.getByTestId('data-testid ac-skill-editor-save')).toBeDisabled();
  });
});
