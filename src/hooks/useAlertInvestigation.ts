import { useMemo } from 'react';

export interface UseAlertInvestigationResult {
  error: string | null;
  initialMessage: string | null;
  sessionTitle: string | null;
  isInvestigationMode: boolean;
}

const ALERT_NAME_MAX_LENGTH = 256;
const XSS_PATTERN = /<script|javascript:|data:/i;

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

export function useAlertInvestigation(): UseAlertInvestigationResult {
  return useMemo(() => {
    const searchParams = new URLSearchParams(window.location.search);
    const type = searchParams.get('type');
    const alertName = searchParams.get('alertName');

    if (type !== 'investigation' || !alertName) {
      return { error: null, initialMessage: null, sessionTitle: null, isInvestigationMode: false };
    }

    if (alertName.length > ALERT_NAME_MAX_LENGTH || XSS_PATTERN.test(alertName)) {
      return { error: 'Invalid alert name format', initialMessage: null, sessionTitle: null, isInvestigationMode: true };
    }

    return {
      error: null,
      initialMessage: buildInvestigationPrompt(alertName),
      sessionTitle: `Alert Investigation: ${alertName}`,
      isInvestigationMode: true,
    };
  }, []);
}
