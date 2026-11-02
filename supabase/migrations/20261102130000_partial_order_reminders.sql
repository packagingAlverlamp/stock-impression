-- Aviso único cuando un pedido lleva una semana recibido solo en parte.
-- Guarda la primera recepción real y la fecha en que ya se avisó al equipo.

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
