/**
 * Component tests for SidePanel
 * Tests rendering logic with mock props, bypassing LLM infrastructure
 */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { SidePanel } from '../SidePanel';
import type { GrafanaPageRef } from '../../../types';

// Mock the useEmbeddingAllowed hook
jest.mock('../../../hooks/useEmbeddingAllowed', () => ({
  useEmbeddingAllowed: () => true,
}));

describe('SidePanel Component', () => {
  const mockOnClose = jest.fn();
  const mockOnRemoveTab = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Rendering with explore page', () => {
    it('should render side panel with explore link', () => {
      const pageRefs: Array<GrafanaPageRef & { messageIndex: number }> = [
        {
          type: 'explore',
          url: '/explore',
          title: 'Explore',
          messageIndex: 0,
        },
      ];

      render(
        <SidePanel
          isOpen={true}
          onClose={mockOnClose}
          pageRefs={pageRefs}
          onRemoveTab={mockOnRemoveTab}
        />
      );

      // Check that the side panel is visible
      const sidePanel = screen.getByRole('complementary', { name: /Grafana page preview/i });
      expect(sidePanel).toBeInTheDocument();
    });

    it('should add kiosk parameter to explore URL', () => {
      const pageRefs: Array<GrafanaPageRef & { messageIndex: number }> = [
        {
          type: 'explore',
          url: '/explore?orgId=1&left=%7B%22datasource%22%3A%22test%22%7D',
          title: 'Explore with query',
          messageIndex: 0,
        },
      ];

      render(
        <SidePanel
          isOpen={true}
          onClose={mockOnClose}
          pageRefs={pageRefs}
          onRemoveTab={mockOnRemoveTab}
        />
      );

      // Find the iframe
      const iframe = screen.getByTitle(/Explore with query/i);
      expect(iframe).toBeInTheDocument();

      // Verify kiosk parameter is added
      const iframeSrc = iframe.getAttribute('src');
      expect(iframeSrc).toContain('kiosk');
    });
  });

  describe('Rendering with dashboard', () => {
    it('should render side panel with dashboard link', () => {
      const pageRefs: Array<GrafanaPageRef & { messageIndex: number }> = [
        {
          type: 'dashboard',
          url: '/d/test-dashboard-123/my-dashboard',
          uid: 'test-dashboard-123',
          title: 'My Dashboard',
          messageIndex: 0,
        },
      ];

      render(
        <SidePanel
          isOpen={true}
          onClose={mockOnClose}
          pageRefs={pageRefs}
          onRemoveTab={mockOnRemoveTab}
        />
      );

      const sidePanel = screen.getByRole('complementary', { name: /Grafana page preview/i });
      expect(sidePanel).toBeInTheDocument();
    });

    it('should add kiosk parameter to dashboard URL', () => {
      const pageRefs: Array<GrafanaPageRef & { messageIndex: number }> = [
        {
          type: 'dashboard',
          url: '/d/test-dashboard-123/my-dashboard',
          uid: 'test-dashboard-123',
          title: 'My Dashboard',
          messageIndex: 0,
        },
      ];

      render(
        <SidePanel
          isOpen={true}
          onClose={mockOnClose}
          pageRefs={pageRefs}
          onRemoveTab={mockOnRemoveTab}
        />
      );

      const iframe = screen.getByTitle(/My Dashboard/i);
      expect(iframe).toBeInTheDocument();

      const iframeSrc = iframe.getAttribute('src');
      expect(iframeSrc).toContain('kiosk');
    });
  });

  describe('Multiple tabs', () => {
    it('should render tabs for multiple page refs', () => {
      const pageRefs: Array<GrafanaPageRef & { messageIndex: number }> = [
        {
          type: 'explore',
          url: '/explore',
          title: 'Explore',
          messageIndex: 0,
        },
        {
          type: 'dashboard',
          url: '/d/dashboard-1/test-dashboard-1',
          uid: 'dashboard-1',
          title: 'Dashboard 1',
          messageIndex: 1,
        },
        {
          type: 'dashboard',
          url: '/d/dashboard-2/test-dashboard-2',
          uid: 'dashboard-2',
          title: 'Dashboard 2',
          messageIndex: 2,
        },
      ];

      render(
        <SidePanel
          isOpen={true}
          onClose={mockOnClose}
          pageRefs={pageRefs}
          onRemoveTab={mockOnRemoveTab}
        />
      );

      // Check for tab buttons
      const exploreTab = screen.getByRole('button', { name: /Explore/i });
      const dashboard1Tab = screen.getByRole('button', { name: /Dashboard 1/i });
      const dashboard2Tab = screen.getByRole('button', { name: /Dashboard 2/i });

      expect(exploreTab).toBeInTheDocument();
      expect(dashboard1Tab).toBeInTheDocument();
      expect(dashboard2Tab).toBeInTheDocument();
    });

    it('should switch tabs when clicked', async () => {
      const pageRefs: Array<GrafanaPageRef & { messageIndex: number }> = [
        {
          type: 'explore',
          url: '/explore',
          title: 'Explore',
          messageIndex: 0,
        },
        {
          type: 'dashboard',
          url: '/d/dashboard-1/test-dashboard',
          uid: 'dashboard-1',
          title: 'Dashboard 1',
          messageIndex: 1,
        },
      ];

      render(
        <SidePanel
          isOpen={true}
          onClose={mockOnClose}
          pageRefs={pageRefs}
          onRemoveTab={mockOnRemoveTab}
        />
      );

      // Initially showing Explore (first tab) - use more specific query for iframe
      let iframe = screen.getAllByTitle(/Explore/i).find(el => el.tagName === 'IFRAME');
      expect(iframe).toBeInTheDocument();
      expect(iframe).toHaveAttribute('src', expect.stringContaining('/explore'));

      // Click Dashboard 1 tab to switch
      const allDashboard1Elements = screen.getAllByText(/Dashboard 1/i);
      const dashboard1TabButton = allDashboard1Elements.find(el => el.tagName === 'BUTTON');
      expect(dashboard1TabButton).toBeInTheDocument();
      fireEvent.click(dashboard1TabButton!);

      // Wait for iframe to update to Dashboard 1
      await waitFor(() => {
        const iframes = screen.getAllByTitle(/Dashboard 1/i).filter(el => el.tagName === 'IFRAME');
        expect(iframes.length).toBeGreaterThan(0);
        expect(iframes[0]).toHaveAttribute('src', expect.stringContaining('/d/dashboard-1'));
      });
    });

    it('should call onRemoveTab when close button clicked', () => {
      const pageRefs: Array<GrafanaPageRef & { messageIndex: number }> = [
        {
          type: 'explore',
          url: '/explore',
          title: 'Explore',
          messageIndex: 0,
        },
        {
          type: 'dashboard',
          url: '/d/dashboard-1/test-dashboard',
          uid: 'dashboard-1',
          title: 'Dashboard 1',
          messageIndex: 1,
        },
      ];

      render(
        <SidePanel
          isOpen={true}
          onClose={mockOnClose}
          pageRefs={pageRefs}
          onRemoveTab={mockOnRemoveTab}
        />
      );

      // Find close button for first tab (should be × button)
      const closeButtons = screen.getAllByRole('button', { name: /close tab/i });
      expect(closeButtons).toHaveLength(2);

      // Click first close button
      fireEvent.click(closeButtons[0]);

      expect(mockOnRemoveTab).toHaveBeenCalledWith(0);
    });
  });

  describe('Close functionality', () => {
    it('should call onClose when close panel button clicked', () => {
      const pageRefs: Array<GrafanaPageRef & { messageIndex: number }> = [
        {
          type: 'explore',
          url: '/explore',
          title: 'Explore',
          messageIndex: 0,
        },
      ];

      render(
        <SidePanel
          isOpen={true}
          onClose={mockOnClose}
          pageRefs={pageRefs}
          onRemoveTab={mockOnRemoveTab}
        />
      );

      // Find close panel button (top-right × button)
      const closePanelButton = screen.getByRole('button', { name: /close panel/i });
      fireEvent.click(closePanelButton);

      expect(mockOnClose).toHaveBeenCalledTimes(1);
    });
  });

  describe('Empty state', () => {
    it('should not render when isOpen is false', () => {
      const pageRefs: Array<GrafanaPageRef & { messageIndex: number }> = [
        {
          type: 'explore',
          url: '/explore',
          title: 'Explore',
          messageIndex: 0,
        },
      ];

      render(
        <SidePanel
          isOpen={false}
          onClose={mockOnClose}
          pageRefs={pageRefs}
          onRemoveTab={mockOnRemoveTab}
        />
      );

      const sidePanel = screen.queryByRole('complementary', { name: /Grafana page preview/i });
      expect(sidePanel).not.toBeInTheDocument();
    });

    it('should not render when pageRefs is empty', () => {
      render(
        <SidePanel
          isOpen={true}
          onClose={mockOnClose}
          pageRefs={[]}
          onRemoveTab={mockOnRemoveTab}
        />
      );

      const sidePanel = screen.queryByRole('complementary', { name: /Grafana page preview/i });
      expect(sidePanel).not.toBeInTheDocument();
    });
  });

  describe('Kiosk mode edge cases', () => {
    it('should not add kiosk if already present', () => {
      const pageRefs: Array<GrafanaPageRef & { messageIndex: number }> = [
        {
          type: 'explore',
          url: '/explore?kiosk=tv',
          title: 'Explore with kiosk',
          messageIndex: 0,
        },
      ];

      render(
        <SidePanel
          isOpen={true}
          onClose={mockOnClose}
          pageRefs={pageRefs}
          onRemoveTab={mockOnRemoveTab}
        />
      );

      const iframe = screen.getByTitle(/Explore with kiosk/i);
      const iframeSrc = iframe.getAttribute('src');

      // Should contain kiosk but not duplicate it
      expect(iframeSrc).toContain('kiosk');
      // Count occurrences of 'kiosk' in URL (should be 1)
      const kioskCount = (iframeSrc?.match(/kiosk/g) || []).length;
      expect(kioskCount).toBe(1);
    });

    it('should not add kiosk if viewPanel is present', () => {
      const pageRefs: Array<GrafanaPageRef & { messageIndex: number }> = [
        {
          type: 'dashboard',
          url: '/d/dashboard-1/test?viewPanel=2',
          uid: 'dashboard-1',
          title: 'Dashboard with viewPanel',
          messageIndex: 0,
        },
      ];

      render(
        <SidePanel
          isOpen={true}
          onClose={mockOnClose}
          pageRefs={pageRefs}
          onRemoveTab={mockOnRemoveTab}
        />
      );

      const iframe = screen.getByTitle(/Dashboard with viewPanel/i);
      const iframeSrc = iframe.getAttribute('src');

      // Should contain viewPanel
      expect(iframeSrc).toContain('viewPanel');
      // Should not add kiosk when viewPanel is present
      expect(iframeSrc).not.toContain('kiosk');
    });

    it('should handle absolute URLs and make them relative', () => {
      const pageRefs: Array<GrafanaPageRef & { messageIndex: number }> = [
        {
          type: 'dashboard',
          url: 'http://localhost:3000/d/dashboard-1/test-dashboard',
          uid: 'dashboard-1',
          title: 'Absolute URL Dashboard',
          messageIndex: 0,
        },
      ];

      render(
        <SidePanel
          isOpen={true}
          onClose={mockOnClose}
          pageRefs={pageRefs}
          onRemoveTab={mockOnRemoveTab}
        />
      );

      const iframe = screen.getByTitle(/Absolute URL Dashboard/i);
      const iframeSrc = iframe.getAttribute('src');

      // Should be relative (starts with /)
      expect(iframeSrc).toMatch(/^\/d\/dashboard-1/);
      // Should have kiosk
      expect(iframeSrc).toContain('kiosk');
    });
  });
});
