/**
 * Work Engine HTTP routes.
 *
 * Mounted at /api/v1/work-engine.
 *
 * Endpoints (single command surface — no per-command routes):
 *   - GET  /aggregates/foundation   -> work_engine_foundation_aggregate
 *   - POST /commands                -> generic command endpoint; body shape:
 *                                      { command: <WorkEngineCommandType>,
 *                                        payload: <command-specific payload> }
 *                                      Stage 3A event intake uses this endpoint with
 *                                      `command: "intake_work_event"`.
 *   - POST /events/intake           -> Stage 2 raw envelope intake (audit-only;
 *                                      no work_item creation). Emitters should prefer
 *                                      POST /commands with command="intake_work_event".
 *
 * Routes only validate body shape and dispatch. NO workflow decisions live here.
 * No PATCH/PUT. Aggregate GET returns full ready-to-render truth. Every command
 * returns a refreshed aggregate.
 */

import { Router, type NextFunction, type Request, type Response } from 'express';
import { authMiddleware } from '../../middleware/auth.js';
import { requireOrg } from '../../middleware/requireOrg.js';
import type { RequestContext } from '../../shared/context.js';
import { badRequest } from '../../shared/errors.js';
import { executeWorkEngineCommand } from './work-engine.commands.service.js';
import { acceptWorkEngineEvent } from './work-engine.event-intake.service.js';
import { buildWorkEngineFoundationAggregate } from './work-engine.read-models.service.js';
import type {
  WorkEngineCommandType,
  WorkEventEnvelope,
} from './work-engine.types.js';

const router = Router();
router.use(authMiddleware, requireOrg);

router.get(
  '/aggregates/foundation',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ctx = req.context as RequestContext;
      const orgId = ctx.organizationId!;
      const aggregate = await buildWorkEngineFoundationAggregate({ orgId });
      return res.json(aggregate);
    } catch (e) {
      next(e);
    }
  },
);

const ALLOWED_COMMANDS: ReadonlySet<WorkEngineCommandType> = new Set<WorkEngineCommandType>([
  'create_work_item',
  'assign_work_item',
  'change_work_state',
  'set_work_deadline',
  'append_work_event',
  'apply_work_override',
  'intake_work_event',
]);

router.post(
  '/commands',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ctx = req.context as RequestContext;
      const command = String(req.body?.command ?? '').trim() as WorkEngineCommandType;
      if (!command) throw badRequest('command is required');
      if (!ALLOWED_COMMANDS.has(command)) {
        throw badRequest(`Unknown work engine command: ${command}`);
      }
      const payload = req.body?.payload ?? req.body ?? {};
      const out = await executeWorkEngineCommand(ctx, command, payload);
      return res.json(out);
    } catch (e) {
      next(e);
    }
  },
);

router.post(
  '/events/intake',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ctx = req.context as RequestContext;
      const env = (req.body ?? {}) as WorkEventEnvelope;
      if (!env || typeof env !== 'object') {
        throw badRequest('event envelope is required');
      }
      // Authenticated org context must match the envelope's org_id.
      if (env.org_id !== ctx.organizationId) {
        throw badRequest(
          'event.org_id must match the authenticated organization',
          'event_org_mismatch',
        );
      }
      const out = await acceptWorkEngineEvent(env);
      return res.json(out);
    } catch (e) {
      next(e);
    }
  },
);

export const workEngineRoutes = router;
