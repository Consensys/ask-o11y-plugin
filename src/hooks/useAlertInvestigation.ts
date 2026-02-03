/**
 * useAlertInvestigation Hook
 *
 * Handles alert investigation mode initialization:
 * - Parses URL query params (type=investigation, alertId)
 * - Fetches alert details via MCP tool
 * - Builds RCA investigation prompt
 * - Creates initial session for auto-send
 */

import { useState, useEffect, useRef } from 'react';
import { backendMCPClient } from '../services/backendMCPClient';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types';

/** Alert details returned from MCP tool */
interface AlertDetails {
  uid: string;
  title: string;
  state: string;
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
  condition?: string;
  folderTitle?: string;
}

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
  /** Alert details (for display purposes) */
  alertDetails: AlertDetails | null;
}

/**
 * Validate alert ID format to prevent injection
 */
const validateAlertId = (alertId: string): boolean => {
  // Alert UIDs are typically alphanumeric with hyphens/underscores
  return /^[a-zA-Z0-9_-]{1,128}$/.test(alertId);
};

/**
 * Format key-value pairs for display in the investigation prompt
 */
const formatKeyValuePairs = (pairs?: Record<string, string>): string => {
  if (!pairs || Object.keys(pairs).length === 0) {
    return '  (none)';
  }
  return Object.entries(pairs)
    .map(([k, v]) => `  - ${k}: ${v}`)
    .join('\n');
};

/**
 * Parse alert data from MCP tool result
 */
const parseAlertResult = (result: CallToolResult): AlertDetails | null => {
  try {
    // MCP tool returns content array with text
    const content = result.content?.[0];
    if (!content || content.type !== 'text') {
      return null;
    }

    // Parse JSON from text content
    const data = JSON.parse(content.text);

    return {
      uid: data.uid || data.id || '',
      title: data.title || data.name || 'Unknown Alert',
      state: data.state || 'unknown',
      labels: data.labels || {},
      annotations: data.annotations || {},
      condition: data.condition || '',
      folderTitle: data.folderTitle || '',
    };
  } catch (error) {
    console.error('[useAlertInvestigation] Failed to parse alert result:', error);
    return null;
  }
};

/**
 * Build the RCA investigation prompt with alert context
 */
const buildInvestigationPrompt = (alert: AlertDetails): string => {
  const labelsStr = formatKeyValuePairs(alert.labels);
  const annotationsStr = formatKeyValuePairs(alert.annotations);

  return `Investigate this alert and perform a full root cause analysis.

**Alert Details:**
- **Name:** ${alert.title}
- **UID:** ${alert.uid}
- **State:** ${alert.state}
${alert.condition ? `- **Condition:** ${alert.condition}` : ''}
${alert.folderTitle ? `- **Folder:** ${alert.folderTitle}` : ''}

**Labels:**
${labelsStr}

**Annotations:**
${annotationsStr}

**Investigation Workflow:**
1. Check the current alert status and recent state changes
2. Query related metrics around the time the alert fired
3. Search for relevant error logs in the affected services
4. Check distributed traces for failed requests or high latency (if applicable)
5. Identify correlations and patterns across the data
6. Determine the root cause based on the evidence
7. Suggest remediation steps to resolve the issue

Please use the available MCP tools to gather real data and provide actionable insights.`;
};

/**
 * Hook for alert investigation mode
 *
 * Parses URL query params, fetches alert details, and prepares
 * an initial investigation prompt for auto-sending.
 *
 * @example
 * // URL: /a/consensys-asko11y-app?type=investigation&alertId=abc123
 * const { isLoading, error, initialMessage, sessionTitle, isInvestigationMode } = useAlertInvestigation();
 */
export const useAlertInvestigation = (): UseAlertInvestigationResult => {
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [initialMessage, setInitialMessage] = useState<string | null>(null);
  const [sessionTitle, setSessionTitle] = useState<string | null>(null);
  const [isInvestigationMode, setIsInvestigationMode] = useState(false);
  const [alertDetails, setAlertDetails] = useState<AlertDetails | null>(null);

  // Ref to track if component is mounted (for cleanup)
  const isMountedRef = useRef(true);

  useEffect(() => {
    // Mark as mounted
    isMountedRef.current = true;

    const initInvestigation = async () => {
      // Parse URL query params
      const searchParams = new URLSearchParams(window.location.search);
      const type = searchParams.get('type');
      const alertId = searchParams.get('alertId');

      // Check if this is an investigation request
      if (type !== 'investigation' || !alertId) {
        if (isMountedRef.current) {
          setIsLoading(false);
          setIsInvestigationMode(false);
        }
        return;
      }

      if (isMountedRef.current) {
        setIsInvestigationMode(true);
      }

      // Validate alert ID format
      if (!validateAlertId(alertId)) {
        if (isMountedRef.current) {
          setError('Invalid alert ID format');
          setIsLoading(false);
        }
        return;
      }

      try {
        // Fetch alert details via MCP tool
        // Try the prefixed tool name first (backend MCP proxy adds prefix)
        let result = await backendMCPClient.callTool({
          name: 'mcp-grafana_get_alert_rule_by_uid',
          arguments: { uid: alertId },
        });

        // If prefixed tool fails, try without prefix (built-in MCP)
        if (result.isError) {
          result = await backendMCPClient.callTool({
            name: 'get_alert_rule_by_uid',
            arguments: { uid: alertId },
          });
        }

        // Check if component unmounted during async operation
        if (!isMountedRef.current) {
          return;
        }

        // Check if tool call failed
        if (result.isError) {
          const errorText = result.content?.[0]?.type === 'text' ? result.content[0].text : 'Unknown error';
          console.error('[useAlertInvestigation] MCP tool error:', errorText);

          // Check for specific error types
          if (errorText.toLowerCase().includes('not found')) {
            setError(`Alert "${alertId}" not found. It may have been deleted or the UID is incorrect.`);
          } else if (errorText.toLowerCase().includes('permission') || errorText.toLowerCase().includes('access')) {
            setError(`You don't have permission to access alert "${alertId}".`);
          } else {
            setError(`Failed to load alert: ${errorText}`);
          }
          setIsLoading(false);
          return;
        }

        // Parse alert details
        const details = parseAlertResult(result);
        if (!details) {
          setError('Failed to parse alert details. Unexpected response format.');
          setIsLoading(false);
          return;
        }

        // Build investigation prompt
        const prompt = buildInvestigationPrompt(details);

        // Set state for Chat component
        setAlertDetails(details);
        setInitialMessage(prompt);
        setSessionTitle(`Alert Investigation: ${details.title}`);
      } catch (err) {
        if (isMountedRef.current) {
          console.error('[useAlertInvestigation] Failed to initialize investigation:', err);
          setError(err instanceof Error ? err.message : 'Failed to load alert details');
        }
      } finally {
        if (isMountedRef.current) {
          setIsLoading(false);
        }
      }
    };

    initInvestigation();

    // Cleanup: mark as unmounted to prevent state updates
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  return {
    isLoading,
    error,
    initialMessage,
    sessionTitle,
    isInvestigationMode,
    alertDetails,
  };
};

export default useAlertInvestigation;
