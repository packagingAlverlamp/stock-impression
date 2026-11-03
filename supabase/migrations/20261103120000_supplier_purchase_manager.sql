-- Responsable de compras por proveedor.
-- El pedido se envía al email del perfil seleccionado.

alter table public.suppliers
  add column if not exists purchase_manager_id uuid
    references public.profiles(id) on delete set null;

create index if not exists suppliers_purchase_manager_idx
  on public.suppliers (purchase_manager_id);
