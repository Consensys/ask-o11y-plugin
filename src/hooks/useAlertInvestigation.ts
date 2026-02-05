import { useState, useEffect, useMemo } from 'react';

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
const ALERT_NAME_MAX_LENGTH = 256;
const XSS_PATTERN = /<script|javascript:|data:/i;

function isValidAlertName(alertName: string): boolean {
  return alertName.length <= ALERT_NAME_MAX_LENGTH && !XSS_PATTERN.test(alertName);
}

function isValidSessionId(sessionId: string | null): boolean {
  return sessionId !== null && SESSION_ID_PATTERN.test(sessionId);
}

function generateInvestigationSessionId(): string {
  const timestamp = Date.now();
  const randomSuffix = Math.random().toString(36).substring(2, 9);
  return `investigation-${timestamp}-${randomSuffix}`;
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

interface ParsedUrlParams {
  type: string | null;
  alertName: string | null;
  existingSessionId: string | null;
}

function parseUrlParams(): ParsedUrlParams {
  const searchParams = new URLSearchParams(window.location.search);
  return {
    type: searchParams.get('type'),
    alertName: searchParams.get('alertName'),
    existingSessionId: searchParams.get('sessionId'),
  };
}

export function useAlertInvestigation(): UseAlertInvestigationResult {
  const urlParams = useMemo(parseUrlParams, []);

  const [state, setState] = useState<UseAlertInvestigationResult>({
    isLoading: true,
    error: null,
    initialMessage: null,
    sessionTitle: null,
    isInvestigationMode: false,
    alertName: null,
    sessionId: null,
  });

  useEffect(() => {
    const { type, alertName, existingSessionId } = urlParams;

    if (type !== 'investigation' || !alertName) {
      setState((prev) => ({ ...prev, isLoading: false }));
      return;
    }

    if (!isValidAlertName(alertName)) {
      setState((prev) => ({
        ...prev,
        isLoading: false,
        isInvestigationMode: true,
        error: 'Invalid alert name format',
      }));
      return;
    }

    const sessionId = isValidSessionId(existingSessionId)
      ? existingSessionId
      : generateInvestigationSessionId();

    setState({
      isLoading: false,
      error: null,
      initialMessage: buildInvestigationPrompt(alertName),
      sessionTitle: `Alert Investigation: ${alertName}`,
      isInvestigationMode: true,
      alertName,
      sessionId,
    });
  }, [urlParams]);

  return state;
}
