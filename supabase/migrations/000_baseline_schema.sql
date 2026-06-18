-- =====================================================================
-- 000_baseline_schema.sql  —  THE SCHEMA BASELINE (disaster recovery + rebuild)
-- =====================================================================
-- Generated from a schema-only pg_dump of the live database (public schema).
-- This is the authoritative starting point: it creates every table, function
-- (incl. the SECURITY DEFINER membership/RPC functions), view, index, FK,
-- constraint, RLS enablement, policy, and trigger that the live database has.
-- Migrations 001..036 then apply ON TOP of this as idempotent deltas (they were
-- audited to be safe no-ops here: create-or-replace functions, if-not-exists
-- tables/columns/indexes, drop-if-exists+create policies/triggers, drop+add
-- constraints). So: empty DB -> 000 -> 001..036 reproduces the live schema.
--
-- NOTES / LIMITATIONS:
--  * Run against a fresh SUPABASE project: the auth/storage schemas, the
--    `extensions` schema, and auth.uid()/auth.jwt() must already exist. This is
--    NOT a from-scratch bootstrap for a bare non-Supabase Postgres.
--  * --schema=public does not emit extensions (they live in `extensions`), so the
--    uuid default (extensions.uuid_generate_v4()) needs uuid-ossp — created below.
--  * A trigger on auth.users that syncs public.users is OUTSIDE the public schema
--    and is therefore NOT captured here; recreate it separately if needed.
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto   WITH SCHEMA extensions;

--
-- PostgreSQL database dump
--


-- Dumped from database version 17.6
-- Dumped by pg_dump version 17.10 (Homebrew)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA IF NOT EXISTS public;


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS 'standard public schema';


