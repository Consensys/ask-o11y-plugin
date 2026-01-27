import { useMemo } from 'react';
import { GrafanaPageProps } from '../scenes/GrafanaPageScene';
import { GrafanaPageRef } from '../types';

export interface UseGrafanaPageParams {
  visiblePageRefs: Array<GrafanaPageRef & { messageIndex: number }>;
  kioskModeEnabled?: boolean;
  handleRemoveTab: (index: number) => void;
  onClose: () => void;
}

/**
 * Custom hook that builds GrafanaPageProps for the GrafanaPageScene.
 * Encapsulates the logic for constructing side panel configuration.
 */
export function useGrafanaPage(params: UseGrafanaPageParams): GrafanaPageProps {
  return useMemo(
    () => ({
      pageRefs: params.visiblePageRefs,
      activeTabIndex: 0,
      kioskModeEnabled: params.kioskModeEnabled,
      onRemoveTab: params.handleRemoveTab,
      onClose: params.onClose,
    }),
    [params.visiblePageRefs, params.handleRemoveTab, params.kioskModeEnabled, params.onClose]
  );
}
