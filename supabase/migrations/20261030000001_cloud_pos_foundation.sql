-- ============================================================================
-- SELWICK POS — SUPABASE CLOUD FOUNDATION MIGRATION (Phase 4)
-- Version: 20261030000001
-- Tables: businesses, business_members, pos_records
-- Security: Row Level Security (RLS) & Multi-Tenant Isolation
-- Storage: Buckets & Tenant-Scoped Access Policies
-- ============================================================================

-- 1. Enable Required Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. Businesses Table
CREATE TABLE IF NOT EXISTS public.businesses (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    name TEXT NOT NULL,
    business_type TEXT NOT NULL DEFAULT 'retail',
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

ALTER TABLE public.businesses ENABLE ROW LEVEL SECURITY;

-- 3. Business Members (RBAC & Tenant Association)
CREATE TABLE IF NOT EXISTS public.business_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id TEXT NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('owner', 'manager', 'cashier')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    UNIQUE(business_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_business_members_lookup 
ON public.business_members(business_id, user_id, role);

CREATE INDEX IF NOT EXISTS idx_business_members_user 
ON public.business_members(user_id);

ALTER TABLE public.business_members ENABLE ROW LEVEL SECURITY;

-- 4. POS Document Store Table (pos_records)
CREATE TABLE IF NOT EXISTS public.pos_records (
    business_id TEXT NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    record_type TEXT NOT NULL CHECK (record_type IN ('product', 'customer', 'sale', 'setting', 'held_sale', 'category', 'refund', 'khata_settlement')),
    record_id TEXT NOT NULL,
    data JSONB NOT NULL,
    updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    PRIMARY KEY (business_id, record_type, record_id)
);

CREATE INDEX IF NOT EXISTS idx_pos_records_biz_type 
ON public.pos_records(business_id, record_type);

CREATE INDEX IF NOT EXISTS idx_pos_records_biz_updated 
ON public.pos_records(business_id, updated_at DESC);

ALTER TABLE public.pos_records ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- ROW LEVEL SECURITY (RLS) POLICIES — STRICT MULTI-TENANT ISOLATION
-- ============================================================================

-- Helper Security Function: Check if auth.uid() has valid membership in business_id
CREATE OR REPLACE FUNCTION public.check_user_business_membership(
    p_business_id TEXT,
    p_required_roles TEXT[] DEFAULT ARRAY['owner', 'manager', 'cashier']
)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, auth
STABLE
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.business_members bm
        WHERE bm.business_id = p_business_id
          AND bm.user_id = auth.uid()
          AND bm.role = ANY(p_required_roles)
    );
$$;

-- ----------------------------------------------------------------------------
-- Businesses Policies
-- ----------------------------------------------------------------------------
CREATE POLICY "Users can view businesses they belong to"
ON public.businesses
FOR SELECT
TO authenticated
USING (
    public.check_user_business_membership(id)
);

CREATE POLICY "Owners can update business details"
ON public.businesses
FOR UPDATE
TO authenticated
USING (
    public.check_user_business_membership(id, ARRAY['owner'])
);

-- ----------------------------------------------------------------------------
-- Business Members Policies
-- ----------------------------------------------------------------------------
CREATE POLICY "Members can view other members of their business"
ON public.business_members
FOR SELECT
TO authenticated
USING (
    public.check_user_business_membership(business_id)
);

CREATE POLICY "Owners and Managers can manage business memberships"
ON public.business_members
FOR ALL
TO authenticated
USING (
    public.check_user_business_membership(business_id, ARRAY['owner', 'manager'])
)
WITH CHECK (
    public.check_user_business_membership(business_id, ARRAY['owner', 'manager'])
);

-- ----------------------------------------------------------------------------
-- POS Records Policies (CRITICAL: Prevents client business_id manipulation)
-- ----------------------------------------------------------------------------
CREATE POLICY "Users can SELECT pos_records for their assigned business"
ON public.pos_records
FOR SELECT
TO authenticated
USING (
    public.check_user_business_membership(business_id)
);

CREATE POLICY "Users can INSERT pos_records for their assigned business"
ON public.pos_records
FOR INSERT
TO authenticated
WITH CHECK (
    public.check_user_business_membership(business_id)
    AND (
        -- Cashiers can only write sales, customers, and held_sales
        (public.check_user_business_membership(business_id, ARRAY['cashier'])
         AND record_type IN ('sale', 'customer', 'held_sale'))
        OR
        -- Owners and Managers can write all record types
        public.check_user_business_membership(business_id, ARRAY['owner', 'manager'])
    )
);

CREATE POLICY "Users can UPDATE pos_records for their assigned business"
ON public.pos_records
FOR UPDATE
TO authenticated
USING (
    public.check_user_business_membership(business_id)
)
WITH CHECK (
    public.check_user_business_membership(business_id)
    AND (
        (public.check_user_business_membership(business_id, ARRAY['cashier'])
         AND record_type IN ('customer', 'held_sale'))
        OR
        public.check_user_business_membership(business_id, ARRAY['owner', 'manager'])
    )
);

CREATE POLICY "Only Owners and Managers can DELETE pos_records"
ON public.pos_records
FOR DELETE
TO authenticated
USING (
    public.check_user_business_membership(business_id, ARRAY['owner', 'manager'])
    OR
    -- Cashiers may only delete their own held sales (unparking cart)
    (public.check_user_business_membership(business_id, ARRAY['cashier'])
     AND record_type = 'held_sale')
);

-- ============================================================================
-- STORAGE BUCKETS & STORAGE POLICIES
-- ============================================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES 
    ('pos-backups', 'pos-backups', false, 52428800, ARRAY['application/json']),
    ('selwick-local-backups', 'selwick-local-backups', false, 52428800, ARRAY['application/json'])
ON CONFLICT (id) DO UPDATE SET
    public = false,
    file_size_limit = 52428800;

-- Storage Policy: Users can only upload backups into their own business path: <business_id>/...
CREATE POLICY "Tenant isolated backup upload for pos-backups"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
    bucket_id = 'pos-backups'
    AND public.check_user_business_membership(
        (storage.foldername(name))[1],
        ARRAY['owner', 'manager']
    )
);

CREATE POLICY "Tenant isolated backup read for pos-backups"
ON storage.objects
FOR SELECT
TO authenticated
USING (
    bucket_id = 'pos-backups'
    AND public.check_user_business_membership(
        (storage.foldername(name))[1],
        ARRAY['owner', 'manager']
    )
);

CREATE POLICY "Tenant isolated backup delete for pos-backups"
ON storage.objects
FOR DELETE
TO authenticated
USING (
    bucket_id = 'pos-backups'
    AND public.check_user_business_membership(
        (storage.foldername(name))[1],
        ARRAY['owner']
    )
);

-- Storage Policy for selwick-local-backups (owner/user path: <user_id>/<business_id>/...)
CREATE POLICY "Owner isolated storage for selwick-local-backups"
ON storage.objects
FOR ALL
TO authenticated
USING (
    bucket_id = 'selwick-local-backups'
    AND (storage.foldername(name))[1] = auth.uid()::text
    AND public.check_user_business_membership((storage.foldername(name))[2], ARRAY['owner', 'manager'])
)
WITH CHECK (
    bucket_id = 'selwick-local-backups'
    AND (storage.foldername(name))[1] = auth.uid()::text
    AND public.check_user_business_membership((storage.foldername(name))[2], ARRAY['owner', 'manager'])
);

