# Plan de implementación — Módulo Pedidos, referencia y auditoría de acciones

> Documento de trabajo. **Implementado el 02/11/2026.** Recoge las decisiones
> tomadas, el modelo de datos, los flujos, las plantillas de correo, la
> conciliación automática de stock y la auditoría de botones.
>
> El flujo de “Nuevo pedido” se invirtió después de la especificación inicial:
> ahora la lista parte de los suministros con poco stock, el primer suministro
> fija el proveedor y los demás se añaden a mano. La recepción es automática al
> escanear y hay un aviso único de recepción parcial a los 7 días.
>
> Fecha: 30/10/2026 · Actualizado: 02/11/2026.

---

## 0. Alcance y decisiones cerradas

### 0.1 Alcance funcional

1. Nueva vista **Pedidos** en Herramientas (escritorio) y en el panel Más
   (móvil). El menú móvil sigue teniendo exactamente cuatro pestañas:
   Inventario · Taller · Escanear · Más.
2. Crear un pedido **por proveedor** (un solo proveedor por pedido y por
   correo), eligiendo suministros y cantidades.
3. Por defecto se muestran los suministros **con poco stock** del proveedor
   elegido, listos para añadir.
4. Campo persistente en base de datos con el **email de compras**
   (`@alverlamp.es`), validado en formulario **y** en base de datos.
5. El correo del pedido incluye por línea: **referencia, EAN y cantidad**
   (además de nombre y formato), y los **datos del proveedor**.
6. El correo va dirigido al **email de compras**; además se envía al equipo un
   correo con asunto exacto **“Pedido realizado a compras”**.
7. **Seguimiento** de pedidos con estados, historial y detalle por línea.
8. **Conciliación automática**: al entrar stock de un suministro pedido, la
   línea se descuenta del pedido pendiente y desaparece cuando queda completa.
9. Nuevo campo **Referencia** en la ficha de producto (alta y edición), visible
   en la tarjeta y en los correos.
10. Corrección de la **altura de los selects Máquina y Proveedor** para que
    igualen a los inputs del resto de la ficha.
11. **Auditoría de botones y acciones**: ningún botón queda “muerto” tras
    pulsarlo, se bloquea durante la petición, muestra progreso y confirma el
    resultado; se impiden dobles clics.

### 0.2 Decisiones de diseño

| Tema | Decisión |
| --- | --- |
| Un proveedor por pedido | `purchase_orders.supplier_id` + validación de que cada línea pertenece a ese proveedor. |
| Destinatario del pedido | **Email de compras**, no el proveedor. Los datos del proveedor van en el cuerpo para que compras lo reenvíe. |
| Email de compras | Ajuste global en `app_settings` (`purchase_email`), no por usuario. |
| Equipo destinatario | Perfiles con `notify_low_stock = true` (misma convención que avisos de stock y servicio técnico). |
| Estados | `draft`, `sent`, `partial`, `received`, `cancelled`. |
| Historial | Inmutable, tabla `purchase_order_events` poblada por trigger (mismo patrón que `maintenance_request_events`). |
| Datos históricos | El pedido guarda **copias** de nombre, referencia, EAN, unidad y datos del proveedor: cambiar el producto después no altera pedidos antiguos. |
| Conciliación | Trigger de base de datos sobre `stock_movements` (`entry`) → robusto para stepper, escáner y edición de cantidad. |
| Correo fallido | El pedido queda en `draft` con aviso de error y botón “Reintentar envío”; no se marca como enviado. |
| Permisos | RLS `authenticated`, igual que el resto del inventario compartido. |
| Referencia | Texto libre, opcional, sin unicidad forzada (puede repetirse entre proveedores); se recorta y se indexa. |

### 0.3 Fuera de alcance (para otra iteración)

- Envío directo al proveedor.
- Precios, plazos de entrega e historial de compras por proveedor.
- Recepción parcial guiada con albarán.
- Aprobaciones o roles (quién puede enviar a compras).

---

## 1. Modelo de datos

Migración nueva propuesta:
`supabase/migrations/20261102120000_purchase_orders.sql`
(una sola migración para referencia, ajustes, pedidos, líneas, historial y
triggers, aplicada con `supabase db push`).

### 1.1 `products.reference`

```sql
alter table public.products add column if not exists reference text;
create index if not exists products_reference_idx on public.products (reference);
```

- Editable en alta (`#add-reference`) y edición (`#edit-reference`).
- Se guarda con `trim()`; vacío → `null`.
- Se muestra en la tarjeta del inventario junto al EAN (`meta`) y en el buscador
  (`renderProductList` incluye `p.reference` en el filtro).
- Se copia a `purchase_order_items.product_reference` al crear el pedido.

### 1.2 Ajustes de la aplicación (email de compras)

