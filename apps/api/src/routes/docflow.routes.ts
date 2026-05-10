import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { requireOrg } from '../middleware/requireOrg.js';
import { requireModuleActive } from '../middleware/requireModuleActive.js';
import type { RequestContext } from '../shared/context.js';
import { badRequest, forbidden } from '../shared/errors.js';
import { executeDocflowOfficeCommand, executeDocflowPortalCommand } from '../domains/docflow/docflow-commands.service.js';
import {
  buildCommunicationRuleRunReviewAggregate,
  canRunDocflowCommunicationRules,
} from '../domains/docflow/docflow-communication-rule.service.js';
import { buildDocflowFloatingWidgetAggregate } from '../domains/docflow/docflow-floating-widget.service.js';
import {
  buildClientDocflowTabAggregate,
  buildClientPortalInboxAggregate,
  buildDocflowInvitesManagementAggregate,
  buildClientContextDocflowAggregate,
  buildClientThreadContextAggregate,
  buildOfficeDocflowInboxAggregate,
  buildOfficeDocflowMessengerAggregate,
} from '../domains/docflow/docflow-read-models.service.js';
import { resolvePortalSessionByRawToken } from '../domains/docflow/docflow-portal-auth.service.js';
import { getPortalDocflowAttachmentSignedUrl } from '../domains/docflow/docflow-portal-attachment-open.service.js';
import { uploadSharedClientFileAssetForOffice } from '../domains/file-access/shared-client-file-upload.service.js';
import { assertDocflowEntitled, assertDocflowMessageScope, assertDocflowThreadScope, reqString } from '../domains/docflow/docflow.guards.js';
import { config } from '../config.js';
import { runDocflowCommunicationDailyScheduler } from '../domains/docflow/docflow-communication-scheduler.service.js';

const router = Router();

function requireInternalCronSecret(req: Request): void {
  const secret = String(req.headers['x-internal-cron-secret'] ?? '').trim();
  if (!config.internalCronSecret || !secret || secret !== config.internalCronSecret) {
    throw forbidden('Invalid internal cron secret');
  }
}

/** Auth + org only: floating widget read model must load for trial-expired (locked) orgs without requireModuleActive. */
const officeBaseRouter = Router();
officeBaseRouter.use(authMiddleware, requireOrg);

officeBaseRouter.get('/aggregates/floating-widget', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ctx = req.context as RequestContext;
    const orgId = ctx.organizationId!;
    const canUse = canRunDocflowCommunicationRules(ctx);
    const aggregate = await buildDocflowFloatingWidgetAggregate(orgId, { can_use_communication_commands: canUse });
    return res.json(aggregate);
  } catch (e) {
    next(e);
  }
});

/** Internal cron trigger (Render Cron Job) — runs daily scheduled DocFlow communication rules. */
router.post('/internal/scheduler/run-daily', async (req: Request, res: Response, next: NextFunction) => {
  try {
    requireInternalCronSecret(req);
    const date = typeof req.body?.date === 'string' ? req.body.date.trim() : undefined;
    const dryRun = req.body?.dry_run === true;
    const out = await runDocflowCommunicationDailyScheduler({ date, dry_run: dryRun });
    return res.json({ ok: true, result: out });
  } catch (e) {
    console.error('[docflow] POST /internal/scheduler/run-daily failed', e);
    next(e);
  }
});

const officeRouter = Router();
officeRouter.use(authMiddleware, requireOrg, requireModuleActive('docflow'));

officeRouter.get('/aggregates/client-tab', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ctx = req.context as RequestContext;
    const orgId = ctx.organizationId!;
    const clientId = String(req.query.client_id ?? '').trim();
    const selectedThreadId = String(req.query.selected_thread_id ?? '').trim() || null;
    if (!clientId) throw badRequest('client_id is required');
    const aggregate = await buildClientDocflowTabAggregate({ orgId, clientId, selectedThreadId });
    return res.json(aggregate);
  } catch (e) {
    next(e);
  }
});

