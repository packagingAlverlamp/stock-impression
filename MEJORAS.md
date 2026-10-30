# Propuestas de mejora — Stock Impresión

Documento de trabajo con ideas priorizadas por impacto y esfuerzo. No todas
requieren desarrollo: algunas son cambios de configuración o de flujo.

---

## 0. Ya implementado en esta iteración

- Configuración local reparada y generación automática de `config.js` desde
  `.env.local` (con validación).
- Registro limitado a emails `@alverlamp.es`, con validación en el formulario
  y bloqueo real en Supabase mediante trigger.
- Cierre de los relays de email: `/api/send-email` exige secreto, CORS
  restringido y destinatarios validados; Apps Script solo envía a
  `TEAM_EMAILS`; eliminado `send_email.php`.
- Corregido el cierre de sesión al eliminar la cuenta.
- Corregido el estado del escáner cuando falla la cámara.
- Corregido el mensaje de registro cuando Supabase exige confirmar email.
- Evitado restar stock cuando ya está a cero.
- Re-renderizado al cruzar el breakpoint móvil/escritorio.
- Cabeceras de seguridad en Vercel.

---

## 1. Prioridad alta: impacto operativo inmediato

### 1.1 Stock atómico y botón “Deshacer”

**Problema:** hoy la cantidad se calcula en el navegador y se escribe como
valor absoluto. Dos personas escaneando a la vez pueden pisarse y dejar el
stock incorrecto. Además, un escaneo equivocado obliga a corregir a mano.

**Propuesta:**
- RPC en Postgres `apply_stock_delta(product_id, delta)` que haga
  `quantity = greatest(0, quantity + delta)` dentro de una transacción.
- Devolver el movimiento creado para actualizar la UI sin recargar.
- Tras un movimiento manual, mostrar un toast con “Deshacer” durante 5–8 s.
  Deshacer crea un movimiento inverso de tipo `adjustment` (habría que añadir
  ese valor al enum).
- Test SQL para concurrencia y para no bajar de cero.

**Impacto:** alto · **Esfuerzo:** medio.

### 1.2 Avisos de stock fiables desde servidor

**Problema:** el email se envía desde el cliente, antes de marcar el aviso como
enviado, y los errores se ignoran. Si falla EmailJS, nadie se entera y el
producto queda marcado como notificado. Dos usuarios pueden duplicar el aviso.

**Propuesta:**
- Tabla `notification_outbox` con estado (`pending`, `sent`, `failed`),
  intentos y fecha.
- Un cron o Edge Function procesa la cola y reintenta con backoff.
- Al cruzar el mínimo, un trigger encola el aviso de forma atómica (solo si
  `low_stock_notified = false`).
- Registrar el resultado y mostrar en perfil/analítica los avisos fallidos.
- Separar “avisos de stock” de “solicitudes técnicas” en preferencias.

**Impacto:** alto · **Esfuerzo:** medio-alto.

### 1.3 Panel de inicio operativo

**Problema:** al entrar se ve el inventario completo, pero no lo urgente.

**Propuesta:** una vista “Hoy” con:
- Agotados y bajo mínimo, ordenados por cobertura estimada.
- Solicitudes de servicio abiertas y su antigüedad.
- Últimos movimientos del equipo.
- Acciones rápidas: escanear salida, añadir entrada, pedir reposición.
- Filtro por máquina y por proveedor.

**Impacto:** alto · **Esfuerzo:** bajo-medio (con los datos actuales ya se
puede calcular casi todo en cliente).

### 1.4 Escaneo continuo con carrito

**Problema:** hoy cada lectura abre una tarjeta y hay que confirmar. Para
recepción de pedidos o inventario es lento.

**Propuesta:**
- Modo “carrito”: acumula lecturas y cantidades, permite revisar y confirmar
  todo de una vez.
- Sonido/vibración distinta para código desconocido.
- Evitar lecturas duplicadas del mismo código en menos de X segundos.
- Botón “Introducir EAN a mano” siempre visible.

**Impacto:** alto · **Esfuerzo:** medio.

### 1.5 Confirmación y deshacer en acciones destructivas

**Problema:** borrar un suministro, proveedor o máquina usa `confirm()` del
navegador; no hay deshacer y el texto de la máquina dice “Eliminar” cuando en
realidad archiva.

