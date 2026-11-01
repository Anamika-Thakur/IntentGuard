# IntentGuard — Deterministic Payment Authorization for Autonomous AI Agents

> **Your Intent. Your Money. Your Control.**  
> Give AI agents the freedom to act, without giving up control of your payments.

---

## What Is IntentGuard?

IntentGuard is a full-stack, production-grade commerce platform that introduces a novel security layer for AI-driven payments. Think of it as **PayPal — but with a cryptographic guardrail that prevents AI agents from spending outside your exact authorized intent**.

The problem it solves: as AI agents gain the ability to browse merchants, fill carts, and execute checkout flows autonomously, nothing stops them from hallucinating a product, falling for a prompt injection attack, or quietly substituting an unauthorized SKU. IntentGuard enforces an incorruptible architectural boundary between what an AI *proposes* and what the backend *actually authorizes*.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        FRONTEND (React/Vite)                    │
│   Landing Page · Merchant Hub · IntentGuard Vault · Audit Log   │
└─────────────────────────────┬───────────────────────────────────┘
                              │  HTTP (proxied via Vite dev server)
┌─────────────────────────────▼───────────────────────────────────┐
│                      BACKEND (Node.js / TypeScript)             │
│                                                                 │
│  ┌─────────────┐  ┌──────────────┐  ┌───────────────────────┐  │
│  │ AI Agent    │  │ Policy Engine│  │ Crypto Auth Layer     │  │
│  │ Boundary    │  │ (Deterministic│  │ (HMAC-SHA-256 Tokens) │  │
│  │ (MCP Bridge)│  │  Rule Eval)  │  │                       │  │
│  └─────────────┘  └──────────────┘  └───────────────────────┘  │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │             Guarded Capture Service                     │    │
│  │  1. Re-validates policy  2. Verifies HMAC token         │    │
│  │  3. Row-locks DB row     4. Calls PayPal capture        │    │
│  │  5. Reconciles result    6. Writes immutable audit      │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                 │
└──────────────────────────┬──────────────────────────────────────┘
                           │
              ┌────────────▼────────────┐
              │  PayPal Sandbox Orders  │
              │  v2 API (OAuth 2.0)     │
              └─────────────────────────┘
```

---

## Project Structure

```
IntentGuard/
├── backend/                    # Node.js + TypeScript API server
│   ├── src/
│   │   ├── agent/              # AI proposal parsing + MCP security bridge
│   │   ├── config/             # Zod-validated environment config
│   │   ├── crypto/             # HMAC-SHA-256 token generation & verification
│   │   ├── db/                 # PostgreSQL client + migrations (SQL)
│   │   ├── errors/             # Centralized AppError + Express error handler
│   │   ├── logger/             # Structured JSON logger with PII redaction
│   │   ├── middleware/         # Auth (JWT), request ID, rate limiting
│   │   ├── payment/            # PayPal sandbox adapter + mock + guarded capture
│   │   ├── policy/             # Deterministic policy evaluator + typed rules
│   │   ├── routes/             # Express route handlers
│   │   ├── app.ts              # Express app factory
│   │   └── index.ts            # Server entry point
│   ├── tests/                  # Vitest integration + unit tests
│   ├── .env.example
│   └── package.json
│
├── frontend/                   # React + Vite SPA
│   ├── src/
│   │   ├── components/
│   │   │   ├── Navbar.tsx
│   │   │   ├── Hero.tsx
│   │   │   ├── EditorialSections.tsx   # Landing page content + live demo
│   │   │   └── AppConsole.tsx          # PayPal-like 5-tab developer console
│   │   ├── services/api.ts             # Typed API client (zero mock data)
│   │   ├── App.tsx
│   │   └── index.css                   # Editorial design token system
│   └── package.json
│
└── docs/
    ├── BACKEND_IMPLEMENTATION_PLAN.md
    └── SECURITY_TEST_REPORT.md
```

---

## The IntentGuard Security Flow (USP)

Every payment goes through **5 mandatory gates**:

```
1. PROPOSE   → AI agent submits natural language or structured intent
                 Backend sanitizes for prompt injection, parses to typed proposal

2. DEFINE    → User creates a purchase Intent with exact constraints:
                 merchant ID · allowed SKU · max quantity · budget cap in cents

3. APPROVE   → Human explicitly confirms. Backend generates:
                 • SHA-256 policy fingerprint (canonical hash of all constraints)
                 • HMAC-SHA-256 authorization token (single-use, session-bound)

4. CREATE    → Backend creates PayPal order using AUTHORITATIVE prices from
                 the server-side catalogue. Client-provided prices are IGNORED.

5. CAPTURE   → GuardedCaptureService atomically:
                 ✓ Re-evaluates every policy rule against the live PayPal order
                 ✓ Verifies HMAC token cryptographic signature
                 ✓ Checks token has not been used (replay protection)
                 ✓ Row-locks DB record to prevent concurrent double-spend
                 ✓ Calls PayPal capture API
                 ✓ Reconciles the result
                 ✓ Writes immutable audit log entry
