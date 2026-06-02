"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.provisionNeonIdentity = provisionNeonIdentity;
const config_1 = __importDefault(require("../config"));
const logger_1 = __importDefault(require("../config/logger"));
const isDuplicateIdentityError = (status, payload) => {
    const message = String(payload?.message || '').toLowerCase();
    const code = String(payload?.code || '').toLowerCase();
    return status === 409 || message.includes('already exists') || code.includes('already');
};
const parseJson = async (response) => {
    try {
        return (await response.json());
    }
    catch {
        return null;
    }
};
async function provisionNeonIdentity(input) {
    const authUrl = config_1.default.neonAuth.url;
    if (!authUrl) {
        throw new Error('NEON_AUTH_URL is required for Neon identity provisioning');
    }
    const callbackURL = `${config_1.default.frontend.baseUrl}/login`;
    const signUpResp = await fetch(`${authUrl}/sign-up/email`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Origin: config_1.default.frontend.baseUrl,
        },
        body: JSON.stringify({
            email: input.email,
            password: input.password,
            name: input.name,
            callbackURL,
        }),
    });
    const signUpPayload = (await parseJson(signUpResp)) || {};
    if (signUpResp.ok) {
        return {
            providerUserId: signUpPayload.user?.id || null,
        };
    }
    // If user already exists in Neon Auth, sign in to fetch stable provider user id.
    if (isDuplicateIdentityError(signUpResp.status, signUpPayload)) {
        const signInResp = await fetch(`${authUrl}/sign-in/email`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Origin: config_1.default.frontend.baseUrl,
            },
            body: JSON.stringify({
                email: input.email,
                password: input.password,
                callbackURL,
            }),
        });
        const signInPayload = (await parseJson(signInResp)) || {};
        if (signInResp.ok) {
            return {
                providerUserId: signInPayload.user?.id || null,
            };
        }
        logger_1.default.warn('Neon identity exists but sign-in failed during provisioning', {
            email: input.email,
            status: signInResp.status,
            code: signInPayload.code,
            message: signInPayload.message,
        });
        throw new Error('Neon identity exists with a different password. Reset password or use another email.');
    }
    logger_1.default.error('Neon identity provisioning failed', {
        email: input.email,
        status: signUpResp.status,
        code: signUpPayload.code,
        message: signUpPayload.message,
    });
    throw new Error(signUpPayload.message || 'Failed to create identity in Neon Auth');
}
