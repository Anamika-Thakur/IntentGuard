import { describe, it, expect, beforeAll } from 'vitest';
import { runMigrations } from '../src/db/migrate.js';
import { getDbClient } from '../src/db/client.js';
import { canonicalizePolicy, canonicalizeOrder } from '../src/crypto/canonical.js';
import { sha256Hex } from '../src/crypto/hasher.js';
import {
  AuthorizationTokenService,
  HmacKeyManager,
} from '../src/crypto/hmac.js';
import { ApprovalService } from '../src/crypto/approvalService.js';

describe('Phase 3: Explicit Approval & Cryptographic Authorization', () => {
  const db = getDbClient();
  const approvalService = new ApprovalService(db);

  beforeAll(async () => {
    await runMigrations(db);
  });

  describe('Canonical Representation & SHA-256 Fingerprinting', () => {
    it('produces identical canonical output regardless of object key order', () => {
      const canonical1 = canonicalizePolicy({
        intentId: 'int_100',
        version: 1,
        merchantId: 'MERCHANT_ACME_STORE',
        allowedSku: 'SKU-WIDGET-01',
        maxQuantity: 2,
        maxTotalCents: 5000,
        currency: 'usd',
      });

      const canonical2 = canonicalizePolicy({
        version: 1,
        maxTotalCents: 5000,
        currency: 'USD',
        allowedSku: 'SKU-WIDGET-01',
        merchantId: 'MERCHANT_ACME_STORE',
        maxQuantity: 2,
        intentId: 'int_100',
      });

      expect(canonical1).toBe(canonical2);
      expect(sha256Hex(canonical1)).toBe(sha256Hex(canonical2));
    });

    it('detects altered fields with differing SHA-256 fingerprint', () => {
      const canonical1 = canonicalizePolicy({
        intentId: 'int_100',
        version: 1,
        merchantId: 'MERCHANT_ACME_STORE',
        allowedSku: 'SKU-WIDGET-01',
        maxQuantity: 2,
        maxTotalCents: 5000,
        currency: 'USD',
      });

      const canonicalAltered = canonicalizePolicy({
        intentId: 'int_100',
        version: 1,
        merchantId: 'MERCHANT_ACME_STORE',
        allowedSku: 'SKU-WIDGET-01',
        maxQuantity: 2,
        maxTotalCents: 5001, // 1 cent difference
        currency: 'USD',
      });

      expect(sha256Hex(canonical1)).not.toBe(sha256Hex(canonicalAltered));
    });

    it('rejects floating-point values in canonicalization', () => {
      expect(() => {
        canonicalizeOrder({
          orderId: 'ord_1',
          merchantId: 'mer_1',
          currency: 'USD',
          totalAmountCents: 15.5 as unknown as number,
          items: [],
        });
      }).toThrow(/floating-point/i);
    });
  });

  describe('HMAC-SHA-256 Authorization Tokens & Constant-Time Verification', () => {
    const basePayload = {
      authId: 'auth_test_1',
      intentId: 'int_test_1',
      policyVersion: 1,
      userId: 'usr_test_123',
      checkoutId: 'chk_session_abc',
      policyFingerprint: 'fae8901234567890abcdef1234567890abcdef1234567890abcdef1234567890',
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
    };

    it('verifies a validly signed token', () => {
      const token = AuthorizationTokenService.generateToken(basePayload);
      const res = AuthorizationTokenService.verifyToken(token, {
        intentId: basePayload.intentId,
        policyVersion: basePayload.policyVersion,
        userId: basePayload.userId,
        checkoutId: basePayload.checkoutId,
        policyFingerprint: basePayload.policyFingerprint,
      });

      expect(res.valid).toBe(true);
      expect(res.payload?.authId).toBe(basePayload.authId);
    });

    it('rejects tampered token HMAC or payload', () => {
      const token = AuthorizationTokenService.generateToken(basePayload);
      const parts = token.split('.');
      // Tamper signature by changing last character
      const tamperedHmac = parts[2]?.slice(0, -1) + (parts[2]?.endsWith('a') ? 'b' : 'a');
      const tamperedToken = `${parts[0]}.${parts[1]}.${tamperedHmac}`;

      const res = AuthorizationTokenService.verifyToken(tamperedToken, {
        intentId: basePayload.intentId,
        policyVersion: basePayload.policyVersion,
        userId: basePayload.userId,
        checkoutId: basePayload.checkoutId,
        policyFingerprint: basePayload.policyFingerprint,
      });

      expect(res.valid).toBe(false);
      expect(res.errorReason).toBe('INVALID_SIGNATURE_OR_TAMPERED_TOKEN');
    });

    it('rejects mismatched checkout session ID', () => {
      const token = AuthorizationTokenService.generateToken(basePayload);
      const res = AuthorizationTokenService.verifyToken(token, {
        intentId: basePayload.intentId,
        policyVersion: basePayload.policyVersion,
        userId: basePayload.userId,
        checkoutId: 'chk_different_attacker_session',
        policyFingerprint: basePayload.policyFingerprint,
      });

      expect(res.valid).toBe(false);
      expect(res.errorReason).toBe('CHECKOUT_ID_MISMATCH');
    });

    it('rejects mismatched policy version or fingerprint', () => {
      const token = AuthorizationTokenService.generateToken(basePayload);
      const resVersion = AuthorizationTokenService.verifyToken(token, {
        intentId: basePayload.intentId,
        policyVersion: 2, // version mismatch
        userId: basePayload.userId,
        checkoutId: basePayload.checkoutId,
        policyFingerprint: basePayload.policyFingerprint,
      });
      expect(resVersion.valid).toBe(false);
      expect(resVersion.errorReason).toBe('POLICY_VERSION_MISMATCH');

      const resFingerprint = AuthorizationTokenService.verifyToken(token, {
        intentId: basePayload.intentId,
        policyVersion: 1,
        userId: basePayload.userId,
        checkoutId: basePayload.checkoutId,
        policyFingerprint: 'different_hash_tampered_policy',
      });
      expect(resFingerprint.valid).toBe(false);
      expect(resFingerprint.errorReason).toBe('POLICY_FINGERPRINT_MISMATCH');
    });

    it('rejects expired authorization tokens', () => {
      const expiredPayload = {
        ...basePayload,
        expiresAt: new Date(Date.now() - 60000).toISOString(), // expired 1m ago
      };
      const token = AuthorizationTokenService.generateToken(expiredPayload);
      const res = AuthorizationTokenService.verifyToken(token, {
        intentId: expiredPayload.intentId,
        policyVersion: expiredPayload.policyVersion,
        userId: expiredPayload.userId,
        checkoutId: expiredPayload.checkoutId,
        policyFingerprint: expiredPayload.policyFingerprint,
      });

      expect(res.valid).toBe(false);
      expect(res.errorReason).toBe('AUTHORIZATION_EXPIRED');
    });

    it('supports key rotation with multiple valid keys and rejects unknown keyId', () => {
      HmacKeyManager.registerKey('v2_key', 'secondary_rotated_secret_key_exceeding_32_chars');

      const tokenV2 = AuthorizationTokenService.generateToken(basePayload, 'v2_key');
      expect(tokenV2.startsWith('v2_key.')).toBe(true);

      const resV2 = AuthorizationTokenService.verifyToken(tokenV2, {
        intentId: basePayload.intentId,
        policyVersion: basePayload.policyVersion,
        userId: basePayload.userId,
        checkoutId: basePayload.checkoutId,
        policyFingerprint: basePayload.policyFingerprint,
      });
      expect(resV2.valid).toBe(true);

      // Unknown key
      const unknownKeyToken = `v999.${tokenV2.split('.').slice(1).join('.')}`;
      const resUnknown = AuthorizationTokenService.verifyToken(unknownKeyToken, {
        intentId: basePayload.intentId,
        policyVersion: basePayload.policyVersion,
        userId: basePayload.userId,
        checkoutId: basePayload.checkoutId,
        policyFingerprint: basePayload.policyFingerprint,
      });
      expect(resUnknown.valid).toBe(false);
      expect(resUnknown.errorReason).toBe('UNKNOWN_KEY_IDENTIFIER');
    });
  });

  describe('Explicit Approval Workflow & Replay / Concurrency Protection', () => {
    it('approves a draft intent, establishes bindings, and enforces single-use consumption', async () => {
      // 1. Create a draft intent and policy in DB
      const intentId = 'int_workflow_1';
      const tomorrow = new Date(Date.now() + 86400000);
      await db.query(
        `INSERT INTO intents (id, user_id, status, version, expires_at)
         VALUES ($1, 'usr_test_123', 'DRAFT', 1, $2)`,
        [intentId, tomorrow]
      );
      await db.query(
        `INSERT INTO intent_policies (id, intent_id, version, merchant_id, allowed_sku, max_quantity, max_total_cents, currency, canonical_hash)
         VALUES ('pol_workflow_1', $1, 1, 'MERCHANT_ACME_STORE', 'SKU-WIDGET-01', 1, 2500, 'USD', 'temp_hash')`,
        [intentId]
      );

      // 2. Perform deliberate explicit approval
      const approval = await approvalService.approveIntent({
        intentId,
        userId: 'usr_test_123',
        checkoutId: 'chk_session_101',
      });

      expect(approval.authorizationToken).toBeDefined();
      expect(approval.policyFingerprint).toBeDefined();

      // Check DB state updated
      const updatedIntent = await db.query(`SELECT status FROM intents WHERE id = $1`, [intentId]);
      expect(updatedIntent.rows[0]?.status).toBe('APPROVED');

      // 3. First consumption succeeds
      const consume1 = await approvalService.consumeAuthorization({
        authorizationToken: approval.authorizationToken,
        orderId: 'ord_paypal_first_use',
        checkoutId: 'chk_session_101',
        intentId,
        policyVersion: 1,
        userId: 'usr_test_123',
        policyFingerprint: approval.policyFingerprint,
      });

      expect(consume1.authId).toBeDefined();

      // Check intent status is now CONSUMED
      const consumedIntent = await db.query(`SELECT status FROM intents WHERE id = $1`, [intentId]);
      expect(consumedIntent.rows[0]?.status).toBe('CONSUMED');

      // 4. Replay attack: attempting to consume the same authorization second time MUST fail
      await expect(
        approvalService.consumeAuthorization({
          authorizationToken: approval.authorizationToken,
          orderId: 'ord_paypal_second_replay',
          checkoutId: 'chk_session_101',
          intentId,
          policyVersion: 1,
          userId: 'usr_test_123',
          policyFingerprint: approval.policyFingerprint,
        })
      ).rejects.toThrow(/already been consumed/i);
    });

    it('rejects approval from unauthorized non-owner user', async () => {
      const intentId = 'int_workflow_owner_check';
      const tomorrow = new Date(Date.now() + 86400000);
      await db.query(
        `INSERT INTO intents (id, user_id, status, version, expires_at)
         VALUES ($1, 'usr_test_123', 'DRAFT', 1, $2)`,
        [intentId, tomorrow]
      );

      await expect(
        approvalService.approveIntent({
          intentId,
          userId: 'usr_attacker_999', // wrong user
          checkoutId: 'chk_session_xyz',
        })
      ).rejects.toThrow(/belonging to another user/i);
    });

    it('prevents concurrent double-spending: only one concurrent consumption succeeds', async () => {
      const intentId = 'int_concurrent_test';
      const tomorrow = new Date(Date.now() + 86400000);
      await db.query(
        `INSERT INTO intents (id, user_id, status, version, expires_at)
         VALUES ($1, 'usr_test_123', 'DRAFT', 1, $2)`,
        [intentId, tomorrow]
      );
      await db.query(
        `INSERT INTO intent_policies (id, intent_id, version, merchant_id, allowed_sku, max_quantity, max_total_cents, currency, canonical_hash)
         VALUES ('pol_concurrent_1', $1, 1, 'MERCHANT_ACME_STORE', 'SKU-WIDGET-01', 1, 2500, 'USD', 'temp_hash')`,
        [intentId]
      );

      const approval = await approvalService.approveIntent({
        intentId,
        userId: 'usr_test_123',
        checkoutId: 'chk_session_race',
      });

      // Launch two parallel consumption attempts
      const req1 = approvalService.consumeAuthorization({
        authorizationToken: approval.authorizationToken,
        orderId: 'ord_race_1',
        checkoutId: 'chk_session_race',
        intentId,
        policyVersion: 1,
        userId: 'usr_test_123',
        policyFingerprint: approval.policyFingerprint,
      });

      const req2 = approvalService.consumeAuthorization({
        authorizationToken: approval.authorizationToken,
        orderId: 'ord_race_2',
        checkoutId: 'chk_session_race',
        intentId,
        policyVersion: 1,
        userId: 'usr_test_123',
        policyFingerprint: approval.policyFingerprint,
      });

      const results = await Promise.allSettled([req1, req2]);
      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');

      // Exactly ONE must succeed and the other MUST be rejected!
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
    });
  });
});
