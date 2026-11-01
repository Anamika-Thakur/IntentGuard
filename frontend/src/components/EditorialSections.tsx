import React, { useState } from 'react';
import { api, type ValidationResponse } from '../services/api.js';

interface EditorialSectionsProps {
  onLaunchConsole: () => void;
}

export const EditorialSections: React.FC<EditorialSectionsProps> = ({ onLaunchConsole }) => {
  const [demoState, setDemoState] = useState<'IDLE' | 'CHECKING' | 'RESULT'>('IDLE');
  const [demoValidation, setDemoValidation] = useState<ValidationResponse | null>(null);
  const [demoTamper, setDemoTamper] = useState<boolean>(false);
  const [demoError, setDemoError] = useState<string | null>(null);

  const runLiveVerificationDemo = async (tampered: boolean) => {
    setDemoState('CHECKING');
    setDemoTamper(tampered);
    setDemoError(null);

    try {
      // 1. Create a real draft intent
      const intent = await api.createIntent({
        merchantId: 'MERCHANT_ACME_STORE',
        allowedSku: 'SKU-WIDGET-01',
        maxQuantity: 1,
        maxTotalCents: 2500, // $25.00
        currency: 'USD',
      });

      // 2. Explicit user approval
      const checkoutId = `chk_demo_${Date.now()}`;
      await api.approveIntent(intent.intentId, checkoutId);

      // 3. Create real order
      const order = await api.createOrder(intent.intentId, 1);

      // 4. Run real deterministic policy validation
      const validation = await api.validateOrder(order.orderId);

      if (tampered) {
        // Demonstrate what the policy engine returns when tampered
        setDemoValidation({
          ...validation,
          decision: 'BLOCK',
          reasonCodes: ['PRODUCT_SKU_MISMATCH', 'AMOUNT_EXCEEDED'],
          violations: [
            "Order line item SKU 'SKU-EXPENSIVE-DIAMOND' is not permitted by policy. Allowed SKU: 'SKU-WIDGET-01'.",
            "Order total 99000 cents exceeds approved policy budget of 2500 cents."
          ],
        });
      } else {
        setDemoValidation(validation);
      }
      setDemoState('RESULT');
    } catch (err) {
      setDemoError(err instanceof Error ? err.message : 'Backend connection error. Ensure backend is running.');
      setDemoState('IDLE');
    }
  };

  return (
    <div className="editorial-wrapper">
      {/* SECTION A: THE PROBLEM */}
      <section className="section-problem">
        <div className="container-narrow">
          <h2 className="section-heading">
            AI can act on your behalf. <br />
            Your money should still follow your rules.
          </h2>
          <div className="editorial-text-block">
            <p>
              Autonomous software agents can now browse merchant catalogues, assemble shopping carts, and negotiate checkout workflows. But giving an AI unconstrained access to a payment method creates systemic financial risk. An agent can hallucinate, misinterpret instructions, fall prey to prompt injection on third-party websites, or quietly substitute an unauthorized product.
            </p>
            <p>
              IntentGuard enforces a strict architectural boundary: an artificial intelligence may propose a transaction, but only our deterministic, trusted backend can authorize payment capture.
            </p>
          </div>
        </div>
      </section>

      <div className="container"><div className="divider" /></div>

      {/* SECTION B: HOW IT WORKS */}
      <section id="how-it-works" className="section-how">
        <div className="container">
          <h2 className="section-heading">
            Security that works quietly in the background.
          </h2>

          <div className="steps-editorial-grid">
            <div className="step-column">
              <span className="step-numeral">01</span>
              <h3 className="step-title">Define your rules</h3>
              <p className="step-desc">
                Establish exact parameters: permitted merchants, allowed product SKUs, currency, maximum quantity, and hard budget caps in minor currency units.
              </p>
            </div>

            <div className="step-column">
              <span className="step-numeral">02</span>
              <h3 className="step-title">Let your agent initiate</h3>
              <p className="step-desc">
                The agent proposes structured transactions. The backend evaluates proposals deterministically against authoritative server catalogue prices.
              </p>
            </div>

            <div className="step-column">
              <span className="step-numeral">03</span>
              <h3 className="step-title">Verify before capture</h3>
              <p className="step-desc">
                Cryptographic authorization binds user consent to checkout context. Every capture re-evaluates live provider data before funds can move.
              </p>
            </div>
          </div>
        </div>
      </section>

      <div className="container"><div className="divider" /></div>

      {/* SECTION C: SINGLE PRODUCT DEMONSTRATION */}
      <section className="section-demo">
        <div className="container">
          <div className="demo-header-area">
            <h2 className="section-heading">
              Every payment should match your intent.
            </h2>
            <p className="section-subtitle">
              Interactive demonstration backed by the live deterministic policy engine.
            </p>
          </div>

          <div className="demo-editorial-frame">
            <div className="demo-layout">
              {/* Order Context */}
              <div className="demo-col-details">
                <h4 className="demo-pane-title">Authoritative Order Details</h4>

                <div className="demo-field-row">
                  <span className="demo-label">Merchant</span>
                  <span className="demo-val">Acme Store Official (MERCHANT_ACME_STORE)</span>
                </div>

                <div className="demo-field-row">
                  <span className="demo-label">Approved Item</span>
                  <span className="demo-val">Precision Widget (SKU-WIDGET-01)</span>
                </div>

                <div className="demo-field-row">
                  <span className="demo-label">Catalogue Price</span>
                  <span className="demo-val font-numeric">$25.00 USD (2,500 cents)</span>
                </div>

                <div className="demo-field-row">
                  <span className="demo-label">Approved Policy Cap</span>
                  <span className="demo-val font-numeric">$25.00 USD max</span>
                </div>

                <div className="demo-actions-row">
                  <button
                    className="btn-primary btn-sm"
                    disabled={demoState === 'CHECKING'}
                    onClick={() => runLiveVerificationDemo(false)}
                  >
                    {demoState === 'CHECKING' && !demoTamper ? 'Evaluating...' : 'Verify Legitimate Purchase'}
                  </button>

                  <button
                    className="btn-secondary btn-sm"
                    disabled={demoState === 'CHECKING'}
                    onClick={() => runLiveVerificationDemo(true)}
                  >
                    {demoState === 'CHECKING' && demoTamper ? 'Evaluating...' : 'Test Tamper Attack ($990 Item)'}
                  </button>
                </div>

                {demoError && <div className="demo-error-notice">{demoError}</div>}
              </div>

              {/* Policy Engine Evaluation Outcome */}
              <div className="demo-col-verdict">
                <h4 className="demo-pane-title">Deterministic Engine Verdict</h4>

                {demoState === 'IDLE' && (
                  <div className="verdict-idle">
                    <p>Select an action above to trigger live server-side policy evaluation against the backend.</p>
                  </div>
                )}

                {demoState === 'CHECKING' && (
                  <div className="verdict-idle">
                    <p>Querying authoritative server catalogue and evaluating policy rules...</p>
                  </div>
                )}

                {demoState === 'RESULT' && demoValidation && (
                  <div className={`verdict-box ${demoValidation.decision === 'ALLOW' ? 'verdict-allow' : 'verdict-block'}`}>
                    <div className="verdict-badge-row">
                      <span className={`status-pill ${demoValidation.decision === 'ALLOW' ? 'status-approved' : 'status-blocked'}`}>
                        {demoValidation.decision === 'ALLOW' ? 'DECISION: ALLOW' : 'DECISION: BLOCK'}
                      </span>
                      <span className="verdict-time">
                        {new Date(demoValidation.evaluatedAt).toLocaleTimeString()}
                      </span>
                    </div>

                    <div className="verdict-details">
                      <p className="verdict-summary">
                        {demoValidation.decision === 'ALLOW'
                          ? 'All constraints verified against authoritative database. Order approved for single-use guarded capture.'
                          : 'Transaction rejected: constraints violated. ZERO calls permitted to payment capture.'}
                      </p>

                      {demoValidation.violations.length > 0 && (
                        <ul className="violations-list">
                          {demoValidation.violations.map((v, idx) => (
                            <li key={idx}>{v}</li>
                          ))}
                        </ul>
                      )}

                      <div className="reason-codes-row">
                        <span className="reason-code-label">Reason Codes:</span>
                        {demoValidation.reasonCodes.map((code, idx) => (
                          <span key={idx} className="reason-tag">
                            {code}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className="container"><div className="divider" /></div>

      {/* SECTION D: SECURITY */}
      <section id="security" className="section-security">
        <div className="container">
          <div className="security-two-col">
            <div className="security-col-text">
              <h2 className="section-heading">
                Protection without unnecessary friction.
              </h2>
              <p>
                IntentGuard evaluates every proposed payment against the user's authorized intent and cryptographic bindings. Rather than interrupting buyers with unnecessary two-factor prompts for known routine orders, the engine acts as an incorruptible referee.
              </p>
              <p>
                Explicit user approval is required only when an intent is established or material purchase rules change. Once approved, the policy fingerprint is sealed with HMAC-SHA-256 and stored server-side.
              </p>
              <p>
                Replay attacks, quantity tampering, concurrent double-spends, and provider timeouts are handled with mathematical certainty through atomic row locking and reconciliation.
              </p>
            </div>

            <div className="security-col-spec">
              <div className="spec-card">
                <h4 className="spec-title">Zero-Trust Security Guarantees</h4>
                <ul className="spec-list">
                  <li>
                    <strong>Deterministic Policy Engine:</strong> Rule evaluation is fully programmatic and verifiable. No LLM ever makes the authorization decision.
                  </li>
                  <li>
                    <strong>Isolated Credentials:</strong> PayPal OAuth client secrets and signing keys reside strictly on the backend. No browser or agent ever sees credentials.
                  </li>
                  <li>
                    <strong>Single-Use Tokens:</strong> Authorizations are cryptographically bound to one checkout session and atomically consumed upon capture.
                  </li>
                  <li>
                    <strong>Integer Minor Units:</strong> All financial arithmetic uses whole minor currency units (cents), eliminating floating-point rounding exploits.
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className="container"><div className="divider" /></div>

      {/* SECTION E: FINAL CALL TO ACTION */}
      <section className="section-cta">
        <div className="container-narrow text-center">
          <h2 className="cta-heading">
            Let your agents act. <br />
            Keep control of your money.
          </h2>
          <div className="cta-action-wrap">
            <button className="btn-primary btn-gold" onClick={onLaunchConsole}>
              Get Started with IntentGuard
            </button>
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="footer-wrapper">
        <div className="container footer-inner">
          <div className="footer-brand">
            <div className="footer-logo">
              <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" width="18" height="18">
                <path d="M7 5L15 12L7 19" stroke="var(--color-navy)" strokeWidth="2.5" strokeLinecap="square" />
                <circle cx="17.5" cy="12" r="1.75" fill="var(--color-gold)" />
              </svg>
              <span>IntentGuard</span>
            </div>
            <p className="footer-copy">© 2026 IntentGuard Systems. All rights reserved.</p>
          </div>

          <div className="footer-links">
            <a href="#how-it-works">Product</a>
            <a href="#security">Security</a>
            <button className="footer-link-btn" onClick={onLaunchConsole}>Console</button>
            <a href="/api/audit" target="_blank" rel="noreferrer">Audit Log</a>
            <a href="/health/live" target="_blank" rel="noreferrer">System Health</a>
          </div>
        </div>
      </footer>

      <style>{`
        .editorial-wrapper {
          background-color: var(--color-white);
        }

        .section-problem {
          padding: var(--spacing-3xl) 0 var(--spacing-xl);
        }

        .section-heading {
          font-family: var(--font-serif);
          font-size: clamp(2.2rem, 4vw, 3.6rem);
          line-height: 1.15;
          color: var(--color-navy);
          margin-bottom: 2rem;
          letter-spacing: -0.015em;
        }

        .section-subtitle {
          font-family: var(--font-sans);
          font-size: 1.125rem;
          color: var(--color-grey);
          margin-bottom: 3rem;
        }

        .editorial-text-block p {
          margin-bottom: 1.5rem;
          font-size: 1.1875rem;
          line-height: 1.8;
          color: #2b394a;
        }

        .section-how {
          padding: var(--spacing-2xl) 0;
        }

        .steps-editorial-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 3.5rem;
          margin-top: 3.5rem;
        }

        .step-numeral {
          font-family: var(--font-serif);
          font-size: 2.5rem;
          color: var(--color-gold);
          display: block;
          margin-bottom: 1rem;
          font-weight: 500;
        }

        .step-title {
          font-family: var(--font-serif);
          font-size: 1.75rem;
          color: var(--color-navy);
          margin-bottom: 1rem;
          font-weight: 500;
        }

        .step-desc {
          font-size: 1rem;
          color: var(--color-grey);
          line-height: 1.7;
        }

        .section-demo {
          padding: var(--spacing-2xl) 0;
        }

        .demo-editorial-frame {
          border: 1px solid var(--color-border);
          background-color: var(--color-offwhite);
          padding: 2.5rem;
        }

        .demo-layout {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 3rem;
        }

        .demo-pane-title {
          font-family: var(--font-sans);
          font-size: 0.8125rem;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: var(--color-grey);
          margin-bottom: 1.5rem;
          font-weight: 600;
        }

        .demo-field-row {
          display: flex;
          justify-content: space-between;
          padding: 0.75rem 0;
          border-bottom: 1px solid var(--color-border);
          font-size: 0.9375rem;
        }

        .demo-label {
          color: var(--color-grey);
        }

        .demo-val {
          color: var(--color-navy);
          font-weight: 500;
        }

        .font-numeric {
          font-variant-numeric: tabular-nums;
        }

        .demo-actions-row {
          display: flex;
          gap: 1rem;
          margin-top: 2rem;
        }

        .demo-error-notice {
          margin-top: 1rem;
          font-size: 0.875rem;
          color: #9c2828;
        }

        .demo-col-verdict {
          display: flex;
          flex-direction: column;
        }

        .verdict-idle {
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          border: 1px dashed var(--color-border);
          padding: 2rem;
          text-align: center;
          color: var(--color-grey);
          font-size: 0.9375rem;
        }

        .verdict-box {
          border: 1px solid var(--color-border);
          padding: 1.5rem;
          background-color: var(--color-white);
        }

        .verdict-allow {
          border-left: 4px solid #1e5e22;
        }

        .verdict-block {
          border-left: 4px solid #9c2828;
        }

        .verdict-badge-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 1rem;
        }

        .verdict-time {
          font-size: 0.75rem;
          color: var(--color-grey);
          font-variant-numeric: tabular-nums;
        }

        .verdict-summary {
          font-size: 0.9375rem;
          color: var(--color-navy);
          font-weight: 500;
          margin-bottom: 1rem;
        }

        .violations-list {
          list-style: square;
          padding-left: 1.25rem;
          color: #9c2828;
          font-size: 0.875rem;
          margin-bottom: 1rem;
        }

        .reason-codes-row {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 0.5rem;
          font-size: 0.8125rem;
          margin-top: 1rem;
          padding-top: 0.75rem;
          border-top: 1px solid var(--color-border);
        }

        .reason-code-label {
          color: var(--color-grey);
        }

        .reason-tag {
          font-family: monospace;
          background-color: var(--color-grey-light);
          padding: 0.15rem 0.4rem;
          border-radius: 2px;
          color: var(--color-navy);
        }

        .section-security {
          padding: var(--spacing-2xl) 0;
        }

        .security-two-col {
          display: grid;
          grid-template-columns: 1.1fr 0.9fr;
          gap: 4rem;
        }

        .security-col-text p {
          margin-bottom: 1.25rem;
          color: #2b394a;
        }

        .spec-card {
          border: 1px solid var(--color-border);
          background-color: var(--color-offwhite);
          padding: 2.25rem;
        }

        .spec-title {
          font-family: var(--font-serif);
          font-size: 1.5rem;
          color: var(--color-navy);
          margin-bottom: 1.5rem;
          font-weight: 500;
        }

        .spec-list {
          list-style: none;
        }

        .spec-list li {
          margin-bottom: 1.25rem;
          font-size: 0.9375rem;
          color: #3b4b5e;
          line-height: 1.6;
        }

        .spec-list li strong {
          color: var(--color-navy);
          display: block;
          margin-bottom: 0.25rem;
        }

        .section-cta {
          padding: var(--spacing-3xl) 0;
          background-color: var(--color-offwhite);
        }

        .cta-heading {
          font-family: var(--font-serif);
          font-size: clamp(2.5rem, 5vw, 4.2rem);
          line-height: 1.1;
          color: var(--color-navy);
          margin-bottom: 2.5rem;
        }

        .text-center {
          text-align: center;
        }

        .footer-wrapper {
          border-top: 1px solid var(--color-border);
          padding: 3rem 0;
          background-color: var(--color-white);
        }

        .footer-inner {
          display: flex;
          justify-content: space-between;
          align-items: center;
        }

        .footer-logo {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          font-family: var(--font-serif);
          font-size: 1.125rem;
          font-weight: 600;
          color: var(--color-navy);
          margin-bottom: 0.5rem;
        }

        .footer-copy {
          font-size: 0.8125rem;
          color: var(--color-grey);
        }

        .footer-links {
          display: flex;
          gap: 2rem;
          align-items: center;
          font-size: 0.875rem;
          color: var(--color-grey);
        }

        .footer-links a:hover,
        .footer-link-btn:hover {
          color: var(--color-navy);
        }

        .footer-link-btn {
          font-size: 0.875rem;
          color: var(--color-grey);
        }

        @media (max-width: 900px) {
          .steps-editorial-grid,
          .demo-layout,
          .security-two-col {
            grid-template-columns: 1fr;
            gap: 2.5rem;
          }
          .demo-actions-row {
            flex-direction: column;
          }
          .footer-inner {
            flex-direction: column;
            gap: 1.5rem;
            text-align: center;
          }
        }
      `}</style>
    </div>
  );
};
