/**
 * Unit tests for WelcomeMessage component
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import { WelcomeMessage } from './WelcomeMessage';

// Mock Grafana UI
jest.mock('@grafana/ui', () => ({
  useTheme2: () => ({
    colors: {
      text: {
        primary: '#000',
        secondary: '#666',
      },
    },
  }),
}));

describe('WelcomeMessage', () => {
  it('should render the welcome greeting', () => {
    render(<WelcomeMessage />);
    expect(screen.getByText(/Hi, I'm/i)).toBeInTheDocument();
  });

  it('should render the assistant name', () => {
    render(<WelcomeMessage />);
    expect(screen.getByText('Ask O11y Assistant')).toBeInTheDocument();
  });

  it('should render the BETA badge', () => {
    render(<WelcomeMessage />);
    expect(screen.getByText('BETA')).toBeInTheDocument();
  });

  it('should render the version number', () => {
    render(<WelcomeMessage />);
    expect(screen.getByText('v0.2.2')).toBeInTheDocument();
  });

  it('should render the description', () => {
    render(<WelcomeMessage />);
    expect(screen.getByText(/agentic LLM assistant/i)).toBeInTheDocument();
    expect(screen.getByText(/for Grafana/i)).toBeInTheDocument();
  });

  it('should have proper styling classes', () => {
    const { container } = render(<WelcomeMessage />);
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper).toHaveClass('text-center');
    expect(wrapper).toHaveClass('animate-fadeIn');
  });

  it('should render the sparkle icon', () => {
    const { container } = render(<WelcomeMessage />);
    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();
  });
});

