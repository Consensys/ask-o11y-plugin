import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ReasoningIndicator } from './ReasoningIndicator';
import { testIds } from '../../../testIds';

describe('ReasoningIndicator', () => {
  it('renders with collapsed state by default', () => {
    render(<ReasoningIndicator reasoning="Test reasoning content" />);

    const indicator = screen.getByTestId(testIds.chat.reasoningIndicator);
    expect(indicator).toBeInTheDocument();

    expect(screen.getByText('Thinking...')).toBeInTheDocument();
    expect(screen.queryByText('Test reasoning content')).not.toBeInTheDocument();
  });

  it('expands and shows reasoning content when clicked', () => {
    render(<ReasoningIndicator reasoning="Detailed reasoning steps" />);

    const button = screen.getByRole('button');
    fireEvent.click(button);

    expect(screen.getByText('Detailed reasoning steps')).toBeInTheDocument();
  });

  it('collapses reasoning content when clicked again', () => {
    render(<ReasoningIndicator reasoning="Collapsible content" />);

    const button = screen.getByRole('button');

    fireEvent.click(button);
    expect(screen.getByText('Collapsible content')).toBeInTheDocument();

    fireEvent.click(button);
    expect(screen.queryByText('Collapsible content')).not.toBeInTheDocument();
  });

  it('renders multiline reasoning content correctly', () => {
    const multilineReasoning = 'Step 1: Analysis\nStep 2: Evaluation\nStep 3: Conclusion';
    render(<ReasoningIndicator reasoning={multilineReasoning} />);

    const button = screen.getByRole('button');
    fireEvent.click(button);

    const content = screen.getByText(/Step 1: Analysis/);
    expect(content).toBeInTheDocument();
    expect(content.textContent).toContain('Step 2: Evaluation');
    expect(content.textContent).toContain('Step 3: Conclusion');
  });

  it('handles empty reasoning string', () => {
    render(<ReasoningIndicator reasoning="" />);

    const indicator = screen.getByTestId(testIds.chat.reasoningIndicator);
    expect(indicator).toBeInTheDocument();

    const button = screen.getByRole('button');
    fireEvent.click(button);

    const contentDiv = indicator.querySelector('.whitespace-pre-wrap');
    expect(contentDiv).toBeInTheDocument();
    expect(contentDiv?.textContent).toBe('');
  });
});
