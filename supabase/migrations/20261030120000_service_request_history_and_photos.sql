-- Historial de estados y fotos para las solicitudes de servicio técnico.

-- Rutas de las fotos subidas a Supabase Storage.
alter table public.maintenance_requests
  add column if not exists photo_paths text[] not null default '{}';

-- Registro inmutable de cambios de estado.
create table if not exists public.maintenance_request_events (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.maintenance_requests(id) on delete cascade,
  status text not null,
  previous_status text,
  changed_by uuid references auth.users(id) on delete set null,
  changed_by_email text,
  created_at timestamptz not null default now()
);

create index if not exists maintenance_request_events_request_idx
  on public.maintenance_request_events (request_id, created_at asc);

alter table public.maintenance_request_events enable row level security;

drop policy if exists "usuarios_ven_historial_servicio" on public.maintenance_request_events;
drop policy if exists "usuarios_crean_historial_servicio" on public.maintenance_request_events;

create policy "usuarios_ven_historial_servicio"
  on public.maintenance_request_events for select to authenticated using (true);

create policy "usuarios_crean_historial_servicio"
  on public.maintenance_request_events for insert to authenticated with check (true);

-- Registra el estado inicial y cada cambio de estado. Se ejecuta como
-- security definer para poder leer el email del perfil aunque el usuario no
-- tenga permisos directos sobre esa fila concreta.
create or replace function public.log_maintenance_request_event()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  current_user_id uuid;
  current_user_email text;
begin
  current_user_id := auth.uid();
  current_user_email := coalesce(
    auth.jwt() ->> 'email',
    (select profiles.email from public.profiles where profiles.id = current_user_id)
  );

  if tg_op = 'INSERT' then
    insert into public.maintenance_request_events (
      request_id, status, previous_status, changed_by, changed_by_email
    )
    values (
      new.id, new.status, null, current_user_id, current_user_email
    );
    return new;
  end if;

  if new.status is distinct from old.status then
    insert into public.maintenance_request_events (
      request_id, status, previous_status, changed_by, changed_by_email
    )
    values (
      new.id, new.status, old.status, current_user_id, current_user_email
    );
  end if;

  return new;
end;
$$;

revoke all on function public.log_maintenance_request_event() from public, anon, authenticated;

drop trigger if exists maintenance_requests_log_event on public.maintenance_requests;
create trigger maintenance_requests_log_event
after insert or update of status on public.maintenance_requests
for each row execute procedure public.log_maintenance_request_event();

-- Rellena el historial de las solicitudes que ya existían antes del trigger.
insert into public.maintenance_request_events (
  request_id, status, previous_status, changed_by, changed_by_email, created_at
)
select
  request.id,
  request.status,
  null,
  request.created_by,
  profile.email,
  request.created_at
from public.maintenance_requests as request
left join public.profiles as profile on profile.id = request.created_by
where not exists (
  select 1
  from public.maintenance_request_events as event
  where event.request_id = request.id
);

-- Bucket privado para las fotos. Las URLs firmadas se generan desde la app.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'service-request-photos',
  'service-request-photos',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "service_photos_upload" on storage.objects;
drop policy if exists "service_photos_read" on storage.objects;
drop policy if exists "service_photos_delete_own" on storage.objects;

create policy "service_photos_upload"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'service-request-photos');

create policy "service_photos_read"
  on storage.objects for select to authenticated
  using (bucket_id = 'service-request-photos');

create policy "service_photos_delete_own"
  on storage.objects for delete to authenticated
  using (bucket_id = 'service-request-photos' and owner = auth.uid());
