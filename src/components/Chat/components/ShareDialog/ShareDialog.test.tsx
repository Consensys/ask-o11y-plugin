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
      // Handle empty string as -1 (Never) or find the matching option
      let selectedValue: any = null;
      if (e.target.value === '') {
        // Empty string could be Never (-1) or placeholder
        const neverOption = options.find((opt: any) => opt.value === -1);
        if (neverOption) {
          selectedValue = -1;
        }
      } else {
        selectedValue = Number(e.target.value);
      }
      
      const option = options.find((opt: any) => {
        if (opt.value === null && selectedValue === null) {return true;}
        return opt.value === selectedValue;
      });
      if (option) {
        onChange(option);
      }
    };
    // Handle -1 sentinel value for "Never" - convert to empty string for display
    const displayValue = value === -1 ? '' : (value === null || value === undefined ? '' : String(value));
    return (
      <select
        value={displayValue}
        onChange={handleChange}
        data-testid="expiry-select"
      >
        <option value="">{placeholder}</option>
        {options.map((opt: any) => {
          // -1 (Never) displays as empty string, all other values as their string representation
          const optValue = opt.value === -1 ? '' : (opt.value === null || opt.value === undefined ? '' : String(opt.value));
          return (
            <option key={opt.value ?? 'null'} value={optValue}>
              {opt.label}
            </option>
          );
        })}
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

    // Default is 7 days (encoded as 107), so clicking create should use that
    // Select a different expiry option (1 day = 101)
    const select = screen.getByTestId('expiry-select');
    fireEvent.change(select, { target: { value: '101' } });

    // Click create share button
    const createButton = screen.getByText('Create Share');
    fireEvent.click(createButton);

    await waitFor(() => {
      // 1 day (101) decodes to: expiresInDays = 1, expiresInHours = undefined
      expect(sessionShareService.createShare).toHaveBeenCalledWith('session-123', mockSession, 1, undefined);
    });

    // Should show success message
    await waitFor(() => {
      expect(screen.getByText('Share link created successfully!')).toBeInTheDocument();
    });
  });

  it('should create a share with no expiration (Never)', async () => {
    const mockShare = {
      shareId: 'new-share-id',
      shareUrl: '/a/consensys-asko11y-app/shared/new-share-id',
      expiresAt: null,
    };

    (sessionShareService.createShare as jest.Mock).mockResolvedValue(mockShare);

    render(<ShareDialog sessionId="session-123" session={mockSession} onClose={jest.fn()} />);

    // Select "Never" option (encoded as -1)
    const select = screen.getByTestId('expiry-select');
    fireEvent.change(select, { target: { value: '-1' } });

    const createButton = screen.getByText('Create Share');
    fireEvent.click(createButton);

    await waitFor(() => {
      // Never (-1) decodes to: expiresInDays = undefined, expiresInHours = undefined
      expect(sessionShareService.createShare).toHaveBeenCalledWith('session-123', mockSession, undefined, undefined);
    });
  });

  it('should default to 7 days expiration', async () => {
    const mockShare = {
      shareId: 'new-share-id',
      shareUrl: '/a/consensys-asko11y-app/shared/new-share-id',
      expiresAt: null,
    };

    (sessionShareService.createShare as jest.Mock).mockResolvedValue(mockShare);

    render(<ShareDialog sessionId="session-123" session={mockSession} onClose={jest.fn()} />);

    // Don't change the default (should be 7 days = 107)
    const createButton = screen.getByText('Create Share');
    fireEvent.click(createButton);

    await waitFor(() => {
      // Default 7 days (107) decodes to: expiresInDays = 7, expiresInHours = undefined
      expect(sessionShareService.createShare).toHaveBeenCalledWith('session-123', mockSession, 7, undefined);
    });
  });

  it('should create a share with 1 hour expiration', async () => {
    const mockShare = {
      shareId: 'new-share-id',
      shareUrl: '/a/consensys-asko11y-app/shared/new-share-id',
      expiresAt: null,
    };

    (sessionShareService.createShare as jest.Mock).mockResolvedValue(mockShare);

    render(<ShareDialog sessionId="session-123" session={mockSession} onClose={jest.fn()} />);

    // Select "1 hour" option (encoded as 1)
    const select = screen.getByTestId('expiry-select');
    fireEvent.change(select, { target: { value: '1' } });

    const createButton = screen.getByText('Create Share');
    fireEvent.click(createButton);

    await waitFor(() => {
      // 1 hour (1) decodes to: expiresInDays = undefined, expiresInHours = 1
      expect(sessionShareService.createShare).toHaveBeenCalledWith('session-123', mockSession, undefined, 1);
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
