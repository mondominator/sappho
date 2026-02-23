const { encryptSecret, decryptSecret } = require('../../server/utils/oidcCrypto');

describe('OIDC Crypto', () => {
  const jwtSecret = 'a'.repeat(32);

  test('encrypts and decrypts a secret round-trip', () => {
    const original = 'my-super-secret-client-secret';
    const encrypted = encryptSecret(original, jwtSecret);
    expect(encrypted).not.toBe(original);
    const decrypted = decryptSecret(encrypted, jwtSecret);
    expect(decrypted).toBe(original);
  });

  test('encrypted output contains iv and authTag', () => {
    const encrypted = encryptSecret('test', jwtSecret);
    const parsed = JSON.parse(Buffer.from(encrypted, 'base64').toString());
    expect(parsed).toHaveProperty('iv');
    expect(parsed).toHaveProperty('authTag');
    expect(parsed).toHaveProperty('data');
  });

  test('different encryptions of same value produce different output', () => {
    const a = encryptSecret('same', jwtSecret);
    const b = encryptSecret('same', jwtSecret);
    expect(a).not.toBe(b);
  });

  test('decryption with wrong key fails', () => {
    const encrypted = encryptSecret('secret', jwtSecret);
    const wrongKey = 'b'.repeat(32);
    expect(() => decryptSecret(encrypted, wrongKey)).toThrow();
  });
});
