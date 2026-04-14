export declare function isNeonDatabaseUrl(databaseUrl: string): boolean;
export declare function isPostgresDatabaseUrl(databaseUrl: string): boolean;
export declare function isNeonPoolerDatabaseUrl(databaseUrl: string): boolean;
export declare function resolveDatabaseUrl(): string;
export declare function isAllowedCorsOrigin(origin?: string | null): boolean;
export declare function assertValidDatabaseUrl(databaseUrl: string): void;
type WhatsAppProvider = 'meta' | 'greenapi';
declare const config: {
    env: string;
    port: number;
    neonAuth: {
        url: string;
    };
    frontend: {
        baseUrl: string;
    };
    mail: {
        from: string;
        smtp: {
            host: string;
            port: number;
            secure: boolean;
            user: string;
            pass: string;
        };
    };
    db: {
        url: string;
        poolMin: number;
        poolMax: number;
        neonPoolerConfigured: boolean;
        keepAliveEnabled: boolean;
        keepAliveIntervalMs: number;
        autoMigrate: boolean;
        autoSeed: boolean;
    };
    redis: {
        url: string;
        token: string;
    };
    jwt: {
        secret: string;
        expiresIn: string;
        refreshSecret: string;
        refreshExpiresIn: string;
    };
    whatsapp: {
        provider: WhatsAppProvider;
        allowGreenapiInProd: boolean;
        apiUrl: string;
        verifyToken: string;
        appSecret: string;
        accessToken: string;
        phoneNumberId: string;
        ipWhitelistEnabled: boolean;
        skipIpWhitelist: boolean;
        webhookMaxSize: string;
        dedupTtlSeconds: number;
    };
    greenapi: {
        apiUrl: string;
        idInstance: string;
        apiTokenInstance: string;
        webhookUrlToken: string;
    };
    ai: {
        provider: string;
        kimiApiBaseUrl: string;
        kimiApiKey: string;
        kimi25Model: string;
        claudeApiKey: string;
        claudeModel: string;
        openaiApiKey: string;
        openaiModel: string;
    };
    storage: {
        provider: string;
        r2Endpoint: string;
        r2AccountId: string;
        r2AccessKeyId: string;
        r2SecretAccessKey: string;
        r2Bucket: string;
        r2PublicBaseUrl: string;
        r2Region: string;
        propertyUploadMaxBytes: number;
        allowedMimeTypes: string[];
    };
    geocoding: {
        provider: string;
        googleApiKey: string;
        nominatimUserAgent: string;
        cacheEnabled: boolean;
        cacheTtlSeconds: number;
    };
    cors: {
        origins: string[];
    };
    rateLimit: {
        perUser: number;
        perCompany: number;
    };
};
export default config;
//# sourceMappingURL=index.d.ts.map