"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_service_1 = require("../services/auth.service");
const auth_1 = require("../middleware/auth");
const validate_1 = require("../middleware/validate");
const validation_1 = require("../models/validation");
const userProfilePhone_1 = require("../utils/userProfilePhone");
const staffPhoneUniqueness_1 = require("../utils/staffPhoneUniqueness");
const logger_1 = __importDefault(require("../config/logger"));
const prisma_1 = __importDefault(require("../config/prisma"));
const config_1 = __importDefault(require("../config"));
const selfServiceSignup_service_1 = require("../services/selfServiceSignup.service");
const crypto_1 = __importDefault(require("crypto"));
const bcrypt_1 = __importDefault(require("bcrypt"));
const auth_service_2 = require("../services/auth.service");
const email_service_1 = require("../services/email.service");
const router = (0, express_1.Router)();
/**
 * GET /api/auth/signup-enabled
 * Public flag for the signup page.
 */
router.get('/signup-enabled', (_req, res) => {
    res.json({
        data: {
            enabled: config_1.default.selfService.signupEnabled,
        },
    });
});
/**
 * POST /api/auth/signup
 * Self-service agency registration (company + company_admin).
 */
router.post('/signup', (0, validate_1.validate)(validation_1.selfServiceSignupSchema), async (req, res) => {
    if (!config_1.default.selfService.signupEnabled) {
        res.status(403).json({ message: 'Self-service signup is not enabled on this environment' });
        return;
    }
    try {
        const { company_name, admin_name, email, password, whatsapp_phone } = req.body;
        const result = await (0, selfServiceSignup_service_1.registerSelfServiceTenant)({
            companyName: company_name,
            adminName: admin_name,
            email,
            password,
            whatsappPhone: whatsapp_phone,
        });
        const tokens = await auth_service_1.authService.login((0, auth_service_2.normalizeAuthEmail)(email), password);
        const user = await prisma_1.default.user.findFirst({
            where: { email: (0, auth_service_2.normalizeAuthEmail)(email), status: 'active' },
            select: { id: true, companyId: true, email: true, role: true, name: true, mustChangePassword: true },
        });
        res.status(201).json({
            success: true,
            message: 'Account created successfully',
            data: {
                company: { id: result.companyId, slug: result.slug },
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
    }
    catch (err) {
        const message = String(err?.message || '');
        if (message === 'Email already registered') {
            res.status(409).json({ message });
            return;
        }
        if (message.includes('WhatsApp number already in use') || message.includes('E.164')) {
            res.status(400).json({ message });
            return;
        }
        if (isDatabaseConnectivityError(err)) {
            res.status(503).json({ message: 'Registration temporarily unavailable. Please try again shortly.' });
            return;
        }
        logger_1.default.error('Self-service signup failed', { error: message });
        res.status(500).json({ message: 'Failed to create account' });
    }
});
function isDatabaseConnectivityError(err) {
    const message = String(err?.message || '').toLowerCase();
    const code = String(err?.code || '').toUpperCase();
    if (code === 'P1001' || code === 'P1017') {
        return true;
    }
    return (message.includes("can't reach database server") ||
        message.includes('server has closed the connection') ||
        message.includes('connection terminated') ||
        message.includes('connect timeout'));
}
/**
 * POST /api/auth/login
 * Login with email/password, returns JWT tokens.
 */
router.post('/login', (0, validate_1.validate)(validation_1.loginSchema), async (req, res) => {
    try {
        const { email, password } = req.body;
        const normalizedEmail = (0, auth_service_2.normalizeAuthEmail)(email);
        const tokens = await auth_service_1.authService.login(normalizedEmail, password);
        const user = await prisma_1.default.user.findFirst({
            where: { email: normalizedEmail, status: 'active' },
            select: {
                id: true,
                companyId: true,
                email: true,
                role: true,
                name: true,
                phone: true,
                mustChangePassword: true,
            },
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
                    phone: user.phone,
                    profile_complete: (0, userProfilePhone_1.isStaffProfilePhoneComplete)(user.phone),
                    must_change_password: user.mustChangePassword,
                },
                tokens: {
                    access_token: tokens.accessToken,
                    refresh_token: tokens.refreshToken,
                },
            },
        });
    }
    catch (err) {
        if (isDatabaseConnectivityError(err)) {
            logger_1.default.error('Login failed due to database connectivity', { error: err.message });
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
router.post('/refresh', async (req, res) => {
    try {
        const refreshToken = req.body.refresh_token || req.body.refreshToken;
        if (!refreshToken) {
            res.status(400).json({ message: 'Refresh token required' });
            return;
        }
        const tokens = await auth_service_1.authService.refreshToken(refreshToken);
        res.json({
            success: true,
            message: 'Token refreshed',
            data: {
                access_token: tokens.accessToken,
                refresh_token: tokens.refreshToken,
            },
        });
    }
    catch (err) {
        res.status(401).json({ message: 'Invalid refresh token' });
    }
});
/**
 * POST /api/auth/logout
 * Revoke all refresh tokens for this user.
 */
router.post('/logout', auth_1.authenticate, async (req, res) => {
    try {
        const refreshToken = req.body.refresh_token || req.body.refreshToken;
        if (typeof refreshToken === 'string' && refreshToken.trim()) {
            await auth_service_1.authService.logoutSession(refreshToken.trim());
        }
        else {
            await auth_service_1.authService.logout(req.user.id);
        }
        res.json({ success: true, message: 'Logged out successfully' });
    }
    catch (err) {
        logger_1.default.error('Logout failed', { error: err.message });
        res.status(500).json({ message: 'Logout failed' });
    }
});
/**
 * GET /api/auth/me
 * Get current user profile.
 */
function serializeAuthUser(user) {
    return {
        id: user.id,
        company_id: user.companyId,
        email: user.email,
        role: user.role,
        name: user.name,
        phone: user.phone,
        profile_complete: (0, userProfilePhone_1.isStaffProfilePhoneComplete)(user.phone),
        must_change_password: user.mustChangePassword,
    };
}
router.get('/me', auth_1.authenticate, async (req, res) => {
    const user = await prisma_1.default.user.findUnique({
        where: { id: req.user.id },
        select: {
            id: true,
            companyId: true,
            email: true,
            role: true,
            name: true,
            phone: true,
            mustChangePassword: true,
        },
    });
    if (!user) {
        res.status(404).json({ message: 'User not found' });
        return;
    }
    res.json({
        success: true,
        data: serializeAuthUser(user),
    });
});
/**
 * PUT /api/auth/profile
 * All roles: save name + required WhatsApp phone (enables agent copilot routing).
 */
router.put('/profile', auth_1.authenticate, (0, validate_1.validate)(validation_1.updateStaffProfileSchema), async (req, res) => {
    try {
        const { name, phone } = req.body;
        let normalized;
        try {
            normalized = await (0, staffPhoneUniqueness_1.assertStaffPhoneAvailable)(phone, req.user.id);
        }
        catch (err) {
            if ((0, staffPhoneUniqueness_1.isStaffPhoneInUseError)(err)) {
                res.status(409).json({ message: err.message });
                return;
            }
            throw err;
        }
        if (!normalized) {
            res.status(400).json({ message: 'Enter a valid Indian mobile number (10 digits)' });
            return;
        }
        const updated = await prisma_1.default.user.update({
            where: { id: req.user.id },
            data: {
                phone: normalized,
                ...(name ? { name } : {}),
            },
            select: {
                id: true,
                companyId: true,
                email: true,
                role: true,
                name: true,
                phone: true,
                mustChangePassword: true,
            },
        });
        res.json({
            success: true,
            message: 'Profile updated',
            data: serializeAuthUser(updated),
        });
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger_1.default.error('Profile update failed', { error: message });
        res.status(500).json({ message: 'Failed to update profile' });
    }
});
/**
 * POST /api/auth/change-password
 * Change password (required for users with mustChangePassword=true)
 */
router.post('/change-password', auth_1.authenticate, async (req, res) => {
    try {
        const { current_password, new_password } = req.body;
        if (!new_password || new_password.length < 8) {
            res.status(400).json({ message: 'New password must be at least 8 characters' });
            return;
        }
        const user = await prisma_1.default.user.findUnique({
            where: { id: req.user.id },
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
            const bcrypt = await Promise.resolve().then(() => __importStar(require('bcrypt')));
            const valid = await bcrypt.compare(current_password, user.passwordHash);
            if (!valid) {
                res.status(401).json({ message: 'Current password is incorrect' });
                return;
            }
        }
        const bcrypt = await Promise.resolve().then(() => __importStar(require('bcrypt')));
        const newHash = await bcrypt.hash(new_password, 12);
        await prisma_1.default.user.update({
            where: { id: req.user.id },
            data: {
                passwordHash: newHash,
                mustChangePassword: false,
            },
        });
        logger_1.default.info('Password changed', { userId: req.user.id });
        res.json({ success: true, message: 'Password changed successfully' });
    }
    catch (err) {
        logger_1.default.error('Change password failed', { error: err.message, userId: req.user?.id });
        res.status(500).json({ message: 'Failed to change password' });
    }
});
/**
 * POST /api/auth/forgot-password
 * Request password reset email
 */
router.post('/forgot-password', async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) {
            res.status(400).json({ message: 'Email is required' });
            return;
        }
        const normalizedEmail = (0, auth_service_2.normalizeAuthEmail)(email);
        // Find user (don't reveal if email exists)
        const user = await prisma_1.default.user.findUnique({
            where: { email: normalizedEmail },
            select: { id: true, email: true, name: true, status: true },
        });
        // Always return success (don't reveal if email exists)
        if (!user || user.status !== 'active') {
            logger_1.default.info('Password reset requested for non-existent email', { email });
            res.json({ success: true, message: 'If an account exists with this email, you will receive a password reset link' });
            return;
        }
        // Generate reset token
        const token = crypto_1.default.randomBytes(32).toString('hex');
        const tokenHash = await bcrypt_1.default.hash(token, 10);
        const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
        // Invalidate existing tokens
        await prisma_1.default.passwordResetToken.updateMany({
            where: { userId: user.id, used: false },
            data: { used: true },
        });
        // Create new token
        await prisma_1.default.passwordResetToken.create({
            data: {
                userId: user.id,
                tokenHash,
                expiresAt,
            },
        });
        const resetUrl = `${config_1.default.frontend.baseUrl}/reset-password?token=${token}&email=${encodeURIComponent(user.email)}`;
        logger_1.default.info('Password reset token generated', { userId: user.id });
        try {
            const mailResult = await email_service_1.emailService.sendPasswordResetEmail({
                toEmail: user.email,
                toName: user.name,
                resetUrl,
            });
            if (!mailResult.sent) {
                logger_1.default.error('Password reset email not sent', {
                    userId: user.id,
                    reason: mailResult.reason,
                });
            }
        }
        catch (sendErr) {
            logger_1.default.error('Password reset email send failed', {
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
    }
    catch (err) {
        logger_1.default.error('Forgot password failed', { error: err.message });
        res.status(500).json({ message: 'Failed to process request' });
    }
});
/**
 * POST /api/auth/reset-password
 * Reset password using token
 */
router.post('/reset-password', async (req, res) => {
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
        const normalizedEmail = (0, auth_service_2.normalizeAuthEmail)(email);
        // Find user
        const user = await prisma_1.default.user.findUnique({
            where: { email: normalizedEmail },
            select: { id: true },
        });
        if (!user) {
            res.status(400).json({ message: 'Invalid or expired reset token' });
            return;
        }
        // Find valid token
        const resetTokens = await prisma_1.default.passwordResetToken.findMany({
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
            const isValid = await bcrypt_1.default.compare(token, rt.tokenHash);
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
        const passwordHash = await bcrypt_1.default.hash(new_password, 12);
        await prisma_1.default.$transaction([
            prisma_1.default.user.update({
                where: { id: user.id },
                data: { passwordHash, mustChangePassword: false },
            }),
            prisma_1.default.passwordResetToken.update({
                where: { id: validToken.id },
                data: { used: true },
            }),
            // Revoke all refresh tokens (force re-login)
            prisma_1.default.refreshToken.updateMany({
                where: { userId: user.id },
                data: { revoked: true },
            }),
        ]);
        logger_1.default.info('Password reset completed', { userId: user.id });
        res.json({ success: true, message: 'Password has been reset successfully. Please login with your new password.' });
    }
    catch (err) {
        logger_1.default.error('Reset password failed', { error: err.message });
        res.status(500).json({ message: 'Failed to reset password' });
    }
});
exports.default = router;
