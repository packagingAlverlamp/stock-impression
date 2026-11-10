// ============================================================
// Edge Function: delete-account
// Borra por completo la cuenta del usuario que hace la llamada
// (su fila de auth.users, y en cascada su perfil en profiles).
// Se despliega con: supabase functions deploy delete-account
//
// Seguridad:
// - Exige un JWT válido del propio usuario.
// - CORS limitado a los orígenes configurados en ALLOWED_ORIGIN.
// - Los errores internos no se devuelven al cliente.
// ============================================================
import { createClient } from "npm:@supabase/supabase-js@2";

const ALLOWED_ORIGINS = (Deno.env.get("ALLOWED_ORIGIN") || "https://stock-impresion.vercel.app,http://localhost:3000")
  .split(",")
  .map((value) => value.trim().replace(/\/+$/, "").toLowerCase())
  .filter(Boolean);

function corsHeaders(req: Request) {
  const origin = (req.headers.get("Origin") || "").replace(/\/+$/, "").toLowerCase();
  if (!origin || !ALLOWED_ORIGINS.includes(origin)) return null;

  return {
    "Access-Control-Allow-Origin": origin,
    "Vary": "Origin",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, content-type",
  };
}

const json = (body: unknown, status: number, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

Deno.serve(async (req: Request) => {
  const cors = corsHeaders(req);

  if (req.method === "OPTIONS") {
    if (!cors) return new Response("Origen no permitido", { status: 403 });
    return new Response("ok", { headers: cors });
  }

  if (req.method !== "POST") {
    return json({ error: "Método no permitido" }, 405, cors || {});
  }

  if (!cors) {
    return json({ error: "Origen no permitido" }, 403);
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return json({ error: "No autorizado" }, 401, cors);
    }

    // Estas 3 variables las inyecta Supabase automáticamente,
    // no hace falta configurarlas a mano.
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Cliente "como el usuario", solo para averiguar quién es.
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userError } = await userClient.auth.getUser();

    if (userError || !userData?.user) {
      return json({ error: "Usuario no válido" }, 401, cors);
    }

    // Cliente con permisos de administrador, para poder borrar.
    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const { error: deleteError } = await adminClient.auth.admin.deleteUser(
      userData.user.id
    );

    if (deleteError) {
      console.error("[delete-account] No se pudo borrar la cuenta:", deleteError.message);
      return json({ error: "No se pudo borrar la cuenta" }, 500, cors);
    }

    return json({ success: true }, 200, cors);
  } catch (err) {
    console.error("[delete-account] Error inesperado:", err);
    return json({ error: "Error interno" }, 500, cors);
  }
});
