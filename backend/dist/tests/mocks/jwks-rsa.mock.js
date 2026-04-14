"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = jwksClient;
function jwksClient() {
    return {
        getSigningKey: (_kid, callback) => {
            callback(null, {
                getPublicKey: () => 'test-public-key',
            });
        },
    };
}
//# sourceMappingURL=jwks-rsa.mock.js.map