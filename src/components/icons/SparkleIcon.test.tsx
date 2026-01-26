import React from 'react';
import { render } from '@testing-library/react';
import { SparkleIcon } from './SparkleIcon';

describe('SparkleIcon', () => {
  it('should render with default props', () => {
    render(<SparkleIcon data-testid="sparkle-icon" />);

    const svg = document.querySelector('svg');
    expect(svg).toBeInTheDocument();
    expect(svg).toHaveAttribute('width', '24');
    expect(svg).toHaveAttribute('height', '24');
  });

  it('should render with custom size', () => {
    render(<SparkleIcon size={48} />);

    const svg = document.querySelector('svg');
    expect(svg).toHaveAttribute('width', '48');
    expect(svg).toHaveAttribute('height', '48');
  });

  it('should render with custom color', () => {
    render(<SparkleIcon color="#ff0000" />);

    const path = document.querySelector('path');
    expect(path).toHaveAttribute('fill', '#ff0000');
  });

  it('should render with custom opacity', () => {
    render(<SparkleIcon opacity={0.5} />);

    const path = document.querySelector('path');
    expect(path).toHaveAttribute('opacity', '0.5');
  });

  it('should apply className', () => {
    render(<SparkleIcon className="animate-sparkle" />);

    const svg = document.querySelector('svg');
    expect(svg).toHaveClass('animate-sparkle');
  });

  it('should apply inline styles', () => {
    render(<SparkleIcon style={{ marginTop: '10px' }} />);

    const svg = document.querySelector('svg');
    expect(svg).toHaveStyle({ marginTop: '10px' });
  });

  it('should use currentColor as default color', () => {
    render(<SparkleIcon />);

    const path = document.querySelector('path');
    expect(path).toHaveAttribute('fill', 'currentColor');
  });

  it('should use opacity 1 as default', () => {
    render(<SparkleIcon />);

    const path = document.querySelector('path');
    expect(path).toHaveAttribute('opacity', '1');
  });
});
