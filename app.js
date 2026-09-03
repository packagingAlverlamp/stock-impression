// ============================================================
// STOCK-IMPRESIÓN — Lógica de la aplicación
// ============================================================

const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let currentUser = null;
let currentProfile = null;
let allProducts = [];
let addScanner = null;
let stockScanner = null;
let stockScanMode = "out"; // "out" = sacar stock, "in" = añadir stock
let scanCooldown = false;

const BARCODE_FORMATS = window.Html5QrcodeSupportedFormats
  ? [
      Html5QrcodeSupportedFormats.EAN_13,
      Html5QrcodeSupportedFormats.EAN_8,
      Html5QrcodeSupportedFormats.UPC_A,
      Html5QrcodeSupportedFormats.UPC_E,
      Html5QrcodeSupportedFormats.CODE_128,
    ]
  : undefined;

// ---------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------
const $ = (id) => document.getElementById(id);

function showToast(msg, ms = 3200) {
  const el = $("toast");
  el.textContent = msg;
  el.classList.remove("hidden");
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => el.classList.add("hidden"), ms);
}

function escapeHtml(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function isLowStock(p) {
  return Number(p.quantity) <= Number(p.min_quantity);
}

// ---------------------------------------------------------------
// Autenticación
// ---------------------------------------------------------------
$("switch-to-register").addEventListener("click", () => {
  $("form-login").classList.add("hidden");
  $("form-register").classList.remove("hidden");
  $("switch-to-register-wrap").classList.add("hidden");
  $("switch-to-login-wrap").classList.remove("hidden");
  $("auth-error").classList.add("hidden");
});
$("switch-to-login").addEventListener("click", () => {
  $("form-register").classList.add("hidden");
  $("form-login").classList.remove("hidden");
  $("switch-to-login-wrap").classList.add("hidden");
  $("switch-to-register-wrap").classList.remove("hidden");
  $("auth-error").classList.add("hidden");
});

function showAuthError(msg) {
  const el = $("auth-error");
  el.textContent = msg;
  el.classList.remove("hidden");
}

$("form-login").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("auth-error").classList.add("hidden");
  const email = $("login-email").value.trim();
  const password = $("login-password").value;
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) showAuthError("No se ha podido entrar: " + error.message);
});

$("form-register").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("auth-error").classList.add("hidden");
  const email = $("register-email").value.trim();
  const password = $("register-password").value;
  const { error } = await supabase.auth.signUp({ email, password });
  if (error) {
    showAuthError("No se ha podido crear la cuenta: " + error.message);
  } else {
    showToast("Cuenta creada. Ya has iniciado sesión.");
  }
});

$("signout-btn").addEventListener("click", async () => {
  stopAddScanner();
  stopStockScanner();
  await supabase.auth.signOut();
});

supabase.auth.onAuthStateChange((_event, session) => {
  if (session && session.user) {
    currentUser = session.user;
    enterApp();
  } else {
    currentUser = null;
    $("app").classList.add("hidden");
    $("view-auth").classList.remove("hidden");
  }
});

async function enterApp() {
  $("view-auth").classList.add("hidden");
  $("app").classList.remove("hidden");
  await loadProfile();
  await loadProducts();
  showView("list");
}

// ---------------------------------------------------------------
// Navegación entre vistas
// ---------------------------------------------------------------
const VIEWS = ["list", "add", "scan", "profile"];

document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => showView(btn.dataset.view));
});
$("empty-add-btn").addEventListener("click", () => showView("add"));

function showView(name) {
  VIEWS.forEach((v) => {
    $("view-" + v).classList.toggle("hidden", v !== name);
  });
  document.querySelectorAll(".tab-btn").forEach((b) => {
    b.classList.toggle("active", b.dataset.view === name);
  });

  if (name !== "add") stopAddScanner();
  if (name === "scan") {
    startStockScanner();
  } else {
    stopStockScanner();
  }
  if (name === "profile") renderProfile();
}

// ---------------------------------------------------------------
// Perfil
// ---------------------------------------------------------------
async function loadProfile() {
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", currentUser.id)
    .single();
  if (!error) currentProfile = data;
}

