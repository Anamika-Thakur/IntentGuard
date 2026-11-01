import React from 'react';

interface NavbarProps {
  currentView: string;
  onNavigate: (view: string) => void;
  isScrolled?: boolean;
}

export const Navbar: React.FC<NavbarProps> = ({ currentView, onNavigate }) => {
  return (
    <header className="navbar-wrapper">
      <div className="container navbar-inner">
        {/* Brand Logo */}
        <button
          className="brand-logo"
          onClick={() => onNavigate('home')}
          aria-label="IntentGuard Home"
        >
          <div className="logo-mark">
            <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path
                d="M7 5L15 12L7 19"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="square"
                strokeLinejoin="miter"
              />
              <circle cx="17.5" cy="12" r="1.75" fill="var(--color-gold)" />
            </svg>
          </div>
          <span className="brand-wordmark">IntentGuard</span>
        </button>

        {/* Minimal Navigation Items */}
        <nav className="nav-links">
          <button
            className={`nav-link ${currentView === 'home' ? 'active' : ''}`}
            onClick={() => onNavigate('home')}
          >
            Product
          </button>
          <a href="#how-it-works" className="nav-link" onClick={() => onNavigate('home')}>
            How It Works
          </a>
          <a href="#security" className="nav-link" onClick={() => onNavigate('home')}>
            Security
          </a>
          <button
            className={`nav-link ${currentView === 'activity' ? 'active' : ''}`}
            onClick={() => onNavigate('activity')}
          >
            Activity
          </button>
          <button
            className="btn-primary btn-sm nav-cta"
            onClick={() => onNavigate('console')}
          >
            {currentView === 'console' ? 'Console Active' : 'Launch Console'}
          </button>
        </nav>
      </div>

      <style>{`
        .navbar-wrapper {
          position: absolute;
          top: 0;
          left: 0;
          width: 100%;
          z-index: 100;
          padding: 1.75rem 0;
          border-bottom: 1px solid rgba(255, 255, 255, 0.12);
        }

        .navbar-inner {
          display: flex;
          align-items: center;
          justify-content: space-between;
        }

        .brand-logo {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          color: var(--color-white);
        }

        .logo-mark {
          width: 22px;
          height: 22px;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .logo-mark svg {
          width: 100%;
          height: 100%;
          color: var(--color-white);
        }

        .brand-wordmark {
          font-family: var(--font-serif);
          font-size: 1.45rem;
          font-weight: 600;
          letter-spacing: -0.01em;
          color: var(--color-white);
        }

        .nav-links {
          display: flex;
          align-items: center;
          gap: 2.25rem;
        }

        .nav-link {
          font-family: var(--font-sans);
          font-size: 0.875rem;
          font-weight: 500;
          color: rgba(255, 255, 255, 0.8);
          letter-spacing: 0.02em;
          position: relative;
        }

        .nav-link:hover,
        .nav-link.active {
          color: var(--color-white);
        }

        .nav-cta {
          margin-left: 0.5rem;
          background-color: var(--color-white);
          color: var(--color-navy);
          border-color: var(--color-white);
        }

        .nav-cta:hover {
          background-color: var(--color-offwhite);
          color: var(--color-navy-dark);
        }

        @media (max-width: 768px) {
          .nav-links {
            gap: 1.25rem;
          }
          .nav-links a {
            display: none;
          }
        }
      `}</style>
    </header>
  );
};
