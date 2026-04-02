import { getBackendSrv } from '@grafana/runtime';
import { lastValueFrom } from 'rxjs';

const BASE_URL = '/api/plugins/consensys-asko11y-app/resources/api/slack-link';

export type SlackLinkResult = 'linked' | 'expired' | 'unauthorized' | 'error';

export async function confirmSlackLink(nonce: string): Promise<SlackLinkResult> {
  try {
    await lastValueFrom(
      getBackendSrv().fetch<unknown>({
        url: `${BASE_URL}/confirm`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        data: { nonce },
      })
    );
    return 'linked';
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'status' in err) {
      const status = (err as { status: number }).status;
      if (status === 410) {
        return 'expired';
      }
      if (status === 401) {
        return 'unauthorized';
      }
    }
    return 'error';
  }
}

export async function unlinkSlackAccount(): Promise<boolean> {
  try {
    await lastValueFrom(
      getBackendSrv().fetch<unknown>({
        url: BASE_URL,
        method: 'DELETE',
      })
    );
    return true;
  } catch {
    return false;
  }
}

export async function getSlackLinkStatus(): Promise<{ linked: boolean; orgId: number } | null> {
  try {
    const response = await lastValueFrom(
      getBackendSrv().fetch<{ linked: boolean; orgId: number }>({
        url: BASE_URL,
        method: 'GET',
      })
    );
    return response.data;
  } catch {
    return null;
  }
}
