/// <reference types="jest" />

jest.mock('axios', () => ({
  __esModule: true,
  default: {
    post: jest.fn(),
  },
}));

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

import axios from 'axios';
import config from '../../config';
import { sendToLangGraph } from '../../services/langgraphAdapter.service';

describe('langgraphAdapter.service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
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
    expect((axios as any).post).not.toHaveBeenCalled();
  });

  test('posts payload and returns response when enabled', async () => {
    (config as any).langgraph.enabled = true;
    (axios as any).post.mockResolvedValue({ status: 200, data: { status: 'aggregating' } });

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

    expect((axios as any).post).toHaveBeenCalledWith(
      'http://localhost:8000/webhook',
      payload,
      expect.objectContaining({ timeout: 5000 }),
    );
    expect(res).toEqual({ skipped: false, ok: true, data: { status: 'aggregating' } });
  });
});
