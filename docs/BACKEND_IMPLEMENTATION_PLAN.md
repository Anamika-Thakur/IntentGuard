# IntentGuard Backend: Architecture & Implementation Plan

## 1. Executive Summary & Repository Audit

### Current Repository State (Phase 0 Audit)
- **Repository Contents:** Only `IntentGuard_Backend_Phase_by_Phase_Prompts.md` exists prior to Phase 1.
- **Existing Backend / Codebase:** Green-field implementation. No legacy code or pre-existing dependencies.
- **Identified Core Security Principles:**
  1. The browser and AI agent are untrusted actors.
  2. The trusted server-side backend alone holds PayPal credentials and cryptographic authorization keys.
  3. The policy engine, not an LLM, makes deterministic authorization decisions.
  4. Explicit, authenticated user approval is mandatory for any purchase policy.
  5. Cryptographic authorization binding (HMAC-SHA-256 / fingerprints) protects against tampering, replay, and session confusion.
  6. Every capture request re-verifies live order state directly against PayPal before capture.
  7. Policy evaluation failures result in zero calls to the capture endpoint.
  8. Idempotency and atomic database locking prevent concurrent duplicate captures.
  9. Monetary values are handled exclusively in integer minor units (e.g. cents).

---

## 2. Proposed Architecture & System Structure

```
IntentGuard Backend Architecture
┌───────────────────────────────┐
│ Client / AI Agent (Untrusted) │
└───────────────┬───────────────┘
                │ HTTP (JSON + Auth Token)
                ▼
┌─────────────────────────────────────────────────────────────┐
│ Express Web API Layer                                       │
│  - Security Headers (Helmet), CORS, JSON Body Limits        │
│  - Request ID Correlation, Input Validation (Zod)           │
│  - Auth Middleware (JWT / Principal verification)           │
│  - Rate Limiting, Audit Interceptor                         │
├─────────────────────────────────────────────────────────────┤
│ Application Services Layer                                  │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ Policy Engine (Deterministic Rule Evaluator)           │ │
│  │  - Whitelist, Merchant, Currency, SKU, Minor Units     │ │
│  └────────────────────────────────────────────────────────┘ │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ Cryptographic Binding & Approval Service               │ │
│  │  - Canonicalizer, SHA-256 Fingerprints                 │ │
│  │  - Server HMAC-SHA-256, Replay Prevention              │ │
│  └────────────────────────────────────────────────────────┘ │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ Guarded Capture Orchestrator & State Machine           │ │
│  │  - Atomic reservation, Idempotency tracking            │ │
│  │  - Ambiguous payment reconciliation                    │ │
│  └────────────────────────────────────────────────────────┘ │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ Payment Provider Adapter (PayPal Orders v2 Sandbox)    │ │
│  │  - OAuth 2.0 Token Manager with caching                │ │
│  │  - Create Order, Get Order, Capture Order              │ │
│  └────────────────────────────────────────────────────────┘ │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ AI / MCP Tool Boundary                                 │ │
│  │  - Proposal validator, Strict Schema Sanitizer         │ │
│  │  - Prompt-injection defense, Least-privilege tools     │ │
│  └────────────────────────────────────────────────────────┘ │
├─────────────────────────────────────────────────────────────┤
│ Data Access Layer & Storage                                 │
│  - PostgreSQL (via `pg` pool + SQL migrations)             │
│  - In-memory PG-compatible driver for hermetic unit testing │
│  - Tables: users, intents, catalogue_products, merchants,  │
│    orders, capture_attempts, authorizations, audit_events   │
└─────────────────────────────────────────────────────────────┘
```

---

## 3. Database Schema Design

All monetary amounts are integers representing minor currency units (e.g., $15.50 USD = 1550 cents). No floating-point math is used.

