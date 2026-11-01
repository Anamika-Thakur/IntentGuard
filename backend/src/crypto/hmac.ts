import crypto from 'node:crypto';
import { config } from '../config/index.js';
import { AppError } from '../errors/index.js';

export interface AuthorizationPayload {
  authId: string;
  intentId: string;
  policyVersion: number;
  userId: string;
  checkoutId: string;
  policyFingerprint: string;
  expiresAt: string; // ISO String
}

export class HmacKeyManager {
  private static keys: Map<string, string> = new Map([
    [config.AUTH_ACTIVE_KEY_ID, config.AUTH_HMAC_SECRET_KEY_V1],
  ]);

  public static registerKey(keyId: string, secretHex: string): void {
    if (secretHex.length < 32) {
      throw AppError.badRequest('HMAC key must have at least 32 characters of entropy.');
    }
    this.keys.set(keyId, secretHex);
  }

  public static getKey(keyId: string): string | undefined {
    return this.keys.get(keyId);
  }

  public static getActiveKeyId(): string {
    return config.AUTH_ACTIVE_KEY_ID;
  }
}

export class AuthorizationTokenService {
  /**
   * Generates a tamper-evident server-bound HMAC-SHA-256 authorization token.
   */
  public static generateToken(
    payload: AuthorizationPayload,
    keyId: string = HmacKeyManager.getActiveKeyId()
  ): string {
    const secret = HmacKeyManager.getKey(keyId);
    if (!secret) {
      throw AppError.internal(`Active HMAC key '${keyId}' not found in key store.`);
    }

    const payloadJson = JSON.stringify(payload);
    const payloadBase64 = Buffer.from(payloadJson, 'utf8').toString('base64url');

    const hmac = crypto
      .createHmac('sha256', secret)
      .update(`${keyId}.${payloadBase64}`)
      .digest('hex');

    return `${keyId}.${payloadBase64}.${hmac}`;
  }

  /**
   * Verifies an authorization token against expected checkout and policy constraints.
   * Performs constant-time timingSafeEqual comparison.
   */
  public static verifyToken(
    token: string,
    expected: {
      intentId: string;
      policyVersion: number;
      userId: string;
      checkoutId: string;
      policyFingerprint: string;
      currentTime?: Date;
    }
  ): { valid: boolean; payload?: AuthorizationPayload; errorReason?: string } {
    if (!token || typeof token !== 'string') {
      return { valid: false, errorReason: 'MISSING_OR_MALFORMED_TOKEN' };
    }

    const parts = token.split('.');
    if (parts.length !== 3) {
      return { valid: false, errorReason: 'MALFORMED_TOKEN_STRUCTURE' };
    }

    const [keyId, payloadBase64, providedHmac] = parts as [string, string, string];

    const secret = HmacKeyManager.getKey(keyId);
    if (!secret) {
      return { valid: false, errorReason: 'UNKNOWN_KEY_IDENTIFIER' };
    }

    // Compute expected HMAC
    const expectedHmac = crypto
      .createHmac('sha256', secret)
      .update(`${keyId}.${payloadBase64}`)
      .digest('hex');

    // Constant-time comparison
    const providedBuffer = Buffer.from(providedHmac, 'utf8');
    const expectedBuffer = Buffer.from(expectedHmac, 'utf8');

    if (
      providedBuffer.length !== expectedBuffer.length ||
      !crypto.timingSafeEqual(providedBuffer, expectedBuffer)
    ) {
      return { valid: false, errorReason: 'INVALID_SIGNATURE_OR_TAMPERED_TOKEN' };
    }

    // Parse and validate payload
    let payload: AuthorizationPayload;
    try {
      const decodedJson = Buffer.from(payloadBase64, 'base64url').toString('utf8');
      payload = JSON.parse(decodedJson) as AuthorizationPayload;
    } catch {
      return { valid: false, errorReason: 'INVALID_PAYLOAD_JSON' };
    }

    // Verify context bindings
    if (payload.intentId !== expected.intentId) {
      return { valid: false, errorReason: 'INTENT_ID_MISMATCH' };
    }
    if (payload.policyVersion !== expected.policyVersion) {
      return { valid: false, errorReason: 'POLICY_VERSION_MISMATCH' };
    }
    if (payload.userId !== expected.userId) {
      return { valid: false, errorReason: 'USER_ID_MISMATCH' };
    }
    if (payload.checkoutId !== expected.checkoutId) {
      return { valid: false, errorReason: 'CHECKOUT_ID_MISMATCH' };
    }
    if (payload.policyFingerprint !== expected.policyFingerprint) {
      return { valid: false, errorReason: 'POLICY_FINGERPRINT_MISMATCH' };
    }

    // Verify expiry
    const now = expected.currentTime || new Date();
    const expiresAt = new Date(payload.expiresAt);
    if (now.getTime() >= expiresAt.getTime()) {
      return { valid: false, errorReason: 'AUTHORIZATION_EXPIRED' };
    }

    return { valid: true, payload };
  }
}