officeRouter.get('/aggregates/office-inbox', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ctx = req.context as RequestContext;
    const orgId = ctx.organizationId!;
    const aggregate = await buildOfficeDocflowInboxAggregate({
      orgId,
      page: Number(req.query.page ?? 1) || 1,
      pageSize: Number(req.query.page_size ?? 25) || 25,
      searchClient: String(req.query.search_client ?? '').trim() || null,
      selectedClientId: String(req.query.selected_client_id ?? '').trim() || null,
      selectedThreadId: String(req.query.selected_thread_id ?? '').trim() || null,
    });
    return res.json(aggregate);
  } catch (e) {
    next(e);
  }
});

officeRouter.get('/aggregates/office-messenger', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ctx = req.context as RequestContext;
    const orgId = ctx.organizationId!;
    const aggregate = await buildOfficeDocflowMessengerAggregate({
      orgId,
      page: Number(req.query.page ?? 1) || 1,
      pageSize: Number(req.query.page_size ?? 50) || 50,
      searchClient: String(req.query.search_client ?? '').trim() || null,
      clientId: String(req.query.client_id ?? '').trim() || null,
      threadId: String(req.query.thread_id ?? '').trim() || null,
    });
    return res.json(aggregate);
  } catch (e) {
    next(e);
  }
});

officeRouter.get('/aggregates/client-context', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ctx = req.context as RequestContext;
    const orgId = ctx.organizationId!;
    const clientId = String(req.query.client_id ?? '').trim();
    const selectedThreadId = String(req.query.selected_thread_id ?? '').trim() || null;
    if (!clientId) throw badRequest('client_id is required');
    const aggregate = await buildClientContextDocflowAggregate({ orgId, clientId, selectedThreadId });
    return res.json(aggregate);
  } catch (e) {
    next(e);
  }
});

officeRouter.get('/aggregates/client-thread-context', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ctx = req.context as RequestContext;
    const orgId = ctx.organizationId!;
    const clientId = String(req.query.client_id ?? '').trim();
    const threadId = String(req.query.thread_id ?? '').trim() || null;
    if (!clientId) throw badRequest('client_id is required');
    const aggregate = await buildClientThreadContextAggregate({ orgId, clientId, threadId });
    return res.json(aggregate);
  } catch (e) {
    next(e);
  }
});

officeRouter.get('/aggregates/communication-rule-run-review', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ctx = req.context as RequestContext;
    const orgId = ctx.organizationId!;
    const ruleRunId = String(req.query.rule_run_id ?? '').trim();
    if (!ruleRunId) throw badRequest('rule_run_id is required');
    const aggregate = await buildCommunicationRuleRunReviewAggregate(orgId, ruleRunId);
    return res.json(aggregate);
  } catch (e) {
    next(e);
  }
});

officeRouter.get('/aggregates/invites-management', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ctx = req.context as RequestContext;
    const orgId = ctx.organizationId!;
    const aggregate = await buildDocflowInvitesManagementAggregate({
      orgId,
      page: Number(req.query.page ?? 1) || 1,
      pageSize: Number(req.query.page_size ?? 25) || 25,
      searchClient: String(req.query.search_client ?? '').trim() || null,
      inviteStatus: String(req.query.invite_status ?? '').trim() || null,
    });
    return res.json(aggregate);
  } catch (e) {
    next(e);
  }
});

async function handleOfficeCommand(req: Request, res: Response, next: NextFunction, command: string): Promise<void> {
  try {
    const ctx = req.context as RequestContext;
    const out = await executeDocflowOfficeCommand(ctx, command as never, req.body?.payload ?? req.body ?? {});
    res.json(out);
    return;
  } catch (e) {
    next(e);
  }
}

