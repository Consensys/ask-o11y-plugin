import React, { useState, useEffect, useCallback } from 'react';
import {
  SceneFlexLayout,
  SceneFlexItem,
  PanelBuilders,
  SceneQueryRunner,
  SceneTimeRange,
  EmbeddedScene,
} from '@grafana/scenes';
import { useTheme2, Alert, IconButton, Tooltip } from '@grafana/ui';
import { resolveVisualizationDatasource } from '../../utils/resolveVisualizationDatasource';
import { Query } from '../../utils/promqlParser';
import { analyzeQuery } from '../../utils/queryAnalyzer';

interface TracesRendererProps {
  query: Query;
  height?: number;
  defaultTimeRange?: { from: string; to: string };
  drilldownCallback?: (type: 'logs' | 'traces', query: string) => void;
}

export const TracesRenderer: React.FC<TracesRendererProps> = ({
  query,
  height = 400,
  defaultTimeRange = { from: 'now-1h', to: 'now' },
  drilldownCallback,
}) => {
  const theme = useTheme2();
  const [scene, setScene] = useState<EmbeddedScene | null>(null);
  const [datasourceError, setDatasourceError] = useState<string | null>(null);
  const [isCopied, setIsCopied] = useState(false);

  const analysis = analyzeQuery(query.query);

  const handleCopyQuery = useCallback(() => {
    navigator.clipboard.writeText(query.query);
    setIsCopied(true);
  }, [query.query]);

  useEffect(() => {
    const timer = setTimeout(() => setIsCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [isCopied]);

  useEffect(() => {
    setDatasourceError(null);

    const resolved = resolveVisualizationDatasource('tempo', query.datasourceUid);
    if (!resolved.ok) {
      setDatasourceError(resolved.error);
      setScene(null);
      return;
    }

    const timeRange = new SceneTimeRange({
      from: defaultTimeRange.from,
      to: defaultTimeRange.to,
    });

    const dataSource = { uid: resolved.settings.uid, type: resolved.settings.type };

    const queryRunner = new SceneQueryRunner({
      datasource: dataSource,
      queries: [
        {
          refId: 'A',
          query: query.query,
          queryType: 'traceql',
        },
      ],
    });

    const panel = PanelBuilders.traces()
      .setTitle(query.title || 'Traces')
      .setData(queryRunner)
      .build();

    const layout = new SceneFlexLayout({
      direction: 'column',
      children: [
        new SceneFlexItem({
          minHeight: height,
          body: panel,
        }),
      ],
    });

    const embeddedScene = new EmbeddedScene({
      $timeRange: timeRange,
      body: layout,
      controls: [],
    });

    let isCancelled = false;

    const activationTimeout = setTimeout(() => {
      if (!isCancelled) {
        embeddedScene.activate();
        setScene(embeddedScene);
      }
    }, 0);

    return () => {
      isCancelled = true;
      clearTimeout(activationTimeout);
    };
  }, [query.query, query.title, query.datasourceUid, height, defaultTimeRange.from, defaultTimeRange.to]);

  if (datasourceError) {
    return (
      <div className="my-4">
        <Alert title="Cannot load traces panel" severity="error">
          {datasourceError}
        </Alert>
      </div>
    );
  }

  if (!scene) {
    return (
      <div
        className="my-4 rounded-lg overflow-hidden p-4"
        style={{
          border: `1px solid ${theme.colors.border.weak}`,
          backgroundColor: theme.colors.background.primary,
        }}
      >
        <div style={{ color: theme.colors.text.secondary }}>Loading traces...</div>
      </div>
    );
  }

  return (
    <div
      className="my-4 rounded-lg overflow-hidden"
      style={{
        border: `1px solid ${theme.colors.border.weak}`,
      }}
    >
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

      <div
        className="p-4"
        data-scene-container="traces"
        style={{
          backgroundColor: theme.colors.background.primary,
        }}
      >
        <scene.Component model={scene} />
      </div>

      <div
        className="px-4 py-2 border-t"
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
            {analysis.hasAggregation ? `${analysis.aggregationType} aggregation` : 'Trace waterfall'}
          </span>
        </div>
      </div>
    </div>
  );
};
