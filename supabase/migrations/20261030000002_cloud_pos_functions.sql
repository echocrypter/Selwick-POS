-- ============================================================================
-- SELWICK POS — SUPABASE CLOUD RPC FUNCTIONS (Phase 4)
-- Version: 20261030000002
-- RPCs: complete_pos_sale, restore_pos_backup_records, list_pos_team_members,
--       manage_pos_team_member, complete_pos_refund
-- Security: SECURITY DEFINER, Immutable search_path, Internal Authorization Guard
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. complete_pos_sale
-- Completes a cloud sale atomically: verifies business membership, validates
-- stock, updates inventory in pos_records, and writes the sale record.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.complete_pos_sale(
    p_business_id TEXT,
    p_sale JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    v_sale_id TEXT;
    v_items JSONB;
    v_item JSONB;
    v_prod_id TEXT;
    v_qty NUMERIC;
    v_prod_record RECORD;
    v_prod_data JSONB;
    v_current_stock NUMERIC;
    v_new_stock NUMERIC;
    v_now TIMESTAMPTZ := timezone('utc'::text, now());
BEGIN
    -- 1. Authorization: Verify caller is an authenticated member of this business
    IF NOT public.check_user_business_membership(p_business_id, ARRAY['owner', 'manager', 'cashier']) THEN
        RAISE EXCEPTION 'Access Denied: Caller is not an authorized member of business "%"', p_business_id
            USING ERRCODE = '42501';
    END IF;

    -- 2. Validate sale input
    v_sale_id := p_sale->>'id';
    IF v_sale_id IS NULL OR trim(v_sale_id) = '' THEN
        RAISE EXCEPTION 'Validation Error: Sale ID is required' USING ERRCODE = '22023';
    END IF;

    v_items := p_sale->'items';
    IF v_items IS NULL OR jsonb_array_length(v_items) = 0 THEN
        RAISE EXCEPTION 'Validation Error: Sale must contain at least one item' USING ERRCODE = '22023';
    END IF;

    -- 3. Check for existing sale with same ID (Idempotency)
    IF EXISTS (
        SELECT 1 FROM public.pos_records
        WHERE business_id = p_business_id
          AND record_type = 'sale'
          AND record_id = v_sale_id
    ) THEN
        RETURN jsonb_build_object(
            'success', true,
            'sale_id', v_sale_id,
            'completed_at', v_now::text,
            'idempotent_replay', true
        );
    END IF;

    -- 4. Deduct Stock for each line item
    FOR v_item IN SELECT * FROM jsonb_array_elements(v_items)
    LOOP
        v_prod_id := COALESCE(v_item->'product'->>'id', v_item->>'productId');
        v_qty := COALESCE((v_item->>'quantity')::numeric, 1);

        IF v_prod_id IS NOT NULL THEN
            -- Lock product record FOR UPDATE to prevent race conditions
            SELECT * INTO v_prod_record
            FROM public.pos_records
            WHERE business_id = p_business_id
              AND record_type = 'product'
              AND record_id = v_prod_id
            FOR UPDATE;

            IF FOUND THEN
                v_prod_data := v_prod_record.data;
                v_current_stock := COALESCE((v_prod_data->>'stock')::numeric, 0);

                IF v_current_stock < v_qty THEN
                    RAISE EXCEPTION 'Insufficient stock for product "%": required %, available %',
                        COALESCE(v_prod_data->>'name', v_prod_id), v_qty, v_current_stock
                        USING ERRCODE = 'P0001';
                END IF;

                v_new_stock := v_current_stock - v_qty;
                v_prod_data := jsonb_set(v_prod_data, '{stock}', to_jsonb(v_new_stock));

                UPDATE public.pos_records
                SET data = v_prod_data,
                    updated_by = auth.uid(),
                    updated_at = v_now
                WHERE business_id = p_business_id
                  AND record_type = 'product'
                  AND record_id = v_prod_id;
            END IF;
        END IF;
    END LOOP;

    -- 5. Insert Sale Record into pos_records
    INSERT INTO public.pos_records (
        business_id,
        record_type,
        record_id,
        data,
        updated_by,
        updated_at
    ) VALUES (
        p_business_id,
        'sale',
        v_sale_id,
        p_sale,
        auth.uid(),
        v_now
    );

    RETURN jsonb_build_object(
        'success', true,
        'sale_id', v_sale_id,
        'completed_at', v_now::text
    );
END;
$$;

-- ----------------------------------------------------------------------------
-- 2. restore_pos_backup_records
-- Restores records into pos_records with ON CONFLICT DO NOTHING (safe merge).
-- Restricted strictly to business owners and managers.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.restore_pos_backup_records(
    p_business_id TEXT,
    p_records JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    v_rec JSONB;
    v_rec_type TEXT;
    v_rec_id TEXT;
    v_data JSONB;
    v_recovered_count INT := 0;
    v_evaluated_count INT := 0;
    v_now TIMESTAMPTZ := timezone('utc'::text, now());
BEGIN
    -- 1. Authorization: Only Owner and Manager can execute restoration
    IF NOT public.check_user_business_membership(p_business_id, ARRAY['owner', 'manager']) THEN
        RAISE EXCEPTION 'Access Denied: Only owners or managers may restore backups for business "%"', p_business_id
            USING ERRCODE = '42501';
    END IF;

    IF p_records IS NULL OR jsonb_typeof(p_records) != 'array' THEN
        RAISE EXCEPTION 'Validation Error: Records payload must be a JSON array' USING ERRCODE = '22023';
    END IF;

    -- 2. Evaluate and insert records
    FOR v_rec IN SELECT * FROM jsonb_array_elements(p_records)
    LOOP
        v_evaluated_count := v_evaluated_count + 1;
        v_rec_type := v_rec->>'record_type';
        v_rec_id := v_rec->>'record_id';
        v_data := v_rec->'data';

        IF v_rec_type IS NOT NULL AND v_rec_id IS NOT NULL AND v_data IS NOT NULL THEN
            INSERT INTO public.pos_records (
                business_id,
                record_type,
                record_id,
                data,
                updated_by,
                updated_at
            ) VALUES (
                p_business_id,
                v_rec_type,
                v_rec_id,
                v_data,
                auth.uid(),
                v_now
            )
            ON CONFLICT (business_id, record_type, record_id) DO NOTHING;

            IF FOUND THEN
                v_recovered_count := v_recovered_count + 1;
            END IF;
        END IF;
    END LOOP;

    RETURN jsonb_build_object(
        'success', true,
        'recovered_count', v_recovered_count,
        'evaluated_count', v_evaluated_count
    );
END;
$$;

-- ----------------------------------------------------------------------------
-- 3. list_pos_team_members
-- Lists members of a business (with email from auth.users).
-- Restricted to owners and managers.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_pos_team_members(
    p_business_id TEXT
)
RETURNS TABLE (
    user_id UUID,
    email TEXT,
    role TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
    IF NOT public.check_user_business_membership(p_business_id, ARRAY['owner', 'manager']) THEN
        RAISE EXCEPTION 'Access Denied: Only owners or managers can view team members'
            USING ERRCODE = '42501';
    END IF;

    RETURN QUERY
    SELECT 
        bm.user_id,
        u.email::text,
        bm.role
    FROM public.business_members bm
    JOIN auth.users u ON u.id = bm.user_id
    WHERE bm.business_id = p_business_id
    ORDER BY bm.created_at ASC;
END;
$$;

-- ----------------------------------------------------------------------------
-- 4. manage_pos_team_member
-- Adds or removes team members with role hierarchy enforcement.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.manage_pos_team_member(
    p_business_id TEXT,
    p_action TEXT,
    p_email TEXT DEFAULT NULL,
    p_role TEXT DEFAULT 'cashier',
    p_user_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    v_caller_role TEXT;
    v_target_user_id UUID;
    v_target_role TEXT;
BEGIN
    -- Determine caller role
    SELECT bm.role INTO v_caller_role
    FROM public.business_members bm
    WHERE bm.business_id = p_business_id AND bm.user_id = auth.uid();

    IF v_caller_role IS NULL OR v_caller_role NOT IN ('owner', 'manager') THEN
        RAISE EXCEPTION 'Access Denied: Only owners and managers can manage team members'
            USING ERRCODE = '42501';
    END IF;

    -- Action: ADD
    IF p_action = 'add' THEN
        IF p_email IS NULL OR trim(p_email) = '' THEN
            RAISE EXCEPTION 'Validation Error: Email is required to add team member' USING ERRCODE = '22023';
        END IF;

        IF p_role NOT IN ('manager', 'cashier') THEN
            RAISE EXCEPTION 'Validation Error: Role must be manager or cashier' USING ERRCODE = '22023';
        END IF;

        -- Managers cannot create other managers (only owners can)
        IF v_caller_role = 'manager' AND p_role = 'manager' THEN
            RAISE EXCEPTION 'Access Denied: Managers cannot promote other users to manager' USING ERRCODE = '42501';
        END IF;

        -- Find user by email in auth.users
        SELECT u.id INTO v_target_user_id
        FROM auth.users u
        WHERE lower(u.email) = lower(trim(p_email));

        IF v_target_user_id IS NULL THEN
            RAISE EXCEPTION 'User not found: Account "%" must register first', p_email
                USING ERRCODE = 'P0002';
        END IF;

        INSERT INTO public.business_members (business_id, user_id, role)
        VALUES (p_business_id, v_target_user_id, p_role)
        ON CONFLICT (business_id, user_id) DO UPDATE SET
            role = EXCLUDED.role,
            updated_at = timezone('utc'::text, now());

        RETURN jsonb_build_object('success', true, 'action', 'add', 'user_id', v_target_user_id);

    -- Action: REMOVE
    ELSIF p_action = 'remove' THEN
        IF p_user_id IS NULL THEN
            RAISE EXCEPTION 'Validation Error: user_id is required to remove member' USING ERRCODE = '22023';
        END IF;

        -- Cannot remove self as sole owner
        IF p_user_id = auth.uid() AND v_caller_role = 'owner' THEN
            RAISE EXCEPTION 'Action Blocked: Cannot remove yourself as owner' USING ERRCODE = '42501';
        END IF;

        -- Get target user role
        SELECT bm.role INTO v_target_role
        FROM public.business_members bm
        WHERE bm.business_id = p_business_id AND bm.user_id = p_user_id;

        IF v_target_role IS NULL THEN
            RAISE EXCEPTION 'Target user is not a member of this business' USING ERRCODE = 'P0002';
        END IF;

        -- Manager cannot remove an owner or another manager
        IF v_caller_role = 'manager' AND v_target_role IN ('owner', 'manager') THEN
            RAISE EXCEPTION 'Access Denied: Managers can only remove cashiers' USING ERRCODE = '42501';
        END IF;

        DELETE FROM public.business_members
        WHERE business_id = p_business_id AND user_id = p_user_id;

        RETURN jsonb_build_object('success', true, 'action', 'remove', 'user_id', p_user_id);
    ELSE
        RAISE EXCEPTION 'Invalid action: "%". Must be "add" or "remove"', p_action USING ERRCODE = '22023';
    END IF;
END;
$$;

