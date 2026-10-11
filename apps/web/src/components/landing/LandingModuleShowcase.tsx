import { useEffect, useState } from 'react';
import {
  fetchLandingModuleShowcase,
  type LandingModuleShowcaseAggregate,
  type LandingShowcaseModule,
} from '../../api/public-catalog';

/**
 * Render-only module strip for the public landing. Names, prices, trial and availability all come
 * from the backend `landing_module_showcase` aggregate. No activation command exists here.
 */
export function LandingModuleShowcase() {
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

  if (failed) return null;

  return (
    <section className="nx-landing__showcase" aria-label="NodexPro modules">
      <div className="nx-landing__showcase-inner">
        <div className="nx-landing__showcase-grid">
          {aggregate
            ? aggregate.modules.map((mod) => (
                <ShowcaseCard
                  key={mod.module_code}
                  mod={mod}
                  labels={aggregate.labels}
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
  labels,
  open,
  onToggle,
}: {
  mod: LandingShowcaseModule;
  labels: LandingModuleShowcaseAggregate['labels'];
  open: boolean;
  onToggle: () => void;
}) {
  const available = mod.availability === 'available';
  const panelId = `nx-showcase-${mod.module_code}`;
  return (
    <article
      className={`nx-landing__showcase-card${available ? ' is-featured' : ' is-soon'}${open ? ' is-open' : ''}`}
      data-module-code={mod.module_code}
    >
      <div className="nx-landing__showcase-top">
        <h3 className="nx-landing__showcase-name">{mod.name}</h3>
        <span className={`nx-landing__showcase-status${available ? ' is-available' : ' is-soon'}`}>
          {mod.availability_label}
        </span>
      </div>
      <p className="nx-landing__showcase-tagline">{mod.tagline}</p>
      <div className="nx-landing__showcase-price">
        {mod.price ? (
          <span className="nx-landing__showcase-price-value">{mod.price.display}</span>
        ) : (
          <span className="nx-landing__showcase-price-muted">{labels.price_unavailable}</span>
        )}
        {mod.trial_label ? <span className="nx-landing__showcase-trial">{mod.trial_label}</span> : null}
      </div>
      <button
        type="button"
        className="nx-landing__showcase-details-btn"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={onToggle}
      >
        {open ? labels.hide_details : labels.details}
        <span className="nx-landing__showcase-chevron" aria-hidden />
      </button>
      {open ? (
        <div id={panelId} className="nx-landing__showcase-panel">
          <p className="nx-landing__showcase-summary">{mod.details.summary}</p>
          <h4 className="nx-landing__showcase-list-title">{mod.details.existing_heading}</h4>
          <ul className="nx-landing__showcase-list">
            {mod.details.existing.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          {mod.details.planned.length > 0 ? (
            <>
              <h4 className="nx-landing__showcase-list-title">{mod.details.planned_heading}</h4>
              <ul className="nx-landing__showcase-list nx-landing__showcase-list--planned">
                {mod.details.planned.map((line) => (
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
