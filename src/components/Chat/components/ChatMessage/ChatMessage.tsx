import React from 'react';
import { Streamdown } from 'streamdown';
import { useTheme2 } from '@grafana/ui';
import { ToolCallsSection } from '../ToolCallsSection/ToolCallsSection';
import { GraphRenderer } from '../GraphRenderer/GraphRenderer';
import { LogsRenderer } from '../LogsRenderer/LogsRenderer';
import { TracesRenderer } from '../TracesRenderer/TracesRenderer';
import { ChatMessage as ChatMessageType, ContentSection } from '../../types';
import { splitContentByPromQL } from '../../utils/promqlParser';

interface ChatMessageProps {
  message: ChatMessageType;
  isGenerating?: boolean;
  isLastMessage?: boolean;
}

/**
 * Helper to build time range prop for query renderers
 */
function buildTimeRange(query: ContentSection['query']): { from: string; to: string } | undefined {
  if (!query?.from) {
    return undefined;
  }
  return { from: query.from, to: query.to || 'now' };
}

interface QuerySectionProps {
  section: ContentSection;
}

/**
 * Renders a query section (PromQL, LogQL, or TraceQL)
 */
function QuerySection({ section }: QuerySectionProps): React.ReactElement | null {
  if (!section.query) {
    return null;
  }

  const timeRange = buildTimeRange(section.query);

  switch (section.type) {
    case 'promql':
      return (
        <GraphRenderer
          query={section.query}
          defaultTimeRange={timeRange}
          visualizationType={section.query.visualization}
        />
      );
    case 'logql':
      return <LogsRenderer query={section.query} defaultTimeRange={timeRange} />;
    case 'traceql':
      return <TracesRenderer query={section.query} defaultTimeRange={timeRange} />;
    default:
      return null;
  }
}

export const ChatMessage: React.FC<ChatMessageProps> = ({ message, isGenerating = false, isLastMessage = false }) => {
  const theme = useTheme2();
  const showThinking = message.role === 'assistant' && isGenerating && isLastMessage && !message.content;
  const isUser = message.role === 'user';

  if (isUser) {
    // User messages: Sober colored bubble
    return (
      <div className="flex w-full justify-end mb-5 animate-slideIn" role="article" aria-label="User message">
        <div className="max-w-[75%]">
          <div
            className="px-4 py-3 rounded-xl rounded-br-sm"
            style={{
              backgroundColor: theme.isDark ? '#3730a3' : '#4f46e5',
              color: '#ffffff',
            }}
            tabIndex={0}
            aria-live="polite"
          >
            <span className="sr-only">User message</span>
            <div className="text-sm leading-relaxed whitespace-pre-wrap break-words">{message.content}</div>
          </div>
        </div>
      </div>
    );
  }

  // Split content by PromQL queries for assistant messages
  const contentSections = message.content ? splitContentByPromQL(message.content) : [];

  // Assistant messages: Plain text with modern styling and embedded graphs
  return (
    <div className="flex w-full mb-6 animate-fadeIn" role="article" aria-label="Assistant message">
      <div className="w-full max-w-none" tabIndex={0}>
        <span className="sr-only">Assistant message</span>
        {/* Tool Calls Section */}
        {message.toolCalls && message.toolCalls.length > 0 && (
          <div className="mb-4">
            <ToolCallsSection toolCalls={message.toolCalls} />
          </div>
        )}

        {/* Message Content */}
        {showThinking ? (
          <div
            className="flex items-center gap-3 px-4 py-3 rounded-lg animate-pulse"
            style={{
              backgroundColor: theme.isDark ? 'rgba(255, 255, 255, 0.03)' : 'rgba(0, 0, 0, 0.02)',
              color: theme.colors.text.secondary,
            }}
          >
            <div className="flex gap-1.5">
              <div
                className="w-2 h-2 rounded-full animate-pulse"
                style={{
                  backgroundColor: theme.colors.primary.main,
                  animationDelay: '0ms',
                }}
              ></div>
              <div
                className="w-2 h-2 rounded-full animate-pulse"
                style={{
                  backgroundColor: theme.colors.primary.main,
                  animationDelay: '150ms',
                }}
              ></div>
              <div
                className="w-2 h-2 rounded-full animate-pulse"
                style={{
                  backgroundColor: theme.colors.primary.main,
                  animationDelay: '300ms',
                }}
              ></div>
            </div>
            <span className="text-sm font-medium">Thinking...</span>
          </div>
        ) : contentSections.length > 0 ? (
          <div
            className="text-sm leading-relaxed whitespace-normal break-words"
            style={{ color: theme.colors.text.primary }}
          >
            {contentSections.map((section, index) => {
              if (section.type === 'text') {
                return (
                  <div key={index} className="prose prose-sm max-w-none">
                    <Streamdown>{section.content}</Streamdown>
                  </div>
                );
              }

              // Render query section (promql, logql, or traceql)
              if (section.query) {
                return (
                  <div key={index} className="my-3">
                    <QuerySection section={section} />
                  </div>
                );
              }

              return null;
            })}
          </div>
        ) : (
          <div
            className="text-sm leading-relaxed whitespace-normal break-words prose prose-sm max-w-none"
            style={{ color: theme.colors.text.primary }}
          >
            <Streamdown>{message.content}</Streamdown>
          </div>
        )}
      </div>
    </div>
  );
};