```sql
create table public.app_settings (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,

  constraint app_settings_purchase_email_domain check (
    key <> 'purchase_email'
    or lower(value) ~ '^[a-z0-9._%+-]+@alverlamp\.es$'
  )
);
```

- Fila única lógica: `('purchase_email', 'compras@alverlamp.es')`.
- Validación en BD (CHECK) además de la del formulario: aunque alguien llame a
  la API directamente, no puede guardar otro dominio.
- `updated_at` con el trigger `set_updated_at()` ya existente.

### 1.3 `purchase_orders`

```sql
create table public.purchase_orders (
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

create index purchase_orders_status_created_idx
  on public.purchase_orders (status, created_at desc);
create index purchase_orders_supplier_idx
  on public.purchase_orders (supplier_id);
```

- `order_number` se muestra como `PED-0007` (`String(n).padStart(4, '0')`).
- `supplier_email` / `supplier_phone` son copia en el momento del pedido.
- `supplier_id` puede ser `null` si el proveedor se borra (no se puede borrar
  mientras tenga pedidos por `on delete restrict`; el `null` es defensivo).
- `updated_at` con trigger `set_updated_at()`.

### 1.4 `purchase_order_items`

```sql
create table public.purchase_order_items (
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

create index purchase_order_items_order_idx
  on public.purchase_order_items (order_id);
create index purchase_order_items_pending_product_idx
  on public.purchase_order_items (product_id, status)
  where status in ('pending', 'partial');
create unique index purchase_order_items_unique_product
  on public.purchase_order_items (order_id, product_id)
  where product_id is not null;
```

- La copia (`product_name`, `product_reference`, `product_ean`, `unit`) es el
  histórico: el correo y el seguimiento no cambian si se edita el producto.
- `quantity_received` se incrementa por conciliación automática o manual.
- Trigger `validate_purchase_order_item_supplier()` en `before insert`:
  comprueba que `products.supplier_id = purchase_orders.supplier_id` y aborta
  con mensaje claro si no coincide (un pedido = un proveedor).

### 1.5 `purchase_order_events`

```sql
create table public.purchase_order_events (
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

create index purchase_order_events_order_idx
  on public.purchase_order_events (order_id, created_at asc);
```

- Trigger `log_purchase_order_event()` en `after insert or update of status`
  (mismo patrón que `maintenance_request_events`).
- La conciliación escribe notas del tipo:
  `Recepción automática: 4 uds (entrada de stock)`.
- RLS: `select` e `insert` para `authenticated`; el resto por trigger
  `security definer`.

### 1.6 Función de conciliación

```sql
create or replace function public.allocate_entry_to_purchase_orders(
  p_product_id uuid,
  p_quantity numeric
) returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_remaining numeric := p_quantity;
  v_line record;
  v_take numeric;
begin
  if p_product_id is null or p_quantity is null or p_quantity <= 0 then
    return;
  end if;

  for v_line in
    select i.id, i.order_id, i.quantity_requested, i.quantity_received
    from public.purchase_order_items i
    join public.purchase_orders o on o.id = i.order_id
    where i.product_id = p_product_id
      and i.status in ('pending', 'partial')
      and o.status in ('sent', 'partial')
    order by o.created_at asc, i.created_at asc
  loop
    v_take := least(v_remaining, v_line.quantity_requested - v_line.quantity_received);
    if v_take > 0 then
      update public.purchase_order_items
         set quantity_received = quantity_received + v_take,
             status = case
               when quantity_received + v_take >= quantity_requested then 'received'
               else 'partial'
             end
       where id = v_line.id;

      insert into public.purchase_order_events (order_id, status, previous_status, source, note)
      values (v_line.order_id, 'partial', null, 'system',
              format('Recepción automática: %s uds', v_take));

      v_remaining := v_remaining - v_take;
    end if;
    exit when v_remaining <= 0;
  end loop;
end;
$$;
```

Y el estado del pedido se recalcula con `refresh_purchase_order_status(order_id)`:

```sql
-- Reglas
-- 1. Si todas las líneas están 'received' o 'cancelled' → 'received', closed_at = now().
-- 2. Si alguna línea tiene quantity_received > 0 → 'partial'.
-- 3. Si ninguna tiene recepción → 'sent' (si ya se envió) o 'draft'.
-- 4. 'cancelled' es terminal y se respeta.
```

Disparador:

```sql
create trigger stock_movements_allocate_purchase_orders
after insert on public.stock_movements
for each row
when (new.movement_type = 'entry' and new.quantity_delta > 0 and new.product_id is not null)
execute function public.handle_stock_entry_for_purchase_orders();
```

`handle_stock_entry_for_purchase_orders()` llama a
`allocate_entry_to_purchase_orders(new.product_id, new.quantity_delta)` y
después refresca los pedidos afectados.

Notas importantes:

- Solo `movement_type = 'entry'`. No concilia `initial` (alta de producto),
  `baseline` ni `withdrawal`.
