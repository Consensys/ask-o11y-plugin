// Type-safe expiry configuration
export type ExpiryConfig =
  | { type: 'hours'; value: number }
  | { type: 'days'; value: number }
  | { type: 'never' };

export interface ExpiryOption {
  label: string;
  config: ExpiryConfig;
}

// Predefined expiry options
export const EXPIRY_OPTIONS: ExpiryOption[] = [
  { label: '1 hour', config: { type: 'hours', value: 1 } },
  { label: '1 day', config: { type: 'days', value: 1 } },
  { label: '7 days', config: { type: 'days', value: 7 } },
  { label: '30 days', config: { type: 'days', value: 30 } },
  { label: '90 days', config: { type: 'days', value: 90 } },
  { label: 'Never', config: { type: 'never' } },
];

// Convert ExpiryConfig to API parameters
export function expiryConfigToApiParams(config: ExpiryConfig): {
  expiresInDays?: number;
  expiresInHours?: number;
} {
  switch (config.type) {
    case 'hours':
      return { expiresInHours: config.value };
    case 'days':
      return { expiresInDays: config.value };
    case 'never':
      return {};
  }
}

// Format expiry date for display
export function formatExpiryDate(expiresAt: string | null): string {
  if (!expiresAt) {
    return 'Never';
  }
  try {
    const date = new Date(expiresAt);
    return date.toLocaleDateString();
  } catch {
    return 'Invalid date';
  }
}

// Convert ExpiryConfig to unique string key for Select component
export function expiryConfigToKey(config: ExpiryConfig): string {
  switch (config.type) {
    case 'hours':
      return `hours-${config.value}`;
    case 'days':
      return `days-${config.value}`;
    case 'never':
      return 'never';
  }
}

// Find expiry option by key
export function findExpiryOptionByKey(key: string): ExpiryOption | undefined {
  return EXPIRY_OPTIONS.find((opt) => expiryConfigToKey(opt.config) === key);
}

interface MessageWithTimestamp {
  timestamp?: Date | string | number;
}

// Transform message timestamp to Date object
// Handles both string and Date timestamps, with fallback to current time
export function normalizeMessageTimestamp(msg: MessageWithTimestamp): Date {
  const { timestamp } = msg;

  if (!timestamp) {
    return new Date();
  }

  if (timestamp instanceof Date) {
    return timestamp;
  }

  // Handles string and numeric timestamps
  return new Date(timestamp);
}