### Tables
1. **`users`**: User principals (`id`, `email`, `role`, `created_at`).
2. **`merchants`**: Verified merchants (`id`, `merchant_id`, `name`, `verified`, `created_at`).
3. **`catalogue_products`**: Authoritative server-side catalogue (`id`, `merchant_id`, `sku`, `title`, `unit_price_cents`, `currency`, `active`).
4. **`intents`**: Purchasing intents (`id`, `user_id`, `status` [DRAFT, APPROVED, REVOKED, EXPIRED, CONSUMED], `version`, `created_at`, `updated_at`, `expires_at`).
5. **`intent_policies`**: Versioned immutable purchasing policies (`id`, `intent_id`, `version`, `merchant_id`, `allowed_sku`, `max_quantity`, `max_total_cents`, `currency`, `allowed_conditions`, `canonical_hash`, `created_at`).
6. **`authorizations`**: Cryptographic authorization records (`id`, `intent_id`, `policy_version`, `user_id`, `checkout_id`, `auth_token_hash`, `key_id`, `expires_at`, `consumed_at`, `consumed_order_id`, `created_at`).
7. **`orders`**: Checkout & PayPal order references (`id`, `user_id`, `intent_id`, `provider_order_id`, `status` [CREATED, APPROVED_BY_BUYER, VALIDATED, CAPTURE_PENDING, CAPTURED, FAILED, UNKNOWN_PENDING_RECONCILIATION], `amount_cents`, `currency`, `created_at`, `updated_at`).
8. **`capture_attempts`**: Idempotent capture records (`id`, `idempotency_key`, `order_id`, `status`, `provider_capture_id`, `attempt_count`, `request_payload_hash`, `response_payload`, `error_message`, `created_at`, `updated_at`).
9. **`audit_events`**: Immutable append-only audit trail (`id`, `user_id`, `correlation_id`, `event_type`, `resource_type`, `resource_id`, `details`, `created_at`).

---

## 4. API Specification

| Method | Endpoint | Description | Auth Required |
|---|---|---|---|
| `GET` | `/health/live` | Liveness probe | No |
| `GET` | `/health/ready` | Readiness probe (DB & config check) | No |
| `POST` | `/api/intents` | Create intent proposal (DRAFT) | Yes (User) |
| `GET` | `/api/intents/:intentId` | Fetch intent details | Yes (Owner) |
| `POST` | `/api/intents/:intentId/approve` | Explicit user approval -> cryptographic binding | Yes (Owner) |
| `POST` | `/api/orders` | Create PayPal order from approved intent | Yes (Owner) |
| `POST` | `/api/orders/:orderId/validate` | Deterministic policy evaluation without capture | Yes (Owner) |
| `POST` | `/api/orders/:orderId/guarded-capture` | Atomically guarded capture execution | Yes (Owner) |
| `GET` | `/api/orders/:orderId/status` | Current order status | Yes (Owner) |
| `GET` | `/api/audit` | Paginated user audit log | Yes (Owner/Admin) |
| `POST` | `/api/agent/propose` | AI agent proposal submission | Yes (User) |
| `POST` | `/api/agent/mcp` | MCP tool execution boundary | Yes (User) |

---

## 5. Security Threat Model & Trust Boundaries

| Boundary | Untrusted Element | Defense Mechanism |
|---|---|---|
| **AI Model / MCP** | Untrusted proposal text, prompt injection | Strict schema parsing (Zod), policy engine verification, no access to payment tokens or credentials, explicit human approval required. |
| **Client / Browser** | Tampered product ID, price, currency, or intent ID | Authoritative catalogue lookup on server, cryptographic HMAC binding of approved intent + checkout context, server-side PayPal order retrieval. |
| **Payment Provider** | Flaky networks, dropped capture response, duplicate calls | Idempotency keys, atomic row locking (`SELECT FOR UPDATE`), explicit status `UNKNOWN_PENDING_RECONCILIATION`, automated reconciliation against PayPal Orders API. |
| **Replay / Concurrency** | Dual capture requests sent simultaneously | Atomic single-use authorization consumption in DB transaction with unique constraints on `consumed_at`/`consumed_order_id`. |
| **Secret Management** | Exposure of PayPal Client Secret or HMAC keys | Strict environment validation, sensitive log redaction, server-only secret storage, zero secrets in client responses. |

---

## 6. Implementation Checklist & Phase Plan

- [x] **Phase 0:** Audit & Architecture Specification (`BACKEND_IMPLEMENTATION_PLAN.md`)
- [ ] **Phase 1:** Backend foundation, strict TypeScript, Express, logger, errors, migrations, Vitest setup.
- [ ] **Phase 2:** Database models, migrations, and deterministic policy engine with comprehensive unit tests.
- [ ] **Phase 3:** Explicit approval workflow, canonical hashing (SHA-256), HMAC authorization, replay tests.
- [ ] **Phase 4:** PayPal Orders v2 Sandbox adapter with OAuth caching, order retrieval, normalization, mocks & tests.
- [ ] **Phase 5:** Guarded capture service, state machine, idempotency, atomic reservation, concurrency tests.
- [ ] **Phase 6:** Express API routes, auth/ownership middleware, rate limiting, audit trail, OpenAPI schema.
- [ ] **Phase 7:** AI agent and MCP boundary, schema enforcement, prompt-injection defense tests.
- [ ] **Phase 8:** Comprehensive end-to-end test suite execution, threat verification, and `SECURITY_TEST_REPORT.md`.
