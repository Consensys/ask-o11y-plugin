import { useState, useCallback, useEffect, useRef } from 'react';
import { GrafanaPageRef } from '../types';

interface UseSidePanelStateProps {
  detectedPageRefs: Array<GrafanaPageRef & { messageIndex: number }>;
  currentSessionId: string | null;
  allowEmbedding: boolean | null;
}

interface UseSidePanelStateReturn {
  isOpen: boolean;
  visiblePageRefs: Array<GrafanaPageRef & { messageIndex: number }>;
  showSidePanel: boolean;
  handleRemoveTab: (index: number) => void;
  handleClose: () => void;
}

export function useSidePanelState({
  detectedPageRefs,
  currentSessionId,
  allowEmbedding,
}: UseSidePanelStateProps): UseSidePanelStateReturn {
  const [isOpen, setIsOpen] = useState(false);
  const [removedTabUrls, setRemovedTabUrls] = useState<Set<string>>(new Set());
  const prevSourceMessageIndexRef = useRef<number | null>(null);
  const prevSessionIdRef = useRef<string | null>(null);

  const visiblePageRefs = detectedPageRefs
    .filter((ref) => !removedTabUrls.has(ref.url))
    .slice(-4);

  const handleRemoveTab = useCallback(
    (index: number) => {
      const tabToRemove = visiblePageRefs[index];
      if (tabToRemove) {
        setRemovedTabUrls((prev) => new Set(prev).add(tabToRemove.url));
      }
    },
    [visiblePageRefs]
  );

  const handleClose = useCallback(() => {
    setIsOpen(false);
  }, []);

  useEffect(() => {
    const currentSourceIndex = detectedPageRefs.length > 0 ? detectedPageRefs[0].messageIndex : null;
    const prevSourceIndex = prevSourceMessageIndexRef.current;
    const prevSessionId = prevSessionIdRef.current;

    const sessionChanged = currentSessionId !== prevSessionId;
    const messageIndexChanged = currentSourceIndex !== null && currentSourceIndex !== prevSourceIndex;

    if (sessionChanged) {
      setRemovedTabUrls(new Set());
      if (currentSourceIndex !== null) {
        setIsOpen(true);
      }
    } else if (messageIndexChanged) {
      setIsOpen(true);
      setRemovedTabUrls(new Set());
    }

    prevSourceMessageIndexRef.current = currentSourceIndex;
    prevSessionIdRef.current = currentSessionId;
  }, [detectedPageRefs, currentSessionId]);

  const showSidePanel = isOpen && visiblePageRefs.length > 0 && allowEmbedding === true;

  return {
    isOpen,
    visiblePageRefs,
    showSidePanel,
    handleRemoveTab,
    handleClose,
  };
}
