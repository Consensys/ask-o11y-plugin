/**
 * Unit tests for useSessionManager hook - Read-only mode behavior
 * Tests that shared sessions are not auto-saved when in read-only mode
 */

import { renderHook, waitFor, act } from '@testing-library/react';
import { useSessionManager } from '../useSessionManager';
import { ChatMessage } from '../../types';
import { ServiceFactory } from '../../../../core/services/ServiceFactory';
import { ConversationMemoryService } from '../../../../services/memory';

// Mock dependencies
jest.mock('../../../../core/services/ServiceFactory');
jest.mock('../../../../services/memory');
jest.mock('@grafana/runtime', () => ({
  usePluginUserStorage: jest.fn(() => ({
    getItem: jest.fn().mockResolvedValue(null),
    setItem: jest.fn().mockResolvedValue(undefined),
  })),
}));

describe('useSessionManager - Read-only mode', () => {
  let mockSessionService: any;
  let mockSetChatHistory: jest.Mock;

  const mockMessages: ChatMessage[] = [
    { role: 'user', content: 'Hello' },
    { role: 'assistant', content: 'Hi there!' },
  ];

  beforeEach(() => {
    jest.clearAllMocks();

    mockSetChatHistory = jest.fn();

    // Setup mock session service
    mockSessionService = {
      getAllSessions: jest.fn().mockResolvedValue([]),
      getCurrentSession: jest.fn().mockResolvedValue(null),
      getSession: jest.fn().mockResolvedValue(null),
      createSession: jest.fn().mockResolvedValue({ id: 'new-session-1', title: 'New Session' }),
      updateSession: jest.fn().mockResolvedValue(undefined),
      deleteSession: jest.fn().mockResolvedValue(undefined),
      deleteAllSessions: jest.fn().mockResolvedValue(undefined),
      setActiveSession: jest.fn().mockResolvedValue(undefined),
      clearActiveSession: jest.fn().mockResolvedValue(undefined),
      getStorageStats: jest.fn().mockResolvedValue({ used: 1024, total: 5242880, sessionCount: 0 }),
    };

    (ServiceFactory.getSessionService as jest.Mock).mockReturnValue(mockSessionService);
    (ConversationMemoryService.shouldSummarize as jest.Mock).mockReturnValue(false);
    (ConversationMemoryService.summarizeMessages as jest.Mock) = jest.fn().mockResolvedValue('Test summary');
  });

  it('should skip save when readOnly is true', async () => {
    const { result } = renderHook(() =>
      useSessionManager('test-org', mockMessages, mockSetChatHistory, true)
    );

    // Wait for initialization
    await waitFor(() => {
      expect(mockSessionService.getAllSessions).toHaveBeenCalled();
    });

    // Try to save immediately
    await act(async () => {
      await result.current.saveImmediately(mockMessages);
    });

    // Verify that createSession was NOT called (no save in read-only mode)
    expect(mockSessionService.createSession).not.toHaveBeenCalled();
    // Verify that updateSession was NOT called (no save in read-only mode)
    expect(mockSessionService.updateSession).not.toHaveBeenCalled();
  });

  it('should skip summarization when readOnly is true', async () => {
    // Mock shouldSummarize to return true (would normally trigger summarization)
    (ConversationMemoryService.shouldSummarize as jest.Mock).mockReturnValue(true);

    renderHook(() =>
      useSessionManager('test-org', mockMessages, mockSetChatHistory, true)
    );

    // Wait for initialization
    await waitFor(() => {
      expect(mockSessionService.getAllSessions).toHaveBeenCalled();
    });

    // Verify that summarization was NOT triggered (read-only mode skips summarization)
    expect(ConversationMemoryService.summarizeMessages).not.toHaveBeenCalled();
  });

  it('should NOT skip save when readOnly is false', async () => {
    const { result } = renderHook(() =>
      useSessionManager('test-org', mockMessages, mockSetChatHistory, false)
    );

    // Wait for initialization
    await waitFor(() => {
      expect(mockSessionService.getAllSessions).toHaveBeenCalled();
    });

    // Save immediately
    await act(async () => {
      await result.current.saveImmediately(mockMessages);
    });

    // Verify that createSession WAS called (save creates new session when currentSessionId is null)
    expect(mockSessionService.createSession).toHaveBeenCalledWith('test-org', mockMessages);
  });

  it('should NOT skip save when readOnly is undefined', async () => {
    const { result } = renderHook(() =>
      useSessionManager('test-org', mockMessages, mockSetChatHistory, undefined)
    );

    // Wait for initialization
    await waitFor(() => {
      expect(mockSessionService.getAllSessions).toHaveBeenCalled();
    });

    // Save immediately
    await act(async () => {
      await result.current.saveImmediately(mockMessages);
    });

    // Verify that createSession WAS called (readOnly undefined is falsy, so save should run)
    expect(mockSessionService.createSession).toHaveBeenCalledWith('test-org', mockMessages);
  });

  it('should skip loading current session when chatHistory has messages and readOnly is true', async () => {
    renderHook(() =>
      useSessionManager('test-org', mockMessages, mockSetChatHistory, true)
    );

    // Wait for initialization
    await waitFor(() => {
      expect(mockSessionService.getAllSessions).toHaveBeenCalled();
    });

    // Verify that getCurrentSession was NOT called (because chatHistory has messages)
    expect(mockSessionService.getCurrentSession).not.toHaveBeenCalled();
  });

  it('should load current session when chatHistory is empty even if readOnly is true', async () => {
    renderHook(() =>
      useSessionManager('test-org', [], mockSetChatHistory, true)
    );

    // Wait for initialization
    await waitFor(() => {
      expect(mockSessionService.getAllSessions).toHaveBeenCalled();
    });

    // Verify that getCurrentSession WAS called (because chatHistory is empty)
    expect(mockSessionService.getCurrentSession).toHaveBeenCalledWith('test-org');
  });
});
