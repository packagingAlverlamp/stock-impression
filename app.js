// ============================================================
// STOCK-IMPRESIÓN — Lógica de la aplicación
// ============================================================

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Inicializa EmailJS si hay clave pública en config.js.
if (typeof EMAILJS_PUBLIC_KEY !== "undefined" && EMAILJS_PUBLIC_KEY
  && window.emailjs && typeof window.emailjs.init === "function") {
  try { window.emailjs.init(EMAILJS_PUBLIC_KEY); } catch (_) { /* sin EmailJS */ }
}

// Evita el salto de diseño mientras Supabase resuelve la sesión.
document.body.classList.add("booting", "auth-mode");

let currentUser = null;
let currentProfile = null;
let mfaFactorId = null;
let mfaChallengeActive = false;
let enteringApp = false;
let allProducts = [];
let allSuppliers = [];
let allProfiles = [];
let allMachines = [];
let allServiceRequests = [];
let allServiceRequestEvents = [];
let historyOffset = 0;
let historyTotal = 0;
let historyRows = [];
let activeCategoryFilter = '';
let activeNamePrefixFilter = '';
const LOW_STOCK_CATEGORY_KEY = '__low_stock__';
const CATEGORY_ORDER_COOKIE = 'stock_impresion_category_order';
const SERVICE_PHOTO_BUCKET = "service-request-photos";
const SERVICE_PHOTO_MAX_FILES = 6;
const SERVICE_PHOTO_MAX_BYTES = 5 * 1024 * 1024;
const SERVICE_PHOTO_MAX_DIMENSION = 1600;
let addScanner = null;
let stockScanner = null;
let stockScanMode = "out"; // "out" = sacar stock, "in" = añadir stock
let scanCooldown = false;
let allPurchaseOrders = [];
let allPurchaseOrderItems = [];
let allPurchaseOrderEvents = [];
let orderDraftItems = new Map();
let orderDraftSupplierId = "";
let activeOrdersSection = "new";
let ordersLoaded = false;

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

function hasOpenModal() {
  return !!document.querySelector(".modal-backdrop");
}

async function withBusy(button, busyLabel, task) {
  if (!button || button.dataset.busy === "true") return undefined;
  const original = button.innerHTML;
  button.dataset.busy = "true";
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  button.innerHTML = `<span class="btn-spinner" aria-hidden="true"></span><span>${escapeHtml(busyLabel)}</span>`;
  try {
    return await task();
  } finally {
    button.disabled = false;
    button.dataset.busy = "false";
    button.removeAttribute("aria-busy");
    button.innerHTML = original;
  }
}

function flashSuccess(button, label = "Hecho ✓", ms = 1200) {
  if (!button) return;
  const original = button.innerHTML;
  button.innerHTML = `<span>${escapeHtml(label)}</span>`;
  button.classList.add("is-success");
  setTimeout(() => {
    button.innerHTML = original;
    button.classList.remove("is-success");
  }, ms);
}

function getCategoryOrderCookie() {
  const match = document.cookie.match(new RegExp('(?:^|; )' + CATEGORY_ORDER_COOKIE + '=([^;]*)'));
  if (!match) return [];
  try {
    return JSON.parse(decodeURIComponent(match[1] || '[]'));
  } catch (err) {
    return [];
  }
}

function setCategoryOrderCookie(order) {
  const value = encodeURIComponent(JSON.stringify(order));
  document.cookie = `${CATEGORY_ORDER_COOKIE}=${value}; path=/; max-age=31536000`;
}

function getOrderedCategories() {
  const cats = [...new Set(allProducts.map((p) => p.category).filter(Boolean))].sort();
  const saved = getCategoryOrderCookie();
  const validSaved = Array.isArray(saved) ? saved.filter((c) => cats.includes(c)) : [];
  const rest = cats.filter((c) => !validSaved.includes(c));
  return [...validSaved, ...rest];
}

function getCategoryFilterLabel(value) {
  if (value === '') return 'Todos';
  if (value === LOW_STOCK_CATEGORY_KEY) return 'Poco stock';
  return value;
}

function escapeHtml(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function isLowStock(p) {
  return Number(p.quantity) <= Number(p.min_quantity);
}

function getLowStockLabel(product) {
  return Number(product.quantity) === 0 ? 'AGOTADO' : 'Queda poco';
}

// ---------------------------------------------------------------
// Autenticación
// ---------------------------------------------------------------
$("switch-to-register").addEventListener("click", () => {
  $("form-login").classList.add("hidden");
  $("form-register").classList.remove("hidden");
  $("switch-to-register-wrap").classList.add("hidden");
  $("switch-to-login-wrap").classList.remove("hidden");
  setAuthSwitchParts({ forgot: false });
  $("auth-error").classList.add("hidden");
});
$("switch-to-login").addEventListener("click", () => {
  $("form-register").classList.add("hidden");
  $("form-login").classList.remove("hidden");
  $("switch-to-login-wrap").classList.add("hidden");
  $("switch-to-register-wrap").classList.remove("hidden");
  setAuthSwitchParts({ forgot: true });
  $("auth-error").classList.add("hidden");
});

function setAuthSwitchParts({ forgot }) {
  $("forgot-password-wrap").classList.toggle("hidden", !forgot);
  $("auth-switch-sep").classList.toggle("hidden", !forgot);
}

function showAuthError(msg) {
  const el = $("auth-error");
  el.textContent = msg;
  el.classList.remove("hidden");
}

function passwordErrorMessage(error) {
  const code = String(error?.code || "").toLowerCase();
  const message = String(error?.message || "").toLowerCase();
  if (code.includes("reauthentication") || message.includes("reauthentication")) {
    return "Por seguridad, cierra sesión y vuelve a entrar antes de cambiar la contraseña.";
  }
  if (message.includes("weak") || message.includes("password")) {
    return "La contraseña no cumple la política de seguridad. Usa al menos 10 caracteres.";
  }
  return error?.message || "Error desconocido";
}

function setAuthMode(enabled) {
  document.body.classList.toggle("auth-mode", enabled);
  if (!enabled) document.body.classList.remove("booting");
}

function finishBoot() {
  const done = () => document.body.classList.remove("booting");
  requestAnimationFrame(done);
  setTimeout(done, 250);
}

function showLoginForms() {
  $("form-login").classList.remove("hidden");
  $("form-register").classList.add("hidden");
  $("form-reset-password").classList.add("hidden");
  $("form-mfa").classList.add("hidden");
  $("mfa-code").value = "";
  mfaFactorId = null;
  mfaChallengeActive = false;
  $("auth-switch-row").classList.remove("hidden");
  $("switch-to-register-wrap").classList.remove("hidden");
  $("switch-to-login-wrap").classList.add("hidden");
  setAuthSwitchParts({ forgot: true });
  $("auth-error").classList.add("hidden");
}

function showRecoveryForm() {
  $("form-login").classList.add("hidden");
  $("form-register").classList.add("hidden");
  $("form-reset-password").classList.remove("hidden");
  $("form-mfa").classList.add("hidden");
  $("mfa-code").value = "";
  mfaFactorId = null;
  mfaChallengeActive = false;
  $("auth-switch-row").classList.add("hidden");
  $("switch-to-register-wrap").classList.add("hidden");
  $("switch-to-login-wrap").classList.add("hidden");
  $("auth-error").classList.add("hidden");
  const input = $("reset-password");
  if (input) setTimeout(() => input.focus(), 50);
}

// ---------------------------------------------------------------
// Verificación en dos pasos (MFA TOTP)
// ---------------------------------------------------------------
async function mfaRequired() {
  const { data, error } = await supabaseClient.auth.mfa.getAuthenticatorAssuranceLevel();
  if (error) return false;
  return data?.nextLevel === "aal2" && data?.currentLevel !== "aal2";
}

function showMfaForm(factorId) {
  mfaFactorId = factorId;
  mfaChallengeActive = true;
  setAuthMode(true);
  $("app").classList.add("hidden");
  $("view-auth").classList.remove("hidden");
  $("form-login").classList.add("hidden");
  $("form-register").classList.add("hidden");
  $("form-reset-password").classList.add("hidden");
  $("form-mfa").classList.remove("hidden");
  $("auth-switch-row").classList.add("hidden");
  $("switch-to-register-wrap").classList.add("hidden");
  $("switch-to-login-wrap").classList.add("hidden");
  $("auth-error").classList.add("hidden");
  finishBoot();
  setTimeout(() => $("mfa-code")?.focus(), 50);
}

async function handleSession(session) {
  if (!session?.user) {
    currentUser = null;
    setAuthMode(true);
    $("app").classList.add("hidden");
    $("view-auth").classList.remove("hidden");
    showLoginForms();
    finishBoot();
    return;
  }

  currentUser = session.user;

  if (await mfaRequired()) {
    let factor = (session.user.factors || []).find((item) => item.status === "verified");
    if (!factor) {
      const { data } = await supabaseClient.auth.mfa.listFactors();
      factor = (data?.totp || []).find((item) => item.status === "verified");
    }
    if (factor) {
      showMfaForm(factor.id);
    } else {
      await supabaseClient.auth.signOut();
      showToast("No se pudo completar la verificación en dos pasos. Vuelve a iniciar sesión.", 6000);
    }
    return;
  }

  mfaChallengeActive = false;
  await enterApp();
}

$("form-mfa").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("auth-error").classList.add("hidden");
  const code = $("mfa-code").value.trim();

  if (!/^\d{6}$/.test(code)) {
    showAuthError("Escribe el código de 6 dígitos de tu aplicación de autenticación.");
    return;
  }

  if (!mfaFactorId) {
    showAuthError("No se ha podido identificar el método de verificación. Vuelve a iniciar sesión.");
    return;
  }

  const button = e.target.querySelector('button[type="submit"]');
  await withBusy(button, "Verificando…", async () => {
    const { error } = await supabaseClient.auth.mfa.challengeAndVerify({
      factorId: mfaFactorId,
      code,
    });

    if (error) {
      showAuthError("Código incorrecto o caducado. Inténtalo de nuevo.");
      return;
    }

    $("mfa-code").value = "";
    mfaChallengeActive = false;
    await enterApp();
  });
});

$("mfa-cancel").addEventListener("click", async () => {
  const button = $("mfa-cancel");
  await withBusy(button, "Saliendo…", async () => {
    mfaFactorId = null;
    mfaChallengeActive = false;
    await supabaseClient.auth.signOut();
  });
});

$("forgot-password-link").addEventListener("click", async () => {
  const email = $("login-email").value.trim();
  if (!email) {
    showAuthError("Escribe tu email para recibir el enlace de recuperación.");
    return;
  }

  const redirectUrl = `${window.location.origin}${window.location.pathname}`;
  const button = $("forgot-password-link");
  await withBusy(button, "Enviando…", async () => {
    const { error } = await supabaseClient.auth.resetPasswordForEmail(email, { redirectTo: redirectUrl });

    if (error) {
      showAuthError("No se pudo enviar el email: " + error.message);
    } else {
      showToast("Si esa cuenta existe, te hemos enviado un email para restablecer la contraseña.");
      showLoginForms();
    }
  });
});

$("cancel-reset-password").addEventListener("click", () => {
  showLoginForms();
});

$("form-reset-password").addEventListener("submit", async (e) => {
  e.preventDefault();
  const newPassword = $("reset-password").value.trim();
  const passwordConfirm = $("reset-password-confirm").value.trim();

  if (!newPassword || newPassword.length < 10) {
    showAuthError("La nueva contraseña debe tener al menos 10 caracteres.");
    return;
  }

  if (newPassword !== passwordConfirm) {
    showAuthError("Las contraseñas no coinciden. Escríbelas igual en los dos campos.");
    return;
  }

  const button = e.target.querySelector('button[type="submit"]');
  await withBusy(button, "Guardando…", async () => {
    const { error } = await supabaseClient.auth.updateUser({ password: newPassword });
    if (error) {
      showAuthError("No se pudo guardar la nueva contraseña: " + passwordErrorMessage(error));
      return;
    }

    showToast("Contraseña actualizada correctamente.");
    showLoginForms();
    $("login-password").value = "";
    $("reset-password").value = "";
    $("reset-password-confirm").value = "";
  });
});

$("form-login").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("auth-error").classList.add("hidden");
  const email = $("login-email").value.trim();
  const password = $("login-password").value;
  const button = e.target.querySelector('button[type="submit"]');
  await withBusy(button, "Entrando…", async () => {
    const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
    if (error) showAuthError("No se ha podido entrar: " + error.message);
  });
});

$("form-register").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("auth-error").classList.add("hidden");
  const email = $("register-email").value.trim();
  const password = $("register-password").value;

  if (!/^[^\s@]+@alverlamp\.es$/i.test(email)) {
    showAuthError("Solo se permiten cuentas con email @alverlamp.es.");
    return;
  }

  const button = e.target.querySelector('button[type="submit"]');
  await withBusy(button, "Creando cuenta…", async () => {
    const { data, error } = await supabaseClient.auth.signUp({ email, password });
    if (error) {
      showAuthError("No se ha podido crear la cuenta: " + error.message);
    } else if (data?.session) {
      showToast("Cuenta creada. Ya has iniciado sesión.");
    } else {
      showToast("Cuenta creada. Revisa tu email para confirmarla antes de entrar.", 6000);
      showLoginForms();
      $("login-email").value = email;
    }
  });
});

$("signout-btn").addEventListener("click", async () => {
  stopAddScanner();
  stopStockScanner();
  const button = $("signout-btn");
  await withBusy(button, "Saliendo…", async () => {
    await supabaseClient.auth.signOut();
  });
});

supabaseClient.auth.onAuthStateChange((_event, session) => {
  if (_event === "PASSWORD_RECOVERY") {
    currentUser = session?.user || null;
    setAuthMode(true);
    $("app").classList.add("hidden");
    $("view-auth").classList.remove("hidden");
    showRecoveryForm();
    finishBoot();
    return;
  }

  if (session && session.user) {
    // Fuera del callback para no bloquear las llamadas internas de auth.
    setTimeout(() => { handleSession(session); }, 0);
  } else {
    currentUser = null;
    setAuthMode(true);
    $("app").classList.add("hidden");
    $("view-auth").classList.remove("hidden");
    showLoginForms();
    finishBoot();
  }
});

// Si Supabase tarda o no responde, no dejar la pantalla en blanco.
setTimeout(() => {
  if (document.body.classList.contains("booting")) finishBoot();
}, 6000);

function safeRenderInventoryState() {
  if (!$("category-pills") || !$("product-list") || !$("search-input")) return;
  renderCategoryPills();
  renderProductList();
}

async function enterApp() {
  if (mfaChallengeActive || enteringApp) return;
  enteringApp = true;
  try {
    setAuthMode(false);
    $("view-auth").classList.add("hidden");
    $("app").classList.remove("hidden");
    await loadProfile();
    await loadProfiles();
    await loadSuppliers();
    await loadMachines();
    // El contador de solicitudes se carga en segundo plano para no retrasar la entrada.
    loadServiceRequests();
    await loadProducts();
    safeRenderInventoryState();
    showView("list");
    requestAnimationFrame(() => {
      renderCategoryPills();
      renderProductList();
    });
  } finally {
    enteringApp = false;
  }
}

// ---------------------------------------------------------------
// Navegación entre vistas
// ---------------------------------------------------------------
const VIEWS = ["list", "machines", "service", "add", "scan", "suppliers", "orders", "analytics", "profile"];
let lastView = "list";

const MOBILE_NAV_VIEWS = new Set(["list", "machines", "scan"]);

document.querySelectorAll(".tab-btn[data-view]").forEach((btn) => {
  btn.addEventListener("click", () => showView(btn.dataset.view));
});
$("empty-add-btn").addEventListener("click", () => showView("add"));
$("inventory-add-btn").addEventListener("click", () => showView("add"));
$("more-nav-btn").addEventListener("click", openMoreMenu);

document.querySelectorAll(".workshop-tab").forEach((button) => {
  button.addEventListener("click", () => showView(button.dataset.workshopView));
});

function isMobileNav() {
  return window.innerWidth < 900;
}

function updateWorkshopTabs(name) {
  document.querySelectorAll(".workshop-tab").forEach((button) => {
    const active = button.dataset.workshopView === name;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });
}

function updateNavState(name) {
  document.querySelectorAll(".tab-btn[data-view]").forEach((button) => {
    let active = button.dataset.view === name;
    if (button.dataset.view === "machines") {
      active = name === "machines" || name === "suppliers" || name === "service";
    }
    button.classList.toggle("active", active);
  });

  const moreButton = $("more-nav-btn");
  if (moreButton) {
    moreButton.classList.toggle(
      "active",
      isMobileNav() && ["add", "analytics", "profile", "orders"].includes(name)
    );
  }

  updateWorkshopTabs(name);
  lastView = name;
}

window.addEventListener("resize", () => updateNavState(lastView));

function showView(name) {
  if (!VIEWS.includes(name)) name = "list";
  VIEWS.forEach((v) => {
    $("view-" + v).classList.toggle("hidden", v !== name);
  });
  updateNavState(name);

  const view = $("view-" + name);
  if (view) view.scrollTop = 0;

  if (name !== "add") stopAddScanner();
  if (name === "scan") {
    resetScanView();
  } else {
    stopStockScanner();
  }
  if (name === "profile") renderProfile();
  if (name === "suppliers") loadSuppliers();
  if (name === "machines") loadMachines();
  if (name === "service") loadServiceRequests();
  if (name === "analytics") showAnalyticsSection(activeAnalyticsSection);
  if (name === "orders") openOrdersView();
  if (name === "list") {
    renderCategoryPills();
    requestAnimationFrame(() => {
      renderCategoryPills();
      renderProductList();
    });
  }
}

