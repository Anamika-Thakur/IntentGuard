/**
 * IntentGuard Real Backend API Service
 * All functions connect directly to real backend endpoints.
 * Zero mock data.
 */

const DEFAULT_AUTH_TOKEN = 'test-user-token'; // Alice principal: usr_test_123

export interface IntentResponse {
  intentId: string;
  version: number;
  status: string;
  merchantId: string;
  allowedSku: string;
  maxQuantity: number;
  maxTotalCents: number;
  currency: string;
  expiresAt: string;
  message?: string;
}

export interface ApprovalResponse {
  intentId: string;
  status: string;
  policyVersion: number;
  checkoutId: string;
  policyFingerprint: string;
  authorizationToken: string;
  expiresAt: string;
}

export interface OrderResponse {
  orderId: string;
  providerOrderId: string;
  status: string;
  amountCents: number;
  currency: string;
  approvalUrl?: string;
  message?: string;
}

export interface ValidationResponse {
  orderId: string;
  providerOrderId: string;
  decision: 'ALLOW' | 'BLOCK';
  reasonCodes: string[];
  policyVersion: number;
  evaluatedAt: string;
  violations: string[];
  message?: string;
}

export interface CaptureResponse {
  orderId: string;
  status: string;
  providerCaptureId?: string;
  amountCents?: number;
  currency?: string;
  idempotencyKey: string;
  message?: string;
}

export interface OrderStatusResponse {
  orderId: string;
  providerOrderId: string;
  intentId: string;
  status: string;
  amountCents: number;
  currency: string;
  capture?: {
    status: string;
    providerCaptureId?: string;
    idempotencyKey: string;
    attemptCount: number;
    createdAt: string;
  } | null;
}

export interface AuditItem {
  id: string;
  userId: string;
  correlationId: string;
  eventType: string;
  resourceType: string;
  resourceId: string;
  details: Record<string, unknown>;
  createdAt: string;
}

export interface AuditResponse {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  items: AuditItem[];
}

export interface CatalogueProduct {
  id: string;
  merchantId: string;
  merchantName: string;
  sku: string;
  title: string;
  unitPriceCents: number;
  priceFormatted: string;
  currency: string;
  active: boolean;
}

export interface ProposalParseResult {
  sanitizedPrompt: string;
  proposal: {
    merchantId: string;
    sku: string;
    maxQuantity: number;
    maxTotalCents: number;
    currency: string;
    userNote?: string;
  };
  status: string;
  message: string;
}

class ApiService {
  private token: string = DEFAULT_AUTH_TOKEN;

  public setToken(token: string): void {
    this.token = token;
  }

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.token}`,
      ...(options.headers as Record<string, string>),
    };

    const res = await fetch(path, {
      ...options,
      headers,
    });

    const data = await res.json();

    if (!res.ok) {
      const errorMsg = data?.error?.message || `Request failed with status ${res.status}`;
      const err = new Error(errorMsg);
      (err as unknown as { details?: unknown }).details = data?.error;
      throw err;
    }

    return data as T;
  }

  async checkHealth(): Promise<{ status: string; uptimeSeconds?: number }> {
    return this.request('/health/live');
  }

  async fetchCatalogueProducts(): Promise<{ items: CatalogueProduct[] }> {
    return this.request('/api/catalogue/products');
  }

  async createCatalogueProduct(data: {
    merchantId: string;
    merchantName?: string;
    sku: string;
    title: string;
    unitPriceCents: number;
    currency?: string;
  }): Promise<CatalogueProduct> {
    return this.request('/api/catalogue/products', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async parseAgentPrompt(prompt: string): Promise<ProposalParseResult> {
    return this.request('/api/agent/propose', {
      method: 'POST',
      body: JSON.stringify({ prompt }),
    });
  }

  async createIntent(data: {
    merchantId: string;
    allowedSku: string;
    maxQuantity: number;
    maxTotalCents: number;
    currency: string;
    durationMinutes?: number;
  }): Promise<IntentResponse> {
    return this.request('/api/intents', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async getIntent(intentId: string): Promise<Record<string, unknown>> {
    return this.request(`/api/intents/${encodeURIComponent(intentId)}`);
  }

  async approveIntent(intentId: string, checkoutId: string): Promise<ApprovalResponse> {
    return this.request(`/api/intents/${encodeURIComponent(intentId)}/approve`, {
      method: 'POST',
      body: JSON.stringify({ checkoutId }),
    });
  }

  async createOrder(intentId: string, quantity: number = 1): Promise<OrderResponse> {
    return this.request('/api/orders', {
      method: 'POST',
      body: JSON.stringify({ intentId, quantity }),
    });
  }

  async validateOrder(orderId: string): Promise<ValidationResponse> {
    return this.request(`/api/orders/${encodeURIComponent(orderId)}/validate`, {
      method: 'POST',
    });
  }

  async executeGuardedCapture(params: {
    orderId: string;
    idempotencyKey: string;
    authorizationToken: string;
    checkoutId: string;
  }): Promise<CaptureResponse> {
    return this.request(`/api/orders/${encodeURIComponent(params.orderId)}/guarded-capture`, {
      method: 'POST',
      headers: {
        'Idempotency-Key': params.idempotencyKey,
      },
      body: JSON.stringify({
        authorizationToken: params.authorizationToken,
        checkoutId: params.checkoutId,
      }),
    });
  }

  async getOrderStatus(orderId: string): Promise<OrderStatusResponse> {
    return this.request(`/api/orders/${encodeURIComponent(orderId)}/status`);
  }

  async getAuditEvents(page = 1, limit = 20): Promise<AuditResponse> {
    return this.request(`/api/audit?page=${page}&limit=${limit}`);
  }
}

export const api = new ApiService();
