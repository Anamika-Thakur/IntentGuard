export type PolicyDecision = 'ALLOW' | 'BLOCK';

export type PolicyReasonCode =
  | 'POLICY_SATISFIED'
  | 'INTENT_NOT_FOUND'
  | 'INTENT_NOT_APPROVED'
  | 'INTENT_EXPIRED'
  | 'INTENT_REVOKED'
  | 'INTENT_CONSUMED'
  | 'POLICY_VERSION_MISMATCH'
  | 'MERCHANT_MISMATCH'
  | 'MERCHANT_UNTRUSTED'
  | 'PRODUCT_SKU_MISMATCH'
  | 'CURRENCY_MISMATCH'
  | 'QUANTITY_EXCEEDED'
  | 'AMOUNT_EXCEEDED'
  | 'PRICE_CALCULATION_MISMATCH'
  | 'INVALID_MONETARY_VALUE'
  | 'CONDITIONS_VIOLATED'
  | 'UNRESOLVABLE_AUTHORITATIVE_PRODUCT';

export interface NormalizedOrderItem {
  sku: string;
  quantity: number;
  unitPriceCents: number;
}

export interface NormalizedOrder {
  orderId: string;
  merchantId: string;
  currency: string;
  totalAmountCents: number;
  items: NormalizedOrderItem[];
}

export interface IntentRecord {
  id: string;
  userId: string;
  status: 'DRAFT' | 'APPROVED' | 'REVOKED' | 'EXPIRED' | 'CONSUMED';
  version: number;
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date;
}

export interface IntentPolicyRecord {
  id: string;
  intentId: string;
  version: number;
  merchantId: string;
  allowedSku: string;
  maxQuantity: number;
  maxTotalCents: number;
  currency: string;
  allowedConditions?: Record<string, unknown> | null;
  canonicalHash: string;
  createdAt: Date;
}

export interface AuthoritativeProduct {
  id: string;
  merchantId: string;
  sku: string;
  title: string;
  unitPriceCents: number;
  currency: string;
  active: boolean;
}

export interface PolicyEvaluationResult {
  decision: PolicyDecision;
  reasonCodes: PolicyReasonCode[];
  evaluatedPolicyVersion: number | null;
  evaluatedAt: string;
  violations: string[];
}