function openMoreMenu() {
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop centered more-menu-backdrop";
  backdrop.innerHTML = `
    <div class="modal-sheet more-menu-sheet">
      <div class="modal-header">
        <h2>Más opciones</h2>
        <button type="button" class="modal-close" aria-label="Cerrar">&times;</button>
      </div>
      <div class="more-menu-grid">
        <button type="button" class="more-menu-item" data-menu-view="add">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 5v14M5 12h14"/></svg>
          <span>Añadir suministro</span>
        </button>
        <button type="button" class="more-menu-item" data-menu-view="orders">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M6 4h12l2 4v12H4V8l2-4zM4 8h16M9 13h6M9 17h4"/></svg>
          <span>Pedidos</span>
        </button>
        <button type="button" class="more-menu-item" data-menu-view="analytics">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 19V5m0 14h17M8 15l4-3 3 2 5-6"/></svg>
          <span>Análisis</span>
        </button>
        <button type="button" class="more-menu-item" data-menu-view="profile">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="8" r="3.2"/><path d="M5 20c0-3.5 3.1-6 7-6s7 2.5 7 6"/></svg>
          <span>Perfil</span>
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(backdrop);
  $("more-nav-btn").classList.add("active");
  const close = () => {
    backdrop.remove();
    updateNavState(lastView);
  };
  backdrop.querySelector(".modal-close").addEventListener("click", close);
  backdrop.addEventListener("click", (event) => {
    if (event.target === backdrop) close();
  });
  backdrop.querySelectorAll(".more-menu-item").forEach((button) => {
    button.addEventListener("click", () => {
      const view = button.dataset.menuView;
      close();
      showView(view);
    });
  });
}


let activeAnalyticsSection = "analytics";
let analysisPeriodDays = 30;
document.querySelectorAll(".analytics-view-btn").forEach((button) => {
  button.addEventListener("click", () => showAnalyticsSection(button.dataset.analyticsView));
});

const analysisPeriodSelect = $("analysis-period");
if (analysisPeriodSelect) {
  analysisPeriodSelect.value = String(analysisPeriodDays);
  analysisPeriodSelect.addEventListener("change", () => {
    analysisPeriodDays = Number(analysisPeriodSelect.value) || 0;
    if (activeAnalyticsSection === "analytics") loadStockAnalytics();
  });
}

function showAnalyticsSection(name) {
  activeAnalyticsSection = name;
  document.querySelectorAll(".analytics-view-btn").forEach((button) => {
    const active = button.dataset.analyticsView === name;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });
  document.querySelectorAll(".analytics-panel").forEach((panel) => {
    panel.classList.toggle("hidden", panel.id !== `analytics-panel-${name}`);
  });
  if (name === "history") loadStockHistory(true);
  if (name === "analytics") loadStockAnalytics();
}


// ---------------------------------------------------------------
// Perfil
// ---------------------------------------------------------------
async function loadProfile() {
  const { data, error } = await supabaseClient
    .from("profiles")
    .select("*")
    .eq("id", currentUser.id)
    .single();
  if (!error) currentProfile = data;
}

async function loadProfiles() {
  const { data, error } = await supabaseClient
    .from("profiles")
    .select("id, email")
    .order("email", { ascending: true });

  if (error) {
    console.warn("No se pudieron cargar los usuarios:", error);
    allProfiles = [];
    return;
  }

  allProfiles = (data || []).filter((profile) =>
    /^[^\s@]+@alverlamp\.es$/i.test(profile.email || "")
  );
}

function renderProfile() {
  if (!currentProfile) return;
  $("profile-email").textContent = currentProfile.email;
  $("notify-toggle").checked = !!currentProfile.notify_low_stock;
  loadMfaState();
}

// ---------------------------------------------------------------
// Gestión de la verificación en dos pasos desde el perfil
// ---------------------------------------------------------------
let mfaEnrollFactorId = null;

async function loadMfaState() {
  const statusEl = $("mfa-status");
  if (!statusEl) return;

  const { data, error } = await supabaseClient.auth.mfa.listFactors();
  if (error) {
    statusEl.textContent = "No se pudo comprobar el estado de la verificación en dos pasos.";
    $("mfa-enroll-btn").classList.add("hidden");
    $("mfa-disable-btn").classList.add("hidden");
    return;
  }

  const verified = (data?.totp || []).filter((factor) => factor.status === "verified");
  const active = verified.length > 0;

  statusEl.textContent = active
    ? "Activada. Al entrar se te pedirá un código de tu aplicación de autenticación."
    : "Desactivada. Actívala para proteger tu cuenta con un código adicional.";

  $("mfa-enroll-btn").classList.toggle("hidden", active);
  $("mfa-disable-btn").classList.toggle("hidden", !active);
  $("mfa-disable-btn").dataset.factorId = active ? verified[0].id : "";
  if (!active) resetMfaEnrollArea();
}

function resetMfaEnrollArea() {
  mfaEnrollFactorId = null;
  $("mfa-enroll-area").classList.add("hidden");
  $("mfa-qr").innerHTML = "";
  $("mfa-secret").textContent = "";
  $("mfa-enroll-code").value = "";
}

$("mfa-enroll-btn").addEventListener("click", async () => {
  const button = $("mfa-enroll-btn");
  await withBusy(button, "Preparando…", async () => {
    const { data: existing } = await supabaseClient.auth.mfa.listFactors();
    const stale = (existing?.all || []).filter((factor) => factor.status === "unverified");
    await Promise.all(stale.map((factor) =>
      supabaseClient.auth.mfa.unenroll({ factorId: factor.id })
    ));

    const { data, error } = await supabaseClient.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: `Stock Impresión · ${currentProfile?.email || currentUser?.email || "cuenta"}`,
    });

    if (error || !data?.totp) {
      showToast("No se pudo iniciar la activación: " + (error?.message || "error desconocido"));
      return;
    }

    mfaEnrollFactorId = data.id;
    $("mfa-secret").textContent = data.totp.secret;
    $("mfa-qr").innerHTML = `<img src="${escapeHtml(data.totp.qr_code)}" alt="Código QR para la verificación en dos pasos" />`;
    $("mfa-enroll-area").classList.remove("hidden");
    $("mfa-enroll-code").value = "";
    $("mfa-enroll-code").focus();
  });
});

$("mfa-enroll-verify").addEventListener("click", async () => {
  const code = $("mfa-enroll-code").value.trim();
  if (!mfaEnrollFactorId) {
    showToast("La activación ha caducado. Vuelve a empezar.");
    resetMfaEnrollArea();
    return;
  }
  if (!/^\d{6}$/.test(code)) {
    showToast("Escribe el código de 6 dígitos que muestra la app.");
    return;
  }

  const button = $("mfa-enroll-verify");
  await withBusy(button, "Verificando…", async () => {
    const { error } = await supabaseClient.auth.mfa.challengeAndVerify({
      factorId: mfaEnrollFactorId,
      code,
    });

    if (error) {
      showToast("Código incorrecto o caducado. Inténtalo de nuevo.");
      return;
    }

    resetMfaEnrollArea();
    showToast("Verificación en dos pasos activada");
    loadMfaState();
  });
});

$("mfa-enroll-cancel").addEventListener("click", async () => {
  const factorId = mfaEnrollFactorId;
  resetMfaEnrollArea();
  if (factorId) {
    await supabaseClient.auth.mfa.unenroll({ factorId });
  }
  loadMfaState();
});

$("mfa-disable-btn").addEventListener("click", async () => {
  const factorId = $("mfa-disable-btn").dataset.factorId;
  if (!factorId) return;
  if (!confirm("¿Desactivar la verificación en dos pasos? Tu cuenta quedará protegida solo con la contraseña.")) return;

  const button = $("mfa-disable-btn");
  await withBusy(button, "Desactivando…", async () => {
    const { error } = await supabaseClient.auth.mfa.unenroll({ factorId });
    if (error) {
      showToast("No se pudo desactivar: " + error.message);
      return;
    }
    showToast("Verificación en dos pasos desactivada");
    loadMfaState();
  });
});


$("notify-toggle").addEventListener("change", async (e) => {
  const checked = e.target.checked;
  const { error } = await supabaseClient
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

$("change-password-btn").addEventListener("click", async () => {
  const newPassword = $("profile-new-password").value.trim();
  const passwordConfirm = $("profile-new-password-confirm").value.trim();

  if (!newPassword || newPassword.length < 10) {
    showToast("La contraseña debe tener al menos 10 caracteres");
    return;
  }

  if (newPassword !== passwordConfirm) {
    showToast("Las contraseñas no coinciden. Escríbelas igual en los dos campos.");
    return;
  }

  const button = $("change-password-btn");
  await withBusy(button, "Guardando…", async () => {
    const { error } = await supabaseClient.auth.updateUser({ password: newPassword });
    if (error) {
      showToast("No se pudo cambiar la contraseña: " + passwordErrorMessage(error), 6000);
      return;
    }

    $("profile-new-password").value = "";
    $("profile-new-password-confirm").value = "";
    showToast("Contraseña actualizada");
  });
});

$("delete-account-btn").addEventListener("click", async () => {
  const sure = confirm("Esto eliminará tu cuenta de forma permanente. ¿Seguro que quieres continuar?");
  if (!sure) return;
  const sureAgain = confirm("Confirma otra vez: se borrará tu registro y no podrás deshacerlo. ¿Eliminar cuenta?");
  if (!sureAgain) return;

  const button = $("delete-account-btn");
  await withBusy(button, "Eliminando…", async () => {
    try {
      const { data: { session } } = await supabaseClient.auth.getSession();
      const res = await fetch(`${SUPABASE_URL}/functions/v1/delete-account`, {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const result = await res.json();
      if (result.success) {
        await supabaseClient.auth.signOut();
        showToast("Cuenta eliminada");
      } else {
        showToast("Error al eliminar la cuenta: " + (result.error || ""));
      }
    } catch (err) {
      showToast("Error al eliminar la cuenta");
    }
  });
});

// ---------------------------------------------------------------
// Inventario — carga y listado
// ---------------------------------------------------------------
async function loadSuppliers() {
  const { data, error } = await supabaseClient
    .from("suppliers")
    .select("*, purchase_manager:profiles!suppliers_purchase_manager_id_fkey(id, email)")
    .order("name", { ascending: true, nullsFirst: false });

  if (error) {
    const msg = String(error.message || "");
    const isMissingTable = /relation .*suppliers.* does not exist|does not exist|not found.*suppliers|permission denied/i.test(msg);
    if (isMissingTable) {
      allSuppliers = [];
      populateSupplierSelects();
      renderSuppliersTable();
      console.warn("La tabla public.suppliers todavía no existe en Supabase o no es accesible. Ejecuta la migración del esquema para poder guardarlos.");
      return;
    }
    console.warn("No se pudieron cargar los proveedores:", error);
    return;
  }

  allSuppliers = data || [];
  populateSupplierSelects();
  renderSuppliersTable();
}

function getSupplierOptionsHtml(selectedValue = "") {
  const options = [
    '<option value="">Sin proveedor</option>',
    ...allSuppliers
      .filter((supplier) => supplier.name)
      .map((supplier) => `<option value="${escapeHtml(supplier.id)}" ${selectedValue === supplier.id ? "selected" : ""}>${escapeHtml(supplier.name)}</option>`),
  ];

  return options.join("");
}

function getMachineOptionsHtml(selectedValue = "") {
  const options = [
    '<option value="">Sin máquina</option>',
    ...allMachines
      .filter((machine) => machine.is_active || selectedValue === machine.id)
      .map((machine) => `<option value="${escapeHtml(machine.id)}" ${selectedValue === machine.id ? "selected" : ""}>${escapeHtml(machine.name)}${machine.is_active ? "" : " (inactiva)"}</option>`),
  ];

  return options.join("");
}

function populateMachineSelects() {
  ["add-machine", "edit-machine"].forEach((id) => {
    const select = $(id);
    if (!select) return;
    const current = select.value || "";
    select.innerHTML = getMachineOptionsHtml(current);
    if (current && [...select.options].some((option) => option.value === current)) {
      select.value = current;
    } else {
      select.value = "";
    }
  });
}

function populateSupplierSelects() {
  const addSelect = $("add-supplier");
  if (addSelect) {
    const current = addSelect.value || "";
    addSelect.innerHTML = getSupplierOptionsHtml(current);
    if (current && [...addSelect.options].some((option) => option.value === current)) {
      addSelect.value = current;
    } else {
      addSelect.value = "";
    }
  }

  const editSelect = $("edit-supplier");
  if (editSelect) {
    const current = editSelect.value || "";
    editSelect.innerHTML = getSupplierOptionsHtml(current);
    if (current && [...editSelect.options].some((option) => option.value === current)) {
      editSelect.value = current;
    } else {
      editSelect.value = "";
    }
  }
}

function normalizeProduct(product) {
  const { supplier_info: supplier, machine_info: machine, ...values } = product;
  return {
    ...values,
    category: machine?.name || null,
    supplier: supplier || null,
    machine: machine || null,
  };
}

function replaceProductInInventory(product) {
  const index = allProducts.findIndex((existing) => existing.id === product.id);
  if (index === -1) {
    allProducts.push(product);
  } else {
    allProducts[index] = { ...allProducts[index], ...product };
  }

  allProducts.sort((a, b) => a.name.localeCompare(b.name));
  renderProductList();
  updateLowStockBadge();
  populateDatalists();
}

async function loadProducts() {
  const { data, error } = await supabaseClient
    .from("products")
    .select("*, supplier_info:suppliers!products_supplier_id_fkey(id, name, email, phone), machine_info:machines!products_machine_id_fkey(id, name)")
    .order("name", { ascending: true });
  if (error) {
    showToast("Error al cargar el inventario");
    return;
  }
  allProducts = (data || []).map(normalizeProduct);
  populateHistoryProductFilter();
  renderProductList();
  updateLowStockBadge();
  populateDatalists();
  renderCategoryPills();
  requestAnimationFrame(() => {
    renderCategoryPills();
    renderProductList();
  });
}

function populateHistoryProductFilter() {
  const select = $("history-product-filter");
  if (!select) return;

  const selected = select.value;
  select.innerHTML = `<option value="">Todos los suministros</option>${allProducts
    .map((product) => `<option value="${escapeHtml(product.id)}">${escapeHtml(product.name)}</option>`)
    .join("")}`;
  if (allProducts.some((product) => product.id === selected)) select.value = selected;
}

function formatStockNumber(value) {
  return new Intl.NumberFormat("es-ES", { maximumFractionDigits: 2 }).format(Number(value) || 0);
}

// Un consumo de 0,03 al día se entiende mejor como “1 cada 30 días”.
function formatDailyRate(rate, unit) {
  if (!Number.isFinite(rate) || rate <= 0) return "Sin salidas";
  if (rate >= 1) return `${formatStockNumber(rate)}${unit}/día`;
  const days = Math.max(1, Math.round(1 / rate));
  return `1${unit} cada ${days} ${days === 1 ? "día" : "días"}`;
}

function machineNameForProductId(productId) {
  const product = allProducts.find((item) => item.id === productId);
  const name = productMachineName(product);
  return name || "—";
}

function formatMovementDate(value) {
  return new Intl.DateTimeFormat("es-ES", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function movementTypeLabel(type) {
  return {
    initial: "Alta inicial",
    baseline: "Saldo inicial",
    entry: "Entrada",
    withdrawal: "Salida",
  }[type] || "Movimiento";
}

function renderStockHistory() {
  const tbody = $("history-table-body");
  if (!tbody) return;

  if (!historyRows.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="table-empty-cell">No hay movimientos que coincidan con los filtros.</td></tr>';
  } else {
    tbody.innerHTML = historyRows.map((movement) => {
      const delta = Number(movement.quantity_delta);
      const deltaLabel = movement.movement_type === "baseline"
        ? "—"
        : `${delta > 0 ? "+" : delta < 0 ? "−" : ""}${formatStockNumber(Math.abs(delta))}`;
      const before = movement.quantity_before === null
        ? "—"
        : formatStockNumber(movement.quantity_before);

      return `
        <tr>
          <td data-label="Fecha">${escapeHtml(formatMovementDate(movement.created_at))}</td>
          <td data-label="Suministro" class="movement-product-cell">${escapeHtml(movement.product_name)}</td>
          <td data-label="Máquina" class="movement-machine-cell">${escapeHtml(machineNameForProductId(movement.product_id))}</td>
          <td data-label="Movimiento"><span class="movement-type ${escapeHtml(movement.movement_type)}">${escapeHtml(movementTypeLabel(movement.movement_type))}</span></td>
          <td data-label="Cambio" class="movement-delta ${delta < 0 ? "negative" : delta > 0 ? "positive" : ""}">${deltaLabel}</td>
          <td data-label="Stock resultante">${before} → ${formatStockNumber(movement.quantity_after)}${movement.unit ? ` ${escapeHtml(movement.unit)}` : ""}</td>
          <td data-label="Usuario">${escapeHtml(movement.user_email || "Sistema")}</td>
        </tr>
      `;
    }).join("");
  }

  const status = $("history-status");
  status.textContent = historyTotal
    ? `Mostrando ${historyRows.length} de ${historyTotal} movimientos.`
    : "";
  $("history-load-more").classList.toggle("hidden", historyRows.length >= historyTotal);
}

async function loadStockHistory(reset = false) {
  if (reset) {
    historyOffset = 0;
    historyTotal = 0;
    historyRows = [];
  }

  const status = $("history-status");
  status.textContent = "Cargando movimientos…";
  const productId = $("history-product-filter").value;
  const movementType = $("history-type-filter").value;
  const pageSize = 100;

  let request = supabaseClient
    .from("stock_movements")
    .select("id, product_id, product_name, unit, movement_type, quantity_before, quantity_after, quantity_delta, user_email, created_at", { count: "exact" })
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(historyOffset, historyOffset + pageSize - 1);
  if (productId) request = request.eq("product_id", productId);
  if (movementType) request = request.eq("movement_type", movementType);

  const { data, count, error } = await request;
  if (error) {
    status.textContent = "No se pudo cargar el registro de stock.";
    showToast("Error al cargar el registro: " + error.message);
    return;
  }

  historyRows = reset ? (data || []) : [...historyRows, ...(data || [])];
  historyTotal = count || 0;
  historyOffset = historyRows.length;
  renderStockHistory();
}

async function loadAllStockMovements() {
  const pageSize = 1000;
  const selection = "id, product_id, product_name, movement_type, quantity_before, quantity_after, quantity_delta, created_at";
  const { data: firstPage, count, error } = await supabaseClient
    .from("stock_movements")
    .select(selection, { count: "exact" })
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .range(0, pageSize - 1);
  if (error) throw error;

  const pages = await Promise.all(Array.from(
    { length: Math.ceil(Math.max(0, (count || 0) - pageSize) / pageSize) },
    (_, index) => {
      const from = (index + 1) * pageSize;
      return supabaseClient
        .from("stock_movements")
        .select(selection)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .range(from, from + pageSize - 1);
    }
  ));
  const failedPage = pages.find((page) => page.error);
  if (failedPage?.error) throw failedPage.error;

  return [
    ...(firstPage || []),
    ...pages.flatMap((page) => page.data || []),
  ];
}

function formatDurationDays(value) {
  if (!Number.isFinite(value) || value < 0) return "—";
  if (value < 1) return "Menos de 1 día";
  const rounded = Math.round(value);
  return `${rounded} ${rounded === 1 ? "día" : "días"}`;
}

// ---------------------------------------------------------------
// Previsión de consumo por máquina
// ---------------------------------------------------------------
const ANALYSIS_RECENT_WINDOW_DAYS = 30;
const ANALYSIS_DEFAULT_LEAD_TIME = 7;
const ANALYSIS_COVERAGE_SCALE_DAYS = 60;
// Días mínimos de historial antes de atreverse a estimar una fecha. Sin esto,
// una única salida se convierte en un ritmo diario falso.
const ANALYSIS_MIN_OBSERVATION_DAYS = 7;
const ANALYSIS_SINGLE_MOVEMENT_DAYS = 30;

function analysisDayKey(value) {
  const date = new Date(value);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function formatForecastDate(date) {
  if (!date) return "—";
  return new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "short" }).format(date);
}

// Plazo real de cada proveedor: media de días entre el envío del pedido y su
// recepción completa, calculada con los pedidos ya cerrados.
async function loadSupplierLeadTimes() {
  const leadTimes = new Map();

  try {
    const { data, error } = await supabaseClient
      .from("purchase_orders")
      .select("supplier_id, sent_at, closed_at")
      .not("sent_at", "is", null)
      .not("closed_at", "is", null)
      .order("created_at", { ascending: false })
      .limit(300);

    if (error || !Array.isArray(data)) return leadTimes;

    const totals = new Map();
    data.forEach((order) => {
      const start = new Date(order.sent_at).getTime();
      const end = new Date(order.closed_at).getTime();
      const days = (end - start) / 86400000;
      if (!Number.isFinite(days) || days < 0 || days > 120) return;
      const key = order.supplier_id || "__none__";
      const entry = totals.get(key) || { sum: 0, count: 0 };
      entry.sum += days;
      entry.count += 1;
      totals.set(key, entry);
    });

    totals.forEach((entry, key) => {
      leadTimes.set(key, Math.max(1, Math.round(entry.sum / entry.count)));
    });
  } catch (error) {
    console.warn("No se pudieron calcular los plazos de entrega:", error);
  }

  return leadTimes;
}

function buildSupplyForecast(product, withdrawals, now, leadTimeDays, periodDays = 0) {
  const quantity = Number(product.quantity) || 0;
  const activeDayKeys = new Set(withdrawals.map((movement) => analysisDayKey(movement.created_at)));
  const windowStart = periodDays > 0 ? now.getTime() - periodDays * 86400000 : null;
  const periodWithdrawals = windowStart === null
    ? withdrawals
    : withdrawals.filter((movement) => new Date(movement.created_at).getTime() >= windowStart);
  const totalWithdrawn = periodWithdrawals.reduce((sum, movement) => sum + Math.max(0, -Number(movement.quantity_delta)), 0);
  const firstWithdrawalAt = periodWithdrawals.length
    ? new Date(periodWithdrawals[0].created_at).getTime()
    : null;
  // El ritmo se mide por día de calendario desde la primera salida del periodo.
  // Antes se dividía solo entre los días con salida y una única retirada se
  // convertía en “1 al día”, con fechas y cantidades absurdas.
  const daysSinceFirst = firstWithdrawalAt === null
    ? 0
    : Math.max(1, (now.getTime() - firstWithdrawalAt) / 86400000);
  const hasEnoughData = firstWithdrawalAt !== null
    && daysSinceFirst >= ANALYSIS_MIN_OBSERVATION_DAYS
    && (periodWithdrawals.length >= 2 || daysSinceFirst >= ANALYSIS_SINGLE_MOVEMENT_DAYS);
  const observedDays = periodDays > 0
    ? Math.min(periodDays, Math.max(ANALYSIS_MIN_OBSERVATION_DAYS, daysSinceFirst))
    : Math.max(ANALYSIS_MIN_OBSERVATION_DAYS, daysSinceFirst);
  const rate = hasEnoughData ? totalWithdrawn / observedDays : 0;

  // Tendencia: el periodo elegido frente al periodo anterior de la misma
  // duración. Con “todo el historial” se comparan los últimos 30 días.
  let recentUnits = totalWithdrawn;
  let recentCount = periodWithdrawals.length;
  let previousUnits = 0;
  let previousCount = 0;

  if (windowStart !== null) {
    const previousStart = windowStart - periodDays * 86400000;
    withdrawals.forEach((movement) => {
      const time = new Date(movement.created_at).getTime();
      if (time >= previousStart && time < windowStart) {
        previousUnits += Math.max(0, -Number(movement.quantity_delta));
        previousCount += 1;
      }
    });
  } else {
    const recentFrom = now.getTime() - ANALYSIS_RECENT_WINDOW_DAYS * 86400000;
    const previousFrom = recentFrom - ANALYSIS_RECENT_WINDOW_DAYS * 86400000;
    recentUnits = 0;
    recentCount = 0;
    withdrawals.forEach((movement) => {
      const time = new Date(movement.created_at).getTime();
      const units = Math.max(0, -Number(movement.quantity_delta));
      if (time >= recentFrom) {
        recentUnits += units;
        recentCount += 1;
      } else if (time >= previousFrom) {
        previousUnits += units;
        previousCount += 1;
      }
    });
  }

  const coverageDays = rate > 0 ? quantity / rate : null;
  const depletionDate = coverageDays === null ? null : new Date(now.getTime() + coverageDays * 86400000);
  const reorderDate = depletionDate
    ? new Date(depletionDate.getTime() - leadTimeDays * 86400000)
    : null;
  const trendPercent = previousUnits > 0
    ? Math.round(((recentUnits - previousUnits) / previousUnits) * 100)
    : null;
  const isCritical = quantity === 0 || (coverageDays !== null && coverageDays <= leadTimeDays);

  return {
    product,
    rate,
    hasEnoughData,
    observedDays,
    coverageDays,
    depletionDate,
    reorderDate,
    leadTimeDays,
    trendPercent,
    totalWithdrawn,
    activeDays: activeDayKeys.size,
    activeDayKeys,
    recentCount,
    previousCount,
    isCritical,
  };
}

function summariseMachine(supplies, now) {
  const activeDays = new Set();
  let recentCount = 0;
  let previousCount = 0;

  supplies.forEach((forecast) => {
    forecast.activeDayKeys.forEach((key) => activeDays.add(key));
    recentCount += forecast.recentCount;
    previousCount += forecast.previousCount;
  });

  const recentFrom = now.getTime() - ANALYSIS_RECENT_WINDOW_DAYS * 86400000;
  const weekFrom = now.getTime() - 7 * 86400000;
  let activeDays30 = 0;
  let activeDays7 = 0;

  activeDays.forEach((key) => {
    const time = new Date(`${key}T00:00:00Z`).getTime();
    if (time >= recentFrom) activeDays30 += 1;
    if (time >= weekFrom) activeDays7 += 1;
  });

  const trendPercent = previousCount > 0
    ? Math.round(((recentCount - previousCount) / previousCount) * 100)
    : null;
  const streak = activeDays7 >= 3 && (trendPercent === null ? true : trendPercent >= 20);
  const nextSupply = supplies
    .filter((forecast) => forecast.depletionDate)
    .sort((a, b) => a.depletionDate - b.depletionDate)[0] || null;

  return { activeDays30, activeDays7, recentCount, previousCount, trendPercent, streak, nextSupply };
}

function renderMachineAnalysis(forecasts, now) {
  const container = $("analysis-machines");
  const riskBox = $("analysis-risk");
  if (!container) return;

  const groups = new Map();
  // Una tarjeta por cada máquina del sistema, aunque todavía no tenga
  // suministros o salidas: si no, parece que faltan máquinas.
  if (Array.isArray(allMachines)) {
    allMachines
      .filter((machine) => machine && machine.id && machine.is_active !== false)
      .forEach((machine) => {
        groups.set(machine.id, { machine, supplies: [] });
      });
  }

  forecasts.forEach((forecast) => {
    const machine = forecast.product.machine || null;
    const key = machine?.id || "__none__";
    if (!groups.has(key)) groups.set(key, { machine, supplies: [] });
    groups.get(key).supplies.push(forecast);
  });

  const cards = [...groups.values()].map((group) => {
    const supplies = group.supplies
      .filter((forecast) => forecast.rate > 0 || forecast.totalWithdrawn > 0 || Number(forecast.product.quantity) === 0)
      .sort((a, b) => {
        if (a.isCritical !== b.isCritical) return a.isCritical ? -1 : 1;
        if (a.depletionDate && b.depletionDate) return a.depletionDate - b.depletionDate;
        if (a.depletionDate) return -1;
        if (b.depletionDate) return 1;
        return a.product.name.localeCompare(b.product.name, "es");
      });

    return {
      machine: group.machine,
      supplies,
      hasSupplies: group.supplies.length > 0,
      summary: summariseMachine(group.supplies, now),
      criticalCount: group.supplies.filter((forecast) => forecast.isCritical).length,
    };
  })
    .sort((a, b) => {
      if (a.machine === null) return 1;
      if (b.machine === null) return -1;
      if (a.criticalCount !== b.criticalCount) return b.criticalCount - a.criticalCount;
      if (a.hasSupplies !== b.hasSupplies) return a.hasSupplies ? -1 : 1;
      const aDate = a.summary.nextSupply?.depletionDate?.getTime() ?? Infinity;
      const bDate = b.summary.nextSupply?.depletionDate?.getTime() ?? Infinity;
      if (aDate !== bDate) return aDate - bDate;
      return (a.machine.name || "").localeCompare(b.machine.name || "", "es");
    });

  const lateSupplies = forecasts
    .filter((forecast) => forecast.isCritical)
    .sort((a, b) => {
      const aDate = a.depletionDate?.getTime() ?? -Infinity;
      const bDate = b.depletionDate?.getTime() ?? -Infinity;
      return aDate - bDate;
    });

  if (riskBox) {
    const alertsBox = riskBox.closest(".analysis-alerts");
    if (alertsBox) alertsBox.classList.toggle("has-risk", lateSupplies.length > 0);
    if (lateSupplies.length) {
      const names = lateSupplies.slice(0, 4).map((forecast) => {
        const quantity = Number(forecast.product.quantity) || 0;
        const when = quantity === 0 ? "agotado" : `se agota el ${formatForecastDate(forecast.depletionDate)}`;
        return `${escapeHtml(forecast.product.name)} (${when})`;
      });
      const extra = lateSupplies.length > 4 ? ` y ${lateSupplies.length - 4} más` : "";
      riskBox.classList.remove("hidden");
      riskBox.innerHTML = `
        <strong>${lateSupplies.length} ${lateSupplies.length === 1 ? "suministro se agota" : "suministros se agotan"} antes de que llegue el pedido.</strong>
        <span>${names.join(", ")}${extra}.</span>
      `;
    } else {
      riskBox.classList.add("hidden");
      riskBox.innerHTML = "";
    }
  }

  if (!cards.length) {
    container.innerHTML = '<p class="analysis-empty">Todavía no hay máquinas ni salidas de stock registradas.</p>';
    return;
  }

  container.innerHTML = cards.map((card) => {
    const { machine, supplies, summary } = card;
    const name = machine?.name || "Sin máquina";
    const trend = summary.trendPercent;
    const trendLabel = trend === null
      ? "Sin actividad en el periodo anterior"
      : trend === 0
        ? "Actividad estable"
        : `${trend > 0 ? "▲" : "▼"} ${Math.abs(trend)} % de actividad`;
    const trendTone = trend === null ? "" : trend > 0 ? " is-up" : trend < 0 ? " is-down" : "";

    const suppliesMarkup = supplies.map((forecast) => {
      const quantity = Number(forecast.product.quantity) || 0;
      const unit = forecast.product.unit ? ` ${escapeHtml(forecast.product.unit)}` : "";
      const coverage = forecast.coverageDays;
      const width = coverage === null ? 0 : Math.max(6, Math.min(100, (coverage / ANALYSIS_COVERAGE_SCALE_DAYS) * 100));
      const tone = quantity === 0 || (coverage !== null && coverage <= forecast.leadTimeDays)
        ? " is-critical"
        : coverage !== null && coverage < 21
          ? " is-warning"
          : " is-ok";
      const whenLabel = quantity === 0
        ? "Agotado"
        : coverage === null
          ? "Faltan datos para estimar"
          : `Se agota el ${formatForecastDate(forecast.depletionDate)}`;
      const leadLabel = `plazo ${forecast.leadTimeDays} ${forecast.leadTimeDays === 1 ? "día" : "días"}`;
      const orderIsDue = forecast.reorderDate && forecast.reorderDate.getTime() <= now.getTime();
      const noteLabel = quantity === 0
        ? `Pedir ya · ${leadLabel}`
        : coverage === null
          ? "Pocas salidas registradas"
          : orderIsDue
            ? `Pedir ya · ${leadLabel}`
            : `Pedir antes del ${formatForecastDate(forecast.reorderDate)} · ${leadLabel}`;

      return `
        <li class="machine-supply${tone}">
          <span class="machine-supply-name">${escapeHtml(forecast.product.name)}</span>
          <span class="machine-supply-stock">${formatStockNumber(quantity)}${unit}</span>
          <span class="machine-supply-bar" role="presentation"><span style="width:${width.toFixed(1)}%"></span></span>
          <span class="machine-supply-when">${escapeHtml(whenLabel)}</span>
          <span class="machine-supply-note">${escapeHtml(noteLabel)}</span>
        </li>
      `;
    }).join("");

    const isMachineWithoutSupplies = !card.hasSupplies;
    const hasActivityData = supplies.length > 0;
    const cardClass = `machine-analysis-card${card.criticalCount ? " is-critical" : ""}${hasActivityData ? "" : " is-empty"}`;
    const metaLabel = isMachineWithoutSupplies
      ? "Sin suministros asignados"
      : !hasActivityData
        ? "Sin salidas registradas todavía"
        : "";
    const metaMarkup = metaLabel
      ? `<p class="machine-analysis-meta"><span>${metaLabel}</span></p>`
      : `<p class="machine-analysis-meta">
          ${summary.activeDays30} de ${ANALYSIS_RECENT_WINDOW_DAYS} días con actividad
          <span class="machine-analysis-trend${trendTone}">${trendLabel}</span>
        </p>`;
    const bodyMarkup = hasActivityData
      ? `<ul class="machine-supply-list">${suppliesMarkup}</ul>
         ${summary.nextSupply ? `<p class="machine-analysis-next">Siguiente en agotarse: <strong>${escapeHtml(summary.nextSupply.product.name)}</strong></p>` : ""}`
      : isMachineWithoutSupplies
        ? '<p class="machine-analysis-empty">Asigna suministros a esta máquina para ver su previsión.</p>'
        : "";

    return `
      <article class="${cardClass}">
        <header class="machine-analysis-head">
          <h4>${escapeHtml(name)}</h4>
          ${summary.streak ? '<span class="machine-analysis-badge">En racha</span>' : ""}
        </header>
        ${metaMarkup}
        ${bodyMarkup}
      </article>
    `;
  }).join("");
}

function buildProductConsumptionStats(product, movements, now) {
  const events = movements
    .filter((movement) => movement.product_id === product.id)
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at) || a.id - b.id);
  let incoming = 0;
  let outgoing = 0;
  let activeMilliseconds = 0;
  const exhaustedAt = [];

  events.forEach((movement) => {
    const delta = Number(movement.quantity_delta);
    if (movement.movement_type === "initial" || movement.movement_type === "entry") {
      incoming += Math.max(0, delta);
    }
    if (movement.movement_type === "withdrawal") {
      outgoing += Math.max(0, -delta);
      if (Number(movement.quantity_before) > 0 && Number(movement.quantity_after) === 0) {
        exhaustedAt.push(new Date(movement.created_at).getTime());
      }
    }
  });

  for (let index = 0; index < events.length; index += 1) {
    const start = new Date(events[index].created_at).getTime();
    const end = index + 1 < events.length
      ? new Date(events[index + 1].created_at).getTime()
      : now.getTime();
    if (Number(events[index].quantity_after) > 0) {
      activeMilliseconds += Math.max(0, end - start);
    }
  }

  const activeDays = activeMilliseconds / 86400000;
  const dailyAverage = activeDays > 0 ? outgoing / activeDays : null;
  const coverageDays = dailyAverage > 0 ? Number(product.quantity) / dailyAverage : null;
  const exhaustionIntervals = exhaustedAt.slice(1).map((timestamp, index) =>
    (timestamp - exhaustedAt[index]) / 86400000
  );
  const averageExhaustionInterval = exhaustionIntervals.length
    ? exhaustionIntervals.reduce((sum, days) => sum + days, 0) / exhaustionIntervals.length
    : null;

  return {
    product,
    incoming,
    outgoing,
    exhaustionCount: exhaustedAt.length,
    averageExhaustionInterval,
    dailyAverage,
    coverageDays,
  };
}

async function loadStockAnalytics() {
  const tbody = $("analysis-table-body");
  const machinesContainer = $("analysis-machines");
  tbody.innerHTML = '<tr><td colspan="9" class="table-empty-cell">Calculando análisis…</td></tr>';
  if (machinesContainer) {
    machinesContainer.innerHTML = '<p class="analysis-empty">Calculando el consumo por máquina…</p>';
  }

  try {
    const [movements, leadTimes] = await Promise.all([
      loadAllStockMovements(),
      loadSupplierLeadTimes(),
    ]);
    const earliestMovement = movements[0];
    $("analysis-start-date").textContent = earliestMovement
      ? new Intl.DateTimeFormat("es-ES", { dateStyle: "long" }).format(new Date(earliestMovement.created_at))
      : "—";

    if (!allProducts.length) {
      tbody.innerHTML = '<tr><td colspan="9" class="table-empty-cell">No hay suministros para analizar.</td></tr>';
      if (machinesContainer) {
        machinesContainer.innerHTML = '<p class="analysis-empty">No hay suministros para analizar.</p>';
      }
      return;
    }

    const now = new Date();
    const periodStart = analysisPeriodDays > 0
      ? now.getTime() - analysisPeriodDays * 86400000
      : null;
    const periodMovements = periodStart === null
      ? movements
      : movements.filter((movement) => new Date(movement.created_at).getTime() >= periodStart);

    const withdrawalsByProduct = new Map();
    movements.forEach((movement) => {
      if (movement.movement_type !== "withdrawal") return;
      const list = withdrawalsByProduct.get(movement.product_id);
      if (list) list.push(movement);
      else withdrawalsByProduct.set(movement.product_id, [movement]);
    });

    const forecasts = allProducts.map((product) => buildSupplyForecast(
      product,
      withdrawalsByProduct.get(product.id) || [],
      now,
      leadTimes.get(product.supplier_id || "__none__") ?? ANALYSIS_DEFAULT_LEAD_TIME,
      analysisPeriodDays
    ));
    const stats = allProducts.map((product) => buildProductConsumptionStats(product, periodMovements, now));
    const forecastById = new Map(forecasts.map((forecast) => [forecast.product.id, forecast]));

    renderMachineAnalysis(forecasts, now);

    stats.sort((a, b) => {
      const aCoverage = forecastById.get(a.product.id)?.coverageDays ?? null;
      const bCoverage = forecastById.get(b.product.id)?.coverageDays ?? null;
      if (aCoverage === null) return bCoverage === null ? a.product.name.localeCompare(b.product.name) : 1;
      if (bCoverage === null) return -1;
      return aCoverage - bCoverage;
    });

    tbody.innerHTML = stats.map((row) => {
      const forecast = forecastById.get(row.product.id);
      const unit = row.product.unit ? ` ${escapeHtml(row.product.unit)}` : "";
      const quantity = Number(row.product.quantity) || 0;
      const coverage = forecast?.coverageDays ?? null;
      const rateLabel = forecast && forecast.rate <= 0 && forecast.totalWithdrawn > 0
        ? "Faltan datos"
        : formatDailyRate(forecast?.rate ?? 0, unit);
      const whenLabel = quantity === 0
        ? "AGOTADO"
        : coverage === null
          ? "Faltan datos"
          : `${formatForecastDate(forecast.depletionDate)} · ${formatDurationDays(coverage)}`;

      return `
      <tr>
        <td data-label="Suministro" class="movement-product-cell">${escapeHtml(row.product.name)}</td>
        <td data-label="Máquina" class="movement-machine-cell">${escapeHtml(row.product.machine?.name || "—")}</td>
        <td data-label="Stock actual">${formatStockNumber(row.product.quantity)}${unit}</td>
        <td data-label="Entradas">${formatStockNumber(row.incoming)}</td>
        <td data-label="Salidas">${formatStockNumber(row.outgoing)}</td>
        <td data-label="Agotamientos">${row.exhaustionCount}</td>
        <td data-label="Media entre agotamientos">${row.averageExhaustionInterval === null ? "Aún sin media" : formatDurationDays(row.averageExhaustionInterval)}</td>
        <td data-label="Ritmo de consumo">${rateLabel}</td>
        <td data-label="Se agota" class="${quantity === 0 || (coverage !== null && coverage <= (forecast?.leadTimeDays || ANALYSIS_DEFAULT_LEAD_TIME)) ? "analysis-low-coverage" : ""}">${whenLabel}</td>
      </tr>
    `;
    }).join("");
  } catch (error) {
    tbody.innerHTML = '<tr><td colspan="9" class="table-empty-cell">No se pudo cargar el análisis de consumo.</td></tr>';
    if (machinesContainer) {
      machinesContainer.innerHTML = '<p class="analysis-empty">No se pudo calcular el consumo por máquina.</p>';
    }
    showToast("Error al calcular el análisis: " + error.message);
  }
}

populateHistoryProductFilter();
$("history-product-filter").addEventListener("change", () => loadStockHistory(true));
$("history-type-filter").addEventListener("change", () => loadStockHistory(true));
$("history-load-more").addEventListener("click", () => {
  withBusy($("history-load-more"), "Cargando…", () => loadStockHistory());
});

function renderSuppliersTable() {
  const tbody = $("suppliers-table-body");
  if (!tbody) return;

  if (!allSuppliers.length) {
    tbody.innerHTML = `
      <tr>
        <td colspan="5" class="table-empty-cell">Todavía no hay proveedores guardados.</td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = allSuppliers
    .map((supplier) => {
      const emails = (supplier.email || "")
        .split(";")
        .map((email) => email.trim())
        .filter(Boolean);

      return `
        <tr>
          <td class="supplier-name-cell">${escapeHtml(supplier.name || "—")}</td>
          <td data-label="Email">${escapeHtml(emails.length ? emails.join("; ") : "—")}</td>
          <td data-label="Teléfono">${escapeHtml(supplier.phone || "—")}</td>
          <td data-label="Responsable de compras">${escapeHtml(supplier.purchase_manager?.email || "Sin asignar")}</td>
          <td class="supplier-actions" data-label="Acciones">
            <button type="button" class="btn btn-outline supplier-edit-btn" data-supplier-id="${supplier.id}" aria-label="Editar proveedor" title="Editar proveedor">
              <svg aria-hidden="true" viewBox="0 0 24 24"><path d="m16 4 4 4M4 20l4-1 12-12a2.12 2.12 0 0 0-3-3L5 16l-1 4Z"/></svg>
            </button>
            <button type="button" class="btn btn-red supplier-delete-btn" data-supplier-id="${supplier.id}" aria-label="Borrar proveedor" title="Borrar proveedor">
              <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M3 6h18M8 6V4h8v2m3 0-1 14H6L5 6m5 5v5m4-5v5"/></svg>
            </button>
          </td>
        </tr>
      `;
    })
    .join("");

  tbody.querySelectorAll(".supplier-edit-btn").forEach((btn) => {
    btn.addEventListener("click", () => openSupplierModal(allSuppliers.find((supplier) => supplier.id === btn.dataset.supplierId)));
  });

  tbody.querySelectorAll(".supplier-delete-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const supplier = allSuppliers.find((item) => item.id === btn.dataset.supplierId);
      if (!supplier) return;
      const sure = confirm(`¿Borrar el proveedor "${supplier.name || "sin nombre"}"? Los suministros asociados quedarán sin proveedor.`);
      if (!sure) return;

      try {
        await withBusy(btn, "Eliminando…", async () => {
          const { error } = await supabaseClient.from("suppliers").delete().eq("id", supplier.id);
          if (error) throw error;

          await loadSuppliers();
          await loadProducts();
          showToast("Proveedor eliminado");
        });
      } catch (error) {
        showToast("No se pudo eliminar el proveedor: " + error.message);
      }
    });
  });
}

