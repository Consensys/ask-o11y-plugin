import React from 'react';

import { ChatMessage } from '../ChatMessage/ChatMessage';
import { AgentApprovalItem, ChatMessage as ChatMessageType } from '../../types';

interface ChatHistoryProps {
  chatHistory: ChatMessageType[];
  isGenerating: boolean;
  onResolveApproval?: (approval: AgentApprovalItem, decision: 'approved' | 'rejected') => Promise<void>;
}

export const ChatHistory: React.FC<ChatHistoryProps> = ({ chatHistory, isGenerating, onResolveApproval }) => (
  <div>
    {chatHistory.map((message, index) => (
      <ChatMessage
        key={index}
        message={message}
        isGenerating={isGenerating}
        isLastMessage={index === chatHistory.length - 1}
        onResolveApproval={onResolveApproval}
      />
    ))}
  </div>
);