**Propuesta:**
- Modal propio con el nombre del elemento y consecuencia exacta.
- Renombrar “Eliminar” a “Archivar” cuando corresponda.
- Soft delete (`deleted_at`) para productos y proveedores, con papelera y
  restauración durante 30 días.
- Toast con “Deshacer” tras movimientos de stock.

**Impacto:** medio-alto · **Esfuerzo:** medio.

---

## 2. Usabilidad

| Mejora | Por qué | Esfuerzo |
|---|---|---|
| Búsqueda por EAN y escaneo directo en la barra | Agiliza consultas y evita navegar a Escanear | Bajo |
| Filtros persistentes (categoría, máquina, proveedor, “poco stock”) | Se pierden al recargar y el equipo repite la misma selección | Bajo |
| Guardar filtros favoritos por persona | Cada rol mira cosas distintas | Medio |
| Historial con filtros por fecha, usuario y tipo | Hoy solo se puede filtrar por suministro y tipo | Bajo |
| Detalle de movimiento con máquina, proveedor y nota | Facilita auditoría y explicar diferencias | Bajo |
| Importar inventario desde CSV | Alta inicial y migraciones más rápidas | Medio |
| Exportar inventario, movimientos y solicitudes a CSV/PDF | Informes para dirección y proveedores | Bajo-medio |
| Etiquetas imprimibles con EAN/QR | Evita etiquetas escritas a mano y errores de escaneo | Medio |
| Autocompletar y crear proveedor/máquina desde el alta | Menos cambios de contexto | Bajo |
| Validación y ayudas en formularios (unidades, ubicaciones) | Menos datos inconsistentes | Bajo |
| Modales accesibles: foco atrapado, ESC, `role="dialog"`, `aria-modal` | Hoy no son navegables con teclado | Bajo |
| `aria-live` en toasts y estados de carga | Accesibilidad para lectores de pantalla | Bajo |
| Modo oscuro y respeto a `prefers-color-scheme` | Uso en almacén con poca luz | Bajo |
| Atajos de teclado y soporte de escáner USB | El escáner USB actúa como teclado; un input global acelera mucho | Bajo |
| Onboarding de 3 pasos y estados vacíos con acción | Mejora la primera experiencia | Bajo |
| Confirmación de email y mensajes de error más claros | Menos soporte interno | Bajo |
| Notificaciones in-app y realtime | Ver cambios de otros sin recargar | Medio |

---

## 3. Funcionalidades

### 3.1 Pedidos de reposición a proveedores

- Generar un pedido desde los productos bajo mínimo, agrupado por proveedor.
- Enviar el pedido por email al proveedor (no solo al equipo).
- Estados: borrador, enviado, recibido parcial, recibido, cancelado.
- Al recibir, crear entradas de stock automáticamente.
- Historial de precios y plazos de entrega por proveedor.

**Impacto:** muy alto · **Esfuerzo:** alto.

### 3.2 Solicitudes de servicio técnico completas

- Enviar la solicitud directamente al proveedor de la máquina, no solo al
  equipo.
- Adjuntar fotos del problema.
- Historial de estados con fecha y usuario (quién cambió qué).
- Prioridad, SLA y recordatorios si sigue pendiente.
- Plantillas de motivos frecuentes.

**Impacto:** alto · **Esfuerzo:** medio-alto.

### 3.3 Mantenimiento preventivo

- Planes por máquina: cada X días, X horas de uso o contador manual.
- Tareas con checklist y repuestos asociados.
- Aviso antes de vencer y generación automática de solicitud.
- Historial de intervenciones y coste.

**Impacto:** alto · **Esfuerzo:** alto.

### 3.4 Roles y permisos

- Roles: administrador, editor, solo lectura.
- Solo admin puede borrar, cambiar mínimos o gestionar usuarios.
- Auditoría de cambios (quién modificó qué y cuándo).
- Evita que una cuenta comprometida vacíe el inventario.

**Impacto:** alto · **Esfuerzo:** medio.

### 3.5 Stock por ubicación

- Varias ubicaciones/almacenes con stock independiente.
- Transferencias entre ubicaciones.
- Inventario físico con recuento y diferencias.
- Filtro por ubicación en inventario y analítica.

**Impacto:** medio-alto · **Esfuerzo:** alto.

### 3.6 Previsión y punto de pedido

- Consumo medio por producto y por máquina.
- Punto de pedido calculado con plazo de entrega y seguridad.
- Cantidad sugerida de compra.
- Estacionalidad y tendencia.
- Simulación “¿qué pasa si aumento la producción un 20%?”.

