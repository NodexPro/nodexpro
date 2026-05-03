-- Platform owner password recovery (SMS OTP). Backend-only writes via service_role.

CREATE TABLE IF NOT EXISTS public.platform_owner_password_recovery_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  otp_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  otp_verified_at timestamptz,
  attempt_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS platform_owner_pw_recovery_expires_idx
  ON public.platform_owner_password_recovery_challenges (expires_at);

COMMENT ON TABLE public.platform_owner_password_recovery_challenges IS
  'Single-use hashed OTP challenges for platform owner password recovery (SMS).';
