alter table public.image_requests
  add column if not exists request_fingerprint text
    check (request_fingerprint is null or request_fingerprint ~ '^[0-9a-f]{64}$'),
  add column if not exists provider_attempt_count integer not null default 0
    check (provider_attempt_count >= 0),
  add column if not exists provider_started_at timestamptz,
  add column if not exists provider_error_code text,
  add column if not exists exchange_rate_source_url text
    check (exchange_rate_source_url is null or exchange_rate_source_url ~ '^https://'),
  add column if not exists school_budget_exchange_rate_source_url text
    check (school_budget_exchange_rate_source_url is null or school_budget_exchange_rate_source_url ~ '^https://'),
  add column if not exists target_budget_exchange_rate_source_url text
    check (target_budget_exchange_rate_source_url is null or target_budget_exchange_rate_source_url ~ '^https://'),
  add column if not exists baseline_pricing_source_url text
    check (baseline_pricing_source_url is null or baseline_pricing_source_url ~ '^https://'),
  add column if not exists baseline_pricing_effective_from date;

create table if not exists public.asset_review_events (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.educational_assets (id) on delete cascade,
  reviewer_id uuid not null references auth.users (id) on delete restrict,
  previous_state public.asset_review_state not null,
  new_state public.asset_review_state not null check (new_state in ('approved', 'rejected')),
  note text not null default '' check (length(note) <= 1000),
  created_at timestamptz not null default now()
);
alter table public.asset_review_events enable row level security;

alter table public.educational_assets
  add column if not exists review_note text not null default ''
    check (length(review_note) <= 1000),
  add column if not exists reviewed_by uuid references auth.users (id) on delete set null,
  add column if not exists reviewed_at timestamptz;

update public.educational_assets
  set review_state = 'pending'
  where kind = 'generated'
    and school_id is null
    and review_state = 'approved';

create or replace function public.keep_generated_assets_pending()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.kind = 'generated' then
    new.review_state := 'pending';
    new.review_note := '';
    new.reviewed_by := null;
    new.reviewed_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists keep_generated_assets_pending_trigger on public.educational_assets;
create trigger keep_generated_assets_pending_trigger
  before insert on public.educational_assets
  for each row execute function public.keep_generated_assets_pending();

drop policy if exists "Asset owners or school admins can update assets" on public.educational_assets;

create policy "Asset reviewers can read review events"
  on public.asset_review_events for select to authenticated
  using (
    exists (
      select 1
      from public.educational_assets a
      where a.id = asset_review_events.asset_id
        and (
          a.created_by = (select auth.uid())
          or (a.school_id is not null and public.is_school_admin(a.school_id))
        )
    )
  );