officeRouter.post('/commands/invite-client', async (req, res, next) =>
  handleOfficeCommand(req, res, next, 'invite_client_to_docflow')
);
officeRouter.post('/commands/revoke-client-portal-access', async (req, res, next) =>
  handleOfficeCommand(req, res, next, 'revoke_client_portal_access')
);
officeRouter.post('/commands/invite-selected-clients', async (req, res, next) =>
  handleOfficeCommand(req, res, next, 'invite_selected_clients_to_docflow')
);
officeRouter.post('/commands/invite-all-clients', async (req, res, next) =>
  handleOfficeCommand(req, res, next, 'invite_all_clients_to_docflow')
);
officeRouter.post('/commands/resend-invite', async (req, res, next) =>
  handleOfficeCommand(req, res, next, 'resend_invite')
);
officeRouter.post('/commands/revoke-invite', async (req, res, next) =>
  handleOfficeCommand(req, res, next, 'revoke_invite')
);
officeRouter.post('/commands/issue-invite-delivery', async (req, res, next) =>
  handleOfficeCommand(req, res, next, 'issue_docflow_invite_delivery')
);
officeRouter.post('/commands/create-client-thread', async (req, res, next) =>
  handleOfficeCommand(req, res, next, 'create_client_thread')
);
officeRouter.post('/commands/change-thread-status', async (req, res, next) =>
  handleOfficeCommand(req, res, next, 'change_thread_status')
);
officeRouter.post('/commands/assign-thread-to-user', async (req, res, next) =>
  handleOfficeCommand(req, res, next, 'assign_thread_to_user')
);
officeRouter.post('/commands/set-thread-deadline', async (req, res, next) =>
  handleOfficeCommand(req, res, next, 'set_thread_deadline')
);
officeRouter.post('/commands/create-system-message', async (req, res, next) =>
  handleOfficeCommand(req, res, next, 'create_system_message')
);
officeRouter.post('/commands/send-office-message', async (req, res, next) =>
  handleOfficeCommand(req, res, next, 'send_office_message')
);
officeRouter.post('/commands/attach-file-to-client-message', async (req, res, next) =>
  handleOfficeCommand(req, res, next, 'attach_file_to_client_message')
);
officeRouter.post('/commands/mark-thread-read-by-office', async (req, res, next) =>
  handleOfficeCommand(req, res, next, 'mark_thread_read_by_office')
);
officeRouter.post('/commands/remove-message-attachment', async (req, res, next) =>
  handleOfficeCommand(req, res, next, 'remove_message_attachment')
);
officeRouter.post('/commands/start-office-thread-for-client', async (req, res, next) =>
  handleOfficeCommand(req, res, next, 'start_office_thread_for_client')
);

officeRouter.post('/files/upload', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ctx = req.context as RequestContext;
    const payload = (req.body?.payload ?? req.body ?? {}) as Record<string, unknown>;
    const orgId = ctx.organizationId!;
    const clientId = reqString(payload, 'client_id');
    const threadId = reqString(payload, 'thread_id');
    const messageId = reqString(payload, 'message_id');
    await assertDocflowThreadScope(orgId, clientId, threadId);
    await assertDocflowMessageScope(orgId, clientId, threadId, messageId);
    const out = await uploadSharedClientFileAssetForOffice(ctx, {
      orgId,
      clientId,
      payload: {
        file_base64: reqString(payload, 'file_base64'),
        file_name: reqString(payload, 'file_name'),
        mime_type: String(payload.mime_type ?? '').trim() || null,
        module_key: 'docflow',
        thread_id: threadId,
        message_id: messageId,
      },
    });
    return res.status(201).json(out);
  } catch (e) {
    next(e);
  }
});

// generic office command endpoint (command-only model)
officeRouter.post('/commands', async (req, res, next) => {
  try {
    const command = String(req.body?.command ?? '').trim();
    if (!command) throw badRequest('command is required');
    if (
      command === 'run_communication_rule' ||
      command === 'approve_draft_message' ||
      command === 'edit_draft_message' ||
      command === 'cancel_draft_message' ||
      command === 'send_approved_message'
    ) {
      const ctx = req.context as RequestContext;
      console.info('[docflow][trace] POST /api/v1/docflow/commands', {
        command,
        user_email: ctx?.user?.email ?? null,
        user_id: ctx?.user?.id ?? null,
        org_id: ctx?.organizationId ?? null,
        role: ctx?.membership?.roleCode ?? null,
        permissions: ctx?.membership?.permissions ?? [],
      });
    }
    return handleOfficeCommand(req, res, next, command);
  } catch (e) {
    next(e);
  }
});

