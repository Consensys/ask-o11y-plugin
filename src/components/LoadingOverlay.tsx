/**
 * Loading Overlay Component
 * Provides visual feedback during async operations with customizable messages and styles
 */

import React from 'react';
import { Spinner, Portal } from '@grafana/ui';

interface LoadingOverlayProps {
  isLoading: boolean;
  message?: string;
  variant?: 'overlay' | 'inline' | 'fullscreen';
  size?: 'sm' | 'md' | 'lg' | 'xl';
  showSpinner?: boolean;
  showProgress?: boolean;
  progress?: number;
  transparent?: boolean;
  children?: React.ReactNode;
  className?: string;
}

/**
 * Loading overlay component for async operations
 */
export const LoadingOverlay: React.FC<LoadingOverlayProps> = ({
  isLoading,
  message = 'Loading...',
  variant = 'overlay',
  size = 'md',
  showSpinner = true,
  showProgress = false,
  progress = 0,
  transparent = false,
  children,
  className = '',
}) => {
  if (!isLoading) {
    return <>{children}</>;
  }

  const getSizeClass = () => {
    switch (size) {
      case 'sm':
        return 'text-xs';
      case 'md':
        return 'text-sm';
      case 'lg':
        return 'text-base';
      case 'xl':
        return 'text-lg';
      default:
        return 'text-sm';
    }
  };

  const getSpinnerSize = () => {
    switch (size) {
      case 'sm':
        return 14;
      case 'md':
        return 20;
      case 'lg':
        return 28;
      case 'xl':
        return 36;
      default:
        return 20;
    }
  };

  const content = (
    <div className={`flex flex-col items-center justify-center ${getSizeClass()}`}>
      {showSpinner && <Spinner size={getSpinnerSize()} className="mb-3" aria-label="Loading spinner" />}
      {message && (
        <div className="text-secondary font-medium" role="status" aria-live="polite">
          {message}
        </div>
      )}
      {showProgress && progress > 0 && (
        <div className="mt-3 w-48">
          <div className="bg-weak rounded-full h-2 overflow-hidden">
            <div
              className="bg-primary h-full transition-all duration-300 ease-out"
              style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
              role="progressbar"
              aria-valuenow={progress}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`Loading progress: ${Math.round(progress)}%`}
            />
          </div>
          <div className="text-center mt-1 text-xs text-secondary">{Math.round(progress)}%</div>
        </div>
      )}
    </div>
  );

  if (variant === 'inline') {
    return (
      <div className={`relative ${className}`}>
        {children && <div className="opacity-50 pointer-events-none">{children}</div>}
        <div className="flex items-center justify-center py-4">{content}</div>
      </div>
    );
  }

  if (variant === 'fullscreen') {
    return (
      <Portal>
        <div
          className={`fixed inset-0 z-50 flex items-center justify-center ${
            transparent ? 'bg-black/30' : 'bg-background'
          } ${className}`}
          role="dialog"
          aria-modal="true"
          aria-label={message}
        >
          <div className="bg-background rounded-lg shadow-lg p-8 max-w-sm w-full mx-4">{content}</div>
        </div>
      </Portal>
    );
  }

  // Default overlay variant
  return (
    <div className={`relative ${className}`}>
      {children}
      <div
        className={`absolute inset-0 z-10 flex items-center justify-center rounded-lg ${
          transparent ? 'bg-black/20' : 'bg-background/90'
        }`}
        role="status"
        aria-live="polite"
        aria-label={message}
      >
        {content}
      </div>
    </div>
  );
};

/**
 * Inline loading indicator for smaller components
 */
export const InlineLoading: React.FC<{
  message?: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}> = ({ message = 'Loading...', size = 'sm', className = '' }) => {
  const spinnerSize = size === 'sm' ? 12 : size === 'md' ? 16 : 20;

  return (
    <div className={`flex items-center gap-2 text-secondary ${className}`} role="status" aria-live="polite">
      <Spinner size={spinnerSize} />
      {message && <span className={size === 'sm' ? 'text-xs' : 'text-sm'}>{message}</span>}
    </div>
  );
};

/**
 * Skeleton loader for content placeholders
 */
export const SkeletonLoader: React.FC<{
  width?: string;
  height?: string;
  className?: string;
  variant?: 'text' | 'rect' | 'circle';
  animate?: boolean;
}> = ({ width = '100%', height = '20px', className = '', variant = 'rect', animate = true }) => {
  const getVariantClass = () => {
    switch (variant) {
      case 'text':
        return 'rounded';
      case 'circle':
        return 'rounded-full';
      default:
        return 'rounded-md';
    }
  };

  return (
    <div
      className={`bg-weak ${getVariantClass()} ${animate ? 'animate-pulse' : ''} ${className}`}
      style={{ width, height }}
      role="presentation"
      aria-hidden="true"
    />
  );
};

/**
 * Loading dots animation
 */
export const LoadingDots: React.FC<{
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}> = ({ size = 'md', className = '' }) => {
  const dotSize = size === 'sm' ? 'w-1 h-1' : size === 'md' ? 'w-1.5 h-1.5' : 'w-2 h-2';

  return (
    <div className={`flex items-center gap-1 ${className}`} role="status" aria-live="polite" aria-label="Loading">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className={`${dotSize} bg-current rounded-full animate-pulse`}
          style={{ animationDelay: `${i * 150}ms` }}
        />
      ))}
    </div>
  );
};

/**
 * Button with loading state
 */
export const LoadingButton: React.FC<{
  isLoading?: boolean;
  loadingText?: string;
  onClick?: () => void;
  disabled?: boolean;
  variant?: 'primary' | 'secondary' | 'destructive';
  size?: 'sm' | 'md' | 'lg';
  icon?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  type?: 'button' | 'submit' | 'reset';
}> = ({
  isLoading = false,
  loadingText = 'Processing...',
  onClick,
  disabled = false,
  variant = 'primary',
  size = 'md',
  icon,
  children,
  className = '',
  type = 'button',
}) => {
  const getVariantClass = () => {
    if (isLoading || disabled) {
      return 'bg-weak text-disabled cursor-not-allowed';
    }

    switch (variant) {
      case 'primary':
        return 'bg-primary hover:bg-primary-shade text-primary-text';
      case 'secondary':
        return 'bg-secondary hover:bg-secondary-shade text-secondary-text border border-medium';
      case 'destructive':
        return 'bg-error hover:bg-error-shade text-error-text';
      default:
        return 'bg-primary hover:bg-primary-shade text-primary-text';
    }
  };

  const getSizeClass = () => {
    switch (size) {
      case 'sm':
        return 'px-3 py-1.5 text-xs';
      case 'md':
        return 'px-4 py-2 text-sm';
      case 'lg':
        return 'px-6 py-3 text-base';
      default:
        return 'px-4 py-2 text-sm';
    }
  };

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={isLoading || disabled}
      className={`
        inline-flex items-center justify-center gap-2
        rounded-md font-medium transition-colors
        focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2
        ${getVariantClass()}
        ${getSizeClass()}
        ${className}
      `}
      aria-busy={isLoading}
      aria-disabled={isLoading || disabled}
    >
      {isLoading ? (
        <>
          <Spinner size={size === 'sm' ? 12 : size === 'md' ? 14 : 16} />
          <span>{loadingText}</span>
        </>
      ) : (
        <>
          {icon}
          {children}
        </>
      )}
    </button>
  );
};
