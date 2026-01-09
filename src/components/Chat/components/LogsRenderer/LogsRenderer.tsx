import React, { useState, useEffect } from 'react';
import {
  SceneFlexLayout,
  SceneFlexItem,
  PanelBuilders,
  SceneQueryRunner,
  SceneTimeRange,
  EmbeddedScene,
} from '@grafana/scenes';
import { useTheme2 } from '@grafana/ui';
import { getDataSourceSrv } from '@grafana/runtime';
import { LogsDedupStrategy, LogsSortOrder } from '@grafana/data';
import { Query } from '../../utils/promqlParser';

interface LogsRendererProps {
  query: Query;
  height?: number;
  defaultTimeRange?: { from: string; to: string };
}

export const LogsRenderer: React.FC<LogsRendererProps> = ({
  query,
  height = 400,
  defaultTimeRange = { from: 'now-1h', to: 'now' },
}) => {
  // Get Grafana theme for styling
  const theme = useTheme2();
  const [scene, setScene] = useState<EmbeddedScene | null>(null);

  useEffect(() => {
    console.log('[LogsRenderer] Creating scene for query:', query.query);

    // Create a time range
    const timeRange = new SceneTimeRange({
      from: defaultTimeRange.from,
      to: defaultTimeRange.to,
    });

    // Try to get the default Loki data source
    let dataSource: { uid?: string; type: string } = { type: 'loki' };
    try {
      const ds = getDataSourceSrv().getInstanceSettings('loki');
      if (ds) {
        dataSource = { uid: ds.uid, type: 'loki' };
        console.log('[LogsRenderer] Using Loki data source:', ds.uid);
      }
    } catch (error) {
      console.warn('[LogsRenderer] Could not get default Loki data source, using fallback');
    }

    // Create a query runner with Loki data source
    // Note: Don't pass $timeRange here - it will inherit from the EmbeddedScene
    const queryRunner = new SceneQueryRunner({
      datasource: dataSource,
      queries: [
        {
          refId: 'A',
          expr: query.query,
          queryType: 'range',
        },
      ],
    });

    // Create a logs panel
    const panel = PanelBuilders.logs()
      .setTitle(query.title || 'Logs')
      .setData(queryRunner)
      .setOption('showTime', true)
      .setOption('showLabels', true)
      .setOption('showCommonLabels', false)
      .setOption('wrapLogMessage', true)
      .setOption('prettifyLogMessage', false)
      .setOption('enableLogDetails', true)
      .setOption('dedupStrategy', LogsDedupStrategy.none)
      .setOption('sortOrder', LogsSortOrder.Descending)
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

    console.log('[LogsRenderer] Scene created successfully');

    // Track if this effect instance is still valid (survives React Strict Mode)
    let isCancelled = false;

    // Delay activation to survive React Strict Mode's unmount/remount cycle
    const activationTimeout = setTimeout(() => {
      if (!isCancelled) {
        console.log('[LogsRenderer] Activating scene...');
        embeddedScene.activate();
        setScene(embeddedScene);
      }
    }, 0);

    // Cleanup function
    return () => {
      console.log('[LogsRenderer] Cleanup running');
      isCancelled = true;
      clearTimeout(activationTimeout);
    };
  }, [query.query, query.title, height, defaultTimeRange.from, defaultTimeRange.to]);

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
        <div style={{ color: theme.colors.text.secondary }}>Loading logs...</div>
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