const portalRouter = Router();

portalRouter.post('/commands/accept-invitation', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const out = await executeDocflowPortalCommand('accept_client_portal_invitation', req.body?.payload ?? req.body ?? {});
    return res.json(out);
  } catch (e) {
    next(e);
  }
});

portalRouter.get('/aggregates/client-portal-inbox', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const rawToken = String(req.headers['x-client-portal-session'] ?? req.query.portal_session_token ?? '').trim();
    if (!rawToken) throw badRequest('portal session token is required');
    const session = await resolvePortalSessionByRawToken(rawToken);
    await assertDocflowEntitled(session.orgId);
    const selectedThreadId = String(req.query.selected_thread_id ?? '').trim() || null;
    const aggregate = await buildClientPortalInboxAggregate({
      orgId: session.orgId,
      clientId: session.clientId,
      portalUserId: session.portalUserId,
      selectedThreadId,
    });
    return res.json(aggregate);
  } catch (e) {
    next(e);
  }
});

portalRouter.get('/files/:fileAssetId/open', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const rawToken = String(req.headers['x-client-portal-session'] ?? req.query.portal_session_token ?? '').trim();
    if (!rawToken) throw badRequest('portal session token is required');
    const session = await resolvePortalSessionByRawToken(rawToken);
    await assertDocflowEntitled(session.orgId);
    const fileAssetId = String(req.params.fileAssetId ?? '').trim();
    if (!fileAssetId) throw badRequest('fileAssetId is required');
    const { url } = await getPortalDocflowAttachmentSignedUrl({
      orgId: session.orgId,
      clientId: session.clientId,
      portalUserId: session.portalUserId,
      fileAssetId,
    });
    return res.json({ url });
  } catch (e) {
    next(e);
  }
});

async function handlePortalCommand(req: Request, res: Response, next: NextFunction, command: string): Promise<void> {
  try {
    const payload = (req.body?.payload ?? req.body ?? {}) as Record<string, unknown>;
    if (!payload.portal_session_token && req.headers['x-client-portal-session']) {
      payload.portal_session_token = String(req.headers['x-client-portal-session']);
    }
    const out = await executeDocflowPortalCommand(command as never, payload);
    res.json(out);
    return;
  } catch (e) {
    next(e);
  }
}

portalRouter.post('/commands/send-client-message', async (req, res, next) =>
  handlePortalCommand(req, res, next, 'send_client_message')
);
portalRouter.post('/commands/start-client-thread', async (req, res, next) =>
  handlePortalCommand(req, res, next, 'start_client_portal_thread')
);
portalRouter.post('/commands/attach-file-to-client-message', async (req, res, next) =>
  handlePortalCommand(req, res, next, 'attach_file_to_client_message')
);
portalRouter.post('/commands/mark-thread-read-by-client', async (req, res, next) =>
  handlePortalCommand(req, res, next, 'mark_thread_read_by_client')
);
portalRouter.post('/commands/remove-message-attachment', async (req, res, next) =>
  handlePortalCommand(req, res, next, 'remove_message_attachment')
);

portalRouter.post('/commands', async (req, res, next) => {
  try {
    const command = String(req.body?.command ?? '').trim();
    if (!command) throw badRequest('command is required');
    return handlePortalCommand(req, res, next, command);
  } catch (e) {
    next(e);
  }
});

// IMPORTANT: mount portal first. office routers have root-level auth middleware and must not
// intercept /portal/* client flows (invite/session are token-based, not office JWT-based).
router.use('/portal', portalRouter);
router.use('/', officeBaseRouter);
router.use('/', officeRouter);

export const docflowRoutes = router;

