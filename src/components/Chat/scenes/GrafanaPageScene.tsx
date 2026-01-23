import React from 'react';
import { SceneObjectBase, SceneObjectState, SceneComponentProps } from '@grafana/scenes';
import { GrafanaPageRef } from '../types';
import { SidePanel } from '../components/SidePanel/SidePanel';

/**
 * State interface for GrafanaPageScene
 * Handles embedding of Grafana pages (dashboards + explore) in a scene
 */
export interface GrafanaPageState extends SceneObjectState {
  // Page references to embed (supports both dashboard and explore)
  pageRefs: Array<GrafanaPageRef & { messageIndex: number }>;

  // Currently active tab index
  activeTabIndex: number;

  // Callbacks
  onRemoveTab?: (index: number) => void;
  onClose?: () => void;
}

/**
 * Custom scene object for embedding Grafana pages
 * Supports both dashboard (/d/{uid}) and explore (/explore) pages
 */
export class GrafanaPageScene extends SceneObjectBase<GrafanaPageState> {
  public static Component = GrafanaPageRenderer;

  constructor(state: Omit<GrafanaPageState, 'activeTabIndex'> & { activeTabIndex?: number }) {
    super({
      activeTabIndex: 0,
      ...state,
    });
  }

  /**
   * Set the active tab index
   */
  public setActiveTab = (index: number) => {
    this.setState({ activeTabIndex: index });
  };

  /**
   * Remove a tab by calling the callback
   */
  public removeTab = (index: number) => {
    this.state.onRemoveTab?.(index);
  };

  /**
   * Close the panel by calling the callback
   */
  public close = () => {
    this.state.onClose?.();
  };
}

/**
 * React renderer for GrafanaPageScene
 * Reuses SidePanel component in embedded mode
 */
function GrafanaPageRenderer({ model }: SceneComponentProps<GrafanaPageScene>) {
  const state = model.useState();

  const { pageRefs, onRemoveTab } = state;

  // Reuse the SidePanel component with embedded mode
  // In embedded mode, it will render without sticky positioning
  // The outer div ensures the SidePanel gets proper height from SplitLayout
  return (
    <div style={{ height: '100%', width: '100%', display: 'flex', flexDirection: 'column' }}>
      <SidePanel
        isOpen={true}
        onClose={() => model.close()}
        pageRefs={pageRefs}
        onRemoveTab={onRemoveTab}
        embedded={true}
      />
    </div>
  );
}
