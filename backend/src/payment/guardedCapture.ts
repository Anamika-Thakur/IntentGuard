import { IDatabaseClient, getDbClient } from '../db/client.js';
import { PaymentProvider } from './types.js';
import { PaymentState } from './stateMachine.js';
import { PolicyEngine } from '../policy/evaluator.js';
import { NormalizedOrder, AuthoritativeProduct, IntentRecord, IntentPolicyRecord } from '../policy/types.js';
import { ApprovalService } from '../crypto/approvalService.js';
import { sha256Hex } from '../crypto/hasher.js';
import { AppError } from '../errors/index.js';
import { logger } from '../logger/index.js';
import { v4 as uuidv4 } from 'uuid';

export interface GuardedCaptureInput {
  orderId: string;
  userId: string;
  idempotencyKey: string;
  authorizationToken: string;
  checkoutId: string;
  correlationId?: string | undefined;
}

export interface GuardedCaptureOutput {
  orderId: string;
  status: PaymentState;
  providerCaptureId?: string | undefined;
  amountCents?: number | undefined;
  currency?: string | undefined;
  idempotencyKey: string;
  reconciliationRequired?: boolean | undefined;
  message?: string | undefined;
}

export class GuardedCaptureService {
  constructor(
    private db: IDatabaseClient = getDbClient(),
    private provider: PaymentProvider,
    private approvalService: ApprovalService = new ApprovalService(db)
  ) {}

