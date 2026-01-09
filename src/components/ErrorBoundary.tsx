/**
 * React Error Boundary Component
 * Catches JavaScript errors anywhere in the component tree and displays a fallback UI
 */

import React, { Component, ErrorInfo, ReactNode } from 'react';
import { Alert, Button, Icon } from '@grafana/ui';

interface Props {
  children: ReactNode;
  fallbackTitle?: string;
  onReset?: () => void;
  logError?: (error: Error, errorInfo: ErrorInfo) => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
  errorCount: number;
}

/**
 * Error Boundary component that catches errors in child components
 * and displays a user-friendly error message
 */
export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      errorCount: 0,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    // Update state to trigger fallback UI
    return {
      hasError: true,
      error,
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    // Log the error details
    console.error('[ErrorBoundary] Caught error:', error, errorInfo);

    // Update state with error details
    this.setState((prevState) => ({
      errorInfo,
      errorCount: prevState.errorCount + 1,
    }));

    // Call custom error logger if provided
    if (this.props.logError) {
      this.props.logError(error, errorInfo);
    }

    // Send error to monitoring service (if configured)
    this.reportErrorToService(error, errorInfo);
  }

  componentDidUpdate(prevProps: Props) {
    // Reset error boundary if children change
    if (prevProps.children !== this.props.children && this.state.hasError) {
      this.resetErrorBoundary();
    }
  }

  reportErrorToService = (error: Error, errorInfo: ErrorInfo) => {
    // In production, this would send to an error monitoring service
    // For now, just log to console with structured data
    const errorReport = {
      message: error.message,
      stack: error.stack,
      componentStack: errorInfo.componentStack,
      timestamp: new Date().toISOString(),
      errorCount: this.state.errorCount,
    };

    console.error('[ErrorBoundary] Error report:', errorReport);
  };

  resetErrorBoundary = () => {
    // Reset the error boundary state
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
    });

    // Call custom reset handler if provided
    if (this.props.onReset) {
      this.props.onReset();
    }
  };

  render() {
    if (this.state.hasError) {
      const { error, errorInfo, errorCount } = this.state;
      const { fallbackTitle = 'Something went wrong' } = this.props;

      // Show fallback UI
      return (
        <div className="error-boundary-fallback p-4">
          <Alert severity="error" title={fallbackTitle} className="mb-4">
            <div className="space-y-3">
              <p>
                An unexpected error occurred. The application encountered an issue and couldn&apos;t recover
                automatically.
              </p>

              {error && (
                <div className="mt-3">
                  <strong>Error: </strong>
                  <code className="text-xs bg-weak p-1 rounded">{error.message}</code>
                </div>
              )}

              {errorCount > 1 && (
                <div className="text-warning text-sm mt-2">
                  <Icon name="exclamation-triangle" className="mr-1" />
                  This error has occurred {errorCount} times.
                </div>
              )}

              <div className="flex gap-2 mt-4">
                <Button onClick={this.resetErrorBoundary} variant="primary" icon="repeat">
                  Try Again
                </Button>
                <Button onClick={() => window.location.reload()} variant="secondary" icon="sync">
                  Reload Page
                </Button>
              </div>

              {/* Expandable error details for developers */}
              {process.env.NODE_ENV === 'development' && errorInfo && (
                <details className="mt-4 p-3 bg-weak rounded">
                  <summary className="cursor-pointer font-medium text-sm">
                    Developer Details (Development Mode Only)
                  </summary>
                  <div className="mt-3 space-y-2">
                    <div>
                      <strong>Stack Trace:</strong>
                      <pre className="text-xs mt-1 p-2 bg-background rounded overflow-auto max-h-48">
                        {error?.stack}
                      </pre>
                    </div>
                    <div>
                      <strong>Component Stack:</strong>
                      <pre className="text-xs mt-1 p-2 bg-background rounded overflow-auto max-h-48">
                        {errorInfo.componentStack}
                      </pre>
                    </div>
                  </div>
                </details>
              )}
            </div>
          </Alert>
        </div>
      );
    }

    // No error, render children normally
    return this.props.children;
  }
}

/**
 * Specialized error boundary for the Chat component
 */
export class ChatErrorBoundary extends Component<{ children: ReactNode }, State> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      errorCount: 0,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return {
      hasError: true,
      error,
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[ChatErrorBoundary] Chat component error:', error, errorInfo);

    this.setState((prevState) => ({
      errorInfo,
      errorCount: prevState.errorCount + 1,
    }));
  }

  resetChat = () => {
    // Clear chat-specific state if needed
    localStorage.removeItem('chat_recovery_state');

    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
    });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="chat-error-boundary p-4">
          <Alert severity="error" title="Chat Error" className="mb-4">
            <div className="space-y-3">
              <p>
                The chat component encountered an error. Your conversation history is safe and will be restored when you
                restart.
              </p>

              <div className="flex gap-2 mt-4">
                <Button onClick={this.resetChat} variant="primary" icon="comments-alt">
                  Restart Chat
                </Button>
                <Button
                  onClick={() => {
                    // Clear session and reload
                    sessionStorage.clear();
                    window.location.reload();
                  }}
                  variant="secondary"
                  icon="trash-alt"
                >
                  Clear Session & Reload
                </Button>
              </div>
            </div>
          </Alert>
        </div>
      );
    }

    return this.props.children;
  }
}

/**
 * Hook for using error boundaries with functional components
 */
export function useErrorHandler() {
  const [error, setError] = React.useState<Error | null>(null);

  React.useEffect(() => {
    if (error) {
      throw error;
    }
  }, [error]);

  const resetError = () => setError(null);
  const captureError = (error: Error) => setError(error);

  return { captureError, resetError };
}

// Export a HOC for wrapping components with error boundary
export function withErrorBoundary<P extends object>(Component: React.ComponentType<P>, fallbackTitle?: string) {
  const WithErrorBoundaryComponent = (props: P) => (
    <ErrorBoundary fallbackTitle={fallbackTitle}>
      <Component {...props} />
    </ErrorBoundary>
  );

  WithErrorBoundaryComponent.displayName = `WithErrorBoundary(${
    Component.displayName || Component.name || 'Component'
  })`;

  return WithErrorBoundaryComponent;
}
