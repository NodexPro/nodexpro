/**
 * CLI: Stage 6 DocFlow → Work Engine backfill (run from apps/api cwd).
 *
 * Env:
 *   ORG_ID (required) — organization uuid
 *   LIMIT (optional, default 100, max 5000)
 *   DRY_RUN (optional, default true) — set to "false" to call intake
 *   CONFIRM_BACKFILL (required when DRY_RUN=false) — must be "true"
 *   BACKFILL_ACTOR_USER_ID (required when DRY_RUN=false) — app users.id in that org (audit / intake org scope)
 *
 * Also requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (via apps/api config).
 */
import { config as loadDotenv } from 'dotenv';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
loadDotenv({ path: resolve(here, '../../.env') });
async function main() {
    const orgId = String(process.env.ORG_ID ?? '').trim();
    if (!orgId) {
        console.error('ORG_ID is required');
        process.exit(2);
    }
    const limitRaw = String(process.env.LIMIT ?? '100').trim();
    const limit = Math.min(5000, Math.max(1, Number(limitRaw) || 100));
    const dryRun = String(process.env.DRY_RUN ?? 'true').trim().toLowerCase() !== 'false';
    const confirm = String(process.env.CONFIRM_BACKFILL ?? '').trim().toLowerCase() === 'true';
    const actorUserId = String(process.env.BACKFILL_ACTOR_USER_ID ?? '').trim() || null;
    if (!dryRun && !confirm) {
        console.error('Refusing to execute: set CONFIRM_BACKFILL=true when DRY_RUN=false');
        process.exit(2);
    }
    if (!dryRun && !actorUserId) {
        console.error('Refusing to execute: BACKFILL_ACTOR_USER_ID is required when DRY_RUN=false');
        process.exit(2);
    }
    const { runDocflowWorkEngineBackfill } = await import('../domains/docflow/docflow-work-engine-backfill.service.js');
    console.log(JSON.stringify({
        org_id: orgId,
        limit,
        dry_run: dryRun,
        confirm_backfill: confirm,
    }, null, 2));
    const out = await runDocflowWorkEngineBackfill({ orgId, limit, dryRun, actorUserId });
    console.log(JSON.stringify({
        scanned: out.scanned,
        eligible: out.eligible,
        emitted: out.emitted,
        skipped: out.skipped,
        errors: out.errors,
    }, null, 2));
    if (process.env.BACKFILL_VERBOSE === '1' && out.details?.length) {
        console.log(JSON.stringify(out.details, null, 2));
    }
}
main().catch((e) => {
    console.error(e);
    process.exit(1);
});
