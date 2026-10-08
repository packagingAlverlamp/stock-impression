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

-- Al registrarse alguien nuevo, se crea automáticamente su fila en profiles
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
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
-- TABLA: products
-- Inventario compartido de suministros
-- ------------------------------------------------------------
create table public.products (
  id uuid primary key default gen_random_uuid(),
  ean text unique,
  name text not null,
  category text,
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
create index products_name_idx on public.products (name);
create index products_ean_idx on public.products (ean);

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
begin
  current_user_id := auth.uid();
  current_user_email := coalesce(
    auth.jwt() ->> 'email',
    (select profiles.email from public.profiles where profiles.id = current_user_id)
  );

  if tg_op = 'INSERT' then
    insert into public.stock_movements (
      product_id, product_name, category, unit, movement_type,
      quantity_before, quantity_after, quantity_delta, user_id, user_email
    )
    values (
      new.id, new.name, new.category, new.unit, 'initial',
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
      new.id, new.name, new.category, new.unit, movement_kind,
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
