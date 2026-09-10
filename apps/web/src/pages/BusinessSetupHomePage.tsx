import { Link } from 'react-router-dom';

/**
 * Module home for Business Setup. No extra GET — open a client workspace for the case aggregate.
 */
export function BusinessSetupHomePage() {
  return (
    <div style={{ direction: 'rtl', padding: 16, maxWidth: 720 }}>
      <h1 style={{ fontSize: 22, marginBottom: 8 }}>Business Setup</h1>
      <p style={{ color: '#4b5563', lineHeight: 1.5 }}>
        Open a client to start or continue a Business Setup case. Tax evaluation is not run from this screen.
      </p>
      <p style={{ marginTop: 16 }}>
        <Link to="/clients" className="nx-btn nx-btn-taxes-compact">
          Clients
        </Link>
      </p>
    </div>
  );
}
