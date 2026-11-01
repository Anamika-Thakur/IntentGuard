import { AppError } from '../errors/index.js';

export interface CanonicalPolicyInput {
  intentId: string;
  version: number;
  merchantId: string;
  allowedSku: string;
  maxQuantity: number;
  maxTotalCents: number;
  currency: string;
  allowedConditions?: Record<string, unknown> | null;
}

export interface CanonicalOrderInput {
  orderId: string;
  merchantId: string;
  currency: string;
  totalAmountCents: number;
  items: Array<{
    sku: string;
    quantity: number;
    unitPriceCents: number;
  }>;
}

/**
 * Deterministically sorts keys and formats values according to strict canonical rules.
 * Strings are Unicode NFC normalized.
 * Monetary numbers are verified integers.
 */
function sortAndNormalize(value: unknown): unknown {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'string') {
    return value.normalize('NFC').trim();
  }
  if (typeof value === 'number') {
    if (!Number.isInteger(value)) {
      throw AppError.badRequest(`Canonicalization failed: floating-point value '${value}' is prohibited.`);
    }
    return value;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => sortAndNormalize(item));
  }
  if (typeof value === 'object') {
    const sortedObj: Record<string, unknown> = {};
    const keys = Object.keys(value as Record<string, unknown>).sort();
    for (const key of keys) {
      const val = (value as Record<string, unknown>)[key];
      if (val !== undefined) {
        sortedObj[key.normalize('NFC')] = sortAndNormalize(val);
      }
    }
    return sortedObj;
  }
  throw AppError.badRequest(`Unsupported type for canonicalization: ${typeof value}`);
}

export function canonicalizePolicy(input: CanonicalPolicyInput): string {
  if (!Number.isInteger(input.version) || input.version <= 0) {
    throw AppError.badRequest('Invalid policy version for canonicalization.');
  }
  if (!Number.isInteger(input.maxQuantity) || input.maxQuantity <= 0) {
    throw AppError.badRequest('Invalid max quantity for canonicalization.');
  }
  if (!Number.isInteger(input.maxTotalCents) || input.maxTotalCents <= 0) {
    throw AppError.badRequest('Invalid max total cents for canonicalization.');
  }

  const normalized = sortAndNormalize({
    allowedConditions: input.allowedConditions ?? null,
    allowedSku: input.allowedSku,
    currency: input.currency.toUpperCase(),
    intentId: input.intentId,
    maxQuantity: input.maxQuantity,
    maxTotalCents: input.maxTotalCents,
    merchantId: input.merchantId,
    version: input.version,
  });

  return JSON.stringify(normalized);
}

export function canonicalizeOrder(input: CanonicalOrderInput): string {
  if (!Number.isInteger(input.totalAmountCents) || input.totalAmountCents <= 0) {
    throw AppError.badRequest(`Canonicalization failed: floating-point value '${input.totalAmountCents}' is prohibited for order total cents.`);
  }

  // Sort line items deterministically by SKU then unitPrice
  const sortedItems = [...input.items].sort((a, b) => a.sku.localeCompare(b.sku) || a.unitPriceCents - b.unitPriceCents);

  const normalized = sortAndNormalize({
    currency: input.currency.toUpperCase(),
    items: sortedItems.map((item) => ({
      quantity: item.quantity,
      sku: item.sku,
      unitPriceCents: item.unitPriceCents,
    })),
    merchantId: input.merchantId,
    orderId: input.orderId,
    totalAmountCents: input.totalAmountCents,
  });

  return JSON.stringify(normalized);
}
