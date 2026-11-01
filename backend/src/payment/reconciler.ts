import { IDatabaseClient, getDbClient } from '../db/client.js';
import { PaymentProvider } from './types.js';
import { PaymentStateMachine } from './stateMachine.js';
import { AppError } from '../errors/index.js';
import { logger } from '../logger/index.js';
import { v4 as uuidv4 } from 'uuid';

export class ReconciliationService {
  constructor(
    private db: IDatabaseClient = getDbClient(),
    private provider: PaymentProvider
  ) {}

  /**
   * Reconciles an order currently stuck in UNKNOWN_PENDING_RECONCILIATION state
   * by verifying the authoritative status directly on PayPal.
   */
  async reconcileOrder(orderId: string, correlationId: string = uuidv4()): Promise<{
    orderId: string;
    resolvedStatus: 'CAPTURE_COMPLETED' | 'CAPTURE_FAILED';
    reconciliationNotes: string;
  }> {
    const orderRes = await this.db.query(
      `SELECT * FROM orders WHERE id = $1`,
      [orderId]
    );

    if (orderRes.rowCount === 0) {
      throw AppError.notFound(`Order '${orderId}' not found for reconciliation.`);
    }

    const order = orderRes.rows[0];
    if (!order) {
      throw AppError.notFound(`Order '${orderId}' not found for reconciliation.`);
    }

    if (order.status !== 'UNKNOWN_PENDING_RECONCILIATION') {
      throw AppError.badRequest(
        `Order '${orderId}' does not require reconciliation. Current status: '${order.status}'.`
      );
    }

    logger.info(`Reconciling ambiguous order ${orderId} with PayPal...`, { correlationId });

    // Retrieve live truth from PayPal
    const providerOrder = await this.provider.getOrder(order.provider_order_id);

    let nextStatus: 'CAPTURE_COMPLETED' | 'CAPTURE_FAILED';
    let notes: string;

    if (providerOrder.status === 'COMPLETED') {
      nextStatus = 'CAPTURE_COMPLETED';
      notes = 'Reconciliation confirmed PayPal capture completed successfully.';
    } else {
      nextStatus = 'CAPTURE_FAILED';
      notes = `Reconciliation confirmed order was not captured on PayPal (provider status: ${providerOrder.status}).`;
    }

    PaymentStateMachine.assertTransition(order.status, nextStatus);

    const now = new Date();
    await this.db.query(
      `UPDATE orders SET status = $1, updated_at = $2 WHERE id = $3`,
      [nextStatus, now, orderId]
    );

    await this.db.query(
      `UPDATE capture_attempts 
       SET status = $1, error_message = $2, updated_at = $3 
       WHERE order_id = $4 AND status = 'UNKNOWN'`,
      [nextStatus, notes, now, orderId]
    );

    await this.db.query(
      `INSERT INTO audit_events (id, user_id, correlation_id, event_type, resource_type, resource_id, details)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        `aud_${uuidv4().replace(/-/g, '')}`,
        order.user_id,
        correlationId,
        'ORDER_RECONCILED',
        'order',
        orderId,
        JSON.stringify({
          previousStatus: 'UNKNOWN_PENDING_RECONCILIATION',
          resolvedStatus: nextStatus,
          notes,
          providerOrderId: order.provider_order_id,
        }),
      ]
    );

    return {
      orderId,
      resolvedStatus: nextStatus,
      reconciliationNotes: notes,
    };
  }
}
