import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import prisma from '../config/prisma';
import config from '../config';
import logger from '../config/logger';
import { provisionNeonIdentity } from './identityProvisioning.service';

const BCRYPT_ROUNDS = 12;

export const normalizeAuthEmail = (email: string): string => email.trim().toLowerCase();

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: string;
}

export class AuthService {
  /**
   * Register a new user (used by super admin to create first company admin,
   * or by company admin to create agents).
   */
  async register(data: {
    name: string;
    email: string;
    password: string;
    phone?: string | null;
    role: string;
    company_id: string;
    custom_role_id?: string | null;
    must_change_password?: boolean;
  }): Promise<{ id: string; email: string; role: string }> {
    const normalizedEmail = normalizeAuthEmail(data.email);

    // Check email uniqueness
    const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (existing) {
      throw new Error('Email already registered');
    }

    const passwordHash = await bcrypt.hash(data.password, BCRYPT_ROUNDS);
    
    // Optionally provision Neon Auth identity (not required for local auth)
    try {
      await provisionNeonIdentity({
        email: normalizedEmail,
        password: data.password,
        name: data.name,
      });
      logger.info('Neon identity provisioned', { email: normalizedEmail });
    } catch (err: any) {
      // Neon Auth is optional - log but continue with local auth
      logger.warn('Neon identity provisioning skipped', {
        email: normalizedEmail,
        reason: err.message,
      });
    }

    const id = uuidv4();

    await prisma.user.create({
      data: {
        id,
        companyId: data.company_id,
        name: data.name,
        email: normalizedEmail,
        phone: data.phone || null,
        passwordHash,
        role: data.role as any,
        customRoleId: data.custom_role_id || null,
        mustChangePassword: data.must_change_password === true,
        status: 'active',
      },
    });

    logger.info('User registered', { userId: id, role: data.role });

    return { id, email: normalizedEmail, role: data.role };
  }

  /**
   * Login with email and password. Returns JWT token pair.
   */
  async login(email: string, password: string): Promise<TokenPair> {
    const normalizedEmail = normalizeAuthEmail(email);
    const user = await prisma.user.findFirst({
      where: { email: normalizedEmail, status: 'active' },
    });

    if (!user) {
      throw new Error('Invalid credentials');
    }

    if (!user.passwordHash) {
      throw new Error('Invalid credentials');
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      throw new Error('Invalid credentials');
    }

    // Check company is active (unless super_admin)
    if (user.role !== 'super_admin') {
      const company = await prisma.company.findFirst({
        where: { id: user.companyId, status: 'active' },
      });
      if (!company) {
        throw new Error('Company is inactive');
      }
    }

    // Update last login
    await prisma.user.update({
      where: { id: user.id },
      data: { lastLogin: new Date() },
    });

    const tokens = await this.generateTokens(user);

    logger.info('User logged in', { userId: user.id });
    return tokens;
  }

  /**
   * Refresh access token using refresh token.
   * Implements token rotation: old refresh token is revoked, new one issued.
   */
  async refreshToken(refreshToken: string): Promise<TokenPair> {
    let decoded: any;
    try {
      decoded = jwt.verify(refreshToken, config.jwt.refreshSecret);
    } catch {
      throw new Error('Invalid refresh token');
    }

    if (!decoded || decoded.type !== 'refresh' || !decoded.userId) {
      throw new Error('Invalid refresh token');
    }

    // Verify the presented token matches one active stored hash for this user.
    const storedTokens = await prisma.refreshToken.findMany({
      where: {
        userId: decoded.userId,
        revoked: false,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });

    let storedToken: { id: string; tokenHash: string } | null = null;
    for (const candidate of storedTokens) {
      const matches = await bcrypt.compare(refreshToken, candidate.tokenHash);
      if (matches) {
        storedToken = candidate;
        break;
      }
    }

    if (!storedToken) {
      throw new Error('Refresh token not found or revoked');
    }

    // Revoke old refresh token (rotation)
    await prisma.refreshToken.update({
      where: { id: storedToken.id },
      data: { revoked: true },
    });

    // Get user
    const user = await prisma.user.findFirst({
      where: { id: decoded.userId, status: 'active' },
    });
    if (!user) {
      throw new Error('User not found');
    }

    const tokens = await this.generateTokens(user);
    logger.info('Token refreshed', { userId: user.id });
    return tokens;
  }

  /**
   * Logout: revoke all refresh tokens for user.
   */
  async logout(userId: string): Promise<void> {
    await prisma.refreshToken.updateMany({
      where: { userId },
      data: { revoked: true },
    });
    logger.info('User logged out', { userId });
  }

  private async generateTokens(user: any): Promise<TokenPair> {
    const accessToken = jwt.sign(
      {
        userId: user.id,
        companyId: user.companyId,
        email: user.email,
        role: user.role,
        name: user.name,
      },
      config.jwt.secret,
      { expiresIn: config.jwt.expiresIn as any }
    );

    const refreshToken = jwt.sign(
      { userId: user.id, type: 'refresh' },
      config.jwt.refreshSecret,
      { expiresIn: config.jwt.refreshExpiresIn as any }
    );

    // Store refresh token hash
    const tokenHash = await bcrypt.hash(refreshToken, 4);
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    await prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt,
      },
    });

    return {
      accessToken,
      refreshToken,
      expiresIn: config.jwt.expiresIn,
    };
  }
}

export const authService = new AuthService();