  async executeGuardedCapture(input: GuardedCaptureInput): Promise<GuardedCaptureOutput> {
    const correlationId = input.correlationId || uuidv4();

    if (!input.idempotencyKey || input.idempotencyKey.trim().length === 0) {
      throw AppError.badRequest('Missing required Idempotency-Key.');
    }

    // 1. Idempotency Check
    const existingAttemptRes = await this.db.query(
      `SELECT * FROM capture_attempts WHERE idempotency_key = $1`,
      [input.idempotencyKey]
    );

    if (existingAttemptRes.rowCount && existingAttemptRes.rowCount > 0) {
      const existing = existingAttemptRes.rows[0];
      if (!existing) {
        throw AppError.internal('Unexpected error reading idempotency record.');
      }
      logger.info(`Duplicate capture request recognized by idempotency key: ${input.idempotencyKey}`, {
        correlationId,
      });

      const orderRes = await this.db.query(`SELECT * FROM orders WHERE id = $1`, [existing.order_id]);
      const order = orderRes.rows[0];

      return {
        orderId: existing.order_id,
        status: (order?.status as PaymentState) || (existing.status as PaymentState),
        providerCaptureId: existing.provider_capture_id || undefined,
        amountCents: order?.amount_cents,
        currency: order?.currency,
        idempotencyKey: input.idempotencyKey,
        message: 'Returning existing capture attempt result for duplicate idempotency key.',
      };
    }

    // 2. Load and verify order ownership
    const orderRes = await this.db.query(`SELECT * FROM orders WHERE id = $1`, [input.orderId]);
    if (orderRes.rowCount === 0) {
      throw AppError.notFound(`Order '${input.orderId}' not found.`);
    }

    const order = orderRes.rows[0];
    if (!order) {
      throw AppError.notFound(`Order '${input.orderId}' not found.`);
    }

    if (order.user_id !== input.userId) {
      throw AppError.forbidden('Order belongs to a different user.');
    }

    // 3. Load approved intent & policy
    const intentRes = await this.db.query(`SELECT * FROM intents WHERE id = $1`, [order.intent_id]);
    if (intentRes.rowCount === 0) {
      throw AppError.notFound(`Intent '${order.intent_id}' not found.`);
    }
    const intentRow = intentRes.rows[0];
    if (!intentRow) {
      throw AppError.notFound(`Intent '${order.intent_id}' not found.`);
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

    const policyRes = await this.db.query(
      `SELECT * FROM intent_policies WHERE intent_id = $1 AND version = $2`,
      [intent.id, intent.version]
    );
    if (policyRes.rowCount === 0) {
      throw AppError.badRequest(`Active policy for intent '${intent.id}' not found.`);
    }
    const policyRow = policyRes.rows[0];
    if (!policyRow) {
      throw AppError.badRequest(`Active policy for intent '${intent.id}' not found.`);
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

    // 4. Retrieve fresh authoritative order directly from PayPal
    const providerOrder = await this.provider.getOrder(order.provider_order_id);

    // 5. Retrieve authoritative catalogue product
    const productRes = await this.db.query(
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

    // Normalize order for policy engine
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

    // 6. Evaluate Deterministic Policy
    const policyDecision = PolicyEngine.evaluate({
      order: normalizedOrder,
      intent,
      policy,
      authoritativeProduct,
    });

    if (policyDecision.decision !== 'ALLOW') {
      const now = new Date();
      // Blocked by policy: mark order status
      await this.db.query(`UPDATE orders SET status = 'BLOCKED_BY_POLICY', updated_at = $1 WHERE id = $2`, [
        now,
        order.id,
      ]);

      // Audit log violation
      await this.db.query(
        `INSERT INTO audit_events (id, user_id, correlation_id, event_type, resource_type, resource_id, details)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          `aud_${uuidv4().replace(/-/g, '')}`,
          input.userId,
          correlationId,
          'CAPTURE_BLOCKED_BY_POLICY',
          'order',
          order.id,
          JSON.stringify({
            reasonCodes: policyDecision.reasonCodes,
            violations: policyDecision.violations,
          }),
        ]
      );

      // Rejection: ZERO calls to PayPal capture!
      throw AppError.policyRejected(
        `Transaction blocked by IntentGuard deterministic policy: ${policyDecision.violations.join(' | ')}`,
        { reasonCodes: policyDecision.reasonCodes }
      );
    }

    // 7. Cryptographic Single-Use Authorization Reservation
    // Atomic consumption prevents concurrent execution or replay
    await this.approvalService.consumeAuthorization({
      authorizationToken: input.authorizationToken,
      orderId: order.id,
      checkoutId: input.checkoutId,
      intentId: intent.id,
      policyVersion: policy.version,
      userId: input.userId,
      policyFingerprint: policy.canonicalHash,
    });

    // 8. State transition to CAPTURE_PENDING
    const now = new Date();
    await this.db.query(`UPDATE orders SET status = 'CAPTURE_PENDING', updated_at = $1 WHERE id = $2`, [
      now,
      order.id,
    ]);

    // 9. Execute PayPal Capture (Only reached when all checks passed!)
    const captureResult = await this.provider.captureOrder(order.provider_order_id, input.idempotencyKey);

    // 10. Persist Result & State Transition
    let finalState: PaymentState;
    let providerCaptureId: string | undefined;

    if (captureResult.status === 'COMPLETED') {
      finalState = 'CAPTURE_COMPLETED';
      providerCaptureId = captureResult.captureId;
    } else if (captureResult.isAmbiguousTimeout || captureResult.status === 'UNKNOWN') {
      finalState = 'UNKNOWN_PENDING_RECONCILIATION';
    } else {
      finalState = 'CAPTURE_FAILED';
    }

    const payloadHash = sha256Hex(JSON.stringify(input));
    const attemptId = `att_${uuidv4().replace(/-/g, '')}`;

    // Record capture attempt
    await this.db.query(
      `INSERT INTO capture_attempts (
        id, idempotency_key, order_id, status, provider_capture_id, attempt_count, request_payload_hash, response_payload, error_message
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        attemptId,
        input.idempotencyKey,
        order.id,
        finalState,
        providerCaptureId || null,
        1,
        payloadHash,
        captureResult.rawResponse ? JSON.stringify(captureResult.rawResponse) : null,
        captureResult.errorMessage || null,
      ]
    );

    // Update order status
    await this.db.query(`UPDATE orders SET status = $1, updated_at = $2 WHERE id = $3`, [
      finalState,
      new Date(),
      order.id,
    ]);

    // Audit log
    await this.db.query(
      `INSERT INTO audit_events (id, user_id, correlation_id, event_type, resource_type, resource_id, details)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        `aud_${uuidv4().replace(/-/g, '')}`,
        input.userId,
        correlationId,
        'ORDER_CAPTURED',
        'order',
        order.id,
        JSON.stringify({
          finalState,
          providerCaptureId,
          idempotencyKey: input.idempotencyKey,
          errorMessage: captureResult.errorMessage,
        }),
      ]
    );

    return {
      orderId: order.id,
      status: finalState,
      providerCaptureId,
      amountCents: providerOrder.totalAmountCents,
      currency: providerOrder.currency,
      idempotencyKey: input.idempotencyKey,
      reconciliationRequired: finalState === 'UNKNOWN_PENDING_RECONCILIATION',
      message:
        finalState === 'UNKNOWN_PENDING_RECONCILIATION'
          ? 'Network timeout during capture. Order status is UNKNOWN awaiting reconciliation.'
          : undefined,
    };
  }
}
