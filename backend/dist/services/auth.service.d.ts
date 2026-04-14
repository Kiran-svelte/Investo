export declare const normalizeAuthEmail: (email: string) => string;
export interface TokenPair {
    accessToken: string;
    refreshToken: string;
    expiresIn: string;
}
export declare class AuthService {
    /**
     * Register a new user (used by super admin to create first company admin,
     * or by company admin to create agents).
     */
    register(data: {
        name: string;
        email: string;
        password: string;
        phone?: string | null;
        role: string;
        company_id: string;
        custom_role_id?: string | null;
        must_change_password?: boolean;
    }): Promise<{
        id: string;
        email: string;
        role: string;
    }>;
    /**
     * Login with email and password. Returns JWT token pair.
     */
    login(email: string, password: string): Promise<TokenPair>;
    /**
     * Refresh access token using refresh token.
     * Implements token rotation: old refresh token is revoked, new one issued.
     */
    refreshToken(refreshToken: string): Promise<TokenPair>;
    /**
     * Logout: revoke all refresh tokens for user.
     */
    logout(userId: string): Promise<void>;
    private generateTokens;
}
export declare const authService: AuthService;
//# sourceMappingURL=auth.service.d.ts.map