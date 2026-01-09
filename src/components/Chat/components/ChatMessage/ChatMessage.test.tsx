/**
 * Unit tests for ChatMessage component
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import { ChatMessage } from './ChatMessage';
import { ChatMessage as ChatMessageType } from '../../types';

// Mock Grafana UI
jest.mock('@grafana/ui', () => ({
  useTheme2: () => ({
    isDark: false,
    colors: {
      text: { primary: '#000', secondary: '#666', disabled: '#999' },
      background: { primary: '#fff', secondary: '#f5f5f5' },
      primary: { main: '#7c3aed' },
    },
  }),
}));

// Mock child components to simplify testing
jest.mock('../ToolCallsSection/ToolCallsSection', () => ({
  ToolCallsSection: ({ toolCalls }: any) => (
    <div data-testid="tool-calls-section">Tool Calls: {toolCalls?.length || 0}</div>
  ),
}));

jest.mock('../GraphRenderer/GraphRenderer', () => ({
  GraphRenderer: () => <div data-testid="graph-renderer">Graph</div>,
}));

jest.mock('../LogsRenderer/LogsRenderer', () => ({
  LogsRenderer: () => <div data-testid="logs-renderer">Logs</div>,
}));

jest.mock('../TracesRenderer/TracesRenderer', () => ({
  TracesRenderer: () => <div data-testid="traces-renderer">Traces</div>,
}));

// Mock streamdown
jest.mock('streamdown', () => ({
  Streamdown: ({ text }: { text: string }) => <div data-testid="streamdown">{text}</div>,
}));

// Mock the PromQL parser
jest.mock('../../utils/promqlParser', () => ({
  splitContentByPromQL: (content: string) => [{ type: 'text', content }],
}));

describe('ChatMessage', () => {
  describe('user messages', () => {
    it('should render user message content', () => {
      const message: ChatMessageType = {
        role: 'user',
        content: 'Hello, how are you?',
      };

      render(<ChatMessage message={message} />);

      expect(screen.getByText('Hello, how are you?')).toBeInTheDocument();
    });

    it('should have user message aria label', () => {
      const message: ChatMessageType = {
        role: 'user',
        content: 'Test message',
      };

      render(<ChatMessage message={message} />);

      expect(screen.getByRole('article', { name: 'User message' })).toBeInTheDocument();
    });

    it('should be right-aligned', () => {
      const message: ChatMessageType = {
        role: 'user',
        content: 'Test',
      };

      const { container } = render(<ChatMessage message={message} />);

      const wrapper = container.querySelector('.justify-end');
      expect(wrapper).toBeInTheDocument();
    });

    it('should have appropriate styling classes', () => {
      const message: ChatMessageType = {
        role: 'user',
        content: 'Test',
      };

      const { container } = render(<ChatMessage message={message} />);

      expect(container.querySelector('.rounded-xl')).toBeInTheDocument();
    });
  });

  describe('assistant messages', () => {
    it('should render assistant message content', () => {
      const message: ChatMessageType = {
        role: 'assistant',
        content: 'I am fine, thank you!',
      };

      render(<ChatMessage message={message} />);

      expect(screen.getByTestId('streamdown')).toBeInTheDocument();
    });

    it('should have assistant message aria label', () => {
      const message: ChatMessageType = {
        role: 'assistant',
        content: 'Test response',
      };

      render(<ChatMessage message={message} />);

      expect(screen.getByRole('article', { name: 'Assistant message' })).toBeInTheDocument();
    });

    it('should render tool calls section when present', () => {
      const message: ChatMessageType = {
        role: 'assistant',
        content: 'Here are the results',
        toolCalls: [
          {
            name: 'prometheus_query',
            arguments: '{}',
            running: false,
          },
        ],
      };

      render(<ChatMessage message={message} />);

      expect(screen.getByTestId('tool-calls-section')).toBeInTheDocument();
      expect(screen.getByText('Tool Calls: 1')).toBeInTheDocument();
    });

    it('should not render tool calls section when no tool calls', () => {
      const message: ChatMessageType = {
        role: 'assistant',
        content: 'Just text response',
      };

      render(<ChatMessage message={message} />);

      expect(screen.queryByTestId('tool-calls-section')).not.toBeInTheDocument();
    });
  });

  describe('thinking state', () => {
    it('should show thinking indicator when generating and no content', () => {
      const message: ChatMessageType = {
        role: 'assistant',
        content: '',
      };

      render(<ChatMessage message={message} isGenerating={true} isLastMessage={true} />);

      expect(screen.getByText('Thinking...')).toBeInTheDocument();
    });

    it('should not show thinking when content is present', () => {
      const message: ChatMessageType = {
        role: 'assistant',
        content: 'Some content',
      };

      render(<ChatMessage message={message} isGenerating={true} isLastMessage={true} />);

      expect(screen.queryByText('Thinking...')).not.toBeInTheDocument();
    });

    it('should not show thinking when not generating', () => {
      const message: ChatMessageType = {
        role: 'assistant',
        content: '',
      };

      render(<ChatMessage message={message} isGenerating={false} isLastMessage={true} />);

      expect(screen.queryByText('Thinking...')).not.toBeInTheDocument();
    });

    it('should not show thinking when not last message', () => {
      const message: ChatMessageType = {
        role: 'assistant',
        content: '',
      };

      render(<ChatMessage message={message} isGenerating={true} isLastMessage={false} />);

      expect(screen.queryByText('Thinking...')).not.toBeInTheDocument();
    });
  });

  describe('animations', () => {
    it('should have slide-in animation for user messages', () => {
      const message: ChatMessageType = {
        role: 'user',
        content: 'Test',
      };

      const { container } = render(<ChatMessage message={message} />);

      expect(container.querySelector('.animate-slideIn')).toBeInTheDocument();
    });

    it('should have fade-in animation for assistant messages', () => {
      const message: ChatMessageType = {
        role: 'assistant',
        content: 'Test',
      };

      const { container } = render(<ChatMessage message={message} />);

      expect(container.querySelector('.animate-fadeIn')).toBeInTheDocument();
    });
  });

  describe('accessibility', () => {
    it('should have focusable message container for user messages', () => {
      const message: ChatMessageType = {
        role: 'user',
        content: 'Test',
      };

      const { container } = render(<ChatMessage message={message} />);

      const focusableElement = container.querySelector('[tabindex="0"]');
      expect(focusableElement).toBeInTheDocument();
    });

    it('should have focusable message container for assistant messages', () => {
      const message: ChatMessageType = {
        role: 'assistant',
        content: 'Test',
      };

      const { container } = render(<ChatMessage message={message} />);

      const focusableElement = container.querySelector('[tabindex="0"]');
      expect(focusableElement).toBeInTheDocument();
    });

    it('should have screen reader only text for user messages', () => {
      const message: ChatMessageType = {
        role: 'user',
        content: 'Test',
      };

      render(<ChatMessage message={message} />);

      expect(screen.getByText('User message', { selector: '.sr-only' })).toBeInTheDocument();
    });

    it('should have screen reader only text for assistant messages', () => {
      const message: ChatMessageType = {
        role: 'assistant',
        content: 'Test',
      };

      render(<ChatMessage message={message} />);

      expect(screen.getByText('Assistant message', { selector: '.sr-only' })).toBeInTheDocument();
    });
  });
});

