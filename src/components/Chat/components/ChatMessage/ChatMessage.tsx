import React from 'react';
import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { Button, Icon, useTheme2 } from '@grafana/ui';
import { ToolCallsSection } from '../ToolCallsSection/ToolCallsSection';
import { GraphRenderer } from '../GraphRenderer/GraphRenderer';
import { LogsRenderer } from '../LogsRenderer/LogsRenderer';
import { TracesRenderer } from '../TracesRenderer/TracesRenderer';
import { AgentApprovalItem, ChatMessage as ChatMessageType, ContentSection } from '../../types';
import { splitContentByPromQL } from '../../utils/promqlParser';

interface ChatMessageProps {
  message: ChatMessageType;
  isGenerating?: boolean;
  isLastMessage?: boolean;
  onResolveApproval?: (
    approval: AgentApprovalItem,
    decision: 'approved' | 'rejected',
    approvalScope?: 'once' | 'always'
  ) => Promise<void>;
}

function buildTimeRange(query: ContentSection['query']): { from: string; to: string } | undefined {
  if (!query?.from) {
    return undefined;
  }
  return { from: query.from, to: query.to || 'now' };
}

interface MarkdownContentProps {
  content: string;
}

function MarkdownContent({ content }: MarkdownContentProps): React.ReactElement {
  const html = React.useMemo(() => {
    const rendered = marked.parse(content, {
      async: false,
      breaks: true,
      gfm: true,
    }) as string;

    return DOMPurify.sanitize(rendered);
  }, [content]);

  return <div dangerouslySetInnerHTML={{ __html: html }} />;
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

function AgentTraceSummary({
  message,
  onResolveApproval,
}: {
  message: ChatMessageType;
  onResolveApproval?: (
    approval: AgentApprovalItem,
    decision: 'approved' | 'rejected',
    approvalScope?: 'once' | 'always'
  ) => Promise<void>;
}): React.ReactElement | null {
  const theme = useTheme2();
  const hasPlan = Boolean(message.runPlan?.steps?.length);
  const hasEvidence = Boolean(message.evidence?.length);
  const hasApprovals = Boolean(message.approvals?.length);
  const [isPlanOpen, setIsPlanOpen] = React.useState(false);
  const planSteps = message.runPlan?.steps || [];
  const completedSteps = planSteps.filter((step) => step.status === 'completed').length;
  const runningSteps = planSteps.filter((step) => step.status === 'running').length;
  const planProgress = planSteps.length > 0 ? Math.round((completedSteps / planSteps.length) * 100) : 0;

  if (!hasPlan && !hasEvidence && !hasApprovals && !message.finalReport) {
    return null;
  }

  return (
    <div
      className="mb-4 rounded-lg overflow-hidden"
      style={{
        backgroundColor: theme.colors.background.secondary,
        border: `1px solid ${theme.colors.border.weak}`,
      }}
    >
      {hasPlan && (
        <div className="px-3 py-2 border-b border-weak">
          <button
            type="button"
            className="flex w-full items-center gap-3 text-left"
            aria-expanded={isPlanOpen}
            onClick={() => setIsPlanOpen((open) => !open)}
            style={{
              background: 'transparent',
              border: 0,
              color: 'inherit',
              cursor: 'pointer',
              padding: 0,
            }}
          >
            <Icon name={isPlanOpen ? 'angle-down' : 'angle-right'} size="sm" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-3">
                <div className="text-xs font-medium truncate" style={{ color: theme.colors.text.secondary }}>
                  Run progress
                </div>
                <div className="text-xs" style={{ color: theme.colors.text.secondary }}>
                  {completedSteps}/{planSteps.length}
                  {runningSteps > 0 ? ' running' : ''}
                </div>
              </div>
              <div
                className="mt-2 h-1.5 overflow-hidden rounded"
                style={{ backgroundColor: theme.colors.background.primary }}
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={planProgress}
              >
                <div
                  className="h-full rounded"
                  style={{ width: `${planProgress}%`, backgroundColor: theme.colors.primary.main }}
                />
              </div>
            </div>
          </button>
          {isPlanOpen && (
            <div className="mt-3">
              <div className="text-xs font-medium mb-2" style={{ color: theme.colors.text.secondary }}>
                {message.runPlan?.objective}
              </div>
              <div className="flex flex-wrap gap-2">
                {planSteps.map((step) => (
                  <span
                    key={step.id}
                    className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs"
                    style={{
                      backgroundColor: theme.colors.background.primary,
                      color: theme.colors.text.primary,
                      border: `1px solid ${theme.colors.border.weak}`,
                    }}
                  >
                    <Icon
                      name={step.status === 'completed' ? 'check' : step.status === 'running' ? 'spinner' : 'circle'}
                      size="xs"
                    />
                    {step.title}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {hasApprovals && (
        <div className="px-3 py-2 border-b border-weak">
          {message.approvals?.map((approval) => (
            <div key={approval.approvalId} className="flex flex-col gap-2 py-2">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-medium" style={{ color: theme.colors.text.primary }}>
                    {approval.decision ? 'Approval resolved' : 'Approval required'}: {approval.toolName}
                  </div>
                  <div className="text-xs mt-1" style={{ color: theme.colors.text.secondary }}>
                    {approval.risk} · {approval.reason}
                  </div>
                  {approval.error && <div className="text-xs text-error mt-1">{approval.error}</div>}
                </div>
                {approval.decision ? (
                  <span className="text-xs font-medium text-secondary">{approval.decision}</span>
                ) : (
                  <div className="flex flex-wrap justify-end gap-2">
                    <Button
                      size="sm"
                      icon="check"
                      disabled={approval.resolving || !onResolveApproval}
                      onClick={() => onResolveApproval?.(approval, 'approved', 'once')}
                    >
                      Approve this time
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      icon="check"
                      disabled={approval.resolving || !onResolveApproval}
                      onClick={() => onResolveApproval?.(approval, 'approved', 'always')}
                    >
                      Approve for session
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      icon="times"
                      disabled={approval.resolving || !onResolveApproval}
                      onClick={() => onResolveApproval?.(approval, 'rejected')}
                    >
                      Reject
                    </Button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {hasEvidence && (
        <div className="px-3 py-2">
          <div className="text-xs font-medium mb-2" style={{ color: theme.colors.text.secondary }}>
            Evidence
          </div>
          <div className="space-y-2">
            {message.evidence?.map((item) => (
              <div key={item.id} className="text-xs leading-relaxed">
                <div className="font-medium" style={{ color: theme.colors.text.primary }}>
                  {item.title}
                </div>
                <div style={{ color: theme.colors.text.secondary }}>{item.summary}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export const ChatMessage: React.FC<ChatMessageProps> = ({
  message,
  isGenerating = false,
  isLastMessage = false,
  onResolveApproval,
}) => {
  const theme = useTheme2();
  const showThinking = message.role === 'assistant' && isGenerating && isLastMessage && !message.content;
  const isUser = message.role === 'user';

  if (isUser) {
    return (
      <div className="flex w-full justify-end mb-5 animate-slideIn" role="article" aria-label="User message">
        <div className="max-w-[75%]">
          <div
            className="px-4 py-3 rounded-xl rounded-br-sm"
            style={{
              backgroundColor: theme.colors.primary.main,
              color: theme.colors.primary.contrastText,
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

        <AgentTraceSummary message={message} onResolveApproval={onResolveApproval} />

        {showThinking && (
          <div className="flex items-center gap-3 px-4 py-3 rounded-lg animate-pulse bg-surface text-secondary">
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
          <div className="text-sm leading-relaxed whitespace-normal break-words text-primary">
            {contentSections.map((section, index) => {
              if (section.type === 'text') {
                return (
                  <div key={index} className="prose prose-sm max-w-none">
                    <MarkdownContent content={section.content} />
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
          <div className="text-sm leading-relaxed whitespace-normal break-words prose prose-sm max-w-none text-primary">
            <MarkdownContent content={message.content} />
          </div>
        )}
      </div>
    </div>
  );
};
