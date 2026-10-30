create table if not exists public.machines (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  model text,
  serial_number text,
  supplier_id uuid references public.suppliers(id) on delete set null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists machines_name_unique_idx
  on public.machines (lower(trim(name)))
  where btrim(name) <> '';

alter table public.machines enable row level security;
drop policy if exists "usuarios_ven_maquinaria" on public.machines;
drop policy if exists "usuarios_crean_maquinaria" on public.machines;
drop policy if exists "usuarios_editan_maquinaria" on public.machines;
drop policy if exists "usuarios_borran_maquinaria" on public.machines;
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

drop trigger if exists machines_set_updated_at on public.machines;
create trigger machines_set_updated_at
before update on public.machines
for each row execute procedure public.set_machine_updated_at();

alter table public.products add column if not exists machine_id uuid;
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'products_machine_id_fkey'
      and conrelid = 'public.products'::regclass
  ) then
    alter table public.products
      add constraint products_machine_id_fkey
      foreign key (machine_id) references public.machines(id) on delete restrict;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'products' and column_name = 'category'
  ) then
    insert into public.machines (name)
    select distinct on (lower(btrim(category))) btrim(category)
    from public.products
    where nullif(btrim(category), '') is not null
    order by lower(btrim(category)), btrim(category)
    on conflict do nothing;

    update public.products as product
    set machine_id = machine.id
    from public.machines as machine
    where product.machine_id is null
      and nullif(btrim(product.category), '') is not null
      and lower(btrim(machine.name)) = lower(btrim(product.category));
  end if;
end;
$$;

create index if not exists products_machine_id_idx on public.products (machine_id);

create table if not exists public.maintenance_requests (
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
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists maintenance_requests_machine_created_at_idx
  on public.maintenance_requests (machine_id, created_at desc);

alter table public.maintenance_requests enable row level security;
drop policy if exists "usuarios_ven_solicitudes_servicio" on public.maintenance_requests;
drop policy if exists "usuarios_crean_solicitudes_servicio" on public.maintenance_requests;
drop policy if exists "usuarios_editan_solicitudes_servicio" on public.maintenance_requests;
drop policy if exists "usuarios_borran_solicitudes_servicio" on public.maintenance_requests;
create policy "usuarios_ven_solicitudes_servicio"
  on public.maintenance_requests for select to authenticated using (true);
create policy "usuarios_crean_solicitudes_servicio"
  on public.maintenance_requests for insert to authenticated with check (true);
create policy "usuarios_editan_solicitudes_servicio"
  on public.maintenance_requests for update to authenticated using (true);
create policy "usuarios_borran_solicitudes_servicio"
  on public.maintenance_requests for delete to authenticated using (true);

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

-- La columna products.category se conserva temporalmente para que la versión
-- antigua de la web siga funcionando durante el despliegue. La versión nueva
-- usa products.machine_id. Se puede eliminar en una migración posterior,
-- cuando el despliegue esté confirmado.