function openSupplierModal(supplier = null) {
  if (hasOpenModal()) return;
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop centered";
  backdrop.innerHTML = `
    <div class="modal-sheet supplier-modal">
      <div class="modal-header">
        <h2>${supplier ? "Editar proveedor" : "Nuevo proveedor"}</h2>
        <button type="button" class="modal-close" aria-label="Cerrar">&times;</button>
      </div>
      <form id="supplier-form">
        <div class="field">
          <label for="supplier-name">Nombre</label>
          <input type="text" id="supplier-name" value="${escapeHtml(supplier?.name || "")}" placeholder="Ej: Epson" />
        </div>
        <div class="field">
          <label for="supplier-email">Email</label>
          <input type="text" id="supplier-email" value="${escapeHtml(supplier?.email || "")}" placeholder="Ej: compras@epson.com; pedidos@epson.com" />
        </div>
        <div class="field">
          <label for="supplier-phone">Teléfono</label>
          <input type="tel" id="supplier-phone" value="${escapeHtml(supplier?.phone || "")}" placeholder="Ej: 612 345 678" />
        </div>
        <div class="field">
          <label for="supplier-manager">Responsable de compras</label>
          <select id="supplier-manager">
            <option value="">Sin responsable</option>
            ${allProfiles.map((profile) => `<option value="${escapeHtml(profile.id)}" ${supplier?.purchase_manager_id === profile.id ? "selected" : ""}>${escapeHtml(profile.email)}</option>`).join("")}
          </select>
          <small class="field-hint">Recibirá los pedidos de este proveedor. Necesario para poder enviarlos.</small>
        </div>
        <button type="submit" class="btn btn-primary">${supplier ? "Guardar cambios" : "Guardar proveedor"}</button>
      </form>
    </div>
  `;

  document.body.appendChild(backdrop);

  const close = () => backdrop.remove();
  backdrop.querySelector(".modal-close").addEventListener("click", close);
  backdrop.addEventListener("click", (event) => {
    if (event.target === backdrop) close();
  });

  backdrop.querySelector("#supplier-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const name = $("supplier-name").value.trim();
    const email = $("supplier-email").value.trim();
    const phone = $("supplier-phone").value.trim();
    const purchaseManagerId = $("supplier-manager").value || null;

    if (!name && !email && !phone) {
      showToast("Rellena al menos un dato del proveedor.");
      return;
    }

    const payload = {
      name: name || null,
      email: email || null,
      phone: phone || null,
      purchase_manager_id: purchaseManagerId,
    };

    const submit = backdrop.querySelector('button[type="submit"]');
    await withBusy(submit, "Guardando…", async () => {
      try {
        if (supplier?.id) {
          const { error } = await supabaseClient.from("suppliers").update(payload).eq("id", supplier.id);
          if (error) throw error;
        } else {
          const { error } = await supabaseClient.from("suppliers").insert(payload);
          if (error) throw error;
        }

        close();
        await loadSuppliers();
        await loadProducts();
        renderOrderPicker();
        renderOrderCart();
        showToast(supplier ? "Proveedor actualizado" : "Proveedor guardado");
      } catch (error) {
        showToast("No se pudo guardar el proveedor: " + error.message);
      }
    });
  });
}

