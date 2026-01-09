import { usePluginContext } from '@grafana/data';
import type { AppPluginSettings } from '../types/plugin';

/**
 * Hook to access plugin JSON data (settings)
 */
export const usePluginJsonData = (): AppPluginSettings | undefined => {
  const context = usePluginContext();
  return context?.meta?.jsonData as AppPluginSettings | undefined;
};