function renderProfile() {
  if (!currentProfile) return;
  $("profile-email").textContent = currentProfile.email;
  $("notify-toggle").checked = !!currentProfile.notify_low_stock;
}

$("notify-toggle").addEventListener("change", async (e) => {
  const checked = e.target.checked;
  const { error } = await supabase
    .from("profiles")
    .update({ notify_low_stock: checked })
    .eq("id", currentUser.id);
  if (error) {
    showToast("No se ha podido guardar la preferencia");
    e.target.checked = !checked;
  } else {
    currentProfile.notify_low_stock = checked;
    showToast(checked ? "Avisos de stock bajo activados" : "Avisos de stock bajo desactivados");
  }
});

$("delete-account-btn").addEventListener("click", async () => {
  const sure = confirm("Esto eliminará tu cuenta de forma permanente. ¿Seguro que quieres continuar?");
  if (!sure) return;
  const sureAgain = confirm("Confirma otra vez: se borrará tu registro y no podrás deshacerlo. ¿Eliminar cuenta?");
  if (!sureAgain) return;

  try {
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch(`${SUPABASE_URL}/functions/v1/delete-account`, {
      method: "POST",
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    const result = await res.json();
    if (result.success) {
      await supabase.auth.signOut();
      showToast("Cuenta eliminada");
    } else {
      showToast("Error al eliminar la cuenta: " + (result.error || ""));
    }
  } catch (err) {
    showToast("Error al eliminar la cuenta");
  }
});

// ---------------------------------------------------------------
// Inventario — carga y listado
// ---------------------------------------------------------------
async function loadProducts() {
  const { data, error } = await supabase
    .from("products")
    .select("*")
    .order("name", { ascending: true });
  if (error) {
    showToast("Error al cargar el inventario");
    return;
  }
  allProducts = data || [];
  renderProductList();
  updateLowStockBadge();
  populateDatalists();
}

function updateLowStockBadge() {
  const lowCount = allProducts.filter(isLowStock).length;
  const badge = $("low-stock-badge");
  if (lowCount > 0) {
    badge.textContent = `${lowCount} con poco stock`;
    badge.classList.remove("hidden");
  } else {
    badge.classList.add("hidden");
  }
}

function populateDatalists() {
  const fill = (id, values) => {
    const dl = $(id);
    dl.innerHTML = [...new Set(values.filter(Boolean))]
      .sort()
      .map((v) => `<option value="${escapeHtml(v)}"></option>`)
      .join("");
  };
  fill("list-categories", allProducts.map((p) => p.category));
  fill("list-locations", allProducts.map((p) => p.location));
  fill("list-suppliers", allProducts.map((p) => p.supplier));
  const defaultUnits = ["Rollo", "Paquete", "Cartucho", "Caja", "Bote", "Unidad"];
  fill("list-units", [...defaultUnits, ...allProducts.map((p) => p.unit)]);
}

$("search-input").addEventListener("input", () => renderProductList());

function renderProductList() {
  const term = $("search-input").value.trim().toLowerCase();
  const filtered = allProducts.filter((p) => {
    if (!term) return true;
    return [p.name, p.category, p.location, p.supplier, p.ean]
      .filter(Boolean)
      .some((f) => f.toLowerCase().includes(term));
  });

  const container = $("product-list");
  $("list-empty").classList.toggle("hidden", allProducts.length > 0);

  if (filtered.length === 0 && allProducts.length > 0) {
    container.innerHTML = `<p style="color:var(--ink-soft);text-align:center;padding:30px 10px;">No hay ningún suministro que coincida con "${escapeHtml(term)}".</p>`;
    return;
  }

  container.innerHTML = filtered
    .map((p) => {
      const low = isLowStock(p);
      const meta = [p.unit, p.location, p.supplier].filter(Boolean).join(" / ");
      return `
        <div class="product-row ${low ? "low" : ""}">
          <div class="product-main" data-id="${p.id}">
            <h3>${escapeHtml(p.name)}</h3>
            <p class="product-meta">${escapeHtml(meta || p.category || "")}</p>
            <span class="product-qty ${low ? "low" : ""}">${p.quantity} / mín. ${p.min_quantity}</span>
            ${low ? '<span class="low-flag">Queda poco</span>' : ""}
          </div>
          <div class="qty-stepper">
            <button type="button" data-id="${p.id}" data-delta="1">+</button>
            <button type="button" data-id="${p.id}" data-delta="-1">−</button>
          </div>
        </div>`;
    })
    .join("");

  container.querySelectorAll(".product-main").forEach((el) => {
    el.addEventListener("click", () => openEditModal(el.dataset.id));
  });
  container.querySelectorAll(".qty-stepper button").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const product = allProducts.find((p) => p.id === btn.dataset.id);
      if (!product) return;
      await applyQuantityDelta(product, Number(btn.dataset.delta));
    });
  });
}

