/// <reference types="jest" />

type MockLogger = {
  info: jest.Mock;
  warn: jest.Mock;
  error: jest.Mock;
  debug: jest.Mock;
};

describe('EmailService (SMTP)', () => {
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
  });

  test('sends password reset email via nodemailer when SMTP is configured', async () => {
    restoreEnv();
    process.env.NODE_ENV = 'production';
    process.env.MAIL_FROM = 'Investo <no-reply@investo.ai>';
    process.env.SMTP_HOST = 'smtp.example.com';
    process.env.SMTP_PORT = '587';
    process.env.SMTP_SECURE = 'false';
    process.env.SMTP_USER = 'smtp-user';
    process.env.SMTP_PASS = 'smtp-pass';

    const mockLogger: MockLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    };

    const sendMail = jest.fn().mockResolvedValue(undefined);
    const createTransport = jest.fn().mockReturnValue({ sendMail });

    jest.doMock('nodemailer', () => ({
      __esModule: true,
      default: { createTransport },
    }));

    jest.doMock('../../config/logger', () => ({
      __esModule: true,
      default: mockLogger,
    }));

    let emailService: any;
    jest.isolateModules(() => {
      emailService = require('../../services/email.service').emailService;
    });

    await emailService.sendPasswordResetEmail({
      toEmail: 'user@example.com',
      toName: 'User',
      resetUrl: 'https://app.investo.ai/reset-password?token=abc&email=user%40example.com',
    });

    expect(createTransport).toHaveBeenCalledTimes(1);
    expect(createTransport).toHaveBeenCalledWith({
      host: 'smtp.example.com',
      port: 587,
      secure: false,
      auth: { user: 'smtp-user', pass: 'smtp-pass' },
    });

    expect(sendMail).toHaveBeenCalledTimes(1);
    const mailArgs = sendMail.mock.calls[0]?.[0];
    expect(mailArgs.from).toBe('Investo <no-reply@investo.ai>');
    expect(mailArgs.to).toBe('user@example.com');
    expect(typeof mailArgs.subject).toBe('string');
    expect(typeof mailArgs.text).toBe('string');
    expect(typeof mailArgs.html).toBe('string');

    expect(mockLogger.info).toHaveBeenCalledWith('Password reset email sent', expect.any(Object));
  });

  test('skips sending when SMTP is not configured', async () => {
    restoreEnv();
    process.env.NODE_ENV = 'production';
    process.env.MAIL_FROM = 'Investo <no-reply@investo.ai>';
    delete process.env.SMTP_HOST;

    const mockLogger: MockLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    };

    const createTransport = jest.fn();

    jest.doMock('nodemailer', () => ({
      __esModule: true,
      default: { createTransport },
    }));

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
      })
    ).resolves.toBeUndefined();

    expect(createTransport).not.toHaveBeenCalled();
    expect(mockLogger.warn).toHaveBeenCalledWith(
      'Password reset email skipped: SMTP not configured',
      expect.any(Object)
    );
  });
});
