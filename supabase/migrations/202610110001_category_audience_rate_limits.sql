alter table public.profiles
  add column if not exists email text,
  add column if not exists phone_e164 text
    check (phone_e164 is null or phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  add column if not exists phone_country_iso text
    check (phone_country_iso is null or phone_country_iso ~ '^[A-Z]{2}$'),
  add column if not exists phone_calling_code text
    check (phone_calling_code is null or phone_calling_code ~ '^\+[1-9][0-9]{0,3}$'),
  add column if not exists default_category text not null default 'educational'
    check (default_category in ('fun', 'motivational', 'bold', 'educational', 'minimal', 'inspirational', 'cute', 'professional', 'creative', 'custom')),
  add column if not exists default_audience text not null default 'All ages';

create or replace function public.create_profile_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles as existing_profile (id, display_name, email, phone_e164)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data ->> 'name', ''), ''),
    new.email,
    new.phone
  )
  on conflict (id) do update
    set email = excluded.email,
        phone_e164 = excluded.phone_e164,
        display_name = coalesce(nullif(excluded.display_name, ''), existing_profile.display_name);
  return new;
end;
$$;

drop trigger if exists create_profile_after_signup on auth.users;
create trigger sync_profile_after_auth_change
after insert or update of email, phone, raw_user_meta_data on auth.users
for each row execute function public.create_profile_for_new_user();

alter table public.image_requests
  add column if not exists idempotency_key uuid,
  add column if not exists pricing_source_url text
    check (pricing_source_url is null or pricing_source_url ~ '^https://'),
  add column if not exists category text not null default 'educational'
    check (category in ('fun', 'motivational', 'bold', 'educational', 'minimal', 'inspirational', 'cute', 'professional', 'creative', 'custom')),
  add column if not exists target_audience text not null default 'All ages'
    check (length(trim(target_audience)) between 1 and 80),
  add column if not exists calculation_method text,
  add column if not exists pricing_effective_from date,
  add column if not exists savings_estimate numeric(12, 6),
  add column if not exists savings_percentage numeric(12, 4);

create unique index if not exists image_requests_user_idempotency_idx
  on public.image_requests (user_id, idempotency_key)
  where idempotency_key is not null;

alter table public.educational_assets
  add column if not exists category text not null default 'educational'
    check (category in ('fun', 'motivational', 'bold', 'educational', 'minimal', 'inspirational', 'cute', 'professional', 'creative', 'custom')),
  add column if not exists target_audience text not null default 'All ages'
    check (length(trim(target_audience)) between 1 and 80);

create table if not exists public.generation_rate_limits (
  user_id uuid primary key references auth.users (id) on delete cascade,
  window_started_at timestamptz not null default now(),
  request_count integer not null default 0 check (request_count >= 0)
);
alter table public.generation_rate_limits enable row level security;

create or replace function public.consume_generation_rate_limit(target_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_count integer;
begin
  if coalesce((select auth.role()), '') <> 'service_role' then
    raise exception 'Only the trusted image service can check generation limits.';
  end if;
  insert into public.generation_rate_limits as current_limit (user_id, window_started_at, request_count)
    values (target_user_id, now(), 1)
  on conflict (user_id) do update
    set window_started_at = case
          when current_limit.window_started_at < now() - interval '1 hour' then now()
          else current_limit.window_started_at
        end,
        request_count = case
          when current_limit.window_started_at < now() - interval '1 hour' then 1
          else current_limit.request_count + 1
        end
  returning request_count into current_count;
  return current_count <= 10;
end;
$$;

revoke all on function public.consume_generation_rate_limit(uuid) from public, anon, authenticated;
grant execute on function public.consume_generation_rate_limit(uuid) to service_role;
