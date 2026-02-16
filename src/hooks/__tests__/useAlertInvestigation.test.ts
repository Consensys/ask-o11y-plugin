import { renderHook } from '@testing-library/react';
import { useAlertInvestigation } from '../useAlertInvestigation';

const setSearchParams = (params: Record<string, string>) => {
  const searchParams = new URLSearchParams(params);
  Object.defineProperty(window, 'location', {
    value: {
      search: `?${searchParams.toString()}`,
    },
    writable: true,
  });
};

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
    clearSearchParams();
  });

  describe('when not in investigation mode', () => {
    it('should return isInvestigationMode false when type param is missing', () => {
      setSearchParams({ alertName: 'TestAlert' });

      const { result } = renderHook(() => useAlertInvestigation());

      expect(result.current.isInvestigationMode).toBe(false);
      expect(result.current.initialMessage).toBeNull();
      expect(result.current.error).toBeNull();
    });

    it('should return isInvestigationMode false when alertName param is missing', () => {
      setSearchParams({ type: 'investigation' });

      const { result } = renderHook(() => useAlertInvestigation());

      expect(result.current.isInvestigationMode).toBe(false);
      expect(result.current.initialMessage).toBeNull();
    });

    it('should return isInvestigationMode false when no query params', () => {
      clearSearchParams();

      const { result } = renderHook(() => useAlertInvestigation());

      expect(result.current.isInvestigationMode).toBe(false);
    });
  });

  describe('when in investigation mode', () => {
    it('should build investigation prompt with alert name', () => {
      setSearchParams({ type: 'investigation', alertName: 'HighCPUUsage' });

      const { result } = renderHook(() => useAlertInvestigation());

      expect(result.current.isInvestigationMode).toBe(true);
      expect(result.current.error).toBeNull();
      expect(result.current.initialMessage).toContain('Investigate the alert "HighCPUUsage"');
      expect(result.current.initialMessage).toContain('list_alert_rules');
      expect(result.current.sessionTitle).toBe('Alert Investigation: HighCPUUsage');
    });

    it('should handle alert names with spaces', () => {
      setSearchParams({ type: 'investigation', alertName: 'High CPU Usage Alert' });

      const { result } = renderHook(() => useAlertInvestigation());

      expect(result.current.error).toBeNull();
      expect(result.current.initialMessage).toContain('High CPU Usage Alert');
      expect(result.current.sessionTitle).toBe('Alert Investigation: High CPU Usage Alert');
    });

    it('should include RCA workflow instructions in prompt', () => {
      setSearchParams({ type: 'investigation', alertName: 'TestAlert' });

      const { result } = renderHook(() => useAlertInvestigation());

      const prompt = result.current.initialMessage;
      expect(prompt).toContain('root cause analysis');
      expect(prompt).toContain('list_datasources');
      expect(prompt).toContain('Grafana-managed alerts');
      expect(prompt).toContain('Query related metrics');
      expect(prompt).toContain('Search for relevant error logs');
      expect(prompt).toContain('remediation steps');
    });

    it('should validate alertName and reject script injection', () => {
      setSearchParams({ type: 'investigation', alertName: '<script>alert("xss")</script>' });

      const { result } = renderHook(() => useAlertInvestigation());

      expect(result.current.error).toBe('Invalid alert name format');
      expect(result.current.initialMessage).toBeNull();
    });

    it('should validate alertName and reject javascript: protocol', () => {
      setSearchParams({ type: 'investigation', alertName: 'javascript:alert(1)' });

      const { result } = renderHook(() => useAlertInvestigation());

      expect(result.current.error).toBe('Invalid alert name format');
    });

    it('should reject excessively long alert names', () => {
      const longName = 'A'.repeat(300);
      setSearchParams({ type: 'investigation', alertName: longName });

      const { result } = renderHook(() => useAlertInvestigation());

      expect(result.current.error).toBe('Invalid alert name format');
    });

    it('should allow valid special characters in alert names', () => {
      setSearchParams({ type: 'investigation', alertName: 'CPU_usage-high (prod)' });

      const { result } = renderHook(() => useAlertInvestigation());

      expect(result.current.error).toBeNull();
      expect(result.current.initialMessage).toContain('CPU_usage-high (prod)');
    });
  });
});
