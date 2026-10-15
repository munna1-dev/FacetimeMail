-- FacetimeMail domain manager.
-- This migration preserves existing domains and mailbox records.
-- A domain is not inbound-ready until it has been explicitly tested.

ALTER TABLE public.domains
  ADD COLUMN IF NOT EXISTS inbound_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS inbound_tested_at timestamptz;

-- Constrain inbound readiness states.
ALTER TABLE public.domains
  DROP CONSTRAINT IF EXISTS domains_inbound_status_check;

ALTER TABLE public.domains
  ADD CONSTRAINT domains_inbound_status_check
  CHECK (inbound_status IN ('pending', 'ready', 'failed'));

-- Existing domains remain unavailable for public selection until
-- inbound readiness has been explicitly established.
UPDATE public.domains
SET inbound_status = 'pending'
WHERE inbound_status IS NULL;

-- Limit the domain registry to 50 records. The transaction-level
-- advisory lock prevents concurrent inserts from exceeding the limit.
CREATE OR REPLACE FUNCTION public.enforce_facetimemail_domain_limit()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(741920261014);

  IF NOT EXISTS (
    SELECT 1
    FROM public.domains
    WHERE id = NEW.id
  ) AND (
    SELECT count(*)
    FROM public.domains
  ) >= 50 THEN
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
