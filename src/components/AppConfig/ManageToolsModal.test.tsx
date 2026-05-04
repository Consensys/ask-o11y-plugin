import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { ManageToolsModal } from './ManageToolsModal';
import type { MCPTool } from '../../services/mcpServerStatus';

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & { children?: React.ReactNode };
type ModalProps = { children?: React.ReactNode; isOpen?: boolean; title?: React.ReactNode };
type SwitchProps = { value?: boolean; onChange?: (e: { currentTarget: { checked: boolean } }) => void };
type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

jest.mock('@grafana/ui', () => ({
  Button: ({ children, ...props }: ButtonProps) => <button {...props}>{children}</button>,
  Modal: ({ children, isOpen, title }: ModalProps) =>
    isOpen ? (
      <div>
        <h2>{title}</h2>
        {children}
      </div>
    ) : null,
  Switch: ({ value, onChange }: SwitchProps) => (
    <input
      type="checkbox"
      checked={!!value}
      onChange={(e) => onChange?.({ currentTarget: { checked: e.target.checked } })}
    />
  ),
  Input: (props: InputProps) => <input {...props} />,
}));

const tools: MCPTool[] = [
  { name: 'list_things', description: 'list', inputSchema: {}, annotations: { readOnlyHint: true } },
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

    expect(onSave).toHaveBeenCalledWith('srv1', { list_things: false, delete_thing: false });
  });

  it('filters tools by name', () => {
    render(<ManageToolsModal {...baseProps} />);
    const filter = screen.getByPlaceholderText('Filter tools…');
    fireEvent.change(filter, { target: { value: 'delete' } });

    expect(screen.queryByText('list_things')).toBeNull();
    expect(screen.getByText('delete_thing')).toBeInTheDocument();
  });

  it('shows empty state when no tools', () => {
    render(<ManageToolsModal {...baseProps} tools={[]} />);
    expect(screen.getByText('No tools available for this server.')).toBeInTheDocument();
  });
});