- **Riesgo asumido:** subir la cantidad desde “Editar suministro” cuenta como
  entrada y concilia. Se mitiga mostrando el resultado en un aviso y
  permitiendo corregir la línea desde el detalle del pedido
  (“Ajustar recibido” / “Reabrir línea”).
- La conciliación es **FIFO por pedido más antiguo** y nunca supera lo pedido.
- Recepciones parciales: la línea queda `partial` con el pendiente restante y
  sigue visible en Seguimiento; cuando llega el total, pasa a `received` y
  desaparece de la lista de pendientes.

### 1.7 RLS

```sql
alter table public.app_settings enable row level security;
alter table public.purchase_orders enable row level security;
alter table public.purchase_order_items enable row level security;
alter table public.purchase_order_events enable row level security;

-- Lectura para todo el equipo autenticado; escritura de pedidos y líneas también.
-- app_settings: lectura para authenticated; update solo authenticated (el CHECK
-- protege el dominio). Los eventos solo se insertan por trigger.
```

Políticas explícitas, siguiendo el estilo del esquema actual
(`usuarios_ven_*`, `usuarios_crean_*`, etc.).

### 1.8 Actualización de `supabase/schema.sql`

Añadir las tablas, índices, triggers y políticas en el mismo orden lógico que
la migración, y actualizar el comentario de cabecera del esquema.

---

## 2. Navegación y estructura de la vista

### 2.1 Escritorio

En `index.html`, dentro de `.nav-group-tools` (Herramientas), entre
“Proveedores” y “Análisis”:

```html
<button type="button" class="tab-btn" data-view="orders">
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
    <path d="M6 4h12l2 4v12H4V8l2-4zM4 8h16M9 13h6M9 17h4"/>
  </svg>
  <span>Pedidos</span>
</button>
```

### 2.2 Móvil

- El botón de la barra inferior sigue siendo **Más** (cuatro pestañas).
- Se añade una entrada en `openMoreMenu()`:

```html
<button type="button" class="more-menu-item" data-menu-view="orders">
  <svg ...>...</svg>
  <span>Pedidos</span>
</button>
```

- `updateNavState()` debe marcar “Más” como activo también en `orders`:

```js
isMobileNav() && ["add", "analytics", "profile", "orders"].includes(name)
```

### 2.3 Registro en la app

- `const VIEWS = ["list", "machines", "add", "scan", "suppliers", "analytics", "orders", "profile"];`
- `showView("orders")` → `showOrdersSection(activeOrdersSection)` (igual que
  `analytics`), y `loadPurchaseEmail()` al entrar.

### 2.4 Markup propuesto

```html
<main id="view-orders" class="view hidden">
  <div class="analytics-subnav" role="tablist" aria-label="Secciones de pedidos">
    <button type="button" class="orders-view-btn active" data-orders-view="new"
            role="tab" aria-selected="true">Nuevo pedido</button>
    <button type="button" class="orders-view-btn" data-orders-view="tracking"
            role="tab" aria-selected="false">Seguimiento</button>
  </div>

  <!-- Panel: Nuevo pedido -->
  <section id="orders-panel-new" class="orders-panel">
    <div id="purchase-email-banner" class="purchase-email-banner">
      <div>
        <span class="purchase-email-label">Email de compras</span>
        <strong id="purchase-email-value">—</strong>
      </div>
      <button type="button" id="edit-purchase-email-btn" class="btn btn-outline">
        Cambiar
      </button>
    </div>

    <div class="field">
      <label for="order-supplier">Proveedor *</label>
      <select id="order-supplier"><option value="">Elige un proveedor</option></select>
      <small class="field-hint">Cada pedido se envía a un único proveedor.</small>
    </div>

    <div class="order-picker-head">
      <label class="switch-row-inline">
        <input type="checkbox" id="order-low-only" checked />
        <span>Solo poco stock</span>
      </label>
      <input type="search" id="order-product-search" placeholder="Buscar suministro..." />
    </div>

    <div id="order-product-picker" class="order-product-picker"></div>

    <h3 class="section-subtitle">Pedido</h3>
    <div id="order-cart" class="order-cart"></div>
    <div id="order-cart-empty" class="empty-state">Añade suministros desde la lista.</div>

    <div class="field">
      <label for="order-note">Observaciones para compras</label>
      <textarea id="order-note" rows="3" placeholder="Plazo, urgencia, referencias alternativas..."></textarea>
    </div>

    <div class="order-summary" id="order-summary">0 referencias · 0 unidades</div>
    <button type="button" id="order-save-draft" class="btn btn-outline">Guardar borrador</button>
    <button type="button" id="order-send" class="btn btn-primary">Enviar pedido a compras</button>
  </section>

  <!-- Panel: Seguimiento -->
  <section id="orders-panel-tracking" class="orders-panel hidden">
    ...filtros, contadores y #orders-list...
  </section>
</main>
```

