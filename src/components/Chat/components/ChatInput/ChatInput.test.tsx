/**
 * Unit tests for ChatInput component
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { ChatInput, ChatInputRef } from './ChatInput';

// Mock Grafana UI
jest.mock('@grafana/ui', () => ({
  useTheme2: () => ({
    isDark: false,
    colors: {
      text: {
        primary: '#000',
        secondary: '#666',
        disabled: '#999',
      },
      background: {
        primary: '#fff',
        secondary: '#f5f5f5',
      },
      border: {
        weak: '#ddd',
      },
    },
  }),
  Icon: ({ name }: { name: string }) => <span data-testid={`icon-${name}`}>{name}</span>,
  Alert: ({ severity, title, children }: { severity: string; title: string; children: React.ReactNode }) => (
    <div data-testid={`alert-${severity}`} role="alert">
      <strong>{title}</strong>
      <span>{children}</span>
    </div>
  ),
}));

// Mock ValidationService
jest.mock('../../../../services/validation', () => ({
  ValidationService: {
    validateChatInput: jest.fn((input: string) => {
      if (input.length > 50000) {
        throw new Error('Input too long');
      }
      return input;
    }),
  },
}));

describe('ChatInput', () => {
  const mockSetCurrentInput = jest.fn();
  const mockSendMessage = jest.fn();
  const mockHandleKeyPress = jest.fn();

  const defaultProps = {
    currentInput: '',
    isGenerating: false,
    toolsLoading: false,
    setCurrentInput: mockSetCurrentInput,
    sendMessage: mockSendMessage,
    handleKeyPress: mockHandleKeyPress,
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('rendering', () => {
    it('should render the textarea', () => {
      render(<ChatInput {...defaultProps} />);
      expect(screen.getByPlaceholderText('Ask me anything about your metrics, logs, or observability...')).toBeInTheDocument();
    });

    it('should render the send button', () => {
      render(<ChatInput {...defaultProps} />);
      expect(screen.getByLabelText('Send message (Enter)')).toBeInTheDocument();
    });

    it('should render rightSlot when provided', () => {
      render(<ChatInput {...defaultProps} rightSlot={<span data-testid="right-slot">Slot</span>} />);
      expect(screen.getByTestId('right-slot')).toBeInTheDocument();
    });
  });

  describe('input handling', () => {
    it('should call setCurrentInput when typing', () => {
      render(<ChatInput {...defaultProps} />);
      
      const textarea = screen.getByPlaceholderText('Ask me anything about your metrics, logs, or observability...');
      fireEvent.change(textarea, { target: { value: 'Hello' } });
      
      expect(mockSetCurrentInput).toHaveBeenCalledWith('Hello');
    });

    it('should display current input value', () => {
      render(<ChatInput {...defaultProps} currentInput="Test message" />);
      
      const textarea = screen.getByPlaceholderText('Ask me anything about your metrics, logs, or observability...') as HTMLTextAreaElement;
      expect(textarea.value).toBe('Test message');
    });
  });

  describe('send button', () => {
    it('should call sendMessage when clicked', () => {
      render(<ChatInput {...defaultProps} currentInput="Hello" />);
      
      const sendButton = screen.getByLabelText('Send message (Enter)');
      fireEvent.click(sendButton);
      
      expect(mockSendMessage).toHaveBeenCalled();
    });

    it('should be disabled when isGenerating is true', () => {
      render(<ChatInput {...defaultProps} isGenerating={true} />);
      
      const sendButton = screen.getByLabelText('Send message (Enter)');
      expect(sendButton).toBeDisabled();
    });

    it('should be disabled when toolsLoading is true', () => {
      render(<ChatInput {...defaultProps} toolsLoading={true} />);
      
      const sendButton = screen.getByLabelText('Send message (Enter)');
      expect(sendButton).toBeDisabled();
    });

    it('should be disabled when input is empty', () => {
      render(<ChatInput {...defaultProps} currentInput="" />);
      
      const sendButton = screen.getByLabelText('Send message (Enter)');
      expect(sendButton).toBeDisabled();
    });

    it('should be enabled when input has content and not generating', () => {
      render(<ChatInput {...defaultProps} currentInput="Hello" />);
      
      const sendButton = screen.getByLabelText('Send message (Enter)');
      expect(sendButton).not.toBeDisabled();
    });
  });

  describe('keyboard handling', () => {
    it('should call handleKeyPress on key down', () => {
      render(<ChatInput {...defaultProps} currentInput="Hello" />);
      
      const textarea = screen.getByPlaceholderText('Ask me anything about your metrics, logs, or observability...');
      fireEvent.keyDown(textarea, { key: 'Enter' });
      
      expect(mockHandleKeyPress).toHaveBeenCalled();
    });

    it('should NOT call handleKeyPress for Shift+Enter (allows newline)', () => {
      render(<ChatInput {...defaultProps} currentInput="Hello" />);

      const textarea = screen.getByPlaceholderText('Ask me anything about your metrics, logs, or observability...');
      fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true });

      // Shift+Enter should NOT trigger handleKeyPress - it should allow default behavior (newline)
      expect(mockHandleKeyPress).not.toHaveBeenCalled();
    });
  });

  describe('imperative handle (ref)', () => {
    it('should expose focus method', () => {
      const ref = React.createRef<ChatInputRef>();
      render(<ChatInput {...defaultProps} ref={ref} />);
      
      expect(ref.current).toHaveProperty('focus');
      expect(typeof ref.current?.focus).toBe('function');
    });

    it('should focus the textarea when focus is called', () => {
      const ref = React.createRef<ChatInputRef>();
      render(<ChatInput {...defaultProps} ref={ref} />);
      
      const textarea = screen.getByPlaceholderText('Ask me anything about your metrics, logs, or observability...');
      ref.current?.focus();
      
      expect(document.activeElement).toBe(textarea);
    });
  });

  describe('styling', () => {
    it('should have gradient border wrapper', () => {
      const { container } = render(<ChatInput {...defaultProps} />);
      expect(container.querySelector('.gradient-border-wrapper')).toBeInTheDocument();
    });
  });

  describe('auto-resize', () => {
    it('should auto-resize on input change', () => {
      render(<ChatInput {...defaultProps} />);
      
      const textarea = screen.getByPlaceholderText('Ask me anything about your metrics, logs, or observability...') as HTMLTextAreaElement;
      
      // Simulate typing multiline content
      fireEvent.change(textarea, { target: { value: 'Line 1\nLine 2\nLine 3' } });
      
      // The component should handle auto-resize internally
      expect(mockSetCurrentInput).toHaveBeenCalledWith('Line 1\nLine 2\nLine 3');
    });
  });
});

