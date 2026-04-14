export interface PropertyUploadUrlInput {
    companyId: string;
    fileName: string;
    mimeType: string;
    fileSize: number;
    propertyId?: string | null;
    assetType?: 'image' | 'brochure';
}
export interface PropertyUploadUrlResult {
    key: string;
    uploadUrl: string;
    publicUrl: string;
    expiresInSeconds: number;
    contentType: string;
}
export interface UploadedObjectVerification {
    exists: boolean;
    contentType?: string;
    contentLength?: number;
    eTag?: string;
}
declare function ensureR2Config(options?: {
    requirePublicBaseUrl?: boolean;
}): void;
declare class StorageService {
    private client;
    private getClient;
    private validateAssetRequest;
    createPropertyUploadUrl(input: PropertyUploadUrlInput): Promise<PropertyUploadUrlResult>;
    getPublicUrl(key: string): string;
    getObjectBuffer(key: string): Promise<Buffer>;
    verifyUploadedObject(key: string, expected: {
        mimeType?: string;
        fileSize?: number;
    }): Promise<UploadedObjectVerification>;
}
export declare const storageService: StorageService;
export { ensureR2Config };
//# sourceMappingURL=storage.service.d.ts.map