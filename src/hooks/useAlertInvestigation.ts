import { useState, useEffect } from 'react';

export interface UseAlertInvestigationResult {
  isLoading: boolean;
  error: string | null;
  initialMessage: string | null;
  sessionTitle: string | null;
  isInvestigationMode: boolean;
  alertName: string | null;
  sessionId: string | null;
}

const SESSION_ID_PATTERN = /^[a-zA-Z0-9\-_]{1,128}$/;

function validateAlertName(alertName: string): boolean {
  return alertName.length <= 256 && !/<script|javascript:|data:/i.test(alertName);
}

function validateSessionId(sessionId: string | null): boolean {
  return sessionId !== null && SESSION_ID_PATTERN.test(sessionId);
}

function generateInvestigationSessionId(): string {
  return `investigation-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

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

const INITIAL_STATE: UseAlertInvestigationResult = {
  isLoading: true,
  error: null,
  initialMessage: null,
  sessionTitle: null,
  isInvestigationMode: false,
  alertName: null,
  sessionId: null,
};

export function useAlertInvestigation(): UseAlertInvestigationResult {
  const [state, setState] = useState<UseAlertInvestigationResult>(INITIAL_STATE);

  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);
    const type = searchParams.get('type');
    const alertNameParam = searchParams.get('alertName');
    const existingSessionId = searchParams.get('sessionId');

    if (type !== 'investigation' || !alertNameParam) {
      setState({ ...INITIAL_STATE, isLoading: false });
      return;
    }

    if (!validateAlertName(alertNameParam)) {
      setState({
        ...INITIAL_STATE,
        isLoading: false,
        isInvestigationMode: true,
        error: 'Invalid alert name format',
      });
      return;
    }

    const sessionId = validateSessionId(existingSessionId)
      ? existingSessionId
      : generateInvestigationSessionId();

    setState({
      isLoading: false,
      error: null,
      initialMessage: buildInvestigationPrompt(alertNameParam),
      sessionTitle: `Alert Investigation: ${alertNameParam}`,
      isInvestigationMode: true,
      alertName: alertNameParam,
      sessionId,
    });
  }, []);

  return state;
}
