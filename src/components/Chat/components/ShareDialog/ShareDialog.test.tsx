import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ShareDialog } from './ShareDialog';
import { sessionShareService } from '../../../../services/sessionShare';
import { ChatSession } from '../../../../core/models/ChatSession';
import { ChatMessage } from '../../../Chat/types';

// Mock Grafana UI
jest.mock('@grafana/ui', () => ({
  Modal: ({ children, title, isOpen, onDismiss }: any) =>
    isOpen ? (
      <div data-testid="modal">
        <h2>{title}</h2>
        {children}
        <button onClick={onDismiss}>Close</button>
      </div>
    ) : null,
  Button: ({ children, onClick, disabled, variant }: any) => (
    <button onClick={onClick} disabled={disabled} data-variant={variant}>
      {children}
    </button>
  ),
  Select: ({ options, value, onChange, placeholder }: any) => {
    const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
      const selectedValue = e.target.value === '' ? null : (e.target.value === 'null' ? null : Number(e.target.value));
      const option = options.find((opt: any) => {
        if (opt.value === null && selectedValue === null) {return true;}
        return opt.value === selectedValue;
      });
      if (option) {
        onChange(option);
      }
    };
    return (
      <select
        value={value === null || value === undefined ? '' : String(value)}
        onChange={handleChange}
        data-testid="expiry-select"
      >
        <option value="">{placeholder}</option>
        {options.map((opt: any) => (
          <option key={opt.value ?? 'null'} value={opt.value === null || opt.value === undefined ? '' : String(opt.value)}>
            {opt.label}
          </option>
        ))}
      </select>
    );
  },
  Input: ({ value, onChange, type, placeholder, min }: any) => (
    <input
      type={type}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      min={min}
      data-testid="share-url-input"
    />
  ),
  ClipboardButton: ({ children, getText }: any) => (
    <button onClick={() => navigator.clipboard.writeText(getText())}>{children}</button>
  ),
}));

// Mock sessionShareService
jest.mock('../../../../services/sessionShare', () => ({
  sessionShareService: {
    createShare: jest.fn(),
    getSessionShares: jest.fn(),
    revokeShare: jest.fn(),
    buildShareUrl: jest.fn(),
  },
}));

describe('ShareDialog', () => {
  const mockSession = ChatSession.create(
    [{ role: 'user', content: 'test message' }] as ChatMessage[],
    'Test Session'
  );

  const mockExistingShares = [
    {
      shareId: 'existing-share-1',
      shareUrl: '/a/consensys-asko11y-app/shared/existing-share-1',
      expiresAt: null,
    },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    (sessionShareService.getSessionShares as jest.Mock).mockResolvedValue(mockExistingShares);
    (sessionShareService.buildShareUrl as jest.Mock).mockImplementation(
      (shareId: string) => `http://localhost:3000/a/consensys-asko11y-app/shared/${shareId}`
    );
  });

  it('should render share dialog', async () => {
    render(<ShareDialog sessionId="session-123" session={mockSession} onClose={jest.fn()} />);

    await waitFor(() => {
      expect(screen.getByTestId('modal')).toBeInTheDocument();
    });
    expect(screen.getByText('Share Session')).toBeInTheDocument();
  });

  it('should show existing shares', async () => {
    render(
      <ShareDialog
        sessionId="session-123"
        session={mockSession}
        onClose={jest.fn()}
        existingShares={mockExistingShares}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Existing Shares:')).toBeInTheDocument();
    }, { timeout: 3000 });
  });

  it('should create a share when form is submitted', async () => {
    const mockShare = {
      shareId: 'new-share-id',
      shareUrl: '/a/consensys-asko11y-app/shared/new-share-id',
      expiresAt: null,
    };

    (sessionShareService.createShare as jest.Mock).mockResolvedValue(mockShare);

    const onClose = jest.fn();
    render(<ShareDialog sessionId="session-123" session={mockSession} onClose={onClose} />);

    // Select expiry option
    const select = screen.getByTestId('expiry-select');
    fireEvent.change(select, { target: { value: '7' } });

    // Click create share button
    const createButton = screen.getByText('Create Share');
    fireEvent.click(createButton);

    await waitFor(() => {
      expect(sessionShareService.createShare).toHaveBeenCalledWith('session-123', mockSession, 7);
    });

    // Should show success message
    await waitFor(() => {
      expect(screen.getByText('Share link created successfully!')).toBeInTheDocument();
    });
  });

  it('should create a share with no expiration', async () => {
    const mockShare = {
      shareId: 'new-share-id',
      shareUrl: '/a/consensys-asko11y-app/shared/new-share-id',
      expiresAt: null,
    };

    (sessionShareService.createShare as jest.Mock).mockResolvedValue(mockShare);

    render(<ShareDialog sessionId="session-123" session={mockSession} onClose={jest.fn()} />);

    // Don't select any expiry option (defaults to undefined)
    const createButton = screen.getByText('Create Share');
    fireEvent.click(createButton);

    await waitFor(() => {
      expect(sessionShareService.createShare).toHaveBeenCalledWith('session-123', mockSession, undefined);
    });
  });

  it('should revoke a share', async () => {
    (sessionShareService.revokeShare as jest.Mock).mockResolvedValue(undefined);

    render(
      <ShareDialog
        sessionId="session-123"
        session={mockSession}
        onClose={jest.fn()}
        existingShares={mockExistingShares}
      />
    );

    await waitFor(() => {
      const revokeButton = screen.getByText('Revoke');
      fireEvent.click(revokeButton);
    });

    await waitFor(() => {
      expect(sessionShareService.revokeShare).toHaveBeenCalledWith('existing-share-1');
    });
  });

  it('should handle create share error', async () => {
    (sessionShareService.createShare as jest.Mock).mockRejectedValue(new Error('Failed to create'));

    // Mock alert
    const alertSpy = jest.spyOn(window, 'alert').mockImplementation(() => {});

    render(<ShareDialog sessionId="session-123" session={mockSession} onClose={jest.fn()} />);

    const createButton = screen.getByText('Create Share');
    fireEvent.click(createButton);

    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalledWith('Failed to create share. Please try again.');
    });

    alertSpy.mockRestore();
  });
});
