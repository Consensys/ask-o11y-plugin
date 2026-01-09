import React, { useState, useEffect, useCallback } from 'react';
import {
  SceneFlexLayout,
  SceneFlexItem,
  PanelBuilders,
  SceneQueryRunner,
  SceneTimeRange,
  EmbeddedScene,
  SceneRefreshPicker,
  SceneTimePicker,
} from '@grafana/scenes';
import { useTheme2, IconButton, Tooltip, RadioButtonGroup } from '@grafana/ui';
import { getDataSourceSrv } from '@grafana/runtime';
import { VizOrientation, VisibilityMode, AxisPlacement } from '@grafana/schema';
import {
  PieChartType,
  PieChartLabels,
} from '@grafana/schema/dist/esm/raw/composable/piechart/panelcfg/x/PieChartPanelCfg_types.gen';
import { HeatmapColorMode } from '@grafana/schema/dist/esm/raw/composable/heatmap/panelcfg/x/HeatmapPanelCfg_types.gen';
import { PromQLQuery } from '../../utils/promqlParser';
import { ErrorBoundary } from '../../../ErrorBoundary';
import { LoadingOverlay } from '../../../LoadingOverlay';

interface GraphRendererProps {
  query: PromQLQuery;
  height?: number;
  showControls?: boolean;
  defaultTimeRange?: { from: string; to: string };
  refreshInterval?: string;
  visualizationType?: 'timeseries' | 'stat' | 'gauge' | 'table' | 'piechart' | 'barchart' | 'heatmap' | 'histogram';
}

