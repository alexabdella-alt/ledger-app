// supabase/functions/ai-proxy/index.ts
//
// Authenticated proxy to the Anthropic Messages API. The Anthropic key never
// leaves the server. Adds per-user hourly rate limiting (see migration 021):
//   - 60 AI requests / user / hour  (every call)
//   - 20 file uploads / user / hour (calls tagged with header `x-rate-kind: upload`)
// On limit, returns HTTP 429 with { "error": "<message>" } which the app surfaces.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

    // 3. Forward the (unchanged) Anthropic Messages payload.
    const body = await req.text();
    const upstream = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body,
    });
    return new Response(await upstream.text(), {
      status: upstream.status,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  } catch (e) {
    return json({ error: `Proxy error: ${e?.message || String(e)}` }, 500);
  }
});
