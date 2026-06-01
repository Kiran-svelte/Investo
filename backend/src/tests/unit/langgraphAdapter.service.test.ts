/// <reference types="jest" />

jest.mock('../../config', () => ({
  __esModule: true,
  default: {
    langgraph: {
      enabled: false,
      url: 'http://localhost:8000',
      mode: 'augment',
      timeoutMs: 5000,
    },
  },
}));

jest.mock('../../config/logger', () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

import config from '../../config';
import { sendToLangGraph } from '../../services/langgraphAdapter.service';

describe('langgraphAdapter.service', () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    (global as any).fetch = fetchMock;
    (config as any).langgraph.enabled = false;
    (config as any).langgraph.url = 'http://localhost:8000';
    (config as any).langgraph.timeoutMs = 5000;
  });

  test('returns skipped when disabled', async () => {
    const res = await sendToLangGraph({
      event: 'onmessage',
      session: 'test-session',
      body: 'hello',
      type: 'chat',
      isNewMsg: true,
      sender: { id: '123@s.whatsapp.net', isUser: true },
      isGroupMsg: false,
    });

    expect(res).toEqual({ skipped: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('posts payload and returns response when enabled', async () => {
    (config as any).langgraph.enabled = true;
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ status: 'aggregating' }),
    });

    const payload = {
      event: 'onmessage',
      session: 'test-session',
      body: 'hello world',
      type: 'chat',
      isNewMsg: true,
      sender: { id: '123@s.whatsapp.net', isUser: true },
      isGroupMsg: false,
    };

    const res = await sendToLangGraph(payload);

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:8000/webhook',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
      }),
    );
    expect(res).toEqual({ skipped: false, ok: true, data: { status: 'aggregating' } });
  });
});
