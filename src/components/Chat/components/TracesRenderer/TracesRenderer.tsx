import React, { useState, useEffect, useCallback } from 'react';
import { getBackendSrv } from '@grafana/runtime';
import { useTheme2, Alert, IconButton, Tooltip, Spinner } from '@grafana/ui';
import { firstValueFrom } from 'rxjs';
import { resolveVisualizationDatasource } from '../../utils/resolveVisualizationDatasource';
import { Query } from '../../utils/promqlParser';
import { analyzeQuery } from '../../utils/queryAnalyzer';

interface TraceSearchResult {
  traceID: string;
  rootServiceName: string;
  rootTraceName: string;
  startTimeUnixNano: string;
  durationMs: number;
}

interface TracesRendererProps {
  query: Query;
  height?: number;
  defaultTimeRange?: { from: string; to: string };
}

function parseTimeToUnix(t: string): number {
  const nowSec = Math.floor(Date.now() / 1000);
  if (t === 'now') {
    return nowSec;
  }
  // Relative: now-1h, now-30m, etc.
  const m = t.match(/^now-(\d+)([smhdwMy])$/);
  if (m) {
    const secs: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400, w: 604800, M: 2592000, y: 31536000 };
    return nowSec - parseInt(m[1], 10) * (secs[m[2]] ?? 3600);
  }
  // Epoch milliseconds (13-digit number string)
  if (/^\d{13,}$/.test(t)) {
    return Math.floor(Number(t) / 1000);
  }
  // Epoch seconds (10-digit number string)
  if (/^\d{10}$/.test(t)) {
    return Number(t);
  }
  // ISO 8601 or any date string parseable by Date
  const parsed = Date.parse(t);
  if (!isNaN(parsed)) {
    return Math.floor(parsed / 1000);
  }
  return nowSec;
}

