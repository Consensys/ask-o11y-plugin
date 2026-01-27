import React from 'react';
import { SceneObjectBase, SceneObjectState, SceneComponentProps } from '@grafana/scenes';
import { GrafanaPageRef } from '../types';
import { SidePanel } from '../components/SidePanel/SidePanel';

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

export class GrafanaPageScene extends SceneObjectBase<GrafanaPageState> {
  public static Component = GrafanaPageRenderer;

  constructor(state: Omit<GrafanaPageState, 'activeTabIndex'> & { activeTabIndex?: number }) {
    super({
      activeTabIndex: 0,
      ...state,
    });
  }

  public setActiveTab = (index: number) => {
    this.setState({ activeTabIndex: index });
  };

  public removeTab = (index: number) => {
    this.state.onRemoveTab?.(index);
  };

  public close = () => {
    this.state.onClose?.();
  };
}

function GrafanaPageRenderer({ model }: SceneComponentProps<GrafanaPageScene>) {
  const { pageRefs, onRemoveTab, kioskModeEnabled, isVisible = true } = model.useState();

  if (!isVisible || pageRefs.length === 0) {
    return <div style={{ display: 'none' }} />;
  }

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
