import { act } from 'react';
import { renderHook } from '@testing-library/react';
import { useChat } from '../useChat';
import {
  resolveAgentApproval,
  getAgentRunStatus,
  runAgentDetached,
  reconnectToAgentRun,
} from '../../../../services/agentClient';
import type { AgentApprovalItem, ChatMessage } from '../../types';

jest.mock('@grafana/runtime', () => ({
  config: {
    bootData: {
      user: {
        orgId: 2,
      },
    },
  },
}));

jest.mock('../../../../services/backendSessionClient', () => ({
  listSessions: jest.fn(() => new Promise(() => {})),
  getSession: jest.fn(),
  deleteSession: jest.fn(),
  deleteAllSessions: jest.fn(),
  getCurrentSessionId: jest.fn(),
  setCurrentSessionId: jest.fn(),
}));

jest.mock('../../../../services/agentClient', () => ({
  runAgentDetached: jest.fn(),
  reconnectToAgentRun: jest.fn(),
  cancelAgentRun: jest.fn(),
  resolveAgentApproval: jest.fn(),
  getAgentRunStatus: jest.fn(),
}));

const resolveAgentApprovalMock = resolveAgentApproval as jest.MockedFunction<typeof resolveAgentApproval>;
const getAgentRunStatusMock = getAgentRunStatus as jest.MockedFunction<typeof getAgentRunStatus>;

describe('useChat approval handling', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('guards duplicate approval submissions before React state rerenders', async () => {
    let resolveDecision!: (value: { approvalId: string; decision: 'approved'; resolvedAt: string }) => void;
    const pendingDecision = new Promise<{ approvalId: string; decision: 'approved'; resolvedAt: string }>((resolve) => {
      resolveDecision = resolve;
    });
    resolveAgentApprovalMock.mockReturnValueOnce(pendingDecision);

    const approval: AgentApprovalItem = {
      approvalId: 'tc_1',
      runId: 'run-1',
      toolCallId: 'tc_1',
      toolName: 'grafana_alerting_manage_rules',
      risk: 'destructive',
      reason: 'Tool is destructive',
      arguments: '{}',
    };
    const initialMessage: ChatMessage = {
      role: 'assistant',
      content: '',
      approvals: [approval],
    };

    const { result } = renderHook(() => useChat({}, null, jest.fn(), { messages: [initialMessage] }));

    let firstSubmit!: Promise<void>;
    let secondSubmit!: Promise<void>;
    act(() => {
      firstSubmit = result.current.resolveApproval(approval, 'approved');
      secondSubmit = result.current.resolveApproval(approval, 'approved');
    });

    expect(resolveAgentApprovalMock).toHaveBeenCalledTimes(1);
    expect(resolveAgentApprovalMock).toHaveBeenCalledWith('run-1', 'tc_1', 'approved', undefined, '2', 'once');

    await act(async () => {
      resolveDecision({
        approvalId: 'tc_1',
        decision: 'approved',
        resolvedAt: '2026-05-29T12:00:00Z',
      });
      await firstSubmit;
      await secondSubmit;
    });

    expect(result.current.chatHistory[0].approvals?.[0].decision).toBe('approved');
  });

  it('passes approve-always scope to the approval API', async () => {
    resolveAgentApprovalMock.mockResolvedValueOnce({
      approvalId: 'tc_1',
      decision: 'approved',
      resolvedAt: '2026-05-29T12:00:00Z',
    });
    const approval: AgentApprovalItem = {
      approvalId: 'tc_1',
      runId: 'run-1',
      toolCallId: 'tc_1',
      toolName: 'grafana_alerting_manage_rules',
      risk: 'destructive',
      reason: 'Tool is destructive',
      arguments: '{}',
    };
    const { result } = renderHook(() =>
      useChat({}, null, jest.fn(), {
        messages: [{ role: 'assistant', content: '', approvals: [approval] }],
      })
    );

    await act(async () => {
      await result.current.resolveApproval(approval, 'approved', 'always');
    });

    expect(resolveAgentApprovalMock).toHaveBeenCalledWith('run-1', 'tc_1', 'approved', undefined, '2', 'always');
  });

  it('refreshes the run and clears stale approval cards after a resolved 409', async () => {
    resolveAgentApprovalMock.mockRejectedValueOnce(
      new Error('Failed to resolve approval (409): Approval is not pending')
    );
    getAgentRunStatusMock.mockResolvedValueOnce({
      runId: 'run-1',
      status: 'running',
      userId: 7,
      orgId: 2,
      createdAt: '2026-05-29T12:00:00Z',
      updatedAt: '2026-05-29T12:00:00Z',
      events: [],
      trace: {
        approvals: [
          {
            approvalId: 'tc_1',
            toolCallId: 'tc_1',
            toolName: 'grafana_alerting_manage_rules',
            risk: 'destructive',
            reason: 'Tool is destructive',
            arguments: '{}',
            decision: 'approved',
            resolvedAt: '2026-05-29T12:01:00Z',
          },
        ],
      },
    });

    const approval: AgentApprovalItem = {
      approvalId: 'tc_1',
      runId: 'run-1',
      toolCallId: 'tc_1',
      toolName: 'grafana_alerting_manage_rules',
      risk: 'destructive',
      reason: 'Tool is destructive',
      arguments: '{}',
    };
    const { result } = renderHook(() =>
      useChat({}, null, jest.fn(), {
        messages: [{ role: 'assistant', content: '', approvals: [approval] }],
      })
    );

    await act(async () => {
      await result.current.resolveApproval(approval, 'approved');
    });

    const updatedApproval = result.current.chatHistory[0].approvals?.[0];
    expect(getAgentRunStatusMock).toHaveBeenCalledWith('run-1', '2');
    expect(updatedApproval?.decision).toBe('approved');
    expect(updatedApproval?.error).toBeUndefined();
    expect(updatedApproval?.resolving).toBe(false);
  });
});

