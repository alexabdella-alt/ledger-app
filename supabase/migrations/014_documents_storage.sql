-- =====================================================================
-- 014_documents_storage.sql
-- Private Supabase Storage bucket for actual document files + RLS so a user
-- can only touch files under their own company's folder.
--
-- Path convention (set by the app): {company_id}/{timestamp}_{filename}
-- so the FIRST path segment is the company_id and drives the policy check.
--
-- Run in the Supabase SQL editor. If the CREATE POLICY statements fail with a
-- permissions error on storage.objects, create the same four policies from the
-- dashboard instead: Storage → Policies → New policy on the `documents` bucket.
-- =====================================================================

-- 1. Private bucket (25 MB/file limit; mime types left open so CSV/PDF/images
--    all work — tighten allowed_mime_types later if you want).
insert into storage.buckets (id, name, public, file_size_limit)
values ('documents', 'documents', false, 26214400)
on conflict (id) do nothing;

-- 2. RLS policies on storage.objects, scoped to the documents bucket and to the
--    company_id encoded as the first folder of the object path. is_company_member
--    is the same helper used by every other table's policies.

drop policy if exists "documents_company_read" on storage.objects;
create policy "documents_company_read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'documents'
    and public.is_company_member( ((storage.foldername(name))[1])::uuid )
  );

drop policy if exists "documents_company_insert" on storage.objects;
create policy "documents_company_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'documents'
    and public.is_company_member( ((storage.foldername(name))[1])::uuid )
  );

drop policy if exists "documents_company_update" on storage.objects;
create policy "documents_company_update" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'documents'
    and public.is_company_member( ((storage.foldername(name))[1])::uuid )
  )
  with check (
    bucket_id = 'documents'
    and public.is_company_member( ((storage.foldername(name))[1])::uuid )
  );

drop policy if exists "documents_company_delete" on storage.objects;
create policy "documents_company_delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'documents'
    and public.is_company_member( ((storage.foldername(name))[1])::uuid )
  );
