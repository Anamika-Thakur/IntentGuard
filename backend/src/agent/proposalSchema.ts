import { z } from 'zod';
import { AppError } from '../errors/index.js';

export const PurchaseProposalSchema = z.object({
  merchantId: z.string().min(1).max(64),
  sku: z.string().min(1).max(64),
  maxQuantity: z.number().int().positive().max(100),
  maxTotalCents: z.number().int().positive().max(5000000), // Max $50,000 cap
  currency: z.string().length(3).regex(/^[A-Z]{3}$/),
  userNote: z.string().max(500).optional(),
});

export type PurchaseProposal = z.infer<typeof PurchaseProposalSchema>;

// Known prompt injection / override patterns to strictly sanitize and block
const SUSPICIOUS_INJECTION_PATTERNS = [
  /ignore (all )?previous instructions/i,
  /bypass policy/i,
  /override (guard|policy|limit|approval)/i,
  /status\s*[:=]\s*["']?APPROVED["']?/i,
  /grant (all|root|admin) permissions/i,
  /drop\s+table/i,
  /select\s+.*\s+from/i,
  /system prompt/i,
  /jailbreak/i,
];

export function sanitizeNaturalLanguageRequest(prompt: string): string {
  if (!prompt || typeof prompt !== 'string') {
    throw AppError.badRequest('Input request must be a non-empty string.');
  }

  // Detect and reject prompt injection patterns
  for (const pattern of SUSPICIOUS_INJECTION_PATTERNS) {
    if (pattern.test(prompt)) {
      throw AppError.badRequest(
        `Potential prompt injection detected in agent input: pattern '${pattern.source}' is prohibited.`
      );
    }
  }

  return prompt.trim();
}

/**
 * Intelligently extracts structured procurement parameters from natural language prompts.
 * Example: "Purchase 2 Precision Widgets from Acme Store for the team under $60"
 */
export function parseNaturalLanguageToProposal(prompt: string): PurchaseProposal {
  const clean = sanitizeNaturalLanguageRequest(prompt);
  const lower = clean.toLowerCase();

  // 1. Merchant detection
  let merchantId = 'MERCHANT_ACME_STORE';
  if (lower.includes('tech') || lower.includes('supply') || lower.includes('cable')) {
    merchantId = 'MERCHANT_TECH_SUPPLY';
  } else if (lower.includes('acme')) {
    merchantId = 'MERCHANT_ACME_STORE';
  }

  // 2. SKU detection
  let sku = 'SKU-WIDGET-01';
  let unitCents = 2500;
  if (lower.includes('gadget') || lower.includes('hyper')) {
    sku = 'SKU-GADGET-99';
    unitCents = 4900;
  } else if (lower.includes('cable') || lower.includes('usb')) {
    sku = 'SKU-USB-C-2M';
    unitCents = 1200;
  } else if (lower.includes('widget') || lower.includes('precision')) {
    sku = 'SKU-WIDGET-01';
    unitCents = 2500;
  }

  // 3. Quantity extraction
  let quantity = 1;
  const qtyMatch = lower.match(/(?:buy|order|purchase|quantity|qty|need|get)\s+(\d+)/i) || lower.match(/(\d+)\s+(?:units|items|pieces|widgets|gadgets|cables)/i);
  if (qtyMatch && qtyMatch[1]) {
    const parsed = parseInt(qtyMatch[1], 10);
    if (!isNaN(parsed) && parsed > 0 && parsed <= 100) {
      quantity = parsed;
    }
  }

  // 4. Budget cap extraction ($XX or XX dollars or under XX)
  let maxTotalCents = quantity * unitCents;
  const budgetMatch = lower.match(/\$\s*(\d+(?:\.\d{1,2})?)/) || lower.match(/(?:under|max|budget|limit|for)\s+(\d+(?:\.\d{1,2})?)\s*(?:dollars|usd|\$)?/i);
  if (budgetMatch && budgetMatch[1]) {
    const val = parseFloat(budgetMatch[1]);
    if (!isNaN(val) && val > 0) {
      maxTotalCents = Math.round(val * 100);
    }
  }

  return {
    merchantId,
    sku,
    maxQuantity: quantity,
    maxTotalCents: Math.max(maxTotalCents, quantity * unitCents),
    currency: 'USD',
    userNote: clean,
  };
}

/**
 * Converts user prompt or agent structured proposal into validated, strictly typed purchase proposal.
 * Fails closed if ambiguous or invalid.
 */
export function validateProposalOutput(rawProposal: unknown): PurchaseProposal {
  const result = PurchaseProposalSchema.safeParse(rawProposal);

  if (!result.success) {
    throw AppError.badRequest(
      `Agent proposal output failed strict schema validation: ${result.error.issues.map((i) => i.message).join('; ')}`
    );
  }

  return result.data;
}
