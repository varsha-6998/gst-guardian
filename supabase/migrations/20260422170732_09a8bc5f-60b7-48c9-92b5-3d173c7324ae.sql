
-- =========================================================
-- ENUMS
-- =========================================================
CREATE TYPE public.app_role AS ENUM ('admin', 'user');
CREATE TYPE public.fraud_risk AS ENUM ('low', 'medium', 'high');
CREATE TYPE public.invoice_status AS ENUM ('processing', 'valid', 'warning', 'error');

-- =========================================================
-- UPDATED_AT helper
-- =========================================================
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- =========================================================
-- PROFILES
-- =========================================================
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT,
  company_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own profile"
  ON public.profiles FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own profile"
  ON public.profiles FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER update_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =========================================================
-- USER ROLES (separate table — security best practice)
-- =========================================================
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- Security definer function to check role without triggering RLS recursion
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

CREATE POLICY "Users can view own roles"
  ON public.user_roles FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Admins can view all roles"
  ON public.user_roles FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can manage roles"
  ON public.user_roles FOR ALL
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- =========================================================
-- HANDLE NEW USER trigger: auto profile + default 'user' role
-- =========================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (user_id, display_name, company_name)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data ->> 'display_name', split_part(NEW.email, '@', 1)),
    NEW.raw_user_meta_data ->> 'company_name'
  );

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'user');

  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- =========================================================
-- INVOICES
-- =========================================================
CREATE TABLE public.invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  file_path TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  file_hash TEXT,                -- for duplicate detection
  mime_type TEXT NOT NULL,

  -- Extracted fields
  gstin TEXT,
  invoice_number TEXT,
  invoice_date DATE,
  seller_name TEXT,
  buyer_name TEXT,
  taxable_amount NUMERIC(14, 2),
  cgst NUMERIC(14, 2),
  sgst NUMERIC(14, 2),
  igst NUMERIC(14, 2),
  total_amount NUMERIC(14, 2),
  raw_ocr_text TEXT,

  -- Validation results
  status public.invoice_status NOT NULL DEFAULT 'processing',
  compliance_score INTEGER CHECK (compliance_score BETWEEN 0 AND 100),
  fraud_risk public.fraud_risk,
  fraud_score INTEGER CHECK (fraud_score BETWEEN 0 AND 100),

  -- GSTIN verification
  gstin_verified BOOLEAN DEFAULT false,
  gstin_legal_name TEXT,
  gstin_trade_name TEXT,
  gstin_status TEXT,
  gstin_source TEXT,             -- 'api' | 'cache' | 'fallback'

  -- Issues / suggestions / fraud reasons
  issues JSONB DEFAULT '[]'::jsonb,
  suggestions JSONB DEFAULT '[]'::jsonb,
  fraud_reasons JSONB DEFAULT '[]'::jsonb,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_invoices_user_id ON public.invoices(user_id);
CREATE INDEX idx_invoices_gstin ON public.invoices(gstin);
CREATE INDEX idx_invoices_file_hash ON public.invoices(file_hash);
CREATE INDEX idx_invoices_created_at ON public.invoices(created_at DESC);

ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own invoices"
  ON public.invoices FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Admins can view all invoices"
  ON public.invoices FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Users can insert own invoices"
  ON public.invoices FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own invoices"
  ON public.invoices FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own invoices"
  ON public.invoices FOR DELETE
  USING (auth.uid() = user_id);

CREATE TRIGGER update_invoices_updated_at
  BEFORE UPDATE ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =========================================================
-- GSTIN CACHE (verified API results)
-- =========================================================
CREATE TABLE public.gstin_cache (
  gstin TEXT PRIMARY KEY,
  legal_name TEXT,
  trade_name TEXT,
  status TEXT,
  raw_response JSONB,
  cached_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '30 days')
);

ALTER TABLE public.gstin_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read cache"
  ON public.gstin_cache FOR SELECT
  TO authenticated
  USING (true);
-- Writes happen only via edge functions using the service role (bypasses RLS).

-- =========================================================
-- GSTIN FALLBACK (offline JSON-style DB stored as table)
-- =========================================================
CREATE TABLE public.gstin_fallback (
  gstin TEXT PRIMARY KEY,
  legal_name TEXT NOT NULL,
  trade_name TEXT,
  status TEXT NOT NULL DEFAULT 'Active',
  state TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.gstin_fallback ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read fallback"
  ON public.gstin_fallback FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Admins can manage fallback"
  ON public.gstin_fallback FOR ALL
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Seed a few sample fallback entries (real public GSTINs of well-known orgs)
INSERT INTO public.gstin_fallback (gstin, legal_name, trade_name, status, state) VALUES
  ('29AAACR5055K1Z2', 'Reliance Retail Limited', 'Reliance Retail', 'Active', 'Karnataka'),
  ('27AAACI1681G1Z0', 'Infosys Limited', 'Infosys', 'Active', 'Maharashtra'),
  ('29AAACW3775F1ZZ', 'Wipro Limited', 'Wipro', 'Active', 'Karnataka'),
  ('07AAACH7409R1Z9', 'HCL Technologies Limited', 'HCL', 'Active', 'Delhi'),
  ('27AAACT2727Q1ZW', 'Tata Consultancy Services Limited', 'TCS', 'Active', 'Maharashtra')
ON CONFLICT (gstin) DO NOTHING;

-- =========================================================
-- API USAGE LOGS
-- =========================================================
CREATE TABLE public.api_usage_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  api_name TEXT NOT NULL,        -- 'gstincheck' | 'lovable_ai_ocr' | etc.
  endpoint TEXT,
  status_code INTEGER,
  success BOOLEAN NOT NULL DEFAULT true,
  error_message TEXT,
  latency_ms INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_api_logs_created_at ON public.api_usage_logs(created_at DESC);
CREATE INDEX idx_api_logs_api_name ON public.api_usage_logs(api_name);

ALTER TABLE public.api_usage_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view all logs"
  ON public.api_usage_logs FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Users can view own logs"
  ON public.api_usage_logs FOR SELECT
  USING (auth.uid() = user_id);
-- Writes happen via edge functions (service role).

-- =========================================================
-- APP SETTINGS (admin-controlled toggles)
-- =========================================================
CREATE TABLE public.app_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES auth.users(id)
);

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read settings"
  ON public.app_settings FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Admins can manage settings"
  ON public.app_settings FOR ALL
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Default: external GSTIN API enabled
INSERT INTO public.app_settings (key, value) VALUES
  ('gstin_api_enabled', 'true'::jsonb),
  ('gstin_api_max_calls_per_day', '500'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- =========================================================
-- STORAGE: private invoices bucket
-- =========================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('invoices', 'invoices', false)
ON CONFLICT (id) DO NOTHING;

-- Files stored under {user_id}/...
CREATE POLICY "Users can view own invoice files"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'invoices'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "Admins can view all invoice files"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'invoices'
    AND public.has_role(auth.uid(), 'admin')
  );

CREATE POLICY "Users can upload own invoice files"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'invoices'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "Users can delete own invoice files"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'invoices'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );
