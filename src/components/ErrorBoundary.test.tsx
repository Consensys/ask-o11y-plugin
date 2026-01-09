/**
 * Unit tests for ErrorBoundary component
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { ErrorBoundary } from './ErrorBoundary';

// Mock Grafana UI
jest.mock('@grafana/ui', () => ({
  Alert: ({ title, children, severity }: any) => (
    <div data-testid="alert" data-severity={severity}>
      <strong>{title}</strong>
      <div>{children}</div>
    </div>
  ),
  Button: ({ children, onClick, variant, icon }: any) => (
    <button onClick={onClick} data-variant={variant} data-icon={icon}>
      {children}
    </button>
  ),
  Icon: ({ name }: { name: string }) => <span data-testid={`icon-${name}`}>{name}</span>,
}));

// Component that throws an error
const ThrowError: React.FC<{ shouldThrow?: boolean }> = ({ shouldThrow = true }) => {
  if (shouldThrow) {
    throw new Error('Test error');
  }
  return <div>No error</div>;
};

// Suppress console.error in tests
const originalError = console.error;
beforeAll(() => {
  console.error = jest.fn();
});
afterAll(() => {
  console.error = originalError;
});

describe('ErrorBoundary', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('without errors', () => {
    it('should render children when there is no error', () => {
      render(
        <ErrorBoundary>
          <div>Child content</div>
        </ErrorBoundary>
      );

      expect(screen.getByText('Child content')).toBeInTheDocument();
    });

    it('should not render error UI when no error', () => {
      render(
        <ErrorBoundary>
          <ThrowError shouldThrow={false} />
        </ErrorBoundary>
      );

      expect(screen.getByText('No error')).toBeInTheDocument();
      expect(screen.queryByTestId('alert')).not.toBeInTheDocument();
    });
  });

  describe('with errors', () => {
    it('should catch errors and display fallback UI', () => {
      render(
        <ErrorBoundary fallbackTitle="Custom Error Title">
          <ThrowError />
        </ErrorBoundary>
      );

      expect(screen.getByTestId('alert')).toBeInTheDocument();
      expect(screen.getByText('Custom Error Title')).toBeInTheDocument();
    });

    it('should display default title when not provided', () => {
      render(
        <ErrorBoundary>
          <ThrowError />
        </ErrorBoundary>
      );

      expect(screen.getByTestId('alert')).toBeInTheDocument();
    });

    it('should call logError callback when error occurs', () => {
      const logError = jest.fn();

      render(
        <ErrorBoundary logError={logError}>
          <ThrowError />
        </ErrorBoundary>
      );

      expect(logError).toHaveBeenCalled();
      expect(logError.mock.calls[0][0]).toBeInstanceOf(Error);
      expect(logError.mock.calls[0][0].message).toBe('Test error');
    });

    it('should have retry button', () => {
      render(
        <ErrorBoundary>
          <ThrowError />
        </ErrorBoundary>
      );

      expect(screen.getByText('Try Again')).toBeInTheDocument();
    });

    it('should call onReset when retry is clicked', () => {
      const onReset = jest.fn();

      render(
        <ErrorBoundary onReset={onReset}>
          <ThrowError />
        </ErrorBoundary>
      );

      const retryButton = screen.getByText('Try Again');
      fireEvent.click(retryButton);

      expect(onReset).toHaveBeenCalled();
    });
  });

  describe('error display', () => {
    it('should show error message', () => {
      render(
        <ErrorBoundary>
          <ThrowError />
        </ErrorBoundary>
      );

      expect(screen.getByText(/Test error/)).toBeInTheDocument();
    });

    it('should have error severity', () => {
      render(
        <ErrorBoundary>
          <ThrowError />
        </ErrorBoundary>
      );

      const alert = screen.getByTestId('alert');
      expect(alert).toHaveAttribute('data-severity', 'error');
    });
  });

  describe('error recovery', () => {
    it('should allow recovery after error', () => {
      const { rerender } = render(
        <ErrorBoundary>
          <ThrowError />
        </ErrorBoundary>
      );

      // Verify error UI is shown
      expect(screen.getByTestId('alert')).toBeInTheDocument();

      // Rerender with working component
      rerender(
        <ErrorBoundary>
          <ThrowError shouldThrow={false} />
        </ErrorBoundary>
      );

      // Error boundary should reset when children change
      expect(screen.getByText('No error')).toBeInTheDocument();
    });
  });
});

