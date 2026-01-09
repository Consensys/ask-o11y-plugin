/**
 * Unit tests for SummarizationIndicator component
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import { SummarizationIndicator, SummarizationBadge } from './SummarizationIndicator';

// Mock Grafana UI
jest.mock('@grafana/ui', () => ({
  Icon: ({ name, className }: { name: string; className?: string }) => (
    <span data-testid={`icon-${name}`} className={className}>
      {name}
    </span>
  ),
}));

// Mock LoadingOverlay components
jest.mock('../../../LoadingOverlay', () => ({
  InlineLoading: ({ size }: { size?: string }) => (
    <span data-testid="inline-loading" data-size={size}>
      Loading...
    </span>
  ),
  LoadingDots: ({ size }: { size?: string }) => (
    <span data-testid="loading-dots" data-size={size}>
      ...
    </span>
  ),
}));

describe('SummarizationIndicator', () => {
  describe('when not summarizing and no summary', () => {
    it('should render nothing', () => {
      const { container } = render(
        <SummarizationIndicator isSummarizing={false} hasSummary={false} />
      );
      expect(container.firstChild).toBeNull();
    });
  });

  describe('when summarizing', () => {
    it('should render loading indicator', () => {
      render(<SummarizationIndicator isSummarizing={true} hasSummary={false} />);
      expect(screen.getByTestId('inline-loading')).toBeInTheDocument();
    });

    it('should show "Optimizing conversation memory" text', () => {
      render(<SummarizationIndicator isSummarizing={true} hasSummary={false} />);
      expect(screen.getByText('Optimizing conversation memory...')).toBeInTheDocument();
    });

    it('should display message count when provided', () => {
      render(
        <SummarizationIndicator isSummarizing={true} hasSummary={false} messageCount={15} />
      );
      expect(screen.getByText(/Summarizing 15 older messages/)).toBeInTheDocument();
    });

    it('should have proper aria attributes', () => {
      render(<SummarizationIndicator isSummarizing={true} hasSummary={false} />);
      const status = screen.getByRole('status');
      expect(status).toHaveAttribute('aria-live', 'polite');
      expect(status).toHaveAttribute('aria-label', 'Summarizing conversation');
    });
  });

  describe('when has summary', () => {
    it('should render check icon', () => {
      render(<SummarizationIndicator isSummarizing={false} hasSummary={true} />);
      expect(screen.getByTestId('icon-check-circle')).toBeInTheDocument();
    });

    it('should show "Conversation optimized" text', () => {
      render(<SummarizationIndicator isSummarizing={false} hasSummary={true} />);
      expect(screen.getByText('Conversation optimized')).toBeInTheDocument();
    });

    it('should have proper aria attributes', () => {
      render(<SummarizationIndicator isSummarizing={false} hasSummary={true} />);
      const status = screen.getByRole('status');
      expect(status).toHaveAttribute('aria-label', 'Conversation has been summarized');
    });
  });

  describe('styling', () => {
    it('should apply custom className', () => {
      const { container } = render(
        <SummarizationIndicator
          isSummarizing={true}
          hasSummary={false}
          className="custom-class"
        />
      );
      expect(container.firstChild).toHaveClass('custom-class');
    });

    it('should have info styling classes', () => {
      const { container } = render(
        <SummarizationIndicator isSummarizing={true} hasSummary={false} />
      );
      expect(container.firstChild).toHaveClass('bg-info-background');
      expect(container.firstChild).toHaveClass('border-info');
    });
  });
});

describe('SummarizationBadge', () => {
  describe('when not active', () => {
    it('should render nothing', () => {
      const { container } = render(<SummarizationBadge isActive={false} />);
      expect(container.firstChild).toBeNull();
    });
  });

  describe('when active', () => {
    it('should render loading dots', () => {
      render(<SummarizationBadge isActive={true} />);
      expect(screen.getByTestId('loading-dots')).toBeInTheDocument();
    });

    it('should show "Summarizing" text', () => {
      render(<SummarizationBadge isActive={true} />);
      expect(screen.getByText('Summarizing')).toBeInTheDocument();
    });

    it('should have proper aria attributes', () => {
      render(<SummarizationBadge isActive={true} />);
      const status = screen.getByRole('status');
      expect(status).toHaveAttribute('aria-label', 'Summarizing conversation');
    });

    it('should apply custom className', () => {
      render(<SummarizationBadge isActive={true} className="custom-badge" />);
      const status = screen.getByRole('status');
      expect(status).toHaveClass('custom-badge');
    });

    it('should have rounded badge styling', () => {
      render(<SummarizationBadge isActive={true} />);
      const status = screen.getByRole('status');
      expect(status).toHaveClass('rounded-full');
      expect(status).toHaveClass('bg-info-background');
    });
  });
});

