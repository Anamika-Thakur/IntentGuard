# IntentGuard REST API Contract & Machine-Readable Specification

## 1. Authentication & Security Headers

All protected endpoints require an HTTP Bearer Token:
```http
Authorization: Bearer <valid_user_or_admin_token>
```
For payment capture and mutating calls, correlation and idempotency headers are supported and enforced:
- `x-request-id`: Client-supplied correlation UUID (propagated in response).
- `Idempotency-Key`: Unique UUID per capture attempt (required on `/guarded-capture`).

---

## 2. API Endpoints

### 2.1 Health & Diagnostics
- **`GET /health/live`**: Server liveness probe.
- **`GET /health/ready`**: Server & database readiness probe.

### 2.2 Intent Lifecycle
- **`POST /api/intents`**: Create a purchasing intent in `DRAFT` status.
  - **Payload**:
    ```json
    {
      "merchantId": "MERCHANT_ACME_STORE",
      "allowedSku": "SKU-WIDGET-01",
      "maxQuantity": 2,
      "maxTotalCents": 5000,
      "currency": "USD",
      "durationMinutes": 60
    }
    ```
- **`GET /api/intents/:intentId`**: Retrieve intent and active policy constraints.
- **`POST /api/intents/:intentId/approve`**: Authenticated explicit user approval.
  - **Payload**:
    ```json
    { "checkoutId": "chk_session_123" }
    ```
  - **Response**:
    ```json
    {
      "intentId": "int_...",
      "status": "APPROVED",
      "policyVersion": 1,
      "policyFingerprint": "sha256_hash",
      "authorizationToken": "v1.payload.hmac",
      "expiresAt": "2026-11-01T..."
    }
    ```

### 2.3 Orders & Payment
- **`POST /api/orders`**: Create PayPal order bound to an approved intent.
  - **Payload**: `{ "intentId": "int_...", "quantity": 1 }`
- **`POST /api/orders/:orderId/validate`**: Deterministic policy evaluation without payment capture.
- **`POST /api/orders/:orderId/guarded-capture`**: Executes guarded payment capture.
  - **Headers**: `Idempotency-Key: <unique_id>`
  - **Payload**:
    ```json
    {
      "authorizationToken": "v1.payload.hmac",
      "checkoutId": "chk_session_123"
    }
    ```
- **`GET /api/orders/:orderId/status`**: Fetch order and capture attempt status.

### 2.4 Audit Log
- **`GET /api/audit?page=1&limit=20`**: Paginated, user-scoped audit trail records.

### 2.5 AI Agent & MCP Boundary
- **`POST /api/agent/propose`**: Natural-language proposal with prompt-injection defense.
- **`POST /api/agent/mcp`**: Secure MCP tool execution (`propose_purchase`, `get_intent_status`, etc.).

---

## 3. Standard Error Envelope

```json
{
  "error": {
    "code": "POLICY_REJECTED | BAD_REQUEST | UNAUTHORIZED | FORBIDDEN | NOT_FOUND | CONFLICT | RATE_LIMITED | INTERNAL_ERROR",
    "message": "Human-readable description of error",
    "requestId": "correlation-uuid",
    "details": []
  }
}
```
