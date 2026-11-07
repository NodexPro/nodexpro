/**
 * Visual harness for Owner Localization Issues red cards.
 * Uses TEST-ONLY Hebrew system chrome, not production data or user text.
 */
import { createRoot } from 'react-dom/client';
import '../src/pages/owner-modules/nx-owner-modules.css';

type Issue = {
  id: string;
  kind: string;
  tab: string;
  location: string;
  localization_key: string | null;
  current_displayed_text: string;
  source_language: string;
  target_language: string;
  reason: string;
  requires_code_fix: boolean;
  editable: boolean;
};

const TEST_ONLY_ISSUE: Issue = {
  id: 'hardcoded:test-only:registry-toolbar-hebrew-chrome',
  kind: 'Hardcoded / unconnected',
  tab: 'Registry',
  location: 'Toolbar test chrome',
  localization_key: null,
  current_displayed_text: 'כפתור מערכת לבדיקה',
  source_language: 'he',
  target_language: 'en',
  reason: 'Permanent system chrome rendered in Hebrew with no localization key. User-entered Hebrew is not this issue.',
  requires_code_fix: true,
  editable: false,
};


function IssueCard({ issue }: { issue: Issue }) {
  return (
    <article className="nx-owner-issue-card" data-issue-id={issue.id}>
      <header className="nx-owner-issue-card__header">
        <strong>{issue.kind}</strong>
        <span>
          {issue.tab} · {issue.location}
        </span>
      </header>
      {issue.requires_code_fix ? (
        <p className="nx-owner-issue-card__code-fix">
          Requires code fix. Editing a translation will not change this hardcoded label.
        </p>
      ) : null}
      <dl className="nx-owner-issue-card__meta">
        <div>
          <dt>Current displayed system text</dt>
          <dd dir={issue.source_language === 'he' ? 'rtl' : 'ltr'}>{issue.current_displayed_text}</dd>
        </div>
        <div>
          <dt>Source → target</dt>
          <dd>
            {issue.source_language} → {issue.target_language} (LTR)
          </dd>
        </div>
        <div>
          <dt>Localization key</dt>
          <dd>{issue.localization_key ? <code>{issue.localization_key}</code> : 'Not connected'}</dd>
        </div>
      </dl>
      <p>{issue.reason}</p>
    </article>
  );
}

function App() {
  return (
    <div className="nx-owner-modules" style={{ padding: 24, maxWidth: 960 }}>
      <h1 className="nx-owner-modules__title">Languages & Translations — issues harness</h1>
      <p className="nx-owner-modules__subtitle">
        TEST-ONLY Hebrew system chrome. User-entered Hebrew is not shown as an issue.
      </p>
      <dl className="nx-owner-coverage-strip">
        <div>
          <dt>Catalog coverage</dt>
          <dd>1092/1092 keys live</dd>
        </div>
        <div>
          <dt>UI strings inventoried</dt>
          <dd>not equal to catalog size</dd>
        </div>
        <div>
          <dt>UI strings verified</dt>
          <dd>source-inspected chrome</dd>
        </div>
        <div>
          <dt>Unverified UI strings</dt>
          <dd>3</dd>
        </div>
        <div>
          <dt>Confirmed localization issues</dt>
          <dd>clientOperations / en: test fixture only</dd>
        </div>
      </dl>
      <p className="nx-owner-coverage-warning">
        Catalog coverage is not UI coverage. Zero confirmed issues is not complete Client Operations localization
        while unverified or hardcoded UI strings remain.
      </p>
      <h2>Before code fix — test fixture</h2>
      <IssueCard issue={TEST_ONLY_ISSUE} />
      <h2>After code fix — same catalog, fixture removed</h2>
      <p>No confirmed localization issues for this module and language.</p>
      <h2>Remaining production code-fix cards</h2>
      <p>Accounting income and expense summary rows are connected. No remaining production hardcoded cards in this inventory.</p>
      <div className="nx-owner-issue-unverified">
        <h4>Unverified surfaces</h4>
        <ul>
          <li>
            <strong>Legacy Accounting tab:</strong> ClientAccountingTab is hardcoded Hebrew but is not mounted.
          </li>
          <li>
            <strong>DocFlow empty/error:</strong> keys are wired; live office case was not exercised.
          </li>
          <li>
            <strong>Office session:</strong> live Client Operations tabs were not clicked without an office login.
          </li>
        </ul>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
