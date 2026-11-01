# IntentGuard Backend: Phase-by-Phase Implementation Prompts

**Purpose:** Build the IntentGuard backend in small, testable phases. Use one phase at a time in Cursor, GitHub Copilot, or another coding agent.

**Target stack:** Node.js, TypeScript, Express, PostgreSQL, PayPal Orders v2 Sandbox, automated tests.

**Core security principle:** An AI agent may propose a transaction, but only the trusted backend may authorize its progression toward payment capture.

## How to use this file

1. Open the existing IntentGuard repository in your coding agent.
2. Paste Phase 0 first. Review the audit before asking the agent to modify code.
3. Execute one phase at a time and verify its acceptance criteria.
4. If tests fail, fix the current phase before moving forward.
5. Do not use real payment credentials or production funds.
6. Do not let the coding agent claim a test passed unless it actually ran it.
7. Preserve useful existing code and the established frontend/API contract unless a documented change is necessary.

---

## Phase 0: Repository audit and implementation plan

### Prompt

Act as a senior backend architect. Inspect the entire existing IntentGuard repository and its backend engineering specification before changing code.

Identify:

1. Existing backend framework, language, entry point, dependencies, routes, models, database configuration, and tests.
2. Existing frontend/backend API contract and integration points.
3. Any existing cryptographic implementation, payment provider integration, authentication, and audit logging.
4. Missing features, security weaknesses, incomplete implementations, and duplicate or unnecessary modules.
5. Configuration and deployment constraints.

Create `docs/BACKEND_IMPLEMENTATION_PLAN.md` containing:

- Current architecture and repository structure.
- A proposed architecture that preserves useful existing work.
- A phase-by-phase implementation checklist.
- Database and API design.
- Security threat model and trust boundaries.
- Testing strategy and acceptance criteria.
- Dependencies that must be implemented before PayPal or AI-agent integration.

Do not implement the entire backend during this phase. Do not claim a feature exists merely because its files or names exist. Verify implementations and tests.

### Acceptance criteria

- The audit reflects the actual repository.
- Existing working code is preserved.
- Missing work is prioritized by security dependency.
- The implementation plan is saved and ready for review.

---

## Phase 1: Backend foundation and configuration

### Prompt

Implement the foundation of the IntentGuard backend using the repository's existing stack. If no backend exists, use Node.js, TypeScript, Express, PostgreSQL, and a suitable PostgreSQL migration tool.

Implement:

- A clean application entry point and Express application setup.
- Environment configuration validation at startup.
- Structured logging with sensitive-field redaction.
- Centralized error handling and consistent API error responses.
- Request IDs, input validation, JSON body-size limits, security headers, and appropriate CORS configuration.
- Liveness and readiness endpoints.
- Database connection management and migrations.
- A test framework and basic unit and integration test setup.
- Separate development and test configurations.
- A `.env.example` containing placeholders only.

Use strict TypeScript settings. Never commit `.env` files, credentials, access tokens, private keys, or real secrets. Use safe database practices and parameterized queries. Do not trust a user ID supplied in the request body as proof of identity.

Add scripts for development, building, linting, type-checking, testing, and database migrations.

### Acceptance criteria

- The backend starts with validated local configuration.
- Health endpoints behave correctly.
- Database migrations can be applied to a clean test database.
- Invalid requests produce consistent errors.
- Unit tests, type-checking, and linting pass.
- No real credentials are present in the repository.

---

## Phase 2: Database schema and deterministic policy engine

### Prompt

Implement IntentGuard's database model and deterministic policy engine. This phase must not call PayPal or use an AI model to make authorization decisions.

Create appropriate tables and migrations for:

- User or authenticated principal records, according to the existing authentication design.
- Intents and versioned purchasing policies.
- Trusted catalogue products and merchant identifiers.
- Checkout sessions and order references.
- Capture attempts and idempotency keys.
- Audit events.

Use foreign keys, unique constraints, indexes, and transactions where appropriate. Store timestamps consistently. Represent money as integer minor units, with explicit currency handling and no floating-point arithmetic for monetary comparisons.

An intent should support constraints such as:

- Allowed product and SKU.
- Trusted merchant identity.
- Currency.
- Exact or maximum quantity.
- Maximum payable total.
- Allowed purchase conditions, where supported.
- Policy version, creation time, expiry, and approval status.

Implement a deterministic policy evaluation service that returns a typed decision, reason codes, policy version, and evaluation timestamp.

At minimum, reject:

- Missing or unapproved intent.
- Expired intent.
- Wrong product, SKU, or merchant.
- Currency or quantity mismatch.
- Total above the approved limit.
- Invalid or inconsistent monetary data.
- Stale policy version.
- Invalid lifecycle state.

Resolve authoritative product and price information from trusted server-side data. Do not treat prices supplied by the browser or AI agent as authoritative. Fail closed whenever required facts cannot be verified.

Write unit tests for every rule, including boundary cases and combinations of failures. Define a consistent order-normalization interface, but do not implement live PayPal calls yet.

### Acceptance criteria

- Policy decisions are deterministic and independently testable.
- Monetary comparisons avoid floating-point arithmetic.
- Invalid or unverifiable orders never receive `ALLOW`.
- Policy versioning and expiry are enforced.
- Tests cover valid, invalid, boundary, and conflicting cases.

---

## Phase 3: Explicit approval and cryptographic authorization

### Prompt

Implement IntentGuard's explicit user-approval workflow and cryptographic binding layer.

The objective is to bind an authenticated user's approval to a specific, immutable set of purchasing constraints and the relevant checkout context. Cryptography must supplement, not replace, authentication, explicit consent, server-side policy checks, or secure state transitions.

Implement the following:

### 1. Approval workflow

- An intent begins in `DRAFT`.
- The authenticated user reviews the material purchase constraints.
- Approval is a deliberate, authenticated action.
- The server stores the approved policy version and approval timestamp.
- Any material policy change creates a new version and invalidates the previous authorization.
- Enforce expiry, ownership, and permitted state transitions.

### 2. Canonical representation

- Define a documented canonical representation of the policy and the relevant normalized order fields.
- Specify handling of field ordering, absent fields, Unicode, strings, integers, currency, and timestamps.
- Reject ambiguous or malformed values.
- Use the same tested canonicalization logic everywhere.

### 3. Cryptographic fingerprints

- Use SHA-256 to fingerprint canonical policy and order representations.
- Document that a hash provides integrity comparison, not proof of who approved something.
- Do not use a plain hash as a secret or authentication mechanism.

### 4. Server-side authorization binding

- Use HMAC-SHA-256 with a randomly generated, high-entropy server secret to authenticate authorization records, or use a well-designed digital-signature scheme if independently verifiable signatures are an explicit requirement.
- Keep secret material exclusively on the server.
- Include a key identifier and define key rotation behavior.
- Use constant-time comparison where applicable.
- Authenticate all relevant fields, including the policy version, session or checkout identifier, order binding, expiry, and one-time authorization identifier.

### 5. Replay and concurrency protection

- Store authorization consumption state server-side.
- Enforce single use with atomic database operations and unique constraints.
- Reject expired, reused, revoked, or mismatched authorizations.
- Make concurrent requests unable to consume the same authorization twice.

### 6. Security tests

Test:

- Altered policy and order fingerprints.
- Invalid signatures or MACs.
- Wrong session, order, or policy version.
- Expired authorization.
- Replayed authorization.
- Key rotation and unknown key identifiers.
- Concurrent authorization-consumption attempts.

Never put signing keys, HMAC secrets, or privileged authorization material in frontend code. Do not claim that an HMAC is a digital signature or that cryptographic binding independently proves human intent.

### Acceptance criteria

- Approval is explicit and authenticated.
- Authorization is bound to the approved policy version and checkout context.
- Alteration, expiry, replay, and concurrency attacks are rejected.
- Cryptographic verification has comprehensive tests.
- No secret material is returned to the browser or logged.

---

## Phase 4: PayPal Orders v2 Sandbox adapter

### Prompt

