import { Link } from 'react-router-dom';
import logoSrc from '../templates/template-1/assets/nodexpro-logo.png';
import '../styles/nx-landing.css';

const MODULES = [
  {
    key: 'work_engine',
    title: 'Work Engine',
    description: 'Operational queues and client document workflows in one connected workspace.',
  },
  {
    key: 'accounting',
    title: 'Accounting',
    description: 'Financial entries, balances, and summaries grounded in Accounting Base.',
  },
  {
    key: 'invoices',
    title: 'Invoices',
    description: 'Create and manage income documents for your office and represented clients.',
  },
  {
    key: 'clients',
    title: 'Clients',
    description: 'Organize office clients, contacts, and day-to-day client operations.',
  },
  {
    key: 'documents',
    title: 'Documents',
    description: 'Keep client documents and related delivery workflows in one place.',
  },
  {
    key: 'tax_brain',
    title: 'Tax Brain',
    description: 'Tax settings and obligations for client operations — without inventing legal truth.',
  },
] as const;

export function LandingPage() {
  return (
    <div className="nx-landing">
      <header className="nx-landing__header">
        <div className="nx-landing__header-inner">
          <Link to="/" className="nx-landing__brand" aria-label="NodexPro home">
            <img className="nx-landing__logo" src={logoSrc} alt="NodexPro" />
          </Link>
          <nav className="nx-landing__nav" aria-label="Account">
            <Link to="/login" className="nx-landing__nav-link">
              Login
            </Link>
            <Link to="/register" className="nx-landing__nav-cta">
              Sign in
            </Link>
          </nav>
        </div>
        <div className="nx-landing__horizon" aria-hidden />
      </header>

      <section className="nx-landing__hero" aria-label="NodexPro introduction">
        <div className="nx-landing__hero-content">
          <h1 className="nx-landing__hero-title">
            One Platform.
            <br />
            All Your Business<span className="nx-landing__hero-accent">.</span>
          </h1>
          <p className="nx-landing__hero-lead">
            NodexPro brings your work, clients, finance, documents and operations together in one
            connected business platform.
          </p>
          <div className="nx-landing__hero-actions">
            <Link to="/register" className="nx-landing__btn nx-landing__btn--primary">
              Get Started
            </Link>
            <Link to="/login" className="nx-landing__btn nx-landing__btn--ghost">
              Login
            </Link>
          </div>
        </div>
      </section>

      <section className="nx-landing__modules" aria-labelledby="nx-landing-modules-heading">
        <div className="nx-landing__modules-inner">
          <p className="nx-landing__eyebrow">POWERFUL MODULES</p>
          <h2 id="nx-landing-modules-heading" className="nx-landing__modules-title">
            Everything you need.
            <br />
            In one platform.
          </h2>
          <div className="nx-landing__module-grid">
            {MODULES.map((mod) => (
              <article key={mod.key} className="nx-landing__module-card">
                <h3 className="nx-landing__module-name">{mod.title}</h3>
                <p className="nx-landing__module-desc">{mod.description}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <footer className="nx-landing__footer">
        <p className="nx-landing__footer-copy">© {new Date().getFullYear()} NodexPro</p>
      </footer>
    </div>
  );
}
