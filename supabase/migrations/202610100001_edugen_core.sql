create extension if not exists pgcrypto;

create type public.school_role as enum ('teacher', 'admin');
create type public.asset_kind as enum ('existing', 'template', 'svg', 'generated');
create type public.asset_review_state as enum ('pending', 'approved', 'rejected');
create type public.request_state as enum ('draft', 'queued', 'generated', 'reused', 'failed');
create type public.image_intent as enum (
  'colouring_worksheet',
  'flashcard',
  'textbook_illustration',
  'science_diagram',
  'educational_poster',
  'general_illustration'
);

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  country_iso text check (country_iso is null or country_iso ~ '^[A-Z]{2}$'),
  preferred_currency text check (preferred_currency is null or preferred_currency ~ '^[A-Z]{3}$'),
  currency_overridden boolean not null default false,
  preferred_language text,
  default_grade text,
  default_style text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.schools (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 160),
  district text not null check (length(trim(district)) between 1 and 160),
  monthly_budget numeric(12, 2) not null default 0 check (monthly_budget >= 0),
  warning_threshold numeric(5, 2) not null default 80
    check (warning_threshold > 0 and warning_threshold <= 100),
  budget_currency text not null default 'USD' check (budget_currency ~ '^[A-Z]{3}$'),
  created_at timestamptz not null default now()
);

