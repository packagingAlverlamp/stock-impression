-- ============================================================
-- STOCK-IMPRESIÓN — Esquema de base de datos para Supabase
-- Pega y ejecuta todo este fichero en: Supabase > SQL Editor > New query > Run
-- ============================================================

create extension if not exists pgcrypto;

-- ------------------------------------------------------------
-- TABLA: profiles
-- Un perfil por cada persona registrada (email + preferencia de avisos)
-- ------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  notify_low_stock boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Cualquier persona registrada puede ver la lista de perfiles
-- (necesario para saber a qué emails avisar cuando queda poco stock).
-- Es un grupo cerrado y de confianza, así que esto es intencional.
create policy "usuarios_ven_todos_los_perfiles"
  on public.profiles for select
  to authenticated
  using (true);

create policy "usuario_actualiza_su_propio_perfil"
  on public.profiles for update
  to authenticated
  using (auth.uid() = id);

create policy "usuario_borra_su_propio_perfil"
  on public.profiles for delete
  to authenticated
  using (auth.uid() = id);

-- Al registrarse alguien nuevo, se crea automáticamente su fila en profiles.
-- El registro queda limitado a emails corporativos @alverlamp.es.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if new.email is null
     or split_part(lower(trim(new.email)), '@', 2) <> 'alverlamp.es' then
    raise exception 'Solo se permiten cuentas con email @alverlamp.es';
  end if;

  insert into public.profiles (id, email)
  values (new.id, new.email);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ------------------------------------------------------------
-- TABLA: suppliers
-- Directorio compartido de proveedores con nombre, email y teléfono
-- ------------------------------------------------------------
create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  name text,
  email text,
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.suppliers enable row level security;

create unique index suppliers_name_unique_idx
  on public.suppliers (lower(trim(name)))
  where name is not null and btrim(name) <> '';

create policy "usuarios_ven_proveedores"
  on public.suppliers for select to authenticated using (true);

create policy "usuarios_crean_proveedores"
  on public.suppliers for insert to authenticated with check (true);

create policy "usuarios_editan_proveedores"
  on public.suppliers for update to authenticated using (true);

create policy "usuarios_borran_proveedores"
  on public.suppliers for delete to authenticated using (true);

create or replace function public.set_supplier_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger suppliers_set_updated_at
before update on public.suppliers
for each row execute procedure public.set_supplier_updated_at();

