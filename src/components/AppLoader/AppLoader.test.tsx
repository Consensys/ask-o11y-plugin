import React from 'react';
import { render, screen } from '@testing-library/react';
import { AppLoader, InlineAppLoader } from './AppLoader';

jest.mock('@grafana/ui', () => ({
  Spinner: ({ size }: { size: string }) => <div data-testid="spinner" data-size={size} />,
  useTheme2: () => ({
    colors: {
      primary: { main: '#3274d9' },
      text: { secondary: '#8e8ea0' },
    },
  }),
}));

describe('AppLoader', () => {
  it('should render with default text', () => {
    render(<AppLoader />);

    expect(screen.getByTestId('spinner')).toBeInTheDocument();
    expect(screen.getByText('Loading Ask O11y...')).toBeInTheDocument();
  });

  it('should render with custom text', () => {
    render(<AppLoader text="Loading MCP tools..." />);

    expect(screen.getByText('Loading MCP tools...')).toBeInTheDocument();
  });

  it('should use xl spinner size', () => {
    render(<AppLoader />);

    expect(screen.getByTestId('spinner')).toHaveAttribute('data-size', 'xl');
  });
});

describe('InlineAppLoader', () => {
  it('should render with default text', () => {
    render(<InlineAppLoader />);

    expect(screen.getByTestId('spinner')).toBeInTheDocument();
    expect(screen.getByText('Loading Ask O11y...')).toBeInTheDocument();
  });

  it('should render with custom text', () => {
    render(<InlineAppLoader text="Loading configuration..." />);

    expect(screen.getByText('Loading configuration...')).toBeInTheDocument();
  });

  it('should use md spinner size', () => {
    render(<InlineAppLoader />);

    expect(screen.getByTestId('spinner')).toHaveAttribute('data-size', 'md');
  });
});
