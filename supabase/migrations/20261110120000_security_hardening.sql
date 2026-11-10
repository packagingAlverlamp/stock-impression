-- ============================================================
-- Endurecimiento de seguridad · 10/11/2026
--
-- 1. Solo las cuentas @alverlamp.es pueden leer o escribir datos.
--    El alta ya estaba limitada por trigger, pero las cuentas creadas
--    antes de esa restricción seguían teniendo acceso. Estas políticas
--    restrictivas las bloquean sin tocar las políticas existentes.
-- 2. El email del perfil queda inmutable desde el cliente: no se puede
--    cambiar para desviar avisos o suplantar a otra persona.
-- 3. El bucket de fotos queda limitado al dominio corporativo.
-- 4. Se revocan los privilegios de `anon` sobre las tablas y RPC.
--
-- Aplicar con: supabase db push
-- ============================================================

-- ------------------------------------------------------------
-- ¿El usuario autenticado pertenece al dominio corporativo?
-- Solo usa el claim del JWT (no consulta tablas) para poder
-- aplicarse también sobre public.profiles sin recursión.
-- ------------------------------------------------------------
create or replace function public.is_alverlamp_user()
returns boolean
language sql
stable
as $$
  select split_part(
    lower(btrim(coalesce(auth.jwt() ->> 'email', ''))),
    '@',
    2
  ) = 'alverlamp.es';
$$;

revoke all on function public.is_alverlamp_user() from public, anon;
grant execute on function public.is_alverlamp_user() to authenticated;

-- ------------------------------------------------------------
-- Políticas restrictivas por tabla. Se combinan con AND con las
-- políticas permisivas que ya existían.
-- ------------------------------------------------------------
do $$
declare
  target_table text;
  tables text[] := array[
    'profiles',
    'suppliers',
    'products',
    'machines',
    'maintenance_requests',
    'maintenance_request_events',
    'stock_movements',
    'purchase_orders',
    'purchase_order_items',
    'purchase_order_events',
    'app_settings'
  ];
begin
  foreach target_table in array tables loop
    if exists (
      select 1 from information_schema.tables
      where table_schema = 'public' and table_name = target_table
    ) then
      execute format(
        'drop policy if exists %I on public.%I',
        'solo_dominio_corporativo',
        target_table
      );
      execute format(
        'create policy %I on public.%I as restrictive for all to authenticated using (public.is_alverlamp_user()) with check (public.is_alverlamp_user())',
        'solo_dominio_corporativo',
        target_table
      );
    end if;
  end loop;
end $$;

-- ------------------------------------------------------------
-- Storage: el bucket de fotos solo para el dominio corporativo.
-- La política restrictiva no afecta a otros buckets.
-- ------------------------------------------------------------
drop policy if exists "service_photos_domain_only" on storage.objects;
create policy "service_photos_domain_only"
  on storage.objects as restrictive for all to authenticated
  using (bucket_id <> 'service-request-photos' or public.is_alverlamp_user())
  with check (bucket_id <> 'service-request-photos' or public.is_alverlamp_user());

-- ------------------------------------------------------------
-- El email y el id del perfil no se pueden modificar desde el cliente.
-- ------------------------------------------------------------
create or replace function public.protect_profile_identity()
returns trigger
language plpgsql
as $$
begin
  new.id := old.id;
  new.email := old.email;
  return new;
end;
$$;

drop trigger if exists profiles_protect_identity on public.profiles;
create trigger profiles_protect_identity
before update on public.profiles
for each row execute procedure public.protect_profile_identity();

revoke all on function public.protect_profile_identity() from public, anon, authenticated;

-- ------------------------------------------------------------
-- Sin privilegios para peticiones anónimas.
-- ------------------------------------------------------------
revoke all on public.profiles from anon;
revoke all on public.suppliers from anon;
revoke all on public.products from anon;
revoke all on public.machines from anon;
revoke all on public.maintenance_requests from anon;
revoke all on public.maintenance_request_events from anon;
revoke all on public.stock_movements from anon;
revoke all on public.purchase_orders from anon;
revoke all on public.purchase_order_items from anon;
revoke all on public.purchase_order_events from anon;
revoke all on public.app_settings from anon;
revoke all on function public.set_purchase_order_item_received(uuid, numeric) from anon;

-- ------------------------------------------------------------
-- Auditoría: cuentas fuera del dominio que aún existan.
-- No se borran automáticamente; revisar antes de eliminarlas.
--
--   select id, email from public.profiles
--   where split_part(lower(trim(email)), '@', 2) <> 'alverlamp.es';
-- ------------------------------------------------------------
