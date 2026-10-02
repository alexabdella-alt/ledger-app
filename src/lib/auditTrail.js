// ─────────────────────────────────────────────────────────────────────────────
// C568 — THE AUDIT TRAIL SAYS HOW MUCH OF IT YOU ARE LOOKING AT.
//
// The screen loads the newest AUDIT_SCREEN_ROWS events. Before this, it then labelled
// that window "Total events", the download button said "Download CSV (1,000 events)",
// and the CSV — commented "exports the FULL unfiltered log" — exported the same window.
// A screen headed "Permanent, immutable record of every action" was handing an
// accountant the newest thousand and calling it everything, and at a busy company
// a thousand events is a few months.
//
// Now: the load asks Postgres for the exact count, the screen says "newest N of M" when
// it is showing part, and the download reads EVERY row at click time (pagedRead.js).
//
// The second half is the snapshot each event carries. `before`/`after` kept the first
// five items of any list and dropped the rest without a word — a bulk delete of twenty
// entries recorded five. The list is still trimmed (the row would otherwise carry a
// whole statement), but the trim is now recorded inside the snapshot itself.
//
// Pure, apart from `readFullAuditLog`, which takes the client as an argument.
// ─────────────────────────────────────────────────────────────────────────────

import { readAllRows } from "./pagedRead.js";

export const AUDIT_SCREEN_ROWS = 1000;
export const AUDIT_LIST_KEEP = 25;

export const auditRowFromDb = (a) => ({
  id: a.id, ts: a.created_at, action: a.action,
  detail: a.detail, before: a.before_state, after: a.after_state, user: a.performed_by || "owner",
});

// The snapshot stored with an event. Large payload fields are dropped by name (they are
// file contents, not facts); a long list keeps its first AUDIT_LIST_KEEP items and ends
// with a marker naming how many more there were.
export function slimAuditState(obj) {
  if (!obj) return null;
  if (typeof obj !== "object") return obj;
  if (Array.isArray(obj)) {
    const kept = obj.slice(0, AUDIT_LIST_KEEP).map(slimAuditState);
    const left = obj.length - kept.length;
    return left > 0 ? [...kept, { _omitted: left, _of: obj.length }] : kept;
  }
  const { base64, raw_text, notes_for_reviewer, ...rest } = obj;
  return rest;
}

// How much of the trail the screen holds, in words. `total` is the exact count from the
// database, or null when it could not be had — and then we do not claim a total at all.
export function auditCoverage(loaded, total) {
  const n = loaded || 0;
  if (typeof total !== "number" || !Number.isFinite(total)) return { partial: false, total: null, line: null };
  if (total <= n) return { partial: false, total, line: null };
  return {
    partial: true, total,
    line: `Showing the newest ${n.toLocaleString("en-US")} of ${total.toLocaleString("en-US")} events. The counts below cover these ${n.toLocaleString("en-US")}; the download has all ${total.toLocaleString("en-US")}.`,
  };
}

// Every event for a company, newest first. `{ data, error }` — a failed page fails the read.
export async function readFullAuditLog(supabase, companyId) {
  const res = await readAllRows(() => supabase.from("audit_log").select("*")
    .eq("company_id", companyId).order("created_at", { ascending: false }).order("id", { ascending: false }));
  return res.error ? res : { data: res.data.map(auditRowFromDb), error: null };
}

// The rows the download writes. When the screen holds only part of the trail, the whole
// trail is read now; if that read fails, nothing is downloaded — a CSV of the newest
// window, named as the audit trail, is the defect this replaces.
export async function auditRowsForDownload({ loaded = [], total = null, readFull = null } = {}) {
  if (!auditCoverage(loaded.length, total).partial) return { rows: loaded, error: null };
  if (!readFull) return { rows: null, error: new Error("The full audit trail could not be read.") };
  const { data, error } = await readFull();
  if (error || !data) return { rows: null, error: error || new Error("The full audit trail could not be read.") };
  return { rows: data, error: null };
}

const cell = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
export function auditCsv(rows) {
  const headers = ["Timestamp", "Action", "Detail", "User"];
  const lines = (rows || []).map(e => [
    cell((e.ts || "").replace("T", " ").slice(0, 19)), cell(e.action || ""), cell(e.detail || ""), cell(e.user || "owner"),
  ].join(","));
  return [headers.join(","), ...lines].join("\n");
}