Implement a real PayPal Orders v2 integration in Sandbox mode, behind a provider adapter. Before coding, consult the current official PayPal documentation for OAuth authentication, order creation, buyer approval, order retrieval, capture semantics, status transitions, request identifiers, and error handling. Do not invent API fields or assume unsupported headers.

Implement a provider interface with operations equivalent to:

```ts
interface PaymentProvider {
  createOrder(input: CreateOrderInput): Promise<ProviderOrder>;
  getOrder(orderId: string): Promise<ProviderOrder>;
  captureOrder(orderId: string, requestId: string): Promise<CaptureResult>;
}
```

### Requirements

#### 1. Sandbox configuration

- Use the official Sandbox API base URL.
- Read the Sandbox client ID and client secret from server-side environment variables.
- Validate configuration at startup.
- Keep credentials out of source control, browser bundles, logs, and API responses.
- Never silently fall back to production.

#### 2. OAuth

- Obtain access tokens using the documented PayPal OAuth flow.
- Cache tokens safely until shortly before expiry.
- Handle token errors and timeouts.
- Do not expose access tokens to clients.

#### 3. Order creation

- Create orders using trusted server-side product, merchant, currency, quantity, and pricing data.
- Never trust browser-supplied totals.
- Store the PayPal order ID and bind it to the authenticated checkout and approved intent.
- Return only the fields the frontend needs.

#### 4. Buyer approval

- Implement the documented buyer approval flow.
- Distinguish buyer approval of the PayPal order from IntentGuard's separate authorization of the transaction.
- Validate callback or return parameters server-side. Never assume that visiting a return URL proves payment success.

#### 5. Order retrieval and normalization

- Retrieve the current order directly from PayPal before policy evaluation and guarded capture.
- Normalize relevant purchase-unit information, amounts, currency, merchant context where available, and lifecycle state.
- Verify that the provider response matches the stored checkout and approved intent.
- Fail closed when a required fact cannot be verified.

#### 6. Error handling

- Apply bounded network timeouts.
- Validate provider responses.
- Distinguish definitive rejection from network failure and ambiguous outcomes.
- Use documented request IDs or idempotency behavior where supported.
- Never blindly retry a capture after a timeout.

#### 7. Testing

- Mock PayPal for deterministic unit and integration tests.
- Add opt-in Sandbox integration tests that require explicit test credentials.
- Test token failures, malformed responses, missing fields, rejected orders, and network timeouts.
- Ensure tests never access production credentials.

Do not allow this phase to bypass the deterministic policy engine. Implement provider operations only; guarded capture orchestration will be completed in the next phase.

### Acceptance criteria

- Sandbox order creation and retrieval work against the documented API.
- Credentials remain server-side.
- Provider responses are validated and normalized.
- No real payment is made.
- Automated tests cover success and failure paths.
- Buyer approval is not confused with IntentGuard authorization or confirmed capture.

---

## Phase 5: Guarded capture, idempotency, and payment state machine

### Prompt

Implement the only permitted payment-capture path in IntentGuard. The AI agent and browser must never have access to a direct, unguarded capture operation.

Create a server-side guarded-capture service that performs these steps:

1. Authenticate the caller and verify authorization to access the checkout.
2. Load the current approved intent and policy version from the database.
3. Check expiry, revocation, ownership, and one-time authorization state.
4. Retrieve the latest order directly from PayPal.
5. Normalize the provider order and evaluate the deterministic policy.
6. Recompute relevant fingerprints and verify the cryptographic authorization binding.
7. Atomically reserve the authorization for one capture attempt using a database transaction, row locking or an equivalent concurrency-safe mechanism, and unique constraints.
8. Request PayPal capture only when all checks pass and the reservation succeeds.
9. Persist the provider result and sanitized audit event.
10. Return a truthful, minimal payment status to the frontend.

Define and validate a payment state machine. At minimum, distinguish:

- Order created.
- Awaiting buyer approval.
- Ready for IntentGuard validation.
- Blocked by policy.
- Capture pending or in progress.
- Capture completed.
- Capture definitively failed.
- Capture outcome unknown and awaiting reconciliation.

Adapt the transitions to the actual PayPal Orders v2 lifecycle documented during Phase 4. Do not force unsupported provider transitions into the model.

