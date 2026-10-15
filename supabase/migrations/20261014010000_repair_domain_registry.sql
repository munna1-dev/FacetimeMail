BEGIN;

CREATE TABLE IF NOT EXISTS public.domains (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  domain_name text UNIQUE NOT NULL,
  is_active boolean NOT NULL DEFAULT false,
  verification_status text NOT NULL DEFAULT 'pending',
  provider_reference text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  administrative_notes text,
  inbound_status text NOT NULL DEFAULT 'pending',
  inbound_tested_at timestamptz,
  CONSTRAINT domains_verification_status_check
    CHECK (verification_status IN ('pending', 'verified', 'failed')),
  CONSTRAINT domains_inbound_status_check
    CHECK (inbound_status IN ('pending', 'ready', 'failed'))
);

ALTER TABLE public.domains
  ADD COLUMN IF NOT EXISTS inbound_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS inbound_tested_at timestamptz;

ALTER TABLE public.domains
  DROP CONSTRAINT IF EXISTS domains_inbound_status_check;

ALTER TABLE public.domains
  ADD CONSTRAINT domains_inbound_status_check
  CHECK (inbound_status IN ('pending', 'ready', 'failed'));

CREATE OR REPLACE FUNCTION public.enforce_facetimemail_domain_limit()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(741920261014);

  IF NOT EXISTS (
    SELECT 1 FROM public.domains WHERE id = NEW.id
  ) AND (SELECT count(*) FROM public.domains) >= 50 THEN
    RAISE EXCEPTION 'Domain limit reached: maximum 50 domains.'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS facetimemail_domain_limit_trigger
  ON public.domains;

CREATE TRIGGER facetimemail_domain_limit_trigger
BEFORE INSERT ON public.domains
FOR EACH ROW
EXECUTE FUNCTION public.enforce_facetimemail_domain_limit();

CREATE INDEX IF NOT EXISTS domains_availability_idx
ON public.domains (is_active, verification_status, inbound_status);

COMMIT;