create or replace function public.review_educational_asset(
  target_asset_id uuid,
  target_decision text,
  target_note text default ''
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved_asset public.educational_assets%rowtype;
  next_state public.asset_review_state;
begin
  if coalesce((select auth.role()), '') <> 'authenticated' or (select auth.uid()) is null then
    raise exception 'Sign in to review this image.';
  end if;
  if target_decision not in ('approved', 'rejected')
     or target_note is null
     or length(target_note) > 1000
     or (target_decision = 'rejected' and length(btrim(target_note)) = 0) then
    raise exception 'The review decision or note is invalid.';
  end if;
  next_state := target_decision::public.asset_review_state;

  select *
    into saved_asset
    from public.educational_assets
    where id = target_asset_id
    for update;
  if not found or saved_asset.review_state <> 'pending' then
    raise exception 'This image is missing or is no longer awaiting review.';
  end if;

  if saved_asset.school_id is null then
    if saved_asset.created_by is distinct from (select auth.uid()) or saved_asset.visibility <> 'private' then
      raise exception 'Only the creator can review their private image.';
    end if;
  elsif not public.is_school_admin(saved_asset.school_id) then
    raise exception 'Only a school admin can review a school image.';
  end if;

  update public.educational_assets
    set review_state = next_state,
        review_note = btrim(target_note),
        reviewed_by = (select auth.uid()),
        reviewed_at = now()
    where id = saved_asset.id;

  insert into public.asset_review_events (
    asset_id, reviewer_id, previous_state, new_state, note
  ) values (
    saved_asset.id, (select auth.uid()), saved_asset.review_state, next_state, btrim(target_note)
  );
end;
$$;

revoke all on function public.review_educational_asset(uuid, text, text) from public, anon;
grant execute on function public.review_educational_asset(uuid, text, text) to authenticated;

create or replace function public.claim_image_provider_attempt(target_request_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved_request public.image_requests%rowtype;
  limit_window timestamptz;
  limit_count integer;
begin
  if coalesce((select auth.role()), '') <> 'service_role' then
    raise exception 'Only the trusted image service can claim a provider attempt.';
  end if;

  select *
    into saved_request
    from public.image_requests
    where id = target_request_id
    for update;
  if not found or saved_request.state <> 'queued' or saved_request.provider_started_at is not null then
    return false;
  end if;

  insert into public.generation_rate_limits (user_id, window_started_at, request_count)
    values (saved_request.user_id, now(), 0)
    on conflict (user_id) do nothing;

  select window_started_at, request_count
    into limit_window, limit_count
    from public.generation_rate_limits
    where user_id = saved_request.user_id
    for update;

  if limit_window < now() - interval '1 hour' then
    update public.generation_rate_limits
      set window_started_at = now(), request_count = 1
      where user_id = saved_request.user_id;
  elsif limit_count >= 10 then
    return false;
  else
    update public.generation_rate_limits
      set request_count = request_count + 1
      where user_id = saved_request.user_id;
  end if;

  update public.image_requests
    set provider_started_at = now(),
        provider_attempt_count = provider_attempt_count + 1
    where id = saved_request.id
      and state = 'queued'
      and provider_started_at is null;
  return found;
end;
$$;

revoke all on function public.claim_image_provider_attempt(uuid) from public, anon, authenticated;
grant execute on function public.claim_image_provider_attempt(uuid) to service_role;

create or replace function public.fail_image_generation(
  target_request_id uuid,
  target_reservation_id uuid default null,
  target_error_code text default 'generation_failed',
  target_quality_note text default null,
  target_known_rejection boolean default false
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved_request public.image_requests%rowtype;
begin
  if coalesce((select auth.role()), '') <> 'service_role' then
    raise exception 'Only the trusted image service can fail a generation request.';
  end if;

  select *
    into saved_request
    from public.image_requests
    where id = target_request_id
    for update;
  if not found or saved_request.state <> 'queued' then
    return false;
  end if;

  if saved_request.provider_started_at is not null and not target_known_rejection then
    raise exception 'A request with a started provider attempt must be reconciled as uncertain.';
  end if;

  update public.image_requests
    set state = 'failed',
        provider_error_code = left(coalesce(target_error_code, 'generation_failed'), 100),
        quality_state = case when target_quality_note is null then quality_state else 'failed' end,
        quality_note = coalesce(target_quality_note, quality_note)
    where id = saved_request.id;

  if target_reservation_id is not null then
    update public.school_budget_reservations
      set state = 'released'
      where id = target_reservation_id
        and image_request_id = saved_request.id
        and state = 'reserved';
  end if;
  return true;
end;
$$;

revoke all on function public.fail_image_generation(uuid, uuid, text, text, boolean) from public, anon, authenticated;
grant execute on function public.fail_image_generation(uuid, uuid, text, text, boolean) to service_role;

create or replace function public.mark_stale_image_requests(stale_after interval default interval '3 minutes')
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  uncertain_count integer := 0;
  failed_count integer := 0;
begin
  if stale_after <= interval '0 seconds' or stale_after > interval '1 day' then
    raise exception 'The stale request timeout must be between zero and one day.';
  end if;

  update public.image_requests
    set state = 'uncertain',
        provider_error_code = 'provider_outcome_unknown'
    where state = 'queued'
      and provider_started_at is not null
      and provider_started_at < now() - stale_after;
  get diagnostics uncertain_count = row_count;

  with expired as (
    update public.image_requests
      set state = 'failed',
          provider_error_code = 'expired_before_provider_attempt'
      where state = 'queued'
        and provider_started_at is null
        and created_at < now() - stale_after
      returning id
  )
  select count(*)::integer
    into failed_count
    from expired;

  update public.school_budget_reservations r
    set state = 'released'
    where r.image_request_id in (
      select id
      from public.image_requests
      where state = 'failed'
        and provider_error_code = 'expired_before_provider_attempt'
        and created_at < now() - stale_after
    )
      and r.state = 'reserved';
  return uncertain_count + failed_count;
end;
$$;

revoke all on function public.mark_stale_image_requests(interval) from public, anon, authenticated;
grant execute on function public.mark_stale_image_requests(interval) to service_role;

create table if not exists public.image_request_resolution_events (
  id uuid primary key default gen_random_uuid(),
  image_request_id uuid not null references public.image_requests (id) on delete cascade,
  resolver_id uuid not null references auth.users (id) on delete restrict,
  resolution text not null check (resolution = 'confirmed_no_image'),
  note text not null check (length(trim(note)) between 1 and 1000),
  created_at timestamptz not null default now()
);
alter table public.image_request_resolution_events enable row level security;

create policy "Request owners and school admins can read resolution events"
  on public.image_request_resolution_events for select to authenticated
  using (
    exists (
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
  if coalesce((select auth.role()), '') <> 'authenticated' or (select auth.uid()) is null then
    raise exception 'Sign in to resolve this image request.';
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
  if saved_request.school_id is null then
    if saved_request.user_id <> (select auth.uid()) then
      raise exception 'Only the request owner can resolve this personal request.';
    end if;
  elsif not public.is_school_admin(saved_request.school_id) then
    raise exception 'Only a school admin can resolve this school request.';
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