$("new-supplier-btn").addEventListener("click", () => openSupplierModal());

async function loadMachines() {
  const { data, error } = await supabaseClient
    .from("machines")
    .select("*, supplier_info:suppliers!machines_supplier_id_fkey(id, name, email, phone)")
    .order("name", { ascending: true });

  if (error) {
    showToast("No se pudo cargar la maquinaria: " + error.message);
    return;
  }

  allMachines = data || [];
  populateMachineSelects();
  renderMachines();
}

function renderMachines() {
  const container = $("machines-list");
  if (!container) return;

  if (!allMachines.length) {
    container.innerHTML = '<p class="empty-state">Todavía no hay máquinas. Añade la primera para asociarla a sus suministros.</p>';
    return;
  }

  container.innerHTML = allMachines.map((machine) => {
    const supplier = machine.supplier_info;
    const details = [machine.model, machine.serial_number ? `N.º serie: ${machine.serial_number}` : ""].filter(Boolean);
    const linkedProducts = allProducts.filter((product) => product.machine_id === machine.id).length;

    return `
      <article class="machine-card${machine.is_active ? "" : " inactive"}">
        <div class="machine-card-main">
          <div class="machine-card-heading">
            <div>
              <h3>${escapeHtml(machine.name)}</h3>
              ${details.length ? `<p>${details.map(escapeHtml).join(" · ")}</p>` : ""}
            </div>
            ${machine.is_active ? "" : '<span class="machine-status">Inactiva</span>'}
          </div>
          <div class="machine-supplier">
            <strong>Proveedor:</strong> ${escapeHtml(supplier?.name || "Pendiente de asignar")}
            ${supplier?.email ? `<span>${escapeHtml(supplier.email)}</span>` : ""}
            ${supplier?.phone ? `<span>${escapeHtml(supplier.phone)}</span>` : ""}
          </div>
          <div class="machine-meta">${linkedProducts} suministros asociados</div>
        </div>
        <div class="machine-actions">
          ${machine.is_active && supplier ? `<button type="button" class="btn btn-teal machine-request-btn" data-machine-id="${machine.id}">Solicitar servicio técnico</button>` : ""}
          ${machine.is_active && !supplier ? '<span class="machine-assignment-hint">Asigna un proveedor para solicitar servicio técnico.</span>' : ""}
          <button type="button" class="btn btn-outline machine-edit-btn" data-machine-id="${machine.id}">Editar</button>
          <button type="button" class="btn btn-outline machine-archive-btn" data-machine-id="${machine.id}">${machine.is_active ? "Eliminar" : "Reactivar"}</button>
        </div>
      </article>
    `;
  }).join("");

  container.querySelectorAll(".machine-edit-btn").forEach((button) => {
    button.addEventListener("click", () => openMachineModal(allMachines.find((machine) => machine.id === button.dataset.machineId)));
  });
  container.querySelectorAll(".machine-request-btn").forEach((button) => {
    button.addEventListener("click", () => openServiceRequestModal(allMachines.find((machine) => machine.id === button.dataset.machineId)));
  });
  container.querySelectorAll(".machine-archive-btn").forEach((button) => {
    button.addEventListener("click", () => toggleMachineActive(allMachines.find((machine) => machine.id === button.dataset.machineId), button));
  });
}

function openMachineModal(machine = null) {
  if (hasOpenModal()) return;
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop centered";
  backdrop.innerHTML = `
    <div class="modal-sheet machine-modal">
      <div class="modal-header">
        <h2>${machine ? "Editar máquina" : "Nueva máquina"}</h2>
        <button type="button" class="modal-close" aria-label="Cerrar">&times;</button>
      </div>
      <form id="machine-form">
        <div class="field">
          <label for="machine-name">Nombre *</label>
          <input type="text" id="machine-name" required maxlength="120" value="${escapeHtml(machine?.name || "")}" placeholder="Ej: Roland" />
        </div>
        <div class="field">
          <label for="machine-model">Marca / modelo</label>
          <input type="text" id="machine-model" maxlength="160" value="${escapeHtml(machine?.model || "")}" placeholder="Ej: TrueVIS VG3-640" />
        </div>
        <div class="field">
          <label for="machine-serial">Número de serie</label>
          <input type="text" id="machine-serial" maxlength="120" value="${escapeHtml(machine?.serial_number || "")}" />
        </div>
        <div class="field">
          <label for="machine-supplier">Proveedor asignado *</label>
          <select id="machine-supplier" required>
            <option value="">Selecciona un proveedor</option>
            ${allSuppliers.filter((supplier) => supplier.name).map((supplier) => `<option value="${escapeHtml(supplier.id)}" ${machine?.supplier_id === supplier.id ? "selected" : ""}>${escapeHtml(supplier.name)}</option>`).join("")}
          </select>
          ${!allSuppliers.some((supplier) => supplier.name) ? '<small>Añade primero un proveedor en la sección Proveedores.</small>' : ""}
        </div>
        <button type="submit" class="btn btn-primary">${machine ? "Guardar cambios" : "Guardar máquina"}</button>
      </form>
    </div>
  `;
  document.body.appendChild(backdrop);

  const close = () => backdrop.remove();
  backdrop.querySelector(".modal-close").addEventListener("click", close);
  backdrop.addEventListener("click", (event) => {
    if (event.target === backdrop) close();
  });

  backdrop.querySelector("#machine-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const payload = {
      name: backdrop.querySelector("#machine-name").value.trim(),
      model: backdrop.querySelector("#machine-model").value.trim() || null,
      serial_number: backdrop.querySelector("#machine-serial").value.trim() || null,
      supplier_id: backdrop.querySelector("#machine-supplier").value,
    };
    if (!payload.supplier_id) {
      showToast("Asigna un proveedor a la máquina.");
      return;
    }

    const submit = backdrop.querySelector('button[type="submit"]');
    await withBusy(submit, "Guardando…", async () => {
      try {
        const query = machine
          ? supabaseClient.from("machines").update(payload).eq("id", machine.id)
          : supabaseClient.from("machines").insert(payload);
        const { error } = await query;
        if (error) throw error;

        close();
        await loadMachines();
        await loadProducts();
        showToast(machine ? "Máquina actualizada" : "Máquina guardada");
      } catch (error) {
        showToast("No se pudo guardar la máquina: " + error.message);
      }
    });
  });
}

async function toggleMachineActive(machine, button = null) {
  if (!machine) return;

  await withBusy(button, machine.is_active ? "Actualizando…" : "Reactivando…", async () => {
    if (!machine.is_active) {
      const { error } = await supabaseClient.from("machines").update({ is_active: true }).eq("id", machine.id);
      if (error) {
        showToast("No se pudo reactivar la máquina: " + error.message);
        return;
      }
      await loadMachines();
      showToast("Máquina reactivada");
      return;
    }

    const hasProducts = allProducts.some((product) => product.machine_id === machine.id);
    const { count: requestCount, error: requestCountError } = await supabaseClient
      .from("maintenance_requests")
      .select("id", { count: "exact", head: true })
      .eq("machine_id", machine.id);
    if (requestCountError) {
      showToast("No se pudo comprobar el historial de la máquina: " + requestCountError.message);
      return;
    }
    const hasRequests = requestCount > 0;
    const action = hasProducts || hasRequests ? "archivarse como inactiva" : "eliminarse";
    if (!confirm(`¿Quieres que "${machine.name}" ${action}?${hasProducts || hasRequests ? " Se conservarán sus suministros e historial." : ""}`)) return;

    const { error } = hasProducts || hasRequests
      ? await supabaseClient.from("machines").update({ is_active: false }).eq("id", machine.id)
      : await supabaseClient.from("machines").delete().eq("id", machine.id);
    if (error) {
      showToast("No se pudo eliminar la máquina: " + error.message);
      return;
    }

    await loadMachines();
    await loadProducts();
    await loadServiceRequests();
    showToast(hasProducts || hasRequests ? "Máquina archivada" : "Máquina eliminada");
  });
}

async function loadServiceRequests() {
  const { data, error } = await supabaseClient
    .from("maintenance_requests")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) {
    showToast("No se pudo cargar el historial de servicio técnico: " + error.message);
    return;
  }

  allServiceRequests = data || [];

  const requestIds = allServiceRequests.map((request) => request.id);
  allServiceRequestEvents = [];
  if (requestIds.length) {
    const { data: events, error: eventsError } = await supabaseClient
      .from("maintenance_request_events")
      .select("*")
      .in("request_id", requestIds)
      .order("created_at", { ascending: true });
    if (eventsError) {
      console.warn("No se pudo cargar el historial de estados:", eventsError);
    } else {
      allServiceRequestEvents = events || [];
    }
  }

  const photoPaths = [...new Set(allServiceRequests.flatMap((request) => (
    Array.isArray(request.photo_paths) ? request.photo_paths : []
  )))];
  const signedByPath = new Map();
  if (photoPaths.length) {
    const { data: signed, error: signedError } = await supabaseClient.storage
      .from(SERVICE_PHOTO_BUCKET)
      .createSignedUrls(photoPaths, 86400);
    if (signedError) {
      console.warn("No se pudieron firmar las fotos de servicio técnico:", signedError);
    } else {
      (signed || []).forEach((item) => {
        if (item.signedUrl) signedByPath.set(item.path, item.signedUrl);
      });
    }
  }

  allServiceRequests = allServiceRequests.map((request) => ({
    ...request,
    photo_urls: (Array.isArray(request.photo_paths) ? request.photo_paths : [])
      .map((path) => signedByPath.get(path))
      .filter(Boolean),
  }));

  renderServiceRequests();
}

const SERVICE_STATUS_LABELS = {
  pending: "Pendiente",
  in_progress: "En curso",
  resolved: "Resuelta",
};

function serviceStatusLabel(status) {
  return SERVICE_STATUS_LABELS[status] || status || "Sin estado";
}

function formatServiceDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("es-ES");
}

function updateServiceBadge() {
  const open = allServiceRequests.filter(
    (request) => request.status === "pending" || request.status === "in_progress"
  ).length;
  document.querySelectorAll("[data-service-badge]").forEach((badge) => {
    badge.textContent = open > 9 ? "9+" : String(open);
    badge.classList.toggle("hidden", open === 0);
    const tab = badge.closest(".workshop-tab");
    if (tab) {
      tab.setAttribute(
        "aria-label",
        open === 0 ? "Solicitudes" : `Solicitudes, ${open} sin resolver`
      );
    }
  });
}

function renderServiceRequests() {
  updateServiceBadge();
  const container = $("service-requests-list");
  if (!container) return;
  if (!allServiceRequests.length) {
    container.innerHTML = '<p class="empty-state">Todavía no hay solicitudes de servicio técnico.</p>';
    return;
  }

  const statuses = Object.entries(SERVICE_STATUS_LABELS);
  const eventsByRequest = allServiceRequestEvents.reduce((groups, event) => {
    if (!groups[event.request_id]) groups[event.request_id] = [];
    groups[event.request_id].push(event);
    return groups;
  }, {});

  container.innerHTML = allServiceRequests.map((request) => {
    const events = eventsByRequest[request.id] || [];
    const photos = request.photo_urls || [];

    return `
      <article class="service-request-card">
        <div class="service-request-heading">
          <div>
            <h3>${escapeHtml(request.machine_name)}</h3>
            <time>${escapeHtml(formatServiceDate(request.created_at))}</time>
          </div>
          <label class="service-status-control">
            <span>Estado</span>
            <select class="service-status-select" data-request-id="${request.id}" aria-label="Estado de solicitud para ${escapeHtml(request.machine_name)}">
              ${statuses.map(([value, label]) => `<option value="${value}" ${request.status === value ? "selected" : ""}>${label}</option>`).join("")}
            </select>
          </label>
        </div>
        <p class="service-request-reason">${escapeHtml(request.reason)}</p>
        <p class="service-request-provider"><strong>Proveedor:</strong> ${escapeHtml(request.supplier_name || "Sin proveedor")}
          ${request.supplier_email ? ` · ${escapeHtml(request.supplier_email)}` : ""}
          ${request.supplier_phone ? ` · ${escapeHtml(request.supplier_phone)}` : ""}
        </p>
        ${photos.length ? `
          <div class="service-request-photos">
            ${photos.map((url, index) => `
              <button type="button" class="service-photo-btn"
                data-photo-url="${escapeHtml(url)}"
                data-photo-label="Foto ${index + 1} de ${photos.length} · ${escapeHtml(request.machine_name)}"
                title="Ampliar foto ${index + 1}"
                aria-label="Ampliar foto ${index + 1} de ${photos.length} de la solicitud de ${escapeHtml(request.machine_name)}">
                <img src="${escapeHtml(url)}" alt="Foto ${index + 1} de la solicitud" loading="lazy" />
              </button>
            `).join("")}
          </div>
        ` : ""}
        <details class="service-request-history">
          <summary>Historial de estados${events.length ? ` (${events.length})` : ""}</summary>
          ${events.length ? `
            <ol class="service-history-list">
              ${events.map((event) => `
                <li>
                  <span class="service-history-status ${escapeHtml(event.status)}">${escapeHtml(serviceStatusLabel(event.status))}</span>
                  <span class="service-history-meta">
                    ${escapeHtml(formatServiceDate(event.created_at))}
                    ${event.changed_by_email ? ` · ${escapeHtml(event.changed_by_email)}` : ""}
                  </span>
                  <span class="service-history-change">
                    ${event.previous_status ? `Antes: ${escapeHtml(serviceStatusLabel(event.previous_status))}` : "Solicitud creada"}
                  </span>
                </li>
              `).join("")}
            </ol>
          ` : '<p class="service-history-empty">Todavía no hay cambios registrados.</p>'}
        </details>
        <div class="service-request-footer">
          <span class="${request.notification_sent ? "email-sent" : "email-pending"}">${request.notification_sent ? "Aviso enviado al equipo" : "Aviso pendiente de envío"}</span>
          ${request.notification_sent ? "" : `<button type="button" class="btn btn-outline service-retry-btn" data-request-id="${request.id}">Reintentar envío</button>`}
        </div>
      </article>
    `;
  }).join("");

  container.querySelectorAll(".service-status-select").forEach((select) => {
    select.addEventListener("change", () => updateServiceRequestStatus(select.dataset.requestId, select.value));
  });
  container.querySelectorAll(".service-photo-btn").forEach((button) => {
    button.addEventListener("click", () => openPhotoLightbox(button.dataset.photoUrl, button.dataset.photoLabel));
  });
  container.querySelectorAll(".service-retry-btn").forEach((button) => {
    button.addEventListener("click", () => withBusy(button, "Enviando…", () => retryServiceRequestEmail(button.dataset.requestId)));
  });
}

function openPhotoLightbox(url, label) {
  if (!url) return;
  const previousFocus = document.activeElement;
  const caption = label || "Foto de la solicitud";

  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop centered photo-lightbox";
  backdrop.innerHTML = `
    <div class="photo-lightbox-sheet" role="dialog" aria-modal="true" aria-label="${escapeHtml(caption)}">
      <button type="button" class="photo-lightbox-close" aria-label="Cerrar la foto">&times;</button>
      <img src="${escapeHtml(url)}" alt="${escapeHtml(caption)}" />
      <p class="photo-lightbox-caption">${escapeHtml(caption)}</p>
    </div>`;
  document.body.appendChild(backdrop);

  const onKey = (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
    }
  };

  function close() {
    document.removeEventListener("keydown", onKey);
    backdrop.remove();
    if (previousFocus && typeof previousFocus.focus === "function") previousFocus.focus();
  }

  backdrop.querySelector(".photo-lightbox-close").addEventListener("click", close);
  backdrop.addEventListener("click", (event) => {
    if (event.target === backdrop) close();
  });
  document.addEventListener("keydown", onKey);
  backdrop.querySelector(".photo-lightbox-close").focus();
}

async function updateServiceRequestStatus(requestId, status) {
  const request = allServiceRequests.find((item) => item.id === requestId);
  if (request?.status === status) return;

  const select = document.querySelector(`.service-status-select[data-request-id="${requestId}"]`);
  if (select) select.disabled = true;

  const { error } = await supabaseClient
    .from("maintenance_requests")
    .update({ status })
    .eq("id", requestId);
  if (error) {
    showToast("No se pudo actualizar el estado: " + error.message);
    await loadServiceRequests();
    return;
  }
  await loadServiceRequests();
  showToast("Estado actualizado");
}

function newPhotoId() {
  if (window.crypto && typeof window.crypto.randomUUID === "function") {
    return window.crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function loadImageElement(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Formato de imagen no compatible."));
    };
    image.src = url;
  });
}

async function compressServicePhoto(file) {
  if (!file.type.startsWith("image/")) {
    throw new Error(`"${file.name}" no es una imagen.`);
  }
  if (file.size > SERVICE_PHOTO_MAX_BYTES) {
    throw new Error(`"${file.name}" supera los 5 MB.`);
  }

  try {
    const image = typeof createImageBitmap === "function"
      ? await createImageBitmap(file)
      : await loadImageElement(file);
    const width = image.width;
    const height = image.height;
    const scale = Math.min(1, SERVICE_PHOTO_MAX_DIMENSION / Math.max(width, height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
    if (typeof image.close === "function") image.close();

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.82));
    if (!blob) throw new Error("No se pudo convertir la imagen.");
    return { blob, extension: "jpg", contentType: "image/jpeg" };
  } catch (error) {
    const extension = (file.name.split(".").pop() || "jpg")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "") || "jpg";
    return { blob: file, extension, contentType: file.type || "image/jpeg" };
  }
}

async function uploadServicePhotos(files) {
  const paths = [];
  const attachments = [];

  try {
    for (const file of files) {
      const { blob, extension, contentType } = await compressServicePhoto(file);
      const path = `${currentUser.id}/${newPhotoId()}.${extension}`;
      const { error } = await supabaseClient.storage
        .from(SERVICE_PHOTO_BUCKET)
        .upload(path, blob, { contentType, upsert: false });
      if (error) throw new Error(error.message);

      paths.push(path);
      attachments.push({ name: `foto-${paths.length}.${extension}`, blob });
    }
    return { paths, attachments };
  } catch (error) {
    if (paths.length) {
      try {
        await supabaseClient.storage.from(SERVICE_PHOTO_BUCKET).remove(paths);
      } catch (cleanupError) {
        console.warn("No se pudieron limpiar las fotos subidas:", cleanupError);
      }
    }
    throw error;
  }
}

async function createServicePhotoSignedUrls(paths, expiresIn = 604800) {
  if (!Array.isArray(paths) || !paths.length) return [];
  const { data, error } = await supabaseClient.storage
    .from(SERVICE_PHOTO_BUCKET)
    .createSignedUrls(paths, expiresIn);
  if (error) {
    console.warn("No se pudieron firmar las fotos:", error);
    return [];
  }
  return (data || []).map((item) => item.signedUrl).filter(Boolean);
}

