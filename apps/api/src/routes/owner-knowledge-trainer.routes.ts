import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import type { RequestContext } from '../shared/context.js';
import { badRequest, forbidden } from '../shared/errors.js';
import { AUDIT_ACTIONS, writeAudit } from '../shared/audit-events.js';
import { loadOwnerLegalActor } from '../domains/owner-country-legal-access/owner-country-legal-access.service.js';
import {
  executeKnowledgeTrainerCommand,
  isKnowledgeTrainerCommand,
  openLegalTrainingDocumentFile,
} from '../domains/knowledge-trainer/knowledge-trainer-commands.service.js';

export const ownerKnowledgeTrainerRoutes = Router();

async function assertOwnerLegalWorkspaceOrAuditFailure(ctx: RequestContext, req: Request): Promise<void> {
  const actor = await loadOwnerLegalActor(ctx);
  if (actor) return;
  await writeAudit({
    organizationId: null,
    actorUserId: ctx.user.id,
    entityType: 'owner_country_pack_api',
    action: AUDIT_ACTIONS.OWNER_SECURITY_CHECK_FAILED,
    payload: {
      method: req.method,
      path: req.path,
      reason: 'owner_legal_workspace_required',
    },
    ipAddress: req.ip ?? null,
    userAgent: req.headers['user-agent'] ?? null,
  });
  throw forbidden('Owner legal workspace access required', 'OWNER_LEGAL_ACCESS_REQUIRED');
}

ownerKnowledgeTrainerRoutes.post(
  '/legal-training/upload',
  authMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ctx = req.context as RequestContext;
      await assertOwnerLegalWorkspaceOrAuditFailure(ctx, req);
      const payload = req.body?.payload ?? req.body;
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        throw badRequest('payload must be an object');
      }
      const out = await executeKnowledgeTrainerCommand(
        ctx,
        'upload_legal_training_document',
        payload as Record<string, unknown>,
      );
      return res.json(out);
    } catch (e) {
      next(e);
    }
  },
);

ownerKnowledgeTrainerRoutes.get(
  '/legal-training/documents/:id/file',
  authMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ctx = req.context as RequestContext;
      await assertOwnerLegalWorkspaceOrAuditFailure(ctx, req);
      const out = await openLegalTrainingDocumentFile(ctx, String(req.params.id ?? ''));
      return res.json(out);
    } catch (e) {
      next(e);
    }
  },
);

ownerKnowledgeTrainerRoutes.post('/command', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const commandName = typeof req.body?.command === 'string' ? req.body.command.trim() : '';
    if (!isKnowledgeTrainerCommand(commandName)) {
      return next();
    }
    const ctx = req.context as RequestContext;
    await assertOwnerLegalWorkspaceOrAuditFailure(ctx, req);
    const payload = req.body?.payload;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw badRequest('payload must be an object');
    }
    const out = await executeKnowledgeTrainerCommand(ctx, commandName, payload as Record<string, unknown>);
    return res.json(out);
  } catch (e) {
    next(e);
  }
});
