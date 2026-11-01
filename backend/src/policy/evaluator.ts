import {
  NormalizedOrder,
  IntentRecord,
  IntentPolicyRecord,
  AuthoritativeProduct,
  PolicyEvaluationResult,
  PolicyReasonCode,
} from './types.js';

export interface PolicyEvaluationContext {
  order: NormalizedOrder;
  intent: IntentRecord | null;
  policy: IntentPolicyRecord | null;
  authoritativeProduct: AuthoritativeProduct | null;
  currentTime?: Date;
}

export class PolicyEngine {
  /**
   * Deterministically evaluates an order against an intent, policy, and authoritative catalog.
   * Never uses floating point arithmetic.
   * Fails closed on any inconsistency or ambiguity.
   */
  public static evaluate(ctx: PolicyEvaluationContext): PolicyEvaluationResult {
    const evaluatedAt = (ctx.currentTime || new Date()).toISOString();
    const reasonCodes: PolicyReasonCode[] = [];
    const violations: string[] = [];

    const now = ctx.currentTime || new Date();

    // 1. Missing Intent Check
    if (!ctx.intent) {
      return {
        decision: 'BLOCK',
        reasonCodes: ['INTENT_NOT_FOUND'],
        evaluatedPolicyVersion: null,
        evaluatedAt,
        violations: ['Intent record not found in system.'],
      };
    }

    const intent = ctx.intent;

    // 2. Lifecycle State Check
    if (intent.status === 'DRAFT') {
      reasonCodes.push('INTENT_NOT_APPROVED');
      violations.push('Intent is in DRAFT state and has not received explicit user approval.');
    } else if (intent.status === 'REVOKED') {
      reasonCodes.push('INTENT_REVOKED');
      violations.push('Intent has been explicitly revoked by the user.');
    } else if (intent.status === 'CONSUMED') {
      reasonCodes.push('INTENT_CONSUMED');
      violations.push('Intent has already been consumed by a prior transaction.');
    } else if (intent.status !== 'APPROVED') {
      reasonCodes.push('INTENT_NOT_APPROVED');
      violations.push(`Intent status '${intent.status}' is not approved for execution.`);
    }

    // 3. Expiry Check
    if (now.getTime() >= intent.expiresAt.getTime()) {
      reasonCodes.push('INTENT_EXPIRED');
      violations.push(`Intent expired at ${intent.expiresAt.toISOString()}. Current evaluation time: ${now.toISOString()}.`);
    }

    // 4. Missing Policy Check
    if (!ctx.policy) {
      reasonCodes.push('INTENT_NOT_FOUND');
      violations.push('No policy configuration found for the specified intent.');
      return {
        decision: 'BLOCK',
        reasonCodes,
        evaluatedPolicyVersion: null,
        evaluatedAt,
        violations,
      };
    }

    const policy = ctx.policy;

    // 5. Version Consistency Check
    if (intent.version !== policy.version) {
      reasonCodes.push('POLICY_VERSION_MISMATCH');
      violations.push(
        `Intent current version (${intent.version}) does not match policy version (${policy.version}). Stale policy detected.`
      );
    }

    const order = ctx.order;

    // 6. Monetary Integrity Check (Integer Minor Units Only)
    if (
      !Number.isInteger(order.totalAmountCents) ||
      order.totalAmountCents <= 0 ||
      !Number.isInteger(policy.maxTotalCents) ||
      policy.maxTotalCents <= 0
    ) {
      reasonCodes.push('INVALID_MONETARY_VALUE');
      violations.push('Monetary amounts must be strictly positive non-zero integers (minor currency units).');
    }

    // 7. Merchant Match Check
    if (order.merchantId !== policy.merchantId) {
      reasonCodes.push('MERCHANT_MISMATCH');
      violations.push(
        `Order merchant ID '${order.merchantId}' does not match authorized policy merchant '${policy.merchantId}'.`
      );
    }

    // 8. Currency Match Check
    if (order.currency.toUpperCase() !== policy.currency.toUpperCase()) {
      reasonCodes.push('CURRENCY_MISMATCH');
      violations.push(
        `Order currency '${order.currency}' does not match authorized policy currency '${policy.currency}'.`
      );
    }

    // 9. Items Validation & Authoritative Catalogue Verification
    let computedItemTotalCents = 0;
    let totalQuantity = 0;

    if (!order.items || order.items.length === 0) {
      reasonCodes.push('PRODUCT_SKU_MISMATCH');
      violations.push('Order contains no line items.');
    } else {
      for (const item of order.items) {
        if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
          reasonCodes.push('INVALID_MONETARY_VALUE');
          violations.push(`Invalid item quantity: ${item.quantity}. Must be positive integer.`);
        }
        if (!Number.isInteger(item.unitPriceCents) || item.unitPriceCents <= 0) {
          reasonCodes.push('INVALID_MONETARY_VALUE');
          violations.push(`Invalid item unit price: ${item.unitPriceCents}. Must be positive integer cents.`);
        }

        // SKU match
        if (item.sku !== policy.allowedSku) {
          reasonCodes.push('PRODUCT_SKU_MISMATCH');
          violations.push(
            `Order line item SKU '${item.sku}' is not permitted by policy. Allowed SKU: '${policy.allowedSku}'.`
          );
        }

        totalQuantity += item.quantity;
        computedItemTotalCents += item.quantity * item.unitPriceCents;
      }
    }

