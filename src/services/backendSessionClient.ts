import { config } from '@grafana/runtime';
import type { ChatMessage } from '../components/Chat/types';

const SESSIONS_URL = '/api/plugins/consensys-asko11y-app/resources/api/sessions';

function orgHeaders(): Record<string, string> {
  const orgId = String(config.bootData.user.orgId || '1');
  return { 'X-Grafana-Org-Id': orgId };
}

export interface SessionMetadata {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  activeRunId?: string;
}

export interface BackendChatSession extends SessionMetadata {
  messages: ChatMessage[];
  summary?: string;
}

export interface SessionUpdate {
  messages?: ChatMessage[];
  title?: string;
  summary?: string;
}

export async function createSession(
  title?: string,
  messages?: ChatMessage[]
): Promise<BackendChatSession> {
  const resp = await fetch(SESSIONS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...orgHeaders() },
    body: JSON.stringify({ title: title || '', messages: messages || [] }),
  });
  if (!resp.ok) {
    throw new Error(`Failed to create session (${resp.status})`);
  }
  return resp.json();
}

export async function listSessions(): Promise<SessionMetadata[]> {
  const resp = await fetch(SESSIONS_URL, {
    headers: orgHeaders(),
  });
  if (!resp.ok) {
    throw new Error(`Failed to list sessions (${resp.status})`);
  }
  return resp.json();
}

export async function getSession(sessionId: string): Promise<BackendChatSession> {
  const resp = await fetch(`${SESSIONS_URL}/${sessionId}`, {
    headers: orgHeaders(),
  });
  if (!resp.ok) {
    throw new Error(`Failed to get session (${resp.status})`);
  }
  return resp.json();
}

export async function updateSession(sessionId: string, update: SessionUpdate): Promise<void> {
  const resp = await fetch(`${SESSIONS_URL}/${sessionId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...orgHeaders() },
    body: JSON.stringify(update),
  });
  if (!resp.ok) {
    throw new Error(`Failed to update session (${resp.status})`);
  }
}

export async function deleteSession(sessionId: string): Promise<void> {
  const resp = await fetch(`${SESSIONS_URL}/${sessionId}`, {
    method: 'DELETE',
    headers: orgHeaders(),
  });
  if (!resp.ok) {
    throw new Error(`Failed to delete session (${resp.status})`);
  }
}

export async function deleteAllSessions(): Promise<void> {
  const resp = await fetch(SESSIONS_URL, {
    method: 'DELETE',
    headers: orgHeaders(),
  });
  if (!resp.ok) {
    throw new Error(`Failed to delete all sessions (${resp.status})`);
  }
}

export async function getCurrentSessionId(): Promise<string | null> {
  const resp = await fetch(`${SESSIONS_URL}/current`, {
    headers: orgHeaders(),
  });
  if (!resp.ok) {
    throw new Error(`Failed to get current session (${resp.status})`);
  }
  const data = await resp.json();
  return data.sessionId || null;
}

export async function setCurrentSessionId(sessionId: string | null): Promise<void> {
  const resp = await fetch(`${SESSIONS_URL}/current`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...orgHeaders() },
    body: JSON.stringify({ sessionId: sessionId || '' }),
  });
  if (!resp.ok) {
    throw new Error(`Failed to set current session (${resp.status})`);
  }
}
