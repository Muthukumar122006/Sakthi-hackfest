alter table public.image_requests
  add column if not exists source_prompt_hash text
    check (source_prompt_hash is null or source_prompt_hash ~ '^[0-9a-f]{64}$'),
  add column if not exists provider_prompt text;

alter table public.image_request_resolution_events
  drop constraint if exists image_request_resolution_events_resolution_check;
alter table public.image_request_resolution_events
  add constraint image_request_resolution_events_resolution_check
    check (resolution in ('confirmed_no_image', 'image_attached'));
alter table public.image_request_resolution_events
  add column if not exists storage_path text,
  add column if not exists content_hash text
    check (content_hash is null or content_hash ~ '^[0-9a-f]{64}$');

create table if not exists public.image_generation_operators (
  user_id uuid primary key references auth.users (id) on delete cascade,
  granted_by uuid references auth.users (id) on delete set null,
  granted_at timestamptz not null default now()
);
alter table public.image_generation_operators enable row level security;
revoke all on public.image_generation_operators from public, anon, authenticated;
grant select on public.image_generation_operators to service_role;

create or replace function public.is_image_generation_operator()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.image_generation_operators o
    where o.user_id = (select auth.uid())
  );
$$;
revoke all on function public.is_image_generation_operator() from public, anon;
grant execute on function public.is_image_generation_operator() to authenticated;

drop policy if exists "Asset reviewers can read review events" on public.asset_review_events;
create policy "Asset reviewers can read review events"
  on public.asset_review_events for select to authenticated
  using (
    public.is_image_generation_operator()
    or exists (
      select 1
      from public.educational_assets a
      where a.id = asset_review_events.asset_id
        and (
          a.created_by = (select auth.uid())
          or (a.school_id is not null and public.is_school_admin(a.school_id))
        )
    )
  );

drop policy if exists "Request owners and school admins can read resolution events"
  on public.image_request_resolution_events;
create policy "Request owners and authorized operators can read resolution events"
  on public.image_request_resolution_events for select to authenticated
  using (
    public.is_image_generation_operator()
    or exists (
      select 1 from public.image_requests r
      where r.id = image_request_resolution_events.image_request_id
        and (
          r.user_id = (select auth.uid())
          or (r.school_id is not null and public.is_school_admin(r.school_id))
        )
    )
  );

