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

    // 3. Forward the (unchanged) Anthropic Messages payload. This is a transparent
    //    pass-through, so it already supports function calling: a `tools` array in
    //    the request body is forwarded to Anthropic, and any `tool_use` content
    //    blocks (and the `stop_reason`) come straight back to the client unmodified.
    //
    //    PAYLOAD BOUNDARY (CR-8): a request carrying a `profile` is built SERVER-SIDE
    //    from the registry — model/max_tokens/system/tools are owned here, and any
    //    client-supplied model/system/tools/max_tokens are ignored (breadcrumbed).
    //    Unknown profile → 400. Requests with NO profile are LEGACY un-migrated call
    //    sites: passed through unchanged for now, but breadcrumbed so they're visible
    //    and the boundary can be made mandatory once every call site is migrated.
    let clientBody: Record<string, unknown> = {};
    try { clientBody = JSON.parse(await req.text() || "{}"); } catch { clientBody = {}; }

    let outbound: unknown;
    const profileKey = typeof clientBody.profile === "string" ? clientBody.profile : null;
    if (profileKey) {
      const built = buildAnthropicPayload(profileKey, clientBody);
      if ((built as { error?: string }).error) {
        return json({ error: (built as { error: string }).error }, 400);   // unknown profile
      }
      outbound = (built as { payload: unknown }).payload;
      const stripped = (built as { stripped?: string[] }).stripped || [];
      const passthrough = (built as { passthrough?: boolean }).passthrough;
      if (stripped.length) console.warn(`[ai-proxy] profile=${profileKey} ignored client-supplied: ${stripped.join(", ")}`);
      if (passthrough) console.warn(`[ai-proxy] profile=${profileKey} is a FLAGGED passthrough (system/tools still client-authored — migration pending)`);
    } else {
      // LEGACY: no profile → un-migrated call site. Pass the client payload through.
      console.warn("[ai-proxy] LEGACY passthrough (no profile) — un-migrated call site; boundary not enforced for this request");
      outbound = clientBody;
    }

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
