import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { runMigrations } from '../src/db/migrate.js';
import { getDbClient } from '../src/db/client.js';
import { MockPaymentProvider } from '../src/payment/mockAdapter.js';
import { GuardedCaptureService } from '../src/payment/guardedCapture.js';
import { ApprovalService } from '../src/crypto/approvalService.js';

describe('Phase 6: Secure API Routes and Audit Trail', () => {
  const db = getDbClient();
  const mockProvider = new MockPaymentProvider();
  const approvalService = new ApprovalService(db);
  const guardedCaptureService = new GuardedCaptureService(db, mockProvider, approvalService);
  const app = createApp({ paymentProvider: mockProvider, guardedCaptureService });

  const userAliceToken = 'test-user-token'; // Alice: usr_test_123
  const userBobToken = 'test-user-2-token'; // Bob: usr_test_456

  beforeAll(async () => {
    await runMigrations(db);
  });

  describe('Authentication & Authorization', () => {
    it('rejects unauthenticated requests with 401 UNAUTHORIZED', async () => {
      const res = await request(app).post('/api/intents').send({
        merchantId: 'MERCHANT_ACME_STORE',
        allowedSku: 'SKU-WIDGET-01',
        maxQuantity: 1,
        maxTotalCents: 2500,
        currency: 'USD',
      });

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('enforces ownership: Bob cannot access Alice\'s intent', async () => {
      // Alice creates an intent
      const createRes = await request(app)
        .post('/api/intents')
        .set('Authorization', `Bearer ${userAliceToken}`)
        .send({
          merchantId: 'MERCHANT_ACME_STORE',
          allowedSku: 'SKU-WIDGET-01',
          maxQuantity: 1,
          maxTotalCents: 2500,
          currency: 'USD',
        });

      expect(createRes.status).toBe(201);
      const intentId = createRes.body.intentId;

      // Bob tries to access Alice's intent
      const bobRes = await request(app)
        .get(`/api/intents/${intentId}`)
        .set('Authorization', `Bearer ${userBobToken}`);

      expect(bobRes.status).toBe(403);
      expect(bobRes.body.error.code).toBe('FORBIDDEN');
    });
  });

  describe('Full Intent and Order Workflow via API', () => {
    let aliceIntentId: string;
    let aliceCheckoutId: string;
    let aliceAuthToken: string;
    let aliceOrderId: string;

    it('1. Alice creates draft intent and explicitly approves it', async () => {
      aliceCheckoutId = 'chk_session_api_alice';

      // Create draft intent
      const draftRes = await request(app)
        .post('/api/intents')
        .set('Authorization', `Bearer ${userAliceToken}`)
        .send({
          merchantId: 'MERCHANT_ACME_STORE',
          allowedSku: 'SKU-WIDGET-01',
          maxQuantity: 2,
          maxTotalCents: 5000,
          currency: 'USD',
        });

      expect(draftRes.status).toBe(201);
      aliceIntentId = draftRes.body.intentId;

      // Approve intent explicitly
      const approveRes = await request(app)
        .post(`/api/intents/${aliceIntentId}/approve`)
        .set('Authorization', `Bearer ${userAliceToken}`)
        .send({ checkoutId: aliceCheckoutId });

      expect(approveRes.status).toBe(200);
      expect(approveRes.body.status).toBe('APPROVED');
      expect(approveRes.body.authorizationToken).toBeDefined();
      aliceAuthToken = approveRes.body.authorizationToken;
    });

    it('2. Alice creates an order bound to the approved intent', async () => {
      const orderRes = await request(app)
        .post('/api/orders')
        .set('Authorization', `Bearer ${userAliceToken}`)
        .send({
          intentId: aliceIntentId,
          quantity: 2,
        });

      expect(orderRes.status).toBe(201);
      expect(orderRes.body.orderId).toBeDefined();
      expect(orderRes.body.amountCents).toBe(5000);
      aliceOrderId = orderRes.body.orderId;

      // Simulate PayPal buyer approval in mock provider
      mockProvider.setOrderStatus(orderRes.body.providerOrderId, 'APPROVED');
    });

    it('3. Validate endpoint returns ALLOW without triggering payment capture', async () => {
      const valRes = await request(app)
        .post(`/api/orders/${aliceOrderId}/validate`)
        .set('Authorization', `Bearer ${userAliceToken}`);

      expect(valRes.status).toBe(200);
      expect(valRes.body.decision).toBe('ALLOW');
      expect(valRes.body.reasonCodes).toContain('POLICY_SATISFIED');

      // Verify order status is still not captured
      const statusRes = await request(app)
        .get(`/api/orders/${aliceOrderId}/status`)
        .set('Authorization', `Bearer ${userAliceToken}`);

      expect(statusRes.body.status).not.toBe('CAPTURE_COMPLETED');
    });

    it('4. Guarded capture endpoint executes successfully with Idempotency-Key', async () => {
      const idempotencyKey = `idemp_api_test_${Date.now()}`;

      const capRes = await request(app)
        .post(`/api/orders/${aliceOrderId}/guarded-capture`)
        .set('Authorization', `Bearer ${userAliceToken}`)
        .set('Idempotency-Key', idempotencyKey)
        .send({
          authorizationToken: aliceAuthToken,
          checkoutId: aliceCheckoutId,
        });

      expect(capRes.status).toBe(200);
      expect(capRes.body.status).toBe('CAPTURE_COMPLETED');
      expect(capRes.body.providerCaptureId).toBeDefined();

      // Check status endpoint
      const statusRes = await request(app)
        .get(`/api/orders/${aliceOrderId}/status`)
        .set('Authorization', `Bearer ${userAliceToken}`);

      expect(statusRes.body.status).toBe('CAPTURE_COMPLETED');
      expect(statusRes.body.capture.providerCaptureId).toBeDefined();
    });

    it('5. Audit events are recorded and scoped strictly to Alice', async () => {
      const auditRes = await request(app)
        .get('/api/audit?page=1&limit=10')
        .set('Authorization', `Bearer ${userAliceToken}`);

      expect(auditRes.status).toBe(200);
      expect(auditRes.body.items.length).toBeGreaterThan(0);
      for (const item of auditRes.body.items) {
        expect(item.userId).toBe('usr_test_123'); // All belong to Alice
      }
    });

    it('6. Guarded capture rejects missing Idempotency-Key header', async () => {
      const res = await request(app)
        .post(`/api/orders/${aliceOrderId}/guarded-capture`)
        .set('Authorization', `Bearer ${userAliceToken}`)
        .send({
          authorizationToken: 'some_token',
          checkoutId: 'chk_123',
        });

      expect(res.status).toBe(400);
      expect(res.body.error.message).toContain('Idempotency-Key');
    });
  });
});
