import { useState, useEffect, useRef } from 'react';
import { EmbeddedScene, SplitLayout } from '@grafana/scenes';
import { ChatInterfaceScene, ChatInterfaceState } from '../scenes/ChatInterfaceScene';
import { GrafanaPageScene, GrafanaPageState } from '../scenes/GrafanaPageScene';

export function useChatScene(
  showSidePanel: boolean,
  chatState: ChatInterfaceState,
  sidePanelState: GrafanaPageState,
  chatPanelPosition: 'left' | 'right' = 'right'
): EmbeddedScene | null {
  const [scene, setScene] = useState<EmbeddedScene | null>(null);
  const sceneRef = useRef<EmbeddedScene | null>(null);
  const deactivateRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!sceneRef.current) {
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
        if (deactivateRef.current) {
          try {
            deactivateRef.current();
          } catch (cleanupError) {
          }
        }
        deactivateRef.current = null;
        sceneRef.current = null;
        setScene(null);
      }
    }

    return () => {
      if (deactivateRef.current) {
        try {
          deactivateRef.current();
        } catch (error) {
        }
        deactivateRef.current = null;
      }
      sceneRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatPanelPosition]);

  useEffect(() => {
    if (sceneRef.current) {
      try {
        const layout = sceneRef.current.state.body;
        if (layout instanceof SplitLayout) {
          const primary = layout.state.primary;
          const secondary = layout.state.secondary;

          if (primary instanceof GrafanaPageScene) {
            primary.setState({ isVisible: showSidePanel });
          } else if (secondary instanceof GrafanaPageScene) {
            secondary.setState({ isVisible: showSidePanel });
          }
        }
      } catch (error) {
        console.error('[useChatScene] Error updating visibility:', error);
      }
    }
  }, [showSidePanel]);

  useEffect(() => {
    if (sceneRef.current) {
      try {
        const layout = sceneRef.current.state.body;
        if (layout instanceof SplitLayout) {
          const primary = layout.state.primary;
          const secondary = layout.state.secondary;

          if (primary instanceof ChatInterfaceScene) {
            primary.setState(chatState);
          } else if (secondary instanceof ChatInterfaceScene) {
            secondary.setState(chatState);
          }

          if (primary instanceof GrafanaPageScene) {
            const currentIsVisible = primary.state.isVisible;
            primary.setState({ ...sidePanelState, isVisible: currentIsVisible });
          } else if (secondary instanceof GrafanaPageScene) {
            const currentIsVisible = secondary.state.isVisible;
            secondary.setState({ ...sidePanelState, isVisible: currentIsVisible });
          }
        }
      } catch (error) {
        console.error('[useChatScene] Error updating scene state:', error);
      }
    }
  }, [chatState, sidePanelState]);

  return scene;
}
