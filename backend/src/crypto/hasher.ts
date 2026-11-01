import crypto from 'node:crypto';

/**
 * Computes SHA-256 hex digest for integrity fingerprinting.
 * Note: A fingerprint provides tamper-evident integrity verification,
 * not proof of caller identity or authorization by itself.
 */
export function sha256Hex(data: string): string {
  return crypto.createHash('sha256').update(data, 'utf8').digest('hex');
}
