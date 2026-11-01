import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { requireAuth } from '../middleware/auth.js';
import { getDbClient } from '../db/client.js';
import { AppError } from '../errors/index.js';
import { ApprovalService } from '../crypto/approvalService.js';
import { canonicalizePolicy } from '../crypto/canonical.js';
import { sha256Hex } from '../crypto/hasher.js';

export const intentsRouter = Router();
const db = getDbClient();
const approvalService = new ApprovalService(db);

const createIntentSchema = z.object({
  merchantId: z.string().min(1),
  allowedSku: z.string().min(1),
  maxQuantity: z.number().int().positive(),
  maxTotalCents: z.number().int().positive(),
  currency: z.string().length(3),
  allowedConditions: z.record(z.unknown()).optional(),
  durationMinutes: z.number().int().positive().default(60),
});

intentsRouter.use(requireAuth);

/**
 * POST /api/intents
 * Creates an intent in DRAFT state.
 */
intentsRouter.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = createIntentSchema.parse(req.body);
    const userId = req.user!.id;
    const intentId = `int_${uuidv4().replace(/-/g, '')}`;
    const policyId = `pol_${uuidv4().replace(/-/g, '')}`;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + body.durationMinutes * 60 * 1000);

    // Initial placeholder hash until explicit approval
    const canonicalStr = canonicalizePolicy({
      intentId,
      version: 1,
      merchantId: body.merchantId,
      allowedSku: body.allowedSku,
      maxQuantity: body.maxQuantity,
      maxTotalCents: body.maxTotalCents,
      currency: body.currency,
      allowedConditions: body.allowedConditions || null,
    });
    const canonicalHash = sha256Hex(canonicalStr);

    await db.query(
      `INSERT INTO intents (id, user_id, status, version, expires_at)
       VALUES ($1, $2, 'DRAFT', 1, $3)`,
      [intentId, userId, expiresAt]
    );

    await db.query(
      `INSERT INTO intent_policies (
        id, intent_id, version, merchant_id, allowed_sku, max_quantity, max_total_cents, currency, allowed_conditions, canonical_hash
      ) VALUES ($1, $2, 1, $3, $4, $5, $6, $7, $8, $9)`,
      [
        policyId,
        intentId,
        body.merchantId,
        body.allowedSku,
        body.maxQuantity,
        body.maxTotalCents,
        body.currency.toUpperCase(),
        body.allowedConditions ? JSON.stringify(body.allowedConditions) : null,
        canonicalHash,
      ]
    );

    res.status(201).json({
      intentId,
      version: 1,
      status: 'DRAFT',
      merchantId: body.merchantId,
      allowedSku: body.allowedSku,
      maxQuantity: body.maxQuantity,
      maxTotalCents: body.maxTotalCents,
      currency: body.currency.toUpperCase(),
      expiresAt: expiresAt.toISOString(),
      message: 'Intent created in DRAFT state. Explicit approval is required before checkout.',
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return next(AppError.badRequest('Invalid intent proposal schema', err.errors));
    }
    next(err);
  }
});

/**
 * GET /api/intents/:intentId
 * Retrieves intent and active policy constraints.
 */
intentsRouter.get('/:intentId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { intentId } = req.params;
    const userId = req.user!.id;

    const intentRes = await db.query(`SELECT * FROM intents WHERE id = $1`, [intentId]);
    if (intentRes.rowCount === 0) {
      throw AppError.notFound(`Intent '${intentId}' not found.`);
    }

    const intent = intentRes.rows[0];
    if (!intent) {
      throw AppError.notFound(`Intent '${intentId}' not found.`);
    }
    if (intent.user_id !== userId && req.user!.role !== 'admin') {
      throw AppError.forbidden('Access denied to another user\'s intent.');
    }

    const policyRes = await db.query(
      `SELECT * FROM intent_policies WHERE intent_id = $1 AND version = $2`,
      [intentId, intent.version]
    );
    const policy = policyRes.rows[0];

    res.status(200).json({
      intentId: intent.id,
      userId: intent.user_id,
      status: intent.status,
      version: intent.version,
      expiresAt: intent.expires_at,
      policy: policy
        ? {
            merchantId: policy.merchant_id,
            allowedSku: policy.allowed_sku,
            maxQuantity: policy.max_quantity,
            maxTotalCents: policy.max_total_cents,
            currency: policy.currency,
            canonicalHash: policy.canonical_hash,
          }
        : null,
    });
  } catch (err) {
    next(err);
  }
});

const approveIntentSchema = z.object({
  checkoutId: z.string().min(1),
});

/**
 * POST /api/intents/:intentId/approve
 * Deliberate, authenticated explicit user approval.
 */
intentsRouter.post('/:intentId/approve', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { intentId } = req.params;
    const userId = req.user!.id;
    const { checkoutId } = approveIntentSchema.parse(req.body);

    if (!intentId) {
      throw AppError.badRequest('Missing intentId parameter.');
    }

    const result = await approvalService.approveIntent({
      intentId,
      userId,
      checkoutId,
      correlationId: (req as unknown as { id?: string }).id,
    });

    res.status(200).json({
      intentId: result.intentId,
      status: 'APPROVED',
      policyVersion: result.policyVersion,
      checkoutId: result.checkoutId,
      policyFingerprint: result.policyFingerprint,
      authorizationToken: result.authorizationToken,
      expiresAt: result.expiresAt,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return next(AppError.badRequest('Invalid approval request schema', err.errors));
    }
    next(err);
  }
});
