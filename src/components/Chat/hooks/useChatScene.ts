import { useState, useEffect, useRef } from 'react';
import { EmbeddedScene, SplitLayout } from '@grafana/scenes';
import { ChatInterfaceScene, ChatInterfaceProps } from '../scenes/ChatInterfaceScene';
import { GrafanaPageScene, GrafanaPageProps } from '../scenes/GrafanaPageScene';

type SceneComponent = ChatInterfaceScene | GrafanaPageScene;

function findSceneComponent<T extends SceneComponent>(
  layout: SplitLayout,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type: new (...args: any[]) => T
): T | null {
  const { primary, secondary } = layout.state;
  if (primary instanceof type) {
    return primary;
  }
  if (secondary instanceof type) {
    return secondary;
  }
  return null;
}

export function useChatScene(
  showSidePanel: boolean,
  chatState: ChatInterfaceProps,
  sidePanelState: GrafanaPageProps,
  chatPanelPosition: 'left' | 'right' = 'right'
): EmbeddedScene | null {
  const [scene, setScene] = useState<EmbeddedScene | null>(null);
  const sceneRef = useRef<EmbeddedScene | null>(null);
  const deactivateRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (sceneRef.current) {
      return;
    }

    try {
      const chatInterface = new ChatInterfaceScene(chatState);
      const grafanaPage = new GrafanaPageScene({
        ...sidePanelState,
        isVisible: showSidePanel,
      });

      const primary = chatPanelPosition === 'right' ? grafanaPage : chatInterface;
      const secondary = chatPanelPosition === 'right' ? chatInterface : grafanaPage;
      const initialSize = chatPanelPosition === 'right' ? 0.4 : 0.6;

      const splitLayout = new SplitLayout({
        direction: 'row',
        primary,
        secondary,
        initialSize,
      });

      const embeddedScene = new EmbeddedScene({
        body: splitLayout,
      });

      deactivateRef.current = embeddedScene.activate();
      sceneRef.current = embeddedScene;
      setScene(embeddedScene);
    } catch (error) {
      console.error('[useChatScene] Error creating scene:', error);
      safeDeactivate();
      sceneRef.current = null;
      setScene(null);
    }

    return () => {
      safeDeactivate();
      sceneRef.current = null;
    };

    function safeDeactivate(): void {
      if (deactivateRef.current) {
        try {
          deactivateRef.current();
        } catch (err) {
          console.warn('[useChatScene] Error during deactivation:', err);
        }
        deactivateRef.current = null;
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatPanelPosition]);

  useEffect(() => {
    if (!sceneRef.current) {
      return;
    }
    try {
      const layout = sceneRef.current.state.body;
      if (layout instanceof SplitLayout) {
        const grafanaPage = findSceneComponent(layout, GrafanaPageScene);
        grafanaPage?.setState({ isVisible: showSidePanel });
      }
    } catch (error) {
      console.error('[useChatScene] Error updating visibility:', error);
    }
  }, [showSidePanel]);

  useEffect(() => {
    if (!sceneRef.current) {
      return;
    }
    try {
      const layout = sceneRef.current.state.body;
      if (layout instanceof SplitLayout) {
        const chatInterface = findSceneComponent(layout, ChatInterfaceScene);
        chatInterface?.setState(chatState);

        const grafanaPage = findSceneComponent(layout, GrafanaPageScene);
        if (grafanaPage) {
          grafanaPage.setState({ ...sidePanelState, isVisible: grafanaPage.state.isVisible });
        }
      }
    } catch (error) {
      console.error('[useChatScene] Error updating scene state:', error);
    }
  }, [chatState, sidePanelState]);

  return scene;
}
