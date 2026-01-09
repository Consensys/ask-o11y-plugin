import { ChatMessage } from '../../components/Chat/types';

/**
 * Chat session domain model with validation and factory methods
 */
export class ChatSession {
  constructor(
    public readonly id: string,
    public title: string,
    public messages: ChatMessage[],
    public readonly createdAt: Date,
    public updatedAt: Date,
    public messageCount: number,
    public summary?: string
  ) {}

  /**
   * Factory method to create a new session
   */
  static create(messages: ChatMessage[], title?: string): ChatSession {
    const now = new Date();
    const sessionId = ChatSession.generateId();
    const sessionTitle = title || ChatSession.generateTitle(messages);

    return new ChatSession(sessionId, sessionTitle, messages, now, now, messages.length);
  }

  /**
   * Create from storage data (with date parsing)
   */
  static fromStorage(data: any): ChatSession {
    return new ChatSession(
      data.id,
      data.title,
      data.messages.map((msg: any) => ({
        ...msg,
        timestamp: new Date(msg.timestamp),
      })),
      new Date(data.createdAt),
      new Date(data.updatedAt),
      data.messageCount,
      data.summary
    );
  }

  /**
   * Convert to storage format
   */
  toStorage(): any {
    return {
      id: this.id,
      title: this.title,
      messages: this.messages,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      messageCount: this.messageCount,
      summary: this.summary,
    };
  }

  /**
   * Update messages and refresh metadata
   */
  updateMessages(messages: ChatMessage[], summary?: string): void {
    this.messages = messages;
    this.messageCount = messages.length;
    this.updatedAt = new Date();

    if (summary) {
      this.summary = summary;
    }

    // Update title if it's still default
    if (this.title === 'New Conversation' && messages.length > 0) {
      this.title = ChatSession.generateTitle(messages);
    }
  }

  /**
   * Get session metadata (without messages)
   */
  getMetadata(): SessionMetadata {
    return {
      id: this.id,
      title: this.title,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      messageCount: this.messageCount,
    };
  }

  /**
   * Generate unique session ID
   */
  private static generateId(): string {
    return `session-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * Generate title from first user message
   */
  private static generateTitle(messages: ChatMessage[]): string {
    const firstUserMessage = messages.find((msg) => msg.role === 'user');
    if (!firstUserMessage) {
      return 'New Conversation';
    }

    const content = firstUserMessage.content.trim();
    const maxLength = 60;
    return content.length > maxLength ? `${content.substring(0, maxLength)}...` : content;
  }
}

export interface SessionMetadata {
  id: string;
  title: string;
  createdAt: Date;
  updatedAt: Date;
  messageCount: number;
}
