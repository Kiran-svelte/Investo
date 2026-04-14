type SigningKeyCallback = (err: Error | null, key?: {
    getPublicKey: () => string;
}) => void;
type JwksClient = {
    getSigningKey: (kid: string, callback: SigningKeyCallback) => void;
};
export default function jwksClient(): JwksClient;
export {};
//# sourceMappingURL=jwks-rsa.mock.d.ts.map