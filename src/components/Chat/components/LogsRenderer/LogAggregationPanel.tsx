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
  SceneObject,
} from '@grafana/scenes';
import { useTheme2, Alert } from '@grafana/ui';
import { resolveVisualizationDatasource } from '../../utils/resolveVisualizationDatasource';
import { Query } from '../../utils/promqlParser';
import { analyzeQuery, buildAggregationQuery } from '../../utils/queryAnalyzer';

interface LogAggregationPanelProps {
  query: Query;
  drilldownCallback?: (filteredQuery: string) => void;
  defaultTimeRange?: { from: string; to: string };
  height?: number;
}

export const LogAggregationPanel: React.FC<LogAggregationPanelProps> = ({
  query,
  drilldownCallback,
  defaultTimeRange = { from: 'now-1h', to: 'now' },
  height = 300,
}) => {
  const theme = useTheme2();
  const [scene, setScene] = useState<EmbeddedScene | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [datasourceError, setDatasourceError] = useState<string | null>(null);
  const [aggregationType, setAggregationType] = useState<'sum' | 'rate' | 'count' | 'none'>('none');

  const handleDrilldown = useCallback(
     (labelName: string, labelValue: string) => {
      if (!drilldownCallback) {
        return;
       }

      const baseQuery = query.query;
      let filteredQuery = baseQuery;

      const existingMatcherMatch = baseQuery.match(/\{([^}]+)\}/);
      if (existingMatcherMatch) {
        const labelPattern = new RegExp(`${labelName}\\s*=\\s*"[^"]*"`, 'i');
        if (labelPattern.test(baseQuery)) {
          filteredQuery = baseQuery.replace(
            labelPattern,
             `${labelName}="${labelValue}"`
           );
         } else {
          const existingLabels = existingMatcherMatch[1];
          filteredQuery = baseQuery.replace(
             /\{([^}]+)\}/,
             `{${existingLabels} ${labelName}="${labelValue}"}`
           );
         }
       } else {
        filteredQuery = baseQuery.replace(
            /\|/,
           ` {${labelName}="${labelValue}"} |`
          );
       }

      drilldownCallback(filteredQuery);
     },
     [drilldownCallback, query.query]
   );

  useEffect(() => {
    setIsLoading(true);
    setDatasourceError(null);

    const resolved = resolveVisualizationDatasource('loki', query.datasourceUid);
    if (!resolved.ok) {
      setDatasourceError(resolved.error);
      setScene(null);
      setIsLoading(false);
      return;
     }

    const dataSource = { uid: resolved.settings.uid, type: resolved.settings.type };

    const analysis = analyzeQuery(query.query);
    setAggregationType(analysis.aggregationType as 'sum' | 'rate' | 'count' | 'none');

    const aggQuery = buildAggregationQuery(query.query, analysis.aggregationType);

    const timeRange = new SceneTimeRange({
      from: defaultTimeRange.from,
      to: defaultTimeRange.to,
     });

    const queryRunner = new SceneQueryRunner({
      datasource: dataSource,
      queries: [
         {
          refId: 'A',
          expr: aggQuery,
          queryType: 'range',
         },
       ],
     });

    const panel = PanelBuilders.barchart()
       .setTitle(`${analysis.aggregationType.toUpperCase()} by Labels`)
       .setData(queryRunner)
       .setOption('legend', { showLegend: true, placement: 'bottom' })
       .setOverrides((builder) =>
        builder
           .matchFieldsWithNameByRegex('.*')
           .overrideLinks([
             {
              title: 'Filter by label',
              url: '',
              onClick: (event: any) => {
                const labelName = 'label';
                const labelValue = event.row?.[0]?.[0] as string;
                if (labelValue) {
                  handleDrilldown(labelName, labelValue);
                 }
               },
             },
           ])
           .build()
       )
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

    const controls: SceneObject[] = [
      new SceneTimePicker({}),
      new SceneRefreshPicker({
        intervals: ['5s', '10s', '30s', '1m', '5m', '15m', '30m', '1h'],
        refresh: '',
       }),
     ];

    const embeddedScene = new EmbeddedScene({
       $timeRange: timeRange,
      body: layout,
      controls: controls,
     });

    let isCancelled = false;

    const activationTimeout = setTimeout(() => {
      if (!isCancelled) {
        embeddedScene.activate();
        setScene(embeddedScene);
        setIsLoading(false);
       }
     }, 0);

    return () => {
      isCancelled = true;
      clearTimeout(activationTimeout);
     };
   }, [
    query.query,
    query.datasourceUid,
    defaultTimeRange.from,
    defaultTimeRange.to,
    height,
    handleDrilldown,
   ]);

  if (datasourceError) {
    return (
       <div className="my-4">
         <Alert title="Cannot load aggregation panel" severity="error">
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
         <div style={{ color: theme.colors.text.secondary }}>Loading aggregation...</div>
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
         <h4 className="text-sm font-medium" style={{ color: theme.colors.text.primary }}>
          Aggregation Visualization
         </h4>
         <div className="flex items-center gap-2">
           <div className="text-xs" style={{ color: theme.colors.text.secondary }}>
             {aggregationType !== 'none' ? `${aggregationType.toUpperCase()} aggregation` : 'Raw query'}
           </div>
         </div>
       </div>

       <div
        className="p-4 relative"
        data-scene-container="log-aggregation"
        style={{
          backgroundColor: theme.colors.background.primary,
          minHeight: height,
         }}
       >
         {scene && <scene.Component model={scene} />}
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