Se reutilizan `.analytics-subnav`, `.table-shell`, `.modal-backdrop`,
`.section-header` y `.btn` para no inventar un lenguaje visual nuevo.

---

## 3. Flujo “Nuevo pedido”

1. **Cargar email de compras** al abrir Pedidos. Si no existe o no es válido:
   banner en rojo, botón “Enviar” deshabilitado y aviso
   “Configura el email de compras antes de enviar pedidos”.
2. **Elegir proveedor** (`#order-supplier`). Al cambiar:
   - se limpia el carrito si contiene productos de otro proveedor (con
     confirmación),
   - la lista de suministros se filtra a `supplier_id = proveedor`.
3. **Lista de suministros** (`#order-product-picker`):
   - por defecto `order-low-only = true` → solo `isLowStock(p)`;
   - orden: primero los más críticos (cobertura/mínimo) y luego por nombre;
   - cada fila muestra: nombre, referencia, EAN, stock actual, mínimo, unidad y
     botón “Añadir”;
   - cantidad sugerida: `Math.max(1, min_quantity - quantity)`;
   - si un suministro no tiene proveedor, no aparece (aviso con enlace a editar
     la ficha);
   - búsqueda por nombre, referencia y EAN.
4. **Carrito** (`#order-cart`): por línea, referencia/nombre, cantidad
   editable (`input[type=number] min=1`), botón “Quitar”, subtotal.
   - Se impide duplicar producto: si ya está, se incrementa la cantidad.
   - `#order-summary` recalcula referencias y unidades en cada cambio.
5. **Guardar borrador**: crea `purchase_orders` en `draft` + líneas, sin enviar
   correo. Toast “Borrador guardado” y paso a Seguimiento.
6. **Enviar pedido a compras**:
   1. Validaciones locales: email de compras válido, proveedor elegido,
      carrito no vacío, todas las cantidades > 0.
   2. Bloqueo del botón con `withBusy(..., "Enviando...")`.
   3. Insert del pedido (`status = 'sent'`, `sent_at`, `purchase_email`,
      `requested_by`, copia del proveedor) y de las líneas.
   4. Envío del **correo 1** (compras) y del **correo 2** (equipo).
   5. Si ambos OK → `emails_sent = true`, `emails_sent_at`, toast
      “Pedido PED-0007 enviado a compras”, limpiar carrito y mostrar
      Seguimiento con el pedido arriba.
   6. Si falla el correo → el pedido queda en `draft`, toast de error largo con
      el motivo y botón “Reintentar envío” en el detalle. Los datos ya están
      guardados: no se pierde el trabajo.
7. **Modal de email de compras** (`#purchase-email-modal`):
   - input `type=email`, valor actual, texto de ayuda “Solo @alverlamp.es”;
   - validación de dominio en cliente y en BD (CHECK);
   - botón “Guardar” con estado ocupado; toast “Email de compras actualizado”;
   - el cambio solo afecta a pedidos nuevos (los antiguos conservan su copia).

### 3.1 Texto y estados de los botones

| Botón | Estado normal | Estado ocupado | Estado final |
| --- | --- | --- | --- |
| Enviar pedido a compras | “Enviar pedido a compras” | spinner + “Enviando…” y `disabled` | vuelve a normal + toast + vista Seguimiento |
| Guardar borrador | “Guardar borrador” | “Guardando…” | toast + pedido visible |
| Añadir (fila) | “Añadir” | se transforma en “Añadido ✓” 900 ms | vuelve a “Añadir”; si ya está, “En el pedido” deshabilitado |
| Quitar (carrito) | × | `disabled` mientras recalcula | línea eliminada + toast breve |
| Guardar email | “Guardar” | “Guardando…” | “Guardado ✓” + banner actualizado |

---

## 4. Flujo “Seguimiento”

### 4.1 Lista

- Contadores en cabecera: **Pendientes**, **Parciales**, **Recibidos** (últimos
  90 días).
- Filtros: estado (`Todos`, `Enviados`, `Parciales`, `Recibidos`,
  `Cancelados`), proveedor, búsqueda por número/proveedor/referencia.
- Tarjeta de pedido:
  ```
  PED-0007 · Proveedor X            [Enviado]
  30/10/2026 · 3 referencias · 18 uds · 4 pendientes
  ```
- Orden: pendientes primero, luego por fecha descendente.
- Clic en tarjeta → modal de detalle.
- Estado vacío: “Todavía no hay pedidos. Crea el primero desde Nuevo pedido.”

### 4.2 Detalle

- Cabecera: número, estado (chip), fecha, solicitante, email de compras usado.
- Bloque proveedor: nombre, email, teléfono (copia histórica).
- Tabla de líneas: Referencia · Suministro · EAN · Pedido · Recibido ·
  Pendiente · Estado.
