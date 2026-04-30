import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { authRoutes } from './domains/auth/auth.routes.js';
import { organizationsRoutes } from './domains/organizations/organizations.routes.js';
import { membershipsRoutes } from './domains/memberships/memberships.routes.js';
import { rolesRoutes } from './domains/roles/roles.routes.js';
import { modulesRoutes } from './domains/modules/modules.routes.js';
import { exampleModuleRouter } from './domains/modules/example-module.routes.js';
import { registerExampleModuleHook } from './domains/modules/init-hooks.js';
import * as modulesService from './domains/modules/modules.service.js';
import { subscriptionsRoutes } from './domains/subscriptions/subscriptions.routes.js';
import { auditRoutes } from './domains/audit/audit.routes.js';
import { trialRoutes } from './domains/trial/trial.routes.js';
import { organizationSettingsRoutes } from './domains/organization-settings/organization-settings.routes.js';
import { clientsRoutes } from './domains/clients/clients.routes.js';
import { documentsRoutes } from './domains/documents/documents.routes.js';
import { dashboardRoutes } from './domains/dashboard/dashboard.routes.js';
import { config } from './config.js';
import { AppError } from './shared/errors.js';
import { ENCRYPTION_NOT_CONFIGURED_CODE, getClientDataEncryptionEnvDiagnostic, } from './shared/field-encryption.js';
import { writeAudit, AUDIT_ACTIONS } from './shared/audit-events.js';
import { clientOperationsModuleRouter } from './domains/client-operations/client-operations.routes.js';
import { ownerCountryPackRoutes } from './routes/owner-country-pack.routes.js';
import { docflowRoutes } from './routes/docflow.routes.js';
registerExampleModuleHook();
async function logModuleLoaded() {
    try {
        const modules = await modulesService.listModules();
        await writeAudit({
            organizationId: null,
            actorUserId: null,
            entityType: 'module',
            action: AUDIT_ACTIONS.MODULE_LOADED,
            payload: { moduleCount: modules.length },
        });
    }
    catch (e) {
        console.error('[module-loader] Failed to log MODULE_LOADED:', e);
    }
}
const app = express();
app.use(helmet());
const corsAllowedOriginsRaw = process.env.CORS_ALLOWED_ORIGINS ?? '';
const corsAllowedOrigins = corsAllowedOriginsRaw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
const corsAllowCredentials = String(process.env.CORS_ALLOW_CREDENTIALS ?? '')
    .trim()
    .toLowerCase() === 'true';
const localDevOriginAllowlist = [
    'http://localhost:3000',
    'http://localhost:3001',
    'http://localhost:5173',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:5173',
];
const isLocalDevOrigin = (origin) => localDevOriginAllowlist.includes(origin) || origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:');
const isAllowedOrigin = (origin) => (corsAllowedOrigins.length ? corsAllowedOrigins.includes(origin) : isLocalDevOrigin(origin));
const corsOptions = {
    credentials: corsAllowCredentials,
    origin: (origin, cb) => {
        // Non-browser requests have no Origin header.
        if (!origin)
            return cb(null, true);
        if (isAllowedOrigin(origin))
            return cb(null, true);
        return cb(null, false);
    },
};
app.use(cors(corsOptions));
app.options('*', cors(corsOptions));
app.use(express.json({ limit: '15mb' }));
app.get('/api/v1/health', (_req, res) => {
    res.status(200).json({ ok: true });
});
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/organizations', organizationsRoutes);
app.use('/api/v1/organizations', membershipsRoutes);
app.use('/api/v1/organizations', rolesRoutes);
app.use('/api/v1/organizations', subscriptionsRoutes);
app.use('/api/v1/organizations', auditRoutes);
app.use('/api/v1/organizations', trialRoutes);
app.use('/api/v1/organizations', organizationSettingsRoutes);
app.use('/api/v1/organizations', clientsRoutes);
app.use('/api/v1/organizations', documentsRoutes);
app.use('/api/v1/dashboard', dashboardRoutes);
app.use('/api/v1/modules', modulesRoutes);
app.use('/api/v1/m/example', exampleModuleRouter);
app.use('/api/v1/m/client-operations', clientOperationsModuleRouter);
app.use('/api/v1/owner', ownerCountryPackRoutes);
app.use('/api/v1/docflow', docflowRoutes);
app.use((err, _req, res, _next) => {
    if (err instanceof AppError) {
        if (err.code === ENCRYPTION_NOT_CONFIGURED_CODE) {
            console.error('[api] CLIENT_DATA_ENCRYPTION_KEY missing or invalid — set 32-byte key as base64 in apps/api/.env');
        }
        return res.status(err.statusCode).json({
            code: err.code ?? 'ERROR',
            message: err.message,
            ...(err.details ?? {}),
        });
    }
    console.error(err);
    // In development, surface Error.message so local debugging is not blind to non-AppError throws.
    const exposeDetails = config.nodeEnv !== 'production';
    const message = exposeDetails && err instanceof Error && err.message ? err.message : 'Internal server error';
    return res.status(500).json({ code: 'INTERNAL_ERROR', message });
});
app.listen(config.port, () => {
    console.log(`API listening on port ${config.port}`);
    const enc = getClientDataEncryptionEnvDiagnostic();
    const len = enc.decoded_length_bytes === null ? 'n/a' : String(enc.decoded_length_bytes);
    console.log(`[api] CLIENT_DATA_ENCRYPTION_KEY: env_set=${enc.env_set ? 'yes' : 'no'}, decoded_bytes=${len}, aes256_ok=${enc.valid_for_aes256 ? 'yes' : 'no'}`);
    logModuleLoaded();
});
