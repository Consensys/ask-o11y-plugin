import React from 'react';
import { Streamdown } from 'streamdown';
import { useTheme2 } from '@grafana/ui';
import { ToolCallsSection } from '../ToolCallsSection/ToolCallsSection';
import { ReasoningIndicator } from '../ReasoningIndicator/ReasoningIndicator';
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

function buildTimeRange(query: ContentSection['query']): { from: string; to: string } | undefined {
  if (!query?.from) {
    return undefined;
  }
  return { from: query.from, to: query.to || 'now' };
}

interface QuerySectionProps {
  section: ContentSection;
}

function QuerySection({ section }: QuerySectionProps): React.ReactElement | null {
  const { query, type } = section;
  if (!query) {
    return null;
  }

  const timeRange = buildTimeRange(query);

  if (type === 'promql') {
    return <GraphRenderer query={query} defaultTimeRange={timeRange} visualizationType={query.visualization} />;
  }
  if (type === 'logql') {
    return <LogsRenderer query={query} defaultTimeRange={timeRange} />;
  }
  if (type === 'traceql') {
    return <TracesRenderer query={query} defaultTimeRange={timeRange} />;
  }
  return null;
}

export const ChatMessage: React.FC<ChatMessageProps> = ({ message, isGenerating = false, isLastMessage = false }) => {
  const theme = useTheme2();
  const showThinking =
    message.role === 'assistant' && isGenerating && isLastMessage && !message.content && !message.reasoning;
  const showReasoning =
    message.role === 'assistant' && isGenerating && isLastMessage && !!message.reasoning && !message.content;
  const isUser = message.role === 'user';

  if (isUser) {
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

  const contentSections = message.content ? splitContentByPromQL(message.content) : [];

  return (
    <div className="flex w-full mb-6 animate-fadeIn" role="article" aria-label="Assistant message">
      <div className="w-full max-w-none" tabIndex={0}>
        <span className="sr-only">Assistant message</span>
        {message.toolCalls && message.toolCalls.length > 0 && (
          <div className="mb-4">
            <ToolCallsSection toolCalls={message.toolCalls} />
          </div>
        )}

        {showReasoning && <ReasoningIndicator reasoning={message.reasoning!} />}

        {showThinking && (
          <div
            className="flex items-center gap-3 px-4 py-3 rounded-lg animate-pulse"
            style={{
              backgroundColor: theme.isDark ? 'rgba(255, 255, 255, 0.03)' : 'rgba(0, 0, 0, 0.02)',
              color: theme.colors.text.secondary,
            }}
          >
            <div className="flex gap-1.5">
              {[0, 150, 300].map((delay) => (
                <div
                  key={delay}
                  className="w-2 h-2 rounded-full animate-pulse"
                  style={{
                    backgroundColor: theme.colors.primary.main,
                    animationDelay: `${delay}ms`,
                  }}
                />
              ))}
            </div>
            <span className="text-sm font-medium">Thinking...</span>
          </div>
        )}

        {!showThinking && contentSections.length > 0 && (
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
        )}

        {!showThinking && contentSections.length === 0 && (
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