create or replace function public.resolve_uncertain_image_request(
  target_request_id uuid,
  target_resolution text,
  target_note text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved_request public.image_requests%rowtype;
begin
  if coalesce((select auth.role()), '') <> 'authenticated'
     or not public.is_image_generation_operator() then
    raise exception 'Only an authorized image-generation operator can resolve this request.';
  end if;
  if target_resolution <> 'confirmed_no_image'
     or target_note is null
     or length(trim(target_note)) not between 1 and 1000 then
    raise exception 'A supported resolution and audit note are required.';
  end if;

  select *
    into saved_request
    from public.image_requests
    where id = target_request_id
    for update;
  if not found or saved_request.state <> 'uncertain' then
    raise exception 'This request is missing or is no longer uncertain.';
  end if;

  update public.image_requests
    set state = 'failed',
        provider_error_code = 'operator_confirmed_no_image'
    where id = saved_request.id;

  update public.school_budget_reservations
    set state = 'released'
    where image_request_id = saved_request.id
      and state = 'reserved';

  insert into public.image_request_resolution_events (
    image_request_id, resolver_id, resolution, note
  ) values (
    saved_request.id, (select auth.uid()), target_resolution, btrim(target_note)
  );
end;
$$;

revoke all on function public.resolve_uncertain_image_request(uuid, text, text) from public, anon;
grant execute on function public.resolve_uncertain_image_request(uuid, text, text) to authenticated;

create or replace function public.complete_uncertain_image_generation(
  target_request_id uuid,
  target_resolver_id uuid,
  target_storage_path text,
  target_file_size_bytes bigint,
  target_content_hash text,
  target_description text,
  target_resolution_note text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved_request public.image_requests%rowtype;
  saved_reservation public.school_budget_reservations%rowtype;
  created_asset_id uuid;
  expected_storage_path text;
begin
  if coalesce((select auth.role()), '') <> 'service_role' then
    raise exception 'Only the trusted image service can recover an image.';
  end if;
  if target_resolver_id is null or not exists (
    select 1 from public.image_generation_operators o
    where o.user_id = target_resolver_id
  ) then
    raise exception 'The resolver is not an authorized image-generation operator.';
  end if;
  if target_file_size_bytes is null
     or target_file_size_bytes <= 0
     or target_file_size_bytes > 10485760
     or target_content_hash is null
     or target_content_hash !~ '^[0-9a-f]{64}$'
     or target_description is null
     or length(target_description) > 6000
     or target_resolution_note is null
     or length(trim(target_resolution_note)) not between 1 and 1000 then
    raise exception 'Recovered image metadata or audit note is invalid.';
  end if;

  select *
    into saved_request
    from public.image_requests
    where id = target_request_id
    for update;
  if not found
     or saved_request.state <> 'uncertain'
     or saved_request.provider_started_at is null
     or saved_request.source_prompt_hash is null then
    raise exception 'The request is not eligible for image recovery.';
  end if;

  expected_storage_path := case
    when saved_request.school_id is null
      then 'users/' || saved_request.user_id::text || '/' || saved_request.id::text || '.png'
    else 'schools/' || saved_request.school_id::text || '/' || saved_request.user_id::text || '/' || saved_request.id::text || '.png'
  end;
  if target_storage_path <> expected_storage_path then
    raise exception 'The recovered image path does not match the request.';
  end if;

  if saved_request.school_id is null then
    if exists (
      select 1 from public.school_budget_reservations r
      where r.image_request_id = saved_request.id and r.state = 'reserved'
    ) then
      raise exception 'A personal request cannot settle a school reservation.';
    end if;
  else
    select *
      into saved_reservation
      from public.school_budget_reservations
      where image_request_id = saved_request.id
        and school_id = saved_request.school_id
      for update;
    if not found or saved_reservation.state <> 'reserved' then
      raise exception 'The school budget reservation is missing or already resolved.';
    end if;
  end if;

  insert into public.educational_assets (
    school_id, title, description, subject, category, target_audience, intent,
    quality_tier, grade, language, tags, kind, file_size_bytes, review_state,
    visibility, storage_path, source_prompt_hash, content_hash, licence, created_by
  ) values (
    saved_request.school_id,
    left(saved_request.prompt, 200),
    target_description,
    '',
    saved_request.category,
    saved_request.target_audience,
    saved_request.intent,
    saved_request.quality_tier,
    '',
    saved_request.language,
    '{}',
    'generated',
    target_file_size_bytes,
    'pending',
    case when saved_request.school_id is null then 'private' else 'school' end,
    target_storage_path,
    saved_request.source_prompt_hash,
    target_content_hash,
    'Generated for this account. Review applicable provider terms before sharing.',
    saved_request.user_id
  )
  returning id into created_asset_id;

  if saved_request.school_id is not null then
    insert into public.school_budget_entries (
      school_id, image_request_id, entry_type, amount, currency
    ) values (
      saved_reservation.school_id,
      saved_reservation.image_request_id,
      'estimated',
      saved_reservation.amount,
      saved_reservation.currency
    );
    update public.school_budget_reservations
      set state = 'recorded'
      where id = saved_reservation.id
        and state = 'reserved';
    if not found then
      raise exception 'The school budget reservation changed during image recovery.';
    end if;
  end if;

  update public.image_requests
    set state = 'generated',
        output_asset_id = created_asset_id,
        quality_state = 'not_checked',
        quality_note = 'File format and image size were checked. Human review is still required.',
        provider_error_code = null
    where id = saved_request.id
      and state = 'uncertain';
  if not found then
    raise exception 'The request changed during image recovery.';
  end if;

  insert into public.image_request_resolution_events (
    image_request_id, resolver_id, resolution, note, storage_path, content_hash
  ) values (
    saved_request.id,
    target_resolver_id,
    'image_attached',
    btrim(target_resolution_note),
    target_storage_path,
    target_content_hash
  );

  return created_asset_id;
end;
$$;

revoke all on function public.complete_uncertain_image_generation(uuid, uuid, text, bigint, text, text, text)
  from public, anon, authenticated;
grant execute on function public.complete_uncertain_image_generation(uuid, uuid, text, bigint, text, text, text)
  to service_role;