- Historial (`purchase_order_events`): fecha, usuario, cambio de estado y nota.
- Observaciones del pedido.
- Acciones:
  - **Reenviar correo** (si `emails_sent = false` o tras un fallo).
  - **Marcar como recibido** (confirmación; pone todas las líneas a
    `received` y cierra el pedido).
  - **Ajustar recibido** por línea (corrige conciliaciones automáticas
    erróneas; escribe evento `source = 'user'`).
  - **Cancelar pedido** (confirmación; líneas `cancelled`, pedido `cancelled`,
    deja de conciliar).
- Todas las acciones con `withBusy`, confirmación cuando son destructivas y
  toast con el resultado.

### 4.3 Reglas de visibilidad

- `draft`: solo en “Borradores” (no cuenta como pendiente de recepción).
- `sent` / `partial`: en Pendientes.
- `received`: en Recibidos.
- `cancelled`: en Cancelados.
- Una línea deja de mostrarse como pendiente en cuanto
  `quantity_received >= quantity_requested`; si es parcial, sigue apareciendo
  con el pendiente restante.

---

## 5. Correos

### 5.1 Correo 1 — al email de compras

**Para:** `app_settings.purchase_email`
**Asunto:** `Pedido a compras · PED-0007 · Proveedor X`

```
Pedido PED-0007
Fecha: 30/10/2026 10:12
Solicitado por: nombre@alverlamp.es

PROVEEDOR
Nombre: Proveedor X
Email: pedidos@proveedor.com
Teléfono: 961 234 567

LÍNEAS (3)
1. Ref. 12345 · EAN 8412345678901
   Papel fotográfico A4 · 6 Paquete
   Stock actual: 1 · Mínimo: 4
2. ...

Total: 18 unidades

Observaciones: ...
```

Versión HTML: tabla de 4 columnas (Referencia, EAN, Suministro, Cantidad) con
los datos del proveedor en un bloque superior. Escapado con `escapeHtml`.

### 5.2 Correo 2 — al equipo

**Para:** perfiles con `notify_low_stock = true` (excepto el propio
solicitante si se quiere evitar duplicado; se mantiene incluido por
simplicidad).
**Asunto exacto:** `Pedido realizado a compras`

```
Se ha enviado un pedido a compras.

Pedido: PED-0007
Proveedor: Proveedor X
Destinatario: compras@alverlamp.es
Líneas: 3 (18 unidades)
Solicitado por: nombre@alverlamp.es

Detalle:
- Ref. 12345 · Papel fotográfico A4 · 6
...

Puedes seguirlo en Pedidos → Seguimiento.
```

### 5.3 Implementación del envío

- Extraer de `sendServiceRequestEmail()` un helper genérico:

  ```js
  async function sendEmailViaProvider({ recipients, subject, text, html, attachments = [] })
  ```

  - EmailJS: una llamada por destinatario con
    `{ to_email, subject, message, html, ...variables }`.
  - Apps Script: `POST { emails, subject, text, html, attachments }`.
  - Si no hay proveedor configurado → error claro.
- `sendServiceRequestEmail()` y `sendLowStockEmail()` pasan a usar el helper
  (refactor sin cambio de comportamiento).
- Nuevo `sendPurchaseOrderEmails(order, items, { purchaseEmail, teamEmails, requesterEmail })`
  que envía los dos correos en secuencia y devuelve
  `{ purchaseSent, teamSent, errors[] }`.
- Variables EmailJS nuevas necesarias en la plantilla:
  `order_number`, `order_subject`, `order_html`, `order_text`,
  `supplier_name`, `purchase_email`, `line_count`, `order_url`.
  **Requisito:** la plantilla debe usar `{{subject}}` como asunto y
  `{{message}}` como cuerpo; sin eso el correo saldrá con el asunto por
  defecto.
- El asunto del correo 2 se pasa literal: `Pedido realizado a compras`.
- Apps Script ya limita destinatarios a `TEAM_EMAILS`; **hay que añadir el
  email de compras a `TEAM_EMAILS`** o el envío se rechazará cuando se use esa
  vía. Se documenta en `README.md` al implementar.

### 5.4 Validación de destinatarios

- Email de compras: regex `^[^@\s]+@alverlamp\.es$` (ignorando mayúsculas) en
  cliente, CHECK en `app_settings` y CHECK en `purchase_orders.purchase_email`.
- Correo del equipo: solo perfiles `@alverlamp.es`; se filtran direcciones
  vacías o de otro dominio antes de enviar.

---

## 6. Conciliación automática (resumen operativo)

