type SigningKeyCallback = (err: Error | null, key?: { getPublicKey: () => string }) => void;

type JwksClient = {
  getSigningKey: (kid: string, callback: SigningKeyCallback) => void;
};

export default function jwksClient(): JwksClient {
  return {
    getSigningKey: (_kid: string, callback: SigningKeyCallback) => {
      callback(null, {
        getPublicKey: () => 'test-public-key',
      });
    },
  };
}
