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

insert into public.stock_movements (
  product_id,
  product_name,
  category,
  unit,
  movement_type,
  quantity_before,
  quantity_after,
  quantity_delta,
  created_at
)
select
  id,
  name,
  category,
  unit,
  'baseline',
  null,
  quantity,
  0,
  now()
from public.products;

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
      product_id,
      product_name,
      category,
      unit,
      movement_type,
      quantity_before,
      quantity_after,
      quantity_delta,
      user_id,
      user_email
    )
    values (
      new.id,
      new.name,
      new.category,
      new.unit,
      'initial',
      0,
      new.quantity,
      new.quantity,
      current_user_id,
      current_user_email
    );
    return new;
  end if;

  if old.quantity is distinct from new.quantity then
    movement_delta := new.quantity - old.quantity;
    movement_kind := case when movement_delta > 0 then 'entry' else 'withdrawal' end;

    insert into public.stock_movements (
      product_id,
      product_name,
      category,
      unit,
      movement_type,
      quantity_before,
      quantity_after,
      quantity_delta,
      user_id,
      user_email
    )
    values (
      new.id,
      new.name,
      new.category,
      new.unit,
      movement_kind,
      old.quantity,
      new.quantity,
      movement_delta,
      current_user_id,
      current_user_email
    );
  end if;

  return new;
end;
$$;

revoke all on function public.log_product_stock_movement() from public, anon, authenticated;

create trigger products_log_stock_movement
after insert or update of quantity on public.products
for each row execute function public.log_product_stock_movement();
