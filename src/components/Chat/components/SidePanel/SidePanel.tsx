import React, { useState, useEffect } from 'react';
import { Icon, useTheme2 } from '@grafana/ui';
import { GrafanaPageRef } from '../../types';
import { TabCloseButton } from './TabCloseButton';
import { useEmbeddingAllowed } from '../../hooks/useEmbeddingAllowed';
import { getTabLabel, toRelativeUrl } from '../../utils/urlUtils';

export interface SidePanelProps {
  isOpen: boolean;
  onClose: () => void;
  pageRefs: Array<GrafanaPageRef & { messageIndex: number }>;
  onRemoveTab?: (index: number) => void;
  embedded?: boolean;
  kioskModeEnabled?: boolean;
}

export const SidePanel: React.FC<SidePanelProps> = ({ isOpen, onClose, pageRefs, onRemoveTab, embedded = false, kioskModeEnabled = true }) => {
  const theme = useTheme2();
  const [activeIndex, setActiveIndex] = useState(0);
  const allowEmbedding = useEmbeddingAllowed();

  const safeActiveIndex = Math.min(activeIndex, Math.max(0, pageRefs.length - 1));

  useEffect(() => {
    if (activeIndex !== safeActiveIndex) {
      setActiveIndex(safeActiveIndex);
    }
  }, [activeIndex, safeActiveIndex]);

  if (!embedded && (!isOpen || pageRefs.length === 0 || allowEmbedding === null || !allowEmbedding)) {
    return null;
  }

  if (!isOpen || pageRefs.length === 0) {
    return null;
  }

  const activeRef = pageRefs[safeActiveIndex];
  const showTabs = pageRefs.length > 1;
  const iframeSrc = toRelativeUrl(activeRef.url, kioskModeEnabled);

  const containerClassName = embedded
    ? 'flex flex-col h-full border-l transition-all duration-300 ease-in-out'
    : 'flex flex-col h-screen sticky top-0 border-r transition-all duration-300 ease-in-out';

  const containerStyle = embedded
    ? {
        backgroundColor: theme.colors.background.primary,
        borderColor: theme.colors.border.weak,
      }
    : {
        width: '800px',
        minWidth: '400px',
        maxWidth: '65%',
        backgroundColor: theme.colors.background.primary,
        borderColor: theme.colors.border.weak,
      };

  return (
    <div
      className={containerClassName}
      style={containerStyle}
      role="complementary"
      aria-label="Grafana page preview"
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-3 border-b flex-shrink-0"
        style={{
          borderColor: theme.colors.border.weak,
          backgroundColor: theme.colors.background.secondary,
        }}
      >
        <div className="flex items-center gap-2 text-secondary">
          <Icon name="columns" size="md" />
          <span className="text-sm font-medium text-primary">
            {activeRef.title || (activeRef.type === 'explore' ? 'Explore' : 'Dashboard')}
          </span>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 rounded-md hover:bg-white/10 transition-colors text-secondary"
          aria-label="Close panel"
          title="Close panel"
        >
          <Icon name="times" size="md" />
        </button>
      </div>

      {/* Tab bar */}
      {showTabs && (
        <div
          className="flex gap-1 px-2 py-2 border-b flex-shrink-0"
          style={{
            borderColor: theme.colors.border.weak,
            backgroundColor: theme.colors.background.secondary,
          }}
          role="tablist"
        >
          {pageRefs.map((ref, idx) => (
            <div
              key={`${ref.url}-${idx}`}
              className="flex items-center gap-1 flex-1 min-w-0 rounded-md transition-colors"
              style={{
                backgroundColor:
                  idx === safeActiveIndex
                    ? theme.colors.primary.main
                    : theme.isDark
                    ? 'rgba(255,255,255,0.05)'
                    : 'rgba(0,0,0,0.05)',
              }}
              role="tab"
              aria-selected={idx === safeActiveIndex}
            >
              <button
                onClick={() => setActiveIndex(idx)}
                className="flex-1 min-w-0 px-3 py-1.5 text-xs truncate text-left"
                style={{
                  color: idx === safeActiveIndex ? theme.colors.primary.contrastText : theme.colors.text.secondary,
                }}
                title={ref.url}
              >
                {getTabLabel(ref, idx)}
              </button>
              {onRemoveTab && (
                <TabCloseButton
                  onClick={() => onRemoveTab(idx)}
                  color={idx === safeActiveIndex ? theme.colors.primary.contrastText : theme.colors.text.secondary}
                />
              )}
            </div>
          ))}
        </div>
      )}

      {/* Iframe content */}
      <div className="flex-1 min-h-0">
        <iframe
          src={iframeSrc}
          title={activeRef.title || `Grafana ${activeRef.type}`}
          className="w-full h-full border-0"
          style={{ backgroundColor: theme.colors.background.canvas }}
        />
      </div>
    </div>
  );
};
