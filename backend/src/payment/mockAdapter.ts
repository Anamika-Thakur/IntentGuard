import {
  PaymentProvider,
  CreateOrderInput,
  ProviderOrder,
  CaptureResult,
} from './types.js';
import { AppError } from '../errors/index.js';

export class MockPaymentProvider implements PaymentProvider {
  private orders: Map<string, ProviderOrder> = new Map();
  private captures: Map<string, CaptureResult> = new Map();
  private idCounter = 1000;

  // Fault injection controls
  public simulateCreateOrderFailure = false;
  public simulateGetOrderFailure = false;
  public simulateCaptureTimeout = false;
  public simulateCaptureDecline = false;
  public simulateMalformedResponse = false;

  async createOrder(input: CreateOrderInput): Promise<ProviderOrder> {
    if (this.simulateCreateOrderFailure) {
      throw AppError.providerError('Simulated PayPal order creation failure.');
    }

    const orderId = `PAYPAL_MOCK_${++this.idCounter}`;
    const totalAmountCents = input.quantity * input.unitPriceCents;

    const order: ProviderOrder = {
      id: orderId,
      status: 'CREATED',
      currency: input.currency.toUpperCase(),
      totalAmountCents,
      merchantId: input.merchantId,
      items: [
        {
          sku: input.sku,
          quantity: input.quantity,
          unitPriceCents: input.unitPriceCents,
        },
      ],
      approvalUrl: `https://www.sandbox.paypal.com/checkoutnow?token=${orderId}`,
    };

    this.orders.set(orderId, order);
    return order;
  }

  async getOrder(orderId: string): Promise<ProviderOrder> {
    if (this.simulateGetOrderFailure) {
      throw AppError.providerError('Simulated PayPal order retrieval failure.');
    }

    const order = this.orders.get(orderId);
    if (!order) {
      throw AppError.notFound(`PayPal order '${orderId}' not found on provider.`);
    }

    if (this.simulateMalformedResponse) {
      return {
        ...order,
        currency: '' as unknown as string,
        totalAmountCents: -1,
      };
    }

    return { ...order };
  }

  async captureOrder(orderId: string, requestId: string): Promise<CaptureResult> {
    // Check idempotency by requestId first
    const existingCapture = this.captures.get(requestId);
    if (existingCapture) {
      return existingCapture;
    }

    if (this.simulateCaptureTimeout) {
      return {
        status: 'UNKNOWN',
        isAmbiguousTimeout: true,
        errorMessage: 'Network timeout awaiting capture response from PayPal.',
      };
    }

    if (this.simulateCaptureDecline) {
      return {
        status: 'DECLINED',
        errorMessage: 'INSTRUMENT_DECLINED: The funding instrument was declined by the issuer.',
      };
    }

    const order = this.orders.get(orderId);
    if (!order) {
      throw AppError.notFound(`PayPal order '${orderId}' not found on provider.`);
    }

    if (order.status !== 'APPROVED' && order.status !== 'CREATED') {
      return {
        status: 'FAILED',
        errorMessage: `ORDER_NOT_APPROVED: Current provider status is '${order.status}'.`,
      };
    }

    const captureId = `CAP_${orderId}_${requestId.substring(0, 8)}`;
    order.status = 'COMPLETED';
    this.orders.set(orderId, order);

    const result: CaptureResult = {
      captureId,
      status: 'COMPLETED',
      amountCents: order.totalAmountCents,
      currency: order.currency,
    };

    this.captures.set(requestId, result);
    return result;
  }

  // Test helper to mutate provider state (e.g. simulate buyer approval or tampering)
  public setOrderStatus(orderId: string, status: ProviderOrder['status']): void {
    const order = this.orders.get(orderId);
    if (order) {
      order.status = status;
      this.orders.set(orderId, order);
    }
  }

  public tamperOrderAmount(orderId: string, tamperedAmountCents: number): void {
    const order = this.orders.get(orderId);
    if (order) {
      order.totalAmountCents = tamperedAmountCents;
      this.orders.set(orderId, order);
    }
  }

  public tamperOrderSku(orderId: string, tamperedSku: string): void {
    const order = this.orders.get(orderId);
    if (order && order.items[0]) {
      order.items[0].sku = tamperedSku;
      this.orders.set(orderId, order);
    }
  }

  public tamperOrderCurrency(orderId: string, tamperedCurrency: string): void {
    const order = this.orders.get(orderId);
    if (order) {
      order.currency = tamperedCurrency;
      this.orders.set(orderId, order);
    }
  }
}