### Idempotency and ambiguous outcomes

- Require a stable idempotency key for capture attempts.
- Store each attempt and enforce uniqueness in the database.
- Return the existing attempt result for a safely recognized duplicate request.
- If a request times out after capture was submitted, mark the result as unknown or pending reconciliation.
- Retrieve current provider state and reconcile before deciding what happened.
- Never report success merely because a request was sent.
- Never assume a timeout means capture failed.
- Never automatically submit a second capture solely because the first response was lost.

Provide a reconciliation service or documented recovery workflow for ambiguous outcomes. If webhooks are implemented, verify their authenticity using PayPal's documented mechanism before trusting events.

### Security tests

Test:

- Product substitution and amount tampering.
- Wrong merchant or currency.
- Expired and replayed approval.
- Wrong checkout or policy version.
- Two simultaneous capture requests.
- Duplicate idempotency key.
- PayPal rejection.
- Timeout before sending and timeout after sending.
- Database failure before or after provider interaction.
- Provider success followed by application response failure.

### Acceptance criteria

- Invalid transactions produce zero capture calls.
- Valid Sandbox transactions can reach capture through the guarded path.
- Concurrent or duplicate requests cannot cause uncontrolled duplicate captures.
- Ambiguous outcomes are reconciled safely.
- Payment statuses reflect verified provider state.
- Every important transition is auditable.

---

## Phase 6: Secure API routes and audit trail

### Prompt

Implement the public-facing IntentGuard backend API on top of the completed services. Keep route handlers thin; authorization and payment logic must remain in dedicated services.

Implement or complete endpoints equivalent to:

- `POST /api/intents`
- `GET /api/intents/:intentId`
- `POST /api/intents/:intentId/approve`
- `POST /api/orders`
- `POST /api/orders/:orderId/validate`
- `POST /api/orders/:orderId/guarded-capture`
- `GET /api/orders/:orderId/status`
- `GET /api/audit`
- `GET /health/live`
- `GET /health/ready`

Adjust names only if necessary to match the established repository contract, and document any changes.

Requirements:

- Authenticate every protected endpoint.
- Check ownership and permissions for every intent, order, and audit query.
- Validate request and response schemas.
- Apply rate limits to sensitive endpoints.
- Use CSRF protection if cookie-based authentication is used.
- Return consistent error objects with safe error codes and request IDs.
- Avoid exposing provider tokens, secrets, stack traces, internal policy secrets, or other users' records.
- Keep validation separate from capture; the validation endpoint must not capture funds.
- Never trust a previous browser-side `ALLOW` decision. Re-evaluate at capture time.
- Paginate audit results and enforce user-level scoping.
- Document the API with OpenAPI or an equivalent machine-readable contract.

Audit events should record relevant identifiers, decision reasons, policy version, state transitions, request correlation IDs, and sanitized provider outcomes. Do not store credentials or unnecessary sensitive payment data.

### Acceptance criteria

- The API contract is documented.
- Authentication and ownership checks are tested.
- Validation cannot trigger capture.
- Unauthorized resource access is denied.
- Error responses are safe and consistent.
- Audit records are useful without leaking secrets.

---

## Phase 7: AI agent and MCP security boundary

### Prompt

Integrate AI-agent functionality only after deterministic policy enforcement, cryptographic authorization, and guarded capture are tested.

The AI model may interpret natural-language requests and propose structured intent data. It must not decide whether a transaction is authorized and must not possess PayPal credentials.

Implement:

1. Convert user requests into a typed purchase proposal.
2. Validate model output against a strict schema.
3. Ask the user for clarification when a material constraint is ambiguous.
4. Present the final policy constraints for explicit approval.
5. Store the approved policy on the backend.
6. Expose only narrowly scoped agent tools, such as proposing a purchase, reading intent or checkout status, requesting deterministic validation, and requesting guarded capture through the protected backend.
7. Do not expose raw PayPal credentials, arbitrary HTTP requests, SQL access, signing keys, or a direct capture tool.
8. Treat retrieved web pages, product descriptions, tool outputs, and prompts as untrusted data.
9. Test prompt injection that tries to change the merchant, product, currency, quantity, budget, or approval state.
10. Revalidate all constraints on the server, regardless of what the model claims.

