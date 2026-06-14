/// <reference types="jest" />

jest.mock('../../config', () => ({
  __esModule: true,
  default: {
    whatsapp: { apiUrl: 'https://graph.test/v18.0' },
  },
}));

import {
  isTypingDuringProcessingEnabled,
  startTypingDuringProcessing,
} from '../../services/whatsappPresence.service';

describe('whatsappPresence typing session', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.useRealTimers();
  });

  test('isTypingDuringProcessingEnabled defaults true', () => {
    expect(isTypingDuringProcessingEnabled()).toBe(true);
  });

  test('startTypingDuringProcessing sends typing immediately and on refresh', async () => {
    jest.useFakeTimers();
    const calls: unknown[] = [];
    global.fetch = jest.fn(async (_url, init) => {
      calls.push(JSON.parse(String((init as RequestInit).body)));
      return { ok: true } as Response;
    }) as typeof fetch;

    const session = startTypingDuringProcessing('919876543210', {
      phoneNumberId: '123',
      accessToken: 'token',
    }, 'wamid.inbound.1');

    await Promise.resolve();
    expect(calls.length).toBe(1);
    expect(calls[0]).toMatchObject({
      status: 'read',
      message_id: 'wamid.inbound.1',
      typing_indicator: { type: 'text' },
    });

    jest.advanceTimersByTime(20_000);
    await Promise.resolve();
    expect(calls.length).toBe(2);

    session.stop();
    jest.advanceTimersByTime(20_000);
    await Promise.resolve();
    expect(calls.length).toBe(2);
  });
});