-- ------------------------------------------------------------
-- TABLA: machines
-- Máquinas de impresión con un proveedor asignado
-- ------------------------------------------------------------
create table public.machines (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  model text,
  serial_number text,
  supplier_id uuid references public.suppliers(id) on delete set null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.machines enable row level security;

create unique index machines_name_unique_idx
  on public.machines (lower(trim(name)))
  where btrim(name) <> '';

create policy "usuarios_ven_maquinaria"
  on public.machines for select to authenticated using (true);

create policy "usuarios_crean_maquinaria"
  on public.machines for insert to authenticated with check (true);

create policy "usuarios_editan_maquinaria"
  on public.machines for update to authenticated using (true);

create policy "usuarios_borran_maquinaria"
  on public.machines for delete to authenticated using (true);

create or replace function public.set_machine_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger machines_set_updated_at
before update on public.machines
for each row execute procedure public.set_machine_updated_at();

-- ------------------------------------------------------------
-- TABLA: maintenance_requests
-- Historial de solicitudes de servicio técnico
-- ------------------------------------------------------------
create table public.maintenance_requests (
  id uuid primary key default gen_random_uuid(),
  machine_id uuid not null references public.machines(id) on delete restrict,
  machine_name text not null,
  machine_model text,
  machine_serial_number text,
  supplier_name text,
  supplier_email text,
  supplier_phone text,
  reason text not null,
  status text not null default 'pending'
    check (status in ('pending', 'in_progress', 'resolved')),
  notification_sent boolean not null default false,
  photo_paths text[] not null default '{}',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.maintenance_requests enable row level security;

create policy "usuarios_ven_solicitudes_servicio"
  on public.maintenance_requests for select to authenticated using (true);

create policy "usuarios_crean_solicitudes_servicio"
  on public.maintenance_requests for insert to authenticated with check (true);

create policy "usuarios_editan_solicitudes_servicio"
  on public.maintenance_requests for update to authenticated using (true);

create policy "usuarios_borran_solicitudes_servicio"
  on public.maintenance_requests for delete to authenticated using (true);

-- ------------------------------------------------------------
-- TABLA: maintenance_request_events
-- Historial inmutable de cambios de estado de las solicitudes
-- ------------------------------------------------------------
create table public.maintenance_request_events (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.maintenance_requests(id) on delete cascade,
  status text not null,
  previous_status text,
  changed_by uuid references auth.users(id) on delete set null,
  changed_by_email text,
  created_at timestamptz not null default now()
);

create index maintenance_request_events_request_idx
  on public.maintenance_request_events (request_id, created_at asc);

alter table public.maintenance_request_events enable row level security;

create policy "usuarios_ven_historial_servicio"
  on public.maintenance_request_events for select to authenticated using (true);

create policy "usuarios_crean_historial_servicio"
  on public.maintenance_request_events for insert to authenticated with check (true);

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
    values (new.id, new.status, null, current_user_id, current_user_email);
    return new;
  end if;

  if new.status is distinct from old.status then
    insert into public.maintenance_request_events (
      request_id, status, previous_status, changed_by, changed_by_email
    )
    values (new.id, new.status, old.status, current_user_id, current_user_email);
  end if;

  return new;
end;
$$;

revoke all on function public.log_maintenance_request_event() from public, anon, authenticated;

create trigger maintenance_requests_log_event
after insert or update of status on public.maintenance_requests
for each row execute procedure public.log_maintenance_request_event();

-- ------------------------------------------------------------
-- STORAGE: fotos de solicitudes de servicio técnico
-- ------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'service-request-photos',
  'service-request-photos',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
)
on conflict (id) do nothing;

create policy "service_photos_upload"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'service-request-photos');

create policy "service_photos_read"
  on storage.objects for select to authenticated
  using (bucket_id = 'service-request-photos');

create policy "service_photos_delete_own"
  on storage.objects for delete to authenticated
  using (bucket_id = 'service-request-photos' and owner = auth.uid());

