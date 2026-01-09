import React from 'react';

import { ChatMessage } from '../ChatMessage/ChatMessage';
import { ChatMessage as ChatMessageType } from '../../types';

interface ChatHistoryProps {
  chatHistory: ChatMessageType[];
  isGenerating: boolean;
}

export const ChatHistory: React.FC<ChatHistoryProps> = ({ chatHistory, isGenerating }) => (
  <div>
    {chatHistory.map((message, index) => (
      <ChatMessage
        key={index}
        message={message}
        isGenerating={isGenerating}
        isLastMessage={index === chatHistory.length - 1}
      />
    ))}
  </div>
);
