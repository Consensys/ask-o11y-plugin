import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import SharedSession from './SharedSession';
import { sessionShareService } from '../services/sessionShare';
import { createSession } from '../services/backendSessionClient';

jest.mock('../components/Chat', () => ({
  Chat: ({ initialSession }: { initialSession?: { messages?: Array<{ content: string }> } }) => (
    <div data-testid="chat-mock">{initialSession?.messages?.map((message) => message.content).join(' | ')}</div>
  ),
}));

jest.mock('../services/sessionShare', () => ({
  sessionShareService: {
    getSharedSession: jest.fn(),
  },
}));

jest.mock('../services/backendSessionClient', () => ({
  createSession: jest.fn(),
}));

const mockGetSharedSession = sessionShareService.getSharedSession as jest.MockedFunction<typeof sessionShareService.getSharedSession>;
const mockCreateSession = createSession as jest.MockedFunction<typeof createSession>;

const sharedSessionFixture = {
  id: 'shared-session-1',
  title: 'Shared Session Title',
  messages: [
    { role: 'user' as const, content: 'How is CPU usage?', timestamp: new Date('2026-01-01T00:00:00.000Z') },
    { role: 'assistant' as const, content: 'CPU is stable.', timestamp: new Date('2026-01-01T00:00:01.000Z') },
  ],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:01.000Z',
  isShared: true as const,
};

function renderSharedSessionPage(pathname = '/shared/share-abc'): void {
  render(
    <MemoryRouter initialEntries={[pathname]}>
      <Routes>
        <Route path="/shared/:shareId" element={<SharedSession />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('SharedSession', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetSharedSession.mockResolvedValue(sharedSessionFixture);
    mockCreateSession.mockResolvedValue({
      id: 'session-1',
      title: 'Imported Session',
      messages: [],
      createdAt: '2026-01-01T00:00:02.000Z',
      updatedAt: '2026-01-01T00:00:02.000Z',
      messageCount: 0,
    });
  });

  it('keeps the shared session visible when import fails', async () => {
    mockCreateSession.mockRejectedValue(new Error('Import failed'));

    renderSharedSessionPage();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Import as New Session' })).toBeInTheDocument();
    });

    expect(screen.getByTestId('chat-mock')).toBeInTheDocument();
    expect(screen.getByTestId('chat-mock')).toHaveTextContent('How is CPU usage?');

    fireEvent.click(screen.getByRole('button', { name: 'Import as New Session' }));

    await waitFor(() => {
      expect(screen.getByText('Failed to import session. Please try again.')).toBeInTheDocument();
    });

    expect(screen.getByTestId('chat-mock')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Go to Home' })).not.toBeInTheDocument();

    const retryButton = screen.getByRole('button', { name: 'Import as New Session' });
    expect(retryButton).toBeEnabled();

    fireEvent.click(retryButton);

    await waitFor(() => {
      expect(mockCreateSession).toHaveBeenCalledTimes(2);
    });
  });

  it('shows fallback error page when initial shared session load fails', async () => {
    mockGetSharedSession.mockRejectedValue(new Error('not found'));

    renderSharedSessionPage();

    await waitFor(() => {
      expect(screen.getByText('This share link is not found or has expired.')).toBeInTheDocument();
    });

    expect(screen.getByRole('button', { name: 'Go to Home' })).toBeInTheDocument();
    expect(screen.queryByTestId('chat-mock')).not.toBeInTheDocument();
  });
});
