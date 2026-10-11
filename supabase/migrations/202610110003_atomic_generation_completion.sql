create or replace function public.complete_image_generation(
  target_request_id uuid,
  target_storage_path text,
  target_file_size_bytes bigint,
  target_content_hash text,
  target_source_prompt_hash text,
  target_description text,
  target_reservation_id uuid default null
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
    raise exception 'Only the trusted image service can complete image generation.';
  end if;

  if target_storage_path is null
     or target_file_size_bytes is null
     or target_file_size_bytes <= 0
     or target_file_size_bytes > 10485760
     or target_content_hash is null
     or target_content_hash !~ '^[0-9a-f]{64}$'
     or target_source_prompt_hash is null
     or target_source_prompt_hash !~ '^[0-9a-f]{64}$'
     or target_description is null
     or length(target_description) > 6000 then
    raise exception 'Generated image metadata is invalid.';
  end if;

  select *
    into saved_request
    from public.image_requests
    where id = target_request_id
    for update;

  if not found or saved_request.state <> 'queued' then
    raise exception 'Image request is missing or no longer queued.';
  end if;

  expected_storage_path := case
    when saved_request.school_id is null
      then 'users/' || saved_request.user_id::text || '/' || saved_request.id::text || '.png'
    else 'schools/' || saved_request.school_id::text || '/' || saved_request.user_id::text || '/' || saved_request.id::text || '.png'
  end;

  if target_storage_path <> expected_storage_path then
    raise exception 'Generated image storage path does not match its request.';
  end if;

  if saved_request.school_id is null and target_reservation_id is not null then
    raise exception 'A personal image request cannot use a school budget reservation.';
  end if;
  if saved_request.school_id is not null and target_reservation_id is null then
    raise exception 'A school image request requires a budget reservation.';
  end if;

  insert into public.educational_assets (
    school_id,
    title,
    description,
    subject,
    category,
    target_audience,
    intent,
    quality_tier,
    grade,
    language,
    tags,
    kind,
    file_size_bytes,
    review_state,
    visibility,
    storage_path,
    source_prompt_hash,
    content_hash,
    licence,
    created_by
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
    case when saved_request.school_id is null then 'approved'::public.asset_review_state else 'pending'::public.asset_review_state end,
    case when saved_request.school_id is null then 'private' else 'school' end,
    target_storage_path,
    target_source_prompt_hash,
    target_content_hash,
    'Generated for this account. Review applicable provider terms before sharing.',
    saved_request.user_id
  )
  returning id into created_asset_id;

  if target_reservation_id is not null then
    select *
      into saved_reservation
      from public.school_budget_reservations
      where id = target_reservation_id
        and image_request_id = saved_request.id
        and school_id = saved_request.school_id
      for update;

    if not found or saved_reservation.state <> 'reserved' then
      raise exception 'School budget reservation is missing or no longer active.';
    end if;

    insert into public.school_budget_entries (
      school_id,
      image_request_id,
      entry_type,
      amount,
      currency
    ) values (
      saved_reservation.school_id,
      saved_reservation.image_request_id,
      'estimated',
      saved_reservation.amount,
      saved_reservation.currency
    );

    update public.school_budget_reservations
      set state = 'recorded'
      where id = target_reservation_id;
  end if;

  update public.image_requests
    set state = 'generated',
        output_asset_id = created_asset_id,
        quality_state = 'not_checked',
        quality_note = 'File format and image size were checked. A teacher must review the image content.'
    where id = saved_request.id;

  return created_asset_id;
end;
$$;

revoke all on function public.complete_image_generation(uuid, text, bigint, text, text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.complete_image_generation(uuid, text, bigint, text, text, text, uuid)
  to service_role;
