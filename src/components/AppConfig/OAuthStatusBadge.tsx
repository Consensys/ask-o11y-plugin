import React from 'react';
import { Icon } from '@grafana/ui';

export interface OAuthStatusBadgeProps {
  status?: 'not_configured' | 'authorizing' | 'authorized' | 'expired' | 'error';
  expiresAt?: string;
  lastError?: string;
}

export const OAuthStatusBadge: React.FC<OAuthStatusBadgeProps> = ({ status = 'not_configured', expiresAt, lastError }) => {
  const getStatusConfig = () => {
    switch (status) {
      case 'authorized':
        return {
          icon: 'check-circle' as const,
          text: 'Authorized',
          color: 'var(--grafana-success-text)',
          bgColor: 'var(--grafana-success-bg)',
        };
      case 'authorizing':
        return {
          icon: 'sync' as const,
          text: 'Authorizing...',
          color: 'var(--grafana-info-text)',
          bgColor: 'var(--grafana-info-bg)',
        };
      case 'expired':
        return {
          icon: 'exclamation-triangle' as const,
          text: 'Expired',
          color: 'var(--grafana-warning-text)',
          bgColor: 'var(--grafana-warning-bg)',
        };
      case 'error':
        return {
          icon: 'times-circle' as const,
          text: 'Error',
          color: 'var(--grafana-error-text)',
          bgColor: 'var(--grafana-error-bg)',
        };
      default:
        return {
          icon: 'circle' as const,
          text: 'Not Configured',
          color: 'var(--grafana-text-secondary)',
          bgColor: 'var(--grafana-background-secondary)',
        };
    }
  };

  const config = getStatusConfig();

  const formatExpiration = () => {
    if (!expiresAt) {
      return null;
    }

    try {
      const expiry = new Date(expiresAt);
      const now = new Date();
      const diffMs = expiry.getTime() - now.getTime();
      const diffMins = Math.floor(diffMs / 60000);
      const diffHours = Math.floor(diffMins / 60);
      const diffDays = Math.floor(diffHours / 24);

      if (diffDays > 0) {
        return `Expires in ${diffDays} day${diffDays !== 1 ? 's' : ''}`;
      } else if (diffHours > 0) {
        return `Expires in ${diffHours} hour${diffHours !== 1 ? 's' : ''}`;
      } else if (diffMins > 0) {
        return `Expires in ${diffMins} minute${diffMins !== 1 ? 's' : ''}`;
      } else {
        return 'Expiring soon';
      }
    } catch {
      return null;
    }
  };

  const expirationText = formatExpiration();

  return (
    <div className="flex flex-col gap-1">
      <div
        className="inline-flex items-center gap-2 px-3 py-1 rounded text-sm"
        style={{
          backgroundColor: config.bgColor,
          color: config.color,
          border: `1px solid ${config.color}`,
        }}
      >
        <Icon name={config.icon} />
        <span>{config.text}</span>
      </div>
      {expirationText && status === 'authorized' && (
        <span className="text-xs" style={{ color: 'var(--grafana-text-secondary)' }}>
          {expirationText}
        </span>
      )}
      {lastError && status === 'error' && (
        <span className="text-xs" style={{ color: 'var(--grafana-error-text)' }}>
          {lastError}
        </span>
      )}
    </div>
  );
};
