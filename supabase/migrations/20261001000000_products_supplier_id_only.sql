do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'products'
      and column_name = 'supplier'
  ) then
    lock table public.products in access exclusive mode;

    insert into public.suppliers (name)
    select distinct btrim(p.supplier)
    from public.products p
    where nullif(btrim(p.supplier), '') is not null
      and not exists (
        select 1
        from public.suppliers s
        where lower(btrim(s.name)) = lower(btrim(p.supplier))
      )
    on conflict do nothing;

    update public.products p
    set supplier_id = s.id
    from public.suppliers s
    where p.supplier_id is null
      and nullif(btrim(p.supplier), '') is not null
      and lower(btrim(s.name)) = lower(btrim(p.supplier));

    if exists (
      select 1
      from public.products
      where nullif(btrim(supplier), '') is not null
        and supplier_id is null
    ) then
      raise exception 'No se pudieron asociar todos los nombres de proveedor a supplier_id';
    end if;

    alter table public.products drop column supplier;
  end if;
end;
$$;