```

If **any gate fails**, the capture is **mathematically blocked** — no exceptions.

---

## API Reference

All endpoints require `Authorization: Bearer <token>` header.

### Health
| Method | Path | Description |
|--------|------|-------------|
| GET | `/health/live` | Liveness probe |
| GET | `/health/ready` | Readiness probe (DB check) |

### Catalogue (Merchant Side)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/catalogue/products` | List all active products |
| POST | `/api/catalogue/products` | Register a new product with authoritative price |

### AI Agent
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/agent/propose` | Parse natural language to typed purchase proposal |
| POST | `/api/agent/mcp` | MCP tool execution through secure boundary |

### Intents (Authorization Layer)
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/intents` | Create a purchase intent (DRAFT state) |
| GET | `/api/intents/:id` | Get intent details + active policy |
| POST | `/api/intents/:id/approve` | Human approval — generates HMAC-SHA-256 auth token |
| POST | `/api/intents/:id/revoke` | Revoke an active intent |

### Orders (PayPal Integration)
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/orders` | Create PayPal order using server-side authoritative prices |
| POST | `/api/orders/:id/validate` | Dry-run policy check (no capture, always safe) |
| POST | `/api/orders/:id/guarded-capture` | Atomic guarded capture with full policy enforcement |
| GET | `/api/orders/:id/status` | Order + capture status |

### Audit
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/audit` | Paginated immutable audit event stream |

---

## Security Guarantees

| Guarantee | Implementation |
|-----------|----------------|
| **No floating-point money** | All monetary values are `INTEGER` minor currency units (cents) at every layer — DB, API, PayPal |
| **Server-side prices** | Client-submitted prices are never used. All amounts come from the authoritative `catalogue_products` table |
| **Cryptographic binding** | HMAC-SHA-256 token ties user approval to exact policy fingerprint + checkout session ID |
| **Single-use tokens** | Auth tokens are atomically consumed; replays are cryptographically detected and rejected |
| **No LLM authorization** | AI agent can only propose. The deterministic policy engine (pure TypeScript) makes every authorization decision |
| **Isolated credentials** | PayPal OAuth secrets and HMAC signing keys never leave the backend process |
| **Idempotent capture** | `Idempotency-Key` header prevents double-charges on network retries |
| **Immutable audit trail** | Every state transition is logged with correlation IDs — no entry is ever modified or deleted |
| **Row-level DB locking** | `SELECT ... FOR UPDATE` prevents concurrent capture races on the same order |

---

## Running Locally

### Prerequisites
- Node.js 20+
- npm 10+

### Backend

```bash
cd backend
cp .env.example .env
# Edit .env — add your PayPal sandbox credentials
# Leave PAYPAL_CLIENT_ID as placeholder to use the built-in mock payment adapter
npm install
npm run dev
# API server starts at http://localhost:3000
```

### Frontend

```bash
cd frontend
npm install
npm run dev
# App starts at http://127.0.0.1:5173
# All /api and /health requests are proxied to the backend at localhost:3000
```

### Environment Variables (Backend `.env`)

| Variable | Description |
|----------|-------------|
| `NODE_ENV` | `development` / `production` / `test` |
| `PORT` | HTTP port (default: 3000) |
| `DATABASE_URL` | PostgreSQL connection string (optional — falls back to in-memory pg-mem) |
| `USE_IN_MEMORY_DB` | `true` to force in-memory DB (great for local dev without PostgreSQL) |
| `AUTH_HMAC_SECRET_KEY_V1` | 64-char hex secret for HMAC-SHA-256 token signing |
| `AUTH_ACTIVE_KEY_ID` | Key ID prefix in token header (e.g. `v1`) |
| `PAYPAL_CLIENT_ID` | PayPal sandbox app Client ID |
| `PAYPAL_CLIENT_SECRET` | PayPal sandbox app Client Secret |
| `PAYPAL_API_BASE_URL` | `https://api-m.sandbox.paypal.com` |
| `AI_AGENT_MAX_PROPOSAL_CENTS` | Hard ceiling on any AI-proposed amount (default: `50000` = $500.00) |

---

## Tech Stack

### Backend
- **Runtime**: Node.js 20, TypeScript (ESM modules), `tsx` for hot-reload
- **Framework**: Express.js + Helmet + CORS
- **Validation**: Zod (schema validation at every trust boundary)
- **Database**: PostgreSQL via `pg` + `pg-mem` for zero-config in-memory dev mode
- **Cryptography**: Node.js native `crypto` — HMAC-SHA-256, SHA-256 fingerprinting
- **Testing**: Vitest

### Frontend
- **Framework**: React 19 + TypeScript
- **Bundler**: Vite 8
- **Typography**: Cormorant Garamond (editorial serif) + Manrope (geometric sans)
- **Design**: Minimal editorial fintech aesthetic — no gradients, no cards, no emoji
- **Styling**: Vanilla CSS with a structured design token system

---

## Authors

**Anamika Thakur** — anamika2642005@gmail.com

---

*IntentGuard is a research/prototype project demonstrating a security architecture for autonomous AI payment agents. Do not use placeholder credentials or in-memory storage in production.*
