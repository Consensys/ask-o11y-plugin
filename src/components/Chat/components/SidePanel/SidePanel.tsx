import React, { useState, useEffect } from 'react';
import { useTheme2 } from '@grafana/ui';
import { GrafanaPageRef } from '../../types';

export interface SidePanelProps {
  isOpen: boolean;
  onClose: () => void;
  pageRefs: Array<GrafanaPageRef & { messageIndex: number }>;
}

function getTabLabel(ref: GrafanaPageRef, index: number): string {
  if (ref.title) {
    return ref.title.length > 20 ? ref.title.substring(0, 20) + '...' : ref.title;
  }
  if (ref.type === 'dashboard' && ref.uid) {
    return `Dashboard ${ref.uid.substring(0, 8)}`;
  }
  return ref.type === 'explore' ? 'Explore' : `Page ${index + 1}`;
}

function toRelativeUrl(url: string): string {
  if (url.startsWith('http://') || url.startsWith('https://')) {
    const match = url.match(/https?:\/\/[^/]+(\/.*)/);
    return match ? match[1] : url;
  }
  return url;
}

export const SidePanel: React.FC<SidePanelProps> = ({ isOpen, onClose, pageRefs }) => {
  const theme = useTheme2();
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    if (activeIndex >= pageRefs.length) {
      setActiveIndex(Math.max(0, pageRefs.length - 1));
    }
  }, [pageRefs.length, activeIndex]);

  // #region agent log
  fetch('http://127.0.0.1:7242/ingest/2f5f5108-d124-4028-84fe-e1fd12dd1ddc', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      location: 'SidePanel.tsx:31',
      message: 'SidePanel render',
      data: {
        isOpen,
        pageRefsCount: pageRefs.length,
        pageRefs: pageRefs.map((r) => ({ type: r.type, url: r.url, uid: r.uid, title: r.title })),
      },
      timestamp: Date.now(),
      sessionId: 'debug-session',
      hypothesisId: 'H1,H5',
    }),
  }).catch(() => {});
  // #endregion

  if (!isOpen || pageRefs.length === 0) {
    return null;
  }

  const activeRef = pageRefs[activeIndex];
  const showTabs = pageRefs.length > 1;
  const iframeSrc = toRelativeUrl(activeRef.url);

  // #region agent log
  fetch('http://127.0.0.1:7242/ingest/2f5f5108-d124-4028-84fe-e1fd12dd1ddc', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      location: 'SidePanel.tsx:40',
      message: 'activeRef selected',
      data: {
        activeIndex,
        activeRefUrl: activeRef.url,
        iframeSrc,
        activeRefType: activeRef.type,
        activeRefUid: activeRef.uid,
        urlType: typeof activeRef.url,
        urlLength: activeRef.url?.length,
      },
      timestamp: Date.now(),
      sessionId: 'debug-session',
      hypothesisId: 'H1,H2,H4,H6',
    }),
  }).catch(() => {});
  // #endregion

  return (
    <div
      className="flex flex-col h-full border-l transition-all duration-300 ease-in-out"
      style={{
        width: '800px',
        minWidth: '400px',
        maxWidth: '65%',
        backgroundColor: theme.isDark ? '#1a1b1f' : theme.colors.background.primary,
        borderColor: theme.colors.border.weak,
      }}
      role="complementary"
      aria-label="Grafana page preview"
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-3 border-b flex-shrink-0"
        style={{
          borderColor: theme.colors.border.weak,
          backgroundColor: theme.isDark ? '#111217' : theme.colors.background.secondary,
        }}
      >
        <div className="flex items-center gap-2">
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ color: theme.colors.text.secondary }}
          >
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
            <line x1="9" y1="3" x2="9" y2="21" />
          </svg>
          <span className="text-sm font-medium" style={{ color: theme.colors.text.primary }}>
            {activeRef.title || (activeRef.type === 'explore' ? 'Explore' : 'Dashboard')}
          </span>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 rounded-md hover:bg-white/10 transition-colors"
          aria-label="Close panel"
          title="Close panel"
          style={{ color: theme.colors.text.secondary }}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {/* Tab bar */}
      {showTabs && (
        <div
          className="flex gap-1 px-2 py-2 border-b flex-shrink-0"
          style={{
            borderColor: theme.colors.border.weak,
            backgroundColor: theme.isDark ? '#111217' : theme.colors.background.secondary,
          }}
          role="tablist"
        >
          {pageRefs.map((ref, idx) => (
            <button
              key={`${ref.url}-${idx}`}
              onClick={() => setActiveIndex(idx)}
              className="flex-1 min-w-0 px-3 py-1.5 text-xs rounded-md truncate transition-colors"
              style={{
                backgroundColor:
                  idx === activeIndex
                    ? theme.colors.primary.main
                    : theme.isDark
                      ? 'rgba(255,255,255,0.05)'
                      : 'rgba(0,0,0,0.05)',
                color: idx === activeIndex ? theme.colors.primary.contrastText : theme.colors.text.secondary,
              }}
              role="tab"
              aria-selected={idx === activeIndex}
              title={ref.url}
            >
              {getTabLabel(ref, idx)}
            </button>
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
          // #region agent log
          onLoad={() =>
            fetch('http://127.0.0.1:7242/ingest/2f5f5108-d124-4028-84fe-e1fd12dd1ddc', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                location: 'SidePanel.tsx:iframe',
                message: 'iframe onLoad fired',
                data: { iframeSrc },
                timestamp: Date.now(),
                sessionId: 'debug-session',
                hypothesisId: 'H3,H6',
              }),
            }).catch(() => {})
          }
          onError={(e) =>
            fetch('http://127.0.0.1:7242/ingest/2f5f5108-d124-4028-84fe-e1fd12dd1ddc', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                location: 'SidePanel.tsx:iframe',
                message: 'iframe onError fired',
                data: { iframeSrc, error: String(e) },
                timestamp: Date.now(),
                sessionId: 'debug-session',
                hypothesisId: 'H3,H6',
              }),
            }).catch(() => {})
          }
          // #endregion
        />
      </div>
    </div>
  );
};
