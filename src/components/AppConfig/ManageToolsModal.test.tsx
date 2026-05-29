import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { ManageToolsModal } from './ManageToolsModal';
import type { MCPTool } from '../../services/mcpServerStatus';

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & { children?: React.ReactNode };
type ModalProps = { children?: React.ReactNode; isOpen?: boolean; title?: React.ReactNode };
type SwitchProps = { value?: boolean; onChange?: (e: { currentTarget: { checked: boolean } }) => void };
type InputProps = React.InputHTMLAttributes<HTMLInputElement>;
type IconButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  tooltip?: React.ReactNode;
  tooltipPlacement?: string;
};

const mockTheme = {
  breakpoints: {
    down: () => '@media (max-width: 600px)',
  },
  colors: {
    background: {
      primary: '#111217',
      secondary: '#181b1f',
    },
    border: {
      weak: '#343741',
    },
    error: {
      borderTransparent: 'rgba(242, 73, 92, 0.3)',
      text: '#ff9aa2',
      transparent: 'rgba(242, 73, 92, 0.15)',
    },
    info: {
      borderTransparent: 'rgba(50, 116, 217, 0.3)',
      text: '#9ac2ff',
      transparent: 'rgba(50, 116, 217, 0.15)',
    },
    text: {
      primary: '#d8d9da',
      secondary: '#a3a7b3',
    },
    warning: {
      borderTransparent: 'rgba(255, 184, 0, 0.3)',
      text: '#ffd47d',
      transparent: 'rgba(255, 184, 0, 0.15)',
    },
  },
  shape: {
    radius: {
      default: '2px',
    },
  },
  spacing: (...values: Array<number | string>) =>
    (values.length === 0 ? [1] : values)
      .map((value) => (typeof value === 'number' ? `${value * 8}px` : value))
      .join(' '),
  typography: {
    bodySmall: {
      fontSize: '12px',
      lineHeight: 1.4,
    },
    fontFamilyMonospace: 'monospace',
    fontWeightMedium: 500,
  },
};

jest.mock('@grafana/ui', () => ({
  Button: ({ children, ...props }: ButtonProps) => <button {...props}>{children}</button>,
  IconButton: ({ tooltip, tooltipPlacement: _tooltipPlacement, ...props }: IconButtonProps) => (
    <button aria-label={typeof tooltip === 'string' ? tooltip : 'Tool description'} {...props}>
      ?
    </button>
  ),
  Modal: ({ children, isOpen, title }: ModalProps) =>
    isOpen ? (
      <div>
        <h2>{title}</h2>
        {children}
      </div>
    ) : null,
  Switch: ({ value, onChange, ...props }: SwitchProps & React.InputHTMLAttributes<HTMLInputElement>) => (
    <input
      type="checkbox"
      checked={!!value}
      onChange={(e) => onChange?.({ currentTarget: { checked: e.target.checked } })}
      {...props}
    />
  ),
  Input: (props: InputProps) => <input {...props} />,
  useStyles2: (getStyles: (theme: typeof mockTheme) => unknown) => getStyles(mockTheme),
}));

const tools: MCPTool[] = [
  { name: 'list_things', description: 'list', inputSchema: {}, annotations: { readOnlyHint: true } },
  { name: 'update_thing', description: 'update', inputSchema: {}, annotations: {} },
  { name: 'delete_thing', description: 'delete', inputSchema: {}, annotations: { destructiveHint: true } },
];

describe('ManageToolsModal', () => {
  const baseProps = {
    serverId: 'srv1',
    serverName: 'Server 1',
    tools,
    serverEnabled: true,
    isOpen: true,
    onDismiss: jest.fn(),
    onSave: jest.fn(),
  };

  it('Apply is disabled when there are no changes', () => {
    render(<ManageToolsModal {...baseProps} onSave={jest.fn()} />);
    expect(screen.getByText('Apply')).toBeDisabled();
  });

  it('toggling a tool enables Apply and saves the new selections', () => {
    const onSave = jest.fn();
    render(<ManageToolsModal {...baseProps} onSave={onSave} />);

    const checkboxes = screen.getAllByRole('checkbox');
    fireEvent.click(checkboxes[0]); // toggle list_things off

    const apply = screen.getByText('Apply');
    expect(apply).not.toBeDisabled();
    fireEvent.click(apply);

    expect(onSave).toHaveBeenCalledWith('srv1', expect.objectContaining({ list_things: false }));
  });

  it('Disable all toggles every tool off', () => {
    const onSave = jest.fn();
    render(<ManageToolsModal {...baseProps} onSave={onSave} />);

    fireEvent.click(screen.getByText('Disable all'));
    fireEvent.click(screen.getByText('Apply'));

    expect(onSave).toHaveBeenCalledWith('srv1', { list_things: false, update_thing: false, delete_thing: false });
  });

  it('filters tools by name', () => {
    render(<ManageToolsModal {...baseProps} />);
    const filter = screen.getByPlaceholderText('Filter tools…');
    fireEvent.change(filter, { target: { value: 'delete' } });

    expect(screen.queryByText('list_things')).toBeNull();
    expect(screen.getByText('delete_thing')).toBeInTheDocument();
  });

  it('shows tool names, separate risk labels, and descriptions through question mark buttons', () => {
    render(<ManageToolsModal {...baseProps} />);

    expect(screen.getByText('list_things')).toBeInTheDocument();
    expect(screen.getByText('update_thing')).toBeInTheDocument();
    expect(screen.getByText('delete_thing')).toBeInTheDocument();
    expect(screen.getByText('Read-only')).toBeInTheDocument();
    expect(screen.getByText('Read/write')).toBeInTheDocument();
    expect(screen.getByText('Destructive')).toBeInTheDocument();
    expect(screen.queryByText('list')).not.toBeInTheDocument();
    expect(screen.queryByText('update')).not.toBeInTheDocument();
    expect(screen.queryByText('delete')).not.toBeInTheDocument();
    expect(screen.getByLabelText('list')).toHaveTextContent('?');
    expect(screen.getByLabelText('update')).toHaveTextContent('?');
    expect(screen.getByLabelText('delete')).toHaveTextContent('?');
    expect(screen.getByText('list_things')).toHaveTextContent(/^list_things$/);
  });

  it('shows empty state when no tools', () => {
    render(<ManageToolsModal {...baseProps} tools={[]} />);
    expect(screen.getByText('No tools available for this server.')).toBeInTheDocument();
  });
});
