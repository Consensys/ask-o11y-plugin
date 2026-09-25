import React from 'react';
import { Icon, useTheme2 } from '@grafana/ui';
import { testIds } from '../../../testIds';
import { AgentFinalReport } from '../../types';

interface FinalReportCardProps {
  report: AgentFinalReport;
}

const confidenceColor = (theme: ReturnType<typeof useTheme2>, confidence?: string): string => {
  switch (confidence?.toLowerCase()) {
    case 'high':
      return theme.colors.success.main;
    case 'low':
      return theme.colors.warning.main;
    default:
      return theme.colors.info.main;
  }
};

export const FinalReportCard: React.FC<FinalReportCardProps> = ({ report }) => {
  const theme = useTheme2();
  const hasHypotheses = Boolean(report.hypotheses?.length);
  const hasValidation = Boolean(report.validation);

  if (!hasHypotheses && !hasValidation) {
    return null;
  }

  return (
    <div
      data-testid={testIds.chat.finalReportCard}
      className="mb-4 rounded-lg overflow-hidden"
      style={{
        backgroundColor: theme.colors.background.secondary,
        border: `1px solid ${theme.colors.border.weak}`,
      }}
      aria-label="Root cause analysis report"
    >
      <div className="flex items-center justify-between gap-3 px-3 py-2 border-b border-weak">
        <div className="flex items-center gap-2 text-sm font-medium" style={{ color: theme.colors.text.primary }}>
          <Icon name="lightbulb-alt" size="sm" />
          Root cause analysis
        </div>
        {report.confidence && (
          <span
            className="text-xs font-medium px-2 py-0.5 rounded-full"
            style={{
              color: confidenceColor(theme, report.confidence),
              backgroundColor: theme.colors.background.primary,
              border: `1px solid ${theme.colors.border.weak}`,
            }}
          >
            {report.confidence} confidence
          </span>
        )}
      </div>

      {hasValidation && (
        <div className="flex flex-wrap items-center gap-2 px-3 py-2 text-xs" style={{ color: theme.colors.text.secondary }}>
          <ValidationBadge
            ok={Boolean(report.validation?.evidenceGrounded)}
            label="Evidence-grounded"
            theme={theme}
          />
          <ValidationBadge ok={Boolean(report.validation?.temporalOk)} label="Cause before symptom" theme={theme} />
          <ValidationBadge
            ok={Boolean(report.validation?.topologyConsistent)}
            label="Topology-consistent"
            theme={theme}
          />
          {report.validation?.repaired && <span>(repaired after validation)</span>}
        </div>
      )}

      {hasHypotheses && (
        <div className="px-3 py-2 space-y-2">
          {report.hypotheses?.map((h, index) => (
            <div
              key={index}
              data-testid={testIds.chat.finalReportHypothesis(index)}
              className="rounded px-3 py-2 text-xs leading-relaxed"
              style={{
                backgroundColor: theme.colors.background.primary,
                border: `1px solid ${theme.colors.border.weak}`,
              }}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="font-medium" style={{ color: theme.colors.text.primary }}>
                  {h.rank ? `${h.rank}. ` : ''}
                  {h.component || 'Unknown component'}
                  {h.faultType ? ` — ${h.faultType}` : ''}
                </div>
                {h.confidence && (
                  <span
                    className="font-medium whitespace-nowrap"
                    style={{ color: confidenceColor(theme, h.confidence) }}
                  >
                    {h.confidence}
                  </span>
                )}
              </div>
              {h.propagationPath && h.propagationPath.length > 0 && (
                <div className="mt-1 break-words font-mono" style={{ color: theme.colors.text.secondary }}>
                  {h.propagationPath.join(' → ')}
                </div>
              )}
              {h.firstSeen && (
                <div className="mt-1" style={{ color: theme.colors.text.secondary }}>
                  First seen {h.firstSeen}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {(report.gaps?.length || report.validation?.warnings?.length) ? (
        <div className="px-3 pb-3">
          {report.validation?.warnings && report.validation.warnings.length > 0 && (
            <>
              <div className="text-xs font-medium mb-1" style={{ color: theme.colors.warning.main }}>
                Validation warnings
              </div>
              <ul className="list-disc pl-4 text-xs space-y-1" style={{ color: theme.colors.text.secondary }}>
                {report.validation.warnings.map((warning, index) => (
                  <li key={index} className="break-words">
                    {warning}
                  </li>
                ))}
              </ul>
            </>
          )}
          {report.gaps && report.gaps.length > 0 && (
            <>
              <div className="text-xs font-medium mb-1" style={{ color: theme.colors.text.secondary }}>
                Gaps
              </div>
              <ul className="list-disc pl-4 text-xs space-y-1" style={{ color: theme.colors.text.secondary }}>
                {report.gaps.map((gap, index) => (
                  <li key={index} className="break-words">
                    {gap}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
};

function ValidationBadge({ ok, label, theme }: { ok: boolean; label: string; theme: ReturnType<typeof useTheme2> }) {
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full"
      style={{
        color: ok ? theme.colors.success.main : theme.colors.warning.main,
        backgroundColor: theme.colors.background.primary,
        border: `1px solid ${theme.colors.border.weak}`,
      }}
    >
      <Icon name={ok ? 'check' : 'exclamation-triangle'} size="xs" />
      {label}
    </span>
  );
}
