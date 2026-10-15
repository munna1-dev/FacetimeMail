BEGIN;

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
) >= 100 THEN
RAISE EXCEPTION 'Domain limit reached: maximum 100 domains.'
USING ERRCODE = 'check_violation';
END IF;

RETURN NEW;
END;
$$;

COMMIT;
