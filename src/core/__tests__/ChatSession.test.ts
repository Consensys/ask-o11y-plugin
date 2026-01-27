import { ChatSession } from '../models/ChatSession';
import { ChatMessage } from '../../components/Chat/types';

describe('ChatSession', () => {
  describe('create', () => {
    it('should create a new session with provided messages', () => {
      const messages: ChatMessage[] = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there!' },
      ];

      const session = ChatSession.create(messages);

      expect(session.id).toMatch(/^session-\d+-[a-z0-9]+$/);
      expect(session.messages).toEqual(messages);
      expect(session.messageCount).toBe(2);
      expect(session.createdAt).toBeInstanceOf(Date);
      expect(session.updatedAt).toBeInstanceOf(Date);
    });

    it('should use provided title', () => {
      const messages: ChatMessage[] = [{ role: 'user', content: 'Test message' }];
      const title = 'Custom Title';

      const session = ChatSession.create(messages, title);

      expect(session.title).toBe('Custom Title');
    });

    it('should generate title from first user message', () => {
      const messages: ChatMessage[] = [
        { role: 'user', content: 'How do I query Prometheus metrics?' },
        { role: 'assistant', content: 'You can use PromQL...' },
      ];

      const session = ChatSession.create(messages);

      expect(session.title).toBe('How do I query Prometheus metrics?');
    });

    it('should truncate long titles', () => {
      const longMessage = 'a'.repeat(100);
      const messages: ChatMessage[] = [{ role: 'user', content: longMessage }];

      const session = ChatSession.create(messages);

      expect(session.title.length).toBeLessThanOrEqual(63); // 60 + "..."
      expect(session.title.endsWith('...')).toBe(true);
    });

    it('should use default title when no user message', () => {
      const messages: ChatMessage[] = [{ role: 'assistant', content: 'Welcome!' }];

      const session = ChatSession.create(messages);

      expect(session.title).toBe('New Conversation');
    });

    it('should handle empty messages array', () => {
      const session = ChatSession.create([]);

      expect(session.messageCount).toBe(0);
      expect(session.title).toBe('New Conversation');
    });
  });

  describe('fromStorage', () => {
    it('should restore session from storage data', () => {
      const storageData = {
        id: 'session-123',
        title: 'Test Session',
        messages: [
          { role: 'user' as const, content: 'Hello', timestamp: '2024-01-01T00:00:00Z' },
        ],
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-02T00:00:00Z',
        messageCount: 1,
        summary: 'Test summary',
      };

      const session = ChatSession.fromStorage(storageData);

      expect(session.id).toBe('session-123');
      expect(session.title).toBe('Test Session');
      expect(session.messageCount).toBe(1);
      expect(session.createdAt).toBeInstanceOf(Date);
      expect(session.updatedAt).toBeInstanceOf(Date);
      expect(session.summary).toBe('Test summary');
    });

    it('should parse message timestamps', () => {
      const storageData = {
        id: 'session-123',
        title: 'Test',
        messages: [
          { role: 'user' as const, content: 'Test', timestamp: '2024-06-15T10:30:00Z' },
        ],
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
        messageCount: 1,
      };

      const session = ChatSession.fromStorage(storageData);

      expect(session.messages[0].timestamp).toBeInstanceOf(Date);
    });
  });

  describe('toStorage', () => {
    it('should convert session to storage format', () => {
      const messages: ChatMessage[] = [{ role: 'user', content: 'Hello' }];
      const session = ChatSession.create(messages, 'Test');
      session.summary = 'Test summary';

      const storage = session.toStorage();

      expect(storage).toHaveProperty('id');
      expect(storage).toHaveProperty('title', 'Test');
      expect(storage).toHaveProperty('messages');
      expect(storage).toHaveProperty('createdAt');
      expect(storage).toHaveProperty('updatedAt');
      expect(storage).toHaveProperty('messageCount', 1);
      expect(storage).toHaveProperty('summary', 'Test summary');
    });
  });

  describe('updateMessages', () => {
    it('should update messages and metadata', () => {
      const session = ChatSession.create([{ role: 'user', content: 'Initial' }]);
      const originalUpdatedAt = session.updatedAt;

      // Wait a bit to ensure timestamp difference
      const newMessages: ChatMessage[] = [
        { role: 'user', content: 'Updated message 1' },
        { role: 'assistant', content: 'Updated message 2' },
      ];

      session.updateMessages(newMessages);

      expect(session.messages).toEqual(newMessages);
      expect(session.messageCount).toBe(2);
      expect(session.updatedAt.getTime()).toBeGreaterThanOrEqual(originalUpdatedAt.getTime());
    });

    it('should update summary when provided', () => {
      const session = ChatSession.create([{ role: 'user', content: 'Test' }]);

      session.updateMessages([{ role: 'user', content: 'New' }], 'New summary');

      expect(session.summary).toBe('New summary');
    });

    it('should not update summary when not provided', () => {
      const session = ChatSession.create([{ role: 'user', content: 'Test' }]);
      session.summary = 'Original summary';

      session.updateMessages([{ role: 'user', content: 'New' }]);

      expect(session.summary).toBe('Original summary');
    });

    it('should update title from default when messages change', () => {
      const session = ChatSession.create([], 'New Conversation');

      session.updateMessages([{ role: 'user', content: 'My first question' }]);

      expect(session.title).toBe('My first question');
    });

    it('should not change custom title', () => {
      const session = ChatSession.create([], 'My Custom Title');

      session.updateMessages([{ role: 'user', content: 'Some message' }]);

      expect(session.title).toBe('My Custom Title');
    });
  });

  describe('getMetadata', () => {
    it('should return session metadata without messages', () => {
      const messages: ChatMessage[] = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi!' },
      ];
      const session = ChatSession.create(messages, 'Test Session');

      const metadata = session.getMetadata();

      expect(metadata.id).toBe(session.id);
      expect(metadata.title).toBe('Test Session');
      expect(metadata.createdAt).toBe(session.createdAt);
      expect(metadata.updatedAt).toBe(session.updatedAt);
      expect(metadata.messageCount).toBe(2);
      expect((metadata as any).messages).toBeUndefined();
    });
  });
});

