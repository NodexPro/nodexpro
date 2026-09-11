import type { ReactNode } from 'react';
import {
  BUSINESS_SETUP_AI_OWNER_NAV,
  type BusinessSetupAiOwnerSectionId,
} from './owner-business-setup-ai-nav';
import '../styles/nx-modal.css';
import '../styles/nx-owner-business-setup-ai.css';

export type OwnerBusinessSetupAiCountryOption = {
  code: string;
  name: string;
};

export function OwnerBusinessSetupAiWorkspace({
  activeSection,
  onSelectSection,
  countryCode,
  countries,
  countryBusy,
  onSelectCountry,
  warningCount,
  warningsOpen,
  onToggleWarnings,
  warnings,
  error,
  children,
}: {
  activeSection: BusinessSetupAiOwnerSectionId;
  onSelectSection: (id: BusinessSetupAiOwnerSectionId) => void;
  countryCode: string;
  countries: OwnerBusinessSetupAiCountryOption[];
  countryBusy: boolean;
  onSelectCountry: (countryCode: string) => void;
  warningCount: number;
  warningsOpen: boolean;
  onToggleWarnings: () => void;
  warnings: string[];
  error: string;
  children: ReactNode;
}) {
  return (
    <div className="nx-bsai-workspace">
      <aside className="nx-bsai-sidebar">
        <p className="nx-bsai-sidebar__eyebrow">Owner</p>
        <h1 className="nx-bsai-sidebar__title">Business Setup AI</h1>
        {BUSINESS_SETUP_AI_OWNER_NAV.map((group) => (
          <div key={group.group} className="nx-bsai-nav-group">
            <p className="nx-bsai-nav-group__label">{group.group}</p>
            {group.items.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`nx-bsai-nav-item${activeSection === item.id ? ' is-active' : ''}`}
                aria-current={activeSection === item.id ? 'page' : undefined}
                onClick={() => onSelectSection(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>
        ))}
      </aside>
      <div className="nx-bsai-main">
        <div className="nx-bsai-toolbar">
          <div>
            <h2 className="nx-bsai-toolbar__title">Business Setup AI — Owner</h2>
            <p className="nx-bsai-toolbar__subtitle">Tax knowledge, legal values, and strategy for Business Setup AI.</p>
          </div>
          <div className="nx-bsai-toolbar__controls">
            <label className="nx-bsai-field">
              Country
              <select
                value={countryCode}
                disabled={countryBusy}
                onChange={(e) => onSelectCountry(e.target.value)}
              >
                <option value="">Select country</option>
                {countries.map((country) => (
                  <option key={country.code} value={country.code}>
                    {country.code} — {country.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="nx-btn nx-btn-taxes-compact nx-bsai-warning-btn"
              onClick={onToggleWarnings}
            >
              Warnings
              {warningCount ? <span className="nx-bsai-warning-count">{warningCount}</span> : null}
            </button>
          </div>
        </div>
        {error ? <p className="nx-bsai-error">{error}</p> : null}
        {warningsOpen ? (
          <div className="nx-bsai-warnings">
            <strong>Owner warnings</strong>
            {warnings.length ? (
              <ul>
                {warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            ) : (
              <p style={{ margin: '8px 0 0', color: '#6b7280', fontSize: 13 }}>No owner warnings from the aggregate.</p>
            )}
          </div>
        ) : null}
        {children}
      </div>
    </div>
  );
}
