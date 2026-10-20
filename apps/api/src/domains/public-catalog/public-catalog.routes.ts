import { Router } from 'express';
import { getLandingModuleShowcase } from './landing-module-showcase.service.js';
import { loadPublishedTranslationCatalog } from '../platform-localization/platform-localization.service.js';

/** Unauthenticated, read-only public catalog aggregates. No commands are exposed here. */
export const publicCatalogRoutes = Router();

publicCatalogRoutes.get('/landing-module-showcase', async (_req, res, next) => {
  try {
    const aggregate = await getLandingModuleShowcase();
    res.setHeader('Cache-Control', 'public, max-age=60');
    res.json(aggregate);
  } catch (e) {
    next(e);
  }
});

publicCatalogRoutes.get('/i18n/:locale', async (req, res, next) => {
  try {
    const locale = String(req.params.locale ?? 'en');
    const messages = await loadPublishedTranslationCatalog(locale);
    res.setHeader('Cache-Control', 'public, max-age=30');
    res.json({
      aggregate_key: 'published_translation_catalog',
      locale,
      messages,
    });
  } catch (e) {
    next(e);
  }
});