function openServiceRequestModal(machine) {
  if (hasOpenModal()) return;
  if (!machine?.supplier_info) {
    showToast("Asigna un proveedor a la máquina antes de solicitar servicio técnico.");
    return;
  }

  const selectedPhotos = [];
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop centered";
  backdrop.innerHTML = `
    <div class="modal-sheet machine-modal">
      <div class="modal-header">
        <h2>Solicitar servicio técnico</h2>
        <button type="button" class="modal-close" aria-label="Cerrar">&times;</button>
      </div>
      <p class="service-modal-machine">${escapeHtml(machine.name)}${machine.model ? ` · ${escapeHtml(machine.model)}` : ""}</p>
      <p class="service-modal-provider">Proveedor: ${escapeHtml(machine.supplier_info.name || "Sin nombre")}</p>
      <form id="service-request-form">
        <div class="field">
          <label for="service-request-reason">Motivo de la solicitud *</label>
          <textarea id="service-request-reason" required maxlength="2000" rows="5" placeholder="Describe el problema o servicio que necesitas"></textarea>
        </div>
        <div class="field">
          <label for="service-request-photos">Fotos (opcional)</label>
          <input type="file" id="service-request-photos" accept="image/*" multiple />
          <small class="field-hint">Hasta ${SERVICE_PHOTO_MAX_FILES} fotos de 5 MB como máximo. Se reducirán antes de enviarlas.</small>
          <div id="service-photo-preview" class="service-photo-preview"></div>
        </div>
        <button type="submit" class="btn btn-primary">Enviar solicitud</button>
      </form>
    </div>
  `;
  document.body.appendChild(backdrop);

  const photoInput = backdrop.querySelector("#service-request-photos");
  const photoPreview = backdrop.querySelector("#service-photo-preview");

  const renderPhotoPreview = () => {
    photoPreview.innerHTML = selectedPhotos.map((photo, index) => `
      <div class="service-photo-item">
        <img src="${photo.previewUrl}" alt="Foto ${index + 1}" />
        <button type="button" class="service-photo-remove" data-photo-index="${index}" aria-label="Quitar foto ${index + 1}">&times;</button>
      </div>
    `).join("");

    photoPreview.querySelectorAll(".service-photo-remove").forEach((button) => {
      button.addEventListener("click", () => {
        const [removed] = selectedPhotos.splice(Number(button.dataset.photoIndex), 1);
        if (removed) URL.revokeObjectURL(removed.previewUrl);
        renderPhotoPreview();
      });
    });
  };

  photoInput.addEventListener("change", () => {
    [...photoInput.files].forEach((file) => {
      if (selectedPhotos.length >= SERVICE_PHOTO_MAX_FILES) {
        showToast(`Puedes adjuntar como máximo ${SERVICE_PHOTO_MAX_FILES} fotos.`);
        return;
      }
      if (!file.type.startsWith("image/")) {
        showToast(`"${file.name}" no es una imagen.`);
        return;
      }
      if (file.size > SERVICE_PHOTO_MAX_BYTES) {
        showToast(`"${file.name}" supera los 5 MB.`);
        return;
      }
      selectedPhotos.push({ file, previewUrl: URL.createObjectURL(file) });
    });
    photoInput.value = "";
    renderPhotoPreview();
  });

  const close = () => {
    selectedPhotos.forEach((photo) => URL.revokeObjectURL(photo.previewUrl));
    backdrop.remove();
  };
  backdrop.querySelector(".modal-close").addEventListener("click", close);
  backdrop.addEventListener("click", (event) => {
    if (event.target === backdrop) close();
  });

  backdrop.querySelector("#service-request-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const reason = backdrop.querySelector("#service-request-reason").value.trim();
    if (!reason) {
      showToast("Escribe el motivo de la solicitud.");
      return;
    }

    const supplier = machine.supplier_info;
    const submitButton = backdrop.querySelector('[type="submit"]');
    const originalButtonText = submitButton.textContent;
    submitButton.disabled = true;

    let uploaded = { paths: [], attachments: [] };
    try {
      if (selectedPhotos.length) {
        submitButton.textContent = "Subiendo fotos…";
        uploaded = await uploadServicePhotos(selectedPhotos.map((photo) => photo.file));
      }

      submitButton.textContent = "Guardando solicitud…";
      const request = {
        machine_id: machine.id,
        machine_name: machine.name,
        machine_model: machine.model,
        machine_serial_number: machine.serial_number,
        supplier_name: supplier.name,
        supplier_email: supplier.email,
        supplier_phone: supplier.phone,
        reason,
        photo_paths: uploaded.paths,
        created_by: currentUser?.id || null,
      };

      const { data, error } = await supabaseClient
        .from("maintenance_requests")
        .insert(request)
        .select("*")
        .single();
      if (error) throw new Error(error.message);

      close();
      await loadServiceRequests();

      try {
        const photoUrls = await createServicePhotoSignedUrls(uploaded.paths);
        await sendServiceRequestEmail(data, {
          photoUrls,
          photoAttachments: uploaded.attachments,
        });
        const { error: updateError } = await supabaseClient
          .from("maintenance_requests")
          .update({ notification_sent: true })
          .eq("id", data.id);
        if (updateError) throw new Error(`El email se envió, pero no se pudo actualizar el historial: ${updateError.message}`);
        showToast("Solicitud guardada y aviso enviado al equipo");
      } catch (error) {
        showToast(`La solicitud quedó guardada, pero no se pudo enviar el aviso: ${error.message}`, 6000);
      }
      await loadServiceRequests();
    } catch (error) {
      if (uploaded.paths.length) {
        try {
          await supabaseClient.storage.from(SERVICE_PHOTO_BUCKET).remove(uploaded.paths);
        } catch (cleanupError) {
          console.warn("No se pudieron limpiar las fotos de la solicitud fallida:", cleanupError);
        }
      }
      submitButton.disabled = false;
      submitButton.textContent = originalButtonText;
      showToast("No se pudo guardar la solicitud: " + error.message, 6000);
    }
  });
}

function buildServiceRequestEmailHtml(request, photoUrls = []) {
  return `
    <div style="font-family:Arial,sans-serif;color:#1e1e1e;max-width:640px;margin:0 auto;background:#f7f7f7;padding:24px;border-radius:12px">
      <div style="background:#111827;color:#fff;border-radius:10px 10px 0 0;padding:18px 20px">
        <div style="font-size:22px;font-weight:700">Stock Impresión</div>
        <div style="font-size:12px;margin-top:6px">Solicitud de servicio técnico</div>
      </div>
      <div style="background:#fff;border:1px solid #e5e7eb;border-top:none;padding:22px 20px;border-radius:0 0 10px 10px">
        <h2>Solicitud de servicio técnico para ${escapeHtml(request.machine_name)}</h2>
        ${request.machine_model ? `<p>Modelo: ${escapeHtml(request.machine_model)}</p>` : ""}
        ${request.machine_serial_number ? `<p>Número de serie: ${escapeHtml(request.machine_serial_number)}</p>` : ""}
        <p><strong>Motivo:</strong><br>${escapeHtml(request.reason).replace(/\n/g, "<br>")}</p>
        <p><strong>Contactar con ${escapeHtml(request.supplier_name || "el proveedor asignado")}</strong></p>
        ${request.supplier_email ? `<p>Email: ${escapeHtml(request.supplier_email)}</p>` : ""}
        ${request.supplier_phone ? `<p>Teléfono: ${escapeHtml(request.supplier_phone)}</p>` : ""}
        ${photoUrls.length ? `
          <p><strong>Fotos adjuntas:</strong></p>
          <div>
            ${photoUrls.map((url, index) => `
              <a href="${escapeHtml(url)}" target="_blank" rel="noopener" style="display:inline-block;margin:0 8px 8px 0;text-decoration:none">
                <img src="${escapeHtml(url)}" alt="Foto ${index + 1}" style="width:180px;height:auto;border:1px solid #e5e7eb;border-radius:8px" />
              </a>
            `).join("")}
          </div>
        ` : ""}
      </div>
    </div>
  `;
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      resolve(result.includes(",") ? result.split(",")[1] : result);
    };
    reader.onerror = () => reject(new Error("No se pudo leer una foto."));
    reader.readAsDataURL(blob);
  });
}

async function buildEmailAttachments(photoAttachments = [], photoUrls = []) {
  const sources = Array.isArray(photoAttachments) ? [...photoAttachments] : [];

  if (!sources.length && photoUrls.length) {
    for (const [index, url] of photoUrls.entries()) {
      try {
        const response = await fetch(url);
        if (!response.ok) continue;
        const blob = await response.blob();
        sources.push({ name: `foto-${index + 1}.jpg`, blob });
      } catch (error) {
        console.warn("No se pudo descargar una foto para adjuntarla:", error);
      }
    }
  }

  const attachments = [];
  let totalBytes = 0;
  for (const item of sources) {
    if (!item?.blob) continue;
    if (totalBytes + item.blob.size > 12 * 1024 * 1024) break;
    const content = await blobToBase64(item.blob);
    if (!content) continue;
    totalBytes += item.blob.size;
    attachments.push({
      name: item.name || `foto-${attachments.length + 1}.jpg`,
      content,
      mimeType: item.blob.type || "image/jpeg",
    });
  }
  return attachments;
}

async function sendServiceRequestEmail(request, options = {}) {
  const photoUrls = options.photoUrls || [];
  const photoAttachments = options.photoAttachments || [];

  const { data: profiles, error } = await supabaseClient
    .from("profiles")
    .select("email")
    .eq("notify_low_stock", true);
  if (error) throw new Error(`No se pudo obtener el equipo destinatario: ${error.message}`);

  const emails = [...new Set((profiles || []).map((profile) => profile.email?.trim()).filter(Boolean))];
  if (!emails.length) throw new Error("No hay destinatarios activos para los avisos de stock.");

  const subject = `Solicitud de servicio técnico para ${request.machine_name}`;
  const photosText = photoUrls.map((url, index) => `Foto ${index + 1}: ${url}`).join("\n");
  const photosHtml = photoUrls.length
    ? `<p><strong>Fotos:</strong></p>${photoUrls.map((url, index) => `<p><a href="${escapeHtml(url)}">Foto ${index + 1}</a></p>`).join("")}`
    : "";
  const message = [
    subject,
    "",
    request.machine_model ? `Modelo: ${request.machine_model}` : "",
    request.machine_serial_number ? `Número de serie: ${request.machine_serial_number}` : "",
    `Motivo: ${request.reason}`,
    "",
    `Contactar con ${request.supplier_name || "el proveedor asignado"}`,
    request.supplier_email ? `Email: ${request.supplier_email}` : "",
    request.supplier_phone ? `Teléfono: ${request.supplier_phone}` : "",
    photoUrls.length ? "Fotos:" : "",
    photosText,
  ].filter((line) => line !== "").join("\n");

  const useEmailJS = typeof EMAILJS_SERVICE_ID !== "undefined" && EMAILJS_SERVICE_ID;
  if (useEmailJS && window.emailjs && typeof window.emailjs.send === "function") {
    await Promise.all(emails.map((email) => emailjs.send(
      EMAILJS_SERVICE_ID,
      EMAILJS_TEMPLATE_ID,
      {
        to_email: email,
        subject,
        message,
        machine_name: request.machine_name,
        machine_model: request.machine_model || "",
        machine_serial_number: request.machine_serial_number || "",
        request_reason: request.reason,
        supplier_name: request.supplier_name || "",
        supplier_email: request.supplier_email || "",
        supplier_phone: request.supplier_phone || "",
        photo_count: photoUrls.length,
        photos_text: photosText,
        photos_html: photosHtml,
        photo_1: photoUrls[0] || "",
        photo_2: photoUrls[1] || "",
        photo_3: photoUrls[2] || "",
      },
      EMAILJS_PUBLIC_KEY
    )));
    return;
  }

  if (!APPS_SCRIPT_URL || APPS_SCRIPT_URL.startsWith("PEGA_AQUI")) {
    throw new Error("No hay ningún servicio de email configurado.");
  }
  const attachments = await buildEmailAttachments(photoAttachments, photoUrls);
  const response = await fetch(APPS_SCRIPT_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      emails,
      subject,
      text: message,
      html: buildServiceRequestEmailHtml(request, photoUrls),
      attachments,
    }),
  });
  const responseBody = await response.text();
  if (!response.ok) throw new Error(responseBody || `El servicio de email respondió con HTTP ${response.status}.`);
  if (response.headers.get("content-type")?.includes("application/json")) {
    const result = JSON.parse(responseBody);
    if (result.success === false) throw new Error(result.error || "El servicio de email no pudo enviar el mensaje.");
  }
}

async function retryServiceRequestEmail(requestId) {
  const request = allServiceRequests.find((item) => item.id === requestId);
  if (!request) return;
  try {
    const photoUrls = await createServicePhotoSignedUrls(request.photo_paths || []);
    await sendServiceRequestEmail(request, { photoUrls });
    const { error } = await supabaseClient.from("maintenance_requests").update({ notification_sent: true }).eq("id", requestId);
    if (error) throw new Error(`El email se envió, pero no se pudo actualizar el historial: ${error.message}`);
    showToast("Aviso enviado al equipo");
    await loadServiceRequests();
  } catch (error) {
    showToast(`No se pudo enviar el aviso: ${error.message}`, 6000);
  }
}

$("new-machine-btn").addEventListener("click", () => openMachineModal());

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
    if (!dl) return;
    dl.innerHTML = [...new Set(values.filter(Boolean))]
      .sort()
      .map((v) => `<option value="${escapeHtml(v)}"></option>`)
      .join("");
  };
  fill("list-categories", allProducts.map((p) => p.category));
  fill("list-locations", allProducts.map((p) => p.location));
  fill("list-suppliers", allProducts.map((p) => p.supplier?.name));
  const defaultUnits = ["Rollo", "Paquete", "Cartucho", "Caja", "Bote", "Unidad"];
  fill("list-units", [...defaultUnits, ...allProducts.map((p) => p.unit)]);
  renderCategoryPills();
}

function getCategoryNamePrefixes(category) {
  const prefixes = new Map();
  allProducts
    .filter((product) => product.category === category)
    .forEach((product) => {
      const prefix = product.name.trim().split(/\s+/)[0];
      if (!prefix) return;
      const key = prefix.toLocaleLowerCase('es');
      const existing = prefixes.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        prefixes.set(key, { label: prefix, count: 1 });
      }
    });

  return [...prefixes.values()].sort((a, b) => a.label.localeCompare(b.label, 'es'));
}

function renderCategoryPills() {
  if (!Array.isArray(allProducts)) return;

  const container = $("category-pills");
  if (!container) return;

  const orderedCats = getOrderedCategories();
  const items = ["Todos", "Poco stock", ...orderedCats];
  const isMobile = window.innerWidth < 900;
  const totalCount = allProducts.length;
  const lowStockCount = allProducts.filter(isLowStock).length;
  const namePrefixes = activeCategoryFilter && activeCategoryFilter !== LOW_STOCK_CATEGORY_KEY
    ? getCategoryNamePrefixes(activeCategoryFilter)
    : [];
  if (!namePrefixes.some((prefix) => prefix.label.toLocaleLowerCase('es') === activeNamePrefixFilter)) {
    activeNamePrefixFilter = '';
  }

  if (!container.parentElement) return;

  if (isMobile) {
    const categoryOptions = orderedCats;
    const quickButtons = [
      { label: 'Todos', value: '', className: 'mobile-category-quick' },
      { label: 'Poco stock', value: LOW_STOCK_CATEGORY_KEY, className: 'mobile-category-quick low-stock' },
    ];
    const categoryCount = allProducts.filter((product) => product.category === activeCategoryFilter).length;

    container.innerHTML = `
      <div class="mobile-category-quick-row">
        ${quickButtons.map((button) => {
          const isActive = activeCategoryFilter === button.value;
          const count = button.value === LOW_STOCK_CATEGORY_KEY ? lowStockCount : totalCount;
          return `<button type="button" class="${button.className}${isActive ? ' active' : ''}" data-filter="${escapeHtml(button.value)}">${escapeHtml(button.label)} <span class="count">${count}</span></button>`;
        }).join('')}
      </div>
      <label class="mobile-category-select-wrap">
        <select id="mobile-category-select" class="mobile-category-select">
          <option value="">Selecciona una máquina</option>
          ${categoryOptions.map((cat) => {
            const selected = activeCategoryFilter === cat;
            const catCount = allProducts.filter((p) => p.category === cat).length;
            return `<option value="${escapeHtml(cat)}" ${selected ? 'selected' : ''}>${escapeHtml(cat)} (${catCount})</option>`;
          }).join('')}
        </select>
      </label>
      ${namePrefixes.length ? `
        <div class="name-prefix-filters">
          <button type="button" class="name-prefix-pill${activeNamePrefixFilter ? '' : ' active'}" data-prefix="">Todos <span class="count">${categoryCount}</span></button>
          ${namePrefixes.map((prefix) => `
            <button type="button" class="name-prefix-pill${activeNamePrefixFilter === prefix.label.toLocaleLowerCase('es') ? ' active' : ''}" data-prefix="${escapeHtml(prefix.label.toLocaleLowerCase('es'))}">
              ${escapeHtml(prefix.label)} <span class="count">${prefix.count}</span>
            </button>
          `).join('')}
        </div>
      ` : ''}
    `;

    container.querySelectorAll('.mobile-category-quick').forEach((btn) => {
      btn.addEventListener('click', () => {
        activeCategoryFilter = btn.dataset.filter || '';
        activeNamePrefixFilter = '';
        renderCategoryPills();
        renderProductList();
      });
    });

    const select = $("mobile-category-select");
    if (select) {
      select.addEventListener('change', () => {
        const value = select.value;
        activeCategoryFilter = value;
        activeNamePrefixFilter = '';
        renderCategoryPills();
        renderProductList();
      });
    }
    container.querySelectorAll('.name-prefix-pill').forEach((btn) => {
      btn.addEventListener('click', () => {
        activeNamePrefixFilter = btn.dataset.prefix || '';
        renderCategoryPills();
        renderProductList();
      });
    });
    return;
  }

  const categoryPills = items.map((c) => {
      const value = c === 'Todos' ? '' : c === 'Poco stock' ? LOW_STOCK_CATEGORY_KEY : c;
      const active = (c === 'Todos' ? activeCategoryFilter === '' : activeCategoryFilter === value);
      const count = c === 'Poco stock'
        ? lowStockCount
        : c === 'Todos'
          ? totalCount
          : allProducts.filter((p) => p.category === c).length;
      return `<button type="button" class="pill ${active ? 'active' : ''}" data-cat="${escapeHtml(value)}" title="${escapeHtml(c)}">${escapeHtml(c)} <span class="count">${count}</span></button>`;
    }).join("");
  const categoryCount = allProducts.filter((product) => product.category === activeCategoryFilter).length;
  const prefixPills = namePrefixes.length ? `
    <div class="name-prefix-filters">
      <button type="button" class="name-prefix-pill${activeNamePrefixFilter ? '' : ' active'}" data-prefix="">Todos <span class="count">${categoryCount}</span></button>
      ${namePrefixes.map((prefix) => `
        <button type="button" class="name-prefix-pill${activeNamePrefixFilter === prefix.label.toLocaleLowerCase('es') ? ' active' : ''}" data-prefix="${escapeHtml(prefix.label.toLocaleLowerCase('es'))}">
          ${escapeHtml(prefix.label)} <span class="count">${prefix.count}</span>
        </button>
      `).join('')}
    </div>
  ` : '';
  container.innerHTML = `${categoryPills}${prefixPills}`;

  container.querySelectorAll('.pill').forEach((btn) => {
    const catValue = btn.dataset.cat;
    const isMovable = catValue !== '' && catValue !== LOW_STOCK_CATEGORY_KEY;
    btn.draggable = isMovable;

    btn.addEventListener('click', () => {
      activeCategoryFilter = catValue;
      activeNamePrefixFilter = '';
      renderCategoryPills();
      renderProductList();
    });

    if (isMovable) {
      btn.addEventListener('dragstart', (event) => {
        event.dataTransfer.setData('text/plain', catValue);
        btn.classList.add('dragging');
      });
      btn.addEventListener('dragend', () => {
        btn.classList.remove('dragging');
      });
      btn.addEventListener('dragover', (event) => {
        event.preventDefault();
      });
      btn.addEventListener('drop', (event) => {
        event.preventDefault();
        const sourceCategory = event.dataTransfer.getData('text/plain');
        const targetCategory = catValue;
        if (!sourceCategory || sourceCategory === targetCategory) return;

        const current = getOrderedCategories();
        const next = [...current];
        const fromIndex = next.indexOf(sourceCategory);
        const targetIndex = next.indexOf(targetCategory);
        if (fromIndex === -1 || targetIndex === -1) return;
        next.splice(fromIndex, 1);
        next.splice(targetIndex, 0, sourceCategory);
        setCategoryOrderCookie(next);
        renderCategoryPills();
        renderProductList();
      });
    }
  });
  container.querySelectorAll('.name-prefix-pill').forEach((btn) => {
    btn.addEventListener('click', () => {
      activeNamePrefixFilter = btn.dataset.prefix || '';
      renderCategoryPills();
      renderProductList();
    });
  });
}

const searchInput = $("search-input");
const clearSearchBtn = $("clear-search");

searchInput.addEventListener("input", () => {
  const hasValue = searchInput.value.trim().length > 0;
  clearSearchBtn.classList.toggle("hidden", !hasValue);
  renderProductList();
});

clearSearchBtn.addEventListener("click", () => {
  searchInput.value = "";
  clearSearchBtn.classList.add("hidden");
  renderProductList();
  searchInput.focus();
});

function productMachineName(product) {
  return product?.machine?.name || product?.category || "";
}

function machineChipMarkup(product) {
  const machineName = productMachineName(product);
  const label = machineName ? `Máquina · ${machineName}` : "Sin máquina";
  return `<span class="product-machine ${machineName ? "" : "is-empty"}">${escapeHtml(label)}</span>`;
}