// ---------------------------------------------------------------
// Stock: actualización de cantidades + avisos de stock bajo
// ---------------------------------------------------------------
async function applyQuantityDelta(product, delta) {
  const newQty = Math.max(0, Number(product.quantity) + delta);
  return updateProductQuantity(product.id, newQty);
}

async function updateProductQuantity(productId, newQty) {
  const { data, error } = await supabase
    .from("products")
    .update({ quantity: newQty })
    .eq("id", productId)
    .select()
    .single();
  if (error) {
    showToast("Error al actualizar la cantidad");
    return null;
  }
  await checkLowStock(data);
  await loadProducts();
  return data;
}

async function checkLowStock(product) {
  const low = isLowStock(product);
  if (low && !product.low_stock_notified) {
    await sendLowStockEmail(product);
    await supabase.from("products").update({ low_stock_notified: true }).eq("id", product.id);
  } else if (!low && product.low_stock_notified) {
    await supabase.from("products").update({ low_stock_notified: false }).eq("id", product.id);
  }
}

async function sendLowStockEmail(product) {
  try {
    if (!APPS_SCRIPT_URL || APPS_SCRIPT_URL.startsWith("PEGA_AQUI")) return;

    const { data: profiles } = await supabase
      .from("profiles")
      .select("email, notify_low_stock")
      .eq("notify_low_stock", true);

    const emails = (profiles || []).map((p) => p.email);
    if (emails.length === 0) return;

    await fetch(APPS_SCRIPT_URL, {
      method: "POST",
      body: JSON.stringify({
        emails,
        subject: `Stock bajo: ${product.name}`,
        message:
          `El suministro "${product.name}" tiene ${product.quantity} ${product.unit || "unidades"} ` +
          `(mínimo definido: ${product.min_quantity}).\n\n` +
          `Repón stock cuando puedas.\n\n— Stock Impresión`,
      }),
    });
  } catch (err) {
    console.error("No se pudo enviar el aviso por email:", err);
  }
}

