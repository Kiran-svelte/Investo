import jwt from 'jsonwebtoken';
import { generateSecret, generateURI, generateSync, verifySync } from 'otplib';

import config from '../../config';
import prisma from '../../config/prisma';
import logger from '../../config/logger';
import { encryptMfaSecret, decryptMfaSecret } from '../../utils/mfaCrypto.util';
import { authService } from '../../services/auth.service';
import { getCompanyIdentityConfig } from '../identityConfig.service';

function prismaClient(): any {
  return prisma as any;
}

export interface MfaEnrollResult {
  device_id: string;
  otpauth_url: string;
  secret: string;
}

export interface MfaLoginGateResult {
  mfa_required: boolean;
  mfa_token?: string;
  tokens?: Awaited<ReturnType<typeof authService.login>>;
}

export class MfaService {
  isEnabled(): boolean {
    return config.features.mfa === true;
  }

  async enrollTotp(userId: string): Promise<MfaEnrollResult> {
    const secret = generateSecret();
    const user = await prismaClient().user.findUnique({ where: { id: userId } });
    if (!user) throw new Error('User not found');

    const device = await prismaClient().userMfaDevice.create({
      data: {
        userId,
        method: 'totp',
        secretEnc: encryptMfaSecret(secret),
        verified: false,
      },
    });

    const otpauthUrl = generateURI({
      issuer: 'Investo',
      label: user.email,
      secret,
    });

    return {
      device_id: device.id,
      otpauth_url: otpauthUrl,
      secret,
    };
  }

  async verifyTotpEnrollment(userId: string, deviceId: string, code: string): Promise<boolean> {
    const device = await prismaClient().userMfaDevice.findFirst({
      where: { id: deviceId, userId, method: 'totp' },
    });
    if (!device?.secretEnc) throw new Error('MFA device not found');

    const secret = decryptMfaSecret(device.secretEnc);
    const valid = verifySync({ secret, token: code }).valid;
    if (!valid) return false;

    await prismaClient().userMfaDevice.update({
      where: { id: deviceId },
      data: { verified: true },
    });

    await prismaClient().auditLog.create({
      data: {
        companyId: (await prismaClient().user.findUnique({ where: { id: userId } }))?.companyId,
        userId,
        action: 'mfa_enrolled',
        resourceType: 'user_mfa_device',
        resourceId: deviceId,
        details: { method: 'totp' },
      },
    });

    return true;
  }

  async verifyTotpLogin(userId: string, code: string): Promise<boolean> {
    const device = await prismaClient().userMfaDevice.findFirst({
      where: { userId, method: 'totp', verified: true },
      orderBy: { createdAt: 'desc' },
    });
    if (!device?.secretEnc) return false;

    const secret = decryptMfaSecret(device.secretEnc);
    return verifySync({ secret, token: code }).valid;
  }

  async evaluateLoginGate(user: { id: string; companyId: string; role: string; email: string }): Promise<MfaLoginGateResult> {
    if (!this.isEnabled() || user.role === 'super_admin') {
      const tokens = await authService.issueTokensForUser(user.id);
      return { mfa_required: false, tokens };
    }

    const identity = await getCompanyIdentityConfig(user.companyId);
    if (!identity.mfa_required) {
      const tokens = await authService.issueTokensForUser(user.id);
      return { mfa_required: false, tokens };
    }

    const verifiedDevice = await prismaClient().userMfaDevice.findFirst({
      where: { userId: user.id, verified: true },
    });

    if (!verifiedDevice) {
      const mfaToken = jwt.sign(
        { userId: user.id, purpose: 'mfa_enroll' },
        config.jwt.secret,
        { expiresIn: '15m' },
      );
      return { mfa_required: true, mfa_token: mfaToken };
    }

    const mfaToken = jwt.sign(
      { userId: user.id, purpose: 'mfa_verify' },
      config.jwt.secret,
      { expiresIn: '5m' },
    );
    return { mfa_required: true, mfa_token: mfaToken };
  }

  async completeMfaChallenge(mfaToken: string, code: string): Promise<Awaited<ReturnType<typeof authService.login>>> {
    let decoded: any;
    try {
      decoded = jwt.verify(mfaToken, config.jwt.secret);
    } catch {
      throw new Error('Invalid or expired MFA token');
    }

    if (!decoded?.userId || !['mfa_verify', 'mfa_enroll'].includes(decoded.purpose)) {
      throw new Error('Invalid MFA token purpose');
    }

    const ok = await this.verifyTotpLogin(decoded.userId, code);
    if (!ok) {
      throw new Error('Invalid MFA code');
    }

    logger.info('MFA challenge passed', { userId: decoded.userId });
    return authService.issueTokensForUser(decoded.userId);
  }

  decodeMfaToken(mfaToken: string): { userId: string; purpose: string } {
    const decoded = jwt.verify(mfaToken, config.jwt.secret) as { userId?: string; purpose?: string };
    if (!decoded.userId || !decoded.purpose) throw new Error('Invalid MFA token');
    return { userId: decoded.userId, purpose: decoded.purpose };
  }
}

export const mfaService = new MfaService();
