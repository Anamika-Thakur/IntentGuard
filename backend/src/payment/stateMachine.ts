import { AppError } from '../errors/index.js';

export type PaymentState =
  | 'CREATED'
  | 'AWAITING_BUYER_APPROVAL'
  | 'READY_FOR_VALIDATION'
  | 'BLOCKED_BY_POLICY'
  | 'CAPTURE_PENDING'
  | 'CAPTURE_COMPLETED'
  | 'CAPTURE_FAILED'
  | 'UNKNOWN_PENDING_RECONCILIATION';

const PERMITTED_TRANSITIONS: Record<PaymentState, PaymentState[]> = {
  CREATED: ['AWAITING_BUYER_APPROVAL', 'READY_FOR_VALIDATION', 'BLOCKED_BY_POLICY'],
  AWAITING_BUYER_APPROVAL: ['READY_FOR_VALIDATION', 'BLOCKED_BY_POLICY', 'CAPTURE_FAILED'],
  READY_FOR_VALIDATION: ['BLOCKED_BY_POLICY', 'CAPTURE_PENDING'],
  BLOCKED_BY_POLICY: [], // Terminal
  CAPTURE_PENDING: ['CAPTURE_COMPLETED', 'CAPTURE_FAILED', 'UNKNOWN_PENDING_RECONCILIATION'],
  CAPTURE_COMPLETED: [], // Terminal
  CAPTURE_FAILED: [], // Terminal
  UNKNOWN_PENDING_RECONCILIATION: ['CAPTURE_COMPLETED', 'CAPTURE_FAILED'], // Can only be resolved by reconciliation
};

export class PaymentStateMachine {
  public static assertTransition(from: PaymentState, to: PaymentState): void {
    const allowed = PERMITTED_TRANSITIONS[from];
    if (!allowed || !allowed.includes(to)) {
      throw AppError.conflict(
        `Illegal payment state transition from '${from}' to '${to}'. Permitted next states: [${(allowed || []).join(', ')}]`
      );
    }
  }

  public static isTerminal(state: PaymentState): boolean {
    return PERMITTED_TRANSITIONS[state]?.length === 0;
  }
}