--
-- Name: accept_invite(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.accept_invite(p_token uuid) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
declare
  inv    public.company_invites;
  v_user uuid := auth.uid();
  v_role text;
begin
  if v_user is null then raise exception 'not authenticated'; end if;

  select * into inv from public.company_invites where token = p_token;
  if inv.id is null      then raise exception 'invalid invite';      end if;
  if inv.status <> 'pending' then raise exception 'invite already used'; end if;
  if inv.expires_at < now()  then raise exception 'invite expired';     end if;

  v_role := lower(coalesce(inv.role, 'member'));
  if v_role not in ('admin', 'member') then v_role := 'member'; end if;

  if not exists (select 1 from public.company_users
                 where company_id = inv.company_id and user_id = v_user) then
    insert into public.company_users (company_id, user_id, role, accepted_at)
    values (inv.company_id, v_user, v_role, now());
  end if;

  update public.company_invites set status = 'accepted' where id = inv.id;
  return inv.company_id;
end;
$$;


--
-- Name: audit_log_immutable(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.audit_log_immutable() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is immutable — rows cannot be updated or deleted';
END;
$$;


--
-- Name: auth_company_ids(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.auth_company_ids() RETURNS uuid[]
    LANGUAGE sql STABLE SECURITY DEFINER
    AS $$
  SELECT ARRAY(
    SELECT company_id
    FROM company_users
    WHERE user_id = auth.uid()
      AND accepted_at IS NOT NULL
  )
$$;


--
-- Name: auth_company_role(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.auth_company_role(p_company_id uuid) RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    AS $$
  SELECT role
  FROM company_users
  WHERE user_id = auth.uid()
    AND company_id = p_company_id
    AND accepted_at IS NOT NULL
  LIMIT 1
$$;


--
-- Name: bump_rate_limit(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.bump_rate_limit(p_user uuid, p_bucket text) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
declare v_count integer;
begin
  insert into public.rate_limit (user_id, bucket, hour_bucket, count)
  values (p_user, p_bucket, date_trunc('hour', now()), 1)
  on conflict (user_id, bucket, hour_bucket)
  do update set count = public.rate_limit.count + 1, updated_at = now()
  returning count into v_count;
  return v_count;
end;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: companies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.companies (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    name text NOT NULL,
    tax_id text,
    address text,
    city text,
    state text,
    zip text,
    country text DEFAULT 'US'::text NOT NULL,
    fiscal_year_end text DEFAULT '12-31'::text NOT NULL,
    currency text DEFAULT 'USD'::text NOT NULL,
    logo_path text,
    default_cash_account text DEFAULT '1000'::text,
    default_ap_account text DEFAULT '2000'::text,
    default_ar_account text DEFAULT '1100'::text,
    next_invoice_number integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    onboarding_complete boolean DEFAULT false NOT NULL,
    business_type text
);


--
-- Name: create_company(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_company(p_name text) RETURNS public.companies
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
declare
  c public.companies;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if coalesce(btrim(p_name), '') = '' then
    raise exception 'company name required';
  end if;

  insert into public.companies (name) values (btrim(p_name)) returning * into c;

  insert into public.company_users (company_id, user_id, role, accepted_at)
  values (c.id, auth.uid(), 'owner', now());

  return c;
end;
$$;


--
-- Name: get_admin_company_audit(uuid, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_admin_company_audit(p_company_id uuid, p_limit integer DEFAULT 500) RETURNS TABLE(id text, action text, detail text, performed_by text, created_at timestamp with time zone, before_state jsonb, after_state jsonb)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
begin
  if not public.is_platform_admin() then raise exception 'not authorized' using errcode='42501'; end if;
  return query
  select a.id::text, a.action::text, a.detail::text, a.performed_by::text, a.created_at::timestamptz,
         a.before_state::jsonb, a.after_state::jsonb
  from public.audit_log a where a.company_id=p_company_id
  order by a.created_at desc limit p_limit;
end; $$;


--
-- Name: get_admin_company_stats(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_admin_company_stats() RETURNS TABLE(company_id uuid, name text, owner_email text, created_at timestamp with time zone, last_active timestamp with time zone, txn_count bigint, doc_count bigint, failed_uploads_7d bigint, storage_bytes bigint, status text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'auth', 'storage', 'pg_temp'
    AS $$
begin
  if not public.is_platform_admin() then raise exception 'not authorized' using errcode='42501'; end if;
  return query
  select
    c.id::uuid, c.name::text,
    (select u.email::text from public.company_users cu join auth.users u on u.id=cu.user_id
       where cu.company_id=c.id and cu.role='owner' order by cu.accepted_at nulls last limit 1),
    c.created_at::timestamptz,
    (select max(a.created_at) from public.audit_log a where a.company_id=c.id)::timestamptz,
    (select count(*) from public.journal_entries je where je.company_id=c.id and je.deleted_at is null)::bigint,
    (select count(*) from public.documents d where d.company_id=c.id)::bigint,
    (select count(*) from public.upload_log ul where ul.company_id=c.id and ul.status='error' and ul.created_at > now()-interval '7 days')::bigint,
    coalesce((select sum((o.metadata->>'size')::bigint) from storage.objects o
              where o.bucket_id='documents' and split_part(o.name,'/',1)=c.id::text),0)::bigint,
    (case when (select max(a.created_at) from public.audit_log a where a.company_id=c.id) > now()-interval '7 days' then 'active'
          when (select max(a.created_at) from public.audit_log a where a.company_id=c.id) > now()-interval '30 days' then 'idle'
          else 'churned' end)::text
  from public.companies c
  order by (select max(a.created_at) from public.audit_log a where a.company_id=c.id) desc nulls last;
end; $$;


--
-- Name: get_admin_company_uploads(uuid, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_admin_company_uploads(p_company_id uuid, p_limit integer DEFAULT 500) RETURNS TABLE(id uuid, file_name text, file_type text, file_size_bytes bigint, doc_type text, status text, result jsonb, error text, created_at timestamp with time zone, completed_at timestamp with time zone)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
begin
  if not public.is_platform_admin() then raise exception 'not authorized' using errcode='42501'; end if;
  return query
  select ul.id::uuid, ul.file_name::text, ul.file_type::text, ul.file_size_bytes::bigint, ul.doc_type::text,
         ul.status::text, ul.result::jsonb, ul.error::text, ul.created_at::timestamptz, ul.completed_at::timestamptz
  from public.upload_log ul where ul.company_id=p_company_id
  order by ul.created_at desc limit p_limit;
end; $$;


--
-- Name: get_admin_duplicate_entries(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_admin_duplicate_entries() RETURNS TABLE(company_id uuid, company_name text, vendor text, entry_date date, amount numeric, cnt bigint, entry_ids uuid[])
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
begin
  if not public.is_platform_admin() then raise exception 'not authorized' using errcode='42501'; end if;
  return query
  with e as (
    select je.id, je.company_id, je.entry_date, split_part(je.description,' – ',1) as vendor,
           coalesce((select sum(l.debit) from public.journal_entry_lines l where l.journal_entry_id=je.id),0) as amount
    from public.journal_entries je where je.deleted_at is null and je.status='posted'
  )
  select e.company_id::uuid, c.name::text, e.vendor::text, e.entry_date::date, e.amount::numeric,
         count(*)::bigint, array_agg(e.id)::uuid[]
  from e join public.companies c on c.id=e.company_id
  group by e.company_id, c.name, e.vendor, e.entry_date, e.amount
  having count(*) > 1 and e.amount > 0
  order by count(*) desc, e.amount desc;
end; $$;


--
-- Name: get_admin_failed_uploads(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_admin_failed_uploads(p_days integer DEFAULT 7) RETURNS TABLE(id uuid, company_id uuid, company_name text, file_name text, file_type text, error text, created_at timestamp with time zone, has_storage boolean)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'storage', 'pg_temp'
    AS $$
begin
  if not public.is_platform_admin() then raise exception 'not authorized' using errcode='42501'; end if;
  return query
  select ul.id::uuid, ul.company_id::uuid, c.name::text, ul.file_name::text, ul.file_type::text,
         ul.error::text, ul.created_at::timestamptz,
         exists(select 1 from storage.objects o where o.bucket_id='documents'
                and split_part(o.name,'/',1)=ul.company_id::text and o.name ilike '%'||ul.file_name)::boolean
  from public.upload_log ul join public.companies c on c.id=ul.company_id
  where ul.status='error' and ul.created_at > now()-make_interval(days=>p_days)
  order by ul.created_at desc;
end; $$;


--
-- Name: get_admin_orphaned_documents(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_admin_orphaned_documents() RETURNS TABLE(source text, id uuid, company_id uuid, company_name text, file_name text, doc_type text, created_at timestamp with time zone, detail text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
begin
  if not public.is_platform_admin() then raise exception 'not authorized' using errcode='42501'; end if;
  return query
  select 'document'::text, d.id::uuid, d.company_id::uuid, c.name::text, d.name::text,
         d.document_type::text,
         coalesce((to_jsonb(d)->>'created_at')::timestamptz, (to_jsonb(d)->>'uploaded_at')::timestamptz),
         (case when d.linked_invoice_id is null then 'no linked entry' else 'linked id not found' end)::text
  from public.documents d join public.companies c on c.id=d.company_id
  where d.linked_invoice_id is null
     or not exists (select 1 from public.journal_entries je where je.id::text=d.linked_invoice_id and je.deleted_at is null)
  order by coalesce((to_jsonb(d)->>'created_at')::timestamptz, (to_jsonb(d)->>'uploaded_at')::timestamptz) desc nulls last;
end; $$;


--
-- Name: get_admin_platform_stats(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_admin_platform_stats() RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'storage', 'pg_temp'
    AS $$
declare result jsonb;
begin
  if not public.is_platform_admin() then raise exception 'not authorized' using errcode = '42501'; end if;
  select jsonb_build_object(
    'total_companies', (select count(*) from public.companies),
    'companies_by_month', (select coalesce(jsonb_agg(jsonb_build_object('month', m, 'count', n) order by m), '[]'::jsonb)
        from (select to_char(date_trunc('month', created_at), 'YYYY-MM') m, count(*) n from public.companies group by 1) s),
    'total_transactions', (select count(*) from public.journal_entries where deleted_at is null),
    'transactions_this_month', (select count(*) from public.journal_entries where deleted_at is null and entry_date >= date_trunc('month', now())::date),
    'total_documents', (select count(*) from public.documents),
    'storage_gb', round(coalesce((select sum((metadata->>'size')::bigint) from storage.objects where bucket_id = 'documents'), 0)::numeric / 1073741824, 3),
    'total_chat_messages', (select count(*) from public.chat_messages),
    'upload_success_rate', (select case when count(*) = 0 then null
        else round(100.0 * count(*) filter (where status = 'done') / count(*), 1) end from public.upload_log),
    'top_companies', (select coalesce(jsonb_agg(jsonb_build_object('name', name, 'txns', n) order by n desc), '[]'::jsonb)
        from (select c.name, count(je.*) n from public.companies c
              left join public.journal_entries je on je.company_id = c.id and je.deleted_at is null
              group by c.id, c.name order by n desc limit 10) t),
    'feature_usage', (select coalesce(jsonb_agg(jsonb_build_object('action', action, 'count', n) order by n desc), '[]'::jsonb)
        from (select action, count(*) n from public.audit_log group by action order by n desc limit 20) f),
    'ai_calls_estimate', (select count(*) from public.chat_messages where role = 'assistant'),
    'generated_at', now()
  ) into result;
  return result;
end;
$$;


--
-- Name: get_admin_recent_errors(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_admin_recent_errors(p_limit integer DEFAULT 50) RETURNS TABLE(id text, company_id uuid, company_name text, action text, detail text, performed_by text, created_at timestamp with time zone)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
begin
  if not public.is_platform_admin() then raise exception 'not authorized' using errcode='42501'; end if;
  return query
  select a.id::text, a.company_id::uuid, c.name::text, a.action::text, a.detail::text, a.performed_by::text, a.created_at::timestamptz
  from public.audit_log a left join public.companies c on c.id=a.company_id
  where a.action ilike '%error%' or a.action ilike '%fail%' or a.action ilike '%reject%'
     or a.detail ilike '%error%' or a.detail ilike '%failed%'
  order by a.created_at desc limit p_limit;
end; $$;


--
-- Name: get_admin_search_entries(uuid, date, date, text, numeric, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_admin_search_entries(p_company_id uuid DEFAULT NULL::uuid, p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date, p_vendor text DEFAULT NULL::text, p_amount numeric DEFAULT NULL::numeric, p_include_deleted boolean DEFAULT true) RETURNS TABLE(id uuid, company_id uuid, company_name text, entry_date date, vendor text, description text, amount numeric, status text, deleted_at timestamp with time zone, deleted_by_email text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'auth', 'pg_temp'
    AS $$
begin
  if not public.is_platform_admin() then raise exception 'not authorized' using errcode='42501'; end if;
  return query
  with e as (
    select je.id, je.company_id, je.entry_date, je.description, je.status, je.deleted_at, je.deleted_by,
           split_part(je.description,' – ',1) as vendor,
           coalesce((select sum(l.debit) from public.journal_entry_lines l where l.journal_entry_id=je.id),0) as amount
    from public.journal_entries je
    where (p_company_id is null or je.company_id=p_company_id)
      and (p_include_deleted or je.deleted_at is null)
      and (p_from is null or je.entry_date >= p_from) and (p_to is null or je.entry_date <= p_to)
  )
  select e.id::uuid, e.company_id::uuid, c.name::text, e.entry_date::date, e.vendor::text,
         e.description::text, e.amount::numeric, e.status::text, e.deleted_at::timestamptz,
         (select u.email::text from auth.users u where u.id=e.deleted_by)
  from e join public.companies c on c.id=e.company_id
  where (p_vendor is null or e.vendor ilike '%'||p_vendor||'%' or e.description ilike '%'||p_vendor||'%')
    and (p_amount is null or e.amount = p_amount)
  order by e.entry_date desc, e.deleted_at desc nulls last limit 500;
end; $$;


--
-- Name: get_admin_soft_deleted(uuid, date, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_admin_soft_deleted(p_company_id uuid, p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date) RETURNS TABLE(id uuid, company_id uuid, entry_date date, vendor text, description text, amount numeric, status text, deleted_at timestamp with time zone, deleted_by uuid, deleted_by_email text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'auth', 'pg_temp'
    AS $$
begin
  if not public.is_platform_admin() then raise exception 'not authorized' using errcode='42501'; end if;
  return query
  select je.id::uuid, je.company_id::uuid, je.entry_date::date,
    split_part(je.description,' – ',1)::text, je.description::text,
    coalesce((select sum(l.debit) from public.journal_entry_lines l where l.journal_entry_id=je.id),0)::numeric,
    je.status::text, je.deleted_at::timestamptz, je.deleted_by::uuid,
    (select u.email::text from auth.users u where u.id=je.deleted_by)
  from public.journal_entries je
  where je.company_id=p_company_id and je.deleted_at is not null
    and (p_from is null or je.entry_date >= p_from) and (p_to is null or je.entry_date <= p_to)
  order by je.deleted_at desc;
end; $$;


--
-- Name: get_admin_stuck_uploads(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_admin_stuck_uploads() RETURNS TABLE(id uuid, company_id uuid, company_name text, file_name text, created_at timestamp with time zone, minutes_stuck integer)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
begin
  if not public.is_platform_admin() then raise exception 'not authorized' using errcode='42501'; end if;
  return query
  select ul.id::uuid, ul.company_id::uuid, c.name::text, ul.file_name::text, ul.created_at::timestamptz,
         floor(extract(epoch from (now()-ul.created_at))/60)::int
  from public.upload_log ul join public.companies c on c.id=ul.company_id
  where ul.status='processing' and ul.created_at < now()-interval '10 minutes'
  order by ul.created_at asc;
end; $$;


--
-- Name: get_admin_table_counts(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_admin_table_counts() RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
begin
  if not public.is_platform_admin() then raise exception 'not authorized' using errcode = '42501'; end if;
  return jsonb_build_object(
    'companies',              (select count(*) from public.companies),
    'company_users',          (select count(*) from public.company_users),
    'journal_entries',        (select count(*) from public.journal_entries),
    'journal_entries_deleted',(select count(*) from public.journal_entries where deleted_at is not null),
    'journal_entry_lines',    (select count(*) from public.journal_entry_lines),
    'contacts',               (select count(*) from public.contacts),
    'contracts',              (select count(*) from public.contracts),
    'accounts',               (select count(*) from public.accounts),
    'documents',              (select count(*) from public.documents),
    'upload_log',             (select count(*) from public.upload_log),
    'audit_log',              (select count(*) from public.audit_log),
    'chat_messages',          (select count(*) from public.chat_messages),
    'bank_accounts',          (select count(*) from public.bank_accounts)
  );
end;
$$;


--
-- Name: get_admin_trace_file(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_admin_trace_file(p_file text) RETURNS TABLE(upload_id uuid, company_id uuid, company_name text, file_name text, file_type text, status text, doc_type text, result jsonb, error text, document_id uuid, created_at timestamp with time zone, completed_at timestamp with time zone)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
begin
  if not public.is_platform_admin() then raise exception 'not authorized' using errcode='42501'; end if;
  return query
  select ul.id::uuid, ul.company_id::uuid, c.name::text, ul.file_name::text, ul.file_type::text,
         ul.status::text, ul.doc_type::text, ul.result::jsonb, ul.error::text, ul.document_id::uuid,
         ul.created_at::timestamptz, ul.completed_at::timestamptz
  from public.upload_log ul join public.companies c on c.id=ul.company_id
  where ul.file_name ilike '%'||p_file||'%'
  order by ul.created_at desc limit 200;
end; $$;


--
-- Name: handle_new_user(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.handle_new_user() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
BEGIN
  INSERT INTO public.users (id, email, full_name)
  VALUES (NEW.id, NEW.email, NEW.raw_user_meta_data->>'full_name')
  ON CONFLICT (id) DO UPDATE SET
    email      = EXCLUDED.email,
    full_name  = EXCLUDED.full_name,
    updated_at = NOW();
  RETURN NEW;
END;
$$;


--
-- Name: invite_details(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.invite_details(p_token uuid) RETURNS TABLE(company_name text, role text, status text, expired boolean)
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  select c.name::text, ci.role, ci.status, (ci.expires_at < now())
  from public.company_invites ci
  join public.companies c on c.id = ci.company_id
  where ci.token = p_token;
$$;


--
-- Name: is_company_admin(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_company_admin(cid uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  select exists (
    select 1
    from public.company_users cu
    where cu.company_id = cid
      and cu.user_id = auth.uid()
      and cu.accepted_at is not null
      and cu.role in ('owner','admin')
  );
$$;


--
-- Name: is_company_member(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_company_member(cid uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  select public.is_platform_admin()
      or exists (select 1 from public.company_users cu
                 where cu.company_id = cid and cu.user_id = auth.uid() and cu.accepted_at is not null);
$$;


--
-- Name: is_company_owner(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_company_owner(cid uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  select exists (
    select 1 from public.company_users cu
    where cu.company_id = cid and cu.user_id = auth.uid()
      and cu.accepted_at is not null and cu.role = 'owner'
  );
$$;


--
-- Name: is_platform_admin(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_platform_admin() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'auth', 'pg_temp'
    AS $$
  select lower(coalesce(
           (select u.email from auth.users u where u.id = auth.uid()),
           auth.jwt() ->> 'email'
         )) = any (array['alexabdella@gmail.com']);
$$;


--
-- Name: list_company_members(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.list_company_members(p_company uuid) RETURNS TABLE(user_id uuid, email text, full_name text, role text, accepted_at timestamp with time zone)
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  select cu.user_id, u.email::text,
         coalesce(u.raw_user_meta_data->>'full_name', '')::text,
         cu.role, cu.accepted_at
  from public.company_users cu
  join auth.users u on u.id = cu.user_id
  where cu.company_id = p_company
    and public.is_company_admin(p_company);
$$;


--
-- Name: next_invoice_number(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.next_invoice_number(p_company_id uuid) RETURNS text
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_next INTEGER;
BEGIN
  UPDATE companies
  SET next_invoice_number = next_invoice_number + 1
  WHERE id = p_company_id
  RETURNING next_invoice_number - 1 INTO v_next;
  RETURN 'INV-' || LPAD(v_next::TEXT, 4, '0');
END;
$$;


--
-- Name: post_journal_entry(uuid, date, text, text, uuid, jsonb, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.post_journal_entry(p_company_id uuid, p_entry_date date, p_description text, p_source text, p_created_by uuid, p_lines jsonb, p_meta jsonb DEFAULT '{}'::jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
declare
  v_entry_id     uuid;
  v_total_debit  numeric := 0;
  v_total_credit numeric := 0;
  v_line         jsonb;
  v_result       jsonb;
begin
  if not public.is_company_member(p_company_id) then
    raise exception 'not a member of company %', p_company_id using errcode = '42501';
  end if;

  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'journal entry must have at least one line';
  end if;

  select coalesce(sum((l->>'debit')::numeric), 0),
         coalesce(sum((l->>'credit')::numeric), 0)
    into v_total_debit, v_total_credit
    from jsonb_array_elements(p_lines) as l;

  if round(v_total_debit, 2) <> round(v_total_credit, 2) then
    raise exception 'journal entry not balanced: debits % <> credits %', v_total_debit, v_total_credit;
  end if;

  insert into public.journal_entries (
    company_id, entry_date, description, source, status, posted_at, created_by,
    ai_reasoning, ai_confidence, approval_status, payment_status, payment_method, due_date
  ) values (
    p_company_id, p_entry_date, p_description, coalesce(p_source, 'manual'), 'posted', now(), p_created_by,
    nullif(p_meta->>'ai_reasoning', ''),
    nullif(p_meta->>'ai_confidence', '')::numeric,
    nullif(p_meta->>'approval_status', ''),
    nullif(p_meta->>'payment_status', ''),
    nullif(p_meta->>'payment_method', ''),
    nullif(p_meta->>'due_date', '')::date
  )
  returning id into v_entry_id;

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    if (v_line->>'account_id') is null then
      raise exception 'every line must have an account_id';
    end if;
    insert into public.journal_entry_lines (journal_entry_id, company_id, account_id, debit, credit, memo)
    values (
      v_entry_id, p_company_id,
      (v_line->>'account_id')::uuid,
      coalesce((v_line->>'debit')::numeric, 0),
      coalesce((v_line->>'credit')::numeric, 0),
      v_line->>'memo'
    );
  end loop;

  select jsonb_build_object(
    'id', v_entry_id,
    'entry', to_jsonb(je.*),
    'lines', coalesce(
      (select jsonb_agg(to_jsonb(jel.*)) from public.journal_entry_lines jel where jel.journal_entry_id = v_entry_id),
      '[]'::jsonb)
  ) into v_result
  from public.journal_entries je
  where je.id = v_entry_id;

  return v_result;
exception
  when others then
    raise;
end;
$$;


--
-- Name: restore_deleted_entry(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.restore_deleted_entry(p_entry_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'auth', 'pg_temp'
    AS $$
declare v_company uuid; v_desc text; v_email text;
begin
  if not public.is_platform_admin() then raise exception 'not authorized' using errcode = '42501'; end if;
  select company_id, description into v_company, v_desc from public.journal_entries where id = p_entry_id;
  if v_company is null then raise exception 'entry % not found', p_entry_id; end if;
  update public.journal_entries set deleted_at = null, deleted_by = null where id = p_entry_id;
  v_email := lower(coalesce((select email from auth.users where id = auth.uid()), auth.jwt() ->> 'email'));
  insert into public.audit_log (company_id, action, detail, before_state, after_state, performed_by)
  values (v_company, 'admin_restore',
          'Platform admin restored deleted entry: '||coalesce(v_desc, p_entry_id::text),
          jsonb_build_object('deleted', true),
          jsonb_build_object('deleted', false, 'entry_id', p_entry_id),
          'Platform Admin - '||v_email);
  return jsonb_build_object('restored', true, 'company_id', v_company, 'entry_id', p_entry_id);
end;
$$;


--
-- Name: rls_auto_enable(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rls_auto_enable() RETURNS event_trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$$;


--
-- Name: security_check(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.security_check() RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_catalog', 'pg_temp'
    AS $$
declare
  v_rls jsonb; v_policies jsonb;
  critical text[] := array[
    'journal_entries','journal_entry_lines','contacts','contracts','accounts',
    'audit_log','documents','bank_accounts','recurring_transactions','vendor_rules',
    'ar_invoices','chat_messages','tax_settings','reconciliations','companies','company_users'];
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('table',t,'exists',(c.relname is not null),
           'enabled',coalesce(c.relrowsecurity,false)) order by t),'[]'::jsonb)
    into v_rls
  from unnest(critical) as t
  left join pg_class c on c.relname=t and c.relnamespace='public'::regnamespace and c.relkind='r';
  select coalesce(jsonb_agg(jsonb_build_object(
           'table',p.tablename,
           'policy',p.policyname,
           'cmd',p.cmd,
           'has_company_check',((coalesce(p.qual,'')||' '||coalesce(p.with_check,''))
              ~ 'is_company_member|is_company_admin|company_id|auth\.uid'),
           'expected',(p.tablename='companies' and p.cmd='INSERT')
         ) order by p.tablename,p.policyname),'[]'::jsonb)
    into v_policies
  from pg_policies p where p.schemaname='public' and p.tablename = any(critical);
  return jsonb_build_object('rls',v_rls,'policies',v_policies,'generated_at',now());
end; $$;


--
-- Name: seed_company_accounts(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.seed_company_accounts(p_company_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
begin
  if not public.is_company_member(p_company_id) then
    raise exception 'not a member of company %', p_company_id;
  end if;

  insert into public.accounts (company_id, code, name, category, system_role)
  select p_company_id, v.code, v.name, v.category, v.role
  from (values
    ('1000','Cash & Cash Equivalents','Assets','cash'),
    ('1010','Savings Account','Assets','savings'),
    ('1100','Accounts Receivable','Assets','accounts_receivable'),
    ('1250','Allowance for Doubtful Accounts','Assets','allowance_doubtful_accounts'),
    ('1300','Prepaid Expenses','Assets','prepaid_expenses'),
    ('1400','Inventory','Assets','inventory'),
    ('1410','Other Current Assets','Assets','other_current_assets'),
    ('1500','Fixed Assets (Equipment & Furniture)','Assets','fixed_assets'),
    ('1510','Accumulated Depreciation','Assets','accumulated_depreciation'),
    ('1600','Intangible Assets','Assets','intangible_assets'),
    ('1700','Security Deposits','Assets','security_deposits'),
    ('1800','Right-of-Use Asset (ASC 842)','Assets','rou_asset'),
    ('1810','Accumulated Amortization - ROU','Assets','accumulated_amortization_rou'),
    ('2000','Accounts Payable','Liabilities','accounts_payable'),
    ('2100','Accrued Liabilities','Liabilities','accrued_liabilities'),
    ('2200','Credit Card Liability','Liabilities','credit_card_liability'),
    ('2300','Deferred Revenue','Liabilities','deferred_revenue'),
    ('2350','Sales Tax Payable','Liabilities','sales_tax_payable'),
    ('2400','Lease Liability - Current (ASC 842)','Liabilities','lease_liability_current'),
    ('2450','Lease Liability - Non-Current (ASC 842)','Liabilities','lease_liability_noncurrent'),
    ('2500','Long-Term Debt','Liabilities','long_term_debt'),
    ('2600','Notes Payable','Liabilities','notes_payable'),
    ('3000','Common Stock','Equity','common_stock'),
    ('3100','Retained Earnings','Equity','retained_earnings'),
    ('3200','Additional Paid-In Capital','Equity','additional_paid_in_capital'),
    ('3300','Owner''s Draw / Distributions','Equity','owners_draw'),
    ('4000','Product Revenue','Revenue','product_revenue'),
    ('4100','Service Revenue','Revenue','service_revenue'),
    ('4200','Subscription Revenue','Revenue','subscription_revenue'),
    ('4300','Interest Income','Revenue','interest_income'),
    ('4400','Other Income','Revenue','other_income'),
    ('5000','Cost of Goods Sold','Expenses','cogs'),
    ('5100','Direct Labor','Expenses','direct_labor'),
    ('5200','Shipping & Fulfillment','Expenses','shipping_fulfillment'),
    ('6000','Salaries & Wages','Expenses','salaries_wages'),
    ('6010','Payroll Tax Expense','Expenses','payroll_tax'),
    ('6020','Employee Benefits','Expenses','employee_benefits'),
    ('6050','ROU Asset Amortization','Expenses','rou_amortization'),
    ('6100','Rent & Occupancy','Expenses','rent_occupancy'),
    ('6150','Operating Lease Expense (ASC 842)','Expenses','operating_lease_expense'),
    ('6200','Utilities','Expenses','utilities'),
    ('6250','Repairs & Maintenance','Expenses','repairs_maintenance'),
    ('6300','Marketing & Advertising','Expenses','marketing_advertising'),
    ('6400','Travel & Entertainment','Expenses','travel_entertainment'),
    ('6500','Technology & Software (SaaS)','Expenses','technology_software'),
    ('6600','Office Supplies & De Minimis Equipment','Expenses','office_supplies'),
    ('6700','Insurance','Expenses','insurance'),
    ('6800','Professional Services (Legal/Accounting)','Expenses','professional_services'),
    ('6900','Depreciation & Amortization','Expenses','depreciation_amortization'),
    ('7000','Bad Debt Expense','Expenses','bad_debt'),
    ('7100','Miscellaneous Expense','Expenses','miscellaneous_expense'),
    ('8000','Interest Expense','Expenses','interest_expense'),
    ('8100','Income Tax Expense','Expenses','income_tax_expense'),
    ('8200','Gain / Loss on Asset Disposal','Expenses','gain_loss_disposal')
  ) as v(code, name, category, role)
  on conflict (company_id, code) do update
    set system_role = coalesce(public.accounts.system_role, excluded.system_role);
end;
$$;


--
-- Name: set_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


--
-- Name: touch_tax_settings_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.touch_tax_settings_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  new.updated_at := now();
  return new;
end;
$$;


--
-- Name: accounts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.accounts (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    company_id uuid NOT NULL,
    code text NOT NULL,
    name text NOT NULL,
    category text NOT NULL,
    active boolean DEFAULT true NOT NULL,
    is_system boolean DEFAULT false NOT NULL,
    parent_code text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    system_role text,
    CONSTRAINT accounts_category_check CHECK ((category = ANY (ARRAY['Assets'::text, 'Liabilities'::text, 'Equity'::text, 'Revenue'::text, 'Expenses'::text])))
);


--
-- Name: ap_invoices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ap_invoices (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    company_id uuid NOT NULL,
    journal_entry_id uuid,
    vendor_id uuid,
    invoice_number text,
    invoice_date date,
    due_date date,
    amount_total numeric(15,2) NOT NULL,
    amount_paid numeric(15,2) DEFAULT 0 NOT NULL,
    currency text DEFAULT 'USD'::text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    approved_by uuid,
    approved_at timestamp with time zone,
    payment_method text,
    is_flagged boolean DEFAULT false NOT NULL,
    flag_reason text,
    is_duplicate_of uuid,
    document_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ap_invoices_payment_method_check CHECK ((payment_method = ANY (ARRAY['ach'::text, 'check'::text, 'wire'::text, 'card'::text, 'other'::text]))),
    CONSTRAINT ap_invoices_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text, 'paid'::text, 'partial'::text, 'void'::text])))
);


--
-- Name: contacts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.contacts (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    company_id uuid NOT NULL,
    name text NOT NULL,
    type text DEFAULT 'vendor'::text NOT NULL,
    email text,
    phone text,
    website text,
    address text,
    city text,
    state text,
    zip text,
    country text,
    payment_terms text,
    default_account_id uuid,
    is_1099 boolean DEFAULT false NOT NULL,
    ein text,
    expected_min numeric(15,2),
    expected_max numeric(15,2),
    notes text,
    tags text[] DEFAULT '{}'::text[] NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    business_type text,
    ein_ssn text,
    mailing_address text,
    is_1099_exempt boolean DEFAULT false,
    sent_1099_2025 boolean DEFAULT false,
    vendor_account_number text,
    tax_id text,
    name_key text GENERATED ALWAYS AS (lower(regexp_replace(COALESCE(name, ''::text), '[^A-Za-z0-9]+'::text, ''::text, 'g'::text))) STORED,
    deleted_at timestamp with time zone,
    deleted_by uuid,
    payment_url text,
    CONSTRAINT contacts_type_check CHECK ((type = ANY (ARRAY['vendor'::text, 'customer'::text, 'both'::text])))
);


--
-- Name: ap_aging; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.ap_aging AS
 SELECT ap.company_id,
    ap.id,
    c.name AS vendor_name,
    ap.invoice_number,
    ap.due_date,
    (ap.amount_total - ap.amount_paid) AS balance_due,
    (CURRENT_DATE - ap.due_date) AS days_overdue,
        CASE
            WHEN (ap.due_date >= CURRENT_DATE) THEN 'current'::text
            WHEN (((CURRENT_DATE - ap.due_date) >= 1) AND ((CURRENT_DATE - ap.due_date) <= 30)) THEN '1-30'::text
            WHEN (((CURRENT_DATE - ap.due_date) >= 31) AND ((CURRENT_DATE - ap.due_date) <= 60)) THEN '31-60'::text
            WHEN (((CURRENT_DATE - ap.due_date) >= 61) AND ((CURRENT_DATE - ap.due_date) <= 90)) THEN '61-90'::text
            ELSE '90+'::text
        END AS aging_bucket
   FROM (public.ap_invoices ap
     LEFT JOIN public.contacts c ON ((c.id = ap.vendor_id)))
  WHERE (ap.status <> ALL (ARRAY['paid'::text, 'void'::text]));


--
-- Name: ar_invoices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ar_invoices (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    company_id uuid NOT NULL,
    journal_entry_id uuid,
    customer_id uuid,
    invoice_number text NOT NULL,
    issue_date date NOT NULL,
    due_date date,
    terms text DEFAULT 'Net 30'::text,
    subtotal numeric(15,2) DEFAULT 0 NOT NULL,
    tax_amount numeric(15,2) DEFAULT 0 NOT NULL,
    total numeric(15,2) DEFAULT 0 NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    notes text,
    paid_at timestamp with time zone,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ar_invoices_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'sent'::text, 'partial'::text, 'paid'::text, 'void'::text])))
);


--
-- Name: ar_aging; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.ar_aging AS
 SELECT ar.company_id,
    ar.id,
    c.name AS customer_name,
    ar.invoice_number,
    ar.due_date,
    ar.total AS balance_due,
    (CURRENT_DATE - ar.due_date) AS days_overdue,
        CASE
            WHEN (ar.due_date >= CURRENT_DATE) THEN 'current'::text
            WHEN (((CURRENT_DATE - ar.due_date) >= 1) AND ((CURRENT_DATE - ar.due_date) <= 30)) THEN '1-30'::text
            WHEN (((CURRENT_DATE - ar.due_date) >= 31) AND ((CURRENT_DATE - ar.due_date) <= 60)) THEN '31-60'::text
            WHEN (((CURRENT_DATE - ar.due_date) >= 61) AND ((CURRENT_DATE - ar.due_date) <= 90)) THEN '61-90'::text
            ELSE '90+'::text
        END AS aging_bucket
   FROM (public.ar_invoices ar
     LEFT JOIN public.contacts c ON ((c.id = ar.customer_id)))
  WHERE (ar.status <> ALL (ARRAY['paid'::text, 'void'::text]));


--
-- Name: ar_invoice_lines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ar_invoice_lines (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    ar_invoice_id uuid NOT NULL,
    company_id uuid NOT NULL,
    description text NOT NULL,
    quantity numeric(10,3) DEFAULT 1 NOT NULL,
    unit_rate numeric(15,2) DEFAULT 0 NOT NULL,
    amount numeric(15,2) DEFAULT 0 NOT NULL,
    account_id uuid,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: audit_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_log (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    company_id uuid NOT NULL,
    user_id uuid,
    action text NOT NULL,
    detail text,
    before_state jsonb,
    after_state jsonb,
    ip_address inet,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    performed_by text DEFAULT 'owner'::text NOT NULL
);


--
-- Name: bank_accounts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bank_accounts (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    company_id uuid NOT NULL,
    name text NOT NULL,
    type text DEFAULT 'checking'::text NOT NULL,
    gl_account_id uuid,
    institution text,
    last4 text,
    currency text DEFAULT 'USD'::text NOT NULL,
    current_balance numeric(15,2) DEFAULT 0 NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT bank_accounts_type_check CHECK ((type = ANY (ARRAY['checking'::text, 'savings'::text, 'credit_card'::text, 'loan'::text, 'other'::text])))
);


--
-- Name: chat_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chat_messages (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    company_id uuid NOT NULL,
    role text NOT NULL,
    content text NOT NULL,
    actions_taken jsonb DEFAULT '[]'::jsonb,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: client_ai_profile; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.client_ai_profile (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    company_id uuid NOT NULL,
    business_type text,
    common_vendors jsonb DEFAULT '{}'::jsonb NOT NULL,
    spending_patterns jsonb DEFAULT '{}'::jsonb NOT NULL,
    custom_rules jsonb DEFAULT '[]'::jsonb NOT NULL,
    ai_notes text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: company_invites; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.company_invites (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    company_id uuid NOT NULL,
    email text NOT NULL,
    role text DEFAULT 'member'::text NOT NULL,
    invited_by uuid NOT NULL,
    token uuid DEFAULT extensions.uuid_generate_v4(),
    status text DEFAULT 'pending'::text,
    created_at timestamp with time zone DEFAULT now(),
    expires_at timestamp with time zone DEFAULT (now() + '7 days'::interval)
);


--
-- Name: company_users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.company_users (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    company_id uuid NOT NULL,
    user_id uuid NOT NULL,
    role text DEFAULT 'viewer'::text NOT NULL,
    invited_by uuid,
    accepted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT company_users_role_check CHECK ((role = ANY (ARRAY['owner'::text, 'admin'::text, 'accountant'::text, 'viewer'::text])))
);


--
-- Name: contracts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.contracts (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    company_id uuid NOT NULL,
    file_name text,
    contract_type text,
    counterparty text,
    description text,
    total_value numeric,
    start_date date,
    end_date date,
    payment_amount numeric,
    payment_frequency text,
    interest_rate numeric,
    lease_type text,
    rou_asset_value numeric,
    lease_liability_current numeric,
    lease_liability_noncurrent numeric,
    discount_rate_used numeric,
    lease_term_months integer,
    monthly_straight_line_expense numeric,
    accounting_treatment text,
    key_terms jsonb DEFAULT '[]'::jsonb,
    journal_entries jsonb DEFAULT '[]'::jsonb,
    posted_entries jsonb DEFAULT '[]'::jsonb,
    created_at timestamp with time zone DEFAULT now(),
    uploaded_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone,
    deleted_by uuid
);


--
-- Name: default_chart_of_accounts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.default_chart_of_accounts (
    code text NOT NULL,
    name text NOT NULL,
    category text NOT NULL,
    is_system boolean DEFAULT false NOT NULL
);


--
-- Name: documents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.documents (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    company_id uuid NOT NULL,
    name text NOT NULL,
    storage_path text,
    mime_type text,
    file_size_bytes integer,
    document_type text DEFAULT 'other'::text NOT NULL,
    ai_classification_confidence integer,
    uploaded_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    tags jsonb DEFAULT '[]'::jsonb,
    ai_explanation text,
    entry_summary text,
    linked_invoice_id text,
    CONSTRAINT documents_document_type_check CHECK ((document_type = ANY (ARRAY['invoice'::text, 'contract'::text, 'bank_statement'::text, 'payroll'::text, 'receipt'::text, '1099'::text, 'other'::text])))
);


--
-- Name: journal_entries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.journal_entries (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    company_id uuid NOT NULL,
    entry_date date NOT NULL,
    posted_at timestamp with time zone,
    description text NOT NULL,
    reference_number text,
    source text DEFAULT 'manual'::text NOT NULL,
    status text DEFAULT 'posted'::text NOT NULL,
    document_id uuid,
    created_by uuid,
    voided_by uuid,
    voided_at timestamp with time zone,
    void_reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    ai_reasoning text,
    ai_confidence numeric,
    cleared boolean DEFAULT false,
    cleared_at timestamp with time zone,
    reconciliation_id uuid,
    approval_status text,
    payment_status text,
    payment_method text,
    due_date date,
    deleted_at timestamp with time zone,
    deleted_by uuid,
    import_batch_id uuid,
    import_metadata jsonb,
    paid_at timestamp with time zone,
    payment_reference text,
    payment_notes text,
    approved_at timestamp with time zone,
    approved_by uuid,
    rejected_at timestamp with time zone,
    rejection_reason text,
    CONSTRAINT journal_entries_source_check CHECK ((source = ANY (ARRAY['manual'::text, 'bank_import'::text, 'universal_upload'::text, 'recurring'::text, 'opening_balance'::text, 'ar_invoice'::text, 'payroll'::text, 'api'::text, 'qbo_import'::text]))),
    CONSTRAINT journal_entries_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'posted'::text, 'void'::text])))
);


--
-- Name: journal_entry_lines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.journal_entry_lines (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    journal_entry_id uuid NOT NULL,
    company_id uuid NOT NULL,
    account_id uuid NOT NULL,
    debit numeric(15,2) DEFAULT 0 NOT NULL,
    credit numeric(15,2) DEFAULT 0 NOT NULL,
    memo text,
    contact_id uuid,
    project text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT debit_or_credit CHECK ((((debit > (0)::numeric) AND (credit = (0)::numeric)) OR ((credit > (0)::numeric) AND (debit = (0)::numeric)) OR ((debit = (0)::numeric) AND (credit = (0)::numeric)))),
    CONSTRAINT journal_entry_lines_credit_check CHECK ((credit >= (0)::numeric)),
    CONSTRAINT journal_entry_lines_debit_check CHECK ((debit >= (0)::numeric))
);


--
-- Name: monthly_reports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.monthly_reports (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    company_id uuid NOT NULL,
    period text NOT NULL,
    generated_at timestamp with time zone DEFAULT now(),
    data jsonb NOT NULL
);


--
-- Name: notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notifications (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    company_id uuid NOT NULL,
    type text NOT NULL,
    title text NOT NULL,
    description text,
    link_view text,
    read boolean DEFAULT false,
    dismissed boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: opening_balances; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.opening_balances (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    company_id uuid NOT NULL,
    account_id uuid NOT NULL,
    balance numeric(15,2) NOT NULL,
    as_of_date date NOT NULL,
    journal_entry_id uuid,
    posted boolean DEFAULT false NOT NULL,
    posted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: payroll_imports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payroll_imports (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    company_id uuid NOT NULL,
    source text NOT NULL,
    period_start date,
    period_end date,
    pay_date date,
    total_gross numeric(15,2),
    total_net numeric(15,2),
    total_employer_taxes numeric(15,2),
    journal_entry_id uuid,
    document_id uuid,
    employee_data jsonb,
    posted boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT payroll_imports_source_check CHECK ((source = ANY (ARRAY['gusto'::text, 'adp'::text, 'other'::text])))
);


--
-- Name: qbo_imports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.qbo_imports (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    company_id uuid NOT NULL,
    filename text,
    row_count integer DEFAULT 0,
    imported_count integer DEFAULT 0,
    skipped_count integer DEFAULT 0,
    failed_count integer DEFAULT 0,
    total_amount numeric DEFAULT 0,
    status text DEFAULT 'completed'::text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    undone_at timestamp with time zone
);


--
-- Name: rate_limit; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rate_limit (
    user_id uuid NOT NULL,
    bucket text NOT NULL,
    hour_bucket timestamp with time zone NOT NULL,
    count integer DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: reconciliation_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.reconciliation_items (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    reconciliation_id uuid NOT NULL,
    journal_entry_line_id uuid NOT NULL,
    cleared_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: reconciliations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.reconciliations (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    company_id uuid NOT NULL,
    bank_account_id uuid,
    statement_date date,
    statement_ending_balance numeric(15,2),
    status text DEFAULT 'open'::text NOT NULL,
    completed_by uuid,
    completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    account_id uuid,
    account_name text,
    period_start date,
    period_end date,
    statement_balance numeric,
    books_balance numeric,
    difference numeric,
    matched_transactions jsonb DEFAULT '[]'::jsonb,
    unmatched_bank jsonb DEFAULT '[]'::jsonb,
    unmatched_books jsonb DEFAULT '[]'::jsonb,
    added_during_reconciliation jsonb DEFAULT '[]'::jsonb,
    CONSTRAINT reconciliations_status_check CHECK ((status = ANY (ARRAY['open'::text, 'complete'::text])))
);


--
-- Name: recurring_transactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.recurring_transactions (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    company_id uuid NOT NULL,
    name text NOT NULL,
    description text,
    contact_id uuid,
    amount numeric(15,2) NOT NULL,
    debit_account_id uuid NOT NULL,
    credit_account_id uuid NOT NULL,
    project text,
    frequency text NOT NULL,
    next_date date NOT NULL,
    last_run_date date,
    active boolean DEFAULT true NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT recurring_transactions_frequency_check CHECK ((frequency = ANY (ARRAY['weekly'::text, 'monthly'::text, 'quarterly'::text, 'annual'::text])))
);


--
-- Name: subscriptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.subscriptions (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    company_id uuid NOT NULL,
    stripe_customer_id text,
    stripe_subscription_id text,
    plan text DEFAULT 'trial'::text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    trial_ends_at timestamp with time zone,
    current_period_start timestamp with time zone,
    current_period_end timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT subscriptions_plan_check CHECK ((plan = ANY (ARRAY['trial'::text, 'starter'::text, 'pro'::text, 'enterprise'::text]))),
    CONSTRAINT subscriptions_status_check CHECK ((status = ANY (ARRAY['active'::text, 'past_due'::text, 'canceled'::text, 'trialing'::text])))
);


--
-- Name: tax_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tax_settings (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    company_id uuid NOT NULL,
    tax_year integer NOT NULL,
    estimated_payments_made numeric DEFAULT 0,
    work_from_home boolean DEFAULT false,
    filed_deadlines jsonb DEFAULT '[]'::jsonb,
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: trial_balance; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.trial_balance AS
 SELECT je.company_id,
    a.code AS account_code,
    a.name AS account_name,
    a.category,
    sum(jel.debit) AS total_debits,
    sum(jel.credit) AS total_credits,
    (sum(jel.debit) - sum(jel.credit)) AS net_balance
   FROM ((public.journal_entry_lines jel
     JOIN public.journal_entries je ON ((je.id = jel.journal_entry_id)))
     JOIN public.accounts a ON ((a.id = jel.account_id)))
  WHERE (je.status = 'posted'::text)
  GROUP BY je.company_id, a.code, a.name, a.category;


--
-- Name: unknown_documents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.unknown_documents (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    company_id uuid NOT NULL,
    document_id uuid NOT NULL,
    document_type_detected text,
    ai_explanation text,
    entry_needed boolean DEFAULT false NOT NULL,
    entry_summary text,
    proposed_journal_entry jsonb,
    watch_for jsonb DEFAULT '[]'::jsonb NOT NULL,
    watch_matches jsonb DEFAULT '[]'::jsonb NOT NULL,
    posted boolean DEFAULT false NOT NULL,
    dismissed boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: upload_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.upload_log (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    company_id uuid NOT NULL,
    uploaded_by uuid,
    file_name text NOT NULL,
    file_size_bytes bigint,
    file_type text,
    doc_type text,
    status text DEFAULT 'processing'::text NOT NULL,
    result jsonb,
    error text,
    document_id uuid,
    created_at timestamp with time zone DEFAULT now(),
    completed_at timestamp with time zone
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id uuid NOT NULL,
    email text NOT NULL,
    full_name text,
    avatar_url text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: vendor_rules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vendor_rules (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    company_id uuid NOT NULL,
    contact_id uuid NOT NULL,
    account_id uuid NOT NULL,
    project text,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: accounts accounts_company_id_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accounts
    ADD CONSTRAINT accounts_company_id_code_key UNIQUE (company_id, code);


--
-- Name: accounts accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accounts
    ADD CONSTRAINT accounts_pkey PRIMARY KEY (id);


--
-- Name: ap_invoices ap_invoices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ap_invoices
    ADD CONSTRAINT ap_invoices_pkey PRIMARY KEY (id);


--
-- Name: ar_invoice_lines ar_invoice_lines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ar_invoice_lines
    ADD CONSTRAINT ar_invoice_lines_pkey PRIMARY KEY (id);


--
-- Name: ar_invoices ar_invoices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ar_invoices
    ADD CONSTRAINT ar_invoices_pkey PRIMARY KEY (id);


--
-- Name: audit_log audit_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_log
    ADD CONSTRAINT audit_log_pkey PRIMARY KEY (id);


--
-- Name: bank_accounts bank_accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bank_accounts
    ADD CONSTRAINT bank_accounts_pkey PRIMARY KEY (id);


--
-- Name: chat_messages chat_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_messages
    ADD CONSTRAINT chat_messages_pkey PRIMARY KEY (id);


--
-- Name: client_ai_profile client_ai_profile_company_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_ai_profile
    ADD CONSTRAINT client_ai_profile_company_id_key UNIQUE (company_id);


--
-- Name: client_ai_profile client_ai_profile_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_ai_profile
    ADD CONSTRAINT client_ai_profile_pkey PRIMARY KEY (id);


--
-- Name: companies companies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.companies
    ADD CONSTRAINT companies_pkey PRIMARY KEY (id);


--
-- Name: company_invites company_invites_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.company_invites
    ADD CONSTRAINT company_invites_pkey PRIMARY KEY (id);


--
-- Name: company_invites company_invites_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.company_invites
    ADD CONSTRAINT company_invites_token_key UNIQUE (token);


--
-- Name: company_users company_users_company_id_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.company_users
    ADD CONSTRAINT company_users_company_id_user_id_key UNIQUE (company_id, user_id);


--
-- Name: company_users company_users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.company_users
    ADD CONSTRAINT company_users_pkey PRIMARY KEY (id);


--
-- Name: contacts contacts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contacts
    ADD CONSTRAINT contacts_pkey PRIMARY KEY (id);


--
-- Name: contracts contracts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contracts
    ADD CONSTRAINT contracts_pkey PRIMARY KEY (id);


--
-- Name: default_chart_of_accounts default_chart_of_accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.default_chart_of_accounts
    ADD CONSTRAINT default_chart_of_accounts_pkey PRIMARY KEY (code);


--
-- Name: documents documents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_pkey PRIMARY KEY (id);


--
-- Name: journal_entries journal_entries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.journal_entries
    ADD CONSTRAINT journal_entries_pkey PRIMARY KEY (id);


--
-- Name: journal_entry_lines journal_entry_lines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.journal_entry_lines
    ADD CONSTRAINT journal_entry_lines_pkey PRIMARY KEY (id);


--
-- Name: monthly_reports monthly_reports_company_id_period_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.monthly_reports
    ADD CONSTRAINT monthly_reports_company_id_period_key UNIQUE (company_id, period);


--
-- Name: monthly_reports monthly_reports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.monthly_reports
    ADD CONSTRAINT monthly_reports_pkey PRIMARY KEY (id);


--
-- Name: notifications notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);


--
-- Name: opening_balances opening_balances_company_id_account_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.opening_balances
    ADD CONSTRAINT opening_balances_company_id_account_id_key UNIQUE (company_id, account_id);


--
-- Name: opening_balances opening_balances_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.opening_balances
    ADD CONSTRAINT opening_balances_pkey PRIMARY KEY (id);


--
-- Name: payroll_imports payroll_imports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_imports
    ADD CONSTRAINT payroll_imports_pkey PRIMARY KEY (id);


--
-- Name: qbo_imports qbo_imports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.qbo_imports
    ADD CONSTRAINT qbo_imports_pkey PRIMARY KEY (id);


--
-- Name: rate_limit rate_limit_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rate_limit
    ADD CONSTRAINT rate_limit_pkey PRIMARY KEY (user_id, bucket, hour_bucket);


--
-- Name: reconciliation_items reconciliation_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reconciliation_items
    ADD CONSTRAINT reconciliation_items_pkey PRIMARY KEY (id);


--
-- Name: reconciliation_items reconciliation_items_reconciliation_id_journal_entry_line_i_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reconciliation_items
    ADD CONSTRAINT reconciliation_items_reconciliation_id_journal_entry_line_i_key UNIQUE (reconciliation_id, journal_entry_line_id);


--
-- Name: reconciliations reconciliations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reconciliations
    ADD CONSTRAINT reconciliations_pkey PRIMARY KEY (id);


--
-- Name: recurring_transactions recurring_transactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recurring_transactions
    ADD CONSTRAINT recurring_transactions_pkey PRIMARY KEY (id);


--
-- Name: subscriptions subscriptions_company_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_company_id_key UNIQUE (company_id);


--
-- Name: subscriptions subscriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_pkey PRIMARY KEY (id);


--
-- Name: tax_settings tax_settings_company_id_tax_year_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tax_settings
    ADD CONSTRAINT tax_settings_company_id_tax_year_key UNIQUE (company_id, tax_year);


--
-- Name: tax_settings tax_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tax_settings
    ADD CONSTRAINT tax_settings_pkey PRIMARY KEY (id);


--
-- Name: unknown_documents unknown_documents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.unknown_documents
    ADD CONSTRAINT unknown_documents_pkey PRIMARY KEY (id);


--
-- Name: upload_log upload_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.upload_log
    ADD CONSTRAINT upload_log_pkey PRIMARY KEY (id);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: vendor_rules vendor_rules_company_id_contact_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendor_rules
    ADD CONSTRAINT vendor_rules_company_id_contact_id_key UNIQUE (company_id, contact_id);


--
-- Name: vendor_rules vendor_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendor_rules
    ADD CONSTRAINT vendor_rules_pkey PRIMARY KEY (id);


--
-- Name: accounts_company_system_role_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX accounts_company_system_role_uq ON public.accounts USING btree (company_id, system_role) WHERE (system_role IS NOT NULL);


--
-- Name: chat_messages_company_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX chat_messages_company_idx ON public.chat_messages USING btree (company_id, created_at);


--
-- Name: client_ai_profile_company_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX client_ai_profile_company_idx ON public.client_ai_profile USING btree (company_id);


--
-- Name: company_invites_company_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX company_invites_company_idx ON public.company_invites USING btree (company_id, status);


--
-- Name: contacts_company_name_key_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX contacts_company_name_key_uq ON public.contacts USING btree (company_id, name_key) WHERE (name_key <> ''::text);


--
-- Name: documents_company_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX documents_company_id_idx ON public.documents USING btree (company_id);


--
-- Name: idx_accounts_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_accounts_code ON public.accounts USING btree (company_id, code);


--
-- Name: idx_accounts_company; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_accounts_company ON public.accounts USING btree (company_id);


--
-- Name: idx_ap_company; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ap_company ON public.ap_invoices USING btree (company_id);


--
-- Name: idx_ap_due; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ap_due ON public.ap_invoices USING btree (company_id, due_date);


--
-- Name: idx_ap_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ap_status ON public.ap_invoices USING btree (company_id, status);


--
-- Name: idx_ap_vendor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ap_vendor ON public.ap_invoices USING btree (company_id, vendor_id);


--
-- Name: idx_ar_company; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ar_company ON public.ar_invoices USING btree (company_id);


--
-- Name: idx_ar_customer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ar_customer ON public.ar_invoices USING btree (company_id, customer_id);


--
-- Name: idx_ar_due; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ar_due ON public.ar_invoices USING btree (company_id, due_date);


--
-- Name: idx_ar_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ar_status ON public.ar_invoices USING btree (company_id, status);


--
-- Name: idx_arl_company; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_arl_company ON public.ar_invoice_lines USING btree (company_id);


--
-- Name: idx_arl_invoice; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_arl_invoice ON public.ar_invoice_lines USING btree (ar_invoice_id);


--
-- Name: idx_audit_action; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_action ON public.audit_log USING btree (company_id, action);


--
-- Name: idx_audit_company; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_company ON public.audit_log USING btree (company_id);


--
-- Name: idx_audit_log_performed_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_log_performed_by ON public.audit_log USING btree (company_id, performed_by, created_at DESC);


--
-- Name: idx_audit_ts; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_ts ON public.audit_log USING btree (company_id, created_at DESC);


--
-- Name: idx_audit_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_user ON public.audit_log USING btree (company_id, user_id);


--
-- Name: idx_bank_accounts_company; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bank_accounts_company ON public.bank_accounts USING btree (company_id);


--
-- Name: idx_company_users_company; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_company_users_company ON public.company_users USING btree (company_id);


--
-- Name: idx_company_users_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_company_users_user ON public.company_users USING btree (user_id);


--
-- Name: idx_contacts_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contacts_active ON public.contacts USING btree (company_id) WHERE (deleted_at IS NULL);


--
-- Name: idx_contacts_company; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contacts_company ON public.contacts USING btree (company_id);


--
-- Name: idx_contacts_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contacts_name ON public.contacts USING gin (name public.gin_trgm_ops);


--
-- Name: idx_contacts_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contacts_type ON public.contacts USING btree (company_id, type);


--
-- Name: idx_contracts_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contracts_active ON public.contracts USING btree (company_id) WHERE (deleted_at IS NULL);


--
-- Name: idx_documents_company; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_documents_company ON public.documents USING btree (company_id);


--
-- Name: idx_documents_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_documents_type ON public.documents USING btree (company_id, document_type);


--
-- Name: idx_je_company; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_je_company ON public.journal_entries USING btree (company_id);


--
-- Name: idx_je_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_je_date ON public.journal_entries USING btree (company_id, entry_date);


--
-- Name: idx_je_source; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_je_source ON public.journal_entries USING btree (company_id, source);


--
-- Name: idx_je_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_je_status ON public.journal_entries USING btree (company_id, status);


--
-- Name: idx_jel_account; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_jel_account ON public.journal_entry_lines USING btree (company_id, account_id);


--
-- Name: idx_jel_company; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_jel_company ON public.journal_entry_lines USING btree (company_id);


--
-- Name: idx_jel_contact; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_jel_contact ON public.journal_entry_lines USING btree (company_id, contact_id);


--
-- Name: idx_jel_entry; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_jel_entry ON public.journal_entry_lines USING btree (journal_entry_id);


--
-- Name: idx_journal_entries_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_journal_entries_active ON public.journal_entries USING btree (company_id) WHERE (deleted_at IS NULL);


--
-- Name: idx_ob_company; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ob_company ON public.opening_balances USING btree (company_id);


--
-- Name: idx_payroll_company; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payroll_company ON public.payroll_imports USING btree (company_id);


--
-- Name: idx_recon_account; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_recon_account ON public.reconciliations USING btree (bank_account_id);


--
-- Name: idx_recon_company; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_recon_company ON public.reconciliations USING btree (company_id);


--
-- Name: idx_recon_items_recon; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_recon_items_recon ON public.reconciliation_items USING btree (reconciliation_id);


--
-- Name: idx_recurring_company; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_recurring_company ON public.recurring_transactions USING btree (company_id);


--
-- Name: idx_recurring_next_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_recurring_next_date ON public.recurring_transactions USING btree (company_id, next_date) WHERE (active = true);


--
-- Name: idx_unknown_company; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_unknown_company ON public.unknown_documents USING btree (company_id);


--
-- Name: idx_unknown_review; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_unknown_review ON public.unknown_documents USING btree (company_id, posted, dismissed);


--
-- Name: idx_vendor_rules_company; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vendor_rules_company ON public.vendor_rules USING btree (company_id);


--
-- Name: journal_entries_import_batch_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX journal_entries_import_batch_idx ON public.journal_entries USING btree (import_batch_id) WHERE (import_batch_id IS NOT NULL);


--
-- Name: journal_entries_reconciliation_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX journal_entries_reconciliation_idx ON public.journal_entries USING btree (reconciliation_id);


--
-- Name: monthly_reports_company_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX monthly_reports_company_idx ON public.monthly_reports USING btree (company_id, period DESC);


--
-- Name: notifications_company_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX notifications_company_created_idx ON public.notifications USING btree (company_id, created_at DESC);


--
-- Name: notifications_dedup_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX notifications_dedup_idx ON public.notifications USING btree (company_id, type, created_at DESC);


--
-- Name: qbo_imports_company_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX qbo_imports_company_idx ON public.qbo_imports USING btree (company_id, created_at DESC);


--
-- Name: rate_limit_hour_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX rate_limit_hour_idx ON public.rate_limit USING btree (hour_bucket);


--
-- Name: reconciliations_company_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX reconciliations_company_idx ON public.reconciliations USING btree (company_id, status);


--
-- Name: tax_settings_company_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tax_settings_company_idx ON public.tax_settings USING btree (company_id, tax_year);


--
-- Name: upload_log_company_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX upload_log_company_created_idx ON public.upload_log USING btree (company_id, created_at DESC);


--
-- Name: upload_log_company_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX upload_log_company_id_idx ON public.upload_log USING btree (company_id);


--
-- Name: audit_log audit_log_no_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER audit_log_no_delete BEFORE DELETE ON public.audit_log FOR EACH ROW EXECUTE FUNCTION public.audit_log_immutable();


--
-- Name: audit_log audit_log_no_update; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER audit_log_no_update BEFORE UPDATE ON public.audit_log FOR EACH ROW EXECUTE FUNCTION public.audit_log_immutable();


--
-- Name: accounts set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.accounts FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: ap_invoices set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.ap_invoices FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: ar_invoices set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.ar_invoices FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: bank_accounts set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.bank_accounts FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: companies set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.companies FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: contacts set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.contacts FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: journal_entries set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.journal_entries FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: recurring_transactions set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.recurring_transactions FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: subscriptions set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.subscriptions FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: users set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: vendor_rules set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.vendor_rules FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: tax_settings trg_tax_settings_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_tax_settings_updated_at BEFORE UPDATE ON public.tax_settings FOR EACH ROW EXECUTE FUNCTION public.touch_tax_settings_updated_at();


--
-- Name: accounts accounts_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accounts
    ADD CONSTRAINT accounts_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: ap_invoices ap_invoices_approved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ap_invoices
    ADD CONSTRAINT ap_invoices_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.users(id);


--
-- Name: ap_invoices ap_invoices_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ap_invoices
    ADD CONSTRAINT ap_invoices_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: ap_invoices ap_invoices_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ap_invoices
    ADD CONSTRAINT ap_invoices_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.documents(id);


--
-- Name: ap_invoices ap_invoices_is_duplicate_of_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ap_invoices
    ADD CONSTRAINT ap_invoices_is_duplicate_of_fkey FOREIGN KEY (is_duplicate_of) REFERENCES public.ap_invoices(id);


--
-- Name: ap_invoices ap_invoices_journal_entry_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ap_invoices
    ADD CONSTRAINT ap_invoices_journal_entry_id_fkey FOREIGN KEY (journal_entry_id) REFERENCES public.journal_entries(id);


--
-- Name: ap_invoices ap_invoices_vendor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ap_invoices
    ADD CONSTRAINT ap_invoices_vendor_id_fkey FOREIGN KEY (vendor_id) REFERENCES public.contacts(id);


--
-- Name: ar_invoice_lines ar_invoice_lines_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ar_invoice_lines
    ADD CONSTRAINT ar_invoice_lines_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id);


--
-- Name: ar_invoice_lines ar_invoice_lines_ar_invoice_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ar_invoice_lines
    ADD CONSTRAINT ar_invoice_lines_ar_invoice_id_fkey FOREIGN KEY (ar_invoice_id) REFERENCES public.ar_invoices(id) ON DELETE CASCADE;


--
-- Name: ar_invoice_lines ar_invoice_lines_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ar_invoice_lines
    ADD CONSTRAINT ar_invoice_lines_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: ar_invoices ar_invoices_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ar_invoices
    ADD CONSTRAINT ar_invoices_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: ar_invoices ar_invoices_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ar_invoices
    ADD CONSTRAINT ar_invoices_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: ar_invoices ar_invoices_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ar_invoices
    ADD CONSTRAINT ar_invoices_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.contacts(id);


--
-- Name: ar_invoices ar_invoices_journal_entry_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ar_invoices
    ADD CONSTRAINT ar_invoices_journal_entry_id_fkey FOREIGN KEY (journal_entry_id) REFERENCES public.journal_entries(id);


--
-- Name: audit_log audit_log_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_log
    ADD CONSTRAINT audit_log_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: audit_log audit_log_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_log
    ADD CONSTRAINT audit_log_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: bank_accounts bank_accounts_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bank_accounts
    ADD CONSTRAINT bank_accounts_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: bank_accounts bank_accounts_gl_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bank_accounts
    ADD CONSTRAINT bank_accounts_gl_account_id_fkey FOREIGN KEY (gl_account_id) REFERENCES public.accounts(id);


--
-- Name: chat_messages chat_messages_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_messages
    ADD CONSTRAINT chat_messages_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: client_ai_profile client_ai_profile_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_ai_profile
    ADD CONSTRAINT client_ai_profile_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: company_invites company_invites_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.company_invites
    ADD CONSTRAINT company_invites_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: company_users company_users_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.company_users
    ADD CONSTRAINT company_users_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: company_users company_users_invited_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.company_users
    ADD CONSTRAINT company_users_invited_by_fkey FOREIGN KEY (invited_by) REFERENCES public.users(id);


--
-- Name: company_users company_users_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.company_users
    ADD CONSTRAINT company_users_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: contacts contacts_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contacts
    ADD CONSTRAINT contacts_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: contacts contacts_default_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contacts
    ADD CONSTRAINT contacts_default_account_id_fkey FOREIGN KEY (default_account_id) REFERENCES public.accounts(id);


--
-- Name: contracts contracts_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contracts
    ADD CONSTRAINT contracts_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: documents documents_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: documents documents_uploaded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES public.users(id);


--
-- Name: journal_entries journal_entries_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.journal_entries
    ADD CONSTRAINT journal_entries_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: journal_entries journal_entries_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.journal_entries
    ADD CONSTRAINT journal_entries_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: journal_entries journal_entries_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.journal_entries
    ADD CONSTRAINT journal_entries_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.documents(id);


--
-- Name: journal_entries journal_entries_reconciliation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.journal_entries
    ADD CONSTRAINT journal_entries_reconciliation_id_fkey FOREIGN KEY (reconciliation_id) REFERENCES public.reconciliations(id) ON DELETE SET NULL;


--
-- Name: journal_entries journal_entries_voided_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.journal_entries
    ADD CONSTRAINT journal_entries_voided_by_fkey FOREIGN KEY (voided_by) REFERENCES public.users(id);


--
-- Name: journal_entry_lines journal_entry_lines_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.journal_entry_lines
    ADD CONSTRAINT journal_entry_lines_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id);


--
-- Name: journal_entry_lines journal_entry_lines_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.journal_entry_lines
    ADD CONSTRAINT journal_entry_lines_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: journal_entry_lines journal_entry_lines_contact_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.journal_entry_lines
    ADD CONSTRAINT journal_entry_lines_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES public.contacts(id);


--
-- Name: journal_entry_lines journal_entry_lines_journal_entry_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.journal_entry_lines
    ADD CONSTRAINT journal_entry_lines_journal_entry_id_fkey FOREIGN KEY (journal_entry_id) REFERENCES public.journal_entries(id) ON DELETE CASCADE;


--
-- Name: monthly_reports monthly_reports_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.monthly_reports
    ADD CONSTRAINT monthly_reports_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: notifications notifications_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: opening_balances opening_balances_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.opening_balances
    ADD CONSTRAINT opening_balances_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id);


--
-- Name: opening_balances opening_balances_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.opening_balances
    ADD CONSTRAINT opening_balances_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: opening_balances opening_balances_journal_entry_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.opening_balances
    ADD CONSTRAINT opening_balances_journal_entry_id_fkey FOREIGN KEY (journal_entry_id) REFERENCES public.journal_entries(id);


--
-- Name: payroll_imports payroll_imports_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_imports
    ADD CONSTRAINT payroll_imports_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: payroll_imports payroll_imports_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_imports
    ADD CONSTRAINT payroll_imports_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.documents(id);


--
-- Name: payroll_imports payroll_imports_journal_entry_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_imports
    ADD CONSTRAINT payroll_imports_journal_entry_id_fkey FOREIGN KEY (journal_entry_id) REFERENCES public.journal_entries(id);


--
-- Name: qbo_imports qbo_imports_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.qbo_imports
    ADD CONSTRAINT qbo_imports_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: reconciliation_items reconciliation_items_journal_entry_line_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reconciliation_items
    ADD CONSTRAINT reconciliation_items_journal_entry_line_id_fkey FOREIGN KEY (journal_entry_line_id) REFERENCES public.journal_entry_lines(id);


--
-- Name: reconciliation_items reconciliation_items_reconciliation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reconciliation_items
    ADD CONSTRAINT reconciliation_items_reconciliation_id_fkey FOREIGN KEY (reconciliation_id) REFERENCES public.reconciliations(id) ON DELETE CASCADE;


--
-- Name: reconciliations reconciliations_bank_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reconciliations
    ADD CONSTRAINT reconciliations_bank_account_id_fkey FOREIGN KEY (bank_account_id) REFERENCES public.bank_accounts(id);


--
-- Name: reconciliations reconciliations_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reconciliations
    ADD CONSTRAINT reconciliations_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: reconciliations reconciliations_completed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reconciliations
    ADD CONSTRAINT reconciliations_completed_by_fkey FOREIGN KEY (completed_by) REFERENCES public.users(id);


--
-- Name: recurring_transactions recurring_transactions_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recurring_transactions
    ADD CONSTRAINT recurring_transactions_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: recurring_transactions recurring_transactions_contact_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recurring_transactions
    ADD CONSTRAINT recurring_transactions_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES public.contacts(id);


--
-- Name: recurring_transactions recurring_transactions_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recurring_transactions
    ADD CONSTRAINT recurring_transactions_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: recurring_transactions recurring_transactions_credit_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recurring_transactions
    ADD CONSTRAINT recurring_transactions_credit_account_id_fkey FOREIGN KEY (credit_account_id) REFERENCES public.accounts(id);


--
-- Name: recurring_transactions recurring_transactions_debit_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recurring_transactions
    ADD CONSTRAINT recurring_transactions_debit_account_id_fkey FOREIGN KEY (debit_account_id) REFERENCES public.accounts(id);


--
-- Name: subscriptions subscriptions_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: tax_settings tax_settings_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tax_settings
    ADD CONSTRAINT tax_settings_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: unknown_documents unknown_documents_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.unknown_documents
    ADD CONSTRAINT unknown_documents_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: unknown_documents unknown_documents_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.unknown_documents
    ADD CONSTRAINT unknown_documents_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.documents(id);


--
-- Name: upload_log upload_log_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.upload_log
    ADD CONSTRAINT upload_log_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: upload_log upload_log_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.upload_log
    ADD CONSTRAINT upload_log_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.documents(id) ON DELETE SET NULL;


--
-- Name: users users_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: vendor_rules vendor_rules_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendor_rules
    ADD CONSTRAINT vendor_rules_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id);


--
-- Name: vendor_rules vendor_rules_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendor_rules
    ADD CONSTRAINT vendor_rules_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: vendor_rules vendor_rules_contact_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendor_rules
    ADD CONSTRAINT vendor_rules_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE CASCADE;


--
-- Name: accounts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;

--
-- Name: accounts accounts_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY accounts_delete ON public.accounts FOR DELETE TO authenticated USING (public.is_company_member(company_id));


--
-- Name: accounts accounts_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY accounts_insert ON public.accounts FOR INSERT TO authenticated WITH CHECK (public.is_company_member(company_id));


--
-- Name: accounts accounts_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY accounts_select ON public.accounts FOR SELECT TO authenticated USING (public.is_company_member(company_id));


--
-- Name: accounts accounts_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY accounts_update ON public.accounts FOR UPDATE TO authenticated USING (public.is_company_member(company_id)) WITH CHECK (public.is_company_member(company_id));


--
-- Name: ap_invoices ap_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ap_insert ON public.ap_invoices FOR INSERT WITH CHECK (((company_id = ANY (public.auth_company_ids())) AND (public.auth_company_role(company_id) = ANY (ARRAY['owner'::text, 'admin'::text, 'accountant'::text]))));


--
-- Name: ap_invoices ap_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ap_select ON public.ap_invoices FOR SELECT USING ((company_id = ANY (public.auth_company_ids())));


--
-- Name: ap_invoices ap_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ap_update ON public.ap_invoices FOR UPDATE USING (((company_id = ANY (public.auth_company_ids())) AND (public.auth_company_role(company_id) = ANY (ARRAY['owner'::text, 'admin'::text, 'accountant'::text]))));


--
-- Name: ar_invoices ar_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ar_insert ON public.ar_invoices FOR INSERT WITH CHECK (((company_id = ANY (public.auth_company_ids())) AND (public.auth_company_role(company_id) = ANY (ARRAY['owner'::text, 'admin'::text, 'accountant'::text]))));


--
-- Name: ar_invoice_lines; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ar_invoice_lines ENABLE ROW LEVEL SECURITY;

--
-- Name: ar_invoice_lines ar_invoice_lines_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ar_invoice_lines_delete ON public.ar_invoice_lines FOR DELETE TO authenticated USING (public.is_company_member(company_id));


--
-- Name: ar_invoice_lines ar_invoice_lines_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ar_invoice_lines_insert ON public.ar_invoice_lines FOR INSERT TO authenticated WITH CHECK (public.is_company_member(company_id));


--
-- Name: ar_invoice_lines ar_invoice_lines_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ar_invoice_lines_select ON public.ar_invoice_lines FOR SELECT TO authenticated USING (public.is_company_member(company_id));


--
-- Name: ar_invoice_lines ar_invoice_lines_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ar_invoice_lines_update ON public.ar_invoice_lines FOR UPDATE TO authenticated USING (public.is_company_member(company_id)) WITH CHECK (public.is_company_member(company_id));


--
-- Name: ar_invoices; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ar_invoices ENABLE ROW LEVEL SECURITY;

--
-- Name: ar_invoices ar_invoices_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ar_invoices_delete ON public.ar_invoices FOR DELETE TO authenticated USING (public.is_company_member(company_id));


--
-- Name: ar_invoices ar_invoices_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ar_invoices_insert ON public.ar_invoices FOR INSERT TO authenticated WITH CHECK (public.is_company_member(company_id));


--
-- Name: ar_invoices ar_invoices_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ar_invoices_select ON public.ar_invoices FOR SELECT TO authenticated USING (public.is_company_member(company_id));


--
-- Name: ar_invoices ar_invoices_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ar_invoices_update ON public.ar_invoices FOR UPDATE TO authenticated USING (public.is_company_member(company_id)) WITH CHECK (public.is_company_member(company_id));


--
-- Name: ar_invoices ar_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ar_select ON public.ar_invoices FOR SELECT USING ((company_id = ANY (public.auth_company_ids())));


--
-- Name: ar_invoices ar_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ar_update ON public.ar_invoices FOR UPDATE USING (((company_id = ANY (public.auth_company_ids())) AND (public.auth_company_role(company_id) = ANY (ARRAY['owner'::text, 'admin'::text, 'accountant'::text]))));


--
-- Name: ar_invoice_lines arl_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY arl_delete ON public.ar_invoice_lines FOR DELETE USING (((company_id = ANY (public.auth_company_ids())) AND (public.auth_company_role(company_id) = ANY (ARRAY['owner'::text, 'admin'::text, 'accountant'::text])) AND (( SELECT ar_invoices.status
   FROM public.ar_invoices
  WHERE (ar_invoices.id = ar_invoice_lines.ar_invoice_id)) = 'draft'::text)));


--
-- Name: ar_invoice_lines arl_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY arl_insert ON public.ar_invoice_lines FOR INSERT WITH CHECK (((company_id = ANY (public.auth_company_ids())) AND (public.auth_company_role(company_id) = ANY (ARRAY['owner'::text, 'admin'::text, 'accountant'::text]))));


--
-- Name: ar_invoice_lines arl_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY arl_select ON public.ar_invoice_lines FOR SELECT USING ((company_id = ANY (public.auth_company_ids())));


--
-- Name: ar_invoice_lines arl_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY arl_update ON public.ar_invoice_lines FOR UPDATE USING (((company_id = ANY (public.auth_company_ids())) AND (public.auth_company_role(company_id) = ANY (ARRAY['owner'::text, 'admin'::text, 'accountant'::text])) AND (( SELECT ar_invoices.status
   FROM public.ar_invoices
  WHERE (ar_invoices.id = ar_invoice_lines.ar_invoice_id)) = 'draft'::text)));


--
-- Name: audit_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

--
-- Name: audit_log audit_log_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY audit_log_delete ON public.audit_log FOR DELETE TO authenticated USING (public.is_company_member(company_id));


--
-- Name: audit_log audit_log_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY audit_log_insert ON public.audit_log FOR INSERT TO authenticated WITH CHECK (public.is_company_member(company_id));


--
-- Name: audit_log audit_log_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY audit_log_select ON public.audit_log FOR SELECT TO authenticated USING (public.is_company_member(company_id));


--
-- Name: audit_log audit_log_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY audit_log_update ON public.audit_log FOR UPDATE TO authenticated USING (public.is_company_member(company_id)) WITH CHECK (public.is_company_member(company_id));


--
-- Name: audit_log audit_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY audit_select ON public.audit_log FOR SELECT USING ((company_id = ANY (public.auth_company_ids())));


--
-- Name: bank_accounts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.bank_accounts ENABLE ROW LEVEL SECURITY;

--
-- Name: bank_accounts bank_accounts_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY bank_accounts_delete ON public.bank_accounts FOR DELETE TO authenticated USING (public.is_company_member(company_id));


--
-- Name: bank_accounts bank_accounts_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY bank_accounts_insert ON public.bank_accounts FOR INSERT TO authenticated WITH CHECK (public.is_company_member(company_id));


--
-- Name: bank_accounts bank_accounts_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY bank_accounts_select ON public.bank_accounts FOR SELECT TO authenticated USING (public.is_company_member(company_id));


--
-- Name: bank_accounts bank_accounts_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY bank_accounts_update ON public.bank_accounts FOR UPDATE TO authenticated USING (public.is_company_member(company_id)) WITH CHECK (public.is_company_member(company_id));


--
-- Name: chat_messages; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;

--
-- Name: chat_messages chat_messages_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY chat_messages_delete ON public.chat_messages FOR DELETE TO authenticated USING (public.is_company_member(company_id));


--
-- Name: chat_messages chat_messages_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY chat_messages_insert ON public.chat_messages FOR INSERT TO authenticated WITH CHECK (public.is_company_member(company_id));


--
-- Name: chat_messages chat_messages_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY chat_messages_select ON public.chat_messages FOR SELECT TO authenticated USING (public.is_company_member(company_id));


--
-- Name: chat_messages chat_messages_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY chat_messages_update ON public.chat_messages FOR UPDATE TO authenticated USING (public.is_company_member(company_id)) WITH CHECK (public.is_company_member(company_id));


--
-- Name: client_ai_profile; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.client_ai_profile ENABLE ROW LEVEL SECURITY;

--
-- Name: client_ai_profile client_ai_profile_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY client_ai_profile_delete ON public.client_ai_profile FOR DELETE TO authenticated USING (public.is_company_member(company_id));


--
-- Name: client_ai_profile client_ai_profile_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY client_ai_profile_insert ON public.client_ai_profile FOR INSERT TO authenticated WITH CHECK (public.is_company_member(company_id));


--
-- Name: client_ai_profile client_ai_profile_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY client_ai_profile_select ON public.client_ai_profile FOR SELECT TO authenticated USING (public.is_company_member(company_id));


--
-- Name: client_ai_profile client_ai_profile_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY client_ai_profile_update ON public.client_ai_profile FOR UPDATE TO authenticated USING (public.is_company_member(company_id)) WITH CHECK (public.is_company_member(company_id));


--
-- Name: companies; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;

--
-- Name: companies companies_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY companies_delete ON public.companies FOR DELETE TO authenticated USING (public.is_company_admin(id));


--
-- Name: companies companies_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY companies_insert ON public.companies FOR INSERT WITH CHECK (true);


--
-- Name: companies companies_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY companies_select ON public.companies FOR SELECT TO authenticated USING (public.is_company_member(id));


--
-- Name: companies companies_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY companies_update ON public.companies FOR UPDATE TO authenticated USING (public.is_company_admin(id)) WITH CHECK (public.is_company_admin(id));


--
-- Name: company_invites; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.company_invites ENABLE ROW LEVEL SECURITY;

--
-- Name: company_invites company_invites_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY company_invites_delete ON public.company_invites FOR DELETE TO authenticated USING (public.is_company_owner(company_id));


--
-- Name: company_invites company_invites_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY company_invites_insert ON public.company_invites FOR INSERT TO authenticated WITH CHECK ((public.is_company_owner(company_id) AND (invited_by = auth.uid())));


--
-- Name: company_invites company_invites_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY company_invites_select ON public.company_invites FOR SELECT TO authenticated USING (public.is_company_owner(company_id));


--
-- Name: company_users; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.company_users ENABLE ROW LEVEL SECURITY;

--
-- Name: company_users company_users_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY company_users_delete ON public.company_users FOR DELETE TO authenticated USING (((user_id = auth.uid()) OR public.is_company_admin(company_id)));


--
-- Name: company_users company_users_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY company_users_insert ON public.company_users FOR INSERT TO authenticated WITH CHECK (((user_id = auth.uid()) OR public.is_company_admin(company_id)));


--
-- Name: company_users company_users_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY company_users_select ON public.company_users FOR SELECT TO authenticated USING (((user_id = auth.uid()) OR public.is_company_admin(company_id)));


--
-- Name: company_users company_users_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY company_users_update ON public.company_users FOR UPDATE TO authenticated USING (((user_id = auth.uid()) OR public.is_company_admin(company_id))) WITH CHECK (((user_id = auth.uid()) OR public.is_company_admin(company_id)));


--
-- Name: contacts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;

--
-- Name: contacts contacts_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY contacts_insert ON public.contacts FOR INSERT TO authenticated WITH CHECK (public.is_company_member(company_id));


--
-- Name: contacts contacts_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY contacts_select ON public.contacts FOR SELECT TO authenticated USING (public.is_company_member(company_id));


--
-- Name: contacts contacts_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY contacts_update ON public.contacts FOR UPDATE TO authenticated USING (public.is_company_member(company_id)) WITH CHECK (public.is_company_member(company_id));


--
-- Name: contracts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.contracts ENABLE ROW LEVEL SECURITY;

--
-- Name: contracts contracts_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY contracts_insert ON public.contracts FOR INSERT TO authenticated WITH CHECK (public.is_company_member(company_id));


--
-- Name: contracts contracts_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY contracts_select ON public.contracts FOR SELECT TO authenticated USING (public.is_company_member(company_id));


--
-- Name: contracts contracts_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY contracts_update ON public.contracts FOR UPDATE TO authenticated USING (public.is_company_member(company_id)) WITH CHECK (public.is_company_member(company_id));


--
-- Name: default_chart_of_accounts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.default_chart_of_accounts ENABLE ROW LEVEL SECURITY;

--
-- Name: documents; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;

--
-- Name: documents documents_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY documents_delete ON public.documents FOR DELETE TO authenticated USING (public.is_company_member(company_id));


--
-- Name: documents documents_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY documents_insert ON public.documents FOR INSERT TO authenticated WITH CHECK (public.is_company_member(company_id));


--
-- Name: documents documents_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY documents_select ON public.documents FOR SELECT TO authenticated USING (public.is_company_member(company_id));


--
-- Name: documents documents_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY documents_update ON public.documents FOR UPDATE TO authenticated USING (public.is_company_member(company_id)) WITH CHECK (public.is_company_member(company_id));


--
-- Name: journal_entries je_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY je_insert ON public.journal_entries FOR INSERT WITH CHECK (((company_id = ANY (public.auth_company_ids())) AND (public.auth_company_role(company_id) = ANY (ARRAY['owner'::text, 'admin'::text, 'accountant'::text]))));


--
-- Name: journal_entries je_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY je_select ON public.journal_entries FOR SELECT USING ((company_id = ANY (public.auth_company_ids())));


--
-- Name: journal_entries je_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY je_update ON public.journal_entries FOR UPDATE USING (((company_id = ANY (public.auth_company_ids())) AND (public.auth_company_role(company_id) = ANY (ARRAY['owner'::text, 'admin'::text, 'accountant'::text])) AND (status <> 'void'::text)));


--
-- Name: journal_entry_lines jel_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY jel_insert ON public.journal_entry_lines FOR INSERT WITH CHECK (((company_id = ANY (public.auth_company_ids())) AND (public.auth_company_role(company_id) = ANY (ARRAY['owner'::text, 'admin'::text, 'accountant'::text]))));


--
-- Name: journal_entry_lines jel_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY jel_select ON public.journal_entry_lines FOR SELECT USING ((company_id = ANY (public.auth_company_ids())));


--
-- Name: journal_entry_lines jel_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY jel_update ON public.journal_entry_lines FOR UPDATE USING (((company_id = ANY (public.auth_company_ids())) AND (public.auth_company_role(company_id) = ANY (ARRAY['owner'::text, 'admin'::text, 'accountant'::text])) AND (( SELECT journal_entries.status
   FROM public.journal_entries
  WHERE (journal_entries.id = journal_entry_lines.journal_entry_id)) = 'draft'::text)));


--
-- Name: journal_entries; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.journal_entries ENABLE ROW LEVEL SECURITY;

--
-- Name: journal_entries journal_entries_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY journal_entries_insert ON public.journal_entries FOR INSERT TO authenticated WITH CHECK (public.is_company_member(company_id));


--
-- Name: journal_entries journal_entries_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY journal_entries_select ON public.journal_entries FOR SELECT TO authenticated USING (public.is_company_member(company_id));


--
-- Name: journal_entries journal_entries_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY journal_entries_update ON public.journal_entries FOR UPDATE TO authenticated USING (public.is_company_member(company_id)) WITH CHECK (public.is_company_member(company_id));


--
-- Name: journal_entry_lines; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.journal_entry_lines ENABLE ROW LEVEL SECURITY;

--
-- Name: journal_entry_lines journal_entry_lines_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY journal_entry_lines_delete ON public.journal_entry_lines FOR DELETE TO authenticated USING (public.is_company_member(company_id));


--
-- Name: journal_entry_lines journal_entry_lines_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY journal_entry_lines_insert ON public.journal_entry_lines FOR INSERT TO authenticated WITH CHECK (public.is_company_member(company_id));


--
-- Name: journal_entry_lines journal_entry_lines_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY journal_entry_lines_select ON public.journal_entry_lines FOR SELECT TO authenticated USING (public.is_company_member(company_id));


--
-- Name: journal_entry_lines journal_entry_lines_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY journal_entry_lines_update ON public.journal_entry_lines FOR UPDATE TO authenticated USING (public.is_company_member(company_id)) WITH CHECK (public.is_company_member(company_id));


--
-- Name: monthly_reports; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.monthly_reports ENABLE ROW LEVEL SECURITY;

--
-- Name: monthly_reports monthly_reports_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY monthly_reports_insert ON public.monthly_reports FOR INSERT TO authenticated WITH CHECK (public.is_company_member(company_id));


--
-- Name: monthly_reports monthly_reports_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY monthly_reports_select ON public.monthly_reports FOR SELECT TO authenticated USING (public.is_company_member(company_id));


--
-- Name: notifications; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

--
-- Name: notifications notifications_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY notifications_delete ON public.notifications FOR DELETE TO authenticated USING (public.is_company_member(company_id));


--
-- Name: notifications notifications_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY notifications_insert ON public.notifications FOR INSERT TO authenticated WITH CHECK (public.is_company_member(company_id));


--
-- Name: notifications notifications_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY notifications_select ON public.notifications FOR SELECT TO authenticated USING (public.is_company_member(company_id));


--
-- Name: notifications notifications_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY notifications_update ON public.notifications FOR UPDATE TO authenticated USING (public.is_company_member(company_id)) WITH CHECK (public.is_company_member(company_id));


--
-- Name: opening_balances ob_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ob_insert ON public.opening_balances FOR INSERT WITH CHECK (((company_id = ANY (public.auth_company_ids())) AND (public.auth_company_role(company_id) = ANY (ARRAY['owner'::text, 'admin'::text, 'accountant'::text]))));


--
-- Name: opening_balances ob_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ob_select ON public.opening_balances FOR SELECT USING ((company_id = ANY (public.auth_company_ids())));


--
-- Name: opening_balances ob_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ob_update ON public.opening_balances FOR UPDATE USING (((company_id = ANY (public.auth_company_ids())) AND (public.auth_company_role(company_id) = ANY (ARRAY['owner'::text, 'admin'::text, 'accountant'::text]))));


--
-- Name: payroll_imports payroll_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY payroll_insert ON public.payroll_imports FOR INSERT WITH CHECK (((company_id = ANY (public.auth_company_ids())) AND (public.auth_company_role(company_id) = ANY (ARRAY['owner'::text, 'admin'::text, 'accountant'::text]))));


--
-- Name: payroll_imports payroll_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY payroll_select ON public.payroll_imports FOR SELECT USING ((company_id = ANY (public.auth_company_ids())));


--
-- Name: payroll_imports payroll_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY payroll_update ON public.payroll_imports FOR UPDATE USING (((company_id = ANY (public.auth_company_ids())) AND (public.auth_company_role(company_id) = ANY (ARRAY['owner'::text, 'admin'::text, 'accountant'::text]))));


--
-- Name: qbo_imports; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.qbo_imports ENABLE ROW LEVEL SECURITY;

--
-- Name: qbo_imports qbo_imports_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY qbo_imports_delete ON public.qbo_imports FOR DELETE TO authenticated USING (public.is_company_admin(company_id));


--
-- Name: qbo_imports qbo_imports_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY qbo_imports_insert ON public.qbo_imports FOR INSERT TO authenticated WITH CHECK (public.is_company_admin(company_id));


--
-- Name: qbo_imports qbo_imports_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY qbo_imports_select ON public.qbo_imports FOR SELECT TO authenticated USING (public.is_company_member(company_id));


--
-- Name: qbo_imports qbo_imports_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY qbo_imports_update ON public.qbo_imports FOR UPDATE TO authenticated USING (public.is_company_admin(company_id)) WITH CHECK (public.is_company_admin(company_id));


--
-- Name: rate_limit; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.rate_limit ENABLE ROW LEVEL SECURITY;

--
-- Name: reconciliations recon_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY recon_insert ON public.reconciliations FOR INSERT WITH CHECK (((company_id = ANY (public.auth_company_ids())) AND (public.auth_company_role(company_id) = ANY (ARRAY['owner'::text, 'admin'::text, 'accountant'::text]))));


--
-- Name: reconciliation_items recon_items_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY recon_items_delete ON public.reconciliation_items FOR DELETE USING ((( SELECT reconciliations.company_id
   FROM public.reconciliations
  WHERE (reconciliations.id = reconciliation_items.reconciliation_id)) = ANY (public.auth_company_ids())));


--
-- Name: reconciliation_items recon_items_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY recon_items_insert ON public.reconciliation_items FOR INSERT WITH CHECK ((( SELECT reconciliations.company_id
   FROM public.reconciliations
  WHERE (reconciliations.id = reconciliation_items.reconciliation_id)) = ANY (public.auth_company_ids())));


--
-- Name: reconciliation_items recon_items_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY recon_items_select ON public.reconciliation_items FOR SELECT USING ((( SELECT reconciliations.company_id
   FROM public.reconciliations
  WHERE (reconciliations.id = reconciliation_items.reconciliation_id)) = ANY (public.auth_company_ids())));


--
-- Name: reconciliations recon_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY recon_select ON public.reconciliations FOR SELECT USING ((company_id = ANY (public.auth_company_ids())));


--
-- Name: reconciliations recon_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY recon_update ON public.reconciliations FOR UPDATE USING (((company_id = ANY (public.auth_company_ids())) AND (public.auth_company_role(company_id) = ANY (ARRAY['owner'::text, 'admin'::text, 'accountant'::text]))));


--
-- Name: reconciliations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.reconciliations ENABLE ROW LEVEL SECURITY;

--
-- Name: reconciliations reconciliations_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY reconciliations_delete ON public.reconciliations FOR DELETE TO authenticated USING (public.is_company_member(company_id));


--
-- Name: reconciliations reconciliations_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY reconciliations_insert ON public.reconciliations FOR INSERT TO authenticated WITH CHECK (public.is_company_member(company_id));


--
-- Name: reconciliations reconciliations_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY reconciliations_select ON public.reconciliations FOR SELECT TO authenticated USING (public.is_company_member(company_id));


--
-- Name: reconciliations reconciliations_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY reconciliations_update ON public.reconciliations FOR UPDATE TO authenticated USING (public.is_company_member(company_id)) WITH CHECK (public.is_company_member(company_id));


--
-- Name: recurring_transactions recurring_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY recurring_delete ON public.recurring_transactions FOR DELETE USING (((company_id = ANY (public.auth_company_ids())) AND (public.auth_company_role(company_id) = ANY (ARRAY['owner'::text, 'admin'::text]))));


--
-- Name: recurring_transactions recurring_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY recurring_insert ON public.recurring_transactions FOR INSERT WITH CHECK (((company_id = ANY (public.auth_company_ids())) AND (public.auth_company_role(company_id) = ANY (ARRAY['owner'::text, 'admin'::text, 'accountant'::text]))));


--
-- Name: recurring_transactions recurring_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY recurring_select ON public.recurring_transactions FOR SELECT USING ((company_id = ANY (public.auth_company_ids())));


--
-- Name: recurring_transactions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.recurring_transactions ENABLE ROW LEVEL SECURITY;

--
-- Name: recurring_transactions recurring_transactions_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY recurring_transactions_delete ON public.recurring_transactions FOR DELETE TO authenticated USING (public.is_company_member(company_id));


--
-- Name: recurring_transactions recurring_transactions_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY recurring_transactions_insert ON public.recurring_transactions FOR INSERT TO authenticated WITH CHECK (public.is_company_member(company_id));


--
-- Name: recurring_transactions recurring_transactions_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY recurring_transactions_select ON public.recurring_transactions FOR SELECT TO authenticated USING (public.is_company_member(company_id));


--
-- Name: recurring_transactions recurring_transactions_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY recurring_transactions_update ON public.recurring_transactions FOR UPDATE TO authenticated USING (public.is_company_member(company_id)) WITH CHECK (public.is_company_member(company_id));


--
-- Name: recurring_transactions recurring_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY recurring_update ON public.recurring_transactions FOR UPDATE USING (((company_id = ANY (public.auth_company_ids())) AND (public.auth_company_role(company_id) = ANY (ARRAY['owner'::text, 'admin'::text, 'accountant'::text]))));


--
-- Name: subscriptions sub_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY sub_select ON public.subscriptions FOR SELECT USING ((company_id = ANY (public.auth_company_ids())));


--
-- Name: subscriptions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

--
-- Name: subscriptions subscriptions_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY subscriptions_delete ON public.subscriptions FOR DELETE TO authenticated USING (public.is_company_member(company_id));


--
-- Name: subscriptions subscriptions_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY subscriptions_insert ON public.subscriptions FOR INSERT TO authenticated WITH CHECK (public.is_company_member(company_id));


--
-- Name: subscriptions subscriptions_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY subscriptions_select ON public.subscriptions FOR SELECT TO authenticated USING (public.is_company_member(company_id));


--
-- Name: subscriptions subscriptions_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY subscriptions_update ON public.subscriptions FOR UPDATE TO authenticated USING (public.is_company_member(company_id)) WITH CHECK (public.is_company_member(company_id));


--
-- Name: tax_settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.tax_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: tax_settings tax_settings_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tax_settings_delete ON public.tax_settings FOR DELETE TO authenticated USING (public.is_company_member(company_id));


--
-- Name: tax_settings tax_settings_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tax_settings_insert ON public.tax_settings FOR INSERT TO authenticated WITH CHECK (public.is_company_member(company_id));


--
-- Name: tax_settings tax_settings_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tax_settings_select ON public.tax_settings FOR SELECT TO authenticated USING (public.is_company_member(company_id));


--
-- Name: tax_settings tax_settings_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tax_settings_update ON public.tax_settings FOR UPDATE TO authenticated USING (public.is_company_member(company_id)) WITH CHECK (public.is_company_member(company_id));


--
-- Name: unknown_documents unknown_docs_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY unknown_docs_insert ON public.unknown_documents FOR INSERT WITH CHECK (((company_id = ANY (public.auth_company_ids())) AND (public.auth_company_role(company_id) = ANY (ARRAY['owner'::text, 'admin'::text, 'accountant'::text]))));


--
-- Name: unknown_documents unknown_docs_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY unknown_docs_select ON public.unknown_documents FOR SELECT USING ((company_id = ANY (public.auth_company_ids())));


--
-- Name: unknown_documents unknown_docs_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY unknown_docs_update ON public.unknown_documents FOR UPDATE USING (((company_id = ANY (public.auth_company_ids())) AND (public.auth_company_role(company_id) = ANY (ARRAY['owner'::text, 'admin'::text, 'accountant'::text]))));


--
-- Name: unknown_documents; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.unknown_documents ENABLE ROW LEVEL SECURITY;

--
-- Name: unknown_documents unknown_documents_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY unknown_documents_delete ON public.unknown_documents FOR DELETE TO authenticated USING (public.is_company_member(company_id));


--
-- Name: unknown_documents unknown_documents_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY unknown_documents_insert ON public.unknown_documents FOR INSERT TO authenticated WITH CHECK (public.is_company_member(company_id));


--
-- Name: unknown_documents unknown_documents_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY unknown_documents_select ON public.unknown_documents FOR SELECT TO authenticated USING (public.is_company_member(company_id));


--
-- Name: unknown_documents unknown_documents_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY unknown_documents_update ON public.unknown_documents FOR UPDATE TO authenticated USING (public.is_company_member(company_id)) WITH CHECK (public.is_company_member(company_id));


--
-- Name: upload_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.upload_log ENABLE ROW LEVEL SECURITY;

--
-- Name: upload_log upload_log_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY upload_log_delete ON public.upload_log FOR DELETE TO authenticated USING (public.is_company_member(company_id));


--
-- Name: upload_log upload_log_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY upload_log_insert ON public.upload_log FOR INSERT TO authenticated WITH CHECK (public.is_company_member(company_id));


--
-- Name: upload_log upload_log_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY upload_log_select ON public.upload_log FOR SELECT TO authenticated USING (public.is_company_member(company_id));


--
-- Name: upload_log upload_log_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY upload_log_update ON public.upload_log FOR UPDATE TO authenticated USING (public.is_company_member(company_id)) WITH CHECK (public.is_company_member(company_id));


--
-- Name: users; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

--
-- Name: users users_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY users_insert ON public.users FOR INSERT WITH CHECK (true);


--
-- Name: users users_select_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY users_select_own ON public.users FOR SELECT USING ((id = auth.uid()));


--
-- Name: users users_select_teammates; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY users_select_teammates ON public.users FOR SELECT USING ((id IN ( SELECT cu.user_id
   FROM public.company_users cu
  WHERE (cu.company_id = ANY (public.auth_company_ids())))));


--
-- Name: users users_update_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY users_update_own ON public.users FOR UPDATE USING ((id = auth.uid()));


--
-- Name: vendor_rules; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.vendor_rules ENABLE ROW LEVEL SECURITY;

--
-- Name: vendor_rules vendor_rules_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY vendor_rules_delete ON public.vendor_rules FOR DELETE TO authenticated USING (public.is_company_member(company_id));


--
-- Name: vendor_rules vendor_rules_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY vendor_rules_insert ON public.vendor_rules FOR INSERT TO authenticated WITH CHECK (public.is_company_member(company_id));


--
-- Name: vendor_rules vendor_rules_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY vendor_rules_select ON public.vendor_rules FOR SELECT TO authenticated USING (public.is_company_member(company_id));


--
-- Name: vendor_rules vendor_rules_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY vendor_rules_update ON public.vendor_rules FOR UPDATE TO authenticated USING (public.is_company_member(company_id)) WITH CHECK (public.is_company_member(company_id));


--
-- PostgreSQL database dump complete
--


