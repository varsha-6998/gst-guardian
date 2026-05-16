
-- Vendor risk enum
DO $$ BEGIN
  CREATE TYPE public.vendor_risk AS ENUM ('low','medium','high');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Vendors table (per-user, keyed by gstin)
CREATE TABLE IF NOT EXISTS public.vendors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  gstin text NOT NULL,
  legal_name text,
  trade_name text,
  last_seller_name text,
  risk_level public.vendor_risk NOT NULL DEFAULT 'low',
  total_invoices integer NOT NULL DEFAULT 0,
  flagged_count integer NOT NULL DEFAULT 0,
  total_amount numeric NOT NULL DEFAULT 0,
  last_seen_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, gstin)
);

ALTER TABLE public.vendors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own vendors" ON public.vendors
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own vendors" ON public.vendors
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own vendors" ON public.vendors
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Admins view all vendors" ON public.vendors
  FOR SELECT USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_vendors_updated_at
  BEFORE UPDATE ON public.vendors
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX IF NOT EXISTS idx_vendors_user_risk ON public.vendors(user_id, risk_level);

-- Recompute and upsert vendor row from invoices for a (user, gstin)
CREATE OR REPLACE FUNCTION public.recompute_vendor(_user uuid, _gstin text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total int;
  v_flagged int;
  v_amount numeric;
  v_last timestamptz;
  v_seller text;
  v_legal text;
  v_trade text;
  v_ratio numeric;
  v_risk public.vendor_risk;
BEGIN
  IF _gstin IS NULL OR _gstin = '' THEN RETURN; END IF;

  SELECT
    count(*),
    count(*) FILTER (WHERE status = 'error' OR fraud_risk = 'high'),
    coalesce(sum(total_amount),0),
    max(created_at)
  INTO v_total, v_flagged, v_amount, v_last
  FROM public.invoices
  WHERE user_id = _user AND gstin = _gstin;

  SELECT seller_name, gstin_legal_name, gstin_trade_name
    INTO v_seller, v_legal, v_trade
  FROM public.invoices
  WHERE user_id = _user AND gstin = _gstin
  ORDER BY created_at DESC NULLS LAST
  LIMIT 1;

  v_ratio := CASE WHEN v_total = 0 THEN 0 ELSE v_flagged::numeric / v_total END;
  v_risk := CASE
    WHEN v_ratio > 0.3 THEN 'high'::public.vendor_risk
    WHEN v_ratio > 0.1 THEN 'medium'::public.vendor_risk
    ELSE 'low'::public.vendor_risk
  END;

  INSERT INTO public.vendors (user_id, gstin, legal_name, trade_name, last_seller_name,
    risk_level, total_invoices, flagged_count, total_amount, last_seen_at)
  VALUES (_user, _gstin, v_legal, v_trade, v_seller, v_risk, v_total, v_flagged, v_amount, v_last)
  ON CONFLICT (user_id, gstin) DO UPDATE SET
    legal_name = EXCLUDED.legal_name,
    trade_name = EXCLUDED.trade_name,
    last_seller_name = EXCLUDED.last_seller_name,
    risk_level = EXCLUDED.risk_level,
    total_invoices = EXCLUDED.total_invoices,
    flagged_count = EXCLUDED.flagged_count,
    total_amount = EXCLUDED.total_amount,
    last_seen_at = EXCLUDED.last_seen_at,
    updated_at = now();
END;
$$;

-- Trigger to keep vendors in sync with invoices
CREATE OR REPLACE FUNCTION public.sync_vendor_from_invoice()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.gstin IS NOT NULL THEN
      PERFORM public.recompute_vendor(OLD.user_id, OLD.gstin);
    END IF;
    RETURN OLD;
  END IF;

  IF NEW.gstin IS NOT NULL THEN
    PERFORM public.recompute_vendor(NEW.user_id, NEW.gstin);
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.gstin IS DISTINCT FROM NEW.gstin AND OLD.gstin IS NOT NULL THEN
    PERFORM public.recompute_vendor(OLD.user_id, OLD.gstin);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_invoices_sync_vendor ON public.invoices;
CREATE TRIGGER trg_invoices_sync_vendor
AFTER INSERT OR UPDATE OR DELETE ON public.invoices
FOR EACH ROW EXECUTE FUNCTION public.sync_vendor_from_invoice();

-- Backfill existing invoices into vendors
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT DISTINCT user_id, gstin FROM public.invoices WHERE gstin IS NOT NULL LOOP
    PERFORM public.recompute_vendor(r.user_id, r.gstin);
  END LOOP;
END $$;