function formatTimestamp(nanoStr: string): string {
  const ms = Number(nanoStr) / 1e6;
  return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export const TracesRenderer: React.FC<TracesRendererProps> = ({
  query,
  defaultTimeRange = { from: 'now-1h', to: 'now' },
}) => {
  const theme = useTheme2();
  const [traces, setTraces] = useState<TraceSearchResult[] | null>(null);
  const [datasourceError, setDatasourceError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [isCopied, setIsCopied] = useState(false);
  const [datasourceUid, setDatasourceUid] = useState<string | null>(null);

  const analysis = analyzeQuery(query.query, 'traceql');

  const handleCopyQuery = useCallback(() => {
    navigator.clipboard.writeText(query.query).catch(() => {});
    setIsCopied(true);
  }, [query.query]);

  useEffect(() => {
    if (!isCopied) {
      return;
    }
    const timer = setTimeout(() => setIsCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [isCopied]);

  useEffect(() => {
    setDatasourceError(null);
    setLoading(true);
    setTraces(null);

    const resolved = resolveVisualizationDatasource('tempo', query.datasourceUid);
    if (!resolved.ok) {
      setDatasourceError(resolved.error);
      setLoading(false);
      return;
    }

    const uid = resolved.settings.uid;
    setDatasourceUid(uid);

    const start = parseTimeToUnix(defaultTimeRange.from);
    const end = parseTimeToUnix(defaultTimeRange.to);

    let cancelled = false;

    const loadTraces = async () => {
      try {
        const response = await firstValueFrom(
          getBackendSrv().fetch<{ traces?: TraceSearchResult[] }>({
            url: `/api/datasources/proxy/uid/${uid}/api/search`,
            params: { q: query.query, limit: 20, spss: 3, start, end },
          })
        );

        if (!cancelled) {
          setTraces(response.data?.traces ?? []);
          setLoading(false);
        }
      } catch {
        if (!cancelled) {
          setDatasourceError('Failed to fetch traces from Tempo');
          setLoading(false);
        }
      }
    };

    void loadTraces();

    return () => {
      cancelled = true;
    };
  }, [query.query, query.datasourceUid, defaultTimeRange.from, defaultTimeRange.to]);

  const makeExploreUrl = useCallback(
    (traceId: string) => {
      const pane = {
        datasource: datasourceUid ?? 'tempo',
        queries: [
          {
            refId: 'A',
            queryType: 'traceId',
            query: traceId,
            datasource: { type: 'tempo', uid: datasourceUid ?? 'tempo' },
          },
        ],
        range: { from: defaultTimeRange.from, to: defaultTimeRange.to },
      };
      return `/explore?schemaVersion=1&panes=${encodeURIComponent(JSON.stringify({ abc: pane }))}`;
    },
    [datasourceUid, defaultTimeRange.from, defaultTimeRange.to]
  );

  if (datasourceError) {
    return (
      <div className="my-4">
        <Alert title="Cannot load traces" severity="error">
          {datasourceError}
        </Alert>
      </div>
    );
  }

  return (
    <div
      className="my-4 rounded-lg overflow-hidden"
      style={{ border: `1px solid ${theme.colors.border.weak}` }}
    >
      {/* Header */}
      <div
        className="px-4 py-2 flex items-center justify-between"
        style={{
          backgroundColor: theme.colors.background.secondary,
          borderBottom: `1px solid ${theme.colors.border.weak}`,
        }}
      >
        <div className="flex items-center gap-2">
          {query.title && (
            <h4 className="text-sm font-medium" style={{ color: theme.colors.text.primary }}>
              {query.title}
            </h4>
          )}
          {analysis.hasAggregation && (
            <span
              className="text-xs px-2 py-1 rounded"
              style={{
                backgroundColor: theme.colors.primary.main,
                color: theme.colors.primary.contrastText,
              }}
            >
              {analysis.aggregationType.toUpperCase()} aggregation
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Tooltip content={isCopied ? 'Copied!' : 'Copy query'}>
            <IconButton
              name={isCopied ? 'check' : 'copy'}
              size="sm"
              onClick={handleCopyQuery}
              aria-label="Copy query to clipboard"
            />
          </Tooltip>
        </div>
      </div>

      {/* Body */}
      <div style={{ backgroundColor: theme.colors.background.primary }}>
        {loading && (
          <div className="flex items-center justify-center p-8 gap-2" style={{ color: theme.colors.text.secondary }}>
            <Spinner size="sm" />
            <span className="text-sm">Loading traces...</span>
          </div>
        )}

        {!loading && traces !== null && traces.length === 0 && (
          <div className="flex items-center justify-center p-8" style={{ color: theme.colors.text.secondary }}>
            <span className="text-sm">No traces found</span>
          </div>
        )}

        {!loading && traces !== null && traces.length > 0 && (
          <table className="w-full text-sm" style={{ borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${theme.colors.border.weak}` }}>
                {['Trace ID', 'Service', 'Name', 'Start time', 'Duration'].map((col) => (
                  <th
                    key={col}
                    className="px-4 py-2 text-left text-xs font-medium"
                    style={{ color: theme.colors.text.secondary }}
                  >
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {traces.map((trace) => (
                <tr
                  key={trace.traceID}
                  style={{ borderBottom: `1px solid ${theme.colors.border.weak}` }}
                >
                  <td className="px-4 py-2">
                    <a
                      href={makeExploreUrl(trace.traceID)}
                      target="_blank"
                      rel="noreferrer"
                      className="font-mono text-xs"
                      style={{ color: theme.colors.primary.text }}
                    >
                      {trace.traceID.substring(0, 16)}…
                    </a>
                  </td>
                  <td className="px-4 py-2 text-xs" style={{ color: theme.colors.text.primary }}>
                    {trace.rootServiceName}
                  </td>
                  <td className="px-4 py-2 text-xs" style={{ color: theme.colors.text.primary }}>
                    {trace.rootTraceName}
                  </td>
                  <td className="px-4 py-2 text-xs" style={{ color: theme.colors.text.secondary }}>
                    {formatTimestamp(trace.startTimeUnixNano)}
                  </td>
                  <td className="px-4 py-2 text-xs" style={{ color: theme.colors.text.secondary }}>
                    {trace.durationMs}ms
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Footer */}
      <div
        className="px-4 py-2"
        style={{
          backgroundColor: theme.colors.background.secondary,
          borderTop: `1px solid ${theme.colors.border.weak}`,
        }}
      >
        <div className="flex items-center justify-between">
          <code className="text-xs flex-1" style={{ color: theme.colors.text.secondary }}>
            {query.query}
          </code>
          <span className="text-xs ml-4" style={{ color: theme.colors.text.secondary }}>
            {analysis.hasAggregation ? `${analysis.aggregationType} aggregation` : 'Trace list'}
          </span>
        </div>
      </div>
    </div>
  );
};
