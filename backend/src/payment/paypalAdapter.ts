import { config } from '../config/index.js';
import { logger } from '../logger/index.js';
import { AppError } from '../errors/index.js';
import {
  PaymentProvider,
  CreateOrderInput,
  ProviderOrder,
  CaptureResult,
  ProviderOrderStatus,
  ProviderOrderItem,
} from './types.js';

interface OAuthTokenCache {
  accessToken: string;
  expiresAt: number;
}

export class PayPalSandboxAdapter implements PaymentProvider {
  private baseUrl: string;
  private clientId: string;
  private clientSecret: string;
  private tokenCache: OAuthTokenCache | null = null;
  private timeoutMs: number;

  constructor(options?: {
    baseUrl?: string;
    clientId?: string;
    clientSecret?: string;
    timeoutMs?: number;
  }) {
    this.baseUrl = options?.baseUrl || config.PAYPAL_API_BASE_URL;
    this.clientId = options?.clientId || config.PAYPAL_CLIENT_ID;
    this.clientSecret = options?.clientSecret || config.PAYPAL_CLIENT_SECRET;
    this.timeoutMs = options?.timeoutMs || 8000;

    if (config.PAYPAL_ENV === 'production' || this.baseUrl.includes('api.paypal.com')) {
      throw new Error('CRITICAL SECURITY: Production PayPal credentials are strictly prohibited.');
    }
  }

  /**
   * Acquires or returns a cached OAuth2 access token using client credentials grant.
   */
  async getAccessToken(): Promise<string> {
    const now = Date.now();
    if (this.tokenCache && this.tokenCache.expiresAt > now + 60000) {
      return this.tokenCache.accessToken;
    }

    const authHeader = `Basic ${Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64')}`;

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);

