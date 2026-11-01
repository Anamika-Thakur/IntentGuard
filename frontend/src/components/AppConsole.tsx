import React, { useState, useEffect } from 'react';
import {
  api,
  type IntentResponse,
  type ApprovalResponse,
  type OrderResponse,
  type CaptureResponse,
  type AuditItem,
  type CatalogueProduct,
} from '../services/api.js';

interface AppConsoleProps {
  onBackToHome: () => void;
}

type ConsoleTab = 'procure' | 'merchant' | 'vault' | 'paypal-dev' | 'audit';

export const AppConsole: React.FC<AppConsoleProps> = ({ onBackToHome }) => {
  const [activeTab, setActiveTab] = useState<ConsoleTab>('procure');

  // AI Agent Natural Language Input
  const [agentPrompt, setAgentPrompt] = useState(
    'Procure 2 Precision Widgets from Acme Store for the design team under $60'
  );

  // Free Text Fields (NO dropdowns)
  const [textMerchantId, setTextMerchantId] = useState('MERCHANT_ACME_STORE');
  const [textSku, setTextSku] = useState('SKU-WIDGET-01');
  const [textQuantity, setTextQuantity] = useState('2');
  const [textBudgetDollars, setTextBudgetDollars] = useState('60');

  // Merchant Seller Creation Form (Free Text Fields)
  const [sellerMerchantId, setSellerMerchantId] = useState('MERCHANT_CORP_OFFICE');
  const [sellerStoreName, setSellerStoreName] = useState('Corporate Office Logistics');
  const [sellerSku, setSellerSku] = useState('SKU-MONITOR-4K');
  const [sellerTitle, setSellerTitle] = useState('Dell UltraSharp 27" 4K Monitor');
  const [sellerPriceDollars, setSellerPriceDollars] = useState('380');

  // Live Data Lists
  const [catalogueItems, setCatalogueItems] = useState<CatalogueProduct[]>([]);
  const [auditItems, setAuditItems] = useState<AuditItem[]>([]);
  const [loadingCatalogue, setLoadingCatalogue] = useState(false);
  const [loadingAudit, setLoadingAudit] = useState(false);

  // Active Transaction Lifecycle State
  const [currentIntent, setCurrentIntent] = useState<IntentResponse | null>(null);
  const [currentApproval, setCurrentApproval] = useState<ApprovalResponse | null>(null);
  const [currentOrder, setCurrentOrder] = useState<OrderResponse | null>(null);
  const [currentCapture, setCurrentCapture] = useState<CaptureResponse | null>(null);

  // Action status
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Load catalogue & audit
  const loadData = async () => {
    setLoadingCatalogue(true);
    setLoadingAudit(true);
    try {
      const [catRes, audRes] = await Promise.all([
        api.fetchCatalogueProducts().catch(() => ({ items: [] })),
        api.getAuditEvents(1, 20).catch(() => ({ items: [] })),
      ]);
      setCatalogueItems(catRes.items);
      setAuditItems(audRes.items);
    } catch (err) {
      console.error('Data load error:', err);
    } finally {
      setLoadingCatalogue(false);
      setLoadingAudit(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [activeTab]);

  // Handle AI Agent Natural Language Parse & Proposal
  const handleAgentParse = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionLoading('AGENT_PARSE');
    setActionError(null);
    setActionSuccess(null);

    try {
      const parsed = await api.parseAgentPrompt(agentPrompt);
      // Auto-populate text fields from the AI's structured interpretation
      setTextMerchantId(parsed.proposal.merchantId);
      setTextSku(parsed.proposal.sku);
      setTextQuantity(String(parsed.proposal.maxQuantity));
      setTextBudgetDollars(String(parsed.proposal.maxTotalCents / 100));

      // Create draft intent directly on backend
      const res = await api.createIntent({
        merchantId: parsed.proposal.merchantId,
        allowedSku: parsed.proposal.sku,
        maxQuantity: parsed.proposal.maxQuantity,
        maxTotalCents: parsed.proposal.maxTotalCents,
        currency: 'USD',
      });

      setCurrentIntent(res);
      setActionSuccess(
        `AI Agent parsed request: "${parsed.proposal.userNote}". Intent ${res.intentId} created in DRAFT. Review in IntentGuard Vault.`
      );
      setActiveTab('vault');
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'AI agent parsing failed.');
    } finally {
      setActionLoading(null);
    }
  };

  // Handle Manual Free-Text Proposal Submission
  const handleManualTextSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionLoading('MANUAL_SUBMIT');
    setActionError(null);
    setActionSuccess(null);

    try {
      const qty = parseInt(textQuantity, 10);
      const budgetCents = Math.round(parseFloat(textBudgetDollars) * 100);

      if (isNaN(qty) || qty <= 0) throw new Error('Quantity must be a positive integer.');
      if (isNaN(budgetCents) || budgetCents <= 0) throw new Error('Budget must be a positive number.');

      const res = await api.createIntent({
        merchantId: textMerchantId.trim(),
        allowedSku: textSku.trim(),
        maxQuantity: qty,
        maxTotalCents: budgetCents,
        currency: 'USD',
      });

      setCurrentIntent(res);
      setActionSuccess(`Draft intent ${res.intentId} submitted. Proceed to IntentGuard Vault for verification.`);
      setActiveTab('vault');
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to create intent.');
    } finally {
      setActionLoading(null);
    }
  };

  // Merchant Listing Submission
  const handleSellerCreateProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionLoading('SELLER_CREATE');
    setActionError(null);
    setActionSuccess(null);

    try {
      const priceCents = Math.round(parseFloat(sellerPriceDollars) * 100);
      const created = await api.createCatalogueProduct({
        merchantId: sellerMerchantId.trim(),
        merchantName: sellerStoreName.trim(),
        sku: sellerSku.trim(),
        title: sellerTitle.trim(),
        unitPriceCents: priceCents,
        currency: 'USD',
      });

      setActionSuccess(`Product listed: ${created.title} (${created.sku}) by ${created.merchantId} at ${created.priceFormatted}`);
      loadData();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed listing product.');
    } finally {
      setActionLoading(null);
    }
  };

  // Step 2: Human Approval in IntentGuard Vault
  const handleApprove = async () => {
    if (!currentIntent) return;
    setActionLoading('APPROVE');
    setActionError(null);
    setActionSuccess(null);

    try {
      const checkoutId = `chk_session_${Date.now()}`;
      const approval = await api.approveIntent(currentIntent.intentId, checkoutId);
      setCurrentApproval(approval);

      // Create real order in PayPal Sandbox
      const order = await api.createOrder(currentIntent.intentId, currentIntent.maxQuantity);
      setCurrentOrder(order);

      setActionSuccess('Intent approved! Cryptographic HMAC-SHA-256 seal generated. PayPal Sandbox order created.');
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Approval failed.');
    } finally {
      setActionLoading(null);
    }
  };

  // Step 3: Execute Guarded Capture
  const handleCapture = async () => {
    if (!currentOrder || !currentApproval) return;
    setActionLoading('CAPTURE');
    setActionError(null);
    setActionSuccess(null);

    try {
      const idempotencyKey = `idemp_live_${Date.now()}`;
      const cap = await api.executeGuardedCapture({
        orderId: currentOrder.orderId,
        idempotencyKey,
        authorizationToken: currentApproval.authorizationToken,
        checkoutId: currentApproval.checkoutId,
      });

      setCurrentCapture(cap);
      setActionSuccess(`Payment captured successfully through IntentGuard! Capture ID: ${cap.providerCaptureId || 'COMPLETED'}`);
      loadData();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Transaction blocked by IntentGuard policy engine.');
    } finally {
      setActionLoading(null);
    }
  };

  return (
    <div className="platform-root">
      {/* Top PayPal Developer Style Header */}
      <header className="platform-header">
        <div className="container header-content">
          <div className="header-left">
            <button className="back-link" onClick={onBackToHome}>
              ← Back to Editorial
            </button>
            <span className="sep">/</span>
            <span className="platform-title">PayPal Sandbox Commerce Suite with IntentGuard</span>
          </div>

          <div className="header-right">
            <span className="env-tag">SANDBOX ENV</span>
            <span className="principal-tag">alice@example.com (Organization Buyer)</span>
          </div>
        </div>
      </header>

      {/* Navigation Sub-Bar */}
      <nav className="platform-nav">
        <div className="container nav-strip">
          <button
            className={`nav-btn ${activeTab === 'procure' ? 'active' : ''}`}
            onClick={() => setActiveTab('procure')}
          >
            Autonomous Procurement (AI Agent)
          </button>

          <button
            className={`nav-btn ${activeTab === 'merchant' ? 'active' : ''}`}
            onClick={() => setActiveTab('merchant')}
          >
            Merchant Hub & Catalogue
          </button>

          <button
            className={`nav-btn ${activeTab === 'vault' ? 'active' : ''}`}
            onClick={() => setActiveTab('vault')}
          >
            IntentGuard Security Vault (USP) {currentIntent && !currentApproval && <span className="badge">1</span>}
          </button>

          <button
            className={`nav-btn ${activeTab === 'paypal-dev' ? 'active' : ''}`}
            onClick={() => setActiveTab('paypal-dev')}
          >
            PayPal Sandbox API Suite
          </button>

          <button
            className={`nav-btn ${activeTab === 'audit' ? 'active' : ''}`}
            onClick={() => setActiveTab('audit')}
          >
            Audit Trail
          </button>
        </div>
      </nav>

      <main className="container platform-body">
        {actionSuccess && <div className="notice notice-ok">{actionSuccess}</div>}
        {actionError && <div className="notice notice-err">{actionError}</div>}

        {/* TAB 1: AUTONOMOUS PROCUREMENT (AI AGENT & TEXT INPUTS) */}
        {activeTab === 'procure' && (
          <div className="tab-pane">
            <div className="pane-intro">
              <h2 className="pane-heading">Autonomous Corporate Procurement</h2>
              <p className="pane-sub">
                Allow AI agents or staff to describe procurement needs in plain language. IntentGuard automatically extracts constraints, verifies catalogue pricing, and requires human approval before payment.
              </p>
            </div>

            <div className="two-column-split">
              {/* Option A: Natural Language Procurement */}
              <div className="card-pane">
                <h3 className="card-heading">Method A: Natural Language AI Agent Input</h3>
                <p className="card-sub">Type any procurement request. The agent parses merchant, SKU, quantity, and budget limits.</p>

                <form onSubmit={handleAgentParse} className="clean-form">
                  <div className="field">
                    <label className="field-label">Procurement Instruction (Plain Text)</label>
                    <textarea
                      rows={3}
                      value={agentPrompt}
                      onChange={(e) => setAgentPrompt(e.target.value)}
                      className="text-input"
                      placeholder="e.g. Order 2 Precision Widgets from Acme Store under $60 for the team"
                      required
                    />
                    <span className="field-help">Try: "Buy 1 USB-C Cable from Tech Supplies under $20" or "Acme Hyper Gadget quantity 1 budget $55"</span>
                  </div>

                  <button type="submit" className="btn-primary" disabled={actionLoading === 'AGENT_PARSE'}>
                    {actionLoading === 'AGENT_PARSE' ? 'Parsing & Verifying...' : 'Autonomously Propose Purchase →'}
                  </button>
                </form>
              </div>

              {/* Option B: Direct Free Text Input Fields (NO Dropdowns) */}
              <div className="card-pane">
                <h3 className="card-heading">Method B: Direct Structured Text Input (No Dropdowns)</h3>
                <p className="card-sub">Input merchant ID, product code, quantity, and budget cap as standard text fields.</p>

                <form onSubmit={handleManualTextSubmit} className="clean-form">
                  <div className="field">
                    <label className="field-label">Merchant Identifier (Text)</label>
                    <input
                      type="text"
                      value={textMerchantId}
                      onChange={(e) => setTextMerchantId(e.target.value)}
                      className="text-input"
                      placeholder="e.g. MERCHANT_ACME_STORE"
                      required
                    />
                  </div>

                  <div className="field">
                    <label className="field-label">Product SKU (Text)</label>
                    <input
                      type="text"
                      value={textSku}
                      onChange={(e) => setTextSku(e.target.value)}
                      className="text-input"
                      placeholder="e.g. SKU-WIDGET-01"
                      required
                    />
                  </div>

                  <div className="row-2">
                    <div className="field">
                      <label className="field-label">Quantity (Text)</label>
                      <input
                        type="text"
                        value={textQuantity}
                        onChange={(e) => setTextQuantity(e.target.value)}
                        className="text-input"
                        placeholder="e.g. 2"
                        required
                      />
                    </div>

                    <div className="field">
                      <label className="field-label">Budget Cap ($ USD) (Text)</label>
                      <input
                        type="text"
                        value={textBudgetDollars}
                        onChange={(e) => setTextBudgetDollars(e.target.value)}
                        className="text-input"
                        placeholder="e.g. 60"
                        required
                      />
                    </div>
                  </div>

                  <button type="submit" className="btn-secondary" disabled={actionLoading === 'MANUAL_SUBMIT'}>
                    {actionLoading === 'MANUAL_SUBMIT' ? 'Submitting...' : 'Submit Intent as Free Text →'}
                  </button>
                </form>
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: MERCHANT HUB & CATALOGUE */}
        {activeTab === 'merchant' && (
          <div className="tab-pane">
            <div className="pane-intro">
              <h2 className="pane-heading">Merchant Marketplace & Seller Hub</h2>
              <p className="pane-sub">
                Sellers publish authoritative products into the real server-side registry. IntentGuard cross-references every transaction against this database before authorizing PayPal capture.
              </p>
            </div>

            <div className="two-column-split">
              {/* Add New Product Text Form */}
              <div className="card-pane">
                <h3 className="card-heading">List New Product (Free Text Input)</h3>
                <form onSubmit={handleSellerCreateProduct} className="clean-form">
                  <div className="field">
                    <label className="field-label">Merchant ID (Text)</label>
                    <input
                      type="text"
                      value={sellerMerchantId}
                      onChange={(e) => setSellerMerchantId(e.target.value)}
                      className="text-input"
                      placeholder="e.g. MERCHANT_CORP_OFFICE"
                      required
                    />
                  </div>

                  <div className="field">
                    <label className="field-label">Store / Company Name (Text)</label>
                    <input
                      type="text"
                      value={sellerStoreName}
                      onChange={(e) => setSellerStoreName(e.target.value)}
                      className="text-input"
                      placeholder="e.g. Corporate Office Logistics"
                      required
                    />
                  </div>

                  <div className="field">
                    <label className="field-label">Product SKU (Text)</label>
                    <input
                      type="text"
                      value={sellerSku}
                      onChange={(e) => setSellerSku(e.target.value)}
                      className="text-input"
                      placeholder="e.g. SKU-MONITOR-4K"
                      required
                    />
                  </div>

                  <div className="field">
                    <label className="field-label">Product Title (Text)</label>
                    <input
                      type="text"
                      value={sellerTitle}
                      onChange={(e) => setSellerTitle(e.target.value)}
                      className="text-input"
                      placeholder="e.g. Dell UltraSharp 27 Monitor"
                      required
                    />
                  </div>

                  <div className="field">
                    <label className="field-label">Unit Price ($ USD) (Text)</label>
                    <input
                      type="text"
                      value={sellerPriceDollars}
                      onChange={(e) => setSellerPriceDollars(e.target.value)}
                      className="text-input"
                      placeholder="e.g. 380"
                      required
                    />
                  </div>

                  <button type="submit" className="btn-primary" disabled={actionLoading === 'SELLER_CREATE'}>
                    {actionLoading === 'SELLER_CREATE' ? 'Registering...' : 'Register in Authoritative Registry'}
                  </button>
                </form>
              </div>

              {/* Authoritative Live Catalogue List */}
              <div className="card-pane">
                <h3 className="card-heading">Live Authoritative Catalogue ({catalogueItems.length} Products)</h3>
                <p className="card-sub">Queried in real time from PostgreSQL database.</p>

                {loadingCatalogue ? (
                  <p>Loading database catalogue...</p>
                ) : (
                  <div className="table-responsive">
                    <table className="editorial-table">
                      <thead>
                        <tr>
                          <th>Merchant</th>
                          <th>SKU</th>
                          <th>Title</th>
                          <th>Price</th>
                        </tr>
                      </thead>
                      <tbody>
                        {catalogueItems.map((prod) => (
                          <tr key={prod.id}>
                            <td>{prod.merchantName} ({prod.merchantId})</td>
                            <td><code>{prod.sku}</code></td>
                            <td>{prod.title}</td>
                            <td className="numeric">{prod.priceFormatted}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: INTENTGUARD VAULT (THE USP FEATURE) */}
        {activeTab === 'vault' && (
          <div className="tab-pane">
            <div className="pane-intro">
              <h2 className="pane-heading">IntentGuard Security Vault (The Core USP)</h2>
              <p className="pane-sub">
                This is our proprietary security layer. When an AI agent initiates a transaction on PayPal, IntentGuard intercepts it, verifies policy constraints, requires deliberate human cryptographic binding, and guards payment capture.
              </p>
            </div>

            {currentIntent ? (
              <div className="vault-flow-box">
                {/* Step 1: Policy Review */}
                <div className="vault-step">
                  <div className="step-tag">STAGE 1: DETERMINISTIC POLICY VERIFICATION</div>
                  <h3 className="step-name">Intent Review: {currentIntent.intentId}</h3>

                  <div className="details-matrix">
                    <div>
                      <span className="lbl">Target Merchant:</span>
                      <span className="val">{currentIntent.merchantId}</span>
                    </div>
                    <div>
                      <span className="lbl">Authorized SKU:</span>
                      <span className="val"><code>{currentIntent.allowedSku}</code></span>
                    </div>
                    <div>
                      <span className="lbl">Maximum Quantity:</span>
                      <span className="val">{currentIntent.maxQuantity} unit(s)</span>
                    </div>
                    <div>
                      <span className="lbl">Approved Budget Cap:</span>
                      <span className="val numeric">${(currentIntent.maxTotalCents / 100).toFixed(2)} USD</span>
                    </div>
                    <div>
                      <span className="lbl">Intent Status:</span>
                      <span className="status-pill status-pending">{currentIntent.status}</span>
                    </div>
                  </div>

                  {!currentApproval && (
                    <div className="action-row">
                      <button
                        className="btn-primary btn-gold"
                        onClick={handleApprove}
                        disabled={actionLoading === 'APPROVE'}
                      >
                        {actionLoading === 'APPROVE' ? 'Signing...' : 'Deliberately Approve & Sign with HMAC-SHA-256 →'}
                      </button>
                    </div>
                  )}
                </div>

                {/* Step 2: Cryptographic Binding Established */}
                {currentApproval && (
                  <div className="vault-step active-step">
                    <div className="step-tag">STAGE 2: CRYPTOGRAPHIC AUTHORIZATION SEAL</div>
                    <div className="crypto-seal-box">
                      <p>
                        <strong>Canonical Policy Fingerprint (SHA-256):</strong>
                        <br />
                        <code>{currentApproval.policyFingerprint}</code>
                      </p>
                      <p>
                        <strong>Server-Bound HMAC-SHA-256 Token:</strong>
                        <br />
                        <code>{currentApproval.authorizationToken}</code>
                      </p>
                      <p className="seal-note">
                        This token is single-use and bound exclusively to session {currentApproval.checkoutId}. Any replay or price tampering will be blocked.
                      </p>
                    </div>
                  </div>
                )}

                {/* Step 3: Guarded Payment Capture */}
                {currentOrder && currentApproval && (
                  <div className="vault-step active-step">
                    <div className="step-tag">STAGE 3: GUARDED PAYPAL CAPTURE</div>
                    <div className="order-summary-box">
                      <p><strong>PayPal Sandbox Order ID:</strong> <code>{currentOrder.providerOrderId}</code></p>
                      <p><strong>Amount:</strong> <span className="numeric">${(currentOrder.amountCents / 100).toFixed(2)} {currentOrder.currency}</span></p>
                    </div>

                    {!currentCapture ? (
                      <div className="action-row">
                        <button
                          className="btn-primary"
                          onClick={handleCapture}
                          disabled={actionLoading === 'CAPTURE'}
                        >
                          {actionLoading === 'CAPTURE' ? 'Validating & Capturing...' : 'Execute Guarded Capture on PayPal Sandbox'}
                        </button>
                      </div>
                    ) : (
                      <div className="capture-success-box">
                        <span className="status-pill status-approved">PAYMENT CAPTURED</span>
                        <h4>Provider Capture Confirmed: {currentCapture.providerCaptureId || 'COMPLETED'}</h4>
                        <p>Idempotency Key: <code>{currentCapture.idempotencyKey}</code></p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="empty-box">
                <p>No active purchase proposal in vault. Submit an intent under "Autonomous Procurement" to initiate the flow.</p>
                <button className="btn-secondary" onClick={() => setActiveTab('procure')}>
                  Go to Autonomous Procurement
                </button>
              </div>
            )}
          </div>
        )}

        {/* TAB 4: PAYPAL SANDBOX DEVELOPER SUITE */}
        {activeTab === 'paypal-dev' && (
          <div className="tab-pane">
            <div className="pane-intro">
              <h2 className="pane-heading">PayPal Developer Sandbox Environment</h2>
              <p className="pane-sub">
                IntentGuard integrates directly with the official PayPal Orders v2 Sandbox API. Below is the live credentials and endpoint configuration.
              </p>
            </div>

            <div className="developer-grid">
              <div className="dev-card">
                <h4>API Environment & Base URL</h4>
                <div className="dev-field">
                  <span>Environment:</span>
                  <strong>PayPal Sandbox Mode</strong>
                </div>
                <div className="dev-field">
                  <span>API Base URL:</span>
                  <code>https://api-m.sandbox.paypal.com</code>
                </div>
                <div className="dev-field">
                  <span>Orders Endpoint:</span>
                  <code>/v2/checkout/orders</code>
                </div>
                <div className="dev-field">
                  <span>Capture Endpoint:</span>
                  <code>/v2/checkout/orders/&#123;orderId&#125;/capture</code>
                </div>
              </div>

              <div className="dev-card">
                <h4>OAuth 2.0 Client Credentials</h4>
                <div className="dev-field">
                  <span>OAuth Endpoint:</span>
                  <code>/v1/oauth2/token</code>
                </div>
                <div className="dev-field">
                  <span>Grant Type:</span>
                  <code>client_credentials</code>
                </div>
                <div className="dev-field">
                  <span>Client ID:</span>
                  <code>placeholder_client_id (Configurable via .env)</code>
                </div>
                <div className="dev-field">
                  <span>Idempotency Header:</span>
                  <code>PayPal-Request-Id</code>
                </div>
              </div>
            </div>

            <div className="divider" />

            <div className="live-endpoints-info">
              <h3>IntentGuard Integration Architecture</h3>
              <p>
                In a production PayPal deployment, IntentGuard acts as the <strong>Merchant Security Interceptor</strong>. When an AI agent clicks PayPal Checkout, the merchant backend hands the order reference to IntentGuard. IntentGuard ensures the live PayPal order exactly matches the approved purchasing policy before executing <code>captureOrder()</code>.
              </p>
            </div>
          </div>
        )}

        {/* TAB 5: AUDIT TRAIL */}
        {activeTab === 'audit' && (
          <div className="tab-pane">
            <div className="pane-intro">
              <h2 className="pane-heading">Immutable Security Audit Trail</h2>
              <p className="pane-sub">Every proposal, policy evaluation, approval, and capture is logged with tamper-proof correlation IDs.</p>
            </div>

            {loadingAudit ? (
              <p>Loading audit stream...</p>
            ) : auditItems.length === 0 ? (
              <p>No audit events recorded yet.</p>
            ) : (
              <div className="table-responsive">
                <table className="editorial-table">
                  <thead>
                    <tr>
                      <th>Timestamp</th>
                      <th>Event Type</th>
                      <th>Resource</th>
                      <th>Resource ID</th>
                      <th>Correlation ID</th>
                    </tr>
                  </thead>
                  <tbody>
                    {auditItems.map((item) => (
                      <tr key={item.id}>
                        <td className="numeric">{new Date(item.createdAt).toLocaleString()}</td>
                        <td><span className="event-tag">{item.eventType}</span></td>
                        <td>{item.resourceType}</td>
                        <td><code>{item.resourceId}</code></td>
                        <td><code>{item.correlationId.substring(0, 10)}...</code></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </main>

      <style>{`
        .platform-root {
          min-height: 100vh;
          background-color: var(--color-white);
        }

        .platform-header {
          background-color: var(--color-navy);
          color: var(--color-white);
          padding: 1.25rem 0;
          border-bottom: 1px solid rgba(255, 255, 255, 0.1);
        }

        .header-content {
          display: flex;
          justify-content: space-between;
          align-items: center;
        }

        .header-left {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          font-size: 0.9375rem;
        }

        .back-link {
          color: var(--color-gold);
          font-weight: 500;
        }

        .sep {
          color: rgba(255, 255, 255, 0.3);
        }

        .platform-title {
          font-family: var(--font-serif);
          font-size: 1.2rem;
          font-weight: 500;
        }

        .header-right {
          display: flex;
          align-items: center;
          gap: 1rem;
          font-size: 0.8125rem;
        }

        .env-tag {
          background: #b08d57;
          color: var(--color-white);
          padding: 0.2rem 0.5rem;
          font-weight: 600;
          border-radius: 2px;
        }

        .principal-tag {
          color: rgba(255, 255, 255, 0.8);
        }

        .platform-nav {
          background-color: var(--color-offwhite);
          border-bottom: 1px solid var(--color-border);
        }

        .nav-strip {
          display: flex;
          gap: 1.5rem;
          overflow-x: auto;
        }

        .nav-btn {
          padding: 1.1rem 0;
          font-size: 0.875rem;
          font-weight: 500;
          color: var(--color-grey);
          position: relative;
          white-space: nowrap;
        }

        .nav-btn.active {
          color: var(--color-navy);
          font-weight: 600;
        }

        .nav-btn.active::after {
          content: '';
          position: absolute;
          bottom: 0;
          left: 0;
          width: 100%;
          height: 2px;
          background-color: var(--color-navy);
        }

        .badge {
          background-color: var(--color-gold);
          color: var(--color-white);
          font-size: 0.6875rem;
          padding: 0.1rem 0.4rem;
          border-radius: 8px;
          margin-left: 0.35rem;
        }

        .platform-body {
          padding-top: var(--spacing-xl);
          padding-bottom: var(--spacing-3xl);
        }

        .pane-heading {
          font-size: 2.25rem;
          margin-bottom: 0.5rem;
        }

        .pane-sub {
          color: var(--color-grey);
          margin-bottom: 2.5rem;
          max-width: 820px;
        }

        .notice {
          padding: 1rem 1.25rem;
          margin-bottom: 2rem;
          border-radius: 2px;
          font-size: 0.9375rem;
        }

        .notice-ok {
          background-color: #f0fdf4;
          color: #166534;
          border: 1px solid #bbf7d0;
        }

        .notice-err {
          background-color: #fef2f2;
          color: #991b1b;
          border: 1px solid #fecaca;
        }

        .two-column-split {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 2.5rem;
        }

        .card-pane {
          border: 1px solid var(--color-border);
          background-color: var(--color-offwhite);
          padding: 2.25rem;
        }

        .card-heading {
          font-family: var(--font-serif);
          font-size: 1.5rem;
          color: var(--color-navy);
          margin-bottom: 0.5rem;
        }

        .card-sub {
          font-size: 0.875rem;
          color: var(--color-grey);
          margin-bottom: 1.5rem;
        }

        .clean-form .field {
          margin-bottom: 1.25rem;
        }

        .field-label {
          display: block;
          font-size: 0.8125rem;
          font-weight: 600;
          color: var(--color-navy);
          margin-bottom: 0.35rem;
          text-transform: uppercase;
          letter-spacing: 0.04em;
        }

        .field-help {
          display: block;
          font-size: 0.75rem;
          color: var(--color-grey);
          margin-top: 0.35rem;
        }

        .text-input {
          font-family: var(--font-sans);
          font-size: 0.9375rem;
          padding: 0.75rem 1rem;
          border: 1px solid var(--color-border);
          border-radius: 2px;
          width: 100%;
          background-color: var(--color-white);
          color: var(--color-navy);
          outline: none;
        }

        .text-input:focus {
          border-color: var(--color-navy);
        }

        .row-2 {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 1.25rem;
        }

        .table-responsive {
          overflow-x: auto;
          background: var(--color-white);
          border: 1px solid var(--color-border);
        }

        .editorial-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 0.875rem;
          text-align: left;
        }

        .editorial-table th, .editorial-table td {
          padding: 0.875rem 1rem;
          border-bottom: 1px solid var(--color-border);
        }

        .editorial-table th {
          background-color: var(--color-offwhite);
          font-weight: 600;
          color: var(--color-navy);
        }

        .numeric {
          font-variant-numeric: tabular-nums;
          font-weight: 600;
        }

        .vault-flow-box {
          display: flex;
          flex-direction: column;
          gap: 2rem;
          max-width: 850px;
        }

        .vault-step {
          border: 1px solid var(--color-border);
          background-color: var(--color-offwhite);
          padding: 2rem;
        }

        .active-step {
          border-left: 4px solid var(--color-gold);
        }

        .step-tag {
          font-size: 0.75rem;
          font-weight: 700;
          color: var(--color-gold);
          letter-spacing: 0.08em;
          margin-bottom: 0.5rem;
        }

        .step-name {
          font-family: var(--font-serif);
          font-size: 1.6rem;
          margin-bottom: 1.5rem;
        }

        .details-matrix {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 1.25rem;
          margin-bottom: 1.75rem;
          background: var(--color-white);
          padding: 1.25rem;
          border: 1px solid var(--color-border);
        }

        .details-matrix .lbl {
          display: block;
          font-size: 0.75rem;
          color: var(--color-grey);
          text-transform: uppercase;
          margin-bottom: 0.25rem;
        }

        .details-matrix .val {
          font-size: 0.9375rem;
          font-weight: 500;
        }

        .crypto-seal-box {
          background: var(--color-white);
          border: 1px solid var(--color-border);
          padding: 1.25rem;
          font-size: 0.875rem;
        }

        .crypto-seal-box code {
          display: block;
          word-break: break-all;
          background: var(--color-offwhite);
          padding: 0.5rem;
          margin-top: 0.35rem;
          margin-bottom: 1rem;
          font-size: 0.75rem;
        }

        .seal-note {
          color: var(--color-brown);
          font-size: 0.8125rem;
        }

        .order-summary-box {
          background: var(--color-white);
          border: 1px solid var(--color-border);
          padding: 1.25rem;
          margin-bottom: 1.5rem;
        }

        .capture-success-box {
          background: #f0fdf4;
          border: 1px solid #bbf7d0;
          padding: 1.5rem;
          margin-top: 1rem;
        }

        .capture-success-box h4 {
          font-size: 1.25rem;
          color: #166534;
          margin: 0.75rem 0;
        }

        .empty-box {
          border: 1px dashed var(--color-border);
          padding: 3rem;
          text-align: center;
          color: var(--color-grey);
        }

        .empty-box button {
          margin-top: 1rem;
        }

        .developer-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 2rem;
        }

        .dev-card {
          border: 1px solid var(--color-border);
          background-color: var(--color-offwhite);
          padding: 2rem;
        }

        .dev-card h4 {
          font-family: var(--font-serif);
          font-size: 1.35rem;
          margin-bottom: 1.25rem;
        }

        .dev-field {
          margin-bottom: 1rem;
          font-size: 0.875rem;
        }

        .dev-field span {
          display: block;
          color: var(--color-grey);
          font-size: 0.75rem;
          text-transform: uppercase;
          margin-bottom: 0.2rem;
        }

        .dev-field code {
          background: var(--color-white);
          padding: 0.25rem 0.5rem;
          border: 1px solid var(--color-border);
          font-size: 0.8125rem;
        }

        .event-tag {
          font-family: monospace;
          background: var(--color-grey-light);
          padding: 0.15rem 0.4rem;
          font-size: 0.75rem;
        }

        @media (max-width: 900px) {
          .two-column-split, .developer-grid, .details-matrix, .row-2 {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </div>
  );
};
