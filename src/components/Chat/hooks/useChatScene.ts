import { useState, useEffect, useRef } from 'react';
import { EmbeddedScene, SplitLayout } from '@grafana/scenes';
import { ChatInterfaceScene, ChatInterfaceState } from '../scenes/ChatInterfaceScene';
import { GrafanaPageScene, GrafanaPageState } from '../scenes/GrafanaPageScene';

/**
 * Hook to manage the chat scene lifecycle
 * Creates a SplitLayout scene with chat interface and Grafana page embedding
 *
 * @param showSidePanel - Whether to show the side panel with embedded pages
 * @param chatState - State for the chat interface
 * @param sidePanelState - State for the Grafana page panel
 * @param sidePanelPosition - Position of the side panel: 'left' or 'right' (default: 'right')
 * @returns EmbeddedScene instance or null
 */
export function useChatScene(
  showSidePanel: boolean,
  chatState: ChatInterfaceState,
  sidePanelState: GrafanaPageState,
  sidePanelPosition: 'left' | 'right' = 'right'
): EmbeddedScene | null {
  const [scene, setScene] = useState<EmbeddedScene | null>(null);
  const sceneRef = useRef<EmbeddedScene | null>(null);
  const deactivateRef = useRef<(() => void) | null>(null);

  // Create or destroy scene based on showSidePanel
  useEffect(() => {
    if (!showSidePanel) {
      // Clean up scene when not needed
      if (deactivateRef.current) {
        try {
          deactivateRef.current();
        } catch (error) {
          console.warn('[useChatScene] Error during deactivation:', error);
        }
        deactivateRef.current = null;
      }
      sceneRef.current = null;
      setScene(null);
      return;
    }

    // Create scene if it doesn't exist
    if (!sceneRef.current) {
      try {
        const chatInterface = new ChatInterfaceScene(chatState);
        const grafanaPage = new GrafanaPageScene(sidePanelState);

        // Swap primary/secondary based on side panel position
        // When panel is on right (default): chat is primary (left), panel is secondary (right)
        // When panel is on left: panel is primary (left), chat is secondary (right)
        const primary = sidePanelPosition === 'right' ? chatInterface : grafanaPage;
        const secondary = sidePanelPosition === 'right' ? grafanaPage : chatInterface;
        // Maintain 60/40 split with chat always getting 60%
        // When chat is primary (panel right): initialSize 0.6 gives 60% to chat
        // When panel is primary (panel left): initialSize 0.4 gives 40% to panel, 60% to chat
        const initialSize = sidePanelPosition === 'right' ? 0.6 : 0.4;

        const splitLayout = new SplitLayout({
          direction: 'row',
          primary,
          secondary,
          initialSize,
        });

        const embeddedScene = new EmbeddedScene({
          body: splitLayout,
        });

        // activate() returns a deactivation handler
        deactivateRef.current = embeddedScene.activate();
        sceneRef.current = embeddedScene;
        setScene(embeddedScene);
      } catch (error) {
        console.error('[useChatScene] Error creating scene:', error);
        // Clean up partial state
        if (deactivateRef.current) {
          try {
            deactivateRef.current();
          } catch (cleanupError) {
            console.warn('[useChatScene] Error during cleanup after failed creation:', cleanupError);
          }
        }
        deactivateRef.current = null;
        sceneRef.current = null;
        setScene(null);
      }
    }

    return () => {
      // Cleanup on unmount
      if (deactivateRef.current) {
        try {
          deactivateRef.current();
        } catch (error) {
          console.warn('[useChatScene] Error during unmount deactivation:', error);
        }
        deactivateRef.current = null;
      }
      sceneRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showSidePanel, sidePanelPosition]);

  // Update scene state when props change (without recreating the scene)
  useEffect(() => {
    if (sceneRef.current && showSidePanel) {
      try {
        const layout = sceneRef.current.state.body;
        if (layout instanceof SplitLayout) {
          const chatInterface = layout.state.primary;
          const grafanaPage = layout.state.secondary;

          if (chatInterface instanceof ChatInterfaceScene) {
            chatInterface.setState(chatState);
          }

          if (grafanaPage instanceof GrafanaPageScene) {
            grafanaPage.setState(sidePanelState);
          }
        }
      } catch (error) {
        console.error('[useChatScene] Error updating scene state:', error);
      }
    }
  }, [showSidePanel, chatState, sidePanelState]);

  return scene;
}
