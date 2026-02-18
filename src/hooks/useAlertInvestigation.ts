import { useMemo } from 'react';

export interface UseAlertInvestigationResult {
  error: string | null;
  initialMessage: string | null;
  initialMessageType: 'investigation' | null;
  isInvestigationMode: boolean;
}

const ALERT_NAME_MAX_LENGTH = 256;
const XSS_PATTERN = /<script|javascript:|data:/i;

const INACTIVE: UseAlertInvestigationResult = {
  error: null,
  initialMessage: null,
  initialMessageType: null,
  isInvestigationMode: false,
};

export function useAlertInvestigation(): UseAlertInvestigationResult {
  return useMemo(() => {
    const searchParams = new URLSearchParams(window.location.search);
    const type = searchParams.get('type');
    const alertName = searchParams.get('alertName');

    if (type !== 'investigation' || !alertName) {
      return INACTIVE;
    }

    if (alertName.length > ALERT_NAME_MAX_LENGTH || XSS_PATTERN.test(alertName)) {
      return {
        error: 'Invalid alert name format',
        initialMessage: null,
        initialMessageType: null,
        isInvestigationMode: true,
      };
    }

    return {
      error: null,
      initialMessage: `alertName:${alertName}`,
      initialMessageType: 'investigation',
      isInvestigationMode: true,
    };
  }, []);
}
