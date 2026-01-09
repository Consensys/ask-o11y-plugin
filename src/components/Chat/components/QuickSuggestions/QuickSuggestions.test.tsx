/**
 * Unit tests for QuickSuggestions component
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { QuickSuggestions } from './QuickSuggestions';

// Mock Grafana UI
jest.mock('@grafana/ui', () => ({
  useTheme2: () => ({
    isDark: false,
    colors: {
      text: {
        primary: '#000',
        secondary: '#666',
      },
      background: {
        secondary: '#f5f5f5',
      },
      border: {
        weak: '#ddd',
      },
      primary: {
        main: '#7c3aed',
      },
    },
  }),
}));

describe('QuickSuggestions', () => {
  it('should render the section label', () => {
    render(<QuickSuggestions />);
    expect(screen.getByText('Quick start suggestions')).toBeInTheDocument();
  });

  it('should render all suggestion buttons', () => {
    render(<QuickSuggestions />);
    
    expect(screen.getByText('Show me a graph of CPU usage')).toBeInTheDocument();
    expect(screen.getByText('Graph memory by pod')).toBeInTheDocument();
    expect(screen.getByText('Monitor user activity')).toBeInTheDocument();
    expect(screen.getByText('Build a dashboard')).toBeInTheDocument();
  });

  it('should render suggestion icons', () => {
    render(<QuickSuggestions />);
    
    expect(screen.getByText('📊')).toBeInTheDocument();
    expect(screen.getByText('💾')).toBeInTheDocument();
    expect(screen.getByText('🔍')).toBeInTheDocument();
    expect(screen.getByText('🎯')).toBeInTheDocument();
  });

  it('should call onSuggestionClick with the full message when clicked', () => {
    const handleClick = jest.fn();
    render(<QuickSuggestions onSuggestionClick={handleClick} />);
    
    const cpuButton = screen.getByText('Show me a graph of CPU usage').closest('button');
    fireEvent.click(cpuButton!);
    
    expect(handleClick).toHaveBeenCalledWith('Show me a graph of CPU usage over time');
  });

  it('should call onSuggestionClick for each suggestion', () => {
    const handleClick = jest.fn();
    render(<QuickSuggestions onSuggestionClick={handleClick} />);
    
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(4);
    
    fireEvent.click(buttons[0]);
    expect(handleClick).toHaveBeenCalledWith('Show me a graph of CPU usage over time');
    
    fireEvent.click(buttons[1]);
    expect(handleClick).toHaveBeenCalledWith('Graph memory usage by pod in my default namespace');
    
    fireEvent.click(buttons[2]);
    expect(handleClick).toHaveBeenCalledWith('Create a query to monitor user activity over the last 24 hours');
    
    fireEvent.click(buttons[3]);
    expect(handleClick).toHaveBeenCalledWith('Help me build a dashboard for system performance metrics');
  });

  it('should not throw when clicked without onSuggestionClick', () => {
    render(<QuickSuggestions />);
    
    const cpuButton = screen.getByText('Show me a graph of CPU usage').closest('button');
    expect(() => fireEvent.click(cpuButton!)).not.toThrow();
  });

  it('should have proper button styling', () => {
    render(<QuickSuggestions />);
    
    const button = screen.getAllByRole('button')[0];
    expect(button).toHaveClass('rounded-xl');
    expect(button).toHaveClass('cursor-pointer');
    expect(button).toHaveClass('transition-all');
  });

  it('should have fade-in animation', () => {
    const { container } = render(<QuickSuggestions />);
    
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper).toHaveClass('animate-fadeIn');
  });

  describe('hover interactions', () => {
    it('should handle mouseEnter event', () => {
      render(<QuickSuggestions />);
      
      const button = screen.getAllByRole('button')[0];
      expect(() => fireEvent.mouseEnter(button)).not.toThrow();
    });

    it('should handle mouseLeave event', () => {
      render(<QuickSuggestions />);
      
      const button = screen.getAllByRole('button')[0];
      expect(() => fireEvent.mouseLeave(button)).not.toThrow();
    });
  });
});

