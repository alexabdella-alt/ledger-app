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
  // Exposed so a caller can READ its remaining budget rather than discovering it by
  // being refused. The limiter computes these to make its decision either way.
  "Access-Control-Expose-Headers": "x-ratelimit-remaining-ai, x-ratelimit-remaining-upload",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (obj: unknown, status: number, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(obj), { status, headers: { ...cors, "Content-Type": "application/json", ...extra } });

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
    //
    // ★ O113a — A REFUSED CALL IS NOT CHARGED FOR. The previous shape called
    // `bump_rate_limit` (which increments and returns) and checked the result AFTER, so
    // every rejection still spent budget: the 2026-08-25 drive hour recorded `ai = 81`
    // against a ceiling of 60, twenty-one charges for calls that never ran. That made
    // retrying actively harmful while nothing on screen said so.
    //
    // It also charged ACROSS buckets: an upload-tagged call bumped `ai`, passed, then was
    // refused by `upload` — leaving the `ai` charge behind. So the decision has to be
    // all-or-nothing across every bucket, which is why both are passed in one call.
    // `consume_rate_limit` (migration 074) reads, decides, and only then charges, inside
    // one transaction.
    const isUpload = (req.headers.get("x-rate-kind") || "").toLowerCase() === "upload";
    const buckets = isUpload ? ["ai", "upload"] : ["ai"];
    const limits  = isUpload ? [AI_LIMIT, UPLOAD_LIMIT] : [AI_LIMIT];
    const { data: gate, error: gateErr } = await admin.rpc("consume_rate_limit", {
      p_user: user.id, p_buckets: buckets, p_limits: limits,
    });
    // FAIL CLOSED. If the limiter cannot answer we do not know the budget, and guessing
    // in the permissive direction is how a limiter becomes decorative under exactly the
    // load it exists for.
    if (gateErr || !gate) {
      console.error("[ai-proxy] rate limiter unavailable:", gateErr?.message);
      return json({ error: "Rate limiting is temporarily unavailable. Please try again in a moment." }, 503);
    }
    if (!gate.allowed) {
      const blocked = gate.blocked_bucket;
      // Say WHICH budget ran out and WHEN it resets.
      //
      // ★★ THE LIMITER NOW KNOWS THE REAL ANSWER (migration `086`, O113c). The window is a
      // ROLLING hour, so capacity returns when the oldest call ages out — usually a couple of
      // minutes — and the function returns that number. Under the old clock hour the best
      // anyone could say was "up to 59", and the wait was 55 minutes at :05 and five at :55:
      // the same mistake at eleven times the cost, for no reason a person could see.
      //
      // ★ THE FALLBACK IS WHY THE DEPLOY ORDER IS NOT LOAD-BEARING. An un-migrated database
      // returns no `resets_in_minutes`, and this still answers with the old clock-hour maths.
      // `074` had to be applied before its deploy because the reverse called a function that
      // did not exist; this one is safe in either order.
      const rolling = Number(gate.resets_in_minutes);
      const resetsInMin = Number.isFinite(rolling) && rolling >= 0
        ? rolling
        : 60 - new Date().getUTCMinutes();
      const msg = blocked === "upload"
        ? `Upload limit reached — ${UPLOAD_LIMIT} files per hour. This resets in about ${resetsInMin} minute(s).`
        : `AI request limit reached — ${AI_LIMIT} per hour, shared across everything the app asks the AI to do. This resets in about ${resetsInMin} minute(s).`;
      return json({ error: msg, blocked_bucket: blocked, remaining: gate.remaining, resets_in_minutes: resetsInMin }, 429);
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
    // Report the remaining budget on SUCCESS, not only on refusal. The limiter computed
    // these to make its decision, so surfacing them costs nothing — and a caller that can
    // see "3 left" can pace itself, where one that only learns at zero cannot. This is a
    // step toward the budget being something a user can reason about (O113a's sibling
    // finding: the limit is not "20 invoices", it is "20 invoices minus whatever else you
    // did this hour"), NOT a fix for it — that needs a surface, and none is built here.
    const rem = (gate?.remaining ?? {}) as Record<string, number>;
    return new Response(await upstream.text(), {
      status: upstream.status,
      headers: {
        ...cors, "Content-Type": "application/json",
        "x-ratelimit-remaining-ai": String(rem.ai ?? ""),
        ...(isUpload ? { "x-ratelimit-remaining-upload": String(rem.upload ?? "") } : {}),
      },
    });
  } catch (e) {
    return json({ error: `Proxy error: ${e?.message || String(e)}` }, 500);
  }
});
