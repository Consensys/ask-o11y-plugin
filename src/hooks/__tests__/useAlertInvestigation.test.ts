import { renderHook, waitFor } from '@testing-library/react';
import { useAlertInvestigation } from '../useAlertInvestigation';
import { backendMCPClient } from '../../services/backendMCPClient';

// Mock the backendMCPClient
jest.mock('../../services/backendMCPClient', () => ({
  backendMCPClient: {
    callTool: jest.fn(),
  },
}));

// Helper to set URL search params
const setSearchParams = (params: Record<string, string>) => {
  const searchParams = new URLSearchParams(params);
  Object.defineProperty(window, 'location', {
    value: {
      search: `?${searchParams.toString()}`,
    },
    writable: true,
  });
};

// Helper to clear URL search params
const clearSearchParams = () => {
  Object.defineProperty(window, 'location', {
    value: {
      search: '',
    },
    writable: true,
  });
};

describe('useAlertInvestigation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clearSearchParams();
  });

  describe('when not in investigation mode', () => {
    it('should return isInvestigationMode false when type param is missing', async () => {
      setSearchParams({ alertId: 'test-alert-123' });

      const { result } = renderHook(() => useAlertInvestigation());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.isInvestigationMode).toBe(false);
      expect(result.current.initialMessage).toBeNull();
      expect(result.current.error).toBeNull();
    });

    it('should return isInvestigationMode false when alertId param is missing', async () => {
      setSearchParams({ type: 'investigation' });

      const { result } = renderHook(() => useAlertInvestigation());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.isInvestigationMode).toBe(false);
      expect(result.current.initialMessage).toBeNull();
    });

    it('should return isInvestigationMode false when no query params', async () => {
      clearSearchParams();

      const { result } = renderHook(() => useAlertInvestigation());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.isInvestigationMode).toBe(false);
    });
  });

  describe('when in investigation mode', () => {
    const mockAlertData = {
      uid: 'test-alert-123',
      title: 'High CPU Usage',
      state: 'alerting',
      labels: { severity: 'critical', service: 'api' },
      annotations: { description: 'CPU usage is above 80%' },
    };

    it('should load alert details and build investigation prompt', async () => {
      setSearchParams({ type: 'investigation', alertId: 'test-alert-123' });

      (backendMCPClient.callTool as jest.Mock).mockResolvedValue({
        content: [{ type: 'text', text: JSON.stringify(mockAlertData) }],
        isError: false,
      });

      const { result } = renderHook(() => useAlertInvestigation());

      // Initially loading
      expect(result.current.isLoading).toBe(true);
      expect(result.current.isInvestigationMode).toBe(true);

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.error).toBeNull();
      expect(result.current.alertDetails).toEqual(expect.objectContaining({
        uid: 'test-alert-123',
        title: 'High CPU Usage',
        state: 'alerting',
      }));
      expect(result.current.initialMessage).toContain('Investigate this alert');
      expect(result.current.initialMessage).toContain('High CPU Usage');
      expect(result.current.sessionTitle).toBe('Alert Investigation: High CPU Usage');
    });

    it('should try prefixed tool name first, then unprefixed', async () => {
      setSearchParams({ type: 'investigation', alertId: 'test-alert-123' });

      // First call (prefixed) fails, second call (unprefixed) succeeds
      (backendMCPClient.callTool as jest.Mock)
        .mockResolvedValueOnce({ content: [], isError: true })
        .mockResolvedValueOnce({
          content: [{ type: 'text', text: JSON.stringify(mockAlertData) }],
          isError: false,
        });

      const { result } = renderHook(() => useAlertInvestigation());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(backendMCPClient.callTool).toHaveBeenCalledTimes(2);
      expect(backendMCPClient.callTool).toHaveBeenNthCalledWith(1, {
        name: 'mcp-grafana_get_alert_rule_by_uid',
        arguments: { uid: 'test-alert-123' },
      });
      expect(backendMCPClient.callTool).toHaveBeenNthCalledWith(2, {
        name: 'get_alert_rule_by_uid',
        arguments: { uid: 'test-alert-123' },
      });
      expect(result.current.error).toBeNull();
      expect(result.current.alertDetails).toBeDefined();
    });

    it('should handle alert not found error', async () => {
      setSearchParams({ type: 'investigation', alertId: 'nonexistent-alert' });

      (backendMCPClient.callTool as jest.Mock).mockResolvedValue({
        content: [{ type: 'text', text: 'Alert not found' }],
        isError: true,
      });

      const { result } = renderHook(() => useAlertInvestigation());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.error).toContain('nonexistent-alert');
      expect(result.current.error).toContain('not found');
      expect(result.current.alertDetails).toBeNull();
      expect(result.current.initialMessage).toBeNull();
    });

    it('should handle permission denied error', async () => {
      setSearchParams({ type: 'investigation', alertId: 'restricted-alert' });

      (backendMCPClient.callTool as jest.Mock).mockResolvedValue({
        content: [{ type: 'text', text: 'Permission denied' }],
        isError: true,
      });

      const { result } = renderHook(() => useAlertInvestigation());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.error).toContain('permission');
      expect(result.current.alertDetails).toBeNull();
    });

    it('should validate alertId format', async () => {
      // Invalid alertId with special characters
      setSearchParams({ type: 'investigation', alertId: 'invalid<script>alert</script>' });

      const { result } = renderHook(() => useAlertInvestigation());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.error).toBe('Invalid alert ID format');
      expect(backendMCPClient.callTool).not.toHaveBeenCalled();
    });

    it('should handle malformed API response', async () => {
      setSearchParams({ type: 'investigation', alertId: 'test-alert-123' });

      (backendMCPClient.callTool as jest.Mock).mockResolvedValue({
        content: [{ type: 'text', text: 'not valid json' }],
        isError: false,
      });

      const { result } = renderHook(() => useAlertInvestigation());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.error).toContain('Failed to parse alert details');
    });

    it('should include alert labels and annotations in prompt', async () => {
      setSearchParams({ type: 'investigation', alertId: 'test-alert-123' });

      (backendMCPClient.callTool as jest.Mock).mockResolvedValue({
        content: [{ type: 'text', text: JSON.stringify(mockAlertData) }],
        isError: false,
      });

      const { result } = renderHook(() => useAlertInvestigation());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.initialMessage).toContain('severity: critical');
      expect(result.current.initialMessage).toContain('service: api');
      expect(result.current.initialMessage).toContain('CPU usage is above 80%');
    });
  });
});