create table public.school_memberships (
  school_id uuid not null references public.schools (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.school_role not null default 'teacher',
  created_at timestamptz not null default now(),
  primary key (school_id, user_id)
);

create table public.educational_assets (
  id uuid primary key default gen_random_uuid(),
  school_id uuid references public.schools (id) on delete cascade,
  title text not null check (length(trim(title)) between 1 and 200),
  description text not null default '',
  subject text not null default '',
  intent public.image_intent not null,
  quality_tier text not null default 'precision-lite'
    check (quality_tier in ('draft-rapid', 'precision-lite', 'studio-pro')),
  grade text not null default '',
  language text not null default 'en',
  tags text[] not null default '{}',
  kind public.asset_kind not null,
  review_state public.asset_review_state not null default 'pending',
  visibility text not null default 'private' check (visibility in ('private', 'school', 'shared')),
  storage_path text,
  source_url text,
  content_hash text,
  source_prompt_hash text,
  licence text,
  attribution text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  check (storage_path is null or source_url is null)
);

create unique index educational_assets_school_hash_idx
  on public.educational_assets (school_id, content_hash)
  where content_hash is not null;
create index educational_assets_lookup_idx
  on public.educational_assets (intent, grade, language, review_state);
create unique index educational_assets_prompt_hash_idx
  on public.educational_assets (school_id, source_prompt_hash)
  where source_prompt_hash is not null and review_state = 'approved';

create table public.image_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade default auth.uid(),
  school_id uuid references public.schools (id) on delete set null,
  prompt text not null check (length(trim(prompt)) between 1 and 4000),
  subject text not null default '',
  grade text not null default '',
  intent public.image_intent not null,
  quality_tier text not null default 'precision-lite'
    check (quality_tier in ('draft-rapid', 'precision-lite', 'studio-pro')),
  language text not null default 'en',
  style text not null default '',
  target_budget numeric(12, 4) check (target_budget is null or target_budget >= 0),
  target_budget_currency text check (target_budget_currency is null or target_budget_currency ~ '^[A-Z]{3}$'),
  target_budget_exchange_rate numeric(20, 10) check (target_budget_exchange_rate is null or target_budget_exchange_rate > 0),
  target_budget_exchange_rate_date date,
  state public.request_state not null default 'draft',
  method text,
  reused_asset_id uuid references public.educational_assets (id) on delete set null,
  output_asset_id uuid references public.educational_assets (id) on delete set null,
  quality_state text check (quality_state is null or quality_state in ('passed', 'failed', 'not_checked')),
  quality_note text,
  provider_charge numeric(12, 6) check (provider_charge is null or provider_charge >= 0),
  provider_currency text check (provider_currency is null or provider_currency ~ '^[A-Z]{3}$'),
  baseline_estimate numeric(12, 6) check (baseline_estimate is null or baseline_estimate >= 0),
  optimized_estimate numeric(12, 6) check (optimized_estimate is null or optimized_estimate >= 0),
  estimate_currency text check (estimate_currency is null or estimate_currency ~ '^[A-Z]{3}$'),
  display_currency text check (display_currency is null or display_currency ~ '^[A-Z]{3}$'),
  exchange_rate numeric(20, 10) check (exchange_rate is null or exchange_rate > 0),
  exchange_rate_date date,
  school_budget_exchange_rate numeric(20, 10) check (school_budget_exchange_rate is null or school_budget_exchange_rate > 0),
  school_budget_exchange_rate_date date,
  cost_source text not null default 'unknown'
    check (cost_source in ('actual', 'estimated', 'projected', 'demo', 'unknown')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((state = 'reused') = (reused_asset_id is not null)),
  check (provider_charge is null or provider_currency is not null)
);

create index image_requests_user_time_idx on public.image_requests (user_id, created_at desc);
create index image_requests_school_time_idx on public.image_requests (school_id, created_at desc);

create table public.provider_pricing (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  model text not null,
  quality_tier text not null check (quality_tier in ('draft-rapid', 'precision-lite', 'studio-pro')),
  image_size text not null,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  cost_per_image numeric(12, 6) not null check (cost_per_image >= 0),
  source_url text not null check (source_url ~ '^https://'),
  effective_from date not null,
  active boolean not null default true,
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (provider, model, quality_tier, image_size, effective_from)
);

create index provider_pricing_active_idx
  on public.provider_pricing (quality_tier, effective_from desc)
  where active;
create unique index provider_pricing_one_active_tier_idx
  on public.provider_pricing (provider, quality_tier)
  where active;

create table public.school_budget_entries (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  image_request_id uuid references public.image_requests (id) on delete set null,
  entry_type text not null check (entry_type in ('actual', 'estimated', 'baseline')),
  amount numeric(12, 6) not null check (amount >= 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  recorded_at timestamptz not null default now()
);

create index school_budget_entries_school_time_idx
  on public.school_budget_entries (school_id, recorded_at desc);

create table public.school_budget_reservations (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  image_request_id uuid not null references public.image_requests (id) on delete cascade,
  amount numeric(12, 6) not null check (amount >= 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  state text not null default 'reserved' check (state in ('reserved', 'recorded', 'released')),
  created_at timestamptz not null default now(),
  unique (image_request_id)
);

create index school_budget_reservations_open_idx
  on public.school_budget_reservations (school_id, created_at)
  where state = 'reserved';

create or replace function public.is_school_member(target_school_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.school_memberships m
    where m.school_id = target_school_id and m.user_id = (select auth.uid())
  );
$$;

create or replace function public.is_school_admin(target_school_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.school_memberships m
    where m.school_id = target_school_id
      and m.user_id = (select auth.uid())
      and m.role = 'admin'
  );
$$;

create or replace function public.block_client_actual_costs()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce((select auth.role()), '') <> 'service_role'
     and (new.provider_charge is not null or new.cost_source = 'actual') then
    raise exception 'Actual provider costs can only be recorded by a trusted server.';
  end if;
  return new;
end;
$$;

create trigger block_client_actual_costs_trigger
before insert or update of provider_charge, cost_source on public.image_requests
for each row execute function public.block_client_actual_costs();

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_updated_at before update on public.profiles
for each row execute function public.touch_updated_at();
create trigger image_requests_updated_at before update on public.image_requests
for each row execute function public.touch_updated_at();

create or replace function public.create_profile_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'name', ''))
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger create_profile_after_signup
after insert on auth.users
for each row execute function public.create_profile_for_new_user();

alter table public.profiles enable row level security;
alter table public.schools enable row level security;
alter table public.school_memberships enable row level security;
alter table public.educational_assets enable row level security;
alter table public.image_requests enable row level security;
alter table public.school_budget_entries enable row level security;
alter table public.school_budget_reservations enable row level security;
alter table public.provider_pricing enable row level security;

create policy "Users can read their own profile"
  on public.profiles for select to authenticated
  using (id = (select auth.uid()));
create policy "Users can create their own profile"
  on public.profiles for insert to authenticated
  with check (id = (select auth.uid()));
create policy "Users can update their own profile"
  on public.profiles for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

create policy "School members can read their school"
  on public.schools for select to authenticated
  using (public.is_school_member(id));
create policy "School admins can update school settings"
  on public.schools for update to authenticated
  using (public.is_school_admin(id))
  with check (public.is_school_admin(id));

create policy "Users can read their memberships"
  on public.school_memberships for select to authenticated
  using (user_id = (select auth.uid()) or public.is_school_admin(school_id));

create policy "Members can read approved shared assets"
  on public.educational_assets for select to authenticated
  using (
    review_state = 'approved'
    and (
      visibility = 'shared'
      or (visibility = 'school' and school_id is not null and public.is_school_member(school_id))
      or (visibility = 'private' and created_by = (select auth.uid()))
    )
  );
create policy "Creators and school admins can read assets awaiting review"
  on public.educational_assets for select to authenticated
  using (
    created_by = (select auth.uid())
    or (school_id is not null and public.is_school_admin(school_id))
  );
create policy "Members can add assets for their school"
  on public.educational_assets for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and (school_id is null or public.is_school_member(school_id))
    and visibility in ('private', 'school')
    and review_state = 'pending'
  );
create policy "Asset owners or school admins can update assets"
  on public.educational_assets for update to authenticated
  using (
    created_by = (select auth.uid())
    or (school_id is not null and public.is_school_admin(school_id))
  )
  with check (
    (created_by = (select auth.uid()) and review_state = 'pending' and visibility in ('private', 'school'))
    or (school_id is not null and public.is_school_admin(school_id))
  );