-- ------------------------------------------------------------
-- TABLA: products
-- Inventario compartido de suministros
-- ------------------------------------------------------------
create table public.products (
  id uuid primary key default gen_random_uuid(),
  ean text unique,
  name text not null,
  machine_id uuid references public.machines(id) on delete restrict,
  location text,
  supplier_id uuid references public.suppliers(id) on delete set null,
  unit text,
  quantity numeric not null default 0,
  min_quantity numeric not null default 0,
  low_stock_notified boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.products enable row level security;

-- Cualquier persona registrada puede ver, crear, editar y borrar productos
-- (inventario compartido entre todo el equipo)
create policy "usuarios_ven_productos"
  on public.products for select to authenticated using (true);

create policy "usuarios_crean_productos"
  on public.products for insert to authenticated with check (true);

create policy "usuarios_editan_productos"
  on public.products for update to authenticated using (true);

create policy "usuarios_borran_productos"
  on public.products for delete to authenticated using (true);

-- Mantener updated_at al día automáticamente
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger products_set_updated_at
before update on public.products
for each row execute procedure public.set_updated_at();

-- ------------------------------------------------------------
-- Índices útiles
-- ------------------------------------------------------------
create index products_supplier_id_idx on public.products (supplier_id);
create index products_machine_id_idx on public.products (machine_id);
create index products_name_idx on public.products (name);
create index products_ean_idx on public.products (ean);
create index maintenance_requests_machine_created_at_idx
  on public.maintenance_requests (machine_id, created_at desc);

-- Supplier assignments are stored only through supplier_id.

-- ------------------------------------------------------------
-- TABLA: stock_movements
-- Registro inmutable de altas, entradas y salidas de stock
-- ------------------------------------------------------------
create table public.stock_movements (
  id bigint generated always as identity primary key,
  product_id uuid references public.products(id) on delete set null,
  product_name text not null,
  category text,
  unit text,
  movement_type text not null check (movement_type in ('initial', 'baseline', 'entry', 'withdrawal')),
  quantity_before numeric,
  quantity_after numeric not null,
  quantity_delta numeric not null,
  user_id uuid references auth.users(id) on delete set null,
  user_email text,
  created_at timestamptz not null default now()
);

create index stock_movements_created_at_idx on public.stock_movements (created_at desc);
create index stock_movements_product_created_at_idx on public.stock_movements (product_id, created_at desc);

alter table public.stock_movements enable row level security;

create policy "usuarios_ven_movimientos_stock"
  on public.stock_movements for select to authenticated using (true);

grant select on public.stock_movements to authenticated;

create or replace function public.log_product_stock_movement()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  movement_delta numeric;
  movement_kind text;
  current_user_id uuid;
  current_user_email text;
  current_machine_name text;
begin
  current_user_id := auth.uid();
  current_user_email := coalesce(
    auth.jwt() ->> 'email',
    (select profiles.email from public.profiles where profiles.id = current_user_id)
  );
  select machines.name into current_machine_name
  from public.machines
  where machines.id = new.machine_id;

  if tg_op = 'INSERT' then
    insert into public.stock_movements (
      product_id, product_name, category, unit, movement_type,
      quantity_before, quantity_after, quantity_delta, user_id, user_email
    )
    values (
      new.id, new.name, current_machine_name, new.unit, 'initial',
      0, new.quantity, new.quantity, current_user_id, current_user_email
    );
    return new;
  end if;

  if old.quantity is distinct from new.quantity then
    movement_delta := new.quantity - old.quantity;
    movement_kind := case when movement_delta > 0 then 'entry' else 'withdrawal' end;

    insert into public.stock_movements (
      product_id, product_name, category, unit, movement_type,
      quantity_before, quantity_after, quantity_delta, user_id, user_email
    )
    values (
      new.id, new.name, current_machine_name, new.unit, movement_kind,
      old.quantity, new.quantity, movement_delta, current_user_id, current_user_email
    );
  end if;

  return new;
end;
$$;

revoke all on function public.log_product_stock_movement() from public, anon, authenticated;

create trigger products_log_stock_movement
after insert or update of quantity on public.products
for each row execute function public.log_product_stock_movement();

-- ============================================================
-- PEDIDOS A PROVEEDORES, REFERENCIA Y EMAIL DE COMPRAS
-- (equivalente a la migración 20261102120000_purchase_orders.sql)
-- ============================================================
-- pendiente se concilia automáticamente (FIFO por pedido más antiguo).

-- ------------------------------------------------------------
-- Referencia del proveedor en la ficha de producto
-- ------------------------------------------------------------
alter table public.products add column if not exists reference text;

create index if not exists products_reference_idx on public.products (reference);

-- ------------------------------------------------------------
-- TABLA: app_settings
-- Ajustes globales de la aplicación
-- ------------------------------------------------------------
create table if not exists public.app_settings (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,

  constraint app_settings_purchase_email_domain check (
    key <> 'purchase_email'
    or lower(value) ~ '^[a-z0-9._%+-]+@alverlamp\.es$'
  )
);

alter table public.app_settings enable row level security;

create policy "usuarios_ven_ajustes"
  on public.app_settings for select to authenticated using (true);

create policy "usuarios_crean_ajustes"
  on public.app_settings for insert to authenticated with check (true);

create policy "usuarios_editan_ajustes"
  on public.app_settings for update to authenticated using (true);

create trigger app_settings_set_updated_at
before update on public.app_settings
for each row execute procedure public.set_updated_at();

insert into public.app_settings (key, value)
values ('purchase_email', 'compras@alverlamp.es')
on conflict (key) do nothing;

-- ------------------------------------------------------------
-- TABLA: purchase_orders
-- Cabecera del pedido a un proveedor
-- ------------------------------------------------------------
create table if not exists public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  order_number bigint generated always as identity unique,
  supplier_id uuid references public.suppliers(id) on delete restrict,
  supplier_name text not null,
  supplier_email text,
  supplier_phone text,
  purchase_email text not null
    check (lower(purchase_email) ~ '^[a-z0-9._%+-]+@alverlamp\.es$'),
  status text not null default 'draft'
    check (status in ('draft', 'sent', 'partial', 'received', 'cancelled')),
  note text,
  requested_by uuid references auth.users(id) on delete set null,
  requested_by_email text,
  emails_sent boolean not null default false,
  emails_sent_at timestamptz,
  sent_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists purchase_orders_status_created_idx
  on public.purchase_orders (status, created_at desc);
create index if not exists purchase_orders_supplier_idx
  on public.purchase_orders (supplier_id);

alter table public.purchase_orders enable row level security;

create policy "usuarios_ven_pedidos"
  on public.purchase_orders for select to authenticated using (true);

create policy "usuarios_crean_pedidos"
  on public.purchase_orders for insert to authenticated with check (true);

create policy "usuarios_editan_pedidos"
  on public.purchase_orders for update to authenticated using (true);

create policy "usuarios_borran_pedidos"
  on public.purchase_orders for delete to authenticated using (true);

create trigger purchase_orders_set_updated_at
before update on public.purchase_orders
for each row execute procedure public.set_updated_at();

-- ------------------------------------------------------------
-- TABLA: purchase_order_items
-- Líneas del pedido con copia histórica del producto
-- ------------------------------------------------------------
create table if not exists public.purchase_order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.purchase_orders(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  product_name text not null,
  product_reference text,
  product_ean text,
  unit text,
  quantity_requested numeric not null check (quantity_requested > 0),
  quantity_received numeric not null default 0
    check (quantity_received >= 0 and quantity_received <= quantity_requested),
  status text not null default 'pending'
    check (status in ('pending', 'partial', 'received', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists purchase_order_items_order_idx
  on public.purchase_order_items (order_id);
create index if not exists purchase_order_items_pending_product_idx
  on public.purchase_order_items (product_id, status)
  where status in ('pending', 'partial');
create unique index if not exists purchase_order_items_unique_product
  on public.purchase_order_items (order_id, product_id)
  where product_id is not null;

alter table public.purchase_order_items enable row level security;

create policy "usuarios_ven_lineas_pedido"
  on public.purchase_order_items for select to authenticated using (true);

create policy "usuarios_crean_lineas_pedido"
  on public.purchase_order_items for insert to authenticated with check (true);

create policy "usuarios_editan_lineas_pedido"
  on public.purchase_order_items for update to authenticated using (true);

create policy "usuarios_borran_lineas_pedido"
  on public.purchase_order_items for delete to authenticated using (true);

create trigger purchase_order_items_set_updated_at
before update on public.purchase_order_items
for each row execute procedure public.set_updated_at();

-- Un pedido solo puede contener suministros de su proveedor
create or replace function public.validate_purchase_order_item()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order_supplier uuid;
  v_product_supplier uuid;
begin
  select supplier_id into v_order_supplier
  from public.purchase_orders
  where id = new.order_id;

  if new.product_id is not null then
    select supplier_id into v_product_supplier
    from public.products
    where id = new.product_id;

    if v_product_supplier is distinct from v_order_supplier then
      raise exception 'El suministro no pertenece al proveedor del pedido';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.validate_purchase_order_item() from public, anon, authenticated;

create trigger purchase_order_items_validate_supplier
before insert or update of product_id on public.purchase_order_items
for each row execute procedure public.validate_purchase_order_item();

-- ------------------------------------------------------------
-- TABLA: purchase_order_events
-- Historial inmutable de estados y recepciones
-- ------------------------------------------------------------
create table if not exists public.purchase_order_events (
  id bigint generated always as identity primary key,
  order_id uuid not null references public.purchase_orders(id) on delete cascade,
  status text,
  previous_status text,
  source text not null default 'user'
    check (source in ('user', 'system')),
  note text,
  changed_by uuid references auth.users(id) on delete set null,
  changed_by_email text,
  created_at timestamptz not null default now()
);

create index if not exists purchase_order_events_order_idx
  on public.purchase_order_events (order_id, created_at asc);

alter table public.purchase_order_events enable row level security;

create policy "usuarios_ven_historial_pedidos"
  on public.purchase_order_events for select to authenticated using (true);

create policy "usuarios_crean_historial_pedidos"
  on public.purchase_order_events for insert to authenticated with check (true);

create or replace function public.log_purchase_order_event()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_user_id uuid;
  v_user_email text;
  v_source text;
begin
  v_user_id := auth.uid();
  v_user_email := coalesce(
    auth.jwt() ->> 'email',
    (select email from public.profiles where id = v_user_id)
  );
  v_source := case
    when coalesce(current_setting('app.purchase_order_system', true), '') = '1' then 'system'
    else 'user'
  end;

  if tg_op = 'INSERT' then
    insert into public.purchase_order_events (
      order_id, status, previous_status, source, changed_by, changed_by_email
    )
    values (new.id, new.status, null, v_source, v_user_id, v_user_email);
    return new;
  end if;

  if new.status is distinct from old.status then
    insert into public.purchase_order_events (
      order_id, status, previous_status, source, changed_by, changed_by_email
    )
    values (new.id, new.status, old.status, v_source, v_user_id, v_user_email);
  end if;

  return new;
end;
$$;

revoke all on function public.log_purchase_order_event() from public, anon, authenticated;

create trigger purchase_orders_log_event
after insert or update of status on public.purchase_orders
for each row execute procedure public.log_purchase_order_event();

-- ------------------------------------------------------------
-- Conciliación automática de stock con pedidos pendientes
-- ------------------------------------------------------------

-- Recalcula el estado del pedido a partir de sus líneas
create or replace function public.refresh_purchase_order_status(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_total integer;
  v_closed integer;
  v_received integer;
begin
  select status into v_status from public.purchase_orders where id = p_order_id;
  if v_status is null or v_status not in ('sent', 'partial') then
    return;
  end if;

  select
    count(*),
    count(*) filter (where status in ('received', 'cancelled')),
    count(*) filter (where quantity_received > 0)
  into v_total, v_closed, v_received
  from public.purchase_order_items
  where order_id = p_order_id;

  if v_total = 0 then
    return;
  end if;

  if v_closed = v_total then
    update public.purchase_orders
       set status = 'received',
           closed_at = coalesce(closed_at, now())
     where id = p_order_id
       and status <> 'received';
  elsif v_received > 0 then
    update public.purchase_orders
       set status = 'partial'
     where id = p_order_id
       and status = 'sent';
  elsif v_received = 0 then
    update public.purchase_orders
       set status = 'sent'
     where id = p_order_id
       and status = 'partial';
  end if;
end;
$$;

revoke all on function public.refresh_purchase_order_status(uuid) from public, anon, authenticated;

-- Aplica una entrada de stock a las líneas pendientes (FIFO)
create or replace function public.allocate_entry_to_purchase_orders(
  p_product_id uuid,
  p_quantity numeric
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_remaining numeric := p_quantity;
  v_line record;
  v_take numeric;
  v_new_received numeric;
begin
  if p_product_id is null or p_quantity is null or p_quantity <= 0 then
    return;
  end if;

  perform set_config('app.purchase_order_system', '1', true);

  for v_line in
    select i.id, i.order_id, i.quantity_requested, i.quantity_received
    from public.purchase_order_items i
    join public.purchase_orders o on o.id = i.order_id
    where i.product_id = p_product_id
      and i.status in ('pending', 'partial')
      and o.status in ('sent', 'partial')
    order by o.created_at asc, i.created_at asc
    for update of i
  loop
    v_take := least(v_remaining, v_line.quantity_requested - v_line.quantity_received);
    if v_take > 0 then
      v_new_received := v_line.quantity_received + v_take;

      update public.purchase_order_items
         set quantity_received = v_new_received,
             status = case
               when v_new_received >= quantity_requested then 'received'
               else 'partial'
             end
       where id = v_line.id;

      insert into public.purchase_order_events (order_id, source, note)
      values (
        v_line.order_id,
        'system',
        format('Recepción automática: %s uds', v_take)
      );

      perform public.refresh_purchase_order_status(v_line.order_id);

      v_remaining := v_remaining - v_take;
    end if;
    exit when v_remaining <= 0;
  end loop;

  perform set_config('app.purchase_order_system', '', true);
end;
$$;

revoke all on function public.allocate_entry_to_purchase_orders(uuid, numeric) from public, anon, authenticated;

create or replace function public.handle_stock_entry_for_purchase_orders()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.allocate_entry_to_purchase_orders(new.product_id, new.quantity_delta);
  return new;
end;
$$;

revoke all on function public.handle_stock_entry_for_purchase_orders() from public, anon, authenticated;

create trigger stock_movements_allocate_purchase_orders
after insert on public.stock_movements
for each row
when (
  new.movement_type = 'entry'
  and new.quantity_delta > 0
  and new.product_id is not null
)
execute procedure public.handle_stock_entry_for_purchase_orders();

-- Ajuste manual de la cantidad recibida de una línea
create or replace function public.set_purchase_order_item_received(
  p_item_id uuid,
  p_received numeric
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order_id uuid;
  v_requested numeric;
  v_order_status text;
begin
  select i.order_id, i.quantity_requested, o.status
    into v_order_id, v_requested, v_order_status
  from public.purchase_order_items i
  join public.purchase_orders o on o.id = i.order_id
  where i.id = p_item_id;

  if v_order_id is null then
    raise exception 'Línea de pedido no encontrada';
  end if;
  if v_order_status not in ('sent', 'partial') then
    raise exception 'El pedido ya no admite recepciones';
  end if;
  if p_received is null or p_received < 0 or p_received > v_requested then
    raise exception 'La cantidad recibida debe estar entre 0 y la cantidad pedida';
  end if;

  perform set_config('app.purchase_order_system', '', true);

  update public.purchase_order_items
     set quantity_received = p_received,
         status = case
           when p_received >= quantity_requested then 'received'
           when p_received > 0 then 'partial'
           else 'pending'
         end
   where id = p_item_id;

  insert into public.purchase_order_events (order_id, source, note)
  values (v_order_id, 'user', format('Ajuste manual de recepción: %s uds', p_received));

  perform public.refresh_purchase_order_status(v_order_id);
end;
$$;

grant execute on function public.set_purchase_order_item_received(uuid, numeric) to authenticated;

-- ------------------------------------------------------------
-- Permisos
-- ------------------------------------------------------------
grant select, insert, update on public.app_settings to authenticated;
grant select, insert, update, delete on public.purchase_orders to authenticated;
grant select, insert, update, delete on public.purchase_order_items to authenticated;
grant select, insert on public.purchase_order_events to authenticated;
grant usage, select on sequence public.purchase_orders_order_number_seq to authenticated;
grant usage, select on sequence public.purchase_order_events_id_seq to authenticated;

-- ============================================================
-- AVISO DE RECEPCIÓN PARCIAL
-- (equivalente a la migración 20261102130000_partial_order_reminders.sql)
-- ============================================================
alter table public.purchase_orders
  add column if not exists first_received_at timestamptz,
  add column if not exists partial_notified_at timestamptz;

create index if not exists purchase_orders_partial_reminder_idx
  on public.purchase_orders (first_received_at)
  where status = 'partial' and partial_notified_at is null;

-- Recalcula la primera recepción al conciliar una entrada de stock.
create or replace function public.allocate_entry_to_purchase_orders(
  p_product_id uuid,
  p_quantity numeric
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_remaining numeric := p_quantity;
  v_line record;
  v_take numeric;
  v_new_received numeric;
begin
  if p_product_id is null or p_quantity is null or p_quantity <= 0 then
    return;
  end if;

  perform set_config('app.purchase_order_system', '1', true);

  for v_line in
    select i.id, i.order_id, i.quantity_requested, i.quantity_received
    from public.purchase_order_items i
    join public.purchase_orders o on o.id = i.order_id
    where i.product_id = p_product_id
      and i.status in ('pending', 'partial')
      and o.status in ('sent', 'partial')
    order by o.created_at asc, i.created_at asc
    for update of i
  loop
    v_take := least(v_remaining, v_line.quantity_requested - v_line.quantity_received);
    if v_take > 0 then
      v_new_received := v_line.quantity_received + v_take;

      update public.purchase_order_items
         set quantity_received = v_new_received,
             status = case
               when v_new_received >= quantity_requested then 'received'
               else 'partial'
             end
       where id = v_line.id;

      update public.purchase_orders
         set first_received_at = coalesce(first_received_at, now())
       where id = v_line.order_id;

      insert into public.purchase_order_events (order_id, source, note)
      values (
        v_line.order_id,
        'system',
        format('Recepción automática: %s uds', v_take)
      );

      perform public.refresh_purchase_order_status(v_line.order_id);

      v_remaining := v_remaining - v_take;
    end if;
    exit when v_remaining <= 0;
  end loop;

  perform set_config('app.purchase_order_system', '', true);
end;
$$;

revoke all on function public.allocate_entry_to_purchase_orders(uuid, numeric) from public, anon, authenticated;

-- Un ajuste manual de recepción también cuenta como primera recepción.
create or replace function public.set_purchase_order_item_received(
  p_item_id uuid,
  p_received numeric
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order_id uuid;
  v_requested numeric;
  v_order_status text;
begin
  select i.order_id, i.quantity_requested, o.status
    into v_order_id, v_requested, v_order_status
  from public.purchase_order_items i
  join public.purchase_orders o on o.id = i.order_id
  where i.id = p_item_id;

  if v_order_id is null then
    raise exception 'Línea de pedido no encontrada';
  end if;
  if v_order_status not in ('sent', 'partial') then
    raise exception 'El pedido ya no admite recepciones';
  end if;
  if p_received is null or p_received < 0 or p_received > v_requested then
    raise exception 'La cantidad recibida debe estar entre 0 y la cantidad pedida';
  end if;

  perform set_config('app.purchase_order_system', '', true);

  update public.purchase_order_items
     set quantity_received = p_received,
         status = case
           when p_received >= quantity_requested then 'received'
           when p_received > 0 then 'partial'
           else 'pending'
         end
   where id = p_item_id;

  if p_received > 0 then
    update public.purchase_orders
       set first_received_at = coalesce(first_received_at, now())
     where id = v_order_id;
  end if;

  insert into public.purchase_order_events (order_id, source, note)
  values (v_order_id, 'user', format('Ajuste manual de recepción: %s uds', p_received));

  perform public.refresh_purchase_order_status(v_order_id);
end;
$$;

grant execute on function public.set_purchase_order_item_received(uuid, numeric) to authenticated;

-- ============================================================
-- RESPONSABLE DE COMPRAS POR PROVEEDOR
-- (equivalente a la migración 20261103120000_supplier_purchase_manager.sql)
-- ============================================================
alter table public.suppliers
  add column if not exists purchase_manager_id uuid
    references public.profiles(id) on delete set null;

create index if not exists suppliers_purchase_manager_idx
  on public.suppliers (purchase_manager_id);