| Escenario | Resultado |
| --- | --- |
| Pedido 6 uds, entra stock de 6 | Línea `received`, pedido `received`, sale de pendientes. |
| Pedido 6 uds, entran 2 | Línea `partial` (2/6), pedido `partial`, sigue en pendientes con 4. |
| Pedido 6 uds, entran 10 | Se concilian 6 y sobran 4 como stock normal. |
| Dos pedidos abiertos del mismo producto | Se concilia primero el más antiguo (FIFO). |
| Entrada de un producto sin pedido | Sin efecto en pedidos. |
| Salida de stock | Sin efecto en pedidos. |
| Alta de producto con cantidad inicial | No concilia (`initial`). |
| Pedido cancelado | No concilia. |
| Corrección manual de cantidad al alza | Concilia (documentado y reversible). |

Cada conciliación deja un evento `system` con la cantidad y el pedido, y un
toast al usuario que provocó la entrada:
“Pedido PED-0007: 2 uds marcadas como recibidas”.

---

## 7. Ficha de producto: Referencia y altura de los selects

### 7.1 Referencia

- Alta (`index.html`, `#form-add-product`): nuevo campo junto a EAN o en la
  misma fila:

  ```html
  <div class="field">
    <label for="add-reference">Referencia del proveedor</label>
    <input type="text" id="add-reference" placeholder="Ej: PF-A4-200" />
  </div>
  ```

- Edición (`openEditModal`): `#edit-reference` con el valor actual.
- `insert` y `update` incluyen `reference: value.trim() || null`.
- `renderProductList`: añadir `p.reference` al meta y al filtro de búsqueda.
- `populateDatalists`: opcional, añadir referencias conocidas como `datalist`.
- Correos de pedido y servicio técnico: la referencia se incluye cuando existe.

### 7.2 Altura de Máquina y Proveedor

Causa: los `<select>` no heredan la altura efectiva de los `<input>` (padding
distinto según navegador, `line-height` y ausencia de `box-sizing` explícito).

Corrección en `style.css`:

```css
.field input,
.field select,
.field textarea {
  width: 100%;
  min-height: 46px;
  padding: 12px 13px;
  border: 1px solid var(--line);
  background: var(--surface);
  color: var(--ink);
  border-radius: 12px;
  font-size: 15px;
  line-height: 20px;
  box-sizing: border-box;
}

.field select {
  height: 46px;
  appearance: none;
  -webkit-appearance: none;
  padding-right: 38px;
  background-image: url("data:image/svg+xml,..."); /* chevron */
  background-repeat: no-repeat;
  background-position: right 12px center;
  background-size: 16px;
  cursor: pointer;
}

.field textarea {
  min-height: 84px;
  resize: vertical;
}
```

- Aplica a alta y edición porque ambas usan `.field` + `.two-col`.
- Verificar en iOS Safari y Chrome escritorio que Máquina, Proveedor, Formato y
  Ubicación quedan a la misma altura (captura a 375 px y a 1440 px).

---

## 8. Auditoría de botones y acciones

### 8.1 Problema actual

- No existe ninguna regla `.btn:disabled` ni estado “ocupado” en `style.css`.
- Varias acciones asíncronas no bloquean el botón, así que se puede pulsar dos
  veces y duplicar registros (pedidos, solicitudes, proveedores, movimientos).
- Algunos botones no dan señal tras el clic (stepper +/−, cambiar estado de una
  solicitud, reintentar correo, cargar más movimientos).
- Los modales se pueden abrir dos veces por doble clic en la fila.

### 8.2 Base común (implementar primero)

1. Helper `withBusy(button, busyLabel, task)`:

   ```js
   async function withBusy(button, busyLabel, task) {
     if (!button || button.dataset.busy === "true") return undefined;
     const original = button.innerHTML;
     button.dataset.busy = "true";
     button.disabled = true;
     button.setAttribute("aria-busy", "true");
     button.innerHTML = `<span class="btn-spinner" aria-hidden="true"></span>${escapeHtml(busyLabel)}`;
     try {
       return await task();
     } finally {
       button.disabled = false;
       button.dataset.busy = "false";
       button.removeAttribute("aria-busy");
       button.innerHTML = original;
     }
   }
   ```

2. Helper `flashSuccess(button, label = "Hecho ✓", ms = 900)` para acciones
   rápidas que no abren modal.
3. CSS:

   ```css
   .btn:disabled, .btn[aria-busy="true"] {
     opacity: .6;
     cursor: not-allowed;
     transform: none;
     box-shadow: none;
   }
   .btn-spinner {
     width: 14px; height: 14px; border-radius: 50%;
     border: 2px solid currentColor; border-top-color: transparent;
     animation: btn-spin .7s linear infinite;
   }
   @keyframes btn-spin { to { transform: rotate(360deg); } }
   .btn.is-success { background: var(--teal); color: #fff; }
   ```

4. Regla global anti doble envío para todos los `<form>`:

   ```js
   document.querySelectorAll("form").forEach((form) => {
     form.addEventListener("submit", () => {
       const submit = form.querySelector('button[type="submit"]');
       if (submit) submit.disabled = true;
     });
   });
   ```

   (Se rehabilita explícitamente al terminar el handler o en `finally`.)
