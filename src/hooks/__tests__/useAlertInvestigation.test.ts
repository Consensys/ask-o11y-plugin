import { renderHook } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { useAlertInvestigation } from '../useAlertInvestigation';

function createWrapper(search: string) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(
      MemoryRouter,
      { initialEntries: [`/${search}`] },
      children
    );
  };
}

describe('useAlertInvestigation', () => {
  describe('when not in investigation mode', () => {
    it('should return isInvestigationMode false when type param is missing', () => {
      const { result } = renderHook(() => useAlertInvestigation(), {
        wrapper: createWrapper('?alertName=TestAlert'),
      });

      expect(result.current.isInvestigationMode).toBe(false);
      expect(result.current.initialMessage).toBeNull();
      expect(result.current.error).toBeNull();
    });

    it('should return isInvestigationMode false when alertName param is missing', () => {
      const { result } = renderHook(() => useAlertInvestigation(), {
        wrapper: createWrapper('?type=investigation'),
      });

      expect(result.current.isInvestigationMode).toBe(false);
      expect(result.current.initialMessage).toBeNull();
    });

    it('should return isInvestigationMode false when no query params', () => {
      const { result } = renderHook(() => useAlertInvestigation(), {
        wrapper: createWrapper(''),
      });

      expect(result.current.isInvestigationMode).toBe(false);
      expect(result.current.initialMessage).toBeNull();
    });
  });

  describe('when in investigation mode', () => {
    it('should return alertName for backend prompt rendering', () => {
      const { result } = renderHook(() => useAlertInvestigation(), {
        wrapper: createWrapper('?type=investigation&alertName=HighCPUUsage'),
      });

      expect(result.current.isInvestigationMode).toBe(true);
      expect(result.current.error).toBeNull();
      expect(result.current.initialMessage).toBe('alertName:HighCPUUsage');
      expect(result.current.initialMessageType).toBe('investigation');
    });

    it('should handle alert names with spaces', () => {
      const { result } = renderHook(() => useAlertInvestigation(), {
        wrapper: createWrapper('?type=investigation&alertName=High+CPU+Usage+Alert'),
      });

      expect(result.current.error).toBeNull();
      expect(result.current.initialMessage).toBe('alertName:High CPU Usage Alert');
    });

    it('should validate alertName and reject script injection', () => {
      const { result } = renderHook(() => useAlertInvestigation(), {
        wrapper: createWrapper('?type=investigation&alertName=%3Cscript%3Ealert(%22xss%22)%3C%2Fscript%3E'),
      });

      expect(result.current.error).toBe('Invalid alert name format');
      expect(result.current.initialMessage).toBeNull();
    });

    it('should validate alertName and reject javascript: protocol', () => {
      const { result } = renderHook(() => useAlertInvestigation(), {
        wrapper: createWrapper('?type=investigation&alertName=javascript:alert(1)'),
      });

      expect(result.current.error).toBe('Invalid alert name format');
    });

    it('should reject excessively long alert names', () => {
      const longName = 'A'.repeat(300);
      const { result } = renderHook(() => useAlertInvestigation(), {
        wrapper: createWrapper(`?type=investigation&alertName=${longName}`),
      });

      expect(result.current.error).toBe('Invalid alert name format');
    });

    it('should allow valid special characters in alert names', () => {
      const { result } = renderHook(() => useAlertInvestigation(), {
        wrapper: createWrapper('?type=investigation&alertName=CPU_usage-high+(prod)'),
      });

      expect(result.current.error).toBeNull();
      expect(result.current.initialMessage).toContain('CPU_usage-high (prod)');
    });
  });
});