If MCP is used, implement strict input/output schemas, authentication and authorization, least privilege, safe error handling, and tool-level audit events. Do not assume that MCP itself provides payment security.

Create attack demonstrations showing:

- A valid proposal that passes the policy.
- A substituted product that gets blocked.
- An over-budget order that gets blocked.
- A replayed approval that gets blocked.
- Prompt injection that attempts to bypass the policy.
- An attempted direct capture that is unavailable to the agent.

### Acceptance criteria

- The model cannot authorize a transaction by itself.
- Model output is treated as untrusted input.
- Explicit approval is required.
- The backend independently enforces policy.
- All malicious test cases are blocked before unauthorized capture.
- No agent tool exposes provider secrets or a bypass around guarded capture.

---

## Phase 8: End-to-end verification, threat testing, and demo readiness

### Prompt

Perform a complete security and integration review of IntentGuard. Do not merely generate a checklist; execute the available tests and report the actual results.

Create end-to-end tests for:

1. Valid approved purchase.
2. Wrong product or SKU.
3. Wrong merchant.
4. Over-budget total.
5. Currency mismatch.
6. Quantity mismatch.
7. Expired authorization.
8. Altered policy or order fingerprint.
9. Replayed authorization.
10. Concurrent capture attempts.
11. PayPal API error.
12. Capture timeout and subsequent reconciliation.
13. Unauthorized user accessing another user's order.
14. Prompt injection against the AI-agent workflow.
15. Attempted bypass of the guarded-capture endpoint.

Use mocks for repeatable security tests and opt-in PayPal Sandbox tests for real provider integration. Do not use production credentials or real funds.

Review:

- Dependency vulnerabilities and unnecessary packages.
- Secret leakage and unsafe logs.
- Authentication, authorization, CSRF, CORS, and rate limiting.
- Input validation and error handling.
- SQL injection risks and transaction boundaries.
- Cryptographic key management and canonicalization.
- Idempotency and concurrency correctness.
- Provider response validation and reconciliation.
- Audit completeness and privacy.
- Frontend/backend API consistency.

Add a reproducible local setup guide, migration instructions, test commands, Sandbox setup instructions, and troubleshooting guidance.

Produce `docs/SECURITY_TEST_REPORT.md` with:

- Tests actually executed.
- Pass/fail results.
- Commands used.
- Issues discovered and fixes made.
- Known limitations and untested areas.
- Steps for a live Sandbox demonstration.

Never report a test as passing if it was not run. Never describe the system as production-secure solely because the test suite passes.

### Acceptance criteria

- All required automated checks pass, or remaining failures are documented accurately.
- The valid Sandbox flow and invalid-order blocking flow are reproducible.
- No unauthorized transaction reaches capture in the tested scenarios.
- Setup and test instructions work from a clean environment.
- Security limitations are stated honestly.

---

## Final implementation checklist

- [x] Phase 0: Repository audit completed.
- [x] Phase 1: Backend foundation and configuration tested.
- [x] Phase 2: Deterministic policy engine tested.
- [x] Phase 3: Explicit approval, cryptographic binding, replay protection tested.
- [x] Phase 4: PayPal Orders v2 Sandbox adapter tested.
- [x] Phase 5: Guarded capture, idempotency, reconciliation tested.
- [x] Phase 6: Secure API and audit trail tested.
- [x] Phase 7: AI/MCP boundary and prompt-injection tests completed.
- [x] Phase 8: End-to-end security report produced.

## Non-negotiable security rules

1. The browser and AI model are untrusted.
2. Only the server can access PayPal credentials.
3. The policy engine, not the AI model, makes the authorization decision.
4. Every capture request rechecks the current order and approved policy.
5. A rejected policy must cause zero calls to the capture operation.
6. Cryptographic hashes alone do not prove user approval.
7. A timeout does not prove a payment failed.
8. Never retry an ambiguous capture blindly.
9. Use Sandbox credentials only during development and hackathon demonstrations.
10. Report only tests and capabilities that have actually been verified.
