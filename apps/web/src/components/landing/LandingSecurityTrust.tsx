import { useI18n } from '../../i18n/I18nProvider';
import {
  LANDING_SECURITY_TRUST_CARD_KEYS,
  type LandingSecurityTrustCardKey,
} from './landing-security-trust.pure';

function SecurityTrustIcon({ kind }: { kind: LandingSecurityTrustCardKey }) {
  const common = {
    className: 'nx-landing__trust-icon',
    viewBox: '0 0 24 24',
    'aria-hidden': true,
    focusable: false,
  } as const;

  if (kind === 'access') {
    return (
      <svg {...common}>
        <path
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinejoin="round"
          d="M12 3.2 4.8 6.2v5.1c0 4.6 3.1 8.1 7.2 9.5 4.1-1.4 7.2-4.9 7.2-9.5V6.2L12 3.2Z"
        />
        <path fill="none" stroke="currentColor" strokeWidth="1.6" d="M9.4 12.1 11.1 13.8 14.8 9.8" />
      </svg>
    );
  }
  if (kind === 'protection') {
    return (
      <svg {...common}>
        <rect x="6" y="10.2" width="12" height="9.2" rx="1.6" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <path fill="none" stroke="currentColor" strokeWidth="1.6" d="M8.4 10.2V8.1a3.6 3.6 0 0 1 7.2 0v2.1" />
      </svg>
    );
  }
  if (kind === 'accountability') {
    return (
      <svg {...common}>
        <rect x="5.2" y="4.4" width="13.6" height="15.2" rx="1.6" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <path fill="none" stroke="currentColor" strokeWidth="1.6" d="M8.2 9h7.6M8.2 12.2h7.6M8.2 15.4h5.2" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        d="M12 4.4a4.4 4.4 0 0 1 4.4 4.4v1.4H7.6V8.8A4.4 4.4 0 0 1 12 4.4Z"
      />
      <circle cx="12" cy="14.8" r="4.4" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path fill="none" stroke="currentColor" strokeWidth="1.6" d="M12 13v2.2l1.4.9" />
    </svg>
  );
}

export function LandingSecurityTrust() {
  const { t } = useI18n();

  return (
    <section className="nx-landing__trust" aria-labelledby="nx-landing-trust-heading">
      <div className="nx-landing__trust-inner">
        <p className="nx-landing__eyebrow">{t('landing.trust.eyebrow')}</p>
        <h2 id="nx-landing-trust-heading" className="nx-landing__trust-title">
          {t('landing.trust.title')}
        </h2>
        <p className="nx-landing__trust-lead">{t('landing.trust.lead')}</p>
        <div className="nx-landing__trust-grid">
          {LANDING_SECURITY_TRUST_CARD_KEYS.map((key) => (
            <article key={key} className="nx-landing__trust-card">
              <SecurityTrustIcon kind={key} />
              <h3 className="nx-landing__trust-card-title">{t(`landing.trust.cards.${key}.title`)}</h3>
              <p className="nx-landing__trust-card-desc">{t(`landing.trust.cards.${key}.description`)}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
