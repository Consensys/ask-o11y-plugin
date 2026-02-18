import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MCPServerModal } from './MCPServerModal';
import { MCPServerConfig } from '../../types/plugin';

describe('MCPServerModal', () => {
  const mockOnClose = jest.fn();
  const mockOnSave = jest.fn();

  const defaultProps = {
    server: null,
    isOpen: true,
    onClose: mockOnClose,
    onSave: mockOnSave,
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // Helper to expand headers section
  const expandHeadersSection = async () => {
    const headersButton = screen.getByRole('button', { name: /Headers/i });
    fireEvent.click(headersButton);
    await waitFor(() => {
      expect(screen.getByTestId('mcp-modal-headers-textarea')).toBeInTheDocument();
    });
  };

  it('renders add mode when server is null', () => {
    render(<MCPServerModal {...defaultProps} />);

    expect(screen.getByText('Add MCP Server')).toBeInTheDocument();
    expect(screen.getByTestId('mcp-modal-name-input')).toHaveValue('');
    expect(screen.getByTestId('mcp-modal-url-input')).toHaveValue('');
  });

  it('renders edit mode with pre-filled values', () => {
    const server: MCPServerConfig = {
      id: 'test-server',
      name: 'Test Server',
      url: 'https://example.com',
      type: 'openapi',
      enabled: true,
      headers: {
        Authorization: 'Bearer token123',
        'X-API-Key': 'key456',
      },
    };

    render(<MCPServerModal {...defaultProps} server={server} />);

    expect(screen.getByText('Edit MCP Server')).toBeInTheDocument();
    expect(screen.getByTestId('mcp-modal-name-input')).toHaveValue('Test Server');
    expect(screen.getByTestId('mcp-modal-url-input')).toHaveValue('https://example.com');
    expect(screen.getByTestId('mcp-modal-type-select')).toHaveValue('openapi');
  });

  it('converts headers object to textarea format in edit mode', async () => {
    const server: MCPServerConfig = {
      id: 'test-server',
      name: 'Test Server',
      url: 'https://example.com',
      type: 'openapi',
      enabled: true,
      headers: {
        Authorization: 'Bearer token123',
        'X-API-Key': 'key456',
      },
    };

    render(<MCPServerModal {...defaultProps} server={server} />);

    // Expand the headers section
    const headersButton = screen.getByRole('button', { name: /Headers \(2 configured\)/i });
    fireEvent.click(headersButton);

    await waitFor(() => {
      const textarea = screen.getByTestId('mcp-modal-headers-textarea');
      expect(textarea).toHaveValue('Authorization: Bearer token123\nX-API-Key: key456');
    });
  });

  it('validates required fields', async () => {
    render(<MCPServerModal {...defaultProps} />);

    const saveButton = screen.getByTestId('mcp-modal-save-button');

    // Should be disabled initially (empty name and URL)
    expect(saveButton).toBeDisabled();

    // Fill in name
    fireEvent.change(screen.getByTestId('mcp-modal-name-input'), {
      target: { value: 'Test Server' },
    });

    // Still disabled (no URL)
    expect(saveButton).toBeDisabled();

    // Fill in URL
    fireEvent.change(screen.getByTestId('mcp-modal-url-input'), {
      target: { value: 'https://example.com' },
    });
    fireEvent.blur(screen.getByTestId('mcp-modal-url-input'));

    await waitFor(() => {
      expect(saveButton).not.toBeDisabled();
    });
  });

  it('validates URL format', async () => {
    render(<MCPServerModal {...defaultProps} />);

    const urlInput = screen.getByTestId('mcp-modal-url-input');
    const nameInput = screen.getByTestId('mcp-modal-name-input');

    // Fill in name
    fireEvent.change(nameInput, { target: { value: 'Test Server' } });

    // Enter invalid URL
    fireEvent.change(urlInput, { target: { value: 'invalid-url' } });
    fireEvent.blur(urlInput);

    await waitFor(() => {
      expect(screen.getByText('Invalid URL format')).toBeInTheDocument();
    });

    // Save button should be disabled
    expect(screen.getByTestId('mcp-modal-save-button')).toBeDisabled();
  });

  it('parses headers from textarea correctly', async () => {
    render(<MCPServerModal {...defaultProps} />);

    // Fill in required fields
    fireEvent.change(screen.getByTestId('mcp-modal-name-input'), {
      target: { value: 'Test Server' },
    });
    fireEvent.change(screen.getByTestId('mcp-modal-url-input'), {
      target: { value: 'https://example.com' },
    });
    fireEvent.blur(screen.getByTestId('mcp-modal-url-input'));

    // Expand headers section and fill in headers
    await expandHeadersSection();
    const textarea = screen.getByTestId('mcp-modal-headers-textarea');
    fireEvent.change(textarea, {
      target: { value: 'Authorization: Bearer token123\nX-API-Key: key456' },
    });

    await waitFor(() => {
      expect(screen.getByTestId('mcp-modal-save-button')).not.toBeDisabled();
    });

    fireEvent.click(screen.getByTestId('mcp-modal-save-button'));

    await waitFor(() => {
      expect(mockOnSave).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Test Server',
          url: 'https://example.com',
          headers: {
            Authorization: 'Bearer token123',
            'X-API-Key': 'key456',
          },
        })
      );
    });
  });

  it('validates header line format', async () => {
    render(<MCPServerModal {...defaultProps} />);

    // Fill in required fields
    fireEvent.change(screen.getByTestId('mcp-modal-name-input'), {
      target: { value: 'Test Server' },
    });
    fireEvent.change(screen.getByTestId('mcp-modal-url-input'), {
      target: { value: 'https://example.com' },
    });
    fireEvent.blur(screen.getByTestId('mcp-modal-url-input'));

    // Expand headers section and enter invalid header format (missing colon)
    await expandHeadersSection();
    const textarea = screen.getByTestId('mcp-modal-headers-textarea');
    fireEvent.change(textarea, {
      target: { value: 'InvalidHeader\nAuthorization: Bearer token' },
    });

    await waitFor(() => {
      expect(screen.getByText('Line 1: Missing colon separator (expected format: Key: Value)')).toBeInTheDocument();
    });

    // Save button should be disabled
    expect(screen.getByTestId('mcp-modal-save-button')).toBeDisabled();
  });

  it('detects duplicate header keys', async () => {
    render(<MCPServerModal {...defaultProps} />);

    // Fill in required fields
    fireEvent.change(screen.getByTestId('mcp-modal-name-input'), {
      target: { value: 'Test Server' },
    });
    fireEvent.change(screen.getByTestId('mcp-modal-url-input'), {
      target: { value: 'https://example.com' },
    });
    fireEvent.blur(screen.getByTestId('mcp-modal-url-input'));

    // Expand headers section first
    await expandHeadersSection();

    // Enter duplicate keys
    const textarea = screen.getByTestId('mcp-modal-headers-textarea');
    fireEvent.change(textarea, {
      target: { value: 'Authorization: Bearer token1\nAuthorization: Bearer token2' },
    });

    await waitFor(() => {
      expect(screen.getByText(/Line 2: Duplicate header key/)).toBeInTheDocument();
    });

    // Save button should be disabled
    expect(screen.getByTestId('mcp-modal-save-button')).toBeDisabled();
  });

  it('allows empty lines in headers textarea', async () => {
    render(<MCPServerModal {...defaultProps} />);

    // Fill in required fields
    fireEvent.change(screen.getByTestId('mcp-modal-name-input'), {
      target: { value: 'Test Server' },
    });
    fireEvent.change(screen.getByTestId('mcp-modal-url-input'), {
      target: { value: 'https://example.com' },
    });
    fireEvent.blur(screen.getByTestId('mcp-modal-url-input'));

    // Expand headers section first
    await expandHeadersSection();

    // Enter headers with empty lines
    const textarea = screen.getByTestId('mcp-modal-headers-textarea');
    fireEvent.change(textarea, {
      target: { value: 'Authorization: Bearer token\n\nX-API-Key: key456\n\n' },
    });

    await waitFor(() => {
      expect(screen.getByTestId('mcp-modal-save-button')).not.toBeDisabled();
    });

    fireEvent.click(screen.getByTestId('mcp-modal-save-button'));

    await waitFor(() => {
      expect(mockOnSave).toHaveBeenCalledWith(
        expect.objectContaining({
          headers: {
            Authorization: 'Bearer token',
            'X-API-Key': 'key456',
          },
        })
      );
    });
  });

  it('calls onClose when Cancel button is clicked', () => {
    render(<MCPServerModal {...defaultProps} />);

    fireEvent.click(screen.getByTestId('mcp-modal-cancel-button'));

    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  it('does not render when isOpen is false', () => {
    render(<MCPServerModal {...defaultProps} isOpen={false} />);

    expect(screen.queryByText('Add MCP Server')).not.toBeInTheDocument();
    expect(screen.queryByText('Edit MCP Server')).not.toBeInTheDocument();
  });
});
