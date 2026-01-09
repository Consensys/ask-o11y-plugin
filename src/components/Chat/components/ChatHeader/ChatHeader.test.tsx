/**
 * Unit tests for ChatHeader component
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import { ChatHeader } from './ChatHeader';

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
        secondary: '#f5f5f5',
      },
      border: {
        weak: '#ddd',
      },
    },
  }),
}));

describe('ChatHeader', () => {
  describe('rendering', () => {
    it('should render without crashing', () => {
      const { container } = render(<ChatHeader isGenerating={false} />);
      expect(container.firstChild).toBeInTheDocument();
    });

    it('should have proper container styling', () => {
      const { container } = render(<ChatHeader isGenerating={false} />);

      const header = container.firstChild;
      expect(header).toHaveClass('flex');
      expect(header).toHaveClass('justify-between');
      expect(header).toHaveClass('items-center');
    });
  });

  describe('session title', () => {
    it('should not render session title when not provided', () => {
      render(<ChatHeader isGenerating={false} />);

      const { container } = render(<ChatHeader isGenerating={false} />);
      expect(container.textContent).toBe('');
    });

    it('should render session title when provided', () => {
      render(<ChatHeader isGenerating={false} currentSessionTitle="My Chat Session" />);

      expect(screen.getByText('My Chat Session')).toBeInTheDocument();
    });

    it('should have title attribute for truncated display', () => {
      render(<ChatHeader isGenerating={false} currentSessionTitle="Very Long Session Title" />);

      const title = screen.getByText('Very Long Session Title');
      expect(title).toHaveAttribute('title', 'Very Long Session Title');
    });

    it('should apply correct styling to session title', () => {
      render(<ChatHeader isGenerating={false} currentSessionTitle="Test Session" />);

      const title = screen.getByText('Test Session');
      expect(title).toHaveClass('text-sm');
      expect(title).toHaveClass('truncate');
      expect(title).toHaveClass('max-w-md');
      expect(title).toHaveClass('font-medium');
    });
  });

  describe('isGenerating prop', () => {
    it('should accept isGenerating prop without errors', () => {
      const { rerender } = render(<ChatHeader isGenerating={false} currentSessionTitle="Test" />);
      expect(screen.getByText('Test')).toBeInTheDocument();

      rerender(<ChatHeader isGenerating={true} currentSessionTitle="Test" />);
      expect(screen.getByText('Test')).toBeInTheDocument();
    });
  });
});
