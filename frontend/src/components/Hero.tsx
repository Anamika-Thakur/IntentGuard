import React from 'react';

interface HeroProps {
  onExplore: () => void;
  onHowItWorks: () => void;
}

export const Hero: React.FC<HeroProps> = ({ onExplore, onHowItWorks }) => {
  return (
    <section className="hero-section">
      <div className="hero-image-wrapper">
        <img
          src="/hero_financial_architecture.jpg"
          alt="IntentGuard Architectural Interior"
          className="hero-image"
        />
        <div className="hero-overlay" />
      </div>

      <div className="container hero-content">
        <h1 className="hero-headline">
          Your Intent. <br />
          Your Money. <br />
          Your Control.
        </h1>

        <p className="hero-tagline">
          Give AI agents the freedom to act, without giving up control of your payments.
        </p>

        <div className="hero-actions">
          <button className="btn-primary btn-gold hero-cta-primary" onClick={onExplore}>
            Explore IntentGuard
          </button>
          <button className="btn-secondary hero-cta-secondary" onClick={onHowItWorks}>
            How It Works
          </button>
        </div>
      </div>

      <style>{`
        .hero-section {
          position: relative;
          min-height: 92vh;
          display: flex;
          align-items: center;
          padding-top: 7rem;
          padding-bottom: 5rem;
          color: var(--color-white);
        }

        .hero-image-wrapper {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          overflow: hidden;
          z-index: 1;
        }

        .hero-image {
          width: 100%;
          height: 100%;
          object-fit: cover;
          object-position: center 30%;
        }

        .hero-overlay {
          position: absolute;
          inset: 0;
          background: linear-gradient(
            180deg,
            rgba(20, 43, 69, 0.72) 0%,
            rgba(20, 43, 69, 0.6) 45%,
            rgba(20, 43, 69, 0.85) 100%
          );
        }

        .hero-content {
          position: relative;
          z-index: 2;
          max-width: var(--max-width);
          padding-top: 3rem;
        }

        .hero-headline {
          font-family: var(--font-serif);
          font-size: clamp(3.2rem, 7vw, 6.2rem);
          font-weight: 400;
          color: var(--color-white);
          line-height: 1.05;
          letter-spacing: -0.02em;
          margin-bottom: 2rem;
          max-width: 900px;
        }

        .hero-tagline {
          font-family: var(--font-serif);
          font-style: italic;
          font-size: clamp(1.25rem, 2.5vw, 1.85rem);
          color: rgba(255, 255, 255, 0.9);
          line-height: 1.45;
          margin-bottom: 3rem;
          max-width: 680px;
        }

        .hero-actions {
          display: flex;
          align-items: center;
          gap: 1.5rem;
        }

        .hero-cta-primary {
          background-color: var(--color-gold);
          color: var(--color-white);
          border-color: var(--color-gold);
          padding: 1.1rem 2.5rem;
          font-size: 0.875rem;
          letter-spacing: 0.05em;
        }

        .hero-cta-primary:hover {
          background-color: var(--color-gold-hover);
          border-color: var(--color-gold-hover);
        }

        .hero-cta-secondary {
          border-color: rgba(255, 255, 255, 0.45);
          color: var(--color-white);
          padding: 1.1rem 2.5rem;
          font-size: 0.875rem;
          letter-spacing: 0.05em;
        }

        .hero-cta-secondary:hover {
          background-color: rgba(255, 255, 255, 0.1);
          border-color: var(--color-white);
        }

        @media (max-width: 768px) {
          .hero-section {
            min-height: 85vh;
            padding-top: 6rem;
          }
          .hero-actions {
            flex-direction: column;
            align-items: flex-start;
            gap: 1rem;
          }
          .hero-actions button {
            width: 100%;
          }
        }
      `}</style>
    </section>
  );
};
