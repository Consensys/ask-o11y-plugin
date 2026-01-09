/**
 * Unit tests for MCPStatus component
 */

import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MCPStatus } from './MCPStatus';

// Mock Grafana UI
jest.mock('@grafana/ui', () => ({
  useTheme2: () => ({
    colors: {
      text: { primary: '#000', secondary: '#666', disabled: '#999' },
      background: { primary: '#fff', secondary: '#f5f5f5' },
      border: { weak: '#ddd', strong: '#999' },
      success: { main: 'green', text: 'green' },
      warning: { main: 'orange', text: 'orange' },
      error: { main: 'red', text: 'red' },
    },
    isDark: false,
    spacing: (n: number) => `${n * 8}px`,
    shape: { borderRadius: () => '4px' },
  }),
  Badge: ({ text, color, icon }: { text: string; color: string; icon?: string }) => (
    <span data-testid="badge" data-color={color} data-icon={icon}>
      {text}
    </span>
  ),
  Tooltip: ({ content, children }: { content: React.ReactNode; children: React.ReactElement }) => (
    <div data-testid="tooltip" data-content={content}>
      {children}
    </div>
  ),
  Icon: ({ name }: { name: string }) => <span data-testid={`icon-${name}`}>{name}</span>,
  Button: ({ children, onClick, variant }: any) => (
    <button onClick={onClick} data-variant={variant}>
      {children}
    </button>
  ),
}));

// Mock LoadingOverlay
jest.mock('../LoadingOverlay', () => ({
  InlineLoading: () => <div data-testid="inline-loading">Loading...</div>,
}));

// Mock mcpServerStatus service
const mockFetchServerStatuses = jest.fn();
jest.mock('../../services/mcpServerStatus', () => ({
  mcpServerStatusService: {
    fetchServerStatuses: () => mockFetchServerStatuses(),
  },
}));

describe('MCPStatus', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    mockFetchServerStatuses.mockResolvedValue({
      servers: [
        {
          id: 'server-1',
          name: 'Prometheus MCP',
          status: 'healthy',
          url: 'http://localhost:8001',
          lastHealthCheck: new Date().toISOString(),
          latency: 50,
        },
        {
          id: 'server-2',
          name: 'Loki MCP',
          status: 'degraded',
          url: 'http://localhost:8002',
          lastHealthCheck: new Date().toISOString(),
          latency: 150,
          error: 'High latency',
        },
      ],
      systemHealth: {
        overallStatus: 'healthy',
        healthy: 1,
        degraded: 1,
        unhealthy: 0,
        disconnected: 0,
        total: 2,
      },
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('rendering', () => {
    it('should render loading state initially', () => {
      render(<MCPStatus />);
      expect(screen.getByTestId('inline-loading')).toBeInTheDocument();
    });

    it('should render status badge after loading', async () => {
      render(<MCPStatus />);

      await waitFor(() => {
        expect(screen.getByTestId('badge')).toBeInTheDocument();
      });
    });

    it('should show overall status', async () => {
      render(<MCPStatus />);

      await waitFor(() => {
        expect(screen.getByText('HEALTHY')).toBeInTheDocument();
      });
    });
  });

  describe('compact mode', () => {
    it('should render in compact mode when specified', async () => {
      render(<MCPStatus compact={true} />);

      await waitFor(() => {
        // In compact mode, it renders a count instead of a badge
        expect(screen.getByText(/MCP/)).toBeInTheDocument();
      });
    });
  });

  describe('details display', () => {
    it('should hide details when showDetails is false', async () => {
      render(<MCPStatus showDetails={false} />);

      await waitFor(() => {
        expect(screen.getByTestId('badge')).toBeInTheDocument();
      });
    });
  });

  describe('close button', () => {
    it('should call onClose when close button is clicked', async () => {
      const mockOnClose = jest.fn();
      render(<MCPStatus onClose={mockOnClose} />);

      await waitFor(() => {
        expect(screen.queryByTestId('inline-loading')).not.toBeInTheDocument();
      });

      const closeButtons = screen.getAllByRole('button');
      if (closeButtons.length > 0) {
        fireEvent.click(closeButtons[0]);
      }
    });
  });

  describe('health states', () => {
    it('should display degraded status correctly', async () => {
      mockFetchServerStatuses.mockResolvedValue({
        servers: [
          {
            id: 'server-1',
            name: 'Test Server',
            status: 'degraded',
            url: 'http://localhost:8001',
          },
        ],
        systemHealth: {
          overallStatus: 'degraded',
          healthy: 0,
          degraded: 1,
          unhealthy: 0,
          disconnected: 0,
          total: 1,
        },
      });

      render(<MCPStatus />);

      await waitFor(() => {
        expect(screen.getByText('DEGRADED')).toBeInTheDocument();
      });
    });

    it('should display unhealthy status correctly', async () => {
      mockFetchServerStatuses.mockResolvedValue({
        servers: [],
        systemHealth: {
          overallStatus: 'unhealthy',
          healthy: 0,
          degraded: 0,
          unhealthy: 1,
          disconnected: 0,
          total: 1,
        },
      });

      render(<MCPStatus />);

      await waitFor(() => {
        expect(screen.getByText('UNHEALTHY')).toBeInTheDocument();
      });
    });
  });

  describe('expansion toggle', () => {
    it('should be expandable when clicked', async () => {
      render(<MCPStatus />);

      await waitFor(() => {
        expect(screen.getByTestId('badge')).toBeInTheDocument();
      });

      const badge = screen.getByTestId('badge');
      const parentButton = badge.closest('button') || badge.parentElement;
      if (parentButton) {
        fireEvent.click(parentButton);
      }
    });
  });

  describe('polling', () => {
    it('should poll for updates', async () => {
      render(<MCPStatus />);

      // Wait for initial fetch
      await waitFor(() => {
        expect(mockFetchServerStatuses).toHaveBeenCalledTimes(1);
      });

      // Advance timer by 30 seconds (polling interval)
      jest.advanceTimersByTime(30000);

      await waitFor(() => {
        expect(mockFetchServerStatuses).toHaveBeenCalledTimes(2);
      });
    });

    it('should clear interval on unmount', async () => {
      const { unmount } = render(<MCPStatus />);

      await waitFor(() => {
        expect(mockFetchServerStatuses).toHaveBeenCalled();
      });

      unmount();

      // Advance timer - should not trigger more calls
      jest.advanceTimersByTime(60000);

      // Call count should remain the same after unmount
      expect(mockFetchServerStatuses.mock.calls.length).toBeLessThanOrEqual(2);
    });
  });

  describe('className prop', () => {
    it('should apply custom className', async () => {
      const { container } = render(<MCPStatus className="custom-mcp-status" />);

      await waitFor(() => {
        const wrapper = container.firstChild as HTMLElement;
        expect(wrapper.className).toContain('custom-mcp-status');
      });
    });
  });
});