**Impacto:** alto · **Esfuerzo:** medio (con SQL y datos históricos).

### 3.7 Lotes, caducidad y trazabilidad

- Lote, fecha de caducidad y proveedor por entrada.
- Consumo FIFO/FEFO.
- Avisos de caducidad próxima.
- Especialmente útil para tintas, disolventes y químicos.

**Impacto:** medio · **Esfuerzo:** alto.

### 3.8 Etiquetas y códigos internos

- Generar etiquetas con EAN, nombre, máquina y ubicación.
- QR interno para productos sin EAN.
- Impresión en lote desde el inventario.

**Impacto:** medio · **Esfuerzo:** medio.

### 3.9 PWA y modo offline

- Instalable en móvil.
- Cache del inventario y cola de movimientos offline.
- Sincronización al recuperar conexión.
- Útil en almacén con mala cobertura.

**Impacto:** alto en móvil · **Esfuerzo:** alto.

### 3.10 Integraciones

- Webhooks al recibir stock bajo o crear solicitud.
- API para ERP/contabilidad.
- Importación/exportación programada.
- Notificaciones a Slack/Teams.

**Impacto:** medio · **Esfuerzo:** alto.

### 3.11 Costes y valoración

- Precio unitario y proveedor habitual.
- Valor del inventario y evolución.
- Coste de consumibles por máquina.
- Comparativa de precios entre proveedores.

**Impacto:** medio · **Esfuerzo:** medio.

---

## 4. Mejoras técnicas recomendadas

| Mejora | Detalle |
|---|---|
| Separar `app.js` en módulos | Hoy son ~2.300 líneas y 69 funciones; dividir por auth, inventario, máquinas, emails y UI. |
| Build con Vite/esbuild | Permite módulos, minificado, sourcemaps y caché con hash. |
| Tests | Vitest para cálculos de consumo y Playwright para flujos críticos (alta, escaneo, baja). |
| Migración base reproducible | `supabase db push` no reconstruye una base desde cero; crear una migración inicial o documentar schema.sql como única vía. |
| Analítica en SQL | Vista/RPC agregada en lugar de descargar todo el histórico y recorrerlo en el navegador. |
| Realtime de Supabase | Suscripción a `products`, `stock_movements` y `maintenance_requests`. |
| SRI y versiones fijadas | Supabase, html5-qrcode y EmailJS se cargan desde CDN sin `integrity`. |
| CSP | Añadir `Content-Security-Policy` cuando se fijen los CDNs y se eliminen estilos inline. |
| CI | Ejecutar `npm run check`, tests y validación de migraciones en cada push. |
| Monitorización | Sentry o similar para errores del frontend y de las funciones. |
| Copias de seguridad | Confirmar backups de Supabase y probar restauración. |
| Limpieza del repo | `sedGrid.pages`, `path/`, `public/` generado y `supabase/.temp/` no deberían trackearse. |

---

## 5. Roadmap sugerido

### Fase 1 — Quick wins (1–2 semanas)

1. RPC de stock atómico + “Deshacer”.
2. Panel de inicio con agotados, bajo mínimo y solicitudes abiertas.
3. Filtros persistentes y búsqueda por EAN.
4. Accesibilidad básica de modales y toasts.
5. Limpieza de artefactos del repo.

### Fase 2 — Operación (3–6 semanas)

1. Pedidos de reposición a proveedores.
2. Solicitudes técnicas enviadas al proveedor con fotos e historial.
3. Roles y permisos.
4. Realtime y notificaciones in-app.
5. Importación/exportación CSV.

### Fase 3 — Escala (2–3 meses)

1. Mantenimiento preventivo.
2. Previsión y punto de pedido.
3. PWA/offline.
4. Multi-ubicación y lotes/caducidad.
5. Integraciones y API.

---

## 6. Métricas para decidir si merece la pena

- Tiempo medio para dar de alta un suministro.
- Número de correcciones manuales de stock por semana.
- % de avisos de stock entregados correctamente.
- Tiempo entre “bajo mínimo” y “reposición recibida”.
- Solicitudes técnicas abiertas más de X días.
- % de productos con datos completos (máquina, proveedor, ubicación).
- Uso real por persona/semana.

Estas métricas permiten priorizar con datos en lugar de intuición.