describe('useChat slash-command skills', () => {
  const runAgentDetachedMock = runAgentDetached as jest.MockedFunction<typeof runAgentDetached>;
  const reconnectToAgentRunMock = reconnectToAgentRun as jest.MockedFunction<typeof reconnectToAgentRun>;
  const skillNames = ['querying-profiles', 'building-dashboards'];

  const renderChatHook = () => renderHook(() => useChat({}, null, jest.fn(), undefined, false, undefined, undefined, 'auto', undefined, skillNames));

  beforeEach(() => {
    jest.clearAllMocks();
    runAgentDetachedMock.mockResolvedValue({ runId: 'run-s1', sessionId: 'sess-s1', status: 'running' });
    reconnectToAgentRunMock.mockImplementation(async () => {});
  });

  it('sends a slash command as skills and strips the command from the message', async () => {
    const { result } = renderChatHook();

    await act(async () => {
      await result.current.sendMessage('/querying-profiles find the hottest functions');
    });

    expect(runAgentDetachedMock).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'find the hottest functions', skills: ['querying-profiles'] })
    );
    const userMessage = result.current.chatHistory.find((m) => m.role === 'user');
    expect(userMessage?.content).toBe('find the hottest functions');
  });

  it('omits skills for a plain message', async () => {
    const { result } = renderChatHook();

    await act(async () => {
      await result.current.sendMessage('show me cpu usage');
    });

    const call = runAgentDetachedMock.mock.calls[0][0];
    expect(call.skills).toBeUndefined();
  });

  it('passes an unknown slash token through verbatim', async () => {
    const { result } = renderChatHook();

    await act(async () => {
      await result.current.sendMessage('/etc/hosts is failing');
    });

    expect(runAgentDetachedMock).toHaveBeenCalledWith(
      expect.objectContaining({ message: '/etc/hosts is failing', skills: undefined })
    );
  });

  it('rejects a bare skill command with no message', async () => {
    const { result } = renderChatHook();

    await act(async () => {
      await result.current.sendMessage('/querying-profiles');
    });

    expect(runAgentDetachedMock).not.toHaveBeenCalled();
    const last = result.current.chatHistory[result.current.chatHistory.length - 1];
    expect(last.content).toMatch(/Add a message after the skill command/);
  });

  it('does not resend the skill on a following message', async () => {
    const { result } = renderChatHook();

    await act(async () => {
      await result.current.sendMessage('/building-dashboards build me a dashboard');
    });
    await act(async () => {
      await result.current.sendMessage('add another panel');
    });

    expect(runAgentDetachedMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ message: 'add another panel', skills: undefined })
    );
  });

  it('attaches run_started skills to the assistant message as chips data', async () => {
    reconnectToAgentRunMock.mockImplementation(async (_runId, callbacks) => {
      callbacks.onRunStarted?.({
        runId: 'run-s1',
        skills: [{ name: 'investigating-alerts', description: 'Investigates firing alerts.' }],
      });
    });

    const { result } = renderChatHook();

    await act(async () => {
      await result.current.sendMessage('investigate this alert');
    });

    const last = result.current.chatHistory[result.current.chatHistory.length - 1];
    expect(last.role).toBe('assistant');
    expect(last.skills).toEqual([{ name: 'investigating-alerts', description: 'Investigates firing alerts.' }]);
  });

  it('adds a chip when the agent loads a skill mid-run via load_skill', async () => {
    reconnectToAgentRunMock.mockImplementation(async (_runId, callbacks) => {
      callbacks.onRunStarted?.({ runId: 'run-s1' });
      callbacks.onToolCallStart?.({
        id: 'call-1',
        name: 'load_skill',
        arguments: '{"skill":"writing-promql-and-logql"}',
      });
      callbacks.onToolCallResult?.({
        id: 'call-1',
        name: 'load_skill',
        content: 'SKILL INSTRUCTIONS',
        isError: false,
      });
    });

    const { result } = renderChatHook();

    await act(async () => {
      await result.current.sendMessage('how do I write logql');
    });

    const last = result.current.chatHistory[result.current.chatHistory.length - 1];
    expect(last.skills).toEqual([{ name: 'writing-promql-and-logql' }]);
    expect(last.toolCalls?.[0].name).toBe('load_skill');
  });
});

