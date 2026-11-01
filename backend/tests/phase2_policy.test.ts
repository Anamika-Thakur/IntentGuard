import { describe, it, expect } from 'vitest';
import { PolicyEngine } from '../src/policy/evaluator.js';
import {
  NormalizedOrder,
  IntentRecord,
  IntentPolicyRecord,
  AuthoritativeProduct,
} from '../src/policy/types.js';

describe('Phase 2: Deterministic Policy Engine', () => {
  const baseDate = new Date('2026-11-01T12:00:00.000Z');
  const futureDate = new Date('2026-11-02T12:00:00.000Z');
  const pastDate = new Date('2026-10-31T12:00:00.000Z');

  const validIntent: IntentRecord = {
    id: 'int_valid_123',
    userId: 'usr_test_123',
    status: 'APPROVED',
    version: 1,
    createdAt: baseDate,
    updatedAt: baseDate,
    expiresAt: futureDate,
  };

  const validPolicy: IntentPolicyRecord = {
    id: 'pol_valid_123',
    intentId: 'int_valid_123',
    version: 1,
    merchantId: 'MERCHANT_ACME_STORE',
    allowedSku: 'SKU-WIDGET-01',
    maxQuantity: 2,
    maxTotalCents: 5000, // $50.00 max
    currency: 'USD',
    allowedConditions: null,
    canonicalHash: 'dummy_hash',
    createdAt: baseDate,
  };

  const authoritativeProduct: AuthoritativeProduct = {
    id: 'prod_acme_widget',
    merchantId: 'MERCHANT_ACME_STORE',
    sku: 'SKU-WIDGET-01',
    title: 'Precision Widget',
    unitPriceCents: 2500, // $25.00
    currency: 'USD',
    active: true,
  };

  const validOrder: NormalizedOrder = {
    orderId: 'ord_paypal_100',
    merchantId: 'MERCHANT_ACME_STORE',
    currency: 'USD',
    totalAmountCents: 5000, // 2 * $25.00 = $50.00
    items: [
      {
        sku: 'SKU-WIDGET-01',
        quantity: 2,
        unitPriceCents: 2500,
      },
    ],
  };

  it('ALLOWs a valid order adhering to all policy rules', () => {
    const result = PolicyEngine.evaluate({
      order: validOrder,
      intent: validIntent,
      policy: validPolicy,
      authoritativeProduct,
      currentTime: baseDate,
    });

    expect(result.decision).toBe('ALLOW');
    expect(result.reasonCodes).toEqual(['POLICY_SATISFIED']);
    expect(result.violations).toHaveLength(0);
    expect(result.evaluatedPolicyVersion).toBe(1);
  });

  it('BLOCKs when intent is missing', () => {
    const result = PolicyEngine.evaluate({
      order: validOrder,
      intent: null,
      policy: validPolicy,
      authoritativeProduct,
      currentTime: baseDate,
    });

    expect(result.decision).toBe('BLOCK');
    expect(result.reasonCodes).toContain('INTENT_NOT_FOUND');
  });

  it('BLOCKs when intent is in DRAFT state', () => {
    const draftIntent: IntentRecord = { ...validIntent, status: 'DRAFT' };
    const result = PolicyEngine.evaluate({
      order: validOrder,
      intent: draftIntent,
      policy: validPolicy,
      authoritativeProduct,
      currentTime: baseDate,
    });

    expect(result.decision).toBe('BLOCK');
    expect(result.reasonCodes).toContain('INTENT_NOT_APPROVED');
  });

  it('BLOCKs when intent is REVOKED or CONSUMED', () => {
    const revokedIntent: IntentRecord = { ...validIntent, status: 'REVOKED' };
    const resRevoked = PolicyEngine.evaluate({
      order: validOrder,
      intent: revokedIntent,
      policy: validPolicy,
      authoritativeProduct,
      currentTime: baseDate,
    });
    expect(resRevoked.decision).toBe('BLOCK');
    expect(resRevoked.reasonCodes).toContain('INTENT_REVOKED');

    const consumedIntent: IntentRecord = { ...validIntent, status: 'CONSUMED' };
    const resConsumed = PolicyEngine.evaluate({
      order: validOrder,
      intent: consumedIntent,
      policy: validPolicy,
      authoritativeProduct,
      currentTime: baseDate,
    });
    expect(resConsumed.decision).toBe('BLOCK');
    expect(resConsumed.reasonCodes).toContain('INTENT_CONSUMED');
  });

  it('BLOCKs when intent has expired', () => {
    const expiredIntent: IntentRecord = { ...validIntent, expiresAt: pastDate };
    const result = PolicyEngine.evaluate({
      order: validOrder,
      intent: expiredIntent,
      policy: validPolicy,
      authoritativeProduct,
      currentTime: baseDate,
    });

    expect(result.decision).toBe('BLOCK');
    expect(result.reasonCodes).toContain('INTENT_EXPIRED');
  });

  it('BLOCKs on policy version mismatch (stale policy)', () => {
    const stalePolicy: IntentPolicyRecord = { ...validPolicy, version: 2 };
    const result = PolicyEngine.evaluate({
      order: validOrder,
      intent: validIntent, // version is 1
      policy: stalePolicy,
      authoritativeProduct,
      currentTime: baseDate,
    });

    expect(result.decision).toBe('BLOCK');
    expect(result.reasonCodes).toContain('POLICY_VERSION_MISMATCH');
  });

  it('BLOCKs on merchant mismatch', () => {
    const maliciousOrder: NormalizedOrder = {
      ...validOrder,
      merchantId: 'MERCHANT_ATTACKER_STORE',
    };
    const result = PolicyEngine.evaluate({
      order: maliciousOrder,
      intent: validIntent,
      policy: validPolicy,
      authoritativeProduct,
      currentTime: baseDate,
    });

    expect(result.decision).toBe('BLOCK');
    expect(result.reasonCodes).toContain('MERCHANT_MISMATCH');
  });

  it('BLOCKs on currency mismatch', () => {
    const maliciousOrder: NormalizedOrder = {
      ...validOrder,
      currency: 'EUR',
    };
    const result = PolicyEngine.evaluate({
      order: maliciousOrder,
      intent: validIntent,
      policy: validPolicy,
      authoritativeProduct,
      currentTime: baseDate,
    });

    expect(result.decision).toBe('BLOCK');
    expect(result.reasonCodes).toContain('CURRENCY_MISMATCH');
  });

  it('BLOCKs on product/SKU substitution', () => {
    const substitutedOrder: NormalizedOrder = {
      ...validOrder,
      items: [{ sku: 'SKU-EXPENSIVE-DIAMOND', quantity: 2, unitPriceCents: 2500 }],
    };
    const result = PolicyEngine.evaluate({
      order: substitutedOrder,
      intent: validIntent,
      policy: validPolicy,
      authoritativeProduct,
      currentTime: baseDate,
    });

    expect(result.decision).toBe('BLOCK');
    expect(result.reasonCodes).toContain('PRODUCT_SKU_MISMATCH');
  });

  it('BLOCKs when requested quantity exceeds policy limit', () => {
    const excessiveOrder: NormalizedOrder = {
      ...validOrder,
      totalAmountCents: 7500,
      items: [{ sku: 'SKU-WIDGET-01', quantity: 3, unitPriceCents: 2500 }], // policy max is 2
    };
    const result = PolicyEngine.evaluate({
      order: excessiveOrder,
      intent: validIntent,
      policy: validPolicy,
      authoritativeProduct,
      currentTime: baseDate,
    });

    expect(result.decision).toBe('BLOCK');
    expect(result.reasonCodes).toContain('QUANTITY_EXCEEDED');
  });

  it('BLOCKs when total exceeds maximum payable budget', () => {
    const tightBudgetPolicy: IntentPolicyRecord = {
      ...validPolicy,
      maxTotalCents: 3000, // max is $30, order is $50
    };
    const result = PolicyEngine.evaluate({
      order: validOrder,
      intent: validIntent,
      policy: tightBudgetPolicy,
      authoritativeProduct,
      currentTime: baseDate,
    });

    expect(result.decision).toBe('BLOCK');
    expect(result.reasonCodes).toContain('AMOUNT_EXCEEDED');
  });

  it('BLOCKs when browser/order unit price diverges from authoritative catalogue price', () => {
    const tamperedOrder: NormalizedOrder = {
      ...validOrder,
      totalAmountCents: 2000,
      items: [{ sku: 'SKU-WIDGET-01', quantity: 2, unitPriceCents: 1000 }], // claims price is $10 instead of $25
    };
    const result = PolicyEngine.evaluate({
      order: tamperedOrder,
      intent: validIntent,
      policy: validPolicy,
      authoritativeProduct,
      currentTime: baseDate,
    });

    expect(result.decision).toBe('BLOCK');
    expect(result.reasonCodes).toContain('PRICE_CALCULATION_MISMATCH');
  });

  it('BLOCKs on non-integer or negative monetary values', () => {
    const invalidOrder: NormalizedOrder = {
      ...validOrder,
      totalAmountCents: 25.5 as unknown as number, // floating point
      items: [{ sku: 'SKU-WIDGET-01', quantity: 1, unitPriceCents: -500 }],
    };
    const result = PolicyEngine.evaluate({
      order: invalidOrder,
      intent: validIntent,
      policy: validPolicy,
      authoritativeProduct,
      currentTime: baseDate,
    });

    expect(result.decision).toBe('BLOCK');
    expect(result.reasonCodes).toContain('INVALID_MONETARY_VALUE');
  });

  it('BLOCKs when authoritative catalogue product is inactive or missing', () => {
    const result = PolicyEngine.evaluate({
      order: validOrder,
      intent: validIntent,
      policy: validPolicy,
      authoritativeProduct: null,
      currentTime: baseDate,
    });

    expect(result.decision).toBe('BLOCK');
    expect(result.reasonCodes).toContain('UNRESOLVABLE_AUTHORITATIVE_PRODUCT');
  });

  it('Collects all distinct reason codes when multiple violations occur simultaneously', () => {
    const multiViolationOrder: NormalizedOrder = {
      orderId: 'ord_bad',
      merchantId: 'WRONG_MERCHANT',
      currency: 'EUR',
      totalAmountCents: 99999,
      items: [{ sku: 'WRONG_SKU', quantity: 10, unitPriceCents: 99999 }],
    };
    const result = PolicyEngine.evaluate({
      order: multiViolationOrder,
      intent: validIntent,
      policy: validPolicy,
      authoritativeProduct,
      currentTime: baseDate,
    });

    expect(result.decision).toBe('BLOCK');
    expect(result.reasonCodes).toEqual(
      expect.arrayContaining([
        'MERCHANT_MISMATCH',
        'CURRENCY_MISMATCH',
        'PRODUCT_SKU_MISMATCH',
        'QUANTITY_EXCEEDED',
        'AMOUNT_EXCEEDED',
      ])
    );
  });
});