// ---------------------------------------------------------------
// Modal de edición de producto
// ---------------------------------------------------------------
function openEditModal(productId) {
  const p = allProducts.find((x) => x.id === productId);
  if (!p) return;

  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML = `
    <div class="modal-sheet">
      <div class="modal-header">
        <h2>Editar suministro</h2>
        <button type="button" class="modal-close" aria-label="Cerrar">&times;</button>
      </div>
      <form id="edit-form">
        <div class="field">
          <label>Código EAN</label>
          <input type="text" id="edit-ean" value="${escapeHtml(p.ean || "")}" />
        </div>
        <div class="field">
          <label>Nombre *</label>
          <input type="text" id="edit-name" required value="${escapeHtml(p.name)}" />
        </div>
        <div class="two-col">
          <div class="field">
            <label>Categoría</label>
            <input type="text" id="edit-category" list="list-categories" value="${escapeHtml(p.category || "")}" />
          </div>
          <div class="field">
            <label>Formato</label>
            <input type="text" id="edit-unit" list="list-units" value="${escapeHtml(p.unit || "")}" />
          </div>
        </div>
        <div class="two-col">
          <div class="field">
            <label>Ubicación</label>
            <input type="text" id="edit-location" list="list-locations" value="${escapeHtml(p.location || "")}" />
          </div>
          <div class="field">
            <label>Proveedor</label>
            <input type="text" id="edit-supplier" list="list-suppliers" value="${escapeHtml(p.supplier || "")}" />
          </div>
        </div>
        <div class="two-col">
          <div class="field">
            <label>Cantidad actual *</label>
            <input type="number" id="edit-quantity" required min="0" step="1" value="${p.quantity}" />
          </div>
          <div class="field">
            <label>Cantidad mínima *</label>
            <input type="number" id="edit-min" required min="0" step="1" value="${p.min_quantity}" />
          </div>
        </div>
        <button type="submit" class="btn btn-primary" style="margin-bottom:10px">Guardar cambios</button>
        <button type="button" id="edit-delete-btn" class="btn btn-outline" style="color:var(--red);border-color:var(--red)">Eliminar suministro</button>
      </form>
    </div>`;
  document.body.appendChild(backdrop);

  const close = () => backdrop.remove();
  backdrop.querySelector(".modal-close").addEventListener("click", close);
  backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(); });

  backdrop.querySelector("#edit-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const updated = {
      ean: $("edit-ean").value.trim() || null,
      name: $("edit-name").value.trim(),
      category: $("edit-category").value.trim() || null,
      unit: $("edit-unit").value.trim() || null,
      location: $("edit-location").value.trim() || null,
      supplier: $("edit-supplier").value.trim() || null,
      quantity: Number($("edit-quantity").value),
      min_quantity: Number($("edit-min").value),
    };
    const { data, error } = await supabase
      .from("products")
      .update(updated)
      .eq("id", p.id)
      .select()
      .single();
    if (error) {
      showToast("Error al guardar: " + error.message);
      return;
    }
    await checkLowStock(data);
    close();
    showToast("Suministro actualizado");
    loadProducts();
  });

  backdrop.querySelector("#edit-delete-btn").addEventListener("click", async () => {
    const sure = confirm(`¿Eliminar "${p.name}" del inventario?`);
    if (!sure) return;
    const { error } = await supabase.from("products").delete().eq("id", p.id);
    if (error) {
      showToast("Error al eliminar");
      return;
    }
    close();
    showToast("Suministro eliminado");
    loadProducts();
  });
}

// ---------------------------------------------------------------
// Añadir producto
// ---------------------------------------------------------------
$("add-scan-ean-btn").addEventListener("click", () => {
  const box = $("add-scanner");
  if (box.classList.contains("hidden")) {
    box.classList.remove("hidden");
    startAddScanner();
  } else {
    box.classList.add("hidden");
    stopAddScanner();
  }
});

function startAddScanner() {
  if (addScanner) return;
  addScanner = new Html5Qrcode("add-scanner");
  addScanner
    .start(
      { facingMode: "environment" },
      { fps: 10, qrbox: { width: 260, height: 130 }, formatsToSupport: BARCODE_FORMATS },
      (decodedText) => {
        $("add-ean").value = decodedText;
        $("add-scanner").classList.add("hidden");
        stopAddScanner();
        showToast("Código leído: " + decodedText);
      },
      () => {}
    )
    .catch(() => showToast("No se pudo acceder a la cámara"));
}

function stopAddScanner() {
  if (addScanner) {
    addScanner.stop().then(() => addScanner.clear()).catch(() => {});
    addScanner = null;
  }
}

$("form-add-product").addEventListener("submit", async (e) => {
  e.preventDefault();
  const payload = {
    ean: $("add-ean").value.trim() || null,
    name: $("add-name").value.trim(),
    category: $("add-category").value.trim() || null,
    unit: $("add-unit").value.trim() || null,
    location: $("add-location").value.trim() || null,
    supplier: $("add-supplier").value.trim() || null,
    quantity: Number($("add-quantity").value),
    min_quantity: Number($("add-min").value),
  };

  const { data, error } = await supabase.from("products").insert(payload).select().single();
  if (error) {
    if (error.message.includes("duplicate")) {
      showToast("Ya existe un suministro con ese código EAN");
    } else {
      showToast("Error al guardar: " + error.message);
    }
    return;
  }

  await checkLowStock(data);
  showToast("Suministro añadido");
  e.target.reset();
  $("add-quantity").value = 0;
  $("add-min").value = 1;
  await loadProducts();
  showView("list");
});