describe('useChat deep-link and retry skills', () => {
  const runAgentDetachedMock = runAgentDetached as jest.MockedFunction<typeof runAgentDetached>;
  const reconnectToAgentRunMock = reconnectToAgentRun as jest.MockedFunction<typeof reconnectToAgentRun>;

  beforeEach(() => {
    jest.clearAllMocks();
    runAgentDetachedMock.mockResolvedValue({ runId: 'run-d1', sessionId: 'sess-d1', status: 'running' });
    reconnectToAgentRunMock.mockImplementation(async () => {});
  });

  it('activates a ?skill= deep link without waiting for the skill catalog', async () => {
    // Regression: the deep-link auto-send can fire before listSkills()
    // resolves, so the skill must not depend on parseSlashSkill.
    const { result } = renderHook(() =>
      useChat({}, null, jest.fn(), undefined, false, undefined, undefined, 'auto', 'querying-profiles', [])
    );

    await act(async () => {
      await result.current.sendMessage('find the hottest functions');
    });

    expect(runAgentDetachedMock).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'find the hottest functions', skills: ['querying-profiles'] })
    );

    // One-shot: the next plain message carries no skill.
    await act(async () => {
      await result.current.sendMessage('another question');
    });
    expect(runAgentDetachedMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ message: 'another question', skills: undefined })
    );
  });

  it('retry reuses the original turn skill', async () => {
    runAgentDetachedMock.mockRejectedValueOnce(new Error('boom'));
    const { result } = renderHook(() =>
      useChat({}, null, jest.fn(), undefined, false, undefined, undefined, 'auto', undefined, ['querying-profiles'])
    );

    await act(async () => {
      await result.current.sendMessage('/querying-profiles find hot functions');
    });
    expect(runAgentDetachedMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      result.current.retryLastMessage();
    });

    // Regression: the retried request must keep the skill instead of
    // degrading to plain chat.
    expect(runAgentDetachedMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ message: 'find hot functions', skills: ['querying-profiles'] })
    );
  });
});