5. Bloqueo de apertura de modales: si ya existe `.modal-backdrop`, no abrir otro.
6. `showToast` para confirmar **todas** las acciones, con texto en pasado
   (“Pedido enviado”, “Suministro actualizado”, “Estado actualizado”).

### 8.3 Inventario de acciones a corregir

| # | Acción / handler | Archivo·línea aprox. | Problema | Cambio requerido |
| --- | --- | --- | --- | --- |
| 1 | Login `#form-login` | `app.js:194` | doble submit | `withBusy` + “Entrando…” |
| 2 | Registro `#form-register` | `app.js:203` | doble submit | `withBusy` + “Creando cuenta…” |
| 3 | Reset contraseña | `app.js:166` | sin feedback | `withBusy` + “Guardando…” |
| 4 | “¿Olvidaste tu contraseña?” | `app.js:144` | sin estado | spinner + toast |
| 5 | Cerrar sesión | `app.js:226` | sin estado | `withBusy` + “Saliendo…” |
| 6 | Cambiar contraseña | `app.js:461` | sin bloqueo | `withBusy` + validación y toast |
| 7 | Eliminar cuenta | `app.js:486` | sin bloqueo | confirmación + `withBusy` |
| 8 | Cargar más movimientos | `app.js:883` | botón estático | `withBusy` + “Cargando…” + ocultar al terminar |
| 9 | Editar proveedor (fila) | `app.js:924` | doble modal | guard de modal abierto |
| 10 | Borrar proveedor | `app.js:928` | sin bloqueo | confirmación + `withBusy` |
| 11 | Guardar proveedor | `app.js:983` | doble insert | `withBusy` + “Guardando…” |
| 12 | Nueva máquina / proveedor (abrir modal) | `app.js:1019/1799` | doble modal | guard |
| 13 | Guardar máquina | `app.js:1131` | doble insert | `withBusy` |
| 14 | Activar/desactivar máquina | `app.js:1085` | botón estático | `withBusy` + texto “Activando…” |
| 15 | Cambiar estado solicitud | `app.js:1355` | select sin confirmación visual | `disabled` + “Actualizando…” + chip con nuevo estado |
| 16 | Reintentar email solicitud | `app.js:1351` | doble envío | `withBusy` + “Enviando…” |
| 17 | Enviar solicitud de servicio | `app.js:1551` | doble insert + fotos | `withBusy` + progreso “Subiendo fotos (2/6)” |
| 18 | Stepper +/− inventario | `app.js:2143` | clics rápidos, sin feedback | bloquear por producto, `aria-busy`, actualizar cantidad en sitio, toast |
| 19 | Abrir ficha al tocar tarjeta | `app.js:2137` | doble modal | guard |
| 20 | Guardar edición de producto | `app.js:2461` | doble update | `withBusy` + “Guardando…” |
| 21 | Eliminar producto | `app.js:2490` | sin bloqueo | confirmación + `withBusy` |
| 22 | Guardar suministro (alta) | `app.js:2547` | doble insert | `withBusy` + limpiar formulario + toast |
| 23 | Confirmar escaneo | `app.js:2688` | doble movimiento | `withBusy` + `disabled` + toast |
| 24 | +/− cantidad escaneo | `app.js:2680/2684` | sin límites claros | límites y estado visual |
| 25 | Escanear EAN en alta | `app.js:2507` | botón no refleja estado | texto “Detener escáner” + clase activa |
| 26 | Pedidos: enviar / guardar / email / detalle | nuevos | — | todos con `withBusy` y confirmación |

### 8.4 Criterios de aceptación de la auditoría

- Ningún botón que dispare red puede ejecutarse dos veces seguidas con el mismo
  estado.
- Todo botón asíncrono cambia de texto o muestra spinner mientras trabaja y se
  restaura al terminar (éxito o error).
- Toda acción termina con un mensaje explícito (toast) o con un cambio visible
  permanente en pantalla (chip de estado, cantidad, fila eliminada).
- Los errores muestran el motivo y no dejan la UI bloqueada.
- Navegación por teclado: `disabled` real, foco visible y `aria-busy` en los
  botones ocupados.
- Los botones de una sola pulsación (abrir modal) no abren dos modales.

---

## 9. Archivos a modificar

| Archivo | Cambio |
| --- | --- |
| `supabase/migrations/20261102120000_purchase_orders.sql` | nueva migración completa |
| `supabase/schema.sql` | esquema canónico actualizado |
| `index.html` | nav Herramientas, vista Pedidos, campo Referencia, modal email compras |
| `app.js` | estado y carga de pedidos, picker, carrito, envíos, seguimiento, conciliación visible, `withBusy`, referencia, guard de modales |
| `style.css` | selects a 46 px, estilos de Pedidos, `.btn:disabled`, spinner, banner email, chips de estado |
| `MEJORAS.md` | marcar 3.1 como planificada/en curso y enlazar este documento |
| `README.md` | migración nueva, requisito `TEAM_EMAILS` con email de compras y plantilla EmailJS |
| `AGENTS.md` | memoria de la sesión y siguiente paso |
| `public/*` | regenerado por `npm run build` |

