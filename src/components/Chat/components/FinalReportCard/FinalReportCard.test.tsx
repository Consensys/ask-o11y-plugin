/**
 * Unit tests for FinalReportCard component
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import { FinalReportCard } from './FinalReportCard';
import { AgentFinalReport } from '../../types';

const mockTheme = {
  isDark: false,
  colors: {
    text: { primary: '#000', secondary: '#666' },
    background: { primary: '#fff', secondary: '#f5f5f5' },
    border: { weak: '#ddd' },
    success: { main: '#0a7f4e' },
    warning: { main: '#b98d00' },
    info: { main: '#1a60a5' },
  },
  spacing: (factor: number) => `${factor * 8}px`,
};

jest.mock('@grafana/ui', () => ({
  useTheme2: () => mockTheme,
  Icon: ({ name }: any) => <span data-testid={`icon-${name}`} />,
}));

describe('FinalReportCard', () => {
  it('should render nothing for a plain report without hypotheses or validation', () => {
    const report: AgentFinalReport = { summary: 'RCA complete' };
    const { container } = render(<FinalReportCard report={report} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('should render ranked hypotheses with component, fault type and confidence', () => {
    const report: AgentFinalReport = {
      summary: 'RCA complete',
      confidence: 'high',
      hypotheses: [
        {
          rank: 1,
          component: 'checkout',
          faultType: 'saturation',
          confidence: 'high',
          evidenceIds: ['tc_1'],
          propagationPath: ['frontend', 'checkout', 'payment'],
          firstSeen: '2026-09-25T10:00:00Z',
        },
        {
          rank: 2,
          component: 'payment',
          faultType: 'error',
        },
      ],
    };

    render(<FinalReportCard report={report} />);

    expect(screen.getByTestId('data-testid chat-final-report-card')).toBeInTheDocument();
    expect(screen.getByTestId('data-testid chat-final-report-hypothesis-0')).toBeInTheDocument();
    expect(screen.getByTestId('data-testid chat-final-report-hypothesis-1')).toBeInTheDocument();
    expect(screen.getByText(/checkout — saturation/)).toBeInTheDocument();
    expect(screen.getByText('high confidence')).toBeInTheDocument();
    expect(screen.getByText('frontend → checkout → payment')).toBeInTheDocument();
    expect(screen.getByText(/First seen/)).toBeInTheDocument();
  });

  it('should render validation badges and gaps', () => {
    const report: AgentFinalReport = {
      summary: 'RCA complete',
      hypotheses: [{ rank: 1, component: 'checkout', faultType: 'saturation' }],
      validation: {
        evidenceGrounded: true,
        temporalOk: false,
        topologyConsistent: true,
        warnings: ['hypothesis 1: firstSeen is not a valid timestamp'],
        repaired: true,
      },
      gaps: ['No traces available for the window'],
    };

    render(<FinalReportCard report={report} />);

    expect(screen.getByText('Evidence-grounded')).toBeInTheDocument();
    expect(screen.getByText('Cause before symptom')).toBeInTheDocument();
    expect(screen.getByText('Topology-consistent')).toBeInTheDocument();
    expect(screen.getByText('(repaired after validation)')).toBeInTheDocument();
    expect(screen.getByText('No traces available for the window')).toBeInTheDocument();
    expect(screen.getByText(/firstSeen is not a valid timestamp/)).toBeInTheDocument();
  });
});
