import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { requireAuth } from '../middleware/auth.js';
import { createRateLimiter } from '../middleware/rateLimit.js';
import { getDbClient } from '../db/client.js';
import { AppError } from '../errors/index.js';
import { PaymentProvider } from '../payment/types.js';
import { GuardedCaptureService } from '../payment/guardedCapture.js';
import { PolicyEngine } from '../policy/evaluator.js';
import { NormalizedOrder, AuthoritativeProduct, IntentRecord, IntentPolicyRecord } from '../policy/types.js';

export function createOrdersRouter(
  provider: PaymentProvider,
  guardedCaptureService: GuardedCaptureService
): Router {
  const router = Router();
  const db = getDbClient();

  router.use(requireAuth);

  const captureRateLimiter = createRateLimiter({
    windowMs: 60 * 1000,
    max: 30,
    message: 'Too many capture requests. Rate limit exceeded.',
  });

  const createOrderSchema = z.object({
    intentId: z.string().min(1),
    quantity: z.number().int().positive().default(1),
  });

  /**
   * POST /api/orders
   * Creates an order with PayPal using authoritative server-side numbers.
   */
  router.post('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { intentId, quantity } = createOrderSchema.parse(req.body);
      const userId = req.user!.id;

      // Load approved intent & policy
      const intentRes = await db.query(`SELECT * FROM intents WHERE id = $1`, [intentId]);
      if (intentRes.rowCount === 0) {
        throw AppError.notFound(`Intent '${intentId}' not found.`);
      }
      const intent = intentRes.rows[0];
      if (!intent) {
        throw AppError.notFound(`Intent '${intentId}' not found.`);
      }
      if (intent.user_id !== userId) {
        throw AppError.forbidden('Cannot create order for another user\'s intent.');
      }
      if (intent.status !== 'APPROVED') {
        throw AppError.conflict(
          `Cannot create order: intent status is '${intent.status}'. Must be 'APPROVED'.`
        );
      }

      const policyRes = await db.query(
        `SELECT * FROM intent_policies WHERE intent_id = $1 AND version = $2`,
        [intentId, intent.version]
      );
      const policy = policyRes.rows[0];
      if (!policy) {
        throw AppError.badRequest('Active policy not found for intent.');
      }

      if (quantity > policy.max_quantity) {
        throw AppError.badRequest(
          `Requested quantity ${quantity} exceeds approved limit of ${policy.max_quantity}.`
        );
      }

      // Fetch authoritative price from catalogue
      const productRes = await db.query(
        `SELECT * FROM catalogue_products WHERE merchant_id = $1 AND sku = $2 AND active = true`,
        [policy.merchant_id, policy.allowed_sku]
      );
      if (productRes.rowCount === 0) {
        throw AppError.badRequest('Authoritative product is unavailable in catalogue.');
      }
      const product = productRes.rows[0];
      if (!product) {
        throw AppError.badRequest('Authoritative product is unavailable in catalogue.');
      }

      // Create order with provider
      const providerOrder = await provider.createOrder({
        intentId,
        userId,
        merchantId: policy.merchant_id,
        sku: policy.allowed_sku,
        quantity,
        unitPriceCents: product.unit_price_cents,
        currency: policy.currency,
      });

      const orderId = `ord_${uuidv4().replace(/-/g, '')}`;
      await db.query(
        `INSERT INTO orders (id, user_id, intent_id, provider_order_id, status, amount_cents, currency)
         VALUES ($1, $2, $3, $4, 'CREATED', $5, $6)`,
        [
          orderId,
          userId,
          intentId,
          providerOrder.id,
          quantity * product.unit_price_cents,
          policy.currency,
        ]
      );

      res.status(201).json({
        orderId,
        providerOrderId: providerOrder.id,
        status: 'CREATED',
        amountCents: quantity * product.unit_price_cents,
        currency: policy.currency,
        approvalUrl: providerOrder.approvalUrl,
        message: 'Order created. Buyer must approve on PayPal before guarded capture can execute.',
      });
    } catch (err) {
      if (err instanceof z.ZodError) {
        return next(AppError.badRequest('Invalid order creation schema', err.errors));
      }
      next(err);
    }
  });

  /**
   * POST /api/orders/:orderId/validate
   * Deterministic policy evaluation without capture.
   * STRICT SECURITY GUARANTEE: Never invokes capture.
   */
  router.post('/:orderId/validate', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { orderId } = req.params;
      const userId = req.user!.id;

      const orderRes = await db.query(`SELECT * FROM orders WHERE id = $1`, [orderId]);
      if (orderRes.rowCount === 0) {
        throw AppError.notFound(`Order '${orderId}' not found.`);
      }
      const order = orderRes.rows[0];
      if (!order) {
        throw AppError.notFound(`Order '${orderId}' not found.`);
      }
      if (order.user_id !== userId && req.user!.role !== 'admin') {
        throw AppError.forbidden('Access denied to another user\'s order.');
      }

      const intentRes = await db.query(`SELECT * FROM intents WHERE id = $1`, [order.intent_id]);
      const intentRow = intentRes.rows[0];
      if (!intentRow) {
        throw AppError.notFound(`Intent not found.`);
      }
      const intent: IntentRecord = {
        id: intentRow.id,
        userId: intentRow.user_id,
        status: intentRow.status,
        version: intentRow.version,
        createdAt: new Date(intentRow.created_at),
        updatedAt: new Date(intentRow.updated_at),
        expiresAt: new Date(intentRow.expires_at),
      };

      const policyRes = await db.query(
        `SELECT * FROM intent_policies WHERE intent_id = $1 AND version = $2`,
        [intent.id, intent.version]
      );
      const policyRow = policyRes.rows[0];
      if (!policyRow) {
        throw AppError.badRequest('Active policy not found for intent.');
      }
      const policy: IntentPolicyRecord = {
        id: policyRow.id,
        intentId: policyRow.intent_id,
        version: policyRow.version,
        merchantId: policyRow.merchant_id,
        allowedSku: policyRow.allowed_sku,
        maxQuantity: policyRow.max_quantity,
        maxTotalCents: policyRow.max_total_cents,
        currency: policyRow.currency,
        allowedConditions: policyRow.allowed_conditions,
        canonicalHash: policyRow.canonical_hash,
        createdAt: new Date(policyRow.created_at),
      };

      // Retrieve fresh provider order
      const providerOrder = await provider.getOrder(order.provider_order_id);

      const productRes = await db.query(
        `SELECT * FROM catalogue_products WHERE merchant_id = $1 AND sku = $2`,
        [policy.merchantId, policy.allowedSku]
      );
      const productRow = productRes.rows[0];
      const authoritativeProduct: AuthoritativeProduct | null = productRow
        ? {
            id: productRow.id,
            merchantId: productRow.merchant_id,
            sku: productRow.sku,
            title: productRow.title,
            unitPriceCents: productRow.unit_price_cents,
            currency: productRow.currency,
            active: productRow.active,
          }
        : null;

      const normalizedOrder: NormalizedOrder = {
        orderId: providerOrder.id,
        merchantId: providerOrder.merchantId || policy.merchantId,
        currency: providerOrder.currency,
        totalAmountCents: providerOrder.totalAmountCents,
        items: providerOrder.items.map((i) => ({
          sku: i.sku,
          quantity: i.quantity,
          unitPriceCents: i.unitPriceCents,
        })),
      };

      const evaluation = PolicyEngine.evaluate({
        order: normalizedOrder,
        intent,
        policy,
        authoritativeProduct,
      });

      res.status(200).json({
        orderId,
        providerOrderId: providerOrder.id,
        decision: evaluation.decision,
        reasonCodes: evaluation.reasonCodes,
        policyVersion: evaluation.evaluatedPolicyVersion,
        evaluatedAt: evaluation.evaluatedAt,
        violations: evaluation.violations,
        message:
          evaluation.decision === 'ALLOW'
            ? 'Order currently satisfies policy. Note: Capture endpoint will independently re-verify all constraints.'
            : 'Order violates intent policy constraints.',
      });
    } catch (err) {
      next(err);
    }
  });

  const captureBodySchema = z.object({
    authorizationToken: z.string().min(1),
    checkoutId: z.string().min(1),
  });

  /**
   * POST /api/orders/:orderId/guarded-capture
   * Executes atomic guarded capture under deterministic policy & cryptographic authorization.
   */
  router.post(
    '/:orderId/guarded-capture',
    captureRateLimiter,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { orderId } = req.params;
        const userId = req.user!.id;
        const idempotencyKey = (req.headers['idempotency-key'] as string) || (req.headers['x-idempotency-key'] as string);

        if (!idempotencyKey) {
          throw AppError.badRequest('Missing required Idempotency-Key header.');
        }

        if (!orderId) {
          throw AppError.badRequest('Missing orderId in path.');
        }

        const { authorizationToken, checkoutId } = captureBodySchema.parse(req.body);

        const result = await guardedCaptureService.executeGuardedCapture({
          orderId,
          userId,
          idempotencyKey,
          authorizationToken,
          checkoutId,
          correlationId: (req as unknown as { id?: string }).id,
        });

        res.status(200).json(result);
      } catch (err) {
        if (err instanceof z.ZodError) {
          return next(AppError.badRequest('Invalid capture request body schema', err.errors));
        }
        next(err);
      }
    }
  );

  /**
   * GET /api/orders/:orderId/status
   * Retrieves order status and capture details.
   */
  router.get('/:orderId/status', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { orderId } = req.params;
      const userId = req.user!.id;

      const orderRes = await db.query(`SELECT * FROM orders WHERE id = $1`, [orderId]);
      if (orderRes.rowCount === 0) {
        throw AppError.notFound(`Order '${orderId}' not found.`);
      }
      const order = orderRes.rows[0];
      if (!order) {
        throw AppError.notFound(`Order '${orderId}' not found.`);
      }
      if (order.user_id !== userId && req.user!.role !== 'admin') {
        throw AppError.forbidden('Access denied to another user\'s order.');
      }

      const captureRes = await db.query(
        `SELECT * FROM capture_attempts WHERE order_id = $1 ORDER BY created_at DESC LIMIT 1`,
        [orderId]
      );
      const capture = captureRes.rows[0];

      res.status(200).json({
        orderId: order.id,
        providerOrderId: order.provider_order_id,
        intentId: order.intent_id,
        status: order.status,
        amountCents: order.amount_cents,
        currency: order.currency,
        capture: capture
          ? {
              status: capture.status,
              providerCaptureId: capture.provider_capture_id,
              idempotencyKey: capture.idempotency_key,
              attemptCount: capture.attempt_count,
              createdAt: capture.created_at,
            }
          : null,
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