---

## 10. Orden de ejecución sugerido (próxima sesión)

1. **Migración** `purchase_orders` + `products.reference` + `app_settings`;
   `supabase db push`; verificar triggers con SQL de prueba.
2. **Referencia** en alta, edición, tarjeta y búsqueda.
3. **Selects** a 46 px y revisión visual en móvil/escritorio.
4. **Helper `withBusy` + CSS de estados** y aplicación a las acciones 1–25 de
   la tabla (se puede dividir en dos pasadas).
5. **Navegación y vista Pedidos** (markup + estilos).
6. **Nuevo pedido**: email de compras, proveedor, picker, carrito, guardado.
7. **Correos**: refactor del helper, dos plantillas, envío y reintento.
8. **Seguimiento**: lista, filtros, detalle, historial, acciones manuales.
9. **Conciliación visible**: toast al entrar stock y chip “En pedido” en la
   ficha del producto (opcional si el tiempo aprieta).
10. **`npm run check`, `npm run build`**, pruebas manuales y despliegue.
11. Actualizar `AGENTS.md`, `MEJORAS.md` y `README.md` con el resultado.

---

## 11. Pruebas / QA

### Base de datos

- [ ] Insertar pedido con email de compras `@gmail.com` → falla por CHECK.
- [ ] Insertar línea con producto de otro proveedor → falla por trigger.
- [ ] Entrada de 2 uds en producto pedido → línea `partial` y evento `system`.
- [ ] Entrada del resto → línea `received`, pedido `received`, `closed_at`.
- [ ] Dos pedidos abiertos → FIFO (se concilia el más antiguo).
- [ ] Alta de producto con cantidad inicial → no concilia.
- [ ] Pedido cancelado → no concilia.
- [ ] `delete` de producto con línea histórica → la línea conserva la copia.

### UI

- [ ] Pedidos aparece en Herramientas (escritorio) y en Más (móvil).
- [ ] Menú móvil sigue con 4 pestañas a 375 px.
- [ ] Sin email de compras → envío bloqueado con aviso claro.
- [ ] Solo aparecen suministros del proveedor elegido.
- [ ] “Solo poco stock” activo por defecto y desactivable.
- [ ] Cantidad sugerida = faltante hasta el mínimo (mínimo 1).
- [ ] No se puede añadir dos veces el mismo producto.
- [ ] Doble clic en “Enviar” genera un único pedido.
- [ ] Fallo de correo → pedido en borrador + reintento disponible.
- [ ] Correo 1 contiene referencia, EAN, cantidad y datos del proveedor.
- [ ] Correo 2 tiene exactamente el asunto “Pedido realizado a compras”.
- [ ] Entrada de stock descuenta el pendiente y avisa.
- [ ] Pedido completo desaparece de pendientes.
- [ ] Máquina y Proveedor tienen la misma altura que el resto de campos.
- [ ] La referencia se guarda, se muestra y se busca.

---

## 12. Riesgos y decisiones abiertas

1. **Conciliación por edición manual de cantidad**: subir stock desde la ficha
   cuenta como recepción. Aceptado con aviso y corrección manual disponible.
2. **EmailJS**: la plantilla debe admitir `{{subject}}` y `{{message}}`; si no,
   el correo 2 no llevará el asunto exigido. Verificar antes de desplegar.
3. **Apps Script**: requiere añadir el email de compras a `TEAM_EMAILS`.
4. **Sin SMTP propio**: los avisos internos funcionan, pero un buzón de compras
   externo al equipo de Supabase no recibiría confirmaciones de cuenta (no
   afecta a Pedidos).
5. **Duplicados de referencia**: no se fuerza unicidad; si más adelante se
   quiere, añadir índice único por `(supplier_id, reference)`.
6. **Pedidos muy grandes**: límite de 50 destinatarios del endpoint no aplica a
   líneas; conviene limitar a ~100 líneas por pedido en el picker.
7. **`products.category`**: sigue pendiente de eliminar en una migración
   posterior; no mezclar con esta.

---

## 13. Definición de “hecho”

- Migración aplicada en remoto y `schema.sql` sincronizado.
- Pedidos visible y funcional en escritorio y móvil.
- Dos correos enviados con el contenido y asunto especificados.
- Seguimiento con estados e historial operativo.
- Conciliación automática verificada con los casos de la sección 11.
- Referencia disponible en alta, edición, tarjeta, búsqueda y correos.
- Selects Máquina/Proveedor alineados visualmente.
- Auditoría de botones aplicada a todas las acciones de la tabla 8.3.
- `npm run check` y `npm run build` en verde, desplegado y verificado en
  producción.