function renderProductList() {
  if (!Array.isArray(allProducts)) return;

  const term = $("search-input").value.trim().toLowerCase();
  const filtered = allProducts.filter((p) => {
    if (!term) return true;
    return [p.name, p.category, p.location, p.supplier?.name, p.ean, p.reference]
      .filter(Boolean)
      .some((f) => f.toLowerCase().includes(term));
  });

  // apply active category filter
  let finalFiltered = filtered;
  if (activeCategoryFilter === LOW_STOCK_CATEGORY_KEY) {
    finalFiltered = filtered.filter((p) => isLowStock(p));
  } else if (activeCategoryFilter) {
    finalFiltered = filtered.filter((p) => p.category === activeCategoryFilter);
  }
  if (activeNamePrefixFilter) {
    finalFiltered = finalFiltered.filter((product) =>
      product.name.trim().split(/\s+/)[0].toLocaleLowerCase('es') === activeNamePrefixFilter
    );
  }

  const container = $("product-list");
  $("list-empty").classList.toggle("hidden", allProducts.length > 0);

  if (filtered.length === 0 && allProducts.length > 0) {
    container.innerHTML = `<p style="color:var(--ink-soft);text-align:center;padding:30px 10px;">No hay ningún suministro que coincida con "${escapeHtml(term)}".</p>`;
    return;
  }
  if (finalFiltered.length === 0 && allProducts.length > 0) {
    container.innerHTML = '<p style="color:var(--ink-soft);text-align:center;padding:30px 10px;">No hay suministros que coincidan con los filtros seleccionados.</p>';
    return;
  }

  const isDesktop = window.innerWidth >= 900;

  if (isDesktop) {
    // Group products by category and render columns
    const groups = finalFiltered.reduce((acc, p) => {
      const key = activeCategoryFilter === LOW_STOCK_CATEGORY_KEY
        ? 'Poco stock'
        : p.category || 'Sin máquina';
      acc[key] = acc[key] || [];
      acc[key].push(p);
      return acc;
    }, {});

    const orderedCategories = [...getOrderedCategories(), ...Object.keys(groups).filter((cat) => !getOrderedCategories().includes(cat))];
    const cols = orderedCategories.filter((cat) => groups[cat]).map((cat) => {
      const items = groups[cat]
        .map((p) => {
          const low = isLowStock(p);
          const meta = [p.reference ? `Ref. ${p.reference}` : '', p.unit, p.location, p.supplier?.name].filter(Boolean).join(' / ');
          const machineName = productMachineName(p);
          return `
            <div class="product-row ${low ? 'low' : ''}" data-id="${p.id}">
              <div class="product-main">
                <h3>${escapeHtml(p.name)}</h3>
                <p class="product-machine ${machineName ? '' : 'is-empty'}">${escapeHtml(machineName ? `Máquina · ${machineName}` : 'Sin máquina')}</p>
                <p class="product-meta">${escapeHtml(meta)}</p>
                <div style="display:flex;align-items:center;justify-content:space-between;margin-top:8px">
                  <div class="product-qty-wrap">
                    <div class="product-qty ${low ? 'low' : ''}" style="font-size:16px">${p.quantity}</div>
                    ${low ? `<div class="low-flag">${getLowStockLabel(p)}</div>` : ''}
                  </div>
                  <div class="qty-stepper">
                    <button type="button" data-id="${p.id}" data-delta="1">+</button>
                    <button type="button" data-id="${p.id}" data-delta="-1">−</button>
                  </div>
                </div>
              </div>
            </div>`;
        })
        .join('');

      return `<div class="category-column"><h4 class="col-title">${escapeHtml(cat)}</h4><div class="column-list">${items}</div></div>`;
    }).join('');

    const wrap = document.createElement('div');
    wrap.className = 'columns-wrap';
    wrap.innerHTML = cols;
    const categoryCount = wrap.querySelectorAll('.category-column').length;
    const cappedCount = Math.max(1, Math.min(categoryCount, 4));
    wrap.style.setProperty('--category-columns', String(cappedCount));
    container.innerHTML = '';
    container.appendChild(wrap);
    // after rendering, adjust columns that overflow to show two columns side-by-side
    adjustCategoryWidths();
  } else {
    // mobile: single-column list (existing behaviour)
    container.innerHTML = finalFiltered
      .map((p) => {
        const low = isLowStock(p);
        const meta = [p.reference ? `Ref. ${p.reference}` : '', p.unit, p.location, p.supplier?.name].filter(Boolean).join(' / ');
        const machineName = productMachineName(p);
        return `
          <div class="product-row ${low ? 'low' : ''}">
            <div class="product-main" data-id="${p.id}">
              <h3>${escapeHtml(p.name)}</h3>
              <p class="product-machine ${machineName ? '' : 'is-empty'}">${escapeHtml(machineName ? `Máquina · ${machineName}` : 'Sin máquina')}</p>
              <p class="product-meta">${escapeHtml(meta)}</p>
              <span class="product-qty ${low ? 'low' : ''}">${p.quantity}</span>
              ${low ? `<span class="low-flag">${getLowStockLabel(p)}</span>` : ''}
            </div>
            <div class="qty-stepper">
              <button type="button" data-id="${p.id}" data-delta="1">+</button>
              <button type="button" data-id="${p.id}" data-delta="-1">−</button>
            </div>
          </div>`;
      })
      .join('');
  }

  container.querySelectorAll(".product-main").forEach((el) => {
    el.addEventListener("click", () => {
      const id = el.dataset.id || el.closest('.product-row')?.dataset.id;
      if (id) openEditModal(id);
    });
  });
  container.querySelectorAll(".qty-stepper button").forEach((btn) => {
    btn.addEventListener("click", async (event) => {
      event.stopPropagation();
      if (btn.dataset.busy === "true") return;
      const product = allProducts.find((p) => p.id === btn.dataset.id);
      if (!product) return;

      const row = btn.closest(".product-row");
      const stepperButtons = row ? [...row.querySelectorAll(".qty-stepper button")] : [btn];
      btn.dataset.busy = "true";
      stepperButtons.forEach((button) => {
        button.disabled = true;
        button.setAttribute("aria-busy", "true");
      });

      try {
        await applyQuantityDelta(product, Number(btn.dataset.delta));
      } finally {
        if (btn.isConnected) {
          stepperButtons.forEach((button) => {
            button.disabled = false;
            button.removeAttribute("aria-busy");
          });
          btn.dataset.busy = "false";
        }
      }
    });
  });
}

function adjustCategoryWidths() {
  const wrap = document.querySelector('.columns-wrap');
  if (!wrap) return;

  const columns = [...wrap.querySelectorAll('.category-column')];
  if (!columns.length) return;

  const gap = 12;

  if (activeCategoryFilter) {
    const cardWidth = (wrap.clientWidth - 20 - (12 * 3)) / 4;
    columns.forEach((col) => {
      const list = col.querySelector('.column-list');
      if (!list) return;

      const productCount = list.querySelectorAll('.product-row').length;
      col.style.width = '100%';
      col.style.minWidth = '100%';
      col.style.flex = '1 0 auto';
      list.style.display = 'grid';
      list.style.gridAutoFlow = 'column';
      list.style.gridTemplateColumns = `repeat(4, minmax(0, ${cardWidth}px))`;
      list.style.gridTemplateRows = `repeat(${Math.max(1, Math.ceil(productCount / 4))}, auto)`;
      list.style.columnGap = '12px';
      list.style.rowGap = '12px';
      list.style.width = '100%';
    });
    return;
  }

  const visibleShare = columns.reduce((sum, col) => {
    const list = col.querySelector('.column-list');
    const productCount = list ? list.querySelectorAll('.product-row').length : 0;
    const share = Math.max(1, Math.min(4, productCount > 0 ? Math.ceil(productCount / 6) : 1));
    col.dataset.cardColumns = String(share);
    return sum + share;
  }, 0);

  const available = Math.max(0, wrap.clientWidth - (gap * Math.max(0, columns.length - 1)));

  columns.forEach((col) => {
    const list = col.querySelector('.column-list');
    if (!list) return;

    const share = Number(col.dataset.cardColumns || 1);
    const width = (share / visibleShare) * available;
    const productCount = list.querySelectorAll('.product-row').length;
    col.style.width = `${Math.max(width, 240)}px`;
    col.style.minWidth = `${Math.max(width, 240)}px`;
    col.style.flex = '0 0 auto';
    list.style.display = 'grid';
    list.style.gridAutoFlow = 'column';
    list.style.gridTemplateColumns = `repeat(${share}, minmax(0, 1fr))`;
    list.style.gridTemplateRows = `repeat(${Math.max(1, Math.ceil(productCount / share))}, auto)`;
    list.style.columnGap = '12px';
    list.style.rowGap = '12px';
    list.style.width = '100%';
    list.style.overflow = 'visible';
  });
}

let lastDesktopLayout = window.innerWidth >= 900;

window.addEventListener('resize', () => {
  const isDesktop = window.innerWidth >= 900;
  if (isDesktop !== lastDesktopLayout) {
    lastDesktopLayout = isDesktop;
    renderCategoryPills();
    renderProductList();
  }
  // re-evaluate after resize
  setTimeout(adjustCategoryWidths, 120);
});

// ---------------------------------------------------------------
// Stock: actualización de cantidades + avisos de stock bajo
// ---------------------------------------------------------------
async function applyQuantityDelta(product, delta) {
  const currentQty = Number(product.quantity) || 0;
  const newQty = Math.max(0, currentQty + delta);

  if (newQty === currentQty) {
    showToast(delta < 0 ? "No queda stock para sacar" : "La cantidad no ha cambiado");
    return null;
  }

  return updateProductQuantity(product.id, newQty, { delta });
}

async function updateProductQuantity(productId, newQty, options = {}) {
  const delta = Number(options.delta) || 0;
  const pendingLinesBefore = delta > 0 ? await getPendingOrderLinesForProduct(productId) : [];

  const { data, error } = await supabaseClient
    .from("products")
    .update({ quantity: newQty })
    .eq("id", productId)
    .select("*, supplier_info:suppliers!products_supplier_id_fkey(id, name, email, phone), machine_info:machines!products_machine_id_fkey(id, name)")
    .single();
  if (error) {
    showToast("Error al actualizar la cantidad");
    return null;
  }

  const updatedProduct = normalizeProduct(data);
  const idx = allProducts.findIndex((p) => p.id === productId);
  if (idx >= 0) {
    allProducts[idx] = { ...allProducts[idx], ...updatedProduct };
  }

  updateLowStockBadge();
  populateDatalists();
  renderProductList();

  await checkLowStock(updatedProduct);

  if (pendingLinesBefore.length) {
    await reportOrderReconciliation(pendingLinesBefore);
  }

  return updatedProduct;
}

async function checkLowStock(product) {
  const low = isLowStock(product);
  if (low && !product.low_stock_notified) {
    await sendLowStockEmail(product);
    await supabaseClient.from("products").update({ low_stock_notified: true }).eq("id", product.id);
  } else if (!low && product.low_stock_notified) {
    await supabaseClient.from("products").update({ low_stock_notified: false }).eq("id", product.id);
  }
}

function buildLowStockEmailHtml(product) {
  const unit = product.unit || "uds";
  const category = product.category || "Sin máquina";
  const supplier = product.supplier;
  const supplierName = supplier?.name || "Sin proveedor";
  const supplierEmails = (supplier?.email || "")
    .split(";")
    .map((email) => email.trim())
    .filter(Boolean);
  const supplierPhone = supplier?.phone || "";

  return `
    <div style="font-family: Arial, sans-serif; color: #1e1e1e; max-width: 640px; margin: 0 auto; background: #f7f7f7; padding: 24px; border-radius: 12px;">
      <div style="background: #111827; color: #ffffff; border-radius: 10px 10px 0 0; padding: 18px 20px;">
        <div style="font-size: 22px; font-weight: 700;">Stock Impresión</div>
        <div style="font-size: 12px; opacity: 0.8; margin-top: 6px;">Aviso de stock bajo</div>
      </div>
      <div style="background: #ffffff; border: 1px solid #e5e7eb; border-top: none; padding: 22px 20px 18px; border-radius: 0 0 10px 10px;">
        <div style="font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; color: #6b7280; margin-bottom: 10px;">Alerta</div>
        <div style="font-size: 24px; font-weight: 700; margin-bottom: 12px;">${escapeHtml(product.name)}</div>
        <div style="font-size: 16px; line-height: 1.6; color: #374151; margin-bottom: 18px;">
          El suministro <strong>${escapeHtml(product.name)}</strong> tiene <strong>${product.quantity}</strong> ${escapeHtml(unit)} y ha llegado al mínimo definido de <strong>${product.min_quantity}</strong>.
        </div>
        <div style="margin-bottom: 18px; color: #374151;"><strong>Máquina:</strong> ${escapeHtml(category)}</div>
        <div style="background: #f3f4f6; border: 1px solid #e5e7eb; border-radius: 10px; padding: 12px 14px; margin-bottom: 18px; color: #374151;">
          <div style="font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: #6b7280; margin-bottom: 8px;">Proveedor</div>
          <div style="font-weight: 700; margin-bottom: 4px;">${escapeHtml(supplierName)}</div>
          ${supplierEmails.length ? supplierEmails.map((email) => `<div>Email: ${escapeHtml(email)}</div>`).join("") : ""}
          ${supplierPhone ? `<div>Teléfono: ${escapeHtml(supplierPhone)}</div>` : ""}
        </div>
        <div style="background: #fff1f2; border-left: 4px solid #dc2626; padding: 12px 14px; border-radius: 8px; color: #7f1d1d; font-weight: 600;">
          Reponlo cuanto antes para evitar quedarse sin stock.
        </div>
        <div style="margin-top: 18px; font-size: 12px; color: #6b7280;">
          — Stock Impresión
        </div>
      </div>
    </div>
  `;
}

async function sendLowStockEmail(product) {
  try {
    // Prefer EmailJS if configured (no server required)
    const useEmailJS = typeof EMAILJS_SERVICE_ID !== 'undefined' && EMAILJS_SERVICE_ID;

    const { data: profiles } = await supabaseClient
      .from("profiles")
      .select("email, notify_low_stock")
      .eq("notify_low_stock", true);

    const emails = (profiles || []).map((p) => p.email).filter(Boolean);
    if (emails.length === 0) return;

    const supplier = product.supplier;
    const supplierEmails = (supplier?.email || "")
      .split(";")
      .map((email) => email.trim())
      .filter(Boolean);
    const supplierSummary = [supplier?.name, supplierEmails.length ? supplierEmails.join("; ") : supplier?.email, supplier?.phone].filter(Boolean).join(" • ") || "Sin proveedor";
    const category = product.category || "Sin máquina";
    const subject = `Stock bajo: ${product.name}`;
    const message = [
      `El suministro \"${product.name}\" está por debajo del mínimo.`,
      `- Máquina: ${category}`,
      `- Stock actual: ${product.quantity}`,
      `- Mínimo: ${product.min_quantity}`,
      `- Unidad: ${product.unit || "unidades"}`,
      `- Proveedor: ${supplierSummary}`,
      "",
      "Reponlo cuando puedas.",
      "",
      "— Stock Impresión",
    ].join("\n");
    const html = buildLowStockEmailHtml(product);

    if (useEmailJS && window.emailjs && typeof window.emailjs.send === 'function') {
      const promises = emails.map((to) => {
        const templateParams = {
          to_email: to,
          subject,
          message,
          product_name: product.name,
          quantity: product.quantity,
          min_quantity: product.min_quantity,
          category,
          supplier_name: supplier?.name || "Sin proveedor",
          supplier_email: supplier?.email || "",
          supplier_phone: supplier?.phone || "",
        };
        try {
          return emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, templateParams, EMAILJS_PUBLIC_KEY);
        } catch (e) {
          return Promise.reject(e);
        }
      });
      await Promise.all(promises);
      return;
    }

    if (!APPS_SCRIPT_URL || APPS_SCRIPT_URL.startsWith("PEGA_AQUI")) return;

    await fetch(APPS_SCRIPT_URL, {
      method: "POST",
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        emails,
        subject,
        text: message,
        html,
      }),
    });
  } catch (err) {
    console.error("No se pudo enviar el aviso por email:", err);
  }
}

// ---------------------------------------------------------------
// Pedidos a proveedores
// ---------------------------------------------------------------
const ORDER_STATUS_LABELS = {
  draft: "Borrador",
  sent: "Enviado",
  partial: "Parcial",
  received: "Recibido",
  cancelled: "Cancelado",
};

const ORDER_ITEM_STATUS_LABELS = {
  pending: "Pendiente",
  partial: "Parcial",
  received: "Recibido",
  cancelled: "Cancelado",
};

function orderStatusLabel(status) {
  return ORDER_STATUS_LABELS[status] || status || "Sin estado";
}

function orderItemStatusLabel(status) {
  return ORDER_ITEM_STATUS_LABELS[status] || status || "Sin estado";
}

function formatOrderNumber(order) {
  const number = Number(order?.order_number);
  if (!Number.isFinite(number)) return "PED-—";
  return `PED-${String(number).padStart(4, "0")}`;
}

function formatOrderDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("es-ES", { dateStyle: "medium", timeStyle: "short" });
}

function formatUnits(value) {
  const amount = Number(value) || 0;
  return `${formatStockNumber(amount)} ${amount === 1 ? "ud" : "uds"}`;
}

function getOrderItems(orderId) {
  return allPurchaseOrderItems.filter((item) => item.order_id === orderId);
}

function getOrderPendingUnits(orderId) {
  return getOrderItems(orderId)
    .filter((item) => item.status !== "cancelled" && item.status !== "received")
    .reduce((sum, item) => sum + Math.max(0, Number(item.quantity_requested) - Number(item.quantity_received)), 0);
}

// ---------- Responsable de compras por proveedor ----------
function getOrderPurchaseManager() {
  const supplier = getOrderSupplier();
  return supplier?.purchase_manager || null;
}

function getOrderPurchaseEmail() {
  return (getOrderPurchaseManager()?.email || "").trim();
}

function renderPurchaseManagerBanner() {
  const banner = $("purchase-manager-banner");
  const value = $("purchase-manager-value");
  const button = $("edit-purchase-manager-btn");
  if (!banner || !value || !button) return;

  const supplier = getOrderSupplier();
  const manager = getOrderPurchaseManager();

  if (!supplier) {
    value.textContent = "Se asigna al elegir proveedor";
    banner.classList.remove("is-missing");
    button.classList.add("hidden");
    return;
  }

  value.textContent = manager?.email || `Sin responsable · ${supplier.name || "proveedor"}`;
  banner.classList.toggle("is-missing", !manager);
  button.classList.remove("hidden");
  button.textContent = manager ? "Cambiar" : "Asignar";
}

// ---------- Vista de pedidos ----------
function showOrdersSection(name) {
  activeOrdersSection = name === "tracking" ? "tracking" : "new";
  document.querySelectorAll(".orders-view-btn").forEach((button) => {
    const active = button.dataset.ordersView === activeOrdersSection;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });
  document.querySelectorAll(".orders-panel").forEach((panel) => {
    panel.classList.toggle("hidden", panel.id !== `orders-panel-${activeOrdersSection}`);
  });
  if (activeOrdersSection === "tracking") renderOrdersList();
}

async function openOrdersView() {
  const supplierFilter = $("order-supplier-filter");
  if (supplierFilter) {
    const current = supplierFilter.value;
    supplierFilter.innerHTML = '<option value="">Todos los proveedores</option>' + allSuppliers
      .filter((supplier) => supplier.name)
      .map((supplier) => `<option value="${escapeHtml(supplier.id)}">${escapeHtml(supplier.name)}</option>`)
      .join("");
    if ([...supplierFilter.options].some((option) => option.value === current)) {
      supplierFilter.value = current;
    }
  }

  await loadOrders();
  renderOrderPicker();
  renderOrderCart();
  renderOrdersList();
  showOrdersSection(activeOrdersSection);
}

async function loadOrders() {
  const { data: orders, error } = await supabaseClient
    .from("purchase_orders")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(300);

  if (error) {
    console.warn("No se pudieron cargar los pedidos:", error);
    allPurchaseOrders = [];
    allPurchaseOrderItems = [];
    allPurchaseOrderEvents = [];
    ordersLoaded = false;
    showToast("No se pudieron cargar los pedidos: " + error.message, 6000);
    return;
  }

  allPurchaseOrders = orders || [];
  const ids = allPurchaseOrders.map((order) => order.id);
  allPurchaseOrderItems = [];
  allPurchaseOrderEvents = [];

  if (ids.length) {
    const [itemsResult, eventsResult] = await Promise.all([
      supabaseClient.from("purchase_order_items").select("*").in("order_id", ids),
      supabaseClient.from("purchase_order_events").select("*").in("order_id", ids).order("created_at", { ascending: true }),
    ]);
    if (itemsResult.error) {
      console.warn("No se pudieron cargar las líneas de pedido:", itemsResult.error);
    } else {
      allPurchaseOrderItems = itemsResult.data || [];
    }
    if (eventsResult.error) {
      console.warn("No se pudo cargar el historial de pedidos:", eventsResult.error);
    } else {
      allPurchaseOrderEvents = eventsResult.data || [];
    }
  }

  ordersLoaded = true;
}

// ---------- Nuevo pedido ----------
function getOrderSupplier() {
  return allSuppliers.find((supplier) => supplier.id === orderDraftSupplierId) || null;
}

function getProductSuggestedQuantity(product) {
  return Math.max(
    1,
    Math.ceil((Number(product.min_quantity) || 0) - (Number(product.quantity) || 0))
  );
}

function addProductToOrder(productId, suggested) {
  const product = allProducts.find((item) => item.id === productId);
  if (!product) return false;
  if (!product.supplier_id) {
    showToast("Asigna un proveedor a este suministro antes de pedirlo.");
    return false;
  }
  if (orderDraftSupplierId && product.supplier_id !== orderDraftSupplierId) {
    showToast("Un pedido solo puede tener suministros de un proveedor.");
    return false;
  }
  if (orderDraftItems.has(product.id)) return false;

  orderDraftSupplierId = product.supplier_id;
  orderDraftItems.set(product.id, Math.max(1, Number(suggested) || 1));
  return true;
}

function removeProductFromOrder(productId) {
  orderDraftItems.delete(productId);
  if (!orderDraftItems.size) orderDraftSupplierId = "";
}

function renderOrderSupplierLock() {
  const banner = $("order-supplier-lock");
  const name = $("order-supplier-name");
  if (!banner || !name) return;

  const supplier = getOrderSupplier();
  banner.classList.toggle("hidden", !supplier);
  name.textContent = supplier?.name || "—";
}

function orderProductMeta(product) {
  return [
    product.reference ? `Ref. ${product.reference}` : "",
    product.ean ? `EAN ${product.ean}` : "",
    `Stock ${formatStockNumber(product.quantity)}`,
    `Mín. ${formatStockNumber(product.min_quantity)}`,
  ].filter(Boolean).join(" · ");
}