const GraphRendererComponent: React.FC<GraphRendererProps> = ({
  query,
  height = 300,
  showControls = true,
  defaultTimeRange = { from: 'now-1h', to: 'now' },
  refreshInterval = '',
  visualizationType = 'timeseries',
}) => {
  // Get Grafana theme for styling
  const theme = useTheme2();
  const [scene, setScene] = useState<EmbeddedScene | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [currentVizType, setCurrentVizType] = useState(visualizationType);
  const [isExpanded, setIsExpanded] = useState(false);

  const vizTypeOptions = [
    { label: 'Time Series', value: 'timeseries' },
    { label: 'Stats', value: 'stat' },
    { label: 'Gauge', value: 'gauge' },
    { label: 'Table', value: 'table' },
    { label: 'Pie Chart', value: 'piechart' },
    { label: 'Bar Chart', value: 'barchart' },
    { label: 'Heatmap', value: 'heatmap' },
    { label: 'Histogram', value: 'histogram' },
  ];

  const handleVizTypeChange = useCallback((value: string) => {
    setCurrentVizType(value as typeof visualizationType);
  }, []);

  useEffect(() => {
    console.log('[GraphRenderer] Creating scene for query:', query.query, 'viz type:', currentVizType);
    setIsLoading(true);

    // Create a time range
    const timeRange = new SceneTimeRange({
      from: defaultTimeRange.from,
      to: defaultTimeRange.to,
    });

    // Get Prometheus data source
    let dataSource: any;
    try {
      // Try to get the default Prometheus data source
      const dsService = getDataSourceSrv();
      dataSource = dsService.getInstanceSettings('Prometheus');

      if (!dataSource) {
        console.warn('[GraphRenderer] No Prometheus data source found, using default');
        dataSource = { uid: 'prometheus', type: 'prometheus' };
      }
    } catch (error) {
      console.warn('[GraphRenderer] Error getting data source:', error);
      dataSource = { uid: 'prometheus', type: 'prometheus' };
    }

    // Create query runner with the PromQL query
    // Note: Don't pass $timeRange here - it will inherit from the EmbeddedScene
    const queryRunner = new SceneQueryRunner({
      datasource: dataSource,
      queries: [
        {
          refId: 'A',
          expr: query.query,
          format: 'time_series',
          instant: false,
        },
      ],
    });

    // Create the panel based on visualization type
    let panel;
    switch (currentVizType) {
      case 'stat':
        panel = PanelBuilders.stat()
          .setTitle(query.title || 'Stats')
          .setData(queryRunner)
          .setOption('reduceOptions', {
            values: false,
            fields: '',
            calcs: ['lastNotNull'],
          })
          .build();
        break;
      case 'gauge':
        panel = PanelBuilders.gauge()
          .setTitle(query.title || 'Gauge')
          .setData(queryRunner)
          .setOption('showThresholdLabels', true)
          .setOption('showThresholdMarkers', true)
          .build();
        break;
      case 'table':
        panel = PanelBuilders.table()
          .setTitle(query.title || 'Table')
          .setData(queryRunner)
          .setOption('showHeader', true)
          .build();
        break;
      case 'piechart':
        panel = PanelBuilders.piechart()
          .setTitle(query.title || 'Pie Chart')
          .setData(queryRunner)
          .setOption('legend', { showLegend: true, placement: 'right' })
          .setOption('pieType', PieChartType.Pie)
          .setOption('displayLabels', [PieChartLabels.Name, PieChartLabels.Percent])
          .build();
        break;
      case 'barchart':
        panel = PanelBuilders.barchart()
          .setTitle(query.title || 'Bar Chart')
          .setData(queryRunner)
          .setOption('legend', { showLegend: true, placement: 'bottom' })
          .setOption('orientation', VizOrientation.Auto)
          .setOption('showValue', VisibilityMode.Auto)
          .build();
        break;
      case 'heatmap':
        panel = PanelBuilders.heatmap()
          .setTitle(query.title || 'Heatmap')
          .setData(queryRunner)
          .setOption('calculate', false)
          .setOption('cellGap', 1)
          .setOption('color', {
            mode: HeatmapColorMode.Scheme,
            scheme: 'Spectral',
            steps: 64,
          })
          .setOption('yAxis', { axisPlacement: AxisPlacement.Left })
          .build();
        break;
      case 'histogram':
        panel = PanelBuilders.histogram()
          .setTitle(query.title || 'Histogram')
          .setData(queryRunner)
          .setOption('legend', { showLegend: true, placement: 'bottom' })
          .setOption('bucketCount', 30)
          .build();
        break;
      default:
        panel = PanelBuilders.timeseries()
          .setTitle(query.title || 'Time Series')
          .setData(queryRunner)
          .setOption('legend', { showLegend: true, placement: 'bottom' })
          .build();
    }

    // Create the scene layout
    const layout = new SceneFlexLayout({
      direction: 'column',
      children: [
        new SceneFlexItem({
          body: panel,
          minHeight: isExpanded ? height * 2 : height,
        }),
      ],
    });

    // Create scene controls if enabled
    const controls = showControls
      ? [
          new SceneTimePicker({}),
          new SceneRefreshPicker({
            intervals: ['5s', '10s', '30s', '1m', '5m', '15m', '30m', '1h'],
            refresh: refreshInterval,
          }),
        ]
      : [];

    // Create the embedded scene
    const embeddedScene = new EmbeddedScene({
      $timeRange: timeRange,
      body: layout,
      controls,
    });

    console.log('[GraphRenderer] Scene created successfully');

    // Track if this effect instance is still valid (survives React Strict Mode)
    let isCancelled = false;

    // Delay activation to survive React Strict Mode's unmount/remount cycle
    const activationTimeout = setTimeout(() => {
      if (!isCancelled) {
        console.log('[GraphRenderer] Activating scene...');
        embeddedScene.activate();
        setScene(embeddedScene);
        setIsLoading(false);
      }
    }, 0);

    // Cleanup function
    return () => {
      console.log('[GraphRenderer] Cleanup running');
      isCancelled = true;
      clearTimeout(activationTimeout);
    };
  }, [
    query.query,
    query.title,
    height,
    currentVizType,
    showControls,
    refreshInterval,
    isExpanded,
    defaultTimeRange.from,
    defaultTimeRange.to,
  ]);

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
        <LoadingOverlay isLoading={true} message="Loading graph..." />
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
      {/* Header with title and controls */}
      <div
        className="px-4 py-2 flex items-center justify-between"
        style={{
          backgroundColor: theme.colors.background.secondary,
          borderBottom: `1px solid ${theme.colors.border.weak}`,
        }}
      >
        <h4 className="text-sm font-medium" style={{ color: theme.colors.text.primary }}>
          {query.title || 'Query Result'}
        </h4>
        <div className="flex items-center gap-2">
          {/* Visualization type selector */}
          <RadioButtonGroup size="sm" value={currentVizType} options={vizTypeOptions} onChange={handleVizTypeChange} />

          {/* Expand/Collapse button */}
          <Tooltip content={isExpanded ? 'Collapse' : 'Expand'}>
            <IconButton
              name={isExpanded ? 'angle-up' : 'angle-down'}
              size="sm"
              onClick={() => setIsExpanded(!isExpanded)}
              aria-label={isExpanded ? 'Collapse graph' : 'Expand graph'}
            />
          </Tooltip>
        </div>
      </div>

      {/* Graph area with loading overlay */}
      <div
        className="p-4 relative"
        style={{
          backgroundColor: theme.colors.background.primary,
          minHeight: isExpanded ? height * 2 : height,
        }}
      >
        <LoadingOverlay isLoading={isLoading} message="Rendering visualization..." variant="overlay">
          <scene.Component model={scene} />
        </LoadingOverlay>
      </div>

      {/* Footer with query */}
      <div
        className="px-4 py-2 flex items-center justify-between"
        style={{
          backgroundColor: theme.colors.background.secondary,
          borderTop: `1px solid ${theme.colors.border.weak}`,
        }}
      >
        <code className="text-xs flex-1" style={{ color: theme.colors.text.secondary }}>
          {query.query}
        </code>
        <Tooltip content="Copy query">
          <IconButton
            name="copy"
            size="sm"
            onClick={() => {
              navigator.clipboard.writeText(query.query);
            }}
            aria-label="Copy query to clipboard"
          />
        </Tooltip>
      </div>
    </div>
  );
};

// Export the GraphRenderer wrapped with error boundary
export const GraphRenderer: React.FC<GraphRendererProps> = (props) => {
  return (
    <ErrorBoundary fallbackTitle="Graph Rendering Error">
      <GraphRendererComponent {...props} />
    </ErrorBoundary>
  );
};
