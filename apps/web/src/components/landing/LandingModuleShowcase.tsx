import { useEffect, useState } from 'react';
import {
  fetchLandingModuleShowcase,
  type LandingModuleShowcaseAggregate,
  type LandingShowcaseModule,
} from '../../api/public-catalog';
import { useI18n } from '../../i18n/I18nProvider';
import {
  formatLandingPriceDisplay,
  formatLandingTrialLabel,
  localizeLineList,
  localizeOrFallback,
} from '../../lib/public-ui-lang.pure';

/**
 * Render-only module strip for the public landing. Names, prices, trial and availability all come
 * from the backend `landing_module_showcase` aggregate. No activation command exists here.
 */
export function LandingModuleShowcase() {
  const { t } = useI18n();
  const [aggregate, setAggregate] = useState<LandingModuleShowcaseAggregate | null>(null);
  const [failed, setFailed] = useState(false);
  const [openCode, setOpenCode] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchLandingModuleShowcase()
      .then((a) => {
        if (!cancelled) setAggregate(a);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (failed) {
    return (
      <section className="nx-landing__showcase" aria-label={t('landing.showcaseAria')}>
        <div className="nx-landing__showcase-inner">
          <p className="nx-landing__showcase-status-msg" role="status">
            {t('landing.loadFailed')}
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="nx-landing__showcase" aria-label={t('landing.showcaseAria')}>
      <div className="nx-landing__showcase-inner">
        <div className="nx-landing__showcase-grid">
          {aggregate
            ? aggregate.modules.map((mod) => (
                <ShowcaseCard
                  key={mod.module_code}
                  mod={mod}
                  trialMonths={aggregate.trial.months}
                  open={openCode === mod.module_code}
                  onToggle={() => setOpenCode((cur) => (cur === mod.module_code ? null : mod.module_code))}
                />
              ))
            : [0, 1, 2].map((i) => (
                <div key={i} className="nx-landing__showcase-card nx-landing__showcase-card--skeleton" aria-hidden />
              ))}
        </div>
      </div>
    </section>
  );
}

function ShowcaseCard({
  mod,
  trialMonths,
  open,
  onToggle,
}: {
  mod: LandingShowcaseModule;
  trialMonths: number;
  open: boolean;
  onToggle: () => void;
}) {
  const { t, lang } = useI18n();
  const available = mod.availability === 'available';
  const panelId = `nx-showcase-${mod.module_code}`;
  const catalogKey = `landing.catalog.${mod.module_code}`;
  const name = localizeOrFallback(t, `${catalogKey}.name`, mod.name);
  const tagline = localizeOrFallback(t, `${catalogKey}.tagline`, mod.tagline);
  const summary = localizeOrFallback(t, `${catalogKey}.summary`, mod.details.summary);
  const existing = localizeLineList(t, `${catalogKey}.existing`, mod.details.existing);
  const planned = localizeLineList(t, `${catalogKey}.planned`, mod.details.planned);
  const periodLabel = localizeOrFallback(
    t,
    `landing.period.${mod.price?.billing_period ?? 'month'}`,
    mod.price?.billing_period ?? '',
  );
  const priceDisplay = mod.price
    ? formatLandingPriceDisplay({
        amount: mod.price.amount,
        currency: mod.price.currency,
        billingPeriod: mod.price.billing_period,
        locale: lang,
        periodLabel,
      })
    : null;
  const trialText =
    available && mod.trial_label && trialMonths > 0 ? formatLandingTrialLabel(trialMonths, t) : null;

  return (
    <article
      className={`nx-landing__showcase-card${available ? ' is-featured' : ' is-soon'}${open ? ' is-open' : ''}`}
      data-module-code={mod.module_code}
    >
      <div className="nx-landing__showcase-top">
        <h3 className="nx-landing__showcase-name">{name}</h3>
        <span className={`nx-landing__showcase-status${available ? ' is-available' : ' is-soon'}`}>
          {available ? t('landing.availableNow') : t('landing.comingSoon')}
        </span>
      </div>
      <p className="nx-landing__showcase-tagline">{tagline}</p>
      <div className="nx-landing__showcase-price">
        {priceDisplay ? (
          <span className="nx-landing__showcase-price-value">{priceDisplay}</span>
        ) : (
          <span className="nx-landing__showcase-price-muted">{t('landing.priceUnavailable')}</span>
        )}
        {trialText ? <span className="nx-landing__showcase-trial">{trialText}</span> : null}
      </div>
      <button
        type="button"
        className="nx-landing__btn nx-landing__btn--ghost nx-landing__showcase-details-btn"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={onToggle}
      >
        {open ? t('landing.hideDetails') : t('landing.details')}
        <span className="nx-landing__showcase-chevron" aria-hidden />
      </button>
      {open ? (
        <div id={panelId} className="nx-landing__showcase-panel">
          <p className="nx-landing__showcase-summary">{summary}</p>
          <h4 className="nx-landing__showcase-list-title">
            {available ? t('landing.whatYouGet') : t('landing.alreadyBuilt')}
          </h4>
          <ul className="nx-landing__showcase-list">
            {existing.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          {planned.length > 0 ? (
            <>
              <h4 className="nx-landing__showcase-list-title">{t('landing.comingNext')}</h4>
              <ul className="nx-landing__showcase-list nx-landing__showcase-list--planned">
                {planned.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
