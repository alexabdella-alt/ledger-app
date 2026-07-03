// supabase/functions/ai-proxy/index.ts
//
// Authenticated proxy to the Anthropic Messages API. The Anthropic key never
// leaves the server. Adds per-user hourly rate limiting (see migration 021):
//   - 60 AI requests / user / hour  (every call)
//   - 20 file uploads / user / hour (calls tagged with header `x-rate-kind: upload`)
// On limit, returns HTTP 429 with { "error": "<message>" } which the app surfaces.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildAnthropicPayload } from "./aiProfiles.js";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const AI_LIMIT = 60;       // AI requests / user / hour
const UPLOAD_LIMIT = 20;   // file uploads / user / hour

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-rate-kind",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (obj: unknown, status: number) =>
  new Response(JSON.stringify(obj), { status, headers: { ...cors, "Content-Type": "application/json" } });

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    // 1. Authenticate the caller from their Supabase JWT.
    const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!jwt) return json({ error: "Missing authorization." }, 401);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
    const { data: { user }, error: userErr } = await admin.auth.getUser(jwt);
    if (userErr || !user) return json({ error: "Invalid or expired session." }, 401);

    // 2. Rate limit. Every call counts against the AI limit; calls tagged
    //    `x-rate-kind: upload` also count against the per-file upload limit.
    const { data: aiCount } = await admin.rpc("bump_rate_limit", { p_user: user.id, p_bucket: "ai" });
    if ((aiCount ?? 0) > AI_LIMIT) {
      return json({ error: `Rate limit exceeded. You can make ${AI_LIMIT} AI requests per hour. Please wait before trying again.` }, 429);
    }
    if ((req.headers.get("x-rate-kind") || "").toLowerCase() === "upload") {
      const { data: upCount } = await admin.rpc("bump_rate_limit", { p_user: user.id, p_bucket: "upload" });
      if ((upCount ?? 0) > UPLOAD_LIMIT) {
        return json({ error: `Upload limit exceeded. You can upload ${UPLOAD_LIMIT} files per hour. Please wait before trying again.` }, 429);
      }
    }

    // 3. Build the Anthropic Messages payload SERVER-SIDE from the profile registry.
    //    The boundary is now MANDATORY (CR-8 closed): the client sends only
    //    { profile, messages, slots } — model/max_tokens/system/tools are owned here
    //    and any client-supplied versions are ignored (breadcrumbed). A missing OR
    //    unknown profile → 400. There is NO legacy passthrough. Function calling still
    //    works: the server injects the profile's `tools`, and any `tool_use` blocks
    //    (and `stop_reason`) come straight back to the client unmodified.
    let clientBody: Record<string, unknown> = {};
    try { clientBody = JSON.parse(await req.text() || "{}"); } catch { clientBody = {}; }

    const profileKey = typeof clientBody.profile === "string" ? clientBody.profile : "";
    if (!profileKey) {
      console.warn("[ai-proxy] rejected request with no profile — boundary is mandatory");
      return json({ error: "Missing AI profile. This endpoint only accepts registered profiles." }, 400);
    }
    const built = buildAnthropicPayload(profileKey, clientBody);
    if ((built as { error?: string }).error) {
      console.warn(`[ai-proxy] rejected unknown profile: ${profileKey}`);
      return json({ error: (built as { error: string }).error }, 400);   // unknown profile
    }
    const outbound = (built as { payload: unknown }).payload;
    const stripped = (built as { stripped?: string[] }).stripped || [];
    if (stripped.length) console.warn(`[ai-proxy] profile=${profileKey} ignored client-supplied: ${stripped.join(", ")}`);

    const upstream = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(outbound),
    });
    return new Response(await upstream.text(), {
      status: upstream.status,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  } catch (e) {
    return json({ error: `Proxy error: ${e?.message || String(e)}` }, 500);
  }
});
