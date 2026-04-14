export interface ProvisionIdentityInput {
    email: string;
    password: string;
    name: string;
}
export interface ProvisionIdentityResult {
    providerUserId: string | null;
}
export declare function provisionNeonIdentity(input: ProvisionIdentityInput): Promise<ProvisionIdentityResult>;
//# sourceMappingURL=identityProvisioning.service.d.ts.map