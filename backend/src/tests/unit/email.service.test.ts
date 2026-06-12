/// <reference types="jest" />

type MockLogger = {
  info: jest.Mock;
  warn: jest.Mock;
  error: jest.Mock;
  debug: jest.Mock;
};

const mockSend = jest.fn();

jest.mock('resend', () => ({
  Resend: jest.fn().mockImplementation(() => ({
    emails: { send: mockSend },
  })),
}));

describe('EmailService (Resend)', () => {
  const ORIGINAL_ENV = { ...process.env };

  function restoreEnv(): void {
    for (const key of Object.keys(process.env)) {
      if (!(key in ORIGINAL_ENV)) {
        delete process.env[key];
      }
    }

    for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }

  afterEach(() => {
    restoreEnv();
    jest.resetModules();
    jest.clearAllMocks();
    mockSend.mockReset();
  });

  test('sends password reset email via Resend when configured', async () => {
    restoreEnv();
    process.env.NODE_ENV = 'production';
    process.env.MAIL_FROM = 'Investo <no-reply@investo.ai>';
    process.env.RESEND_API_KEY = 're_test_key';

    mockSend.mockResolvedValue({ data: { id: 'msg_123' }, error: null });

    const mockLogger: MockLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    };

    jest.doMock('../../config/logger', () => ({
      __esModule: true,
      default: mockLogger,
    }));

    let emailService: any;
    jest.isolateModules(() => {
      emailService = require('../../services/email.service').emailService;
    });

    const result = await emailService.sendPasswordResetEmail({
      toEmail: 'user@example.com',
      toName: 'User',
      resetUrl: 'https://app.investo.ai/reset-password?token=abc&email=user%40example.com',
    });

    expect(result).toEqual({ sent: true, messageId: 'msg_123' });
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'Investo <no-reply@investo.ai>',
        to: 'user@example.com',
        subject: 'Reset your Investo password',
      }),
    );
    expect(mockLogger.info).toHaveBeenCalledWith('Password reset email sent', expect.any(Object));
  });

  test('skips sending when Resend is not configured', async () => {
    restoreEnv();
    process.env.NODE_ENV = 'production';
    process.env.MAIL_FROM = 'Investo <no-reply@investo.ai>';
    delete process.env.RESEND_API_KEY;

    const mockLogger: MockLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    };

    jest.doMock('../../config/logger', () => ({
      __esModule: true,
      default: mockLogger,
    }));

    let emailService: any;
    jest.isolateModules(() => {
      emailService = require('../../services/email.service').emailService;
    });

    await expect(
      emailService.sendPasswordResetEmail({
        toEmail: 'user@example.com',
        toName: null,
        resetUrl: 'https://app.investo.ai/reset-password?token=abc&email=user%40example.com',
      }),
    ).resolves.toEqual({ sent: false, reason: 'mail_not_configured' });

    expect(mockSend).not.toHaveBeenCalled();
    expect(mockLogger.warn).toHaveBeenCalledWith(
      'Password reset email skipped: mail not configured',
      expect.any(Object),
    );
  });
});
