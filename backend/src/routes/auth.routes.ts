import { Router, Request, Response } from 'express';
import { authService } from '../services/auth.service';
import { authenticate, AuthRequest } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { loginSchema } from '../models/validation';
import logger from '../config/logger';
import prisma from '../config/prisma';
import config from '../config';
import crypto from 'crypto';
import bcrypt from 'bcrypt';
import { normalizeAuthEmail } from '../services/auth.service';
import { emailService } from '../services/email.service';

const router = Router();

function isDatabaseConnectivityError(err: any): boolean {
  const message = String(err?.message || '').toLowerCase();
  const code = String(err?.code || '').toUpperCase();

  if (code === 'P1001' || code === 'P1017') {
    return true;
  }

  return (
    message.includes("can't reach database server") ||
    message.includes('server has closed the connection') ||
    message.includes('connection terminated') ||
    message.includes('connect timeout')
  );
}

/**
 * POST /api/auth/login
 * Login with email/password, returns JWT tokens.
 */
router.post('/login', validate(loginSchema), async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;
    const normalizedEmail = normalizeAuthEmail(email);
    const tokens = await authService.login(normalizedEmail, password);
    const user = await prisma.user.findFirst({
      where: { email: normalizedEmail, status: 'active' },
      select: { id: true, companyId: true, email: true, role: true, name: true, mustChangePassword: true },
    });
    if (!user) {
      res.status(401).json({ message: 'Invalid credentials' });
      return;
    }
    res.json({
      success: true,
      message: 'Login successful',
      data: {
        user: {
          id: user.id,
          company_id: user.companyId,
          email: user.email,
          role: user.role,
          name: user.name,
          must_change_password: user.mustChangePassword,
        },
        tokens: {
          access_token: tokens.accessToken,
          refresh_token: tokens.refreshToken,
        },
      },
    });
  } catch (err: any) {
    if (isDatabaseConnectivityError(err)) {
      logger.error('Login failed due to database connectivity', { error: err.message });
      res.status(503).json({ message: 'Authentication service temporarily unavailable. Please try again shortly.' });
      return;
    }

    // Don't reveal whether email exists
    res.status(401).json({ message: 'Invalid credentials' });
  }
});

/**
 * POST /api/auth/refresh
 * Refresh access token using refresh token.
 */
router.post('/refresh', async (req: Request, res: Response) => {
  try {
    const refreshToken = req.body.refresh_token || req.body.refreshToken;
    if (!refreshToken) {
      res.status(400).json({ message: 'Refresh token required' });
      return;
    }
    const tokens = await authService.refreshToken(refreshToken);
    res.json({
      success: true,
      message: 'Token refreshed',
      data: {
        access_token: tokens.accessToken,
        refresh_token: tokens.refreshToken,
      },
    });
  } catch (err: any) {
    res.status(401).json({ message: 'Invalid refresh token' });
  }
});

/**
 * POST /api/auth/logout
 * Revoke all refresh tokens for this user.
 */
router.post('/logout', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    await authService.logout(req.user!.id);
    res.json({ success: true, message: 'Logged out successfully' });
  } catch (err: any) {
    logger.error('Logout failed', { error: err.message });
    res.status(500).json({ message: 'Logout failed' });
  }
});

/**
 * GET /api/auth/me
 * Get current user profile.
 */
router.get('/me', authenticate, async (req: AuthRequest, res: Response) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user!.id },
    select: { id: true, companyId: true, email: true, role: true, name: true, mustChangePassword: true },
  });
  res.json({
    success: true,
    data: {
      id: user!.id,
      company_id: user!.companyId,
      email: user!.email,
      role: user!.role,
      name: user!.name,
      must_change_password: user!.mustChangePassword,
    },
  });
});

/**
 * POST /api/auth/change-password
 * Change password (required for users with mustChangePassword=true)
 */
router.post('/change-password', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { current_password, new_password } = req.body;
    
    if (!new_password || new_password.length < 8) {
      res.status(400).json({ message: 'New password must be at least 8 characters' });
      return;
    }

    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: { passwordHash: true, mustChangePassword: true },
    });

    if (!user) {
      res.status(404).json({ message: 'User not found' });
      return;
    }

    // Only verify current password if not a forced change
    if (!user.mustChangePassword) {
      if (!user.passwordHash) {
        res.status(401).json({ message: 'Current password is incorrect' });
        return;
      }
      const bcrypt = await import('bcrypt');
      const valid = await bcrypt.compare(current_password, user.passwordHash);
      if (!valid) {
        res.status(401).json({ message: 'Current password is incorrect' });
        return;
      }
    }

    const bcrypt = await import('bcrypt');
    const newHash = await bcrypt.hash(new_password, 12);

    await prisma.user.update({
      where: { id: req.user!.id },
      data: {
        passwordHash: newHash,
        mustChangePassword: false,
      },
    });

    logger.info('Password changed', { userId: req.user!.id });
    res.json({ success: true, message: 'Password changed successfully' });
  } catch (err: any) {
    logger.error('Change password failed', { error: err.message, userId: req.user?.id });
    res.status(500).json({ message: 'Failed to change password' });
  }
});

