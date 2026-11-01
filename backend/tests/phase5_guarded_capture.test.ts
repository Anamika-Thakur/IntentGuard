import { describe, it, expect, beforeAll } from 'vitest';
import { runMigrations } from '../src/db/migrate.js';
import { getDbClient } from '../src/db/client.js';
import { MockPaymentProvider } from '../src/payment/mockAdapter.js';
import { GuardedCaptureService } from '../src/payment/guardedCapture.js';
import { ReconciliationService } from '../src/payment/reconciler.js';
import { ApprovalService } from '../src/crypto/approvalService.js';

describe('Phase 5: Guarded Capture, Idempotency, and Payment State Machine', () => {
  const db = getDbClient();
  let mockProvider: MockPaymentProvider;
  let guardedCaptureService: GuardedCaptureService;
  let reconciliationService: ReconciliationService;
  let approvalService: ApprovalService;

  beforeAll(async () => {
    await runMigrations(db);
    mockProvider = new MockPaymentProvider();
    approvalService = new ApprovalService(db);
    guardedCaptureService = new GuardedCaptureService(db, mockProvider, approvalService);
    reconciliationService = new ReconciliationService(db, mockProvider);
  });

  async function setupApprovedOrder(options?: {
    sku?: string;
    quantity?: number;
    unitPriceCents?: number;
    currency?: string;
    merchantId?: string;
    maxTotalCents?: number;
  }) {
    const sku = options?.sku || 'SKU-WIDGET-01';
    const quantity = options?.quantity || 1;
    const unitPriceCents = options?.unitPriceCents || 2500;
    const currency = options?.currency || 'USD';
    const merchantId = options?.merchantId || 'MERCHANT_ACME_STORE';
    const maxTotalCents = options?.maxTotalCents || quantity * unitPriceCents;

    const intentId = `int_test_${Math.random().toString(36).substring(2, 8)}`;
    const orderId = `ord_test_${Math.random().toString(36).substring(2, 8)}`;
    const checkoutId = `chk_test_${Math.random().toString(36).substring(2, 8)}`;

    const tomorrow = new Date(Date.now() + 86400000);

    // 1. Create Draft Intent and Policy
    await db.query(
      `INSERT INTO intents (id, user_id, status, version, expires_at)
       VALUES ($1, 'usr_test_123', 'DRAFT', 1, $2)`,
      [intentId, tomorrow]
    );

    await db.query(
      `INSERT INTO intent_policies (id, intent_id, version, merchant_id, allowed_sku, max_quantity, max_total_cents, currency, canonical_hash)
       VALUES ($1, $2, 1, $3, $4, $5, $6, $7, 'temp_hash')`,
      [`pol_${intentId}`, intentId, merchantId, sku, quantity, maxTotalCents, currency]
    );

    // 2. Explicit User Approval
    const approval = await approvalService.approveIntent({
      intentId,
      userId: 'usr_test_123',
      checkoutId,
    });

    // 3. Create Provider Order in Mock PayPal
    const providerOrder = await mockProvider.createOrder({
      intentId,
      userId: 'usr_test_123',
      merchantId,
      sku,
      quantity,
      unitPriceCents,
      currency,
    });

    mockProvider.setOrderStatus(providerOrder.id, 'APPROVED');

    // 4. Create internal Order record
    await db.query(
      `INSERT INTO orders (id, user_id, intent_id, provider_order_id, status, amount_cents, currency)
       VALUES ($1, 'usr_test_123', $2, $3, 'READY_FOR_VALIDATION', $4, $5)`,
      [orderId, intentId, providerOrder.id, quantity * unitPriceCents, currency]
    );

    return {
      intentId,
      orderId,
      checkoutId,
      providerOrderId: providerOrder.id,
      authorizationToken: approval.authorizationToken,
    };
  }

  it('completes a valid approved purchase through guarded capture', async () => {
    const fixture = await setupApprovedOrder();
    const idempotencyKey = `idemp_valid_${Math.random().toString(36).substring(2, 8)}`;

    const result = await guardedCaptureService.executeGuardedCapture({
      orderId: fixture.orderId,
      userId: 'usr_test_123',
      idempotencyKey,
      authorizationToken: fixture.authorizationToken,
      checkoutId: fixture.checkoutId,
    });

    expect(result.status).toBe('CAPTURE_COMPLETED');
    expect(result.providerCaptureId).toBeDefined();
    expect(result.amountCents).toBe(2500);

    // Verify DB order record status
    const orderRes = await db.query(`SELECT status FROM orders WHERE id = $1`, [fixture.orderId]);
    expect(orderRes.rows[0]?.status).toBe('CAPTURE_COMPLETED');
  });

  it('blocks capture when product SKU is substituted on provider, resulting in 0 capture calls', async () => {
    const fixture = await setupApprovedOrder();
    // Tamper with provider order SKU
    mockProvider.tamperOrderSku(fixture.providerOrderId, 'SKU-MALICIOUS-SUBSTITUTION');

    const idempotencyKey = `idemp_tamper_${Math.random().toString(36).substring(2, 8)}`;

    await expect(
      guardedCaptureService.executeGuardedCapture({
        orderId: fixture.orderId,
        userId: 'usr_test_123',
        idempotencyKey,
        authorizationToken: fixture.authorizationToken,
        checkoutId: fixture.checkoutId,
      })
    ).rejects.toThrow(/deterministic policy/i);

    // Verify order was marked as BLOCKED_BY_POLICY
    const orderRes = await db.query(`SELECT status FROM orders WHERE id = $1`, [fixture.orderId]);
    expect(orderRes.rows[0]?.status).toBe('BLOCKED_BY_POLICY');

    // Provider order was never completed
    const providerOrder = await mockProvider.getOrder(fixture.providerOrderId);
    expect(providerOrder.status).not.toBe('COMPLETED');
  });

  it('blocks capture when order total is tampered / exceeds approved budget', async () => {
    const fixture = await setupApprovedOrder();
    // Tamper amount on provider
    mockProvider.tamperOrderAmount(fixture.providerOrderId, 99999);

    const idempotencyKey = `idemp_overbudget_${Math.random().toString(36).substring(2, 8)}`;

    await expect(
      guardedCaptureService.executeGuardedCapture({
        orderId: fixture.orderId,
        userId: 'usr_test_123',
        idempotencyKey,
        authorizationToken: fixture.authorizationToken,
        checkoutId: fixture.checkoutId,
      })
    ).rejects.toThrow(/deterministic policy/i);

    const orderRes = await db.query(`SELECT status FROM orders WHERE id = $1`, [fixture.orderId]);
    expect(orderRes.rows[0]?.status).toBe('BLOCKED_BY_POLICY');
  });

  it('safely handles duplicate capture requests with identical idempotency key', async () => {
    const fixture = await setupApprovedOrder();
    const idempotencyKey = `idemp_duplicate_test_key`;

    const res1 = await guardedCaptureService.executeGuardedCapture({
      orderId: fixture.orderId,
      userId: 'usr_test_123',
      idempotencyKey,
      authorizationToken: fixture.authorizationToken,
      checkoutId: fixture.checkoutId,
    });

    expect(res1.status).toBe('CAPTURE_COMPLETED');

    // Replay with identical idempotency key
    const res2 = await guardedCaptureService.executeGuardedCapture({
      orderId: fixture.orderId,
      userId: 'usr_test_123',
      idempotencyKey,
      authorizationToken: fixture.authorizationToken,
      checkoutId: fixture.checkoutId,
    });

    expect(res2.status).toBe('CAPTURE_COMPLETED');
    expect(res2.providerCaptureId).toBe(res1.providerCaptureId);
    expect(res2.message).toContain('duplicate idempotency key');
  });

  it('handles provider network timeout as UNKNOWN_PENDING_RECONCILIATION and reconciles safely', async () => {
    const fixture = await setupApprovedOrder();
    const idempotencyKey = `idemp_timeout_${Math.random().toString(36).substring(2, 8)}`;

    // Inject simulated timeout
    mockProvider.simulateCaptureTimeout = true;

    const timeoutResult = await guardedCaptureService.executeGuardedCapture({
      orderId: fixture.orderId,
      userId: 'usr_test_123',
      idempotencyKey,
      authorizationToken: fixture.authorizationToken,
      checkoutId: fixture.checkoutId,
    });

    expect(timeoutResult.status).toBe('UNKNOWN_PENDING_RECONCILIATION');
    expect(timeoutResult.reconciliationRequired).toBe(true);

    mockProvider.simulateCaptureTimeout = false;

    // Simulate that provider actually processed the capture in background
    mockProvider.setOrderStatus(fixture.providerOrderId, 'COMPLETED');

    // Run reconciliation service
    const reconResult = await reconciliationService.reconcileOrder(fixture.orderId);
    expect(reconResult.resolvedStatus).toBe('CAPTURE_COMPLETED');

    // Check DB status is now CAPTURE_COMPLETED
    const finalOrder = await db.query(`SELECT status FROM orders WHERE id = $1`, [fixture.orderId]);
    expect(finalOrder.rows[0]?.status).toBe('CAPTURE_COMPLETED');
  });

  it('prevents concurrent double captures: exactly one request executes capture', async () => {
    const fixture = await setupApprovedOrder();

    // Two parallel requests with different idempotency keys for the same order
    const call1 = guardedCaptureService.executeGuardedCapture({
      orderId: fixture.orderId,
      userId: 'usr_test_123',
      idempotencyKey: 'idemp_race_1',
      authorizationToken: fixture.authorizationToken,
      checkoutId: fixture.checkoutId,
    });

    const call2 = guardedCaptureService.executeGuardedCapture({
      orderId: fixture.orderId,
      userId: 'usr_test_123',
      idempotencyKey: 'idemp_race_2',
      authorizationToken: fixture.authorizationToken,
      checkoutId: fixture.checkoutId,
    });

    const settled = await Promise.allSettled([call1, call2]);
    const succeeded = settled.filter((s) => s.status === 'fulfilled');
    const failed = settled.filter((s) => s.status === 'rejected');

    // Exactly one must succeed, the other rejected by single-use token consumption
    expect(succeeded).toHaveLength(1);
    expect(failed).toHaveLength(1);
  });
});
