import { renderHook, act, waitFor } from '@testing-library/react';
import { useSessionManager } from '../useSessionManager';
import {
  listSessions,
  getSession,
  setCurrentSessionId,
  type BackendChatSession,
  type SessionMetadata,
} from '../../../../services/backendSessionClient';

jest.mock('../../../../services/backendSessionClient', () => ({
  listSessions: jest.fn(),
  getSession: jest.fn(),
  deleteSession: jest.fn(),
  deleteAllSessions: jest.fn(),
  setCurrentSessionId: jest.fn(),
}));

const listSessionsMock = listSessions as jest.MockedFunction<typeof listSessions>;
const getSessionMock = getSession as jest.MockedFunction<typeof getSession>;
const setCurrentSessionIdMock = setCurrentSessionId as jest.MockedFunction<typeof setCurrentSessionId>;

function metadata(id: string): SessionMetadata {
  return {
    id,
    title: `Session ${id}`,
    createdAt: '2026-11-25T10:00:00Z',
    updatedAt: '2026-11-25T10:00:00Z',
    messageCount: 0,
  };
}

function session(id: string): BackendChatSession {
  return { ...metadata(id), messages: [] };
}

function setup(sessionIdFromUrl: string | null = null) {
  const setChatHistory = jest.fn();
  const onSessionIdChange = jest.fn();
  const hook = renderHook(() =>
    useSessionManager('1', [], setChatHistory, sessionIdFromUrl, onSessionIdChange)
  );
  return { ...hook, setChatHistory, onSessionIdChange };
}

describe('useSessionManager.loadSession', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    listSessionsMock.mockResolvedValue([]);
    setCurrentSessionIdMock.mockResolvedValue();
  });

  it('loads a session, adds its metadata and reports the id', async () => {
    getSessionMock.mockResolvedValue(session('s1'));
    const { result, setChatHistory, onSessionIdChange } = setup();

    await act(async () => {
      await result.current.loadSession('s1');
    });

    expect(result.current.currentSessionId).toBe('s1');
    expect(result.current.sessions).toHaveLength(1);
    expect(result.current.sessions[0].id).toBe('s1');
    expect(setChatHistory).toHaveBeenCalledWith([]);
    expect(onSessionIdChange).toHaveBeenCalledWith('s1');
  });

  it('rejects on 404, clears the transcript and removes the stale entry', async () => {
    listSessionsMock.mockResolvedValue([metadata('dead')]);
    getSessionMock.mockRejectedValue(new Error('Failed to get session (404)'));
    const { result, setChatHistory, onSessionIdChange } = setup();

    await waitFor(() => expect(result.current.sessions).toHaveLength(1));

    await act(async () => {
      await expect(result.current.loadSession('dead')).rejects.toThrow('404');
    });

    expect(result.current.currentSessionId).toBeNull();
    expect(result.current.sessions).toHaveLength(0);
    expect(setChatHistory).toHaveBeenCalledWith([]);
    expect(onSessionIdChange).toHaveBeenCalledWith(null);
  });

  it('rejects on a network error and keeps the current transcript and list', async () => {
    listSessionsMock.mockResolvedValue([metadata('s1')]);
    getSessionMock.mockRejectedValue(new Error('Failed to get session (500)'));
    const { result, setChatHistory, onSessionIdChange } = setup('s1');

    await waitFor(() => expect(result.current.sessions).toHaveLength(1));

    await act(async () => {
      await expect(result.current.loadSession('s2')).rejects.toThrow('500');
    });

    expect(result.current.currentSessionId).toBe('s1');
    expect(result.current.sessions).toHaveLength(1);
    expect(result.current.sessions[0].id).toBe('s1');
    expect(setChatHistory).not.toHaveBeenCalled();
    expect(onSessionIdChange).not.toHaveBeenCalled();
  });
});
