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
 * @param chatPanelPosition - Position of the chat panel: 'left' or 'right' (default: 'right')
 * @returns EmbeddedScene instance or null
 */
export function useChatScene(
  showSidePanel: boolean,
  chatState: ChatInterfaceState,
  sidePanelState: GrafanaPageState,
  chatPanelPosition: 'left' | 'right' = 'right'
): EmbeddedScene | null {
  const [scene, setScene] = useState<EmbeddedScene | null>(null);
  const sceneRef = useRef<EmbeddedScene | null>(null);
  const deactivateRef = useRef<(() => void) | null>(null);

  // Create scene once on mount (always, not conditional)
  useEffect(() => {
    if (!sceneRef.current) {
      try {
        const chatInterface = new ChatInterfaceScene(chatState);
        const grafanaPage = new GrafanaPageScene({
          ...sidePanelState,
          isVisible: showSidePanel, // Initially hidden if side panel closed
        });

        // Swap primary/secondary based on chat panel position
        // When chat is on right: panel is primary (left), chat is secondary (right)
        // When chat is on left: chat is primary (left), panel is secondary (right)
        const primary = chatPanelPosition === 'right' ? grafanaPage : chatInterface;
        const secondary = chatPanelPosition === 'right' ? chatInterface : grafanaPage;
        // Maintain 60/40 split with chat always getting 60%
        // When chat is on right: initialSize 0.4 gives 40% to panel (left), 60% to chat (right)
        // When chat is on left: initialSize 0.6 gives 60% to chat (left), 40% to panel (right)
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

        // activate() returns a deactivation handler
        deactivateRef.current = embeddedScene.activate();
        sceneRef.current = embeddedScene;
        setScene(embeddedScene);
      } catch (error) {
        console.error('[useChatScene] Error creating scene:', error);
        // Clean up on error
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
  }, [chatPanelPosition]); // Only recreate if position changes

  // Update side panel visibility when showSidePanel changes
  useEffect(() => {
    if (sceneRef.current) {
      try {
        const layout = sceneRef.current.state.body;
        if (layout instanceof SplitLayout) {
          const primary = layout.state.primary;
          const secondary = layout.state.secondary;

          // Find and update GrafanaPageScene visibility
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

  // Update scene state when props change (without recreating the scene)
  useEffect(() => {
    if (sceneRef.current) {
      try {
        const layout = sceneRef.current.state.body;
        if (layout instanceof SplitLayout) {
          // Identify scenes by type, not by position (primary/secondary swap based on chatPanelPosition)
          const primary = layout.state.primary;
          const secondary = layout.state.secondary;

          // Find and update ChatInterfaceScene (could be in primary or secondary)
          if (primary instanceof ChatInterfaceScene) {
            primary.setState(chatState);
          } else if (secondary instanceof ChatInterfaceScene) {
            secondary.setState(chatState);
          }

          // Find and update GrafanaPageScene (could be in primary or secondary)
          // Preserve isVisible flag which is managed by the visibility effect above
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
