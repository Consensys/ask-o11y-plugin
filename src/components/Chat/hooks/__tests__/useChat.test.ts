import { act } from 'react';
import { renderHook } from '@testing-library/react';
import { useChat } from '../useChat';
import { resolveAgentApproval, getAgentRunStatus } from '../../../../services/agentClient';
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

  it('refreshes the run and clears stale approval cards after a resolved 409', async () => {
    resolveAgentApprovalMock.mockRejectedValueOnce(new Error('Failed to resolve approval (409): Approval is not pending'));
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
