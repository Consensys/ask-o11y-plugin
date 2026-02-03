/**
 * useAlertInvestigation Hook
 *
 * Handles alert investigation mode initialization:
 * - Parses URL query params (type=investigation, alertName)
 * - Builds RCA investigation prompt with alert name
 * - Lets AI find and investigate the alert using available tools
 */

import { useState, useEffect } from 'react';

/** Return type for the hook */
export interface UseAlertInvestigationResult {
  /** Whether investigation is currently loading */
  isLoading: boolean;
  /** Error message if investigation failed to load */
  error: string | null;
  /** Initial message to send (investigation prompt) */
  initialMessage: string | null;
  /** Suggested session title */
  sessionTitle: string | null;
  /** Whether this is an investigation mode request */
  isInvestigationMode: boolean;
  /** Alert name from URL params */
  alertName: string | null;
}

/**
 * Validate alert name to prevent injection.
 * More permissive than UID validation since names can have spaces and special chars.
 */
function validateAlertName(alertName: string): boolean {
  if (alertName.length > 256) {
    return false;
  }
  if (/<script|javascript:|data:/i.test(alertName)) {
    return false;
  }
  return true;
}

/**
 * Build the RCA investigation prompt with alert name.
 * Instructs AI to find the alert using available tools.
 */
function buildInvestigationPrompt(alertName: string): string {
  return `Investigate the alert "${alertName}" and perform a full root cause analysis.

**Your first step:** Use list_alert_rules to find this alert. Check both:
1. Prometheus datasource alerts (use list_datasources first to get the datasource UID)
2. Grafana-managed alerts

Once you find the alert, proceed with:
1. Check the current alert status and recent state changes
2. Query related metrics around the time the alert fired
3. Search for relevant error logs in the affected services
4. Check distributed traces for failed requests or high latency (if applicable)
5. Identify correlations and patterns across the data
6. Determine the root cause based on the evidence
7. Suggest remediation steps to resolve the issue

Please use the available MCP tools to gather real data and provide actionable insights.`;
}

/** Internal state for the hook */
interface InvestigationState {
  isLoading: boolean;
  error: string | null;
  initialMessage: string | null;
  sessionTitle: string | null;
  isInvestigationMode: boolean;
  alertName: string | null;
}

const INITIAL_STATE: InvestigationState = {
  isLoading: true,
  error: null,
  initialMessage: null,
  sessionTitle: null,
  isInvestigationMode: false,
  alertName: null,
};

/**
 * Hook for alert investigation mode.
 *
 * Parses URL query params and prepares an initial investigation prompt
 * for auto-sending. The AI will find the alert using available tools.
 *
 * @example
 * // URL: /a/consensys-asko11y-app?type=investigation&alertName=HighCPUUsage
 * const { isLoading, error, initialMessage, sessionTitle, isInvestigationMode } = useAlertInvestigation();
 */
export function useAlertInvestigation(): UseAlertInvestigationResult {
  const [state, setState] = useState<InvestigationState>(INITIAL_STATE);

  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);
    const type = searchParams.get('type');
    const alertNameParam = searchParams.get('alertName');

    // Not an investigation request
    if (type !== 'investigation' || !alertNameParam) {
      setState({ ...INITIAL_STATE, isLoading: false });
      return;
    }

    // Invalid alert name
    if (!validateAlertName(alertNameParam)) {
      setState({
        ...INITIAL_STATE,
        isLoading: false,
        isInvestigationMode: true,
        error: 'Invalid alert name format',
      });
      return;
    }

    // Valid investigation request
    setState({
      isLoading: false,
      error: null,
      initialMessage: buildInvestigationPrompt(alertNameParam),
      sessionTitle: `Alert Investigation: ${alertNameParam}`,
      isInvestigationMode: true,
      alertName: alertNameParam,
    });
  }, []);

  return state;
}

export default useAlertInvestigation;
