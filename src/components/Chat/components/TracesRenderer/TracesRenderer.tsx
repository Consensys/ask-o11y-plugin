import React, { useState, useEffect } from 'react';
import {
  SceneFlexLayout,
  SceneFlexItem,
  PanelBuilders,
  SceneQueryRunner,
  SceneTimeRange,
  EmbeddedScene,
} from '@grafana/scenes';
import { useTheme2, Alert } from '@grafana/ui';
import { Query } from '../../utils/promqlParser';
import { resolveQueryDatasource } from '../../utils/resolveQueryDatasource';

interface TracesRendererProps {
  query: Query;
  height?: number;
  defaultTimeRange?: { from: string; to: string };
}

export const TracesRenderer: React.FC<TracesRendererProps> = ({
  query,
  height = 400,
  defaultTimeRange = { from: 'now-1h', to: 'now' },
}) => {
  // Get Grafana theme for styling
  const theme = useTheme2();
  const [scene, setScene] = useState<EmbeddedScene | null>(null);
  const [datasourceError, setDatasourceError] = useState<string | null>(null);

  useEffect(() => {
    setDatasourceError(null);

    const dsResult = resolveQueryDatasource('tempo');
    if (!dsResult.ok) {
      setDatasourceError(dsResult.reason);
      setScene(null);
      return;
    }

    const dataSource = dsResult.settings;

    // Create a time range
    const timeRange = new SceneTimeRange({
      from: defaultTimeRange.from,
      to: defaultTimeRange.to,
    });

    // Create a query runner with Tempo data source
    // Note: Don't pass $timeRange here - it will inherit from the EmbeddedScene
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

    // Create a traces panel
    const panel = PanelBuilders.traces()
      .setTitle(query.title || 'Traces')
      .setData(queryRunner)
      .build();

    // Create a layout with the panel
    const layout = new SceneFlexLayout({
      direction: 'column',
      children: [
        new SceneFlexItem({
          minHeight: height,
          body: panel,
        }),
      ],
    });

    // Create the embedded scene
    const embeddedScene = new EmbeddedScene({
      $timeRange: timeRange,
      body: layout,
      controls: [],
    });


    // Track if this effect instance is still valid (survives React Strict Mode)
    let isCancelled = false;

    // Delay activation to survive React Strict Mode's unmount/remount cycle
    const activationTimeout = setTimeout(() => {
      if (!isCancelled) {
        embeddedScene.activate();
        setScene(embeddedScene);
      }
    }, 0);

    // Cleanup function
    return () => {
      isCancelled = true;
      clearTimeout(activationTimeout);
    };
  }, [query.query, query.title, height, defaultTimeRange.from, defaultTimeRange.to]);

  if (datasourceError) {
    return (
      <div
        className="my-4 rounded-lg overflow-hidden p-4"
        style={{
          border: `1px solid ${theme.colors.border.weak}`,
          backgroundColor: theme.colors.background.primary,
        }}
      >
        <Alert severity="warning" title="Cannot run TraceQL query">
          {datasourceError}
        </Alert>
      </div>
    );
  }

  // Show loading state while scene is being created
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
      {query.title && (
        <div
          className="px-4 py-2"
          style={{
            backgroundColor: theme.colors.background.secondary,
            borderBottom: `1px solid ${theme.colors.border.weak}`,
          }}
        >
          <h4 className="text-sm font-medium" style={{ color: theme.colors.text.primary }}>
            {query.title}
          </h4>
        </div>
      )}
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
        className="px-4 py-2"
        style={{
          backgroundColor: theme.colors.background.secondary,
          borderTop: `1px solid ${theme.colors.border.weak}`,
        }}
      >
        <code className="text-xs" style={{ color: theme.colors.text.secondary }}>
          {query.query}
        </code>
      </div>
    </div>
  );
};
