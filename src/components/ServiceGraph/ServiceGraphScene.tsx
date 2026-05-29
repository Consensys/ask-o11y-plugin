import React, { useEffect, useMemo, useState } from 'react';
import { DataFrame, LoadingState, PanelData, getDefaultTimeRange, toDataFrame } from '@grafana/data';
import { Alert, useTheme2 } from '@grafana/ui';
import { EmbeddedScene, PanelBuilders, SceneDataNode, SceneFlexItem, SceneFlexLayout } from '@grafana/scenes';
import { LayoutAlgorithm, ZoomMode } from '@grafana/schema/dist/esm/raw/composable/nodegraph/panelcfg/x/NodeGraphPanelCfg_types.gen';
import { ErrorBoundary } from '../ErrorBoundary';
import type { AgentTopologyResponse } from '../../services/agentTopologyClient';

interface ServiceGraphSceneProps {
  topology: AgentTopologyResponse;
  height?: number;
}

function buildNodeFrame(topology: AgentTopologyResponse): DataFrame {
  const degreeByNode = new Map<string, number>();
  topology.edges.forEach((edge) => {
    degreeByNode.set(edge.source, (degreeByNode.get(edge.source) || 0) + 1);
    degreeByNode.set(edge.target, (degreeByNode.get(edge.target) || 0) + 1);
  });

  return toDataFrame({
    name: 'nodes',
    fields: [
      { name: 'id', values: topology.nodes.map((node) => node.id) },
      { name: 'title', values: topology.nodes.map((node) => node.label) },
      { name: 'subtitle', values: topology.nodes.map((node) => node.type || 'service') },
      {
        name: 'mainstat',
        values: topology.nodes.map((node) => {
          const degree = degreeByNode.get(node.id) || 0;
          return `${degree} link${degree === 1 ? '' : 's'}`;
        }),
      },
    ],
    meta: {
      preferredVisualisationType: 'nodeGraph',
    },
  });
}

function buildEdgeFrame(topology: AgentTopologyResponse): DataFrame {
  return toDataFrame({
    name: 'edges',
    fields: [
      { name: 'id', values: topology.edges.map((edge) => edge.id) },
      { name: 'source', values: topology.edges.map((edge) => edge.source) },
      { name: 'target', values: topology.edges.map((edge) => edge.target) },
      { name: 'mainstat', values: topology.edges.map((edge) => edge.label || 'depends') },
    ],
    meta: {
      preferredVisualisationType: 'nodeGraph',
    },
  });
}

function buildPanelData(topology: AgentTopologyResponse): PanelData {
  return {
    state: LoadingState.Done,
    series: [buildNodeFrame(topology), buildEdgeFrame(topology)],
    timeRange: getDefaultTimeRange(),
  };
}

function ServiceGraphSceneComponent({ topology, height = 560 }: ServiceGraphSceneProps) {
  const theme = useTheme2();
  const [scene, setScene] = useState<EmbeddedScene | null>(null);

  const panelData = useMemo(() => buildPanelData(topology), [topology]);

  useEffect(() => {
    const data = new SceneDataNode({ data: panelData });
    const panel = PanelBuilders.nodegraph()
      .setTitle('Service Graph')
      .setData(data)
      .setOption('layoutAlgorithm', LayoutAlgorithm.Force)
      .setOption('zoomMode', ZoomMode.Cooperative)
      .build();

    const embeddedScene = new EmbeddedScene({
      body: new SceneFlexLayout({
        direction: 'column',
        children: [
          new SceneFlexItem({
            body: panel,
            minHeight: height,
          }),
        ],
      }),
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
  }, [height, panelData]);

  if (!topology.enabled) {
    return (
      <Alert title="Graphiti memory is not enabled" severity="info">
        Enable Graphiti memory to build a service graph from saved topology and incident facts.
      </Alert>
    );
  }

  if (topology.nodes.length === 0) {
    return (
      <Alert title="No service graph data found" severity="info">
        Ask O11y has not found topology facts for this organization yet. Run an RCA or save service relationships to
        memory, then refresh this view.
      </Alert>
    );
  }

  return (
    <div
      data-testid="service-graph-scene"
      style={{
        minHeight: height,
        border: `1px solid ${theme.colors.border.weak}`,
        borderRadius: theme.shape.radius.default,
        overflow: 'hidden',
        background: theme.colors.background.primary,
      }}
    >
      {scene && <scene.Component model={scene} />}
    </div>
  );
}

export function ServiceGraphScene(props: ServiceGraphSceneProps) {
  return (
    <ErrorBoundary fallbackTitle="Service graph rendering error">
      <ServiceGraphSceneComponent {...props} />
    </ErrorBoundary>
  );
}