create policy "Users can read their requests and school admins can read school requests"
  on public.image_requests for select to authenticated
  using (
    user_id = (select auth.uid())
    or (school_id is not null and public.is_school_admin(school_id))
  );
create policy "Members can create requests for themselves"
  on public.image_requests for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and (school_id is null or public.is_school_member(school_id))
    and provider_charge is null
    and cost_source <> 'actual'
  );
create policy "Users can update their own drafts"
  on public.image_requests for update to authenticated
  using (user_id = (select auth.uid()) and state = 'draft')
  with check (
    user_id = (select auth.uid())
    and (school_id is null or public.is_school_member(school_id))
    and provider_charge is null
    and cost_source <> 'actual'
  );

create policy "School members can read budget entries"
  on public.school_budget_entries for select to authenticated
  using (public.is_school_member(school_id));
create policy "School admins can read budget reservations"
  on public.school_budget_reservations for select to authenticated
  using (public.is_school_admin(school_id));

create policy "Authenticated users can read active provider pricing"
  on public.provider_pricing for select to authenticated
  using (active);

create or replace function public.reserve_school_budget(
  target_school_id uuid,
  target_request_id uuid,
  estimated_amount numeric,
  target_currency text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  budget_limit numeric;
  school_currency text;
  spent_amount numeric;
  held_amount numeric;
  reservation_id uuid;
begin
  if coalesce((select auth.role()), '') <> 'service_role' then
    raise exception 'Only the trusted image service can reserve school budget.';
  end if;
  if estimated_amount < 0 or target_currency !~ '^[A-Z]{3}$' then
    raise exception 'Budget reservation amount or currency is invalid.';
  end if;
  select monthly_budget, budget_currency
    into budget_limit, school_currency
    from public.schools
    where id = target_school_id
    for update;
  if not found then
    raise exception 'School not found.';
  end if;
  if school_currency <> target_currency then
    raise exception 'Budget reservation currency does not match the school budget.';
  end if;
  select coalesce(sum(amount), 0)
    into spent_amount
    from public.school_budget_entries
    where school_id = target_school_id
      and currency = school_currency
      and recorded_at >= date_trunc('month', now());
  select coalesce(sum(amount), 0)
    into held_amount
    from public.school_budget_reservations
    where school_id = target_school_id
      and currency = school_currency
      and state = 'reserved'
      and created_at >= date_trunc('month', now());
  if spent_amount + held_amount + estimated_amount > budget_limit then
    return null;
  end if;
  insert into public.school_budget_reservations
    (school_id, image_request_id, amount, currency)
    values (target_school_id, target_request_id, estimated_amount, school_currency)
    returning id into reservation_id;
  return reservation_id;
end;
$$;

create or replace function public.settle_school_budget_reservation(target_reservation_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  reservation public.school_budget_reservations%rowtype;
begin
  if coalesce((select auth.role()), '') <> 'service_role' then
    raise exception 'Only the trusted image service can settle school budget.';
  end if;
  select * into reservation
    from public.school_budget_reservations
    where id = target_reservation_id
    for update;
  if not found or reservation.state <> 'reserved' then
    raise exception 'Budget reservation is missing or already settled.';
  end if;
  insert into public.school_budget_entries
    (school_id, image_request_id, entry_type, amount, currency)
    values (reservation.school_id, reservation.image_request_id, 'estimated', reservation.amount, reservation.currency);
  update public.school_budget_reservations
    set state = 'recorded'
    where id = target_reservation_id;
end;
$$;

create or replace function public.release_school_budget_reservation(target_reservation_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce((select auth.role()), '') <> 'service_role' then
    raise exception 'Only the trusted image service can release school budget.';
  end if;
  update public.school_budget_reservations
    set state = 'released'
    where id = target_reservation_id and state = 'reserved';
end;
$$;

revoke all on function public.reserve_school_budget(uuid, uuid, numeric, text) from public, anon, authenticated;
revoke all on function public.settle_school_budget_reservation(uuid) from public, anon, authenticated;
revoke all on function public.release_school_budget_reservation(uuid) from public, anon, authenticated;
grant execute on function public.reserve_school_budget(uuid, uuid, numeric, text) to service_role;
grant execute on function public.settle_school_budget_reservation(uuid) to service_role;
grant execute on function public.release_school_budget_reservation(uuid) to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('educational-images', 'educational-images', false, 10485760, array['image/png'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "Users can read their own generated image files"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'educational-images'
    and case
      when (storage.foldername(name))[1] = 'users'
        then (storage.foldername(name))[2] = (select auth.uid())::text
      when (storage.foldername(name))[1] = 'schools'
        then (storage.foldername(name))[2] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          and public.is_school_member(((storage.foldername(name))[2])::uuid)
      else false
    end
    or (
      bucket_id = 'educational-images'
      and exists (
        select 1
        from public.educational_assets
        where storage_path = name
          and visibility = 'shared'
          and review_state = 'approved'
      )
    )
  );
