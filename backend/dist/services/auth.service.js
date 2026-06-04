"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.authService = exports.AuthService = exports.normalizeAuthEmail = void 0;
const bcrypt_1 = __importDefault(require("bcrypt"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const uuid_1 = require("uuid");
const prisma_1 = __importDefault(require("../config/prisma"));
const config_1 = __importDefault(require("../config"));
const logger_1 = __importDefault(require("../config/logger"));
const identityProvisioning_service_1 = require("./identityProvisioning.service");
const staffPhoneUniqueness_1 = require("../utils/staffPhoneUniqueness");
const BCRYPT_ROUNDS = 12;
const normalizeAuthEmail = (email) => email.trim().toLowerCase();
exports.normalizeAuthEmail = normalizeAuthEmail;
class AuthService {
    /**
     * Register a new user (used by super admin to create first company admin,
     * or by company admin to create agents).
     */
    async register(data) {
        const normalizedEmail = (0, exports.normalizeAuthEmail)(data.email);
        // Check email uniqueness
        const existing = await prisma_1.default.user.findUnique({ where: { email: normalizedEmail } });
        if (existing) {
            throw new Error('Email already registered');
        }
        const passwordHash = await bcrypt_1.default.hash(data.password, BCRYPT_ROUNDS);
        // Optionally provision Neon Auth identity (not required for local auth)
        try {
            await (0, identityProvisioning_service_1.provisionNeonIdentity)({
                email: normalizedEmail,
                password: data.password,
                name: data.name,
            });
            logger_1.default.info('Neon identity provisioned', { email: normalizedEmail });
        }
        catch (err) {
            // Neon Auth is optional - log but continue with local auth
            logger_1.default.warn('Neon identity provisioning skipped', {
                email: normalizedEmail,
                reason: err.message,
            });
        }
        const id = (0, uuid_1.v4)();
        const normalizedPhone = data.phone
            ? await (0, staffPhoneUniqueness_1.assertStaffPhoneAvailable)(data.phone)
            : null;
        await prisma_1.default.user.create({
            data: {
                id,
                companyId: data.company_id,
                name: data.name,
                email: normalizedEmail,
                phone: normalizedPhone,
                passwordHash,
                role: data.role,
                customRoleId: data.custom_role_id || null,
                mustChangePassword: data.must_change_password === true,
                status: 'active',
            },
        });
        logger_1.default.info('User registered', { userId: id, role: data.role });
        return { id, email: normalizedEmail, role: data.role };
    }
    /**
     * Login with email and password. Returns JWT token pair.
     */
    async login(email, password) {
        const normalizedEmail = (0, exports.normalizeAuthEmail)(email);
        const user = await prisma_1.default.user.findFirst({
            where: { email: normalizedEmail, status: 'active' },
        });
        if (!user) {
            throw new Error('Invalid credentials');
        }
        if (!user.passwordHash) {
            throw new Error('Invalid credentials');
        }
        const valid = await bcrypt_1.default.compare(password, user.passwordHash);
        if (!valid) {
            throw new Error('Invalid credentials');
        }
        // Check company is active (unless super_admin)
        if (user.role !== 'super_admin') {
            const company = await prisma_1.default.company.findFirst({
                where: { id: user.companyId, status: 'active' },
            });
            if (!company) {
                throw new Error('Company is inactive');
            }
        }
        // Update last login
        await prisma_1.default.user.update({
            where: { id: user.id },
            data: { lastLogin: new Date() },
        });
        const tokens = await this.generateTokens(user);
        logger_1.default.info('User logged in', { userId: user.id });
        return tokens;
    }
    /**
     * Refresh access token using refresh token.
     * Implements token rotation: old refresh token is revoked, new one issued.
     */
    async refreshToken(refreshToken) {
        let decoded;
        try {
            decoded = jsonwebtoken_1.default.verify(refreshToken, config_1.default.jwt.refreshSecret);
        }
        catch {
            throw new Error('Invalid refresh token');
        }
        if (!decoded || decoded.type !== 'refresh' || !decoded.userId) {
            throw new Error('Invalid refresh token');
        }
        // Verify the presented token matches one active stored hash for this user.
        const storedTokens = await prisma_1.default.refreshToken.findMany({
            where: {
                userId: decoded.userId,
                revoked: false,
                expiresAt: { gt: new Date() },
            },
            orderBy: { createdAt: 'desc' },
        });
        let storedToken = null;
        for (const candidate of storedTokens) {
            const matches = await bcrypt_1.default.compare(refreshToken, candidate.tokenHash);
            if (matches) {
                storedToken = candidate;
                break;
            }
        }
        if (!storedToken) {
            throw new Error('Refresh token not found or revoked');
        }
        // Revoke old refresh token (rotation)
        await prisma_1.default.refreshToken.update({
            where: { id: storedToken.id },
            data: { revoked: true },
        });
        // Get user
        const user = await prisma_1.default.user.findFirst({
            where: { id: decoded.userId, status: 'active' },
        });
        if (!user) {
            throw new Error('User not found');
        }
        const tokens = await this.generateTokens(user);
        logger_1.default.info('Token refreshed', { userId: user.id });
        return tokens;
    }
    /**
     * Logout: revoke all refresh tokens for user.
     */
    async logout(userId) {
        await prisma_1.default.refreshToken.updateMany({
            where: { userId },
            data: { revoked: true },
        });
        logger_1.default.info('User logged out', { userId });
    }
    /**
     * Logout current session only (single refresh token). Other devices/tabs stay signed in.
     */
    async logoutSession(refreshToken) {
        let decoded;
        try {
            decoded = jsonwebtoken_1.default.verify(refreshToken, config_1.default.jwt.refreshSecret);
        }
        catch {
            return;
        }
        if (!decoded?.userId)
            return;
        const storedTokens = await prisma_1.default.refreshToken.findMany({
            where: {
                userId: decoded.userId,
                revoked: false,
                expiresAt: { gt: new Date() },
            },
        });
        for (const candidate of storedTokens) {
            const matches = await bcrypt_1.default.compare(refreshToken, candidate.tokenHash);
            if (matches) {
                await prisma_1.default.refreshToken.update({
                    where: { id: candidate.id },
                    data: { revoked: true },
                });
                logger_1.default.info('Session logged out', { userId: decoded.userId });
                return;
            }
        }
    }
    async generateTokens(user) {
        const accessToken = jsonwebtoken_1.default.sign({
            userId: user.id,
            companyId: user.companyId,
            email: user.email,
            role: user.role,
            name: user.name,
        }, config_1.default.jwt.secret, { expiresIn: config_1.default.jwt.expiresIn });
        const refreshToken = jsonwebtoken_1.default.sign({ userId: user.id, type: 'refresh' }, config_1.default.jwt.refreshSecret, { expiresIn: config_1.default.jwt.refreshExpiresIn });
        // Store refresh token hash
        const tokenHash = await bcrypt_1.default.hash(refreshToken, 4);
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + 7);
        await prisma_1.default.refreshToken.create({
            data: {
                userId: user.id,
                tokenHash,
                expiresAt,
            },
        });
        return {
            accessToken,
            refreshToken,
            expiresIn: config_1.default.jwt.expiresIn,
        };
    }
}
exports.AuthService = AuthService;
exports.authService = new AuthService();
