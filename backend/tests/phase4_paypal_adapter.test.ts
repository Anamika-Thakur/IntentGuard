import { describe, it, expect, vi } from 'vitest';
import { MockPaymentProvider } from '../src/payment/mockAdapter.js';
import { PayPalSandboxAdapter } from '../src/payment/paypalAdapter.js';

describe('Phase 4: PayPal Orders v2 Sandbox Adapter', () => {
  describe('MockPaymentProvider (Deterministic Adapter)', () => {
    const provider = new MockPaymentProvider();

    it('creates an order with server-calculated amounts', async () => {
      const order = await provider.createOrder({
        intentId: 'int_123',
        userId: 'usr_test_123',
        merchantId: 'MERCHANT_ACME_STORE',
        sku: 'SKU-WIDGET-01',
        quantity: 2,
        unitPriceCents: 2500,
        currency: 'USD',
      });

      expect(order.id).toMatch(/^PAYPAL_MOCK_/);
      expect(order.totalAmountCents).toBe(5000);
      expect(order.status).toBe('CREATED');
      expect(order.approvalUrl).toBeDefined();
    });

    it('retrieves an existing order and normalizes fields', async () => {
      const created = await provider.createOrder({
        intentId: 'int_456',
        userId: 'usr_test_123',
        merchantId: 'MERCHANT_ACME_STORE',
        sku: 'SKU-WIDGET-01',
        quantity: 1,
        unitPriceCents: 2500,
        currency: 'USD',
      });

      const retrieved = await provider.getOrder(created.id);
      expect(retrieved.id).toBe(created.id);
      expect(retrieved.totalAmountCents).toBe(2500);
      expect(retrieved.items[0]?.sku).toBe('SKU-WIDGET-01');
    });

    it('handles idempotent capture calls with identical requestId', async () => {
      const created = await provider.createOrder({
        intentId: 'int_idempotent',
        userId: 'usr_test_123',
        merchantId: 'MERCHANT_ACME_STORE',
        sku: 'SKU-WIDGET-01',
        quantity: 1,
        unitPriceCents: 2500,
        currency: 'USD',
      });

      provider.setOrderStatus(created.id, 'APPROVED');

      const requestId = 'req-idemp-12345';
      const capture1 = await provider.captureOrder(created.id, requestId);
      expect(capture1.status).toBe('COMPLETED');
      expect(capture1.captureId).toBeDefined();

      // Duplicate call with same requestId
      const capture2 = await provider.captureOrder(created.id, requestId);
      expect(capture2.captureId).toBe(capture1.captureId);
      expect(capture2.status).toBe('COMPLETED');
    });

    it('handles simulated timeout as ambiguous outcome without assuming failure', async () => {
      provider.simulateCaptureTimeout = true;
      const res = await provider.captureOrder('any_order', 'req-timeout-1');
      expect(res.status).toBe('UNKNOWN');
      expect(res.isAmbiguousTimeout).toBe(true);
      provider.simulateCaptureTimeout = false;
    });

    it('handles simulated decline from issuer', async () => {
      provider.simulateCaptureDecline = true;
      const res = await provider.captureOrder('any_order', 'req-declined-1');
      expect(res.status).toBe('DECLINED');
      expect(res.errorMessage).toContain('INSTRUMENT_DECLINED');
      provider.simulateCaptureDecline = false;
    });
  });

  describe('PayPalSandboxAdapter Security & Protocol Implementation', () => {
    it('strictly forbids production endpoints or production credentials', () => {
      expect(() => {
        new PayPalSandboxAdapter({
          baseUrl: 'https://api.paypal.com', // Production URL
        });
      }).toThrow(/Production PayPal credentials are strictly prohibited/i);
    });

    it('obtains and caches OAuth access tokens correctly', async () => {
      const fakeFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          access_token: 'A21_fake_oauth_token_12345',
          token_type: 'Bearer',
          expires_in: 32400,
        }),
      });
      globalThis.fetch = fakeFetch;

      const adapter = new PayPalSandboxAdapter({
        baseUrl: 'https://api-m.sandbox.paypal.com',
        clientId: 'mock_client',
        clientSecret: 'mock_secret',
      });

      const token1 = await adapter.getAccessToken();
      expect(token1).toBe('A21_fake_oauth_token_12345');
      expect(fakeFetch).toHaveBeenCalledTimes(1);

      // Second call should return cached token without invoking fetch again
      const token2 = await adapter.getAccessToken();
      expect(token2).toBe('A21_fake_oauth_token_12345');
      expect(fakeFetch).toHaveBeenCalledTimes(1);
    });

    it('formats order creation payload and converts amounts from integer minor units to decimal strings', async () => {
      let capturedBody: string | undefined;

      const fakeFetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
        if (url.includes('/v1/oauth2/token')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({ access_token: 'token_123', expires_in: 3600 }),
          });
        }
        if (url.includes('/v2/checkout/orders')) {
          capturedBody = init?.body as string;
          return Promise.resolve({
            ok: true,
            json: async () => ({
              id: '5O190127TN364715T',
              status: 'CREATED',
              links: [{ href: 'https://sandbox.paypal.com/checkout?token=5O190127TN364715T', rel: 'approve' }],
            }),
          });
        }
        return Promise.reject(new Error('Unexpected URL'));
      });

      globalThis.fetch = fakeFetch;

      const adapter = new PayPalSandboxAdapter({
        baseUrl: 'https://api-m.sandbox.paypal.com',
        clientId: 'mock_client',
        clientSecret: 'mock_secret',
      });

      const order = await adapter.createOrder({
        intentId: 'int_sample_1',
        userId: 'usr_sample_1',
        merchantId: 'MERCHANT_ACME_STORE',
        sku: 'SKU-WIDGET-01',
        quantity: 3,
        unitPriceCents: 2500, // 3 * $25.00 = $75.00
        currency: 'USD',
      });

      expect(order.id).toBe('5O190127TN364715T');
      expect(order.approvalUrl).toContain('checkout?token=5O190127TN364715T');

      const parsedPayload = JSON.parse(capturedBody!);
      expect(parsedPayload.purchase_units[0].amount.value).toBe('75.00');
      expect(parsedPayload.purchase_units[0].items[0].unit_amount.value).toBe('25.00');
      expect(parsedPayload.purchase_units[0].items[0].quantity).toBe('3');
    });

    it('attaches PayPal-Request-Id header to capture calls', async () => {
      let capturedHeaders: Record<string, string> | undefined;

      const fakeFetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
        if (url.includes('/v1/oauth2/token')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({ access_token: 'token_123', expires_in: 3600 }),
          });
        }
        if (url.includes('/capture')) {
          capturedHeaders = init?.headers as Record<string, string>;
          return Promise.resolve({
            ok: true,
            json: async () => ({
              status: 'COMPLETED',
              purchase_units: [{ payments: { captures: [{ id: 'CAP_999', status: 'COMPLETED' }] } }],
            }),
          });
        }
        return Promise.reject(new Error('Unexpected URL'));
      });

      globalThis.fetch = fakeFetch;

      const adapter = new PayPalSandboxAdapter({
        baseUrl: 'https://api-m.sandbox.paypal.com',
        clientId: 'mock_client',
        clientSecret: 'mock_secret',
      });

      const res = await adapter.captureOrder('5O190127TN364715T', 'paypal-req-trace-456');
      expect(res.status).toBe('COMPLETED');
      expect(res.captureId).toBe('CAP_999');

      const headersObj = capturedHeaders as Record<string, string>;
      expect(headersObj['PayPal-Request-Id']).toBe('paypal-req-trace-456');
    });
  });
});
