import React, { useState, useEffect } from 'react';
import {
  SceneApp,
  SceneAppPage,
  SceneAppPageLike,
  SceneRouteMatch,
  EmbeddedScene,
  SceneFlexLayout,
  SceneFlexItem,
  PanelBuilders,
  SceneQueryRunner,
  SceneTimeRange,
  SceneRefreshPicker,
  SceneTimePicker,
  SceneObject,
} from '@grafana/scenes';
import { useTheme2, Alert } from '@grafana/ui';
import { resolveVisualizationDatasource } from '../../utils/resolveVisualizationDatasource';
import { Query } from '../../utils/promqlParser';

interface TraceDrilldownAppProps {
  query: Query;
  drilldownCallback?: (filteredQuery: string) => void;
  defaultTimeRange?: { from: string; to: string };
}

export const TraceDrilldownApp: React.FC<TraceDrilldownAppProps> = ({
  query,
  drilldownCallback,
  defaultTimeRange = { from: 'now-1h', to: 'now' },
}) => {
  const theme = useTheme2();
  const [sceneApp, setSceneApp] = useState<SceneApp | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [datasourceError, setDatasourceError] = useState<string | null>(null);

  useEffect(() => {
    setIsLoading(true);
    setDatasourceError(null);

    const resolved = resolveVisualizationDatasource('tempo', query.datasourceUid);
    if (!resolved.ok) {
      setDatasourceError(resolved.error);
      setSceneApp(null);
      setIsLoading(false);
      return;
    }

    const dataSource = { uid: resolved.settings.uid, type: resolved.settings.type };

    const sceneAppInstance = createTraceDrilldownScene({
      query,
      dataSource,
      defaultTimeRange,
      drilldownCallback,
    });

    setSceneApp(sceneAppInstance);
    setIsLoading(false);
  }, [query, defaultTimeRange, drilldownCallback]);

  if (datasourceError) {
    return (
      <div className="my-4">
        <Alert title="Cannot load traces drilldown" severity="error">
          {datasourceError}
        </Alert>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div
        className="my-4 rounded-lg overflow-hidden p-4"
        style={{
          border: `1px solid ${theme.colors.border.weak}`,
          backgroundColor: theme.colors.background.primary,
        }}
      >
        <div style={{ color: theme.colors.text.secondary }}>Loading traces drilldown...</div>
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
      {sceneApp && <sceneApp.Component model={sceneApp} />}
    </div>
  );
};

function createTraceDrilldownScene({
  query,
  dataSource,
  defaultTimeRange,
  drilldownCallback,
}: {
  query: Query;
  dataSource: { uid: string; type: string };
  defaultTimeRange: { from: string; to: string };
  drilldownCallback?: (filteredQuery: string) => void;
}): SceneApp {
  const sceneApp = new SceneApp({
    pages: [
      new SceneAppPage({
        title: 'Traces Overview',
        url: '/traces/overview',
        routePath: '/traces/:traceId',
        getScene: () => getTraceOverviewScene(query, dataSource, defaultTimeRange),
        drilldowns: [
          {
            routePath: '/traces/:traceId',
            getPage: (routeMatch: SceneRouteMatch<{ traceId: string }>, parent: SceneAppPageLike) =>
              getTraceDetailPage(routeMatch, parent, query, dataSource, defaultTimeRange, drilldownCallback),
          },
        ],
      }),
    ],
  });

  return sceneApp;
}

function getTraceOverviewScene(
  query: Query,
  dataSource: { uid: string; type: string },
  defaultTimeRange: { from: string; to: string }
): EmbeddedScene {
  const timeRange = new SceneTimeRange({
    from: defaultTimeRange.from,
    to: defaultTimeRange.to,
  });

  const queryRunner = new SceneQueryRunner({
    $timeRange: timeRange,
    datasource: dataSource,
    queries: [
      {
        refId: 'A',
        query: query.query,
        queryType: 'traceql',
        instant: true,
      },
    ],
  });

  const layout = new SceneFlexLayout({
    direction: 'column',
    children: [
      new SceneFlexItem({
        minHeight: 200,
        body: PanelBuilders.timeseries()
          .setTitle('Trace Timeline')
          .setData(queryRunner)
          .setOption('legend', { showLegend: true, placement: 'bottom' })
          .build(),
      }),
      new SceneFlexItem({
        minHeight: 400,
        body: PanelBuilders.table()
          .setTitle('Traces')
          .setData(queryRunner)
          .setOption('showHeader', true)
          .build(),
      }),
    ],
  });

  const controls: SceneObject[] = [
    new SceneTimePicker({}),
    new SceneRefreshPicker({
      intervals: ['5s', '10s', '30s', '1m', '5m', '15m', '30m', '1h'],
      refresh: '',
    }),
  ];

  return new EmbeddedScene({
    $timeRange: timeRange,
    body: layout,
    controls: controls,
  });
}

function getTraceDetailPage(
  routeMatch: SceneRouteMatch<{ traceId: string }>,
  parent: SceneAppPageLike,
  baseQuery: Query,
  dataSource: { uid: string; type: string },
  defaultTimeRange: { from: string; to: string },
  drilldownCallback?: (filteredQuery: string) => void
): SceneAppPage {
  const traceId = routeMatch.params.traceId;

  return new SceneAppPage({
    url: `/traces/${traceId}`,
    routePath: '/traces/:traceId',
    getParentPage: () => parent,
    title: `Trace: ${traceId}`,
    getScene: () => getTraceDetailScene(traceId, baseQuery, dataSource, defaultTimeRange, drilldownCallback),
  });
}

function getTraceDetailScene(
  traceId: string,
  baseQuery: Query,
  dataSource: { uid: string; type: string },
  defaultTimeRange: { from: string; to: string },
  drilldownCallback?: (filteredQuery: string) => void
): EmbeddedScene {
  const timeRange = new SceneTimeRange({
    from: defaultTimeRange.from,
    to: defaultTimeRange.to,
  });

  const queryRunner = new SceneQueryRunner({
    $timeRange: timeRange,
    datasource: dataSource,
    queries: [
      {
        refId: 'A',
        query: `{traceID="${traceId}"}`,
        queryType: 'traceql',
      },
    ],
  });

  const layout = new SceneFlexLayout({
    direction: 'column',
    children: [
      new SceneFlexItem({
        minHeight: 500,
        body: PanelBuilders.traces()
          .setTitle(`Trace: ${traceId}`)
          .setData(queryRunner)
          .build(),
      }),
    ],
  });

  const controls: SceneObject[] = [
    new SceneTimePicker({}),
    new SceneRefreshPicker({
      intervals: ['5s', '10s', '30s', '1m', '5m', '15m', '30m', '1h'],
      refresh: '',
    }),
  ];

  return new EmbeddedScene({
    $timeRange: timeRange,
    body: layout,
    controls: controls,
  });
}
