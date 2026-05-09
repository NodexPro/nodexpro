const nodeEnv = process.env.NODE_ENV ?? 'development';

export const config = {
  port: parseInt(process.env.PORT ?? '4000', 10),
  supabaseUrl: process.env.SUPABASE_URL!,
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY!,
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
  nodeEnv,
  internalCronSecret: process.env.INTERNAL_CRON_SECRET?.trim() || null,
  legalIdentityHashSalt: process.env.LEGAL_IDENTITY_HASH_SALT ?? 'dev-salt-change-in-production',
  platformOwner: {
    email: process.env.PLATFORM_OWNER_EMAIL?.trim().toLowerCase() ?? null,
    phone: process.env.PLATFORM_OWNER_PHONE?.trim() ?? null,
    passwordHash: process.env.PLATFORM_OWNER_PASSWORD_HASH?.trim() ?? null,
    accessKeyHash: process.env.PLATFORM_OWNER_ACCESS_KEY_HASH?.trim() ?? null,
  },
} as const;

if (!config.supabaseUrl || !config.supabaseServiceRoleKey) {
  throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
}
