/**
 * Unit tests for OAuthStatusBadge component
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import { OAuthStatusBadge } from './OAuthStatusBadge';

// Mock Grafana UI
jest.mock('@grafana/ui', () => ({
  Icon: ({ name }: { name: string }) => <span data-testid={`icon-${name}`}>{name}</span>,
}));

describe('OAuthStatusBadge', () => {
  describe('status rendering', () => {
    it('should render not_configured status', () => {
      render(<OAuthStatusBadge status="not_configured" />);
      expect(screen.getByText('Not Configured')).toBeInTheDocument();
      expect(screen.getByTestId('icon-circle')).toBeInTheDocument();
    });

    it('should render authorized status', () => {
      render(<OAuthStatusBadge status="authorized" />);
      expect(screen.getByText('Authorized')).toBeInTheDocument();
      expect(screen.getByTestId('icon-check-circle')).toBeInTheDocument();
    });

    it('should render authorizing status', () => {
      render(<OAuthStatusBadge status="authorizing" />);
      expect(screen.getByText('Authorizing...')).toBeInTheDocument();
      expect(screen.getByTestId('icon-sync')).toBeInTheDocument();
    });

    it('should render expired status', () => {
      render(<OAuthStatusBadge status="expired" />);
      expect(screen.getByText('Expired')).toBeInTheDocument();
      expect(screen.getByTestId('icon-exclamation-triangle')).toBeInTheDocument();
    });

    it('should render error status', () => {
      render(<OAuthStatusBadge status="error" />);
      expect(screen.getByText('Error')).toBeInTheDocument();
      expect(screen.getByTestId('icon-times-circle')).toBeInTheDocument();
    });

    it('should default to not_configured when no status provided', () => {
      render(<OAuthStatusBadge />);
      expect(screen.getByText('Not Configured')).toBeInTheDocument();
    });
  });

  describe('expiration display', () => {
    it('should show expiration in days', () => {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 5);

      render(<OAuthStatusBadge status="authorized" expiresAt={futureDate.toISOString()} />);
      // Use regex to allow for timing variations (4-5 days)
      expect(screen.getByText(/Expires in [45] days?/)).toBeInTheDocument();
    });

    it('should show expiration in hours', () => {
      const futureDate = new Date();
      futureDate.setHours(futureDate.getHours() + 3);

      render(<OAuthStatusBadge status="authorized" expiresAt={futureDate.toISOString()} />);
      // Use regex to allow for timing variations (2-3 hours)
      expect(screen.getByText(/Expires in [23] hours?/)).toBeInTheDocument();
    });

    it('should show expiration in minutes', () => {
      const futureDate = new Date();
      futureDate.setMinutes(futureDate.getMinutes() + 30);

      render(<OAuthStatusBadge status="authorized" expiresAt={futureDate.toISOString()} />);
      // Use regex to allow for timing variations (29-30 minutes)
      expect(screen.getByText(/Expires in (29|30) minutes?/)).toBeInTheDocument();
    });

    it('should show "Expiring soon" for < 1 minute', () => {
      const futureDate = new Date();
      futureDate.setSeconds(futureDate.getSeconds() + 30);

      render(<OAuthStatusBadge status="authorized" expiresAt={futureDate.toISOString()} />);
      expect(screen.getByText('Expiring soon')).toBeInTheDocument();
    });

    it('should not show expiration for non-authorized status', () => {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 5);

      const { container } = render(<OAuthStatusBadge status="expired" expiresAt={futureDate.toISOString()} />);
      expect(container.textContent).not.toContain('Expires in');
    });

    it('should handle invalid date gracefully', () => {
      render(<OAuthStatusBadge status="authorized" expiresAt="invalid-date" />);
      expect(screen.queryByText(/Expires in/)).not.toBeInTheDocument();
    });
  });

  describe('error message display', () => {
    it('should show error message when status is error', () => {
      render(<OAuthStatusBadge status="error" lastError="Authentication failed" />);
      expect(screen.getByText('Authentication failed')).toBeInTheDocument();
    });

    it('should not show error message for non-error status', () => {
      const { container } = render(<OAuthStatusBadge status="authorized" lastError="Some error" />);
      expect(container.textContent).not.toContain('Some error');
    });
  });

  describe('styling', () => {
    it('should apply correct container classes', () => {
      const { container } = render(<OAuthStatusBadge status="authorized" />);
      const wrapper = container.firstChild;
      expect(wrapper).toHaveClass('flex', 'flex-col', 'gap-1');
    });
  });
});
