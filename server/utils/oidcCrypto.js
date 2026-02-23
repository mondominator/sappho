const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';

function deriveKey(jwtSecret) {
  return crypto.createHash('sha256').update(jwtSecret).digest();
}

function encryptSecret(plaintext, jwtSecret) {
  const key = deriveKey(jwtSecret);
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  const payload = JSON.stringify({ iv: iv.toString('hex'), authTag, data: encrypted });
  return Buffer.from(payload).toString('base64');
}

function decryptSecret(encryptedBase64, jwtSecret) {
  const key = deriveKey(jwtSecret);
  const payload = JSON.parse(Buffer.from(encryptedBase64, 'base64').toString());
  const iv = Buffer.from(payload.iv, 'hex');
  const authTag = Buffer.from(payload.authTag, 'hex');
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(payload.data, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

module.exports = { encryptSecret, decryptSecret };