// ---------------------------------------------------------------
// Escanear (sacar / añadir stock)
// ---------------------------------------------------------------
$("mode-out-btn").addEventListener("click", () => setScanMode("out"));
$("mode-in-btn").addEventListener("click", () => setScanMode("in"));

function setScanMode(mode) {
  stockScanMode = mode;
  $("mode-out-btn").classList.toggle("active", mode === "out");
  $("mode-in-btn").classList.toggle("active", mode === "in");
  $("scan-result").classList.add("hidden");
  $("scan-result").innerHTML = "";
}

function startStockScanner() {
  if (stockScanner) return;
  $("scan-result").classList.add("hidden");
  $("scan-result").innerHTML = "";
  stockScanner = new Html5Qrcode("qr-reader");
  stockScanner
    .start(
      { facingMode: "environment" },
      { fps: 10, qrbox: { width: 260, height: 130 }, formatsToSupport: BARCODE_FORMATS },
      (decodedText) => onStockScan(decodedText),
      () => {}
    )
    .catch(() => showToast("No se pudo acceder a la cámara"));
}

function stopStockScanner() {
  if (stockScanner) {
    stockScanner.stop().then(() => stockScanner.clear()).catch(() => {});
    stockScanner = null;
  }
}

async function onStockScan(ean) {
  if (scanCooldown) return;
  scanCooldown = true;
  setTimeout(() => (scanCooldown = false), 1200);

  if (stockScanner) {
    try { await stockScanner.pause(true); } catch (e) {}
  }

  const product = allProducts.find((p) => p.ean === ean);
  const resultBox = $("scan-result");
  resultBox.classList.remove("hidden");

  if (!product) {
    resultBox.innerHTML = `
      <div class="scan-result-card" style="border-left-color:var(--red)">
        <h3>Código no encontrado</h3>
        <p class="product-meta">EAN: ${escapeHtml(ean)}</p>
        <button type="button" class="btn btn-teal" id="scan-add-new">Añadir como suministro nuevo</button>
        <button type="button" class="btn btn-ghost" id="scan-resume">Seguir escaneando</button>
      </div>`;
    $("scan-add-new").addEventListener("click", () => {
      showView("add");
      $("add-ean").value = ean;
    });
    $("scan-resume").addEventListener("click", resumeScan);
    return;
  }

  const label = stockScanMode === "out" ? "Sacar del stock" : "Añadir al stock";
  resultBox.innerHTML = `
    <div class="scan-result-card">
      <h3>${escapeHtml(product.name)}</h3>
      <p class="product-meta">${escapeHtml([product.unit, product.location].filter(Boolean).join(" / "))}</p>
      <p class="product-meta">En stock: <strong>${product.quantity}</strong> (mínimo ${product.min_quantity})</p>
      <div class="qty-adjust-row">
        <button type="button" id="scan-minus">−</button>
        <input type="number" id="scan-delta" value="1" min="1" step="1" />
        <button type="button" id="scan-plus">+</button>
      </div>
      <button type="button" class="btn ${stockScanMode === "out" ? "btn-red" : "btn-teal"}" id="scan-confirm">${label}</button>
      <button type="button" class="btn btn-ghost" id="scan-resume">Cancelar y seguir escaneando</button>
    </div>`;

  $("scan-minus").addEventListener("click", () => {
    const input = $("scan-delta");
    input.value = Math.max(1, Number(input.value) - 1);
  });
  $("scan-plus").addEventListener("click", () => {
    const input = $("scan-delta");
    input.value = Number(input.value) + 1;
  });
  $("scan-confirm").addEventListener("click", async () => {
    const amount = Number($("scan-delta").value) || 1;
    const delta = stockScanMode === "out" ? -amount : amount;
    await applyQuantityDelta(product, delta);
    showToast(`${label}: ${amount} × ${product.name}`);
    resumeScan();
  });
  $("scan-resume").addEventListener("click", resumeScan);
}

function resumeScan() {
  $("scan-result").classList.add("hidden");
  $("scan-result").innerHTML = "";
  if (stockScanner) {
    stockScanner.resume();
  } else {
    startStockScanner();
  }
}