function renderOrderPicker() {
  const container = $("order-product-picker");
  if (!container) return;

  renderOrderSupplierLock();
  renderPurchaseManagerBanner();

  const supplier = getOrderSupplier();
  const lowProducts = allProducts
    .filter((product) => isLowStock(product))
    .filter((product) => !supplier || product.supplier_id === supplier.id)
    .sort((a, b) => {
      const aAvailable = a.supplier_id ? 0 : 1;
      const bAvailable = b.supplier_id ? 0 : 1;
      return aAvailable - bAvailable || a.name.localeCompare(b.name, "es");
    });

  const count = $("order-low-count");
  if (count) {
    count.textContent = lowProducts.length
      ? `${lowProducts.length} ${lowProducts.length === 1 ? "suministro" : "suministros"}`
      : "";
  }

  if (!lowProducts.length) {
    container.innerHTML = supplier
      ? '<p class="empty-state">No hay suministros con poco stock de este proveedor. Añade otro a mano si lo necesitas.</p>'
      : '<p class="empty-state">No hay suministros por debajo del mínimo. Añade uno a mano si lo necesitas.</p>';
    return;
  }

  container.innerHTML = lowProducts.map((product) => {
    const missingSupplier = !product.supplier_id;
    const selected = orderDraftItems.has(product.id);
    const note = missingSupplier
      ? '<span class="order-picker-note">Asigna un proveedor en su ficha</span>'
      : "";

    return `
      <label class="order-picker-row is-low ${selected ? "is-selected" : ""} ${missingSupplier ? "is-disabled" : ""}">
        <input type="checkbox" class="order-low-check" data-product-id="${product.id}" data-suggested="${getProductSuggestedQuantity(product)}" ${selected ? "checked" : ""} ${missingSupplier ? "disabled" : ""} />
        <span class="order-picker-main">
          <strong>${escapeHtml(product.name)}</strong>
          ${machineChipMarkup(product)}
          <span class="order-picker-meta">${escapeHtml(orderProductMeta(product))}</span>
          ${note}
        </span>
        <span class="order-picker-supplier">${escapeHtml(product.supplier?.name || "Sin proveedor")}</span>
      </label>`;
  }).join("");

  container.querySelectorAll(".order-low-check").forEach((input) => {
    input.addEventListener("change", () => {
      if (input.checked) {
        if (!addProductToOrder(input.dataset.productId, input.dataset.suggested)) {
          input.checked = false;
          return;
        }
      } else {
        removeProductFromOrder(input.dataset.productId);
      }
      renderOrderPicker();
      renderOrderCart();
    });
  });
}

function openOrderProductModal() {
  if (hasOpenModal()) return;

  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop centered";
  backdrop.innerHTML = `
    <div class="modal-sheet order-product-modal">
      <div class="modal-header">
        <h2>Añadir suministro</h2>
        <button type="button" class="modal-close" aria-label="Cerrar">&times;</button>
      </div>
      <div class="field">
        <label for="order-manual-search">Buscar suministro</label>
        <input type="search" id="order-manual-search" placeholder="Nombre, referencia o EAN" />
      </div>
      <p id="order-manual-supplier" class="order-manual-supplier"></p>
      <div id="order-manual-list" class="order-manual-list"></div>
    </div>`;
  document.body.appendChild(backdrop);

  const search = backdrop.querySelector("#order-manual-search");
  const list = backdrop.querySelector("#order-manual-list");
  const supplierNote = backdrop.querySelector("#order-manual-supplier");

  const close = () => backdrop.remove();
  backdrop.querySelector(".modal-close").addEventListener("click", close);
  backdrop.addEventListener("click", (event) => {
    if (event.target === backdrop) close();
  });

  const renderList = () => {
    const supplier = getOrderSupplier();
    const term = search.value.trim().toLowerCase();

    supplierNote.textContent = supplier
      ? `Solo suministros de ${supplier.name}.`
      : "Al añadir el primero se fija el proveedor del pedido.";

    const products = allProducts
      .filter((product) => !supplier || product.supplier_id === supplier.id)
      .filter((product) => {
        if (!term) return true;
        return [product.name, product.reference, product.ean]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(term));
      })
      .sort((a, b) => {
        const aAdded = orderDraftItems.has(a.id) ? 1 : 0;
        const bAdded = orderDraftItems.has(b.id) ? 1 : 0;
        return aAdded - bAdded
          || Number(isLowStock(b)) - Number(isLowStock(a))
          || a.name.localeCompare(b.name, "es");
      });

    if (!products.length) {
      list.innerHTML = '<p class="empty-state">No hay suministros que coincidan con la búsqueda.</p>';
      return;
    }

    list.innerHTML = products.map((product) => {
      const missingSupplier = !product.supplier_id;
      const added = orderDraftItems.has(product.id);
      const label = missingSupplier ? "Sin proveedor" : added ? "Añadido" : "Añadir";

      return `
        <div class="order-picker-row ${added ? "is-selected" : ""} ${missingSupplier ? "is-disabled" : ""}">
          <div class="order-picker-main">
            <strong>${escapeHtml(product.name)}</strong>
            ${machineChipMarkup(product)}
            <span class="order-picker-meta">${escapeHtml(orderProductMeta(product))}</span>
            <span class="order-picker-note">${escapeHtml(product.supplier?.name || "Sin proveedor")}</span>
          </div>
          <button type="button" class="btn btn-outline order-manual-add" data-product-id="${product.id}" data-suggested="${getProductSuggestedQuantity(product)}" ${missingSupplier || added ? "disabled" : ""}>
            ${label}
          </button>
        </div>`;
    }).join("");

    list.querySelectorAll(".order-manual-add").forEach((button) => {
      button.addEventListener("click", () => {
        if (!addProductToOrder(button.dataset.productId, button.dataset.suggested)) return;
        renderOrderPicker();
        renderOrderCart();
        renderList();
        showToast("Suministro añadido al pedido");
      });
    });
  };

  search.addEventListener("input", renderList);
  renderList();
}

function renderOrderCart() {
  const container = $("order-cart");
  const empty = $("order-cart-empty");
  if (!container) return;

  const entries = [...orderDraftItems.entries()]
    .map(([productId, quantity]) => ({ product: allProducts.find((product) => product.id === productId), quantity }))
    .filter((entry) => entry.product);

  if (empty) empty.classList.toggle("hidden", entries.length > 0);

  container.innerHTML = entries.map(({ product, quantity }) => {
    const meta = [
      product.reference ? `Ref. ${product.reference}` : "",
      product.ean ? `EAN ${product.ean}` : "",
      product.unit,
    ].filter(Boolean).join(" · ");

    return `
      <div class="order-cart-row">
        <div class="order-cart-main">
          <strong>${escapeHtml(product.name)}</strong>
          ${machineChipMarkup(product)}
          <span class="order-cart-meta">${escapeHtml(meta || "Sin referencia")}</span>
        </div>
        <input type="number" class="order-qty-input" min="1" step="1" value="${quantity}" data-product-id="${product.id}" aria-label="Cantidad de ${escapeHtml(product.name)}" />
        <button type="button" class="order-remove-btn" data-product-id="${product.id}" aria-label="Quitar ${escapeHtml(product.name)}">&times;</button>
      </div>`;
  }).join("");

  container.querySelectorAll(".order-qty-input").forEach((input) => {
    input.addEventListener("change", () => {
      const value = Math.max(1, Math.floor(Number(input.value) || 1));
      input.value = String(value);
      orderDraftItems.set(input.dataset.productId, value);
      updateOrderSummary();
    });
  });

  container.querySelectorAll(".order-remove-btn").forEach((button) => {
    button.addEventListener("click", () => {
      removeProductFromOrder(button.dataset.productId);
      renderOrderPicker();
      renderOrderCart();
      showToast("Suministro quitado del pedido");
    });
  });

  updateOrderSummary();
}

function updateOrderSummary() {
  const summary = $("order-summary");
  const sendButton = $("order-send");
  if (!summary || !sendButton) return;

  const totalUnits = [...orderDraftItems.values()].reduce((sum, value) => sum + (Number(value) || 0), 0);
  summary.textContent = `${orderDraftItems.size} ${orderDraftItems.size === 1 ? "referencia" : "referencias"} · ${formatStockNumber(totalUnits)} ${totalUnits === 1 ? "unidad" : "unidades"}`;

  const supplier = getOrderSupplier();
  const manager = getOrderPurchaseManager();
  const blocked = !supplier || !manager || orderDraftItems.size === 0;
  sendButton.disabled = blocked;
  sendButton.title = blocked
    ? (!supplier
      ? "Añade un suministro para fijar el proveedor"
      : !manager
        ? "Asigna un responsable de compras al proveedor"
        : "Añade al menos un suministro")
    : "";
}

function resetOrderDraft() {
  orderDraftItems = new Map();
  orderDraftSupplierId = "";
  const note = $("order-note");
  if (note) note.value = "";
  renderOrderPicker();
  renderOrderCart();
}

async function submitPurchaseOrder(asDraft) {
  const supplier = getOrderSupplier();
  const purchaseManager = getOrderPurchaseManager();
  const purchaseEmail = (purchaseManager?.email || "").trim();
  const note = $("order-note").value.trim();
  const entries = [...orderDraftItems.entries()]
    .map(([productId, quantity]) => ({
      product: allProducts.find((product) => product.id === productId),
      quantity: Math.max(1, Math.floor(Number(quantity) || 1)),
    }))
    .filter((entry) => entry.product);

  if (!supplier) {
    showToast("Añade un suministro para fijar el proveedor del pedido.");
    return;
  }
  if (!purchaseEmail) {
    showToast("Asigna un responsable de compras al proveedor antes de enviar el pedido.");
    return;
  }
  if (!entries.length) {
    showToast("Añade al menos un suministro al pedido.");
    return;
  }
  if (entries.some((entry) => entry.product.supplier_id !== supplier.id)) {
    showToast("Todos los suministros del pedido deben ser del mismo proveedor.");
    return;
  }

  const button = asDraft ? $("order-save-draft") : $("order-send");

  await withBusy(button, asDraft ? "Guardando…" : "Enviando…", async () => {
    let order = null;
    try {
      const { data, error } = await supabaseClient
        .from("purchase_orders")
        .insert({
          supplier_id: supplier.id,
          supplier_name: supplier.name || "Sin nombre",
          supplier_email: supplier.email || null,
          supplier_phone: supplier.phone || null,
          purchase_email: purchaseEmail,
          status: "draft",
          note: note || null,
          requested_by: currentUser?.id || null,
          requested_by_email: currentUser?.email || null,
        })
        .select()
        .single();
      if (error) throw error;
      order = data;

      const itemsPayload = entries.map(({ product, quantity }) => ({
        order_id: order.id,
        product_id: product.id,
        product_name: product.name,
        product_reference: product.reference || null,
        product_ean: product.ean || null,
        unit: product.unit || null,
        quantity_requested: quantity,
      }));

      const { error: itemsError } = await supabaseClient.from("purchase_order_items").insert(itemsPayload);
      if (itemsError) {
        await supabaseClient.from("purchase_orders").delete().eq("id", order.id);
        throw itemsError;
      }

      if (asDraft) {
        showToast(`Borrador ${formatOrderNumber(order)} guardado`);
        resetOrderDraft();
        await loadOrders();
        showOrdersSection("tracking");
        return;
      }

      try {
        await sendPurchaseOrderEmails(order, itemsPayload);
      } catch (mailError) {
        showToast(`Pedido ${formatOrderNumber(order)} guardado como borrador. No se pudo enviar: ${mailError.message}`, 8000);
        await loadOrders();
        showOrdersSection("tracking");
        return;
      }

      const now = new Date().toISOString();
      const { error: updateError } = await supabaseClient
        .from("purchase_orders")
        .update({ status: "sent", sent_at: now, emails_sent: true, emails_sent_at: now })
        .eq("id", order.id);
      if (updateError) {
        showToast(`Los correos se enviaron, pero no se pudo actualizar el pedido: ${updateError.message}`, 8000);
      } else {
        showToast(`Pedido ${formatOrderNumber(order)} enviado a ${purchaseEmail}`, 5000);
      }

      resetOrderDraft();
      await loadOrders();
      showOrdersSection("tracking");
    } catch (error) {
      showToast("No se pudo crear el pedido: " + error.message, 6000);
    }
  });
}

// ---------- Correos ----------
async function getTeamEmails({ exclude = [] } = {}) {
  const { data, error } = await supabaseClient
    .from("profiles")
    .select("email");
  if (error) throw new Error("No se pudo obtener el equipo destinatario: " + error.message);

  const excluded = new Set(
    (exclude || [])
      .map((email) => String(email || "").trim().toLowerCase())
      .filter(Boolean)
  );

  return [...new Set((data || [])
    .map((profile) => (profile.email || "").trim())
    .filter((email) => email && /^[^\s@]+@alverlamp\.es$/i.test(email))
    .filter((email) => !excluded.has(email.toLowerCase())))];
}

async function sendEmailMessage({ recipients, subject, text, html, variables = {} }) {
  const list = [...new Set((recipients || []).map((email) => String(email).trim()).filter(Boolean))];
  if (!list.length) throw new Error("No hay destinatarios para el correo.");

  const useEmailJS = typeof EMAILJS_SERVICE_ID !== "undefined" && EMAILJS_SERVICE_ID;
  if (useEmailJS && window.emailjs && typeof window.emailjs.send === "function") {
    for (const email of list) {
      await emailjs.send(
        EMAILJS_SERVICE_ID,
        EMAILJS_TEMPLATE_ID,
        { to_email: email, subject, message: text, html, ...variables },
        EMAILJS_PUBLIC_KEY
      );
    }
    return;
  }

  if (!APPS_SCRIPT_URL || APPS_SCRIPT_URL.startsWith("PEGA_AQUI")) {
    throw new Error("No hay ningún servicio de email configurado.");
  }

  const response = await fetch(APPS_SCRIPT_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ emails: list, subject, text, html }),
  });
  const responseBody = await response.text();
  if (!response.ok) {
    throw new Error(responseBody || `El servicio de email respondió con HTTP ${response.status}.`);
  }
  if (response.headers.get("content-type")?.includes("application/json")) {
    const result = JSON.parse(responseBody);
    if (result.success === false) throw new Error(result.error || "El servicio de email no pudo enviar el mensaje.");
  }
}

function buildPurchaseOrderText(order, items) {
  const supplierLines = [
    "PROVEEDOR",
    `Nombre: ${order.supplier_name || "Sin nombre"}`,
  ];
  if (order.supplier_email) supplierLines.push(`Email: ${order.supplier_email}`);
  if (order.supplier_phone) supplierLines.push(`Teléfono: ${order.supplier_phone}`);

  const lineBlocks = items.map((item, index) => {
    const details = [
      formatUnits(item.quantity_requested),
      item.product_reference ? `Ref. ${item.product_reference}` : "",
      item.product_ean ? `EAN ${item.product_ean}` : "",
    ].filter(Boolean).join(" · ");
    return `${index + 1}. ${details}\n   ${item.product_name}`;
  });

  const total = items.reduce((sum, item) => sum + Number(item.quantity_requested || 0), 0);
  const lines = [
    "Hola,",
    "Necesitamos estos suministros para la sala de impresión:",
    "",
    ...supplierLines,
    "",
    `LÍNEAS (${items.length})`,
    ...lineBlocks,
    "",
    `Total: ${formatStockNumber(total)} ${total === 1 ? "unidad" : "unidades"}`,
    "",
    `Solicitado por: ${order.requested_by_email || currentUser?.email || ""}`,
  ];

  if (order.note) {
    lines.push("", "Observaciones:", order.note);
  }
  lines.push("", "Saludos.");
  return lines.join("\n");
}

function buildPurchaseOrderHtml(order, items) {
  const total = items.reduce((sum, item) => sum + Number(item.quantity_requested || 0), 0);
  const rows = items.map((item) => `
    <tr>
      <td style="padding:8px 10px;border-bottom:1px solid #eceff1;">${escapeHtml(formatUnits(item.quantity_requested))}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #eceff1;font-family:monospace;">${escapeHtml(item.product_reference || "—")}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #eceff1;font-family:monospace;">${escapeHtml(item.product_ean || "—")}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #eceff1;">${escapeHtml(item.product_name)}</td>
    </tr>`).join("");

  return `
    <div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#111827;">
      <p>Hola,</p>
      <p>Necesitamos estos suministros para la sala de impresión:</p>
      <p style="margin:18px 0 6px;"><strong>PROVEEDOR</strong></p>
      <p style="margin:0;">Nombre: ${escapeHtml(order.supplier_name || "Sin nombre")}</p>
      ${order.supplier_email ? `<p style="margin:0;">Email: ${escapeHtml(order.supplier_email)}</p>` : ""}
      ${order.supplier_phone ? `<p style="margin:0;">Teléfono: ${escapeHtml(order.supplier_phone)}</p>` : ""}
      <p style="margin:18px 0 6px;"><strong>LÍNEAS (${items.length})</strong></p>
      <table style="border-collapse:collapse;width:100%;font-size:13px;">
        <thead>
          <tr>
            <th align="left" style="padding:8px 10px;border-bottom:2px solid #111827;">Unidades</th>
            <th align="left" style="padding:8px 10px;border-bottom:2px solid #111827;">Referencia</th>
            <th align="left" style="padding:8px 10px;border-bottom:2px solid #111827;">EAN</th>
            <th align="left" style="padding:8px 10px;border-bottom:2px solid #111827;">Suministro</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <p style="margin:18px 0 0;"><strong>Total: ${formatStockNumber(total)} ${total === 1 ? "unidad" : "unidades"}</strong></p>
      <p style="margin:18px 0 0;">Solicitado por: ${escapeHtml(order.requested_by_email || "")}</p>
      ${order.note ? `<p style="margin:18px 0 0;"><strong>Observaciones:</strong><br />${escapeHtml(order.note)}</p>` : ""}
      <p style="margin:18px 0 0;">Saludos.</p>
    </div>`;
}

function buildTeamOrderText(order, items) {
  const total = items.reduce((sum, item) => sum + Number(item.quantity_requested || 0), 0);
  const detail = items.map((item) => {
    const reference = item.product_reference ? ` · Ref. ${item.product_reference}` : "";
    return `- ${formatStockNumber(item.quantity_requested)}${reference} · ${item.product_name}`;
  });

  return [
    "Se ha enviado un pedido a compras.",
    "",
    `Pedido: ${formatOrderNumber(order)}`,
    `Proveedor: ${order.supplier_name}`,
    `Responsable de compras: ${order.purchase_email || "Sin asignar"}`,
    `Líneas: ${items.length} (${formatStockNumber(total)} ${total === 1 ? "unidad" : "unidades"})`,
    `Solicitado por: ${order.requested_by_email || ""}`,
    "",
    "Detalle:",
    ...detail,
  ].join("\n");
}

function buildTeamOrderHtml(order, items) {
  const total = items.reduce((sum, item) => sum + Number(item.quantity_requested || 0), 0);
  const detail = items.map((item) => {
    const reference = item.product_reference ? ` · Ref. ${escapeHtml(item.product_reference)}` : "";
    return `<li>${formatStockNumber(item.quantity_requested)}${reference} · ${escapeHtml(item.product_name)}</li>`;
  }).join("");

  return `
    <div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#111827;">
      <p>Se ha enviado un pedido a compras.</p>
      <p>
        <strong>Pedido:</strong> ${escapeHtml(formatOrderNumber(order))}<br />
        <strong>Proveedor:</strong> ${escapeHtml(order.supplier_name)}<br />
        <strong>Responsable de compras:</strong> ${escapeHtml(order.purchase_email || "Sin asignar")}<br />
        <strong>Líneas:</strong> ${items.length} (${formatStockNumber(total)} ${total === 1 ? "unidad" : "unidades"})<br />
        <strong>Solicitado por:</strong> ${escapeHtml(order.requested_by_email || "")}
      </p>
      <p><strong>Detalle:</strong></p>
      <ul>${detail}</ul>
    </div>`;
}

async function sendPurchaseOrderEmails(order, items) {
  const purchaseEmail = (order.purchase_email || "").trim();
  if (!purchaseEmail) {
    throw new Error("El proveedor no tiene responsable de compras asignado.");
  }

  const teamEmails = await getTeamEmails({ exclude: [purchaseEmail] });
  if (!teamEmails.length) throw new Error("No hay otros usuarios del equipo a los que avisar.");

  const variables = {
    order_number: formatOrderNumber(order),
    supplier_name: order.supplier_name,
    purchase_email: purchaseEmail,
    purchase_manager: purchaseEmail,
    line_count: items.length,
  };

  await sendEmailMessage({
    recipients: [purchaseEmail],
    subject: `Pedido de suministros para marketing · ${order.supplier_name}`,
    text: buildPurchaseOrderText(order, items),
    html: buildPurchaseOrderHtml(order, items),
    variables,
  });

  await sendEmailMessage({
    recipients: teamEmails,
    subject: "Pedido realizado a compras",
    text: buildTeamOrderText(order, items),
    html: buildTeamOrderHtml(order, items),
    variables,
  });
}

// ---------- Seguimiento ----------
function renderOrderCounters() {
  const container = $("order-counters");
  if (!container) return;

  const counts = { pending: 0, partial: 0, received: 0 };
  allPurchaseOrders.forEach((order) => {
    if (order.status === "sent") counts.pending += 1;
    if (order.status === "partial") counts.partial += 1;
    if (order.status === "received") counts.received += 1;
  });

  container.innerHTML = `
    <div class="order-counter"><strong>${counts.pending + counts.partial}</strong><span>Pendientes</span></div>
    <div class="order-counter"><strong>${counts.partial}</strong><span>Parciales</span></div>
    <div class="order-counter"><strong>${counts.received}</strong><span>Recibidos</span></div>`;
}

