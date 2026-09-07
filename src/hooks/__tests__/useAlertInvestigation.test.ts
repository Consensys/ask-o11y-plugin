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

describe('useAlertInvestigation skill param', () => {
  it('returns a validated skill without entering investigation mode', () => {
    const { result } = renderHook(() => useAlertInvestigation(), {
      wrapper: createWrapper('?skill=analyzing-cloudwatch'),
    });

    expect(result.current.isInvestigationMode).toBe(false);
    expect(result.current.initialSkill).toBe('analyzing-cloudwatch');
    expect(result.current.initialMessage).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it('combines the skill param with the legacy investigation deep link', () => {
    const { result } = renderHook(() => useAlertInvestigation(), {
      wrapper: createWrapper('?type=investigation&alertName=HighErrorRate&skill=investigating-alerts'),
    });

    expect(result.current.isInvestigationMode).toBe(true);
    expect(result.current.initialMessage).toBe('alertName:HighErrorRate');
    expect(result.current.initialMessageType).toBe('investigation');
    expect(result.current.initialSkill).toBe('investigating-alerts');
  });

  it('ignores an invalid skill name', () => {
    const { result } = renderHook(() => useAlertInvestigation(), {
      wrapper: createWrapper('?skill=Not_A_Valid_Skill'),
    });

    expect(result.current.initialSkill).toBeNull();
    expect(result.current.isInvestigationMode).toBe(false);
  });

  it('ignores an over-long skill name', () => {
    const longName = 'a'.repeat(65);
    const { result } = renderHook(() => useAlertInvestigation(), {
      wrapper: createWrapper(`?skill=${longName}`),
    });

    expect(result.current.initialSkill).toBeNull();
  });

  it('stays inactive for a skill param that is a valid pattern but unknown name', () => {
    // Name-existence is validated by the backend against the registry.
    const { result } = renderHook(() => useAlertInvestigation(), {
      wrapper: createWrapper('?skill=some-unknown-skill'),
    });

    expect(result.current.initialSkill).toBe('some-unknown-skill');
    expect(result.current.error).toBeNull();
  });
});