/**
 * POST /api/auth/forgot-password
 * Request password reset email
 */
router.post('/forgot-password', async (req: Request, res: Response) => {
  try {
    const { email } = req.body;

    if (!email) {
      res.status(400).json({ message: 'Email is required' });
      return;
    }

    const normalizedEmail = normalizeAuthEmail(email);

    // Find user (don't reveal if email exists)
    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
      select: { id: true, email: true, name: true, status: true },
    });

    // Always return success (don't reveal if email exists)
    if (!user || user.status !== 'active') {
      logger.info('Password reset requested for non-existent email', { email });
      res.json({ success: true, message: 'If an account exists with this email, you will receive a password reset link' });
      return;
    }

    // Generate reset token
    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = await bcrypt.hash(token, 10);
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    // Invalidate existing tokens
    await prisma.passwordResetToken.updateMany({
      where: { userId: user.id, used: false },
      data: { used: true },
    });

    // Create new token
    await prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt,
      },
    });

    const resetUrl = `${config.frontend.baseUrl}/reset-password?token=${token}&email=${encodeURIComponent(user.email)}`;
    logger.info('Password reset token generated', { userId: user.id });

    try {
      await emailService.sendPasswordResetEmail({
        toEmail: user.email,
        toName: user.name,
        resetUrl,
      });
    } catch (sendErr: any) {
      logger.error('Password reset email send failed', {
        userId: user.id,
        error: sendErr?.message || String(sendErr),
      });
    }

    // In development, include token in response for testing
    if (process.env.NODE_ENV === 'development') {
      res.json({
        success: true,
        message: 'Password reset link generated',
        data: { resetUrl, token }, // Only in dev!
      });
      return;
    }

    res.json({ success: true, message: 'If an account exists with this email, you will receive a password reset link' });
  } catch (err: any) {
    logger.error('Forgot password failed', { error: err.message });
    res.status(500).json({ message: 'Failed to process request' });
  }
});

/**
 * POST /api/auth/reset-password
 * Reset password using token
 */
router.post('/reset-password', async (req: Request, res: Response) => {
  try {
    const { token, email, new_password } = req.body;

    if (!token || !email || !new_password) {
      res.status(400).json({ message: 'Token, email, and new password are required' });
      return;
    }

    if (new_password.length < 8) {
      res.status(400).json({ message: 'Password must be at least 8 characters' });
      return;
    }

    const normalizedEmail = normalizeAuthEmail(email);

    // Find user
    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
      select: { id: true },
    });

    if (!user) {
      res.status(400).json({ message: 'Invalid or expired reset token' });
      return;
    }

    // Find valid token
    const resetTokens = await prisma.passwordResetToken.findMany({
      where: {
        userId: user.id,
        used: false,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
      take: 5, // Check last 5 tokens
    });

    let validToken = null;
    for (const rt of resetTokens) {
      const isValid = await bcrypt.compare(token, rt.tokenHash);
      if (isValid) {
        validToken = rt;
        break;
      }
    }

    if (!validToken) {
      res.status(400).json({ message: 'Invalid or expired reset token' });
      return;
    }

    // Update password
    const passwordHash = await bcrypt.hash(new_password, 12);
    await prisma.$transaction([
      prisma.user.update({
        where: { id: user.id },
        data: { passwordHash, mustChangePassword: false },
      }),
      prisma.passwordResetToken.update({
        where: { id: validToken.id },
        data: { used: true },
      }),
      // Revoke all refresh tokens (force re-login)
      prisma.refreshToken.updateMany({
        where: { userId: user.id },
        data: { revoked: true },
      }),
    ]);

    logger.info('Password reset completed', { userId: user.id });
    res.json({ success: true, message: 'Password has been reset successfully. Please login with your new password.' });
  } catch (err: any) {
    logger.error('Reset password failed', { error: err.message });
    res.status(500).json({ message: 'Failed to reset password' });
  }
});

export default router;