function renderOrdersList() {
  const container = $("orders-list");
  const empty = $("orders-empty");
  if (!container || !empty) return;

  renderOrderCounters();

  const status = $("order-status-filter").value;
  const supplierId = $("order-supplier-filter").value;
  const term = $("order-search").value.trim().toLowerCase();

  const filtered = allPurchaseOrders.filter((order) => {
    if (status && order.status !== status) return false;
    if (supplierId && order.supplier_id !== supplierId) return false;
    if (!term) return true;
    const references = getOrderItems(order.id).map((item) => item.product_reference || "").join(" ");
    return [formatOrderNumber(order), order.supplier_name, order.purchase_email, references]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(term));
  });

  empty.classList.toggle("hidden", allPurchaseOrders.length > 0);

  if (!allPurchaseOrders.length) {
    container.innerHTML = "";
    return;
  }
  if (!filtered.length) {
    container.innerHTML = '<p class="empty-state">No hay pedidos que coincidan con los filtros.</p>';
    return;
  }

  container.innerHTML = filtered.map((order) => {
    const items = getOrderItems(order.id);
    const totalUnits = items.reduce((sum, item) => sum + Number(item.quantity_requested || 0), 0);
    const pendingUnits = getOrderPendingUnits(order.id);
    const summary = [
      formatOrderDate(order.created_at),
      `${items.length} ${items.length === 1 ? "referencia" : "referencias"}`,
      `${formatStockNumber(totalUnits)} uds`,
      pendingUnits > 0 ? `${formatStockNumber(pendingUnits)} pendientes` : "",
    ].filter(Boolean).join(" · ");

    return `
      <button type="button" class="order-card" data-order-id="${order.id}">
        <span class="order-card-main">
          <span class="order-card-heading">
            <strong>${escapeHtml(formatOrderNumber(order))}</strong>
            <span class="order-status ${escapeHtml(order.status)}">${escapeHtml(orderStatusLabel(order.status))}</span>
          </span>
          <span class="order-card-supplier">${escapeHtml(order.supplier_name || "Sin proveedor")}</span>
          <span class="order-card-meta">${escapeHtml(summary)}</span>
        </span>
        <span class="order-card-arrow" aria-hidden="true">›</span>
      </button>`;
  }).join("");

  container.querySelectorAll(".order-card").forEach((card) => {
    card.addEventListener("click", () => openOrderDetailModal(card.dataset.orderId));
  });
}

function openOrderDetailModal(orderId) {
  if (hasOpenModal()) return;
  const order = allPurchaseOrders.find((item) => item.id === orderId);
  if (!order) return;

  const items = getOrderItems(order.id);
  const events = allPurchaseOrderEvents.filter((event) => event.order_id === order.id);
  const editable = order.status === "sent" || order.status === "partial";

  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop centered";
  backdrop.innerHTML = `
    <div class="modal-sheet order-detail-modal">
      <div class="modal-header">
        <h2>${escapeHtml(formatOrderNumber(order))} · ${escapeHtml(order.supplier_name || "Sin proveedor")}</h2>
        <button type="button" class="modal-close" aria-label="Cerrar">&times;</button>
      </div>

      <div class="order-detail-summary">
        <div class="order-detail-block">
          <span>Estado</span>
          <strong><span class="order-status ${escapeHtml(order.status)}">${escapeHtml(orderStatusLabel(order.status))}</span></strong>
        </div>
        <div class="order-detail-block">
          <span>Fecha</span>
          <strong>${escapeHtml(formatOrderDate(order.created_at))}</strong>
        </div>
        <div class="order-detail-block">
          <span>Solicitado por</span>
          <strong>${escapeHtml(order.requested_by_email || "—")}</strong>
        </div>
        <div class="order-detail-block">
          <span>Responsable de compras</span>
          <strong>${escapeHtml(order.purchase_email || "Sin asignar")}</strong>
        </div>
      </div>

      <div class="order-detail-block" style="margin-bottom:18px">
        <span>Proveedor</span>
        <strong>${escapeHtml(order.supplier_name || "Sin nombre")}</strong>
        <p style="margin:4px 0 0;font-size:13px;color:var(--ink-soft)">
          ${escapeHtml([order.supplier_email, order.supplier_phone].filter(Boolean).join(" · ") || "Sin datos de contacto")}
        </p>
      </div>

      <div class="order-lines-shell">
        <table class="order-lines-table">
          <thead>
            <tr>
              <th>Referencia</th>
              <th>Suministro</th>
              <th>EAN</th>
              <th>Pedido</th>
              <th>Recibido</th>
              <th>Pendiente</th>
              <th>Estado</th>
              ${editable ? "<th></th>" : ""}
            </tr>
          </thead>
          <tbody>
            ${items.map((item) => {
              const pending = Math.max(0, Number(item.quantity_requested) - Number(item.quantity_received));
              return `
                <tr>
                  <td class="order-line-ref">${escapeHtml(item.product_reference || "—")}</td>
                  <td>${escapeHtml(item.product_name)}</td>
                  <td class="order-line-ref">${escapeHtml(item.product_ean || "—")}</td>
                  <td>${escapeHtml(formatStockNumber(item.quantity_requested))}${item.unit ? ` ${escapeHtml(item.unit)}` : ""}</td>
                  <td>${escapeHtml(formatStockNumber(item.quantity_received))}</td>
                  <td>${escapeHtml(formatStockNumber(pending))}</td>
                  <td>${escapeHtml(orderItemStatusLabel(item.status))}</td>
                  ${editable ? `
                    <td>
                      <span class="order-line-received">
                        <input type="number" min="0" max="${item.quantity_requested}" step="1" value="${item.quantity_received}" data-line-id="${item.id}" aria-label="Recibido de ${escapeHtml(item.product_name)}" />
                        <button type="button" class="btn btn-outline order-line-save" data-line-id="${item.id}">Guardar</button>
                      </span>
                    </td>` : ""}
                </tr>`;
            }).join("")}
          </tbody>
        </table>
      </div>

      ${order.note ? `
        <div class="order-detail-block" style="margin-bottom:18px">
          <span>Observaciones</span>
          <strong style="font-weight:400;white-space:pre-wrap">${escapeHtml(order.note)}</strong>
        </div>` : ""}

      <h3 class="section-subtitle" style="margin-top:0">Historial</h3>
      <ul class="order-event-list">
        ${events.length ? events.map((event) => `
          <li>
            <strong>${escapeHtml(event.status ? orderStatusLabel(event.status) : (event.source === "system" ? "Recepción automática" : "Nota"))}</strong>
            · ${escapeHtml(formatOrderDate(event.created_at))}
            ${event.changed_by_email ? ` · ${escapeHtml(event.changed_by_email)}` : ""}
            ${event.note ? `<br />${escapeHtml(event.note)}` : ""}
          </li>`).join("") : "<li>Todavía no hay movimientos registrados.</li>"}
      </ul>

      <div class="order-detail-actions">
        ${order.status === "draft" ? '<button type="button" class="btn btn-teal" id="order-detail-send">Enviar pedido</button>' : ""}
        ${editable ? '<button type="button" class="btn btn-outline" id="order-detail-received">Marcar todo como recibido</button>' : ""}
        ${order.status !== "received" && order.status !== "cancelled" ? '<button type="button" class="btn btn-outline" id="order-detail-cancel" style="color:var(--red);border-color:var(--red)">Cancelar pedido</button>' : ""}
      </div>
    </div>`;
  document.body.appendChild(backdrop);

  const close = () => backdrop.remove();
  backdrop.querySelector(".modal-close").addEventListener("click", close);
  backdrop.addEventListener("click", (event) => {
    if (event.target === backdrop) close();
  });

  const refreshAfterChange = async () => {
    close();
    await loadOrders();
    renderOrdersList();
  };

  const sendButton = backdrop.querySelector("#order-detail-send");
  if (sendButton) {
    sendButton.addEventListener("click", () => resendPurchaseOrder(order, items, sendButton));
  }

  const receivedButton = backdrop.querySelector("#order-detail-received");
  if (receivedButton) {
    receivedButton.addEventListener("click", async () => {
      if (!confirm(`¿Marcar el pedido ${formatOrderNumber(order)} como recibido? Se darán por recibidas todas sus líneas.`)) return;
      await withBusy(receivedButton, "Actualizando…", async () => {
        try {
          const pendingItems = items.filter((item) => item.status !== "cancelled");
          for (const item of pendingItems) {
            const { error } = await supabaseClient
              .from("purchase_order_items")
              .update({ quantity_received: item.quantity_requested, status: "received" })
              .eq("id", item.id);
            if (error) throw error;
          }
          const now = new Date().toISOString();
          const { error: orderError } = await supabaseClient
            .from("purchase_orders")
            .update({ status: "received", closed_at: now })
            .eq("id", order.id);
          if (orderError) throw orderError;
          showToast(`Pedido ${formatOrderNumber(order)} marcado como recibido`);
          await refreshAfterChange();
        } catch (error) {
          showToast("No se pudo marcar el pedido como recibido: " + error.message, 6000);
        }
      });
    });
  }

  const cancelButton = backdrop.querySelector("#order-detail-cancel");
  if (cancelButton) {
    cancelButton.addEventListener("click", async () => {
      if (!confirm(`¿Cancelar el pedido ${formatOrderNumber(order)}? Dejará de descontarse del stock.`)) return;
      await withBusy(cancelButton, "Cancelando…", async () => {
        try {
          const { error: orderError } = await supabaseClient
            .from("purchase_orders")
            .update({ status: "cancelled", closed_at: new Date().toISOString() })
            .eq("id", order.id);
          if (orderError) throw orderError;

          const itemIds = items.filter((item) => item.status !== "cancelled").map((item) => item.id);
          if (itemIds.length) {
            const { error: itemsError } = await supabaseClient
              .from("purchase_order_items")
              .update({ status: "cancelled" })
              .in("id", itemIds);
            if (itemsError) throw itemsError;
          }
          showToast(`Pedido ${formatOrderNumber(order)} cancelado`);
          await refreshAfterChange();
        } catch (error) {
          showToast("No se pudo cancelar el pedido: " + error.message, 6000);
        }
      });
    });
  }

  backdrop.querySelectorAll(".order-line-save").forEach((button) => {
    button.addEventListener("click", async () => {
      const lineId = button.dataset.lineId;
      const input = backdrop.querySelector(`.order-line-received input[data-line-id="${lineId}"]`);
      if (!input) return;
      const value = Number(input.value);
      if (!Number.isFinite(value) || value < 0) {
        showToast("Escribe una cantidad válida.");
        return;
      }

      await withBusy(button, "…", async () => {
        const { error } = await supabaseClient.rpc("set_purchase_order_item_received", {
          p_item_id: lineId,
          p_received: value,
        });
        if (error) {
          showToast("No se pudo actualizar la recepción: " + error.message, 6000);
          return;
        }
        showToast("Recepción actualizada");
        close();
        await loadOrders();
        renderOrdersList();
        openOrderDetailModal(order.id);
      });
    });
  });
}

async function resendPurchaseOrder(order, items, button) {
  await withBusy(button, "Enviando…", async () => {
    try {
      await sendPurchaseOrderEmails(order, items);
      const now = new Date().toISOString();
      const { error } = await supabaseClient
        .from("purchase_orders")
        .update({ status: "sent", sent_at: order.sent_at || now, emails_sent: true, emails_sent_at: now })
        .eq("id", order.id);
      if (error) throw error;
      showToast(`Pedido ${formatOrderNumber(order)} enviado a ${order.purchase_email}`, 5000);
      const backdrop = document.querySelector(".modal-backdrop");
      if (backdrop) backdrop.remove();
      await loadOrders();
      renderOrdersList();
    } catch (error) {
      showToast("No se pudo enviar el pedido: " + error.message, 7000);
    }
  });
}

// ---------- Conciliación automática visible ----------
async function getPendingOrderLinesForProduct(productId) {
  if (!productId) return [];
  const { data, error } = await supabaseClient
    .from("purchase_order_items")
    .select("id, order_id, quantity_requested, quantity_received, status")
    .eq("product_id", productId)
    .in("status", ["pending", "partial"]);
  if (error) {
    console.warn("No se pudieron cargar las líneas pendientes del producto:", error);
    return [];
  }
  return data || [];
}

async function reportOrderReconciliation(beforeLines) {
  if (!beforeLines || !beforeLines.length) return;

  const ids = beforeLines.map((line) => line.id);
  const { data, error } = await supabaseClient
    .from("purchase_order_items")
    .select("id, order_id, quantity_received")
    .in("id", ids);
  if (error) return;

  const beforeById = new Map(beforeLines.map((line) => [line.id, Number(line.quantity_received) || 0]));
  const changes = (data || [])
    .map((line) => ({
      ...line,
      delta: (Number(line.quantity_received) || 0) - (beforeById.get(line.id) || 0),
    }))
    .filter((line) => line.delta > 0);

  if (!changes.length) return;

  const orderIds = [...new Set(changes.map((line) => line.order_id))];
  const { data: orders } = await supabaseClient
    .from("purchase_orders")
    .select("id, order_number")
    .in("id", orderIds);
  const labels = (orders || []).map((order) => formatOrderNumber(order)).join(", ") || "pendiente";
  const total = changes.reduce((sum, line) => sum + line.delta, 0);

  showToast(`Pedido ${labels}: ${formatStockNumber(total)} uds marcadas como recibidas`, 5000);

  if (ordersLoaded) {
    await loadOrders();
    renderOrdersList();
  }
}

// ---------- Eventos de la vista ----------
document.querySelectorAll(".orders-view-btn").forEach((button) => {
  button.addEventListener("click", () => showOrdersSection(button.dataset.ordersView));
});

$("edit-purchase-manager-btn").addEventListener("click", () => {
  const supplier = getOrderSupplier();
  if (!supplier) {
    showToast("Añade un suministro para fijar el proveedor del pedido.");
    return;
  }
  openSupplierModal(supplier);
});

$("order-clear").addEventListener("click", () => {
  if (!orderDraftItems.size) return;
  if (!confirm("¿Vaciar el pedido? Se quitarán todos los suministros y podrás elegir otro proveedor.")) return;
  orderDraftItems = new Map();
  orderDraftSupplierId = "";
  renderOrderPicker();
  renderOrderCart();
  showToast("Pedido vaciado");
});

$("order-add-manual").addEventListener("click", openOrderProductModal);
$("order-save-draft").addEventListener("click", () => submitPurchaseOrder(true));
$("order-send").addEventListener("click", () => submitPurchaseOrder(false));

$("order-status-filter").addEventListener("change", renderOrdersList);
$("order-supplier-filter").addEventListener("change", renderOrdersList);
$("order-search").addEventListener("input", renderOrdersList);
$("orders-empty-new").addEventListener("click", () => showOrdersSection("new"));

// ---------------------------------------------------------------
// Modal de edición de producto
// ---------------------------------------------------------------
function openEditModal(productId) {
  if (hasOpenModal()) return;
  const p = allProducts.find((x) => x.id === productId);
  if (!p) return;

  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  if (window.innerWidth >= 900) backdrop.classList.add('centered');
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
          <label>Referencia del proveedor</label>
          <input type="text" id="edit-reference" value="${escapeHtml(p.reference || "")}" placeholder="Ej: PF-A4-200" />
        </div>
        <div class="field">
          <label>Nombre *</label>
          <input type="text" id="edit-name" required value="${escapeHtml(p.name)}" />
        </div>
        <div class="two-col">
          <div class="field">
            <label>Máquina</label>
            <select id="edit-machine">${getMachineOptionsHtml(p.machine_id || "")}</select>
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
            <select id="edit-supplier">
              ${getSupplierOptionsHtml(p.supplier_id || "")}
            </select>
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
      reference: $("edit-reference").value.trim() || null,
      name: $("edit-name").value.trim(),
      machine_id: $("edit-machine").value || null,
      unit: $("edit-unit").value.trim() || null,
      location: $("edit-location").value.trim() || null,
      supplier_id: $("edit-supplier").value || null,
      quantity: Number($("edit-quantity").value),
      min_quantity: Number($("edit-min").value),
    };
    const submitButton = backdrop.querySelector('button[type="submit"]');
    await withBusy(submitButton, "Guardando…", async () => {
      const { data, error } = await supabaseClient
        .from("products")
        .update(updated)
        .eq("id", p.id)
        .select("*, supplier_info:suppliers!products_supplier_id_fkey(id, name, email, phone), machine_info:machines!products_machine_id_fkey(id, name)")
        .single();
      if (error) {
        showToast("Error al guardar: " + error.message);
        return;
      }
      const updatedProduct = normalizeProduct(data);
      replaceProductInInventory(updatedProduct);
      await checkLowStock(updatedProduct);
      close();
      showToast("Suministro actualizado");
    });
  });

  backdrop.querySelector("#edit-delete-btn").addEventListener("click", async () => {
    const sure = confirm(`¿Eliminar "${p.name}" del inventario?`);
    if (!sure) return;
    const button = backdrop.querySelector("#edit-delete-btn");
    await withBusy(button, "Eliminando…", async () => {
      const { error } = await supabaseClient.from("products").delete().eq("id", p.id);
      if (error) {
        showToast("Error al eliminar");
        return;
      }
      close();
      showToast("Suministro eliminado");
      loadProducts();
    });
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
    .catch(() => {
      addScanner = null;
      $("add-scanner").classList.add("hidden");
      showToast("No se pudo acceder a la cámara");
    });
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
    reference: $("add-reference").value.trim() || null,
    name: $("add-name").value.trim(),
    machine_id: $("add-machine").value || null,
    unit: $("add-unit").value.trim() || null,
    location: $("add-location").value.trim() || null,
    supplier_id: $("add-supplier").value || null,
    quantity: Number($("add-quantity").value),
    min_quantity: Number($("add-min").value),
  };

  const submitButton = e.target.querySelector('button[type="submit"]');
  await withBusy(submitButton, "Guardando…", async () => {
    const { data, error } = await supabaseClient
      .from("products")
      .insert(payload)
      .select("*, supplier_info:suppliers!products_supplier_id_fkey(id, name, email, phone), machine_info:machines!products_machine_id_fkey(id, name)")
      .single();
    if (error) {
      if (error.message.includes("duplicate")) {
        showToast("Ya existe un suministro con ese código EAN");
      } else {
        showToast("Error al guardar: " + error.message);
      }
      return;
    }

    await checkLowStock(normalizeProduct(data));
    showToast("Suministro añadido");
    e.target.reset();
    $("add-quantity").value = 0;
    $("add-min").value = 1;
    await loadProducts();
    showView("list");
  });
});

// ---------------------------------------------------------------
// Escanear (sacar / añadir stock)
// ---------------------------------------------------------------
$("mode-out-btn").addEventListener("click", () => pickScanMode("out"));
$("mode-in-btn").addEventListener("click", () => pickScanMode("in"));
$("scan-camera-close").addEventListener("click", resetScanView);

function setScanMode(mode) {
  stockScanMode = mode;
  const label = $("scan-mode-label");
  if (label) label.textContent = mode === "out" ? "Sacar stock" : "Añadir stock";
}

function setScanCameraVisible(visible) {
  const camera = $("scan-camera");
  if (camera) camera.classList.toggle("hidden", !visible);
  const picker = $("scan-mode-picker");
  if (picker) picker.classList.toggle("hidden", visible);
}

function clearScanResult() {
  const resultBox = $("scan-result");
  if (!resultBox) return;
  resultBox.classList.add("hidden");
  resultBox.innerHTML = "";
}

// Vuelve a la pantalla de los dos botones grandes y apaga la cámara.
function resetScanView() {
  stopStockScanner();
  clearScanResult();
  setScanCameraVisible(false);
}

function pickScanMode(mode) {
  setScanMode(mode);
  clearScanResult();
  setScanCameraVisible(true);
  startStockScanner();
}

function startStockScanner() {
  if (stockScanner) return;
  setScanCameraVisible(true);
  clearScanResult();
  stockScanner = new Html5Qrcode("qr-reader");
  stockScanner
    .start(
      { facingMode: "environment" },
      { fps: 10, qrbox: { width: 260, height: 130 }, formatsToSupport: BARCODE_FORMATS },
      (decodedText) => onStockScan(decodedText),
      () => {}
    )
    .catch(() => {
      stockScanner = null;
      setScanCameraVisible(false);
      showToast("No se pudo acceder a la cámara");
    });
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

  setScanCameraVisible(false);

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
        <button type="button" class="btn btn-outline" id="scan-resume">Seguir escaneando</button>
        <button type="button" class="btn btn-ghost" id="scan-back">Elegir otro modo</button>
      </div>`;
    $("scan-add-new").addEventListener("click", () => {
      showView("add");
      $("add-ean").value = ean;
    });
    $("scan-resume").addEventListener("click", resumeScan);
    $("scan-back").addEventListener("click", resetScanView);
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
      <button type="button" class="btn btn-outline" id="scan-resume">Seguir escaneando</button>
      <button type="button" class="btn btn-ghost" id="scan-back">Elegir otro modo</button>
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
    const button = $("scan-confirm");
    const amount = Number($("scan-delta").value) || 1;
    const delta = stockScanMode === "out" ? -amount : amount;
    let done = false;
    await withBusy(button, "Aplicando…", async () => {
      const updated = await applyQuantityDelta(product, delta);
      if (updated) {
        done = true;
        showToast(`${label}: ${amount} × ${product.name}`);
      }
    });
    if (done) resumeScan();
  });
  $("scan-resume").addEventListener("click", resumeScan);
  $("scan-back").addEventListener("click", resetScanView);
}

function resumeScan() {
  clearScanResult();
  setScanCameraVisible(true);
  if (stockScanner) {
    stockScanner.resume();
  } else {
    startStockScanner();
  }
}
