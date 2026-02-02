import React from 'react';
import { SceneObjectBase, SceneObjectState, SceneComponentProps } from '@grafana/scenes';
import { GrafanaPageProps } from '../types';
import { SidePanel } from '../components/SidePanel/SidePanel';

/** Scene state extends the props with activeTabIndex for internal state */
export interface GrafanaPageState extends SceneObjectState, GrafanaPageProps {
  activeTabIndex: number;
}

function useGrafanaPage(model: GrafanaPageScene): GrafanaPageProps {
  const state = model.useState();
  return {
    pageRefs: state.pageRefs,
    kioskModeEnabled: state.kioskModeEnabled,
    isVisible: state.isVisible,
    onRemoveTab: state.onRemoveTab,
    onClose: state.onClose,
  };
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
  const props = useGrafanaPage(model);

  const { pageRefs, onRemoveTab, kioskModeEnabled, isVisible = true } = props;

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
