export type ProviderOrderStatus =
  | 'CREATED'
  | 'SAVED'
  | 'APPROVED'
  | 'VOIDED'
  | 'COMPLETED'
  | 'PAYER_ACTION_REQUIRED';

export interface ProviderOrderItem {
  sku: string;
  quantity: number;
  unitPriceCents: number;
}

export interface ProviderOrder {
  id: string; // PayPal Order ID (e.g., "5O190127TN364715T")
  status: ProviderOrderStatus;
  currency: string;
  totalAmountCents: number;
  merchantId?: string | undefined;
  items: ProviderOrderItem[];
  approvalUrl?: string | undefined;
  rawResponse?: Record<string, unknown> | undefined;
}

export interface CreateOrderInput {
  intentId: string;
  userId: string;
  merchantId: string;
  sku: string;
  quantity: number;
  unitPriceCents: number;
  currency: string;
  returnUrl?: string | undefined;
  cancelUrl?: string | undefined;
}

export interface CaptureResult {
  captureId?: string | undefined;
  status: 'COMPLETED' | 'DECLINED' | 'FAILED' | 'PENDING' | 'UNKNOWN';
  amountCents?: number | undefined;
  currency?: string | undefined;
  errorMessage?: string | undefined;
  isAmbiguousTimeout?: boolean | undefined;
  rawResponse?: Record<string, unknown> | undefined;
}

export interface PaymentProvider {
  createOrder(input: CreateOrderInput): Promise<ProviderOrder>;
  getOrder(orderId: string): Promise<ProviderOrder>;
  captureOrder(orderId: string, requestId: string): Promise<CaptureResult>;
}
