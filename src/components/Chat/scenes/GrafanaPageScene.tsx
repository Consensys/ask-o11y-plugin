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

  // Whether to enable kiosk mode for embedded pages
  kioskModeEnabled?: boolean;

  // Whether the panel is visible (used to hide when side panel is closed)
  isVisible?: boolean;

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

  const { pageRefs, onRemoveTab, kioskModeEnabled, isVisible = true } = state;

  // Don't render iframe when hidden (performance optimization)
  if (!isVisible || pageRefs.length === 0) {
    return <div style={{ display: 'none' }} />;
  }

  // Reuse the SidePanel component with embedded mode
  // Pane handles scrolling via paneStyle in SplitLayout
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%' }}>
      <SidePanel
        isOpen={true}
        onClose={() => model.close()}
        pageRefs={pageRefs}
        onRemoveTab={onRemoveTab}
        embedded={true}
        kioskModeEnabled={kioskModeEnabled}
      />
    </div>
  );
}
