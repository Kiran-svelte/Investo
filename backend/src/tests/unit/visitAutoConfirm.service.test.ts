jest.mock('../../config/prisma', () => ({
  __esModule: true,
  default: {
    aiSetting: {
      findUnique: jest.fn(),
    },
  },
}));

import prisma from '../../config/prisma';
import { isVisitAutoConfirmEnabled } from '../../services/visitAutoConfirm.service';

describe('visitAutoConfirm.service', () => {
  const originalEnv = process.env.WHATSAPP_AUTO_CONFIRM_VISITS;

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.WHATSAPP_AUTO_CONFIRM_VISITS;
  });

  afterAll(() => {
    if (originalEnv === undefined) {
      delete process.env.WHATSAPP_AUTO_CONFIRM_VISITS;
    } else {
      process.env.WHATSAPP_AUTO_CONFIRM_VISITS = originalEnv;
    }
  });

  it('defaults to false when no company setting or env opt-in is present', async () => {
    (prisma.aiSetting.findUnique as jest.Mock).mockResolvedValue(null);

    await expect(isVisitAutoConfirmEnabled('company-1')).resolves.toBe(false);
  });

  it('honors explicit company false over env opt-in', async () => {
    process.env.WHATSAPP_AUTO_CONFIRM_VISITS = 'true';
    (prisma.aiSetting.findUnique as jest.Mock).mockResolvedValue({ autoConfirmVisits: false });

    await expect(isVisitAutoConfirmEnabled('company-1')).resolves.toBe(false);
  });
});