      const res = await fetch(`${this.baseUrl}/v1/oauth2/token`, {
        method: 'POST',
        headers: {
          Authorization: authHeader,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: 'grant_type=client_credentials',
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (!res.ok) {
        const errorText = await res.text();
        logger.error('PayPal OAuth token error', { status: res.status, body: errorText });
        throw AppError.providerError(`PayPal OAuth failure: ${res.statusText}`);
      }

      const data = (await res.json()) as { access_token: string; expires_in: number };
      this.tokenCache = {
        accessToken: data.access_token,
        expiresAt: now + data.expires_in * 1000,
      };

      return data.access_token;
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw AppError.providerError(
        `PayPal OAuth request failed: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  /**
   * Creates an order in PayPal Sandbox using authoritative server-side numbers.
   */
  async createOrder(input: CreateOrderInput): Promise<ProviderOrder> {
    const accessToken = await this.getAccessToken();
    const totalAmount = (input.quantity * input.unitPriceCents) / 100;
    const unitPrice = input.unitPriceCents / 100;

    const payload = {
      intent: 'CAPTURE',
      purchase_units: [
        {
          reference_id: input.intentId,
          custom_id: input.userId,
          amount: {
            currency_code: input.currency.toUpperCase(),
            value: totalAmount.toFixed(2),
            breakdown: {
              item_total: {
                currency_code: input.currency.toUpperCase(),
                value: totalAmount.toFixed(2),
              },
            },
          },
          items: [
            {
              name: `SKU-${input.sku}`,
              sku: input.sku,
              unit_amount: {
                currency_code: input.currency.toUpperCase(),
                value: unitPrice.toFixed(2),
              },
              quantity: String(input.quantity),
            },
          ],
        },
      ],
      application_context: {
        return_url: input.returnUrl || 'https://intentguard.local/checkout/return',
        cancel_url: input.cancelUrl || 'https://intentguard.local/checkout/cancel',
        user_action: 'PAY_NOW',
      },
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await fetch(`${this.baseUrl}/v2/checkout/orders`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (!res.ok) {
        const errorText = await res.text();
        logger.error('PayPal Order creation failed', { status: res.status, error: errorText });
        throw AppError.providerError(`PayPal Create Order failed: ${res.statusText}`);
      }

      const data = (await res.json()) as {
        id: string;
        status: string;
        links?: Array<{ href: string; rel: string }>;
      };

      const approvalLink = data.links?.find((l) => l.rel === 'approve' || l.rel === 'payer-action')?.href;

      return {
        id: data.id,
        status: data.status as ProviderOrderStatus,
        currency: input.currency.toUpperCase(),
        totalAmountCents: input.quantity * input.unitPriceCents,
        merchantId: input.merchantId,
        items: [
          {
            sku: input.sku,
            quantity: input.quantity,
            unitPriceCents: input.unitPriceCents,
          },
        ],
        approvalUrl: approvalLink,
      };
    } catch (err) {
      clearTimeout(timer);
      if (err instanceof AppError) throw err;
      throw AppError.providerError(
        `Failed communicating with PayPal Create Order: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  /**
   * Retrieves current order directly from PayPal and normalizes it.
   */
  async getOrder(orderId: string): Promise<ProviderOrder> {
    const accessToken = await this.getAccessToken();

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await fetch(`${this.baseUrl}/v2/checkout/orders/${encodeURIComponent(orderId)}`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (!res.ok) {
        if (res.status === 404) {
          throw AppError.notFound(`PayPal order '${orderId}' not found on provider.`);
        }
        throw AppError.providerError(`PayPal Get Order failed: ${res.statusText}`);
      }

      const data = (await res.json()) as {
        id: string;
        status: string;
        purchase_units?: Array<{
          amount?: { currency_code: string; value: string };
          items?: Array<{ sku: string; quantity: string; unit_amount?: { value: string } }>;
          payee?: { merchant_id?: string; email_address?: string };
        }>;
        links?: Array<{ href: string; rel: string }>;
      };

      const unit = data.purchase_units?.[0];
      if (!unit || !unit.amount) {
        throw AppError.providerError('Malformed PayPal order: missing purchase_units or amount.');
      }

      const totalAmountCents = Math.round(parseFloat(unit.amount.value) * 100);
      const items: ProviderOrderItem[] = (unit.items || []).map((i) => ({
        sku: i.sku || 'UNKNOWN',
        quantity: parseInt(i.quantity, 10) || 1,
        unitPriceCents: i.unit_amount?.value ? Math.round(parseFloat(i.unit_amount.value) * 100) : 0,
      }));

      const approvalLink = data.links?.find((l) => l.rel === 'approve' || l.rel === 'payer-action')?.href;

      return {
        id: data.id,
        status: data.status as ProviderOrderStatus,
        currency: unit.amount.currency_code.toUpperCase(),
        totalAmountCents,
        merchantId: unit.payee?.merchant_id,
        items,
        approvalUrl: approvalLink,
        rawResponse: data,
      };
    } catch (err) {
      clearTimeout(timer);
      if (err instanceof AppError) throw err;
      throw AppError.providerError(
        `Failed retrieving PayPal Order: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  /**
   * Captures an approved order using PayPal-Request-Id for native idempotency.
   */
  async captureOrder(orderId: string, requestId: string): Promise<CaptureResult> {
    const accessToken = await this.getAccessToken();

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await fetch(
        `${this.baseUrl}/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            'PayPal-Request-Id': requestId,
          },
          body: JSON.stringify({}),
          signal: controller.signal,
        }
      );

      clearTimeout(timer);

      const data = (await res.json()) as {
        status?: string;
        purchase_units?: Array<{
          payments?: {
            captures?: Array<{ id: string; status: string; amount?: { value: string; currency_code: string } }>;
          };
        }>;
        message?: string;
        details?: Array<{ issue: string; description: string }>;
      };

      if (!res.ok) {
        const errorDetail = data.details?.[0]?.description || data.message || res.statusText;
        return {
          status: 'FAILED',
          errorMessage: errorDetail,
          rawResponse: data,
        };
      }

      const capture = data.purchase_units?.[0]?.payments?.captures?.[0];
      const captureStatus = capture?.status || data.status;

      if (captureStatus === 'COMPLETED') {
        return {
          captureId: capture?.id,
          status: 'COMPLETED',
          amountCents: capture?.amount?.value ? Math.round(parseFloat(capture.amount.value) * 100) : undefined,
          currency: capture?.amount?.currency_code,
          rawResponse: data,
        };
      }

      if (captureStatus === 'PENDING') {
        return {
          captureId: capture?.id,
          status: 'PENDING',
          rawResponse: data,
        };
      }

      return {
        status: 'DECLINED',
        errorMessage: `Capture status: ${captureStatus}`,
        rawResponse: data,
      };
    } catch (err: unknown) {
      clearTimeout(timer);
      const isAbort =
        (err instanceof Error && err.name === 'AbortError') ||
        (typeof err === 'object' && err !== null && 'name' in err && err.name === 'AbortError');

      if (isAbort) {
        logger.warn(`PayPal capture request timed out (ambiguous outcome) for order ${orderId}`, { requestId });
        return {
          status: 'UNKNOWN',
          isAmbiguousTimeout: true,
          errorMessage: 'PayPal capture request timed out before response was received.',
        };
      }

      return {
        status: 'FAILED',
        errorMessage: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
