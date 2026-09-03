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
-- TABLA: products
-- Inventario compartido de suministros
-- ------------------------------------------------------------
create table public.products (
  id uuid primary key default gen_random_uuid(),
  ean text unique,
  name text not null,
  category text,
  location text,
  supplier text,
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
create index products_name_idx on public.products (name);
create index products_ean_idx on public.products (ean);
