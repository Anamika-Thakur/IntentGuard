import { v4 as uuidv4 } from 'uuid';
import { getDbClient, IDatabaseClient } from '../db/client.js';
import { AppError } from '../errors/index.js';
import { canonicalizePolicy } from './canonical.js';
import { sha256Hex } from './hasher.js';
import { AuthorizationTokenService, HmacKeyManager } from './hmac.js';
import { logger } from '../logger/index.js';

export interface ApprovalResult {
  intentId: string;
  policyVersion: number;
  checkoutId: string;
  authorizationToken: string;
  policyFingerprint: string;
  expiresAt: string;
}

export class ApprovalService {
  constructor(private db: IDatabaseClient = getDbClient()) {}

  /**
   * Performs deliberate, authenticated user approval of a purchasing intent.
   * Promotes state from DRAFT to APPROVED, establishes canonical policy fingerprint,
   * and creates a server-bound single-use authorization record.
   */
  async approveIntent(params: {
    intentId: string;
    userId: string;
    checkoutId: string;
    correlationId?: string | undefined;
  }): Promise<ApprovalResult> {
    const { intentId, userId, checkoutId } = params;

    // Load intent
    const intentRes = await this.db.query(
      `SELECT * FROM intents WHERE id = $1`,
      [intentId]
    );

    if (intentRes.rowCount === 0) {
      throw AppError.notFound(`Intent '${intentId}' not found.`);
    }

    const intent = intentRes.rows[0];
    if (!intent) {
      throw AppError.notFound(`Intent '${intentId}' not found.`);
    }

    if (intent.user_id !== userId) {
      throw AppError.forbidden('Cannot approve an intent belonging to another user.');
    }

    if (intent.status !== 'DRAFT') {
      throw AppError.conflict(
        `Intent '${intentId}' cannot be approved because it is in '${intent.status}' state.`
      );
    }

    // Load policy
    const policyRes = await this.db.query(
      `SELECT * FROM intent_policies WHERE intent_id = $1 AND version = $2`,
      [intentId, intent.version]
    );

    if (policyRes.rowCount === 0) {
      throw AppError.badRequest(`No policy found for intent '${intentId}' at version ${intent.version}.`);
    }

    const policy = policyRes.rows[0];
    if (!policy) {
      throw AppError.badRequest(`No policy found for intent '${intentId}' at version ${intent.version}.`);
    }

    // Canonicalize policy and compute cryptographic SHA-256 fingerprint
    const canonicalStr = canonicalizePolicy({
      intentId: policy.intent_id,
      version: policy.version,
      merchantId: policy.merchant_id,
      allowedSku: policy.allowed_sku,
      maxQuantity: policy.max_quantity,
      maxTotalCents: policy.max_total_cents,
      currency: policy.currency,
      allowedConditions: policy.allowed_conditions,
    });

    const policyFingerprint = sha256Hex(canonicalStr);

    // Expiry: 1 hour from approval or intent expiry, whichever is earlier
    const now = new Date();
    const oneHourLater = new Date(now.getTime() + 60 * 60 * 1000);
    const intentExpiresAt = new Date(intent.expires_at);
    const expiresAt = oneHourLater < intentExpiresAt ? oneHourLater : intentExpiresAt;

    if (now.getTime() >= expiresAt.getTime()) {
      throw AppError.badRequest('Intent has already expired; cannot approve.');
    }

    const authId = `auth_${uuidv4().replace(/-/g, '')}`;
    const keyId = HmacKeyManager.getActiveKeyId();

    const token = AuthorizationTokenService.generateToken(
      {
        authId,
        intentId,
        policyVersion: policy.version,
        userId,
        checkoutId,
        policyFingerprint,
        expiresAt: expiresAt.toISOString(),
      },
      keyId
    );

    const tokenHash = sha256Hex(token);

    // Atomic DB updates
    await this.db.query(
      `UPDATE intent_policies SET canonical_hash = $1 WHERE id = $2`,
      [policyFingerprint, policy.id]
    );

    await this.db.query(
      `UPDATE intents SET status = 'APPROVED', updated_at = $1 WHERE id = $2`,
      [now, intentId]
    );

    await this.db.query(
      `INSERT INTO authorizations (
        id, intent_id, policy_version, user_id, checkout_id, auth_token_hash, key_id, expires_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [authId, intentId, policy.version, userId, checkoutId, tokenHash, keyId, expiresAt]
    );

    // Audit log
    await this.db.query(
      `INSERT INTO audit_events (id, user_id, correlation_id, event_type, resource_type, resource_id, details)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        `aud_${uuidv4().replace(/-/g, '')}`,
        userId,
        params.correlationId || uuidv4(),
        'INTENT_APPROVED',
        'intent',
        intentId,
        JSON.stringify({
          policyVersion: policy.version,
          policyFingerprint,
          checkoutId,
          authId,
        }),
      ]
    );

    logger.info(`Intent approved successfully: ${intentId} (auth: ${authId})`);

    return {
      intentId,
      policyVersion: policy.version,
      checkoutId,
      authorizationToken: token,
      policyFingerprint,
      expiresAt: expiresAt.toISOString(),
    };
  }

  /**
   * Concurrency-safe atomic single-use authorization reservation.
   * Guarantees replay attacks or simultaneous requests cannot consume the authorization twice.
   */
  async consumeAuthorization(params: {
    authorizationToken: string;
    orderId: string;
    checkoutId: string;
    intentId: string;
    policyVersion: number;
    userId: string;
    policyFingerprint: string;
  }): Promise<{ authId: string }> {
    const verification = AuthorizationTokenService.verifyToken(params.authorizationToken, {
      intentId: params.intentId,
      policyVersion: params.policyVersion,
      userId: params.userId,
      checkoutId: params.checkoutId,
      policyFingerprint: params.policyFingerprint,
    });

    if (!verification.valid || !verification.payload) {
      throw AppError.forbidden(
        `Cryptographic authorization verification failed: ${verification.errorReason || 'UNKNOWN'}`
      );
    }

    const { authId } = verification.payload;
    const now = new Date();

    // Atomic consumption update with condition
    const updateRes = await this.db.query(
      `UPDATE authorizations
       SET consumed_at = $1, consumed_order_id = $2
       WHERE id = $3 
         AND consumed_at IS NULL 
         AND expires_at > $1
       RETURNING id, intent_id`,
      [now, params.orderId, authId]
    );

    if (updateRes.rowCount === 0) {
      // Investigate why it failed to report exact safe error
      const existing = await this.db.query(
        `SELECT consumed_at, expires_at FROM authorizations WHERE id = $1`,
        [authId]
      );

      if (existing.rowCount === 0) {
        throw AppError.forbidden('Authorization record does not exist on server.');
      }

      const row = existing.rows[0];
      if (row?.consumed_at) {
        throw AppError.forbidden('Authorization token has already been consumed (Replay detected).');
      }

      throw AppError.forbidden('Authorization token has expired.');
    }

    // Mark intent as CONSUMED
    await this.db.query(
      `UPDATE intents SET status = 'CONSUMED', updated_at = $1 WHERE id = $2`,
      [now, params.intentId]
    );

    return { authId };
  }
}
