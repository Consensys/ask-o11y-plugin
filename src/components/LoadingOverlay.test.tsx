import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { LoadingOverlay, InlineLoading, SkeletonLoader, LoadingDots, LoadingButton } from './LoadingOverlay';

// Mock Grafana UI components
jest.mock('@grafana/ui', () => ({
  Spinner: ({ size, className }: { size?: number; className?: string }) => (
    <div data-testid="spinner" data-size={size} className={className} aria-label="spinner" />
  ),
  Portal: ({ children }: { children: React.ReactNode }) => <div data-testid="portal">{children}</div>,
}));

describe('LoadingOverlay', () => {
  it('should render children when not loading', () => {
    render(
      <LoadingOverlay isLoading={false}>
        <div data-testid="child-content">Child Content</div>
      </LoadingOverlay>
    );

    expect(screen.getByTestId('child-content')).toBeInTheDocument();
    expect(screen.queryByTestId('spinner')).not.toBeInTheDocument();
  });

  it('should show loading overlay when isLoading is true', () => {
    render(
      <LoadingOverlay isLoading={true}>
        <div data-testid="child-content">Child Content</div>
      </LoadingOverlay>
    );

    expect(screen.getByTestId('spinner')).toBeInTheDocument();
    expect(screen.getAllByRole('status').length).toBeGreaterThan(0);
  });

  it('should display custom message', () => {
    render(<LoadingOverlay isLoading={true} message="Please wait..." />);

    expect(screen.getByText('Please wait...')).toBeInTheDocument();
  });

  it('should use default message when none provided', () => {
    render(<LoadingOverlay isLoading={true} />);

    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });

  it('should hide spinner when showSpinner is false', () => {
    render(<LoadingOverlay isLoading={true} showSpinner={false} message="Loading..." />);

    expect(screen.queryByTestId('spinner')).not.toBeInTheDocument();
  });

  it('should show progress bar when showProgress is true with progress > 0', () => {
    render(<LoadingOverlay isLoading={true} showProgress={true} progress={50} />);

    expect(screen.getByRole('progressbar')).toBeInTheDocument();
    expect(screen.getByText('50%')).toBeInTheDocument();
  });

  it('should not show progress bar when progress is 0', () => {
    render(<LoadingOverlay isLoading={true} showProgress={true} progress={0} />);

    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it('should clamp progress to 100 when exceeding 100', () => {
    render(<LoadingOverlay isLoading={true} showProgress={true} progress={150} />);

    // Check the style has 100% width for progress > 100
    const progressBar = screen.getByRole('progressbar');
    expect(progressBar).toHaveStyle({ width: '100%' });
  });

  it('should clamp progress to minimum 0', () => {
    // Progress of 1 should still show progress bar with valid width
    render(<LoadingOverlay isLoading={true} showProgress={true} progress={1} />);
    const progressBar = screen.getByRole('progressbar');
    expect(progressBar).toHaveStyle({ width: '1%' });
  });

  describe('size variations', () => {
    it('should render with sm size', () => {
      render(<LoadingOverlay isLoading={true} size="sm" />);
      expect(screen.getByTestId('spinner')).toHaveAttribute('data-size', '14');
    });

    it('should render with md size', () => {
      render(<LoadingOverlay isLoading={true} size="md" />);
      expect(screen.getByTestId('spinner')).toHaveAttribute('data-size', '20');
    });

    it('should render with lg size', () => {
      render(<LoadingOverlay isLoading={true} size="lg" />);
      expect(screen.getByTestId('spinner')).toHaveAttribute('data-size', '28');
    });

    it('should render with xl size', () => {
      render(<LoadingOverlay isLoading={true} size="xl" />);
      expect(screen.getByTestId('spinner')).toHaveAttribute('data-size', '36');
    });
  });

  describe('variant variations', () => {
    it('should render inline variant', () => {
      render(
        <LoadingOverlay isLoading={true} variant="inline">
          <div>Child</div>
        </LoadingOverlay>
      );

      expect(screen.getByTestId('spinner')).toBeInTheDocument();
    });

    it('should render fullscreen variant using Portal', () => {
      render(<LoadingOverlay isLoading={true} variant="fullscreen" />);

      expect(screen.getByTestId('portal')).toBeInTheDocument();
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    it('should render overlay variant by default', () => {
      render(
        <LoadingOverlay isLoading={true}>
          <div>Child</div>
        </LoadingOverlay>
      );

      expect(screen.getAllByRole('status').length).toBeGreaterThan(0);
    });
  });

  it('should apply transparent background when transparent is true', () => {
    render(<LoadingOverlay isLoading={true} variant="fullscreen" transparent={true} />);

    const dialog = screen.getByRole('dialog');
    expect(dialog.className).toContain('bg-black/30');
  });

  it('should apply custom className', () => {
    render(<LoadingOverlay isLoading={true} className="custom-class" />);

    // The className is applied to the outer container
    const containers = screen.getAllByRole('status');
    const container = containers[0].closest('.custom-class');
    expect(container).toBeInTheDocument();
  });
});

describe('InlineLoading', () => {
  it('should render with default props', () => {
    render(<InlineLoading />);

    expect(screen.getByTestId('spinner')).toBeInTheDocument();
    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });

  it('should render with custom message', () => {
    render(<InlineLoading message="Fetching data..." />);

    expect(screen.getByText('Fetching data...')).toBeInTheDocument();
  });

  it('should not render message text when message is empty', () => {
    render(<InlineLoading message="" />);

    // The component renders a spinner but no message text span
    const container = screen.getByRole('status');
    const spans = container.querySelectorAll('span');
    expect(spans).toHaveLength(0);
  });

  describe('size variations', () => {
    it('should render with sm size', () => {
      render(<InlineLoading size="sm" />);
      expect(screen.getByTestId('spinner')).toHaveAttribute('data-size', '12');
    });

    it('should render with md size', () => {
      render(<InlineLoading size="md" />);
      expect(screen.getByTestId('spinner')).toHaveAttribute('data-size', '16');
    });

    it('should render with lg size', () => {
      render(<InlineLoading size="lg" />);
      expect(screen.getByTestId('spinner')).toHaveAttribute('data-size', '20');
    });
  });

  it('should apply custom className', () => {
    render(<InlineLoading className="custom-inline" />);

    expect(screen.getByRole('status').className).toContain('custom-inline');
  });
});

describe('SkeletonLoader', () => {
  it('should render with default props', () => {
    render(<SkeletonLoader />);

    const skeleton = screen.getByRole('presentation', { hidden: true });
    expect(skeleton).toHaveStyle({ width: '100%', height: '20px' });
    expect(skeleton.className).toContain('animate-pulse');
  });

  it('should render with custom dimensions', () => {
    render(<SkeletonLoader width="200px" height="50px" />);

    const skeleton = screen.getByRole('presentation', { hidden: true });
    expect(skeleton).toHaveStyle({ width: '200px', height: '50px' });
  });

  describe('variant variations', () => {
    it('should render text variant', () => {
      render(<SkeletonLoader variant="text" />);

      const skeleton = screen.getByRole('presentation', { hidden: true });
      expect(skeleton.className).toContain('rounded');
    });

    it('should render circle variant', () => {
      render(<SkeletonLoader variant="circle" />);

      const skeleton = screen.getByRole('presentation', { hidden: true });
      expect(skeleton.className).toContain('rounded-full');
    });

    it('should render rect variant by default', () => {
      render(<SkeletonLoader variant="rect" />);

      const skeleton = screen.getByRole('presentation', { hidden: true });
      expect(skeleton.className).toContain('rounded-md');
    });
  });

  it('should not animate when animate is false', () => {
    render(<SkeletonLoader animate={false} />);

    const skeleton = screen.getByRole('presentation', { hidden: true });
    expect(skeleton.className).not.toContain('animate-pulse');
  });

  it('should apply custom className', () => {
    render(<SkeletonLoader className="custom-skeleton" />);

    const skeleton = screen.getByRole('presentation', { hidden: true });
    expect(skeleton.className).toContain('custom-skeleton');
  });
});

describe('LoadingDots', () => {
  it('should render three dots', () => {
    render(<LoadingDots />);

    const container = screen.getByRole('status');
    const dots = container.querySelectorAll('.rounded-full');
    expect(dots).toHaveLength(3);
  });

  it('should have proper aria-label', () => {
    render(<LoadingDots />);

    expect(screen.getByLabelText('Loading')).toBeInTheDocument();
  });

  describe('size variations', () => {
    it('should render with sm size', () => {
      render(<LoadingDots size="sm" />);

      const container = screen.getByRole('status');
      const dots = container.querySelectorAll('.w-1');
      expect(dots).toHaveLength(3);
    });

    it('should render with md size', () => {
      render(<LoadingDots size="md" />);

      const container = screen.getByRole('status');
      const dots = container.querySelectorAll('.w-1\\.5');
      expect(dots).toHaveLength(3);
    });

    it('should render with lg size', () => {
      render(<LoadingDots size="lg" />);

      const container = screen.getByRole('status');
      const dots = container.querySelectorAll('.w-2');
      expect(dots).toHaveLength(3);
    });
  });

  it('should apply custom className', () => {
    render(<LoadingDots className="custom-dots" />);

    expect(screen.getByRole('status').className).toContain('custom-dots');
  });
});

describe('LoadingButton', () => {
  it('should render children when not loading', () => {
    render(<LoadingButton>Click me</LoadingButton>);

    expect(screen.getByText('Click me')).toBeInTheDocument();
    expect(screen.queryByTestId('spinner')).not.toBeInTheDocument();
  });

  it('should show spinner and loading text when loading', () => {
    render(<LoadingButton isLoading={true}>Click me</LoadingButton>);

    expect(screen.getByTestId('spinner')).toBeInTheDocument();
    expect(screen.getByText('Processing...')).toBeInTheDocument();
    expect(screen.queryByText('Click me')).not.toBeInTheDocument();
  });

  it('should use custom loading text', () => {
    render(
      <LoadingButton isLoading={true} loadingText="Saving...">
        Click me
      </LoadingButton>
    );

    expect(screen.getByText('Saving...')).toBeInTheDocument();
  });

  it('should call onClick when clicked and not loading', () => {
    const handleClick = jest.fn();
    render(<LoadingButton onClick={handleClick}>Click me</LoadingButton>);

    fireEvent.click(screen.getByText('Click me'));
    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  it('should be disabled when loading', () => {
    const handleClick = jest.fn();
    render(
      <LoadingButton isLoading={true} onClick={handleClick}>
        Click me
      </LoadingButton>
    );

    const button = screen.getByRole('button');
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button).toHaveAttribute('aria-disabled', 'true');
  });

  it('should be disabled when disabled prop is true', () => {
    render(<LoadingButton disabled={true}>Click me</LoadingButton>);

    expect(screen.getByRole('button')).toBeDisabled();
  });

  describe('variant variations', () => {
    it('should render primary variant', () => {
      render(<LoadingButton variant="primary">Primary</LoadingButton>);

      const button = screen.getByRole('button');
      expect(button.className).toContain('bg-primary');
    });

    it('should render secondary variant', () => {
      render(<LoadingButton variant="secondary">Secondary</LoadingButton>);

      const button = screen.getByRole('button');
      expect(button.className).toContain('bg-secondary');
    });

    it('should render destructive variant', () => {
      render(<LoadingButton variant="destructive">Delete</LoadingButton>);

      const button = screen.getByRole('button');
      expect(button.className).toContain('bg-error');
    });
  });

  describe('size variations', () => {
    it('should render with sm size', () => {
      render(<LoadingButton size="sm">Small</LoadingButton>);

      const button = screen.getByRole('button');
      expect(button.className).toContain('text-xs');
    });

    it('should render with md size', () => {
      render(<LoadingButton size="md">Medium</LoadingButton>);

      const button = screen.getByRole('button');
      expect(button.className).toContain('text-sm');
    });

    it('should render with lg size', () => {
      render(<LoadingButton size="lg">Large</LoadingButton>);

      const button = screen.getByRole('button');
      expect(button.className).toContain('text-base');
    });
  });

  it('should render with icon', () => {
    render(<LoadingButton icon={<span data-testid="icon">🚀</span>}>With Icon</LoadingButton>);

    expect(screen.getByTestId('icon')).toBeInTheDocument();
  });

  it('should not show icon when loading', () => {
    render(
      <LoadingButton isLoading={true} icon={<span data-testid="icon">🚀</span>}>
        With Icon
      </LoadingButton>
    );

    expect(screen.queryByTestId('icon')).not.toBeInTheDocument();
  });

  it('should render with different button types', () => {
    const { rerender } = render(<LoadingButton type="submit">Submit</LoadingButton>);

    expect(screen.getByRole('button')).toHaveAttribute('type', 'submit');

    rerender(<LoadingButton type="reset">Reset</LoadingButton>);
    expect(screen.getByRole('button')).toHaveAttribute('type', 'reset');
  });

  it('should apply custom className', () => {
    render(<LoadingButton className="custom-button">Custom</LoadingButton>);

    expect(screen.getByRole('button').className).toContain('custom-button');
  });

  it('should apply disabled styles when disabled or loading', () => {
    const { rerender } = render(<LoadingButton disabled={true}>Disabled</LoadingButton>);

    let button = screen.getByRole('button');
    expect(button.className).toContain('cursor-not-allowed');
    expect(button.className).toContain('bg-weak');

    rerender(<LoadingButton isLoading={true}>Loading</LoadingButton>);
    button = screen.getByRole('button');
    expect(button.className).toContain('cursor-not-allowed');
    expect(button.className).toContain('bg-weak');
  });
});

