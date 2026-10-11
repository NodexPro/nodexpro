import { Router } from 'express';
import { getLandingModuleShowcase } from './landing-module-showcase.service.js';

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