    // 10. Quantity Boundary Check
    if (totalQuantity > policy.maxQuantity) {
      reasonCodes.push('QUANTITY_EXCEEDED');
      violations.push(
        `Total requested quantity ${totalQuantity} exceeds approved maximum quantity ${policy.maxQuantity}.`
      );
    }

    // 11. Authoritative Server-Side Product Price Verification
    if (!ctx.authoritativeProduct || !ctx.authoritativeProduct.active) {
      reasonCodes.push('UNRESOLVABLE_AUTHORITATIVE_PRODUCT');
      violations.push(
        `Authoritative catalogue entry for SKU '${policy.allowedSku}' and merchant '${policy.merchantId}' is missing or inactive.`
      );
    } else {
      const authProduct = ctx.authoritativeProduct;
      if (authProduct.currency.toUpperCase() !== policy.currency.toUpperCase()) {
        reasonCodes.push('CURRENCY_MISMATCH');
        violations.push(
          `Authoritative product currency '${authProduct.currency}' differs from policy currency '${policy.currency}'.`
        );
      }

      // Check authoritative unit price against line items
      for (const item of order.items) {
        if (item.sku === authProduct.sku && item.unitPriceCents !== authProduct.unitPriceCents) {
          reasonCodes.push('PRICE_CALCULATION_MISMATCH');
          violations.push(
            `Order item unit price (${item.unitPriceCents} cents) does not match authoritative server price (${authProduct.unitPriceCents} cents).`
          );
        }
      }

      const expectedAuthoritativeTotal = totalQuantity * authProduct.unitPriceCents;
      if (order.totalAmountCents !== expectedAuthoritativeTotal) {
        reasonCodes.push('PRICE_CALCULATION_MISMATCH');
        violations.push(
          `Order total (${order.totalAmountCents} cents) does not equal authoritative calculated total (${expectedAuthoritativeTotal} cents).`
        );
      }
    }

    // 12. Approved Budget / Cap Check
    if (order.totalAmountCents > policy.maxTotalCents) {
      reasonCodes.push('AMOUNT_EXCEEDED');
      violations.push(
        `Order total ${order.totalAmountCents} cents exceeds approved policy budget of ${policy.maxTotalCents} cents.`
      );
    }

    // Decision Determination
    const isAllowed = reasonCodes.length === 0;

    return {
      decision: isAllowed ? 'ALLOW' : 'BLOCK',
      reasonCodes: isAllowed ? ['POLICY_SATISFIED'] : Array.from(new Set(reasonCodes)),
      evaluatedPolicyVersion: policy.version,
      evaluatedAt,
      violations,
    };
  }
}
