alter table public.educational_assets
  add column if not exists file_size_bytes bigint
    check (file_size_bytes is null or file_size_bytes >= 0);

alter table public.image_requests
  add column if not exists requested_image_size text;